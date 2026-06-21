import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PrismaReceiptedBookingStore, PrismaReceiptStore } from "@switchboard/db";
import { buildTestServer, type TestContext } from "./test-server.js";
import { InMemoryRevenueDb, buildCalendarBookTool } from "./revenue-loop-substrate.js";

/**
 * Slice 1 of the whole-loop revenue-proof e2e (decomposition plan:
 * docs/superpowers/plans/2026-06-21-revenue-proof-e2e-decomposition.md).
 *
 * The gap this closes: P3.2 (dashboard-reports-real-store.test.ts) proved the owner tiles roll up the
 * REAL PrismaReceiptedBookingStore projection, but it fed that projection a READONLY mocked Prisma
 * cohort fixture. Nothing proved that Alex's booking WRITE actually populates the projection. This test
 * drives the REAL booking producer (the calendar-book `booking.create` tool operation, with its Receipt
 * mint and issueReceiptedBookingInTx issuance) over a shared in-memory Prisma substrate, then reads the
 * SAME substrate back through the REAL PrismaReceiptStore + PrismaReceiptedBookingStore -> the real
 * createPeriodRollup -> the owner `receiptedBookings` / `receiptedBookingRevenue` /
 * `receiptedBookingQuality` tiles via GET /api/dashboard/reports. So the booking write -> owner number
 * seam is proven end-to-end, not stubbed.
 *
 * Mocked external edges ONLY: the LLM (the tool op is invoked directly, so the skill-executor and model
 * are bypassed; the booking PRODUCER stays real), Google Calendar (a stub provider), and Prisma (the
 * in-memory substrate). Everything between is production code.
 *
 * Time is frozen (Date only) to a fixed mid-week instant so the booked calendar receipt's createdAt
 * lands deterministically inside the route's THIS WEEK [startOfWeekUTC, +7d) window.
 */

const ORG = "org-1";
// Wednesday 2026-06-17 12:00 UTC: comfortably inside THIS WEEK [Mon 2026-06-15, Mon 2026-06-22).
const FROZEN_NOW = new Date("2026-06-17T12:00:00.000Z");
const SLOT_START = "2026-06-17T14:00:00.000Z";
const SLOT_END = "2026-06-17T15:00:00.000Z";
const EXPECTED_VALUE_CENTS = 45000;

