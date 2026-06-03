import type { TierContext, ModelSlot, DialogueStage } from "../model-router.js";
import type { SkillTool } from "./types.js";

export interface TierContextInput {
  /** Total user+assistant messages in the conversation incl. the current turn
   *  (≈ conversation depth). Maps straight to `TierContext.conversationDepth`. */
  conversationDepth: number;
  declaredToolIds: string[];
  tools: Map<string, SkillTool>;
  previousTurnHadToolUse: boolean;
  previousTurnEscalated: boolean;
  minimumModelTier?: ModelSlot;
  /** Coarse dialogue stage for the current turn; raises the tier when present. */
  currentStage?: DialogueStage;
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
    conversationDepth: input.conversationDepth,
    toolCount: input.declaredToolIds.length,
    hasHighRiskTools,
    previousTurnUsedTools: input.previousTurnHadToolUse,
    previousTurnEscalated: input.previousTurnEscalated,
    modelFloor: input.minimumModelTier,
    currentStage: input.currentStage,
  };
}
