import type { SkillHook, ToolCallContext, HookResult } from "../types.js";
import { getToolGovernanceDecision } from "../governance.js";
import type { GovernanceLogEntry, GovernanceDecision } from "../governance.js";
import type { SkillTool } from "../types.js";

export class GovernanceHook implements SkillHook {
  name = "governance";
  private logs: GovernanceLogEntry[] = [];

  constructor(private tools: Map<string, SkillTool>) {}

  async beforeToolCall(ctx: ToolCallContext): Promise<HookResult> {
    const tool = this.tools.get(ctx.toolId);
    const op = tool?.operations[ctx.operation];

    const decision: GovernanceDecision = op
      ? getToolGovernanceDecision(op, ctx.trustLevel)
      : "auto-approve";

    if (op) {
      this.logs.push({
        operationId: `${ctx.toolId}.${ctx.operation}`,
        tier: op.effectCategory,
        trustLevel: ctx.trustLevel,
        decision,
        overridden: !!op.governanceOverride?.[ctx.trustLevel],
        timestamp: new Date().toISOString(),
      });
    }

    if (decision === "deny") {
      return {
        proceed: false,
        reason: "This action is not permitted at your current trust level.",
        decision: "denied",
      };
    }
    if (decision === "require-approval") {
      return {
        proceed: false,
        reason: "This action requires human approval.",
        decision: "pending_approval",
      };
    }
    return { proceed: true };
  }

  getGovernanceLogs(): GovernanceLogEntry[] {
    return this.logs;
  }
}
