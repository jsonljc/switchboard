import type { SkillHook, LlmCallContext, LlmHookResult } from "../types.js";

const DEFAULT_MAX_LLM_TURNS = 6;
const DEFAULT_MAX_TOTAL_TOKENS = 64_000;
const DEFAULT_MAX_RUNTIME_MS = 30_000;

export class BudgetEnforcementHook implements SkillHook {
  name = "budget-enforcement";
  private maxLlmTurns: number;
  private maxTotalTokens: number;
  private maxRuntimeMs: number;

  constructor(config?: { maxLlmTurns?: number; maxTotalTokens?: number; maxRuntimeMs?: number }) {
    this.maxLlmTurns = config?.maxLlmTurns ?? DEFAULT_MAX_LLM_TURNS;
    this.maxTotalTokens = config?.maxTotalTokens ?? DEFAULT_MAX_TOTAL_TOKENS;
    this.maxRuntimeMs = config?.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;
  }

  async beforeLlmCall(ctx: LlmCallContext): Promise<LlmHookResult> {
    if (ctx.turnCount >= this.maxLlmTurns) {
      return { proceed: false, reason: `Exceeded maximum LLM turns (${this.maxLlmTurns})` };
    }
    const totalTokens = ctx.totalInputTokens + ctx.totalOutputTokens;
    if (totalTokens > this.maxTotalTokens) {
      return {
        proceed: false,
        reason: `Exceeded token budget (${totalTokens} > ${this.maxTotalTokens})`,
      };
    }
    if (ctx.elapsedMs >= this.maxRuntimeMs) {
      return { proceed: false, reason: `Exceeded ${this.maxRuntimeMs / 1000}s runtime limit` };
    }
    return { proceed: true, ctx };
  }
}
