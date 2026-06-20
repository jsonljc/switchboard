import type {
  SkillHook,
  SkillHookContext,
  SkillExecutionResult,
  SkillExecutionTrace,
} from "../types.js";
import { createId } from "@paralleldrive/cuid2";
import { computeExecutionCostUSD } from "../../telemetry/llm-costs.js";
import { getMetrics } from "../../telemetry/metrics.js";
import { deriveLinkedOutcome } from "../outcome-linker.js";

interface ExecutionTraceStore {
  create(trace: SkillExecutionTrace): Promise<void>;
}

/**
 * Accumulated execution state threaded into `onError` so a turn that burned tokens
 * before tripping the budget (or any other error) is recorded with its REAL cost,
 * not a zero fallback. Built by the executor from its in-scope accumulators at the
 * catch site. Optional: when absent (legacy callers) the recorder keeps the zero
 * fallback.
 */
export interface ExecutionTracePartial {
  tokenUsage: { input: number; output: number; cacheRead?: number; cacheCreation?: number };
  durationMs: number;
  turnCount: number;
  model?: string;
}

/**
 * The isolated telemetry recorder contract the executor invokes (its 8th arg). A
 * dedicated interface — NOT the full `SkillHook` — so the recorder can never be
 * placed in the `hooks` array and activate the governance afterSkill gates. The
 * `onError` leg accepts an optional accumulated `partial` so error traces carry
 * real burned tokens + cost.
 */
export interface ExecutionTraceRecorder {
  afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void>;
  onError(ctx: SkillHookContext, error: Error, partial?: ExecutionTracePartial): Promise<void>;
}

/**
 * Persists a per-execution telemetry row (tokens incl. cache, cost, model, latency,
 * turn count, status) and emits the per-model token + cost counters. Invoked DIRECTLY
 * by the executor as a dedicated arg (the `qualificationEvaluationHook` template) — NOT
 * via `runAfterSkillHooks`, so it never activates the governance afterSkill gates.
 */
export class TracePersistenceHook
  implements Pick<SkillHook, "afterSkill" | "onError">, ExecutionTraceRecorder
{
  readonly name = "trace-persistence";

  constructor(
    private traceStore: ExecutionTraceStore,
    private traceContext: { trigger: "chat_message" | "batch_job" | "brief_compose" },
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
    const traceId = createId();
    // Link the canonical WorkTrace to the business outcome the turn produced
    // (booking conversion, stage advance, opt-out). Persisted inline in the single
    // trace create — atomic and idempotent, no post-create updateMany.
    const linkedOutcome = deriveLinkedOutcome(result.toolCalls, traceId);
    const trace: SkillExecutionTrace = {
      id: traceId,
      deploymentId: ctx.deploymentId,
      organizationId: ctx.orgId,
      skillSlug: ctx.skillSlug,
      skillVersion: ctx.skillVersion,
      trigger: this.traceContext.trigger,
      sessionId: ctx.sessionId,
      workUnitId: ctx.workUnitId,
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
      ...(linkedOutcome
        ? {
            linkedOutcomeId: linkedOutcome.id,
            linkedOutcomeType: linkedOutcome.type,
            linkedOutcomeResult: linkedOutcome.result,
          }
        : {}),
      writeCount: result.trace.writeCount,
      createdAt: new Date(),
    };
    this.emitTokenCounters(model ?? "unknown", trace.tokenUsage);
    getMetrics().skillLlmCostUsdTotal.inc({ model: model ?? "unknown" }, totalCost);
    try {
      await this.traceStore.create(trace);
    } catch (err) {
      console.error("[trace-persistence] persist failed (swallowed):", err);
    }
  }

  async onError(
    ctx: SkillHookContext,
    error: Error,
    partial?: ExecutionTracePartial,
  ): Promise<void> {
    const status = error.name === "SkillExecutionBudgetError" ? "budget_exceeded" : "error";
    const model = partial?.model;
    const cacheRead = partial?.tokenUsage.cacheRead ?? 0;
    const cacheCreation = partial?.tokenUsage.cacheCreation ?? 0;
    // When the executor threads accumulated usage, record the REAL burned tokens +
    // cost. Absent a partial (legacy callers), keep the zero fallback.
    const tokenUsage = partial
      ? (() => {
          const { totalCost } = computeExecutionCostUSD({
            model,
            inputTokens: partial.tokenUsage.input,
            outputTokens: partial.tokenUsage.output,
            cacheReadTokens: cacheRead,
            cacheCreationTokens: cacheCreation,
          });
          return {
            input: partial.tokenUsage.input,
            output: partial.tokenUsage.output,
            cacheRead,
            cacheCreation,
            costUsd: totalCost,
            ...(model ? { model } : {}),
          };
        })()
      : { input: 0, output: 0 };
    const trace: SkillExecutionTrace = {
      id: createId(),
      deploymentId: ctx.deploymentId,
      organizationId: ctx.orgId,
      skillSlug: ctx.skillSlug,
      skillVersion: ctx.skillVersion,
      trigger: this.traceContext.trigger,
      sessionId: ctx.sessionId,
      workUnitId: ctx.workUnitId,
      inputParametersHash: ctx.inputParametersHash ?? "",
      toolCalls: [],
      governanceDecisions: [],
      tokenUsage,
      durationMs: partial?.durationMs ?? 0,
      turnCount: partial?.turnCount ?? 0,
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
