import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  PrismaReceiptedBookingStore,
  PrismaReceiptStore,
  PrismaRevenueStore,
  PrismaOutboxStore,
} from "@switchboard/db";
import type { VerifiedPayment } from "@switchboard/schemas";
import { buildTestServer } from "./test-server.js";
import { InMemoryRevenueDb, buildCalendarBookTool } from "./revenue-loop-substrate.js";
import {
  RECORD_ATTENDANCE_INTENT,
  RECORD_VERIFIED_PAYMENT_INTENT,
} from "../bootstrap/operator-intents.js";

/**
 * Slice 2 of the whole-loop revenue-proof e2e (decomposition plan:
 * docs/superpowers/plans/2026-06-21-revenue-proof-e2e-decomposition.md). The PROVEN-PAID half.
 *
 * Slice 1 proved the booking WRITE populates the owner read projection. This slice proves the rest of
 * the money path: a booked appointment becomes ATTENDED (the calendar receipt is promoted booked->held)
 * and then PAID (a verified payment receipt + revenue event + outbox), and the owner's PROVEN-PAID
 * numbers (`paidRevenueCents` / `paidBookings`) reflect it — all driven through the REAL
 * PlatformIngress.submit + the REAL operator-mutation handlers (attendance, payment) + the REAL
 * Prisma-backed stores (PrismaReceiptStore.mint/promoteCalendarBookedToHeld, PrismaRevenueStore.record,
 * PrismaOutboxStore.write, PrismaReceiptedBookingStore.getView/listForCohort -> createPeriodRollup ->
 * computeReceiptedBookingRevenue) over the shared in-memory substrate. Unlike slice 1 (booking has no
 * intent path), attendance + payment ARE operator intents, so they go through real ingress + governance.
 *
 * Mocked external edges ONLY: the LLM (the booking op is invoked directly), Google Calendar (a stub
 * provider), Stripe (the injected PaymentVerifier returns a fixed PSP fetch-back), and Prisma (the
 * substrate). Everything between — ingress, gate, handlers, stores, rollup — is production code.
 *
 * Money authority (F3): the paid amount is the PSP fetch-back's `amountCents`, NEVER the request body.
 * Paid-visit verdict (isPaidVisit): paid is true ONLY for a real provider + T1 fetch-back + status
 * "paid"; a noop/degraded payment writes a receipt but is NOT counted as proven-paid.
 *
 * Time is frozen (Date only) so the booked calendar receipt's createdAt lands in the route's THIS WEEK
 * window (the cohort filter keys on it).
 */

const ORG = "org-1";
// Wednesday 2026-06-17 12:00 UTC: comfortably inside THIS WEEK [Mon 2026-06-15, Mon 2026-06-22).
const FROZEN_NOW = new Date("2026-06-17T12:00:00.000Z");
const SLOT_START = "2026-06-17T14:00:00.000Z";
const SLOT_END = "2026-06-17T15:00:00.000Z";
// EXPECTED (booked pipeline) is the opportunity value snapshotted at issuance; PAID (proven) is the PSP
// fetch-back amount. They are deliberately DIFFERENT so an assertion can prove paid is sourced from the
// payment charge, not the expected-value snapshot.
const EXPECTED_VALUE_CENTS = 45000;
const PAID_CENTS = 30000;
const EXTERNAL_REF = "pi_paidleg_1";

/** Fake Stripe fetch-back. The handler reads amount/currency/provider from THIS, never from the body. */
function paidStripeCharge(over: Partial<VerifiedPayment> = {}): VerifiedPayment {
  return {
    provider: "stripe",
    externalReference: EXTERNAL_REF,
    amountCents: PAID_CENTS,
    currency: "sgd",
    status: "paid",
    bookingId: null,
    ...over,
  };
}

let openApp: FastifyInstance | null = null;

