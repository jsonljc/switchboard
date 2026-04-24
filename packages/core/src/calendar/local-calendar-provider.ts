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
      timezone: this.businessHours.timezone,
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
      timezone: this.businessHours.timezone,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async cancelBooking(bookingId: string, _reason?: string): Promise<void> {
    await this.store.cancel(bookingId);
  }

  async rescheduleBooking(bookingId: string, newSlot: TimeSlot): Promise<Booking> {
    const existing = await this.store.findById(bookingId);
    const result = await this.store.reschedule(bookingId, {
      start: newSlot.start,
      end: newSlot.end,
    });
    return {
      id: result.id,
      contactId: existing?.contactId ?? "",
      organizationId: existing?.organizationId ?? "",
      service: existing?.service ?? "",
      status: "confirmed",
      calendarEventId: existing?.calendarEventId ?? null,
      attendeeName: existing?.attendeeName ?? null,
      attendeeEmail: existing?.attendeeEmail ?? null,
      notes: existing?.notes ?? null,
      createdByType: existing?.createdByType ?? "agent",
      sourceChannel: existing?.sourceChannel ?? null,
      workTraceId: existing?.workTraceId ?? null,
      opportunityId: existing?.opportunityId ?? null,
      startsAt: newSlot.start,
      endsAt: newSlot.end,
      timezone: this.businessHours.timezone,
      rescheduleCount: (existing?.rescheduleCount ?? 0) + 1,
      rescheduledAt: new Date().toISOString(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async getBooking(bookingId: string): Promise<Booking | null> {
    return this.store.findById(bookingId);
  }

  async healthCheck(): Promise<CalendarHealthCheck> {
    return { status: "connected", latencyMs: 0 };
  }
}
