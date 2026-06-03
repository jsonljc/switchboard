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
  return {
    conversationDepth: input.conversationDepth,
    toolCount: input.declaredToolIds.length,
    previousTurnUsedTools: input.previousTurnHadToolUse,
    previousTurnEscalated: input.previousTurnEscalated,
    modelFloor: input.minimumModelTier,
    currentStage: input.currentStage,
  };
}
