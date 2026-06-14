import { describe, it, expect, vi } from "vitest";
import type { RevenueStore } from "@switchboard/core";
import type { LifecycleRevenueEvent, VerifiedPayment } from "@switchboard/schemas";
import type { WorkUnit } from "@switchboard/core/platform";
import type { RunInTransaction } from "./revenue.js";
import {
  buildRecordVerifiedPaymentHandler,
  type ReceiptWriter,
  type PaymentVerifier,
} from "./record-verified-payment.js";

const TX = { __tx: true } as const;

function makeEvent(overrides: Partial<LifecycleRevenueEvent> = {}): LifecycleRevenueEvent {
  return {
    id: "rev_1",
    organizationId: "org-1",
    contactId: "c1",
    opportunityId: "opp-1",
    amount: 5000,
    currency: "SGD",
    type: "deposit",
    status: "confirmed",
    recordedBy: "stripe",
    externalReference: "pi_abc",
    bookingId: "book-1",
    verified: true,
    sourceCampaignId: "camp-1",
    sourceAdId: null,
    recordedAt: new Date(0),
    createdAt: new Date(0),
    ...overrides,
  };
}

function charge(over: Partial<VerifiedPayment> = {}): VerifiedPayment {
  return {
    provider: "stripe",
    externalReference: "pi_abc",
    amountCents: 5000,
    currency: "sgd",
    status: "paid",
    bookingId: "book-1",
    ...over,
  };
}

function makeWorkUnit(
  opts: { actorType?: string; params?: Record<string, unknown> } = {},
): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: new Date(0).toISOString(),
    organizationId: "org-1",
    actor: { id: "system", type: (opts.actorType ?? "service") as never },
    intent: "payment.record_verified",
    parameters: {
      contactId: "c1",
      opportunityId: "opp-1",
      bookingId: "book-1",
      amountCents: 5000,
      currency: "SGD",
      externalReference: "pi_abc",
      provider: "stripe",
      sourceCampaignId: "camp-1",
      ...opts.params,
    },
    deployment: {} as never,
    resolvedMode: "operator_mutation",
    traceId: "t-1",
    trigger: "api",
    priority: "normal",
  } as WorkUnit;
}

function makeRevenueStore(event: LifecycleRevenueEvent): RevenueStore {
  return {
    record: vi.fn(async () => event),
    findByOpportunity: vi.fn(async () => []),
    findByContact: vi.fn(async () => []),
    sumByOrg: vi.fn(async () => ({ totalAmount: 0, count: 0 })),
    sumByCampaign: vi.fn(async () => []),
  };
}

const runInTx = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX)) as RunInTransaction;

