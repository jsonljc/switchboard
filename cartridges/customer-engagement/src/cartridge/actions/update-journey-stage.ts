// ---------------------------------------------------------------------------
// Action: customer-engagement.journey.update_stage
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import { DEFAULT_JOURNEY_STAGE_IDS } from "../../core/types.js";
import { buildJourneyStageUndoRecipe } from "./undo-recipes.js";

export async function executeUpdateJourneyStage(
  params: Record<string, unknown>,
  validStages?: string[],
): Promise<ExecuteResult> {
  const start = Date.now();
  const contactId = params.contactId as string;
  const newStage = params.newStage as string;
  const reason = (params.reason as string) ?? "manual";
  const previousStage = (params.previousStage as string) ?? "unknown";

  const stages = validStages ?? DEFAULT_JOURNEY_STAGE_IDS;

  if (!stages.includes(newStage)) {
    return {
      success: false,
      summary: `Invalid journey stage: ${newStage}`,
      externalRefs: { contactId },
      rollbackAvailable: false,
      partialFailures: [{ step: "validate_stage", error: `Invalid stage: ${newStage}` }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  return {
    success: true,
    summary: `Updated contact ${contactId} journey stage to "${newStage}". Reason: ${reason}`,
    externalRefs: { contactId, previousStage, newStage },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildJourneyStageUndoRecipe(contactId, previousStage),
    data: { contactId, previousStage, newStage, reason, updatedAt: new Date().toISOString() },
  };
}
