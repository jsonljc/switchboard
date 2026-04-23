import { randomUUID } from "node:crypto";
import type {
  CalendarProvider,
  SlotQuery,
  TimeSlot,
  CreateBookingInput,
  Booking,
  CalendarHealthCheck,
  BusinessHoursConfig,
} from "@switchboard/schemas";
import { generateAvailableSlots } from "./slot-generator.js";

export interface LocalBookingStore {
  findOverlapping(
    orgId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<Array<{ startsAt: Date; endsAt: Date }>>;
  createInTransaction(input: {
    organizationId: string;
    contactId: string;
    opportunityId?: string | null;
    service: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    status: string;
    calendarEventId: string;
    attendeeName?: string | null;
    attendeeEmail?: string | null;
    createdByType: string;
    sourceChannel?: string | null;
    workTraceId?: string | null;
  }): Promise<{ id: string }>;
  findById(bookingId: string): Promise<Booking | null>;
  cancel(bookingId: string): Promise<void>;
  reschedule(bookingId: string, newSlot: { start: string; end: string }): Promise<{ id: string }>;
}

interface LocalCalendarProviderConfig {
  businessHours: BusinessHoursConfig;
  bookingStore: LocalBookingStore;
}

export class LocalCalendarProvider implements CalendarProvider {
  private readonly businessHours: BusinessHoursConfig;
  private readonly store: LocalBookingStore;

  constructor(config: LocalCalendarProviderConfig) {
    this.businessHours = config.businessHours;
    this.store = config.bookingStore;
  }

  async listAvailableSlots(query: SlotQuery): Promise<TimeSlot[]> {
    const existingBookings = await this.store.findOverlapping(
      "",
      new Date(query.dateFrom),
      new Date(query.dateTo),
    );
    const busyPeriods = existingBookings.map((b) => ({
      start: b.startsAt.toISOString(),
      end: b.endsAt.toISOString(),
    }));
    return generateAvailableSlots({
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      durationMinutes: query.durationMinutes,
      bufferMinutes: query.bufferMinutes,
      businessHours: this.businessHours,
      busyPeriods,
      calendarId: "local",
    });
  }

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    const calendarEventId = `local-${randomUUID()}`;
    const result = await this.store.createInTransaction({
      organizationId: input.organizationId,
      contactId: input.contactId,
      opportunityId: input.opportunityId ?? null,
      service: input.service,
      startsAt: new Date(input.slot.start),
      endsAt: new Date(input.slot.end),
      timezone: "Asia/Singapore",
      status: "confirmed",
      calendarEventId,
      attendeeName: input.attendeeName ?? null,
      attendeeEmail: input.attendeeEmail ?? null,
      createdByType: input.createdByType ?? "agent",
      sourceChannel: input.sourceChannel ?? null,
      workTraceId: input.workTraceId ?? null,
    });
    return {
      id: result.id,
      contactId: input.contactId,
      organizationId: input.organizationId,
      opportunityId: input.opportunityId ?? null,
      service: input.service,
      status: "confirmed",
      calendarEventId,
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
      timezone: "Asia/Singapore",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async cancelBooking(bookingId: string, _reason?: string): Promise<void> {
    await this.store.cancel(bookingId);
  }

  async rescheduleBooking(bookingId: string, newSlot: TimeSlot): Promise<Booking> {
    const result = await this.store.reschedule(bookingId, {
      start: newSlot.start,
      end: newSlot.end,
    });
    return {
      id: result.id,
      contactId: "",
      organizationId: "",
      service: "",
      status: "confirmed",
      calendarEventId: null,
      startsAt: newSlot.start,
      endsAt: newSlot.end,
      timezone: "Asia/Singapore",
      createdByType: "agent",
      rescheduleCount: 0,
      rescheduledAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async getBooking(bookingId: string): Promise<Booking | null> {
    return this.store.findById(bookingId);
  }

  async healthCheck(): Promise<CalendarHealthCheck> {
    return { status: "degraded", latencyMs: 0 };
  }
}
