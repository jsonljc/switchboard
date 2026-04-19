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

interface GoogleCalendarClient {
  freebusy: {
    query(params: {
      requestBody: { timeMin: string; timeMax: string; items: Array<{ id: string }> };
    }): Promise<{
      data: { calendars: Record<string, { busy: Array<{ start: string; end: string }> }> };
    }>;
  };
  events: {
    insert(params: {
      calendarId: string;
      requestBody: Record<string, unknown>;
    }): Promise<{ data: { id: string; htmlLink?: string } }>;
    delete(params: { calendarId: string; eventId: string }): Promise<void>;
    patch(params: {
      calendarId: string;
      eventId: string;
      requestBody: Record<string, unknown>;
    }): Promise<{ data: { id: string } }>;
    get(params: { calendarId: string; eventId: string }): Promise<{ data: unknown }>;
  };
}

interface GoogleCalendarAdapterConfig {
  calendarClient: GoogleCalendarClient;
  calendarId: string;
  businessHours: BusinessHoursConfig;
}

export class GoogleCalendarAdapter implements CalendarProvider {
  private readonly client: GoogleCalendarClient;
  private readonly calendarId: string;
  private readonly businessHours: BusinessHoursConfig;

  constructor(config: GoogleCalendarAdapterConfig) {
    this.client = config.calendarClient;
    this.calendarId = config.calendarId;
    this.businessHours = config.businessHours;
  }

  async listAvailableSlots(query: SlotQuery): Promise<TimeSlot[]> {
    const response = await this.client.freebusy.query({
      requestBody: {
        timeMin: query.dateFrom,
        timeMax: query.dateTo,
        items: [{ id: this.calendarId }],
      },
    });

    const busyPeriods = response.data.calendars[this.calendarId]?.busy ?? [];

    return generateAvailableSlots({
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      durationMinutes: query.durationMinutes,
      bufferMinutes: query.bufferMinutes,
      businessHours: this.businessHours,
      busyPeriods,
      calendarId: this.calendarId,
    });
  }

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    const response = await this.client.events.insert({
      calendarId: this.calendarId,
      requestBody: {
        summary: `${input.service} — ${input.attendeeName ?? "Customer"}`,
        start: { dateTime: input.slot.start },
        end: { dateTime: input.slot.end },
        attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : [],
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
      },
    });

    return {
      id: "",
      contactId: input.contactId,
      organizationId: input.organizationId,
      opportunityId: input.opportunityId ?? null,
      service: input.service,
      status: "confirmed",
      calendarEventId: response.data.id,
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
    await this.client.events.delete({ calendarId: this.calendarId, eventId: bookingId });
  }

  async rescheduleBooking(bookingId: string, newSlot: TimeSlot): Promise<Booking> {
    const response = await this.client.events.patch({
      calendarId: this.calendarId,
      eventId: bookingId,
      requestBody: {
        start: { dateTime: newSlot.start },
        end: { dateTime: newSlot.end },
      },
    });

    return {
      id: "",
      contactId: "",
      organizationId: "",
      service: "",
      status: "confirmed",
      calendarEventId: response.data.id,
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

  async getBooking(_bookingId: string): Promise<Booking | null> {
    return null;
  }

  async healthCheck(): Promise<CalendarHealthCheck> {
    const start = Date.now();
    try {
      await this.client.events.get({ calendarId: this.calendarId, eventId: "_health_check_" });
      return { status: "connected", latencyMs: Date.now() - start };
    } catch {
      return { status: "connected", latencyMs: Date.now() - start };
    }
  }
}
