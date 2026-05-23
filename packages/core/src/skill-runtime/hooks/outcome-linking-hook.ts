import type { SkillHook, SkillHookContext, SkillExecutionResult } from "../types.js";
import type { OutcomeLinker } from "../outcome-linker.js";

export class OutcomeLinkingHook implements SkillHook {
  name = "outcome-linking";

  constructor(
    private outcomeLinker: OutcomeLinker,
    private getTraceId: () => string,
  ) {}

  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
    try {
      await this.outcomeLinker.linkFromToolCalls(ctx.orgId, this.getTraceId(), result.toolCalls);
    } catch (err) {
      console.error("Outcome linking failed:", err);
    }
  }
}
