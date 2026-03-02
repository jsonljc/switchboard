// ---------------------------------------------------------------------------
// Action: patient-engagement.appointment.reschedule
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { CalendarProvider } from "../providers/provider.js";
import { buildRescheduleUndoRecipe } from "./undo-recipes.js";

export async function executeRescheduleAppointment(
  params: Record<string, unknown>,
  calendar: CalendarProvider,
  calendarId: string,
): Promise<ExecuteResult> {
  const start = Date.now();
  const appointmentId = params.appointmentId as string;
  const newStartTime = new Date(params.newStartTime as string);
  const durationMinutes = Number(params.durationMinutes ?? 60);
  const newEndTime = new Date(newStartTime.getTime() + durationMinutes * 60_000);

  try {
    const appointment = await calendar.rescheduleAppointment(
      calendarId,
      appointmentId,
      newStartTime,
      newEndTime,
    );

    return {
      success: true,
      summary: `Rescheduled appointment ${appointmentId} to ${newStartTime.toISOString()}`,
      externalRefs: { appointmentId },
      rollbackAvailable: true,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: buildRescheduleUndoRecipe(
        appointmentId,
        (params.originalStartTime as string) ?? "",
      ),
      data: appointment,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Failed to reschedule appointment: ${errorMsg}`,
      externalRefs: { appointmentId },
      rollbackAvailable: false,
      partialFailures: [{ step: "reschedule_appointment", error: errorMsg }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }
}
