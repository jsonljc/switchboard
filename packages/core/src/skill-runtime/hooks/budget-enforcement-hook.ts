import type { SkillHook, LlmCallContext, LlmHookResult, SkillRuntimePolicy } from "../types.js";
import { DEFAULT_SKILL_RUNTIME_POLICY } from "../types.js";

export class BudgetEnforcementHook implements SkillHook {
  name = "budget-enforcement";
  private maxLlmTurns: number;
  private maxTotalTokens: number;
  private maxRuntimeMs: number;

  constructor(policy?: SkillRuntimePolicy) {
    const p = policy ?? DEFAULT_SKILL_RUNTIME_POLICY;
    this.maxLlmTurns = p.maxLlmTurns;
    this.maxTotalTokens = p.maxTotalTokens;
    this.maxRuntimeMs = p.maxRuntimeMs;
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
