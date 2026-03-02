// ---------------------------------------------------------------------------
// Action: patient-engagement.appointment.cancel
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { CalendarProvider } from "../providers/provider.js";
import { buildCancelUndoRecipe } from "./undo-recipes.js";

export async function executeCancelAppointment(
  params: Record<string, unknown>,
  calendar: CalendarProvider,
  calendarId: string,
): Promise<ExecuteResult> {
  const start = Date.now();
  const appointmentId = params.appointmentId as string;
  const reason = (params.reason as string) ?? "unspecified";

  try {
    const result = await calendar.cancelAppointment(calendarId, appointmentId);

    return {
      success: result.success,
      summary: `Cancelled appointment ${appointmentId} (was ${result.previousStatus}). Reason: ${reason}`,
      externalRefs: { appointmentId, previousStatus: result.previousStatus },
      rollbackAvailable: true,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: buildCancelUndoRecipe(appointmentId, params.originalStartTime as string ?? ""),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Failed to cancel appointment: ${errorMsg}`,
      externalRefs: { appointmentId },
      rollbackAvailable: false,
      partialFailures: [{ step: "cancel_appointment", error: errorMsg }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }
}