/**
 * Build the real test server with EVERY operator-mutation store wired to the REAL Prisma-backed
 * implementation running over the shared substrate (mirrors app.ts:1048-1064). The only mocked edge is
 * the PaymentVerifier (Stripe); per-test it returns whatever charge the case needs. The harness shape
 * is inferred (the inject/submit return types are overloaded; an explicit annotation picks the wrong
 * overload).
 */
async function makeHarness(
  verifier: (orgId: string, ref: string) => Promise<VerifiedPayment | null> = async () =>
    paidStripeCharge(),
) {
  const db = new InMemoryRevenueDb();
  // A deterministic-attribution lead (leadgenId present) with a priced active opportunity, no PDPA
  // jurisdiction: the clean "perfect" receipted booking (mirrors slice 1).
  db.seedContact({
    id: "ct-1",
    organizationId: ORG,
    leadgenId: "lead-1",
    sourceType: null,
    firstTouchChannel: null,
    pdpaJurisdiction: null,
    consentGrantedAt: null,
    consentRevokedAt: null,
    name: "Test Patient",
    email: null,
  });
  db.seedOpportunity({
    id: "opp-1",
    organizationId: ORG,
    contactId: "ct-1",
    estimatedValue: EXPECTED_VALUE_CENTS,
    stage: "qualified",
  });

  // REAL stores over the substrate. ONE PrismaReceiptStore is both the payment receipt writer (.mint)
  // and the attendance held-promoter (mirrors app.ts reusing `prismaReceipts` for both).
  const prismaReceipts = new PrismaReceiptStore(db.client as never);
  const prismaRevenue = new PrismaRevenueStore(db.client as never);
  const prismaOutbox = new PrismaOutboxStore(db.client as never);

  const app = (
    await buildTestServer({
      revenueStore: prismaRevenue,
      outboxWriter: {
        write: (eventId, type, payload, tx) =>
          prismaOutbox.write(eventId, type, payload, tx as never).then(() => {}),
      },
      // The substrate tx IS the substrate client (mirrors prismaClient.$transaction((tx) => fn(tx))).
      runInTransaction: (fn) => fn(db.client),
      receiptWriter: {
        write: (input, tx) => prismaReceipts.mint(input, tx as never).then(() => {}),
      },
      paymentVerifier: verifier,
      // Thin substrate-backed attendance writer; the meaningful work (booked->held) is the REAL promoter.
      bookingAttendanceWriter: {
        recordAttendance: async (_organizationId: string, bookingId: string, outcome: string) => {
          await db.client.booking.update({
            where: { id: bookingId },
            data: { attendance: outcome },
          });
          return { id: bookingId, attendance: outcome };
        },
      },
      receiptHeldPromoter: prismaReceipts,
    })
  ).app;
  openApp = app;

  const receiptedStore = new PrismaReceiptedBookingStore(db.client as never);

  async function book(): Promise<string> {
    const tool = buildCalendarBookTool(db, {
      sessionId: "s",
      orgId: ORG,
      deploymentId: "dep-1",
      contactId: "ct-1",
    });
    const res = await tool.operations["booking.create"]!.execute({
      service: "Botox consult",
      slotStart: SLOT_START,
      slotEnd: SLOT_END,
      calendarId: "cal-1",
    });
    // A failed booking would make every downstream assertion vacuous.
    expect(res.status).toBe("success");
    const calendarReceipt = db
      .listReceipts()
      .find((r) => r["organizationId"] === ORG && r["kind"] === "calendar");
    expect(calendarReceipt?.bookingId).toBeTruthy();
    return calendarReceipt!.bookingId as string;
  }

  function submitAttendance(bookingId: string, outcome: "attended" | "no_show" = "attended") {
    return app.platformIngress.submit({
      intent: RECORD_ATTENDANCE_INTENT,
      parameters: { bookingId, outcome, recordedBy: "owner" },
      actor: { id: "owner-1", type: "user" },
      organizationId: ORG,
      trigger: "api",
      surface: { surface: "api" },
      idempotencyKey: `att-${bookingId}-${outcome}`,
    });
  }

  function submitPayment(bookingId: string, params: Record<string, unknown> = {}) {
    return app.platformIngress.submit({
      intent: RECORD_VERIFIED_PAYMENT_INTENT,
      // The genuine caller is the in-process payments webhook: a `service` actor (F3).
      actor: { id: "system", type: "service" },
      organizationId: ORG,
      trigger: "api",
      surface: { surface: "api" },
      idempotencyKey: `pay-${bookingId}`,
      parameters: {
        contactId: "ct-1",
        opportunityId: "opp-1",
        bookingId,
        amountCents: PAID_CENTS,
        currency: "SGD",
        externalReference: EXTERNAL_REF,
        provider: "stripe",
        ...params,
      },
    });
  }

  function wireReportStores(): void {
    app.reportStores!.receiptedBookings = {
      listForCohort: (input) => receiptedStore.listForCohort(input.orgId, input.from, input.to),
    };
    app.reportStores!.receipts = {
      countReceiptedBookingsInWindow: (input) =>
        prismaReceipts.countReceiptedBookingsInWindow(input),
    };
  }

  function getReport() {
    return app.inject({
      method: "GET",
      url: "/api/dashboard/reports?window=THIS%20WEEK",
      headers: { "x-org-id": ORG },
    });
  }

  return { app, db, book, submitAttendance, submitPayment, getReport, wireReportStores };
}

