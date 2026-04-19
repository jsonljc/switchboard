import type { SkillHook, SkillHookContext, HookResult } from "../types.js";
import type { CircuitBreaker } from "../circuit-breaker.js";

export class CircuitBreakerHook implements SkillHook {
  name = "circuit-breaker";
  constructor(private circuitBreaker: CircuitBreaker) {}

  async beforeSkill(ctx: SkillHookContext): Promise<HookResult> {
    const result = await this.circuitBreaker.check(ctx.deploymentId);
    if (!result.allowed) {
      return { proceed: false, reason: result.reason };
    }
    return { proceed: true };
  }
}
