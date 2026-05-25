import type { ExecutionMode, ExecutionContext } from "../execution-context.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";
import type { WorkUnit } from "../work-unit.js";
import type { SkillExecutor, SkillDefinition } from "../../skill-runtime/types.js";
import type { ExecutionModeName } from "../types.js";
import { isRichBuilderResult, type BuilderRegistry } from "../../skill-runtime/builder-registry.js";
import type { SkillStores } from "../../skill-runtime/parameter-builder.js";
import type { ContextResolverImpl } from "../../skill-runtime/context-resolver.js";

export interface SkillModeConfig {
  executor: SkillExecutor;
  skillsBySlug: Map<string, SkillDefinition>;
  builderRegistry?: BuilderRegistry;
  stores?: SkillStores;
  /**
   * Optional curated-knowledge resolver. When present, SkillMode resolves the
   * skill's knowledge-entry context (NOT business-facts — the builder owns
   * BUSINESS_FACTS) and merges it into the executor parameters, mirroring
   * BatchSkillHandler. Omitted in tests / non-resolving deployments → no-op.
   */
  contextResolver?: { resolve: ContextResolverImpl["resolve"] };
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

      const { parameters, injectedPatternIds } = await this.resolveParameters(workUnit, skill);

      const contextVariables = await this.resolveContextVariables(workUnit.organizationId, skill);
      // Merge precedence is INTENTIONAL: resolved context wins over builder params on
      // key collision, so a declared context slot always reflects its KnowledgeEntry
      // rows. BUSINESS_FACTS is excluded from resolution (the builder owns it), so there
      // is no collision today; this precedence guards future skills that reuse an
      // inject_as name a builder also sets.
      const mergedParameters = { ...parameters, ...contextVariables };

      const result = await this.config.executor.execute({
        skill,
        parameters: mergedParameters,
        messages,
        deploymentId: workUnit.deployment?.deploymentId ?? workUnit.organizationId,
        orgId: workUnit.organizationId,
        trustScore: workUnit.deployment?.trustScore ?? 0,
        trustLevel: constraints.trustLevel,
        sessionId: workUnit.traceId ?? workUnit.id,
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
        injectedPatternIds,
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
  ): Promise<{ parameters: Record<string, unknown>; injectedPatternIds: string[] }> {
    const { builderRegistry, stores } = this.config;
    const slug = workUnit.deployment?.skillSlug;

    if (!builderRegistry || !slug || !stores) {
      return { parameters: workUnit.parameters, injectedPatternIds: [] };
    }

    const builder = builderRegistry.get(slug);
    if (!builder) {
      return { parameters: workUnit.parameters, injectedPatternIds: [] };
    }

    const result = await builder({
      workUnit,
      deployment: workUnit.deployment,
      stores,
    });

    if (isRichBuilderResult(result)) {
      return {
        parameters: result.parameters,
        injectedPatternIds: result.metadata?.injectedPatternIds ?? [],
      };
    }
    return { parameters: result, injectedPatternIds: [] };
  }

  private async resolveContextVariables(
    orgId: string,
    skill: SkillDefinition,
  ): Promise<Record<string, string>> {
    if (!this.config.contextResolver) return {}; // no resolver wired → unchanged behavior
    // The builder owns BUSINESS_FACTS; never resolve it here (avoids double-source
    // and the required-business-facts throw). LOAD-BEARING — do not remove the filter.
    const knowledgeReqs = skill.context.filter((r) => r.kind !== "business-facts");
    if (knowledgeReqs.length === 0) return {};
    try {
      const { variables } = await this.config.contextResolver.resolve(orgId, knowledgeReqs);
      return variables;
    } catch (err) {
      // FAIL-OPEN: a live conversation must never 500 on a context-resolution miss.
      // Presence is enforced loudly at provisioning / A0 preflight, not here.
      console.warn(
        `[SkillMode] context resolution failed for ${skill.slug}/${orgId} (continuing with empty context): ${err instanceof Error ? err.message : String(err)}`,
      );
      return {};
    }
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
