import type { SkillHook, SkillHookContext, HookResult } from "../types.js";
import type { BlastRadiusLimiter } from "../blast-radius-limiter.js";

export class BlastRadiusHook implements SkillHook {
  name = "blast-radius";
  constructor(private limiter: BlastRadiusLimiter) {}

  async beforeSkill(ctx: SkillHookContext): Promise<HookResult> {
    const result = await this.limiter.check(ctx.deploymentId);
    if (!result.allowed) {
      return { proceed: false, reason: result.reason };
    }
    return { proceed: true };
  }
}
