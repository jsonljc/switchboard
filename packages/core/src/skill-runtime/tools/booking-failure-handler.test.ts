import { describe, it, expect, vi, beforeEach } from "vitest";
import { BookingFailureHandler } from "./booking-failure-handler.js";
import type { BookingFailureInput } from "./booking-failure-handler.js";

function makeRunTransaction() {
  const created: Record<string, unknown>[] = [];
  return {
    fn: vi.fn(
      async (
        fn: (tx: {
          booking: { update: (...args: unknown[]) => Promise<unknown> };
          escalationRecord: { create: (...args: unknown[]) => Promise<unknown> };
          outboxEvent: { create: (...args: unknown[]) => Promise<unknown> };
        }) => Promise<unknown>,
      ) =>
        fn({
          booking: {
            update: vi.fn().mockResolvedValue({ id: "bk_1", status: "failed" }),
          },
          escalationRecord: {
            create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
              const record = { id: "esc_1", ...args.data };
              created.push(record);
              return Promise.resolve(record);
            }),
          },
          outboxEvent: {
            create: vi.fn().mockResolvedValue({ id: "ob_1" }),
          },
        }),
    ),
    created,
  };
}

function makeBookingStore() {
  return {
    findById: vi.fn(),
  };
}

function makeEscalationLookup() {
  return {
    findByBookingId: vi.fn(),
  };
}

function makeInput(overrides: Partial<BookingFailureInput> = {}): BookingFailureInput {
  return {
    bookingId: "bk_1",
    orgId: "org_1",
    contactId: "ct_1",
    service: "consultation",
    provider: "google_calendar",
    error: new Error("503 Service Unavailable"),
    failureType: "provider_error",
    retryable: false,
    ...overrides,
  };
}

describe("BookingFailureHandler", () => {
  let txHelper: ReturnType<typeof makeRunTransaction>;
  let bookingStore: ReturnType<typeof makeBookingStore>;
  let escalationLookup: ReturnType<typeof makeEscalationLookup>;
  let handler: BookingFailureHandler;

  beforeEach(() => {
    txHelper = makeRunTransaction();
    bookingStore = makeBookingStore();
    escalationLookup = makeEscalationLookup();
    bookingStore.findById.mockResolvedValue({ id: "bk_1", status: "pending_confirmation" });
    escalationLookup.findByBookingId.mockResolvedValue(null);
    handler = new BookingFailureHandler({
      runTransaction: txHelper.fn as never,
      bookingStore: bookingStore as never,
      escalationLookup: escalationLookup as never,
    });
  });

  it("marks booking as failed and creates escalation + outbox event", async () => {
    const result = await handler.handle(makeInput());

    expect(result.status).toBe("failed");
    expect(result.bookingId).toBe("bk_1");
    expect(result.escalationId).toBe("esc_1");
    expect(result.failureType).toBe("provider_error");
    expect(result.retryable).toBe(false);

    // Verify transaction was called (booking update + escalation + outbox)
    expect(txHelper.fn).toHaveBeenCalledTimes(1);

    // Booking must NOT remain pending_confirmation
    const txFn = txHelper.fn.mock.calls[0]![0] as (tx: unknown) => Promise<unknown>;
    const mockTx = {
      booking: { update: vi.fn().mockResolvedValue({ id: "bk_1", status: "failed" }) },
      escalationRecord: {
        create: vi.fn().mockResolvedValue({ id: "esc_1" }),
      },
      outboxEvent: { create: vi.fn().mockResolvedValue({ id: "ob_1" }) },
    };
    await txFn(mockTx);
    expect(mockTx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bk_1" },
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("is idempotent — returns existing escalation without duplicates", async () => {
    // First call: booking is pending
    bookingStore.findById.mockResolvedValue({ id: "bk_1", status: "pending_confirmation" });
    escalationLookup.findByBookingId.mockResolvedValue(null);
    await handler.handle(makeInput());

    // Second call: booking is already failed, escalation exists
    bookingStore.findById.mockResolvedValue({ id: "bk_1", status: "failed" });
    escalationLookup.findByBookingId.mockResolvedValue({
      id: "esc_1",
      reason: "booking_failure",
    });
    const result2 = await handler.handle(makeInput());

    expect(result2.escalationId).toBe("esc_1");
    expect(result2.status).toBe("failed");
    // Transaction should NOT be called on second invocation
    expect(txHelper.fn).toHaveBeenCalledTimes(1);
  });

  it("includes structured metadata in escalation record", async () => {
    await handler.handle(makeInput());

    const txCall = txHelper.fn.mock.calls[0]![0] as (tx: unknown) => Promise<unknown>;
    const createCalls: { data: Record<string, unknown> }[] = [];
    const mockTx = {
      booking: { update: vi.fn().mockResolvedValue({}) },
      escalationRecord: {
        create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
          createCalls.push(args);
          return Promise.resolve({ id: "esc_1" });
        }),
      },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    await txCall(mockTx);

    const escalationData = createCalls[0]!.data;
    expect(escalationData.reason).toBe("booking_failure");
    expect(escalationData.sourceAgent).toBe("alex");
    expect(escalationData.priority).toBe("high");

    const metadata = escalationData.metadata as Record<string, unknown>;
    expect(metadata.bookingId).toBe("bk_1");
    expect(metadata.provider).toBe("google_calendar");
    expect(metadata.failureType).toBe("provider_error");
    expect(metadata.retryable).toBe(false);
  });

  it("message is LLM-safe — does not leak raw error text", async () => {
    const result = await handler.handle(
      makeInput({
        error: new Error("GOOGLE_API_KEY=sk-123abc leaked credential in stack trace"),
      }),
    );

    expect(result.message).toBe(
      "I couldn't complete the booking just now. I've flagged this for a human to follow up.",
    );
    expect(result.message).not.toContain("GOOGLE_API_KEY");
    expect(result.message).not.toContain("sk-123abc");
    expect(result.message).not.toContain("stack trace");
  });
});
