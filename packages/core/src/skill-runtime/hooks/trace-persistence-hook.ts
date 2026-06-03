import type {
  SkillHook,
  SkillHookContext,
  SkillExecutionResult,
  SkillExecutionTrace,
} from "../types.js";
import { createId } from "@paralleldrive/cuid2";
import { computeExecutionCostUSD } from "../../telemetry/llm-costs.js";
import { getMetrics } from "../../telemetry/metrics.js";

interface ExecutionTraceStore {
  create(trace: SkillExecutionTrace): Promise<void>;
}

/**
 * Persists a per-execution telemetry row (tokens incl. cache, cost, model, latency,
 * turn count, status) and emits the per-model token counter. Invoked DIRECTLY by the
 * executor as a dedicated arg (the `qualificationEvaluationHook` template) — NOT via
 * `runAfterSkillHooks`, so it never activates the governance afterSkill gates.
 */
export class TracePersistenceHook implements Pick<SkillHook, "afterSkill" | "onError"> {
  readonly name = "trace-persistence";

  constructor(
    private traceStore: ExecutionTraceStore,
    private traceContext: { trigger: "chat_message" | "batch_job" },
  ) {}

  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
    const model = result.trace.model;
    const cacheRead = result.tokenUsage.cacheRead ?? 0;
    const cacheCreation = result.tokenUsage.cacheCreation ?? 0;
    const { totalCost } = computeExecutionCostUSD({
      model,
      inputTokens: result.tokenUsage.input,
      outputTokens: result.tokenUsage.output,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheCreation,
    });
    const trace: SkillExecutionTrace = {
      id: createId(),
      deploymentId: ctx.deploymentId,
      organizationId: ctx.orgId,
      skillSlug: ctx.skillSlug,
      skillVersion: ctx.skillVersion,
      trigger: this.traceContext.trigger,
      sessionId: ctx.sessionId,
      inputParametersHash: ctx.inputParametersHash ?? "",
      toolCalls: result.toolCalls,
      governanceDecisions: result.trace.governanceDecisions,
      tokenUsage: {
        input: result.tokenUsage.input,
        output: result.tokenUsage.output,
        cacheRead,
        cacheCreation,
        costUsd: totalCost,
        ...(model ? { model } : {}),
      },
      durationMs: result.trace.durationMs,
      turnCount: result.trace.turnCount,
      status: result.trace.status,
      error: result.trace.error,
      responseSummary: result.response.slice(0, 500),
      writeCount: result.trace.writeCount,
      createdAt: new Date(),
    };
    this.emitTokenCounters(model ?? "unknown", trace.tokenUsage);
    try {
      await this.traceStore.create(trace);
    } catch (err) {
      console.error("[trace-persistence] persist failed (swallowed):", err);
    }
  }

  async onError(ctx: SkillHookContext, error: Error): Promise<void> {
    const status = error.name === "SkillExecutionBudgetError" ? "budget_exceeded" : "error";
    const trace: SkillExecutionTrace = {
      id: createId(),
      deploymentId: ctx.deploymentId,
      organizationId: ctx.orgId,
      skillSlug: ctx.skillSlug,
      skillVersion: ctx.skillVersion,
      trigger: this.traceContext.trigger,
      sessionId: ctx.sessionId,
      inputParametersHash: ctx.inputParametersHash ?? "",
      toolCalls: [],
      governanceDecisions: [],
      tokenUsage: { input: 0, output: 0 },
      durationMs: 0,
      turnCount: 0,
      status,
      error: error.message,
      responseSummary: "",
      writeCount: 0,
      createdAt: new Date(),
    };
    try {
      await this.traceStore.create(trace);
    } catch (err) {
      console.error("[trace-persistence] error-trace persist failed (swallowed):", err);
    }
  }

  private emitTokenCounters(
    model: string,
    usage: { input: number; output: number; cacheRead?: number; cacheCreation?: number },
  ): void {
    const m = getMetrics();
    m.skillLlmTokensTotal.inc({ model, kind: "input" }, usage.input);
    m.skillLlmTokensTotal.inc({ model, kind: "output" }, usage.output);
    if (usage.cacheRead) m.skillLlmTokensTotal.inc({ model, kind: "cache_read" }, usage.cacheRead);
    if (usage.cacheCreation)
      m.skillLlmTokensTotal.inc({ model, kind: "cache_creation" }, usage.cacheCreation);
  }
}
