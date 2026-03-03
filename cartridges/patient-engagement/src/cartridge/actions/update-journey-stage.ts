// ---------------------------------------------------------------------------
// Action: patient-engagement.journey.update_stage
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { JourneyStageId } from "../../core/types.js";
import { buildJourneyStageUndoRecipe } from "./undo-recipes.js";

const VALID_STAGES: JourneyStageId[] = [
  "new_lead",
  "qualified",
  "consultation_booked",
  "consultation_completed",
  "treatment_proposed",
  "treatment_accepted",
  "treatment_scheduled",
  "treatment_completed",
  "repeat_patient",
  "dormant",
  "lost",
];

export async function executeUpdateJourneyStage(
  params: Record<string, unknown>,
): Promise<ExecuteResult> {
  const start = Date.now();
  const patientId = params.patientId as string;
  const newStage = params.newStage as string;
  const reason = (params.reason as string) ?? "manual";
  const previousStage = (params.previousStage as string) ?? "unknown";

  if (!VALID_STAGES.includes(newStage as JourneyStageId)) {
    return {
      success: false,
      summary: `Invalid journey stage: ${newStage}`,
      externalRefs: { patientId },
      rollbackAvailable: false,
      partialFailures: [{ step: "validate_stage", error: `Invalid stage: ${newStage}` }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  return {
    success: true,
    summary: `Updated patient ${patientId} journey stage to "${newStage}". Reason: ${reason}`,
    externalRefs: { patientId, previousStage, newStage },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildJourneyStageUndoRecipe(patientId, previousStage),
    data: { patientId, previousStage, newStage, reason, updatedAt: new Date().toISOString() },
  };
}