describe("revenue-proof e2e slice 1: real booking producer -> owner tiles (over a shared substrate)", () => {
  let ctx: TestContext;
  let db: InMemoryRevenueDb;

  beforeEach(async () => {
    // Fake ONLY Date (leave timers real) so Fastify's async internals are unaffected.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FROZEN_NOW);
    ctx = await buildTestServer();
    db = new InMemoryRevenueDb();
    // A deterministic-attribution lead (leadgenId present) with a priced active opportunity, no PDPA
    // jurisdiction (so no missing_consent exception): the cleanest "perfect" receipted booking.
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
  });

  afterEach(async () => {
    await ctx.app.close();
    vi.useRealTimers();
  });

  /** Drive the REAL booking producer for the seeded lead, then wire the route's receipted-booking
   *  stores to the REAL projections over the SAME substrate (mirrors app.ts wiring + P3.2). */
  async function bookThenWireRoute(): Promise<void> {
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
    // The producer must succeed; a failed booking would make every downstream assertion vacuous.
    expect(res.status).toBe("success");

    const receiptedStore = new PrismaReceiptedBookingStore(db.client as never);
    const receiptStore = new PrismaReceiptStore(db.client as never);
    ctx.app.reportStores!.receiptedBookings = {
      listForCohort: (input) => receiptedStore.listForCohort(input.orgId, input.from, input.to),
    };
    ctx.app.reportStores!.receipts = {
      countReceiptedBookingsInWindow: (input) => receiptStore.countReceiptedBookingsInWindow(input),
    };
  }

  function getReport() {
    return ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/reports?window=THIS%20WEEK",
      headers: { "x-org-id": ORG },
    });
  }

  it("writes the calendar Receipt + persisted ReceiptedBooking the moat depends on", async () => {
    await bookThenWireRoute();

    // The booking confirmed and minted a booked calendar receipt (the north-star proof receipt).
    const receipts = db.listReceipts().filter((r) => r.organizationId === ORG);
    const calendarReceipt = receipts.find((r) => r.kind === "calendar");
    expect(calendarReceipt).toBeDefined();
    expect(calendarReceipt).toMatchObject({ kind: "calendar", status: "booked" });
    expect(calendarReceipt!.bookingId).toBeTruthy();
    // createdAt is stamped (the cohort window keys on it) and lands on the frozen instant.
    expect(calendarReceipt!.createdAt.toISOString()).toBe(FROZEN_NOW.toISOString());

    // The producer issued the persisted ReceiptedBooking row (the moat object) with the issuance-time
    // attribution + expected-value snapshot.
    const issued = db.getReceiptedBooking(calendarReceipt!.bookingId as string);
    expect(issued).toBeDefined();
    expect(issued).toMatchObject({
      organizationId: ORG,
      attributionConfidence: "deterministic",
      expectedValueAtIssue: EXPECTED_VALUE_CENTS,
    });
  });

  it("surfaces the booked appointment in the owner revenue tile (expected, not yet paid)", async () => {
    await bookThenWireRoute();
    const res = await getReport();
    expect(res.statusCode).toBe(200);

    expect(res.json().receiptedBookings).toMatchObject({ count: 1 });
    // Expected value flows from the issued snapshot; no payment receipt yet -> proven-paid is zero.
    expect(res.json().receiptedBookingRevenue).toMatchObject({
      cohortSize: 1,
      bookingsWithValue: 1,
      revenueCents: EXPECTED_VALUE_CENTS,
      paidRevenueCents: 0,
      paidBookings: 0,
    });
  });

  it("surfaces the booked appointment in the owner quality tile (deterministic, no exceptions)", async () => {
    await bookThenWireRoute();
    const res = await getReport();
    expect(res.statusCode).toBe(200);

    const quality = res.json().receiptedBookingQuality;
    expect(quality.cohortSize).toBe(1);
    expect(quality.confidence).toMatchObject({
      deterministic: 1,
      high: 0,
      medium: 0,
      low: 0,
      unattributed: 0,
    });
    expect(quality.exceptions).toMatchObject({
      missing_source: 0,
      missing_consent: 0,
      manual_override: 0,
      duplicate_contact_risk: 0,
    });
    expect(quality.bookingsNeedingAttention).toBe(0);
    expect(quality.worklist).toEqual([]);
  });

  it("excludes decoy receipts so the cohort filter is proven (not a rubber stamp)", async () => {
    // Seed receipts (each with a matching booking row, so only the cohort WHERE clause can exclude
    // them). Each decoy differs from the valid row in EXACTLY ONE clause -- wrong status, out of
    // window, wrong kind, other org, null bookingId -- so the count==1 assertion catches a regression
    // in any SINGLE clause. None may join org-1's THIS WEEK receipted-booking cohort.
    const decoys: Array<{
      bookingId: string | null;
      org: string;
      kind: string;
      status: string;
      createdAt: Date;
    }> = [
      { bookingId: "bk-void", org: ORG, kind: "calendar", status: "void", createdAt: FROZEN_NOW },
      {
        bookingId: "bk-old",
        org: ORG,
        kind: "calendar",
        status: "booked",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
      },
      // status booked (cohort-passing) so ONLY the kind:"calendar" clause can exclude this one.
      { bookingId: "bk-pay", org: ORG, kind: "payment", status: "booked", createdAt: FROZEN_NOW },
      {
        bookingId: "bk-org2",
        org: "org-2",
        kind: "calendar",
        status: "booked",
        createdAt: FROZEN_NOW,
      },
      { bookingId: null, org: ORG, kind: "calendar", status: "booked", createdAt: FROZEN_NOW },
    ];
    decoys.forEach((d, i) => {
      if (d.bookingId) {
        db.seedBooking({
          id: d.bookingId,
          organizationId: d.org,
          contactId: null,
          opportunityId: null,
          service: "Decoy",
          startsAt: FROZEN_NOW,
        });
      }
      db.seedReceipt({
        id: `decoy-${i}`,
        organizationId: d.org,
        kind: d.kind,
        status: d.status,
        bookingId: d.bookingId,
        createdAt: d.createdAt,
        tier: "T1_FETCH_BACK",
        provider: null,
        amount: null,
      });
    });

    await bookThenWireRoute();
    const res = await getReport();
    expect(res.statusCode).toBe(200);

    // Exactly the one real booking survives every filter clause; the count and the cohort agree.
    expect(res.json().receiptedBookings).toMatchObject({ count: 1 });
    expect(res.json().receiptedBookingRevenue).toMatchObject({ cohortSize: 1 });
    expect(res.json().receiptedBookingQuality.cohortSize).toBe(1);
  });
});
