import { describe, it, expect, vi } from "vitest";
import type { RevenueStore } from "@switchboard/core";
import type { LifecycleRevenueEvent } from "@switchboard/schemas";
import type { WorkUnit } from "@switchboard/core/platform";
import type { RunInTransaction } from "./revenue.js";
import {
  buildRecordVerifiedPaymentHandler,
  type ReceiptWriter,
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

function makeWorkUnit(params: Record<string, unknown> = {}): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: new Date(0).toISOString(),
    organizationId: "org-1",
    actor: { id: "system", type: "service" },
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
      ...params,
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
  it("writes receipt + revenue + outbox in one tx with the parsed amount and org from the work unit", async () => {
    const receiptWriter: ReceiptWriter = { write: vi.fn(async () => {}) };
    const revenueStore = makeRevenueStore(makeEvent());
    const outboxWriter = { write: vi.fn(async () => {}) };

    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      outboxWriter,
      runInTx,
    );
    const result = await handler.execute(makeWorkUnit());

    expect(result.outcome).toBe("completed");
    expect(receiptWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        kind: "payment",
        tier: "T1_FETCH_BACK",
        status: "paid",
        bookingId: "book-1",
        externalRef: "pi_abc",
        amount: 5000,
        evidence: expect.objectContaining({
          kind: "payment",
          chargeId: "pi_abc",
          amountFetched: 5000,
        }),
      }),
      TX,
    );
    expect(revenueStore.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        type: "deposit",
        recordedBy: "stripe",
        verified: true,
        amount: 5000,
        bookingId: "book-1",
        externalReference: "pi_abc",
      }),
      TX,
    );
    expect(outboxWriter.write).toHaveBeenCalledWith(
      "evt_pay_rev_1",
      "purchased",
      expect.objectContaining({
        type: "purchased",
        value: 5000,
        contactId: "c1",
        organizationId: "org-1",
      }),
      TX,
    );
  });

  it("replay re-issues the same outbox eventId (existing row returned)", async () => {
    const receiptWriter: ReceiptWriter = { write: vi.fn(async () => {}) };
    const revenueStore = makeRevenueStore(makeEvent({ id: "rev_existing" }));
    const outboxWriter = { write: vi.fn(async () => {}) };

    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      outboxWriter,
      runInTx,
    );
    await handler.execute(makeWorkUnit());
    expect(outboxWriter.write).toHaveBeenCalledWith(
      "evt_pay_rev_existing",
      "purchased",
      expect.anything(),
      TX,
    );
  });

  it("a provider='noop' payment writes a T3 receipt and verified=false revenue, never T1 (R1)", async () => {
    const receiptWriter: ReceiptWriter = { write: vi.fn(async () => {}) };
    const revenueStore = makeRevenueStore(makeEvent({ verified: false, recordedBy: "stripe" }));
    const outboxWriter = { write: vi.fn(async () => {}) };

    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      outboxWriter,
      runInTx,
    );
    await handler.execute(makeWorkUnit({ provider: "noop", externalReference: "noop_pay_book-1" }));

    expect(receiptWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "T3_ADMIN_AUDIT", provider: "noop", verifiedAt: null }),
      TX,
    );
    expect(revenueStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ verified: false }),
      TX,
    );
    // R1: a noop payment is never minted as a verified T1 paid visit.
    expect(receiptWriter.write).not.toHaveBeenCalledWith(
      expect.objectContaining({ tier: "T1_FETCH_BACK" }),
      expect.anything(),
    );
  });
});