describe("buildRecordVerifiedPaymentHandler", () => {
  it("verified path: re-fetches the charge, writes T1 + verified revenue + purchased outbox with the PSP amount", async () => {
    const receiptWriter: ReceiptWriter = { write: vi.fn(async () => {}) };
    const revenueStore = makeRevenueStore(makeEvent());
    const outboxWriter = { write: vi.fn(async () => {}) };
    const verifyPayment: PaymentVerifier = vi.fn(async () => charge({ amountCents: 5000 }));

    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      outboxWriter,
      runInTx,
      verifyPayment,
    );
    // Body claims an inflated amount; the PSP fetch-back (5000) must win.
    const result = await handler.execute(makeWorkUnit({ params: { amountCents: 999999 } }));

    expect(verifyPayment).toHaveBeenCalledWith("org-1", "pi_abc");
    expect(result.outcome).toBe("completed");
    expect(receiptWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "T1_FETCH_BACK",
        amount: 5000,
        status: "paid",
        exceptions: [],
      }),
      TX,
    );
    expect(revenueStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ verified: true, amount: 5000 }),
      TX,
    );
    expect(outboxWriter.write).toHaveBeenCalledWith(
      "evt_pay_rev_1",
      "purchased",
      expect.objectContaining({ value: 5000 }),
      TX,
    );
  });

  it("replay re-issues the same outbox eventId", async () => {
    const receiptWriter: ReceiptWriter = { write: vi.fn(async () => {}) };
    const revenueStore = makeRevenueStore(makeEvent({ id: "rev_existing" }));
    const outboxWriter = { write: vi.fn(async () => {}) };
    const verifyPayment: PaymentVerifier = vi.fn(async () => charge());

    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      outboxWriter,
      runInTx,
      verifyPayment,
    );
    await handler.execute(makeWorkUnit());
    expect(outboxWriter.write).toHaveBeenCalledWith(
      "evt_pay_rev_existing",
      "purchased",
      expect.anything(),
      TX,
    );
  });

  it("a noop charge writes a T3 receipt + verified=false revenue, never T1 (R1)", async () => {
    const receiptWriter: ReceiptWriter = { write: vi.fn(async () => {}) };
    const revenueStore = makeRevenueStore(makeEvent({ verified: false }));
    const outboxWriter = { write: vi.fn(async () => {}) };
    const verifyPayment: PaymentVerifier = vi.fn(async () =>
      charge({ provider: "noop", externalReference: "noop_pay_book-1" }),
    );

    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      outboxWriter,
      runInTx,
      verifyPayment,
    );
    await handler.execute(
      makeWorkUnit({ params: { provider: "noop", externalReference: "noop_pay_book-1" } }),
    );

    expect(receiptWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "T3_ADMIN_AUDIT",
        verifiedAt: null,
        exceptions: ["missing_source"],
      }),
      TX,
    );
    expect(revenueStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ verified: false }),
      TX,
    );
    expect(receiptWriter.write).not.toHaveBeenCalledWith(
      expect.objectContaining({ tier: "T1_FETCH_BACK" }),
      expect.anything(),
    );
  });

  // --- F3 forge-path proofs ---
  it("FORGE: a user actor cannot record a verified payment (no writes, no conversion)", async () => {
    const receiptWriter: ReceiptWriter = { write: vi.fn(async () => {}) };
    const revenueStore = makeRevenueStore(makeEvent());
    const outboxWriter = { write: vi.fn(async () => {}) };
    const verifyPayment: PaymentVerifier = vi.fn(async () => charge());

    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      outboxWriter,
      runInTx,
      verifyPayment,
    );
    const result = await handler.execute(makeWorkUnit({ actorType: "user" }));

    expect(result.outcome).toBe("failed");
    expect(verifyPayment).not.toHaveBeenCalled();
    expect(receiptWriter.write).not.toHaveBeenCalled();
    expect(revenueStore.record).not.toHaveBeenCalled();
    expect(outboxWriter.write).not.toHaveBeenCalled();
  });

  it("FORGE: a fabricated externalReference (no PSP charge) records nothing verified", async () => {
    const receiptWriter: ReceiptWriter = { write: vi.fn(async () => {}) };
    const revenueStore = makeRevenueStore(makeEvent());
    const outboxWriter = { write: vi.fn(async () => {}) };
    const verifyPayment: PaymentVerifier = vi.fn(async () => null); // charge not found

    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      outboxWriter,
      runInTx,
      verifyPayment,
    );
    const result = await handler.execute(
      makeWorkUnit({ actorType: "service", params: { externalReference: "FAKE" } }),
    );

    expect(result.outcome).toBe("failed");
    expect(receiptWriter.write).not.toHaveBeenCalled();
    expect(revenueStore.record).not.toHaveBeenCalled();
    expect(outboxWriter.write).not.toHaveBeenCalled();
  });

  it("FORGE: a real-but-unpaid charge records nothing verified", async () => {
    const receiptWriter: ReceiptWriter = { write: vi.fn(async () => {}) };
    const revenueStore = makeRevenueStore(makeEvent());
    const outboxWriter = { write: vi.fn(async () => {}) };
    const verifyPayment: PaymentVerifier = vi.fn(async () => charge({ status: "pending" }));

    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      outboxWriter,
      runInTx,
      verifyPayment,
    );
    const result = await handler.execute(makeWorkUnit({ actorType: "service" }));

    expect(result.outcome).toBe("failed");
    expect(revenueStore.record).not.toHaveBeenCalled();
    expect(outboxWriter.write).not.toHaveBeenCalled();
  });
});
