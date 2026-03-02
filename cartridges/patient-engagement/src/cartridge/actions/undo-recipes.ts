// ---------------------------------------------------------------------------
// Undo Recipe Builders — Patient Engagement
// ---------------------------------------------------------------------------

import type { UndoRecipe } from "@switchboard/schemas";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function buildBookingUndoRecipe(appointmentId: string): UndoRecipe {
  return {
    originalActionId: "",
    originalEnvelopeId: "",
    reverseActionType: "patient-engagement.appointment.cancel",
    reverseParameters: { appointmentId, reason: "undo" },
    undoExpiresAt: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
    undoRiskCategory: "medium",
    undoApprovalRequired: "none",
  };
}

export function buildCancelUndoRecipe(
  appointmentId: string,
  originalStartTime: string,
): UndoRecipe {
  return {
    originalActionId: "",
    originalEnvelopeId: "",
    reverseActionType: "patient-engagement.appointment.book",
    reverseParameters: { appointmentId, startTime: originalStartTime },
    undoExpiresAt: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
    undoRiskCategory: "medium",
    undoApprovalRequired: "standard",
  };
}

export function buildRescheduleUndoRecipe(
  appointmentId: string,
  originalStartTime: string,
): UndoRecipe {
  return {
    originalActionId: "",
    originalEnvelopeId: "",
    reverseActionType: "patient-engagement.appointment.reschedule",
    reverseParameters: { appointmentId, newStartTime: originalStartTime },
    undoExpiresAt: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
    undoRiskCategory: "medium",
    undoApprovalRequired: "standard",
  };
}

export function buildCadenceStopUndoRecipe(
  cadenceInstanceId: string,
): UndoRecipe {
  return {
    originalActionId: "",
    originalEnvelopeId: "",
    reverseActionType: "patient-engagement.cadence.stop",
    reverseParameters: { cadenceInstanceId, reason: "undo" },
    undoExpiresAt: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
    undoRiskCategory: "low",
    undoApprovalRequired: "none",
  };
}

export function buildJourneyStageUndoRecipe(
  patientId: string,
  previousStage: string,
): UndoRecipe {
  return {
    originalActionId: "",
    originalEnvelopeId: "",
    reverseActionType: "patient-engagement.journey.update_stage",
    reverseParameters: { patientId, newStage: previousStage, reason: "undo" },
    undoExpiresAt: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
    undoRiskCategory: "low",
    undoApprovalRequired: "none",
  };
}
