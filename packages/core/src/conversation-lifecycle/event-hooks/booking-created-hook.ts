import type { LifecycleWriter } from "../lifecycle-writer.js";
import type { LifecycleModeReader } from "./governance-verdict-escalation-hook.js";

export interface BookingCreatedEvent {
  organizationId: string;
  conversationThreadId: string | null;
  contactId: string;
  bookingId: string;
  calendarEventId: string;
  serviceId: string;
}

export async function onBookingCreated(
  writer: LifecycleWriter,
  readMode: LifecycleModeReader,
  event: BookingCreatedEvent,
): Promise<void> {
  if (!event.conversationThreadId) return;
  const mode = await readMode(event.organizationId);
  if (mode !== "on") return;
  await writer.recordTransition({
    organizationId: event.organizationId,
    conversationThreadId: event.conversationThreadId,
    contactId: event.contactId,
    toState: "booked",
    trigger: "booking_event_received",
    actor: "integration",
    evidence: {
      booking_id: event.bookingId,
      calendar_event_id: event.calendarEventId,
      service_id: event.serviceId,
    },
  });
}
