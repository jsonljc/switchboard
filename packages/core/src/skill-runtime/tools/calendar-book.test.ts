import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCalendarBookToolFactory } from "./calendar-book.js";
import type { SkillRequestContext } from "../types.js";

function makeCalendarProvider() {
  return {
    listAvailableSlots: vi.fn(),
    createBooking: vi.fn(),
  };
}

function makeBookingStore() {
  return {
    create: vi.fn(),
    findBySlot: vi.fn(),
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
    handle: vi.fn().mockResolvedValue({
      bookingId: "bk_1",
      status: "failed",
      failureType: "provider_error",
      retryable: false,
      escalationId: "esc_1",
      message:
        "I couldn't complete the booking just now. I've flagged this for a human to follow up.",
    }),
  };
}

const TRUSTED_CTX: SkillRequestContext = {
  sessionId: "sess_1",
  orgId: "org_trusted",
  deploymentId: "dep_1",
};

describe("createCalendarBookToolFactory", () => {
  let calendarProvider: ReturnType<typeof makeCalendarProvider>;
  let calendarProviderFactory: ReturnType<typeof vi.fn>;
  let isCalendarProviderConfigured: ReturnType<typeof vi.fn>;
  let bookingStore: ReturnType<typeof makeBookingStore>;
  let opportunityStore: ReturnType<typeof makeOpportunityStore>;
  let runTransaction: ReturnType<typeof makeRunTransaction>;
  let failureHandler: ReturnType<typeof makeFailureHandler>;
  let factory: ReturnType<typeof createCalendarBookToolFactory>;
  let tool: ReturnType<typeof factory>;

  beforeEach(() => {
    calendarProvider = makeCalendarProvider();
    calendarProviderFactory = vi.fn(async (_orgId: string) => calendarProvider as never);
    isCalendarProviderConfigured = vi.fn(() => true);
    bookingStore = makeBookingStore();
    opportunityStore = makeOpportunityStore();
    runTransaction = makeRunTransaction();
    failureHandler = makeFailureHandler();
    factory = createCalendarBookToolFactory({
      calendarProviderFactory: calendarProviderFactory as never,
      isCalendarProviderConfigured: isCalendarProviderConfigured as never,
      bookingStore: bookingStore as never,
      opportunityStore: opportunityStore as never,
      runTransaction: runTransaction as never,
      failureHandler: failureHandler as never,
    });
    tool = factory(TRUSTED_CTX);
  });

  it("has id 'calendar-book'", () => {
    expect(tool.id).toBe("calendar-book");
  });

  it("slots.query has governance tier 'read'", () => {
    expect(tool.operations["slots.query"]!.effectCategory).toBe("read");
  });

  it("booking.create has governance tier 'external_mutation'", () => {
    expect(tool.operations["booking.create"]!.effectCategory).toBe("external_mutation");
  });

  it("slots.query is idempotent", () => {
    expect(tool.operations["slots.query"]!.idempotent).toBe(true);
  });

  it("booking.create is idempotent", () => {
    expect(tool.operations["booking.create"]!.idempotent).toBe(true);
  });

  it("slots.query inputSchema does NOT contain orgId", () => {
    const schema = tool.operations["slots.query"]!.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties).not.toHaveProperty("orgId");
    expect(schema.required).not.toContain("orgId");
  });

  it("booking.create inputSchema does NOT contain orgId", () => {
    const schema = tool.operations["booking.create"]!.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties).not.toHaveProperty("orgId");
    expect(schema.required).not.toContain("orgId");
  });

  it("slots.query delegates to calendarProvider using ctx.orgId", async () => {
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
    expect(calendarProviderFactory).toHaveBeenCalledWith("org_trusted");
    expect(result.status).toBe("success");
    expect(result.data?.slots).toEqual(mockSlots);
  });

  it("ignores LLM-supplied orgId and uses ctx.orgId (AI-1 hardening)", async () => {
    calendarProvider.listAvailableSlots.mockResolvedValue([]);

    await tool.operations["slots.query"]!.execute({
      orgId: "evil-org",
      dateFrom: "2026-04-20T00:00:00+08:00",
      dateTo: "2026-04-20T23:59:59+08:00",
      durationMinutes: 30,
      service: "consultation",
      timezone: "Asia/Singapore",
    });

    expect(calendarProviderFactory).toHaveBeenCalledWith("org_trusted");
    expect(calendarProviderFactory).not.toHaveBeenCalledWith("evil-org");
  });

  it("booking.create uses ctx.orgId for store calls (LLM cannot override)", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_1", status: "pending_confirmation" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockResolvedValue({
      calendarEventId: "gcal_123",
      status: "confirmed",
    });

    const result = await tool.operations["booking.create"]!.execute({
      orgId: "evil-org", // attempt to spoof — must be ignored
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
        organizationId: "org_trusted",
        contactId: "ct_1",
        service: "consultation",
      }),
    );
    expect(opportunityStore.findActiveByContact).toHaveBeenCalledWith("org_trusted", "ct_1");
    expect(calendarProviderFactory).toHaveBeenCalledWith("org_trusted");
    expect(calendarProvider.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_trusted" }),
    );
    expect(runTransaction).toHaveBeenCalled();
    expect(result.status).toBe("success");
  });

  it("booking.create creates opportunity if none exists for contact", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_1" });
    opportunityStore.findActiveByContact.mockResolvedValue(null);
    opportunityStore.create.mockResolvedValue({ id: "opp_new" });
    calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });

    await tool.operations["booking.create"]!.execute({
      contactId: "ct_1",
      service: "consultation",
      slotStart: "2026-04-20T10:00:00+08:00",
      slotEnd: "2026-04-20T10:30:00+08:00",
      calendarId: "primary",
    });

    expect(opportunityStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_trusted", contactId: "ct_1" }),
    );
  });

  it("returns existing booking ID on duplicate", async () => {
    const p2002Error = Object.assign(new Error("Unique constraint"), { code: "P2002" });
    bookingStore.create.mockRejectedValue(p2002Error);
    bookingStore.findBySlot.mockResolvedValue({ id: "bk_existing" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });

    const result = await tool.operations["booking.create"]!.execute({
      contactId: "ct_1",
      service: "consultation",
      slotStart: "2026-04-20T10:00:00+08:00",
      slotEnd: "2026-04-20T10:30:00+08:00",
      calendarId: "primary",
    });

    expect(result.status).toBe("error");
    expect(result.data?.status).toBe("duplicate");
    expect(result.data?.existingBookingId).toBe("bk_existing");
    expect(result.data?.failureType).toBe("duplicate_booking");
    expect(calendarProvider.createBooking).not.toHaveBeenCalled();
  });

  it("delegates to failure handler when calendar provider throws", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_1" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockRejectedValue(new Error("503 Service Unavailable"));

    const result = await tool.operations["booking.create"]!.execute({
      contactId: "ct_1",
      service: "consultation",
      slotStart: "2026-04-20T10:00:00+08:00",
      slotEnd: "2026-04-20T10:30:00+08:00",
      calendarId: "primary",
    });

    expect(result.status).toBe("error");
    expect(result.data?.escalationId).toBe("esc_1");
    expect(failureHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "bk_1",
        failureType: "provider_error",
        retryable: false,
        orgId: "org_trusted",
      }),
    );
  });

  it("delegates to failure handler when confirm transaction fails", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_1" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_123" });
    runTransaction.mockRejectedValue(new Error("DB connection lost"));

    failureHandler.handle.mockResolvedValue({
      bookingId: "bk_1",
      status: "failed",
      failureType: "confirmation_failed",
      retryable: true,
      escalationId: "esc_2",
      message:
        "I couldn't complete the booking just now. I've flagged this for a human to follow up.",
    });

    const result = await tool.operations["booking.create"]!.execute({
      contactId: "ct_1",
      service: "consultation",
      slotStart: "2026-04-20T10:00:00+08:00",
      slotEnd: "2026-04-20T10:30:00+08:00",
      calendarId: "primary",
    });

    expect(result.status).toBe("error");
    expect(result.data?.failureType).toBe("confirmation_failed");
    expect(result.data?.retryable).toBe(true);
    expect(failureHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        failureType: "confirmation_failed",
        retryable: true,
      }),
    );
  });

  describe("slots.query failure paths", () => {
    it("fails CALENDAR_NOT_CONFIGURED when provider is unconfigured (no slots leak)", async () => {
      isCalendarProviderConfigured.mockReturnValue(false);

      const result = await tool.operations["slots.query"]!.execute({
        dateFrom: "2026-04-20T00:00:00+08:00",
        dateTo: "2026-04-20T23:59:59+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
      });

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("CALENDAR_NOT_CONFIGURED");
      expect(result.error?.modelRemediation).toMatch(/Escalate to the operator/);
      expect(result.data?.slots).toBeUndefined();
      expect(calendarProvider.listAvailableSlots).not.toHaveBeenCalled();
    });

    it("fails CALENDAR_PROVIDER_ERROR when factory rejects", async () => {
      calendarProviderFactory.mockRejectedValue(new Error("Boom"));

      const result = await tool.operations["slots.query"]!.execute({
        dateFrom: "2026-04-20T00:00:00+08:00",
        dateTo: "2026-04-20T23:59:59+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
      });

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("CALENDAR_PROVIDER_ERROR");
      expect(calendarProvider.listAvailableSlots).not.toHaveBeenCalled();
    });
  });

  describe("booking.create failure paths", () => {
    it("fails CALENDAR_NOT_CONFIGURED when provider is unconfigured", async () => {
      isCalendarProviderConfigured.mockReturnValue(false);

      const result = await tool.operations["booking.create"]!.execute({
        contactId: "ct_1",
        service: "consultation",
        slotStart: "2026-04-20T10:00:00+08:00",
        slotEnd: "2026-04-20T10:30:00+08:00",
        calendarId: "primary",
      });

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("CALENDAR_NOT_CONFIGURED");
      expect(result.error?.modelRemediation).toMatch(/Escalate to the operator/);
      expect(bookingStore.create).not.toHaveBeenCalled();
      expect(calendarProvider.createBooking).not.toHaveBeenCalled();
    });

    it("fails CALENDAR_PROVIDER_ERROR when factory rejects", async () => {
      calendarProviderFactory.mockRejectedValue(new Error("Boom"));

      const result = await tool.operations["booking.create"]!.execute({
        contactId: "ct_1",
        service: "consultation",
        slotStart: "2026-04-20T10:00:00+08:00",
        slotEnd: "2026-04-20T10:30:00+08:00",
        calendarId: "primary",
      });

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("CALENDAR_PROVIDER_ERROR");
      expect(bookingStore.create).not.toHaveBeenCalled();
    });
  });
});
