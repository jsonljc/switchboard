/* eslint-disable max-lines */
// Legacy-debt marker: this single-factory suite (two operations, shared deps
// scaffold) exceeds 600 lines after the PR-B booking-lifecycle tests. Splitting
// would duplicate the large beforeEach scaffold across files; the codebase
// convention is the eslint-disable marker over an awkward split.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BookingSlotConflictError } from "@switchboard/schemas";
import { setMetrics, createInMemoryMetrics } from "../../telemetry/metrics.js";
import { createCalendarBookToolFactory } from "./calendar-book.js";
import type { SkillRequestContext } from "../types.js";

function makeCalendarProvider() {
  return {
    listAvailableSlots: vi.fn(),
    createBooking: vi.fn(),
    cancelBooking: vi.fn().mockResolvedValue(undefined),
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
      opportunity: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      receipt: {
        create: vi.fn().mockResolvedValue({ id: "rcpt_1" }),
      },
    }),
  );
}

function makeContactStore() {
  return {
    findById: vi.fn().mockResolvedValue({
      id: "ct_1",
      name: "Jane Tan",
      email: "jane@example.com",
      phone: "+6591234567",
    }),
  };
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
  let contactStore: ReturnType<typeof makeContactStore>;
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
    contactStore = makeContactStore();
    factory = createCalendarBookToolFactory({
      calendarProviderFactory: calendarProviderFactory as never,
      isCalendarProviderConfigured: isCalendarProviderConfigured as never,
      bookingStore: bookingStore as never,
      opportunityStore: opportunityStore as never,
      runTransaction: runTransaction as never,
      failureHandler: failureHandler as never,
      contactStore: contactStore as never,
      defaultCurrency: "SGD",
      receiptTierForProvider: () => "T1_FETCH_BACK",
      isProduction: false,
    });
    tool = factory({ ...TRUSTED_CTX, contactId: "ct_1" });
  });

  afterEach(() => {
    // Reset the global metrics registry (exception-safe) — a metric test below
    // points it at a spy; mirrors the outcomePatterns* test convention.
    setMetrics(createInMemoryMetrics());
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
      service: "consultation",
      slotStart: "2026-04-20T10:00:00+08:00",
      slotEnd: "2026-04-20T10:30:00+08:00",
      calendarId: "primary",
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

  it("mints a booked CalendarReceipt in the confirm transaction", async () => {
    const receiptCreateSpy = vi.fn().mockResolvedValue({ id: "rcpt_1" });
    let capturedTx: { receipt: { create: typeof receiptCreateSpy } } | undefined;
    const capturingRunTx = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        booking: {
          update: vi
            .fn()
            .mockResolvedValue({ id: "bk_1", status: "confirmed", calendarEventId: "gcal_1" }),
        },
        outboxEvent: { create: vi.fn().mockResolvedValue({ id: "ob_1" }) },
        opportunity: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        receipt: { create: receiptCreateSpy },
      };
      capturedTx = tx;
      return fn(tx);
    });
    const t = createCalendarBookToolFactory({
      calendarProviderFactory: calendarProviderFactory as never,
      isCalendarProviderConfigured: isCalendarProviderConfigured as never,
      bookingStore: bookingStore as never,
      opportunityStore: opportunityStore as never,
      runTransaction: capturingRunTx as never,
      failureHandler: failureHandler as never,
      contactStore: contactStore as never,
      defaultCurrency: "SGD",
      receiptTierForProvider: () => "T1_FETCH_BACK",
      isProduction: false,
    })({ ...TRUSTED_CTX, contactId: "ct_1" });
    bookingStore.create.mockResolvedValue({ id: "bk_1" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });

    const result = await t.operations["booking.create"]!.execute({
      service: "botox",
      slotStart: "2026-07-01T10:00:00Z",
      slotEnd: "2026-07-01T11:00:00Z",
      calendarId: "cal-1",
    });

    expect(result.status).toBe("success");
    expect(capturedTx).toBeDefined();
    expect(receiptCreateSpy).toHaveBeenCalledTimes(1);
    const arg = receiptCreateSpy.mock.calls[0]![0] as {
      data: { status: string; kind: string; tier: string };
    };
    expect(arg.data.status).toBe("booked");
    expect(arg.data.kind).toBe("calendar");
    expect(arg.data.tier).toBe("T1_FETCH_BACK");
  });

  describe("booking.create opportunity stage advance", () => {
    // Build a tool whose runTransaction exposes the opportunity.updateMany spy
    // (asserts the monotonic stage-advance args / no-op) plus booking-counter
    // spies on a fresh in-memory metrics registry.
    function buildToolWithStageCapture(updateManyResult: { count: number }) {
      const updateManySpy = vi.fn().mockResolvedValue(updateManyResult);
      const runTx = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          booking: { update: vi.fn().mockResolvedValue({}) },
          outboxEvent: { create: vi.fn().mockResolvedValue({ id: "ob_1" }) },
          opportunity: { updateMany: updateManySpy },
          receipt: { create: vi.fn().mockResolvedValue({ id: "rcpt_1" }) },
        }),
      );
      bookingStore.create.mockResolvedValue({ id: "bk_1" });
      opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
      calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });
      const metrics = createInMemoryMetrics();
      const confirmedSpy = vi.spyOn(metrics.bookingConfirmed, "inc");
      const advancedSpy = vi.spyOn(metrics.bookingStageAdvanced, "inc");
      setMetrics(metrics);
      const t = createCalendarBookToolFactory({
        calendarProviderFactory: calendarProviderFactory as never,
        isCalendarProviderConfigured: isCalendarProviderConfigured as never,
        bookingStore: bookingStore as never,
        opportunityStore: opportunityStore as never,
        runTransaction: runTx as never,
        failureHandler: failureHandler as never,
        contactStore: contactStore as never,
        defaultCurrency: "SGD",
        receiptTierForProvider: () => "T1_FETCH_BACK",
        isProduction: false,
      })({ ...TRUSTED_CTX, contactId: "ct_1" });
      return { tool: t, updateManySpy, confirmedSpy, advancedSpy };
    }

    const validInput = {
      service: "consultation",
      slotStart: "2026-04-20T10:00:00+08:00",
      slotEnd: "2026-04-20T10:30:00+08:00",
      calendarId: "primary",
    };

    it("advances opp to booked (monotonic guard) + incs confirmed & stageAdvanced", async () => {
      const {
        tool: t,
        updateManySpy,
        confirmedSpy,
        advancedSpy,
      } = buildToolWithStageCapture({
        count: 1,
      });

      const result = await t.operations["booking.create"]!.execute(validInput);

      expect(result.status).toBe("success");
      expect(updateManySpy).toHaveBeenCalledWith({
        where: {
          id: "opp_1",
          organizationId: "org_trusted",
          stage: { notIn: ["booked", "showed", "won", "lost"] },
        },
        data: { stage: "booked" },
      });
      expect(confirmedSpy).toHaveBeenCalledWith({ orgId: "org_trusted" });
      expect(advancedSpy).toHaveBeenCalledWith({ orgId: "org_trusted" });
    });

    it("does NOT surface a stage-write no-op (count 0) as a failure, and skips stageAdvanced", async () => {
      const { tool: t, confirmedSpy, advancedSpy } = buildToolWithStageCapture({ count: 0 });

      const result = await t.operations["booking.create"]!.execute(validInput);

      expect(result.status).toBe("success");
      expect(confirmedSpy).toHaveBeenCalledWith({ orgId: "org_trusted" });
      expect(advancedSpy).not.toHaveBeenCalled();
    });
  });

  it("booking.create inputSchema omits contactId, attendeeName, attendeeEmail", () => {
    const schema = tool.operations["booking.create"]!.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties).not.toHaveProperty("contactId");
    expect(schema.properties).not.toHaveProperty("attendeeName");
    expect(schema.properties).not.toHaveProperty("attendeeEmail");
    expect(schema.required).not.toContain("contactId");
  });

  it("booking.create uses ctx.contactId (ignores model-supplied) and resolves attendee server-side", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_1" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });
    await tool.operations["booking.create"]!.execute({
      contactId: "ATTACKER",
      service: "botox",
      slotStart: "2026-06-01T10:00:00Z",
      slotEnd: "2026-06-01T10:30:00Z",
      calendarId: "primary",
    });
    expect(bookingStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "ct_1",
        attendeeName: "Jane Tan",
        attendeeEmail: "jane@example.com",
      }),
    );
  });

  it("booking.create passes ctx.workUnitId as workTraceId on the booking row", async () => {
    const toolWithWu = factory({ ...TRUSTED_CTX, contactId: "ct_1", workUnitId: "wu_book_1" });
    bookingStore.create.mockResolvedValue({ id: "bk_1" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });
    await toolWithWu.operations["booking.create"]!.execute({
      service: "botox",
      slotStart: "2026-06-01T10:00:00Z",
      slotEnd: "2026-06-01T10:30:00Z",
      calendarId: "primary",
    });
    expect(bookingStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ workTraceId: "wu_book_1" }),
    );
  });

  it("booking.create passes workTraceId null when ctx.workUnitId is absent", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_1" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });
    await tool.operations["booking.create"]!.execute({
      service: "botox",
      slotStart: "2026-06-01T10:00:00Z",
      slotEnd: "2026-06-01T10:30:00Z",
      calendarId: "primary",
    });
    expect(bookingStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ workTraceId: null }),
    );
  });

  it("booking.create fails closed when ctx.contactId is absent", async () => {
    tool = factory({ ...TRUSTED_CTX, contactId: undefined });
    const result = await tool.operations["booking.create"]!.execute({
      service: "botox",
      slotStart: "2026-06-01T10:00:00Z",
      slotEnd: "2026-06-01T10:30:00Z",
      calendarId: "primary",
    });
    expect(result.status).not.toBe("success");
    expect(bookingStore.create).not.toHaveBeenCalled();
  });

  describe("slots.query schema parse", () => {
    it("applies bufferMinutes default (15) when not supplied in params", async () => {
      let capturedQuery: unknown;
      calendarProvider.listAvailableSlots.mockImplementation(async (query: unknown) => {
        capturedQuery = query;
        return [];
      });

      await tool.operations["slots.query"]!.execute({
        dateFrom: "2026-04-20T00:00:00+08:00",
        dateTo: "2026-04-20T23:59:59+08:00",
        durationMinutes: 30,
        service: "x",
        timezone: "Asia/Singapore",
        // bufferMinutes intentionally omitted
      });

      expect((capturedQuery as { bufferMinutes: number }).bufferMinutes).toBe(15);
    });

    it("returns a recoverable failure (does not throw, does not call provider) on a malformed slots.query", async () => {
      const result = await tool.operations["slots.query"]!.execute({
        dateFrom: "2026-06-02",
        dateTo: "2026-06-05",
        durationMinutes: 0,
        service: "x",
        timezone: "Asia/Singapore",
      });

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("INVALID_SLOT_QUERY");
      expect(result.error?.retryable).toBe(true);
      expect(result.error?.modelRemediation).toMatch(/durationMinutes/);
      expect(calendarProvider.listAvailableSlots).not.toHaveBeenCalled();
    });

    it("increments the slotQueryZeroResult metric when the provider returns an empty array", async () => {
      const metrics = createInMemoryMetrics();
      const incSpy = vi.spyOn(metrics.slotQueryZeroResult, "inc");
      setMetrics(metrics);
      calendarProvider.listAvailableSlots.mockResolvedValue([]);

      await tool.operations["slots.query"]!.execute({
        dateFrom: "2026-04-20T00:00:00+08:00",
        dateTo: "2026-04-20T23:59:59+08:00",
        durationMinutes: 30,
        service: "botox",
        timezone: "Asia/Singapore",
      });

      expect(incSpy).toHaveBeenCalledWith({ orgId: "org_trusted", service: "botox" });
    });
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

  describe("booking.create conversion stamping", () => {
    function buildToolWithCapture(setup: {
      contact: Record<string, unknown> | null;
      opportunity: { id: string; estimatedValue?: number | null } | null;
    }) {
      const captured: { payload?: Record<string, unknown>; eventId?: unknown } = {};
      const runTx = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          booking: { update: vi.fn().mockResolvedValue({}) },
          outboxEvent: {
            create: vi.fn(
              async (args: { data: { eventId: unknown; payload: Record<string, unknown> } }) => {
                captured.eventId = args.data.eventId;
                captured.payload = args.data.payload;
                return { id: "ob_1" };
              },
            ),
          },
          opportunity: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          receipt: { create: vi.fn().mockResolvedValue({ id: "rcpt_1" }) },
        }),
      );
      bookingStore.create.mockResolvedValue({ id: "bk_1" });
      calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });
      const t = createCalendarBookToolFactory({
        calendarProviderFactory: calendarProviderFactory as never,
        isCalendarProviderConfigured: isCalendarProviderConfigured as never,
        bookingStore: bookingStore as never,
        opportunityStore: {
          findActiveByContact: vi.fn().mockResolvedValue(setup.opportunity),
          create: vi.fn().mockResolvedValue({ id: "opp_new" }),
        } as never,
        runTransaction: runTx as never,
        failureHandler: failureHandler as never,
        contactStore: { findById: vi.fn().mockResolvedValue(setup.contact) } as never,
        defaultCurrency: "SGD",
        receiptTierForProvider: () => "T1_FETCH_BACK",
        isProduction: false,
      })({ ...TRUSTED_CTX, contactId: "ct_1" });
      return { tool: t, captured };
    }

    it("stamps attribution, value, currency on the booked event", async () => {
      const { tool: t, captured } = buildToolWithCapture({
        contact: {
          id: "ct_1",
          name: "Jane Tan",
          email: "jane@example.com",
          phone: "+6591234567",
          attribution: {
            fbclid: "fb_abc",
            sourceCampaignId: "camp_1",
            sourceAdId: "ad_1",
            leadgen_id: "lead_9",
          },
        },
        opportunity: { id: "opp_1", estimatedValue: 320000 },
      });

      await t.operations["booking.create"]!.execute({
        service: "botox",
        slotStart: "2026-06-01T10:00:00Z",
        slotEnd: "2026-06-01T10:30:00Z",
        calendarId: "primary",
      });

      expect(captured.payload).toMatchObject({
        type: "booked",
        value: 320000, // cents, verbatim from estimatedValue
        currency: "SGD",
        sourceCampaignId: "camp_1",
        sourceAdId: "ad_1",
        customer: { email: "jane@example.com", phone: "+6591234567" },
        attribution: { fbclid: "fb_abc", lead_id: "lead_9" },
      });
      // No PII leaks into metadata
      expect(captured.payload?.metadata).not.toHaveProperty("email");
      expect(captured.payload?.metadata).not.toHaveProperty("phone");
    });

    it("degrades to explicit nulls + value 0 for an organic contact", async () => {
      const { tool: t, captured } = buildToolWithCapture({
        contact: {
          id: "ct_2",
          name: "Walk In",
          email: "walkin@example.com",
          phone: null,
          attribution: null,
        },
        opportunity: { id: "opp_2", estimatedValue: null },
      });

      await t.operations["booking.create"]!.execute({
        service: "botox",
        slotStart: "2026-06-01T10:00:00Z",
        slotEnd: "2026-06-01T10:30:00Z",
        calendarId: "primary",
      });

      expect(captured.payload).toMatchObject({
        value: 0,
        currency: "SGD",
        sourceCampaignId: null,
        sourceAdId: null,
        customer: { email: "walkin@example.com", phone: null },
        attribution: { fbclid: null, lead_id: null },
      });
    });

    it("uses a deterministic booked eventId (evt_booked_<bookingId>), never a random UUID", async () => {
      const { tool: t, captured } = buildToolWithCapture({
        contact: {
          id: "ct_1",
          name: "Jane",
          email: "jane@example.com",
          phone: "+6591234567",
          attribution: null,
        },
        opportunity: { id: "opp_1", estimatedValue: 1000 },
      });
      await t.operations["booking.create"]!.execute({
        service: "botox",
        slotStart: "2026-06-01T10:00:00Z",
        slotEnd: "2026-06-01T10:30:00Z",
        calendarId: "primary",
      });
      // bookingStore.create in buildToolWithCapture resolves { id: "bk_1" }
      expect(captured.eventId).toBe("evt_booked_bk_1");
    });

    it("stamps booked occurredAt from the external slotStart, not the in-app write clock (clock-game defense)", async () => {
      const { tool: t, captured } = buildToolWithCapture({
        contact: {
          id: "ct_1",
          name: "Jane",
          email: "jane@example.com",
          phone: "+6591234567",
          attribution: null,
        },
        opportunity: { id: "opp_1", estimatedValue: 1000 },
      });
      const slotStart = "2026-06-01T10:00:00.000Z";
      await t.operations["booking.create"]!.execute({
        service: "botox",
        slotStart,
        slotEnd: "2026-06-01T10:30:00Z",
        calendarId: "primary",
      });
      expect(captured.payload?.occurredAt).toBe(slotStart);
    });
  });

  describe("booking.create failure paths", () => {
    it("fails CALENDAR_NOT_CONFIGURED when provider is unconfigured", async () => {
      isCalendarProviderConfigured.mockReturnValue(false);

      const result = await tool.operations["booking.create"]!.execute({
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
        service: "consultation",
        slotStart: "2026-04-20T10:00:00+08:00",
        slotEnd: "2026-04-20T10:30:00+08:00",
        calendarId: "primary",
      });

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("CALENDAR_PROVIDER_ERROR");
      expect(bookingStore.create).not.toHaveBeenCalled();
    });

    const slotInput = {
      service: "consultation",
      slotStart: "2026-04-20T10:00:00+08:00",
      slotEnd: "2026-04-20T10:30:00+08:00",
      calendarId: "primary",
    };

    // Install a fresh in-memory registry and return the `inc` spy for one counter.
    function spyCounter(key: "bookingSlotConflict" | "bookingFailed") {
      const metrics = createInMemoryMetrics();
      const spy = vi.spyOn(metrics[key], "inc");
      setMetrics(metrics);
      return spy;
    }

    it("maps a BookingSlotConflictError to a retryable SLOT_TAKEN re-offer", async () => {
      opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
      bookingStore.create.mockRejectedValue(new BookingSlotConflictError("bk-x"));
      const conflictSpy = spyCounter("bookingSlotConflict");

      const result = await tool.operations["booking.create"]!.execute(slotInput);

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("SLOT_TAKEN");
      expect(result.error?.retryable).toBe(true);
      expect(result.data?.failureType).toBe("slot_conflict");
      expect(conflictSpy).toHaveBeenCalledWith({ orgId: "org_trusted" });
      expect(calendarProvider.createBooking).not.toHaveBeenCalled();
    });

    it("best-effort cancels the created calendar event when the confirm tx fails (no orphan)", async () => {
      bookingStore.create.mockResolvedValue({ id: "bk_1" });
      opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
      calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "evt-1" });
      runTransaction.mockRejectedValue(new Error("DB connection lost"));

      const result = await tool.operations["booking.create"]!.execute(slotInput);

      expect(result.status).toBe("error");
      expect(calendarProvider.cancelBooking).toHaveBeenCalledWith("evt-1");
    });

    // bookingFailed is stamped with a reason on each non-conflict failure leg.
    it.each([
      [
        "confirmation_failed",
        () => {
          bookingStore.create.mockResolvedValue({ id: "bk_1" });
          opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
          calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "evt-1" });
          runTransaction.mockRejectedValue(new Error("DB connection lost"));
        },
      ],
      [
        "provider_error",
        () => {
          bookingStore.create.mockResolvedValue({ id: "bk_1" });
          opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
          calendarProvider.createBooking.mockRejectedValue(new Error("503"));
        },
      ],
      [
        "duplicate",
        () => {
          bookingStore.create.mockRejectedValue(Object.assign(new Error("u"), { code: "P2002" }));
          bookingStore.findBySlot.mockResolvedValue({ id: "bk_existing" });
          opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
        },
      ],
    ])("increments bookingFailed{reason:%s}", async (reason, arrange) => {
      arrange();
      const failedSpy = spyCounter("bookingFailed");

      await tool.operations["booking.create"]!.execute(slotInput);

      expect(failedSpy).toHaveBeenCalledWith({ orgId: "org_trusted", reason });
    });
  });
});