describe("revenue-proof e2e slice 2: attendance + payment -> proven-paid owner tile (real ingress)", () => {
  beforeEach(() => {
    // Fake ONLY Date (leave timers real) so Fastify's async internals are unaffected.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(async () => {
    if (openApp) await openApp.close();
    openApp = null;
    vi.useRealTimers();
  });

  it("promotes the calendar receipt booked->held through real attendance ingress", async () => {
    const h = await makeHarness();
    const bookingId = await h.book();

    // Precondition: the booking minted a BOOKED calendar receipt (not yet held).
    const before = h.db
      .listReceipts()
      .find((r) => r["kind"] === "calendar" && r["bookingId"] === bookingId);
    expect(before).toMatchObject({ status: "booked" });

    const res = await h.submitAttendance(bookingId, "attended");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // system_auto_approved short-circuits to execute; the real OperatorMutationMode handler runs.
    expect(res.result.outcome).toBe("completed");
    expect(res.result.outputs?.["receiptsPromoted"]).toBe(1);

    // The REAL PrismaReceiptStore.promoteCalendarBookedToHeld flipped the calendar receipt booked->held.
    const after = h.db
      .listReceipts()
      .find((r) => r["kind"] === "calendar" && r["bookingId"] === bookingId);
    expect(after).toMatchObject({ status: "held" });
  });

  it("surfaces PROVEN-PAID revenue in the owner tile through real payment ingress", async () => {
    const h = await makeHarness();
    const bookingId = await h.book();
    await h.submitAttendance(bookingId, "attended");

    const pay = await h.submitPayment(bookingId);
    expect(pay.ok).toBe(true);
    if (!pay.ok) return;
    expect(pay.result.outcome).toBe("completed");

    // Write side (over the substrate): a verified PAYMENT receipt (T1, real provider, status paid), a
    // verified revenue event welded to the booking, and a `purchased` outbox event.
    const paymentReceipt = h.db
      .listReceipts()
      .find((r) => r["kind"] === "payment" && r["bookingId"] === bookingId);
    expect(paymentReceipt).toMatchObject({
      status: "paid",
      provider: "stripe",
      tier: "T1_FETCH_BACK",
      amount: PAID_CENTS,
    });
    expect(
      h.db
        .listRevenueEvents()
        .filter((e) => e["bookingId"] === bookingId && e["verified"] === true),
    ).toHaveLength(1);
    expect(h.db.listOutbox().filter((e) => e["type"] === "purchased")).toHaveLength(1);

    // Read side: the owner revenue tile now reports proven-paid alongside the (unchanged) expected
    // pipeline. cohortSize stays 1 (the payment receipt is kind=payment, excluded from the calendar
    // cohort); revenueCents stays the EXPECTED snapshot; paid* come from the verified payment.
    h.wireReportStores();
    const res = await h.getReport();
    expect(res.statusCode).toBe(200);
    expect(res.json().receiptedBookingRevenue).toMatchObject({
      cohortSize: 1,
      bookingsWithValue: 1,
      revenueCents: EXPECTED_VALUE_CENTS,
      paidRevenueCents: PAID_CENTS,
      paidBookings: 1,
    });
  });

  it("uses the PSP fetch-back amount, not the request body, for paid revenue (F3 money authority)", async () => {
    const h = await makeHarness();
    const bookingId = await h.book();
    await h.submitAttendance(bookingId, "attended");

    // The webhook body claims a wildly inflated amount; the PSP fetch-back (PAID_CENTS) must win.
    const pay = await h.submitPayment(bookingId, { amountCents: 999999 });
    expect(pay.ok).toBe(true);

    h.wireReportStores();
    const res = await h.getReport();
    expect(res.json().receiptedBookingRevenue).toMatchObject({
      paidRevenueCents: PAID_CENTS,
      paidBookings: 1,
    });
  });

  it("does NOT count a degraded noop payment as proven-paid (writes the receipt, excludes it)", async () => {
    // The PSP fetch-back resolves to the degraded Noop adapter -> T3, never production-countable.
    const h = await makeHarness(async () =>
      paidStripeCharge({ provider: "noop", externalReference: "noop_pay_1" }),
    );
    const bookingId = await h.book();
    await h.submitAttendance(bookingId, "attended");

    const pay = await h.submitPayment(bookingId, {
      provider: "noop",
      externalReference: "noop_pay_1",
    });
    expect(pay.ok).toBe(true);

    // The write path still ran: a DEGRADED payment receipt (provider noop, tier T3) exists...
    const paymentReceipt = h.db
      .listReceipts()
      .find((r) => r["kind"] === "payment" && r["bookingId"] === bookingId);
    expect(paymentReceipt).toMatchObject({ provider: "noop", tier: "T3_ADMIN_AUDIT" });

    // ...but isPaidVisit excludes it, so the owner's proven-paid stays zero while the booked pipeline is
    // unaffected (the appointment is still a booked, value-carrying cohort member).
    h.wireReportStores();
    const res = await h.getReport();
    expect(res.json().receiptedBookingRevenue).toMatchObject({
      cohortSize: 1,
      revenueCents: EXPECTED_VALUE_CENTS,
      paidRevenueCents: 0,
      paidBookings: 0,
    });
  });

  it("dedups duplicate booked calendar receipts for one booking (distinct bookingId)", async () => {
    // Closes the slice-1 decoy gap: slice 1's decoys never shared the REAL booking's id, so deleting
    // `distinct: ["bookingId"]` from the cohort query would not have reddened it. A confirm-retry can
    // mint a SECOND booked calendar receipt for the same booking (NULL externalRef -> no dedup unique),
    // so the cohort MUST dedup by bookingId or the north-star count over-reports.
    const h = await makeHarness();
    const bookingId = await h.book();

    h.db.seedReceipt({
      id: "dup-calendar-receipt",
      organizationId: ORG,
      kind: "calendar",
      status: "booked",
      bookingId, // the REAL, dynamically-generated booking id
      createdAt: FROZEN_NOW,
      tier: "T1_FETCH_BACK",
      provider: null,
      amount: null,
    });

    h.wireReportStores();
    const res = await h.getReport();
    expect(res.statusCode).toBe(200);
    // Two booked calendar receipts, ONE booking -> the cohort and the count both stay 1.
    expect(res.json().receiptedBookings).toMatchObject({ count: 1 });
    expect(res.json().receiptedBookingRevenue).toMatchObject({ cohortSize: 1 });
  });
});
