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

export interface BookingConfirmationEmail {
  to: string;
  attendeeName: string | null;
  service: string;
  startsAt: string;
  endsAt: string;
  bookingId: string;
}

export type EmailSender = (email: BookingConfirmationEmail) => Promise<void>;

export interface LocalBookingStore {
  findOverlapping(startsAt: Date, endsAt: Date): Promise<Array<{ startsAt: Date; endsAt: Date }>>;
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
  emailSender?: EmailSender;
  onSendFailure?: (info: { bookingId: string; error: string }) => void;
}

export class LocalCalendarProvider implements CalendarProvider {
  private readonly businessHours: BusinessHoursConfig;
  private readonly store: LocalBookingStore;
  private readonly emailSender?: EmailSender;
  private readonly onSendFailure?: (info: { bookingId: string; error: string }) => void;

  constructor(config: LocalCalendarProviderConfig) {
    this.businessHours = config.businessHours;
    this.store = config.bookingStore;
    this.emailSender = config.emailSender;
    this.onSendFailure = config.onSendFailure;
  }

  async listAvailableSlots(query: SlotQuery): Promise<TimeSlot[]> {
    const existingBookings = await this.store.findOverlapping(
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

    // Send confirmation email (best-effort, non-blocking)
    if (this.emailSender && input.attendeeEmail) {
      try {
        await this.emailSender({
          to: input.attendeeEmail,
          attendeeName: input.attendeeName ?? null,
          service: input.service,
          startsAt: input.slot.start,
          endsAt: input.slot.end,
          bookingId: result.id,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[LocalCalendarProvider] Email confirmation failed: ${msg}`);
        if (this.onSendFailure) {
          this.onSendFailure({ bookingId: result.id, error: msg });
        }
      }
    }

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

  async cancelBooking(_calendarEventId: string, _reason?: string): Promise<void> {
    // No-op. The durable booking store (PrismaBookingStore.cancel, org-scoped +
    // count===0 guarded) is the single writer that cancels the row, and runs as the
    // caller's FIRST step. A local (DB-backed) calendar has no external event to delete,
    // so there is nothing to do here.
  }

  async rescheduleBooking(calendarEventId: string, newSlot: TimeSlot): Promise<Booking> {
    // No-op move. For a local (DB-backed) calendar there is no external event to patch:
    // the durable booking store (PrismaBookingStore.reschedule, advisory-locked +
    // overlap-guarded + org-scoped, throwing the typed BookingSlotConflictError) owns the
    // row mutation and runs as the caller's second step. Return a sparse Booking echoing
    // the requested slot, mirroring GoogleCalendarAdapter.rescheduleBooking; the caller
    // (calendar-reschedule tool) discards this return and treats the durable write as
    // authoritative.
    return {
      id: "",
      contactId: "",
      organizationId: "",
      service: "",
      status: "confirmed",
      calendarEventId,
      attendeeName: null,
      attendeeEmail: null,
      notes: null,
      createdByType: "agent",
      sourceChannel: null,
      workTraceId: null,
      opportunityId: null,
      startsAt: newSlot.start,
      endsAt: newSlot.end,
      timezone: this.businessHours.timezone,
      rescheduleCount: 0,
      rescheduledAt: null,
      createdAt: new Date().toISOString(),
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
