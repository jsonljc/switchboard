import type { TierContext, ModelSlot } from "../model-router.js";
import type { SkillTool } from "./types.js";

export interface TierContextInput {
  turnCount: number;
  declaredToolIds: string[];
  tools: Map<string, SkillTool>;
  previousTurnHadToolUse: boolean;
  previousTurnEscalated: boolean;
  minimumModelTier?: ModelSlot;
}

export function buildTierContext(input: TierContextInput): TierContext {
  const hasHighRiskTools = input.declaredToolIds.some((toolId) => {
    const tool = input.tools.get(toolId);
    if (!tool) return false;
    return Object.values(tool.operations).some(
      (op) =>
        op.effectCategory === "external_send" ||
        op.effectCategory === "external_mutation" ||
        op.effectCategory === "irreversible",
    );
  });

  return {
    messageIndex: input.turnCount,
    toolCount: input.declaredToolIds.length,
    hasHighRiskTools,
    previousTurnUsedTools: input.previousTurnHadToolUse,
    previousTurnEscalated: input.previousTurnEscalated,
    modelFloor: input.minimumModelTier,
  };
}
