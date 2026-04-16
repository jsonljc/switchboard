import type { ExecutionMode, ExecutionContext } from "../execution-context.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";
import type { WorkUnit } from "../work-unit.js";
import type {
  SkillExecutor,
  SkillDefinition,
  SkillRuntimePolicy,
} from "../../skill-runtime/types.js";
import { DEFAULT_SKILL_RUNTIME_POLICY } from "../../skill-runtime/types.js";
import type { ExecutionModeName } from "../types.js";

export interface SkillModeConfig {
  executor: SkillExecutor;
  skillsBySlug: Map<string, SkillDefinition>;
}

/**
 * Resolves a skill slug from a work unit.
 * Tries `parameters.skillSlug` first, then derives from intent
 * (e.g. "sales-pipeline.run" -> "sales-pipeline").
 */
function resolveSkillSlug(workUnit: WorkUnit): string | undefined {
  if (typeof workUnit.parameters.skillSlug === "string") {
    return workUnit.parameters.skillSlug;
  }
  if (workUnit.intent) {
    const dotIndex = workUnit.intent.lastIndexOf(".");
    return dotIndex > 0 ? workUnit.intent.slice(0, dotIndex) : workUnit.intent;
  }
  return undefined;
}

/**
 * Maps ExecutionConstraints from governance into a SkillRuntimePolicy,
 * merging with defaults for fields not covered by constraints.
 */
function mapConstraintsToPolicy(constraints: ExecutionConstraints): SkillRuntimePolicy {
  return {
    ...DEFAULT_SKILL_RUNTIME_POLICY,
    allowedModelTiers: constraints.allowedModelTiers,
    maxToolCalls: constraints.maxToolCalls,
    maxLlmTurns: constraints.maxLlmTurns,
    maxTotalTokens: constraints.maxTotalTokens,
    maxRuntimeMs: constraints.maxRuntimeMs,
    maxWritesPerExecution: constraints.maxWritesPerExecution,
    trustLevel: constraints.trustLevel,
  };
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
    const slug = resolveSkillSlug(workUnit);
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

    const _policy = mapConstraintsToPolicy(constraints);

    const startMs = Date.now();
    try {
      const result = await this.config.executor.execute({
        skill,
        parameters: workUnit.parameters,
        messages: [],
        deploymentId: workUnit.organizationId,
        orgId: workUnit.organizationId,
        trustScore: 0,
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
