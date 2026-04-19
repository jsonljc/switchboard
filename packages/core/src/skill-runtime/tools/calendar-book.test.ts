import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCalendarBookTool } from "./calendar-book.js";

function makeCalendarProvider() {
  return {
    listAvailableSlots: vi.fn(),
    createBooking: vi.fn(),
  };
}

function makeBookingStore() {
  return {
    create: vi.fn(),
  };
}

function makeOpportunityStore() {
  return {
    findActiveByContact: vi.fn(),
    create: vi.fn(),
  };
}

function makeRunTransaction() {
  return vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      booking: {
        update: vi
          .fn()
          .mockResolvedValue({ id: "bk_1", status: "confirmed", calendarEventId: "gcal_1" }),
      },
      outboxEvent: {
        create: vi.fn().mockResolvedValue({ id: "ob_1" }),
      },
    }),
  );
}

function makeFailureHandler() {
  return {
    handle: vi.fn(),
  };
}

describe("createCalendarBookTool", () => {
  let calendarProvider: ReturnType<typeof makeCalendarProvider>;
  let bookingStore: ReturnType<typeof makeBookingStore>;
  let opportunityStore: ReturnType<typeof makeOpportunityStore>;
  let runTransaction: ReturnType<typeof makeRunTransaction>;
  let failureHandler: ReturnType<typeof makeFailureHandler>;
  let tool: ReturnType<typeof createCalendarBookTool>;

  beforeEach(() => {
    calendarProvider = makeCalendarProvider();
    bookingStore = makeBookingStore();
    opportunityStore = makeOpportunityStore();
    runTransaction = makeRunTransaction();
    failureHandler = makeFailureHandler();
    tool = createCalendarBookTool({
      calendarProvider: calendarProvider as never,
      bookingStore: bookingStore as never,
      opportunityStore: opportunityStore as never,
      runTransaction: runTransaction as never,
      failureHandler: failureHandler as never,
    });
  });

  it("has id 'calendar-book'", () => {
    expect(tool.id).toBe("calendar-book");
  });

  it("slots.query has governance tier 'read'", () => {
    expect(tool.operations["slots.query"]!.governanceTier).toBe("read");
  });

  it("booking.create has governance tier 'external_write'", () => {
    expect(tool.operations["booking.create"]!.governanceTier).toBe("external_write");
  });

  it("slots.query is idempotent", () => {
    expect(tool.operations["slots.query"]!.idempotent).toBe(true);
  });

  it("booking.create is idempotent", () => {
    expect(tool.operations["booking.create"]!.idempotent).toBe(true);
  });

  it("slots.query delegates to calendarProvider", async () => {
    const mockSlots = [
      {
        start: "2026-04-20T10:00:00+08:00",
        end: "2026-04-20T10:30:00+08:00",
        calendarId: "primary",
        available: true,
      },
    ];
    calendarProvider.listAvailableSlots.mockResolvedValue(mockSlots);

    const result = await tool.operations["slots.query"]!.execute({
      dateFrom: "2026-04-20T00:00:00+08:00",
      dateTo: "2026-04-20T23:59:59+08:00",
      durationMinutes: 30,
      service: "consultation",
      timezone: "Asia/Singapore",
    });

    expect(calendarProvider.listAvailableSlots).toHaveBeenCalled();
    expect(result).toEqual(mockSlots);
  });

  it("booking.create persists pending booking, calls calendar, then runs transaction", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_1", status: "pending_confirmation" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockResolvedValue({
      calendarEventId: "gcal_123",
      status: "confirmed",
    });

    const result = await tool.operations["booking.create"]!.execute({
      orgId: "org_1",
      contactId: "ct_1",
      service: "consultation",
      slotStart: "2026-04-20T10:00:00+08:00",
      slotEnd: "2026-04-20T10:30:00+08:00",
      calendarId: "primary",
      attendeeName: "Alice",
      attendeeEmail: "alice@example.com",
    });

    expect(bookingStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        contactId: "ct_1",
        service: "consultation",
      }),
    );
    expect(calendarProvider.createBooking).toHaveBeenCalled();
    expect(runTransaction).toHaveBeenCalled();
    expect((result as Record<string, unknown>).status).toBe("confirmed");
  });

  it("booking.create creates opportunity if none exists for contact", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_1" });
    opportunityStore.findActiveByContact.mockResolvedValue(null);
    opportunityStore.create.mockResolvedValue({ id: "opp_new" });
    calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });

    await tool.operations["booking.create"]!.execute({
      orgId: "org_1",
      contactId: "ct_1",
      service: "consultation",
      slotStart: "2026-04-20T10:00:00+08:00",
      slotEnd: "2026-04-20T10:30:00+08:00",
      calendarId: "primary",
    });

    expect(opportunityStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", contactId: "ct_1" }),
    );
  });
});
