import type { ExecutionMode, ExecutionContext } from "../execution-context.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";
import type { WorkUnit } from "../work-unit.js";
import type { SkillExecutor, SkillDefinition } from "../../skill-runtime/types.js";
import type { ExecutionModeName } from "../types.js";
import type { BuilderRegistry } from "../../skill-runtime/builder-registry.js";
import type { SkillStores } from "../../skill-runtime/parameter-builder.js";

export interface SkillModeConfig {
  executor: SkillExecutor;
  skillsBySlug: Map<string, SkillDefinition>;
  builderRegistry?: BuilderRegistry;
  stores?: SkillStores;
}

export class SkillMode implements ExecutionMode {
  readonly name: ExecutionModeName = "skill";
  private readonly config: SkillModeConfig;

  constructor(config: SkillModeConfig) {
    this.config = config;
  }

  async execute(
    workUnit: WorkUnit,
    constraints: ExecutionConstraints,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const slug = workUnit.deployment?.skillSlug ?? this.resolveSkillSlugLegacy(workUnit);
    if (!slug) {
      return this.failedResult(
        workUnit,
        context,
        "SLUG_RESOLUTION_FAILED",
        "Cannot resolve skill slug from work unit",
      );
    }

    const skill = this.config.skillsBySlug.get(slug);
    if (!skill) {
      return this.failedResult(workUnit, context, "SKILL_NOT_FOUND", `Skill not found: ${slug}`);
    }

    const startMs = Date.now();
    try {
      const conversationParam = workUnit.parameters.conversation as
        | { messages?: Array<{ role: string; content: string }> }
        | undefined;
      const rawMessages = conversationParam?.messages ?? [];
      const messages = rawMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const parameters = await this.resolveParameters(workUnit, skill);

      const result = await this.config.executor.execute({
        skill,
        parameters,
        messages,
        deploymentId: workUnit.deployment?.deploymentId ?? workUnit.organizationId,
        orgId: workUnit.organizationId,
        trustScore: workUnit.deployment?.trustScore ?? 0,
        trustLevel: constraints.trustLevel,
      });

      const durationMs = Date.now() - startMs;

      return {
        workUnitId: workUnit.id,
        outcome: result.trace.status === "success" ? "completed" : "failed",
        summary: result.trace.responseSummary,
        outputs: { response: result.response, toolCalls: result.toolCalls },
        mode: "skill",
        durationMs,
        traceId: context.traceId,
        error:
          result.trace.status !== "success" && result.trace.error
            ? { code: result.trace.status, message: result.trace.error }
            : undefined,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startMs;
      const message = err instanceof Error ? err.message : String(err);
      return this.failedResult(workUnit, context, "EXECUTION_ERROR", message, durationMs);
    }
  }

  private async resolveParameters(
    workUnit: WorkUnit,
    _skill: SkillDefinition,
  ): Promise<Record<string, unknown>> {
    const { builderRegistry, stores } = this.config;
    const slug = workUnit.deployment?.skillSlug;

    if (!builderRegistry || !slug || !stores) {
      return workUnit.parameters;
    }

    const builder = builderRegistry.get(slug);
    if (!builder) {
      return workUnit.parameters;
    }

    return builder({
      workUnit,
      deployment: workUnit.deployment,
      stores,
    });
  }

  private resolveSkillSlugLegacy(workUnit: WorkUnit): string | undefined {
    if (typeof workUnit.parameters.skillSlug === "string") {
      return workUnit.parameters.skillSlug;
    }
    if (workUnit.intent) {
      const dotIndex = workUnit.intent.lastIndexOf(".");
      return dotIndex > 0 ? workUnit.intent.slice(0, dotIndex) : workUnit.intent;
    }
    return undefined;
  }

  private failedResult(
    workUnit: WorkUnit,
    context: ExecutionContext,
    code: string,
    message: string,
    durationMs = 0,
  ): ExecutionResult {
    return {
      workUnitId: workUnit.id,
      outcome: "failed",
      summary: message,
      outputs: {},
      mode: "skill",
      durationMs,
      traceId: context.traceId,
      error: { code, message },
    };
  }
}
