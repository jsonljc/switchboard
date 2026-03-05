// ---------------------------------------------------------------------------
// Action: customer-engagement.cadence.start
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import { buildCadenceStopUndoRecipe } from "./undo-recipes.js";

export async function executeStartCadence(params: Record<string, unknown>): Promise<ExecuteResult> {
  const start = Date.now();
  const contactId = params.contactId as string;
  const cadenceTemplateId = params.cadenceTemplateId as string;
  const cadenceInstanceId = `cadence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    success: true,
    summary: `Started cadence "${cadenceTemplateId}" for patient ${contactId} (instance: ${cadenceInstanceId})`,
    externalRefs: { contactId, cadenceInstanceId, cadenceTemplateId },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildCadenceStopUndoRecipe(cadenceInstanceId),
    data: { cadenceInstanceId, status: "active", currentStep: 0 },
  };
}
