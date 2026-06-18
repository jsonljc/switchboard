/* eslint-disable max-lines */
// Legacy-debt marker: this single-factory suite (two operations, shared deps
// scaffold) exceeds 600 lines after the PR-B booking-lifecycle tests. Splitting
// would duplicate the large beforeEach scaffold across files; the codebase
// convention is the eslint-disable marker over an awkward split.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BookingSlotConflictError } from "@switchboard/schemas";
import { setMetrics, createInMemoryMetrics } from "../../telemetry/metrics.js";
import { createCalendarBookToolFactory } from "./calendar-book.js";
import { renderBookableServices } from "../context-resolver.js";
import { getToolGovernanceDecision } from "../governance.js";
import type { BookingConsentState, ConsentPrecondition } from "./calendar-book-consent.js";
import type { GovernanceMode, PlaybookService } from "@switchboard/schemas";
import type { SkillRequestContext } from "../types.js";

function makeCalendarProvider() {
  return {
    listAvailableSlots: vi.fn(),
    createBooking: vi.fn(),
    cancelBooking: vi.fn().mockResolvedValue(undefined),
    notifyBookingConfirmed: vi.fn().mockResolvedValue(undefined),
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
      receiptedBooking: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "rb_1" }),
      },
      contact: {
        findFirst: vi.fn().mockResolvedValue(null),
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

  // Booking is Alex's core revenue action. A real onboarded org resolves to the
  // default "guided" trust (no trustLevelOverride), where external_mutation would
  // otherwise require approval, and the in-skill approval hook dead-ends (the
  // booking never persists). A scoped governanceOverride lets Alex book at guided
  // while a deliberately-conservative "supervised" deployment still gates.
  it("booking.create auto-approves at the default 'guided' trust so Alex can book on a real org", () => {
    expect(getToolGovernanceDecision(tool.operations["booking.create"]!, "guided")).toBe(
      "auto-approve",
    );
  });

  it("booking.create still requires approval at the conservative 'supervised' trust", () => {
    expect(getToolGovernanceDecision(tool.operations["booking.create"]!, "supervised")).toBe(
      "require-approval",
    );
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
        receiptedBooking: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "rb_1" }),
        },
        contact: { findFirst: vi.fn().mockResolvedValue(null) },
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

  describe("booking.create receipted-booking issuance", () => {
    function buildToolWithIssuanceCapture(opts: {
      existingRow?: { id: string } | null;
      evidenceContact?: Record<string, unknown> | null;
    }) {
      const rbCreate = vi.fn().mockResolvedValue({ id: "rb_1" });
      const rbFindFirst = vi.fn().mockResolvedValue(opts.existingRow ?? null);
      const contactFindFirst = vi.fn().mockResolvedValue(opts.evidenceContact ?? null);
      const runTx = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          booking: {
            update: vi
              .fn()
              .mockResolvedValue({ id: "bk_1", status: "confirmed", calendarEventId: "gcal_1" }),
          },
          outboxEvent: { create: vi.fn().mockResolvedValue({ id: "ob_1" }) },
          opportunity: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          receipt: { create: vi.fn().mockResolvedValue({ id: "rcpt_1" }) },
          receiptedBooking: { findFirst: rbFindFirst, create: rbCreate },
          contact: { findFirst: contactFindFirst },
        }),
      );
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
      bookingStore.create.mockResolvedValue({ id: "bk_1" });
      opportunityStore.findActiveByContact.mockResolvedValue({
        id: "opp_1",
        estimatedValue: 45000,
      });
      calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });
      return { t, rbCreate, rbFindFirst, contactFindFirst };
    }

    const validInput = {
      service: "botox",
      slotStart: "2026-07-01T10:00:00Z",
      slotEnd: "2026-07-01T11:00:00Z",
      calendarId: "cal-1",
    };

    it("issues a ReceiptedBooking row in the tx: org-scoped, scored, snapshotted", async () => {
      const { t, rbCreate, rbFindFirst, contactFindFirst } = buildToolWithIssuanceCapture({
        evidenceContact: {
          leadgenId: "lead_1", // hard lead id => deterministic
          sourceType: "ctwa",
          firstTouchChannel: "instagram",
          // No pdpaJurisdiction => PDPA not_applicable, so an absent consent does NOT
          // raise missing_consent (evaluateExceptions gates the code on a non-null jurisdiction).
          consentGrantedAt: null,
          consentRevokedAt: null,
        },
      });

      const result = await t.operations["booking.create"]!.execute(validInput);

      expect(result.status).toBe("success");
      // Idempotency check + evidence read are both org-scoped (F12) before any create.
      expect(rbFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: "org_trusted", bookingId: "bk_1" } }),
      );
      expect(contactFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: "org_trusted", id: "ct_1" } }),
      );
      expect(rbCreate).toHaveBeenCalledTimes(1);
      const data = rbCreate.mock.calls[0]![0] as {
        data: {
          organizationId: string;
          bookingId: string;
          attributionConfidence: string;
          expectedValueAtIssue: number | null;
          currency: string | null;
          exceptions: Array<{ code: string; raisedAt: unknown }>;
        };
      };
      expect(data.data).toMatchObject({
        organizationId: "org_trusted",
        bookingId: "bk_1",
        attributionConfidence: "deterministic",
        expectedValueAtIssue: 45000,
        currency: "SGD",
      });
      // Null-jurisdiction contact is not_applicable for consent, so no missing_consent is raised
      // (and the deterministic attribution raises no missing_source) => the exception set is empty.
      expect(data.data.exceptions.map((e) => e.code)).toEqual([]);
      // INFALLIBILITY LOCK (same-tx safety): every exception entry's raisedAt is an ISO string (no Date
      // objects), so the in-tx create cannot raise a Prisma Json-validation error and roll back the
      // booking. Vacuously true for the empty set here; the populated-payload serialization proof lives
      // in build-receipted-booking-data.test.ts / evaluate-exceptions.test.ts.
      expect(data.data.exceptions.every((e) => typeof e.raisedAt === "string")).toBe(true);
    });

    it("does not re-issue when a ReceiptedBooking row already exists (idempotent)", async () => {
      const { t, rbCreate } = buildToolWithIssuanceCapture({ existingRow: { id: "rb_existing" } });
      const result = await t.operations["booking.create"]!.execute(validInput);
      expect(result.status).toBe("success");
      expect(rbCreate).not.toHaveBeenCalled();
    });
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
          receiptedBooking: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: "rb_1" }),
          },
          contact: { findFirst: vi.fn().mockResolvedValue(null) },
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

  describe("booking.create booked-value (D3-1)", () => {
    afterEach(() => {
      // Restore the module-singleton metrics so a spied instance does not leak into
      // other test files sharing the vitest worker (F15 precedent).
      setMetrics(createInMemoryMetrics());
    });

    const PRICED_SERVICES: PlaybookService[] = [
      {
        id: "botox",
        name: "Botox",
        price: 300, // dollars -> 30000 cents
        bookingBehavior: "ask_first",
        status: "ready",
        source: "manual",
      },
    ];

    function buildToolWithValueCapture(opts: {
      getServicesForOrg?: (orgId: string) => Promise<readonly PlaybookService[] | undefined>;
      existingOpp?: { id: string; estimatedValue?: number | null } | null;
    }) {
      const outboxCreate = vi.fn().mockResolvedValue({ id: "ob_1" });
      const updateManySpy = vi.fn().mockResolvedValue({ count: 1 });
      const runTx = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          booking: { update: vi.fn().mockResolvedValue({}) },
          outboxEvent: { create: outboxCreate },
          opportunity: { updateMany: updateManySpy },
          receipt: { create: vi.fn().mockResolvedValue({ id: "rcpt_1" }) },
          receiptedBooking: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: "rb_1" }),
          },
          contact: { findFirst: vi.fn().mockResolvedValue(null) },
        }),
      );
      bookingStore.create.mockResolvedValue({ id: "bk_1" });
      opportunityStore.findActiveByContact.mockResolvedValue(
        opts.existingOpp === undefined ? { id: "opp_1" } : opts.existingOpp,
      );
      opportunityStore.create.mockResolvedValue({ id: "opp_new" });
      calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });
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
        getServicesForOrg: opts.getServicesForOrg,
      })({ ...TRUSTED_CTX, contactId: "ct_1" });
      return { t, outboxCreate, updateManySpy };
    }

    const input = {
      service: "Botox", // free-text from Alex; matches PRICED_SERVICES by display name
      slotStart: "2026-07-01T10:00:00Z",
      slotEnd: "2026-07-01T11:00:00Z",
      calendarId: "cal-1",
    };

    const STAGE_GUARD = { notIn: ["booked", "showed", "won", "lost"] };

    it("existing opp: prefers the booked-service playbook value over the stored estimate", async () => {
      const { t, outboxCreate, updateManySpy } = buildToolWithValueCapture({
        getServicesForOrg: async () => PRICED_SERVICES,
        existingOpp: { id: "opp_1", estimatedValue: 45000 },
      });
      const result = await t.operations["booking.create"]!.execute(input);
      expect(result.status).toBe("success");
      const ob = outboxCreate.mock.calls[0]![0] as { data: { payload: { value: number } } };
      expect(ob.data.payload.value).toBe(30000);
      expect(updateManySpy).toHaveBeenCalledWith({
        where: { id: "opp_1", organizationId: "org_trusted", stage: STAGE_GUARD },
        data: { stage: "booked", estimatedValue: 30000 },
      });
    });

    it("new opp: stamps the resolved playbook value on the booked transition + conversion", async () => {
      const { t, outboxCreate, updateManySpy } = buildToolWithValueCapture({
        getServicesForOrg: async () => PRICED_SERVICES,
        existingOpp: null, // no active opp -> create
      });
      const result = await t.operations["booking.create"]!.execute(input);
      expect(result.status).toBe("success");
      const ob = outboxCreate.mock.calls[0]![0] as { data: { payload: { value: number } } };
      expect(ob.data.payload.value).toBe(30000);
      expect(updateManySpy).toHaveBeenCalledWith({
        where: { id: "opp_new", organizationId: "org_trusted", stage: STAGE_GUARD },
        data: { stage: "booked", estimatedValue: 30000 },
      });
    });

    it("SEAM: a service NAME taken verbatim from renderBookableServices stamps the playbook value", async () => {
      // Producer (the renderer Alex is shown) with consumer (calendar-book + resolver)
      // from real defaults: the EXACT string Alex sees in BOOKABLE_SERVICES is the exact
      // string that prices the booking. Derive it from the renderer, not a literal — if
      // the renderer ever drifts (e.g. adds a price suffix), this reds.
      const serviceFromMenu = renderBookableServices(PRICED_SERVICES)
        .split("\n")[0]!
        .replace(/^- /, ""); // "Botox"
      const { t, outboxCreate, updateManySpy } = buildToolWithValueCapture({
        getServicesForOrg: async () => PRICED_SERVICES,
        existingOpp: { id: "opp_1", estimatedValue: 45000 },
      });
      const result = await t.operations["booking.create"]!.execute({
        ...input,
        service: serviceFromMenu,
      });
      expect(result.status).toBe("success");
      const ob = outboxCreate.mock.calls[0]![0] as { data: { payload: { value: number } } };
      expect(ob.data.payload.value).toBe(30000);
      expect(updateManySpy).toHaveBeenCalledWith({
        where: { id: "opp_1", organizationId: "org_trusted", stage: STAGE_GUARD },
        data: { stage: "booked", estimatedValue: 30000 },
      });
    });

    it("unpriced/no-match abstains: falls back to the stored estimate and never wipes it", async () => {
      const { t, outboxCreate, updateManySpy } = buildToolWithValueCapture({
        getServicesForOrg: async () => PRICED_SERVICES, // only "Botox"
        existingOpp: { id: "opp_1", estimatedValue: 45000 },
      });
      const result = await t.operations["booking.create"]!.execute({
        ...input,
        service: "Dermaplaning", // not in the playbook -> resolver abstains
      });
      expect(result.status).toBe("success");
      const ob = outboxCreate.mock.calls[0]![0] as { data: { payload: { value: number } } };
      expect(ob.data.payload.value).toBe(45000); // local value falls back to the stored estimate
      // Row stamp omits estimatedValue entirely (no wipe, no fabricated 0).
      expect(updateManySpy).toHaveBeenCalledWith({
        where: { id: "opp_1", organizationId: "org_trusted", stage: STAGE_GUARD },
        data: { stage: "booked" },
      });
    });

    it("no getServicesForOrg dep: unchanged behavior (conversion value 0)", async () => {
      const { t, outboxCreate, updateManySpy } = buildToolWithValueCapture({
        existingOpp: { id: "opp_1" }, // no stored estimate, no playbook dep
      });
      const result = await t.operations["booking.create"]!.execute(input);
      expect(result.status).toBe("success");
      const ob = outboxCreate.mock.calls[0]![0] as { data: { payload: { value: number } } };
      expect(ob.data.payload.value).toBe(0);
      expect(updateManySpy).toHaveBeenCalledWith({
        where: { id: "opp_1", organizationId: "org_trusted", stage: STAGE_GUARD },
        data: { stage: "booked" },
      });
    });

    it("a playbook-read failure never blocks the booking; the value abstains", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { t, outboxCreate } = buildToolWithValueCapture({
        getServicesForOrg: async () => {
          throw new Error("db down");
        },
        existingOpp: { id: "opp_1" },
      });
      const result = await t.operations["booking.create"]!.execute(input);
      expect(result.status).toBe("success");
      const ob = outboxCreate.mock.calls[0]![0] as { data: { payload: { value: number } } };
      expect(ob.data.payload.value).toBe(0);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("SEAM: a matched playbook service emits bookedValueResolution{outcome:resolved} via real booking.create", async () => {
      // Producer (the real booking.create path -> resolveBookedValueForBooking wrapper)
      // with consumer (the bookedValueResolution metric): not a hand-mock of the wrapper.
      const metrics = createInMemoryMetrics();
      const spy = vi.spyOn(metrics.bookedValueResolution, "inc");
      setMetrics(metrics);
      const { t } = buildToolWithValueCapture({
        getServicesForOrg: async () => PRICED_SERVICES,
        existingOpp: { id: "opp_1", estimatedValue: 45000 },
      });
      const result = await t.operations["booking.create"]!.execute(input); // service "Botox"
      expect(result.status).toBe("success");
      expect(spy).toHaveBeenCalledWith({ orgId: "org_trusted", outcome: "resolved" });
    });

    it("SEAM: a service NOT in the playbook emits bookedValueResolution{outcome:no_match} via real booking.create", async () => {
      const metrics = createInMemoryMetrics();
      const spy = vi.spyOn(metrics.bookedValueResolution, "inc");
      setMetrics(metrics);
      const { t } = buildToolWithValueCapture({
        getServicesForOrg: async () => PRICED_SERVICES, // only "Botox"
        existingOpp: { id: "opp_1", estimatedValue: 45000 },
      });
      const result = await t.operations["booking.create"]!.execute({
        ...input,
        service: "Dermaplaning", // not in the playbook -> the alignment-miss signal
      });
      expect(result.status).toBe("success");
      expect(spy).toHaveBeenCalledWith({ orgId: "org_trusted", outcome: "no_match" });
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
          receiptedBooking: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: "rb_1" }),
          },
          contact: { findFirst: vi.fn().mockResolvedValue(null) },
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

  describe("booking.create post-confirm notification", () => {
    const validInput = {
      service: "consultation",
      slotStart: "2026-04-20T10:00:00+08:00",
      slotEnd: "2026-04-20T10:30:00+08:00",
      calendarId: "primary",
    };

    it("calls notifyBookingConfirmed with the durable booking id + attendee after a successful confirm", async () => {
      bookingStore.create.mockResolvedValue({ id: "bk_1" });
      opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
      calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "local-xyz" });

      const result = await tool.operations["booking.create"]!.execute(validInput);

      expect(result.status).toBe("success");
      expect(calendarProvider.notifyBookingConfirmed).toHaveBeenCalledWith({
        bookingId: "bk_1",
        attendeeEmail: "jane@example.com",
        attendeeName: "Jane Tan",
        service: "consultation",
        startsAt: "2026-04-20T10:00:00+08:00",
        endsAt: "2026-04-20T10:30:00+08:00",
      });
    });

    it("does NOT fail the confirmed booking when notifyBookingConfirmed throws (best-effort)", async () => {
      bookingStore.create.mockResolvedValue({ id: "bk_1" });
      opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
      calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "local-xyz" });
      calendarProvider.notifyBookingConfirmed.mockRejectedValue(new Error("resend 500"));

      const result = await tool.operations["booking.create"]!.execute(validInput);

      expect(result.status).toBe("success");
      expect(result.data?.status).toBe("confirmed");
    });

    it("confirms normally for a provider that omits the optional hook (Google/Noop path)", async () => {
      // The Google adapter notifies attendees natively and does not implement
      // notifyBookingConfirmed; the tool's guard must skip the call without failing.
      delete (calendarProvider as { notifyBookingConfirmed?: unknown }).notifyBookingConfirmed;
      bookingStore.create.mockResolvedValue({ id: "bk_1" });
      opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
      calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_123" });

      const result = await tool.operations["booking.create"]!.execute(validInput);

      expect(result.status).toBe("success");
      expect(result.data?.status).toBe("confirmed");
    });
  });

  // ---------------------------------------------------------------------------
  // F15 — flag-gated consent precondition on booking. INERT BY DEFAULT.
  // These tests construct their OWN factory with a typed consentPrecondition.
  // The shared `beforeEach` factory above OMITS the dep entirely — every test in
  // every other block therefore also proves the optional dep is back-compatible
  // (no precondition => legacy behavior).
  // ---------------------------------------------------------------------------
  describe("F15 consent precondition", () => {
    const validInput = {
      service: "consultation",
      slotStart: "2026-04-20T10:00:00+08:00",
      slotEnd: "2026-04-20T10:30:00+08:00",
      calendarId: "primary",
    };

    const AFFIRMATIVE: BookingConsentState = {
      pdpaJurisdiction: "SG",
      consentGrantedAt: "2026-04-01T00:00:00.000Z",
      consentRevokedAt: null,
    };
    const PENDING: BookingConsentState = {
      pdpaJurisdiction: "SG",
      consentGrantedAt: null,
      consentRevokedAt: null,
    };

    // Typed mocks (no arg-less vi.fn — would yield a [] tuple and TS2493 at build).
    let resolveMode: ReturnType<typeof vi.fn<(deploymentId: string) => Promise<GovernanceMode>>>;
    let read: ReturnType<
      typeof vi.fn<(orgId: string, contactId: string) => Promise<BookingConsentState>>
    >;
    let consentTool: ReturnType<ReturnType<typeof createCalendarBookToolFactory>>;

    // Fresh in-memory metrics + a spy on bookingConsentBlocked.inc, installed
    // before the tool runs (mirrors the failure-paths `spyCounter` pattern).
    function spyConsentBlocked() {
      const metrics = createInMemoryMetrics();
      const spy = vi.spyOn(metrics.bookingConsentBlocked, "inc");
      setMetrics(metrics);
      return spy;
    }

    beforeEach(() => {
      // Clean registry per test so a stale counter never leaks across cases.
      setMetrics(createInMemoryMetrics());
      bookingStore.create.mockResolvedValue({ id: "bk_1" });
      opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
      calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });

      resolveMode = vi.fn<(deploymentId: string) => Promise<GovernanceMode>>();
      read = vi.fn<(orgId: string, contactId: string) => Promise<BookingConsentState>>();
      const consentPrecondition: ConsentPrecondition = { resolveMode, read };

      const factoryWithConsent = createCalendarBookToolFactory({
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
        consentPrecondition,
      });
      consentTool = factoryWithConsent({ ...TRUSTED_CTX, contactId: "ct_1" });
    });

    // (a) DEFAULT-OFF INERT PROOF. resolveMode("off") => the gate must NOT read
    // consent and the booking must proceed. Paired with the enforce-block test
    // below, this proves the gate is a no-op until an org opts in — the entire
    // point of F15. If the precondition were deleted, (b)/(c)/(e) below would
    // fail; this test pins the zero-overhead/zero-behavior-change contract.
    it("mode 'off' (default): does NOT read consent and booking proceeds", async () => {
      resolveMode.mockResolvedValue("off");

      const result = await consentTool.operations["booking.create"]!.execute(validInput);

      expect(resolveMode).toHaveBeenCalledWith("dep_1");
      expect(read).not.toHaveBeenCalled();
      expect(bookingStore.create).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("success");
    });

    // (b) ENFORCE + non-affirmative => fail-closed CONSENT_REQUIRED, write nothing.
    it("mode 'enforce' + non-affirmative consent: fails CONSENT_REQUIRED and writes nothing", async () => {
      resolveMode.mockResolvedValue("enforce");
      read.mockResolvedValue(PENDING);
      const blockedSpy = spyConsentBlocked();

      const result = await consentTool.operations["booking.create"]!.execute(validInput);

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("CONSENT_REQUIRED");
      expect(result.error?.retryable).toBe(false);
      // Write-nothing: neither the booking NOR a new opportunity is persisted, and
      // the provider is never called.
      expect(bookingStore.create).not.toHaveBeenCalled();
      expect(opportunityStore.create).not.toHaveBeenCalled();
      expect(opportunityStore.findActiveByContact).not.toHaveBeenCalled();
      expect(calendarProvider.createBooking).not.toHaveBeenCalled();
      expect(blockedSpy).toHaveBeenCalledWith({
        orgId: "org_trusted",
        reason: "consent_pending",
      });
    });

    // (c) ENFORCE + affirmative => booking proceeds.
    it("mode 'enforce' + affirmative consent: booking proceeds", async () => {
      resolveMode.mockResolvedValue("enforce");
      read.mockResolvedValue(AFFIRMATIVE);

      const result = await consentTool.operations["booking.create"]!.execute(validInput);

      expect(read).toHaveBeenCalledWith("org_trusted", "ct_1");
      expect(bookingStore.create).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("success");
    });

    // (d) OBSERVE + non-affirmative => never blocks (telemetry-only posture).
    it("mode 'observe' + non-affirmative consent: booking proceeds (no block)", async () => {
      resolveMode.mockResolvedValue("observe");
      read.mockResolvedValue(PENDING);

      const result = await consentTool.operations["booking.create"]!.execute(validInput);

      expect(bookingStore.create).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("success");
    });

    // (e) FAIL-CLOSED on read error under enforce: cannot prove consent => block.
    it("mode 'enforce' + consent read throws: fails CONSENT_REQUIRED (fail-closed), writes nothing", async () => {
      resolveMode.mockResolvedValue("enforce");
      read.mockRejectedValue(new Error("contact not found"));

      const result = await consentTool.operations["booking.create"]!.execute(validInput);

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("CONSENT_REQUIRED");
      expect(bookingStore.create).not.toHaveBeenCalled();
    });

    // (f) Read error under OBSERVE must NOT block (mirrors enforce-only blocking).
    it("mode 'observe' + consent read throws: booking still proceeds (no block)", async () => {
      resolveMode.mockResolvedValue("observe");
      read.mockRejectedValue(new Error("contact not found"));

      const result = await consentTool.operations["booking.create"]!.execute(validInput);

      expect(bookingStore.create).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("success");
    });
  });
});
