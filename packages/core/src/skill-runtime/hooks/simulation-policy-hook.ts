import type { SkillHook, ToolCallContext, HookResult } from "../types.js";
import type { EffectCategory } from "../governance.js";
import { ok } from "../tool-result.js";

const BLOCKED_CATEGORIES: EffectCategory[] = [
  "write",
  "external_send",
  "external_mutation",
  "irreversible",
];

export class SimulationPolicyHook implements SkillHook {
  name = "simulation-policy";

  async beforeToolCall(ctx: ToolCallContext): Promise<HookResult> {
    if (BLOCKED_CATEGORIES.includes(ctx.effectCategory)) {
      return {
        proceed: false,
        reason: "simulation_mode",
        substituteResult: ok({
          simulated: true,
          action: `would_execute_${ctx.operation}`,
          blocked_reason: "simulation_mode",
          effect_category: ctx.effectCategory,
        }),
      };
    }
    return { proceed: true };
  }
}
