import type {
  SkillHook,
  SkillHookContext,
  SkillExecutionResult,
  SkillExecutionTrace,
} from "../types.js";
import { createId } from "@paralleldrive/cuid2";

interface ExecutionTraceStore {
  create(trace: SkillExecutionTrace): Promise<void>;
}

export class TracePersistenceHook implements SkillHook {
  name = "trace-persistence";
  private traceId: string;

  constructor(
    private traceStore: ExecutionTraceStore,
    private traceContext: {
      trigger: "chat_message" | "batch_job";
      inputParametersHash: string;
    },
  ) {
    this.traceId = createId();
  }

  getTraceId(): string {
    return this.traceId;
  }

  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
    const trace: SkillExecutionTrace = {
      id: this.traceId,
      deploymentId: ctx.deploymentId,
      organizationId: ctx.orgId,
      skillSlug: ctx.skillSlug,
      skillVersion: ctx.skillVersion,
      trigger: this.traceContext.trigger,
      sessionId: ctx.sessionId,
      inputParametersHash: this.traceContext.inputParametersHash,
      toolCalls: result.toolCalls,
      governanceDecisions: result.trace.governanceDecisions,
      tokenUsage: result.tokenUsage,
      durationMs: result.trace.durationMs,
      turnCount: result.trace.turnCount,
      status: result.trace.status,
      error: result.trace.error,
      responseSummary: result.response.slice(0, 500),
      writeCount: result.trace.writeCount,
      createdAt: new Date(),
    };
    try {
      await this.traceStore.create(trace);
    } catch (err) {
      console.error(`Trace persistence failed for ${this.traceId}:`, err);
    }
  }

  async onError(ctx: SkillHookContext, error: Error): Promise<void> {
    const status = error.name === "SkillExecutionBudgetError" ? "budget_exceeded" : "error";
    const errorTrace: SkillExecutionTrace = {
      id: this.traceId,
      deploymentId: ctx.deploymentId,
      organizationId: ctx.orgId,
      skillSlug: ctx.skillSlug,
      skillVersion: ctx.skillVersion,
      trigger: this.traceContext.trigger,
      sessionId: ctx.sessionId,
      inputParametersHash: this.traceContext.inputParametersHash,
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
      await this.traceStore.create(errorTrace);
    } catch (traceErr) {
      console.error(`Error trace persistence failed for ${this.traceId}:`, traceErr);
    }
  }
}
