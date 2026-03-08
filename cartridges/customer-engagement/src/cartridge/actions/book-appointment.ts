// ---------------------------------------------------------------------------
// Action: customer-engagement.appointment.book
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ConversionBus } from "@switchboard/core";
import type { CalendarProvider } from "../providers/provider.js";
import { buildBookingUndoRecipe } from "./undo-recipes.js";

export async function executeBookAppointment(
  params: Record<string, unknown>,
  calendar: CalendarProvider,
  calendarId: string,
  options?: { conversionBus?: ConversionBus; organizationId?: string },
): Promise<ExecuteResult> {
  const start = Date.now();
  const contactId = params.contactId as string;
  const serviceType = (params.serviceType as string) ?? "consultation";

  // If bookingUrl is configured, generate a pass-through link instead of calendar-booking
  const bookingUrl = params.bookingUrl as string | undefined;
  if (bookingUrl) {
    const url = new URL(bookingUrl);
    url.searchParams.set("patient_id", contactId);
    if (serviceType) url.searchParams.set("type", serviceType);

    return {
      success: true,
      summary: `Booking link generated for patient ${contactId}: ${url.toString()}`,
      externalRefs: { contactId, bookingUrl: url.toString() },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
      data: { bookingUrl: url.toString(), contactId, serviceType },
    };
  }

  const startTime = new Date(params.startTime as string);
  const durationMinutes = Number(params.durationMinutes ?? 60);
  const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);

  try {
    const appointment = await calendar.bookAppointment(
      calendarId,
      contactId,
      startTime,
      endTime,
      `${serviceType} - Patient ${contactId}`,
      params.notes as string | undefined,
    );

    // Emit conversion event on successful booking
    if (options?.conversionBus && options.organizationId) {
      options.conversionBus.emit({
        type: "booked",
        contactId,
        organizationId: options.organizationId,
        value: Number(params.conversionValue ?? 50),
        sourceAdId: params.sourceAdId as string | undefined,
        sourceCampaignId: params.sourceCampaignId as string | undefined,
        timestamp: new Date(),
        metadata: { serviceType, appointmentId: appointment.appointmentId },
      });
    }

    return {
      success: true,
      summary: `Booked ${serviceType} appointment for patient ${contactId} at ${startTime.toISOString()}`,
      externalRefs: {
        contactId,
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
      externalRefs: { contactId },
      rollbackAvailable: false,
      partialFailures: [{ step: "book_appointment", error: errorMsg }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }
}
