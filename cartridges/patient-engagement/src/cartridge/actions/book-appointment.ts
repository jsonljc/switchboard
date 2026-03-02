// ---------------------------------------------------------------------------
// Action: patient-engagement.appointment.book
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { CalendarProvider } from "../providers/provider.js";
import { buildBookingUndoRecipe } from "./undo-recipes.js";

export async function executeBookAppointment(
  params: Record<string, unknown>,
  calendar: CalendarProvider,
  calendarId: string,
): Promise<ExecuteResult> {
  const start = Date.now();
  const patientId = params.patientId as string;
  const startTime = new Date(params.startTime as string);
  const durationMinutes = Number(params.durationMinutes ?? 60);
  const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);
  const treatmentType = (params.treatmentType as string) ?? "consultation";

  try {
    const appointment = await calendar.bookAppointment(
      calendarId,
      patientId,
      startTime,
      endTime,
      `${treatmentType} - Patient ${patientId}`,
      params.notes as string | undefined,
    );

    return {
      success: true,
      summary: `Booked ${treatmentType} appointment for patient ${patientId} at ${startTime.toISOString()}`,
      externalRefs: {
        patientId,
        appointmentId: appointment.appointmentId,
      },
      rollbackAvailable: true,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: buildBookingUndoRecipe(appointment.appointmentId),
      data: appointment,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Failed to book appointment: ${errorMsg}`,
      externalRefs: { patientId },
      rollbackAvailable: false,
      partialFailures: [{ step: "book_appointment", error: errorMsg }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }
}
