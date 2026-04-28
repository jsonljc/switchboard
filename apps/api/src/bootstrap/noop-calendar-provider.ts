import { randomUUID } from "node:crypto";
import type {
  CalendarProvider,
  SlotQuery,
  TimeSlot,
  CreateBookingInput,
  Booking,
  CalendarHealthCheck,
} from "@switchboard/schemas";

export class NoopCalendarProvider implements CalendarProvider {
  private readonly logger: { info(msg: string): void };

  constructor(logger?: { info(msg: string): void }) {
    this.logger = logger ?? { info: () => {} };
  }

  async listAvailableSlots(_query: SlotQuery): Promise<TimeSlot[]> {
    this.logger.info("NoopCalendarProvider: listAvailableSlots called — returning empty");
    return [];
  }

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    this.logger.info("NoopCalendarProvider: createBooking called — returning stub booking");
    return {
      id: `noop-${randomUUID()}`,
      contactId: input.contactId,
      organizationId: input.organizationId,
      opportunityId: input.opportunityId ?? null,
      service: input.service,
      status: "pending_confirmation",
      calendarEventId: null,
      attendeeName: input.attendeeName ?? null,
      attendeeEmail: input.attendeeEmail ?? null,
      notes: input.notes ?? null,
      createdByType: input.createdByType ?? "agent",
      sourceChannel: input.sourceChannel ?? null,
      workTraceId: input.workTraceId ?? null,
      rescheduledAt: null,
      rescheduleCount: 0,
      startsAt: input.slot.start,
      endsAt: input.slot.end,
      timezone: "UTC",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async cancelBooking(_bookingId: string, _reason?: string): Promise<void> {
    this.logger.info("NoopCalendarProvider: cancelBooking called — no-op");
  }

  async rescheduleBooking(_bookingId: string, newSlot: TimeSlot): Promise<Booking> {
    this.logger.info("NoopCalendarProvider: rescheduleBooking called — returning stub");
    return {
      id: "",
      contactId: "",
      organizationId: "",
      service: "",
      status: "pending_confirmation",
      calendarEventId: null,
      startsAt: newSlot.start,
      endsAt: newSlot.end,
      timezone: "UTC",
      createdByType: "agent",
      rescheduleCount: 0,
      rescheduledAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async getBooking(_bookingId: string): Promise<Booking | null> {
    return null;
  }

  async healthCheck(): Promise<CalendarHealthCheck> {
    return { status: "disconnected", latencyMs: 0 };
  }
}

export function isNoopCalendarProvider(provider: CalendarProvider): boolean {
  return provider instanceof NoopCalendarProvider;
}
