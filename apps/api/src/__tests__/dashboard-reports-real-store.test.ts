import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PrismaReceiptedBookingStore } from "@switchboard/db";
import { buildTestServer, type TestContext } from "./test-server.js";

/**
 * P3.2 — real-store integration proof for the owner-report receipted-booking tiles.
 *
 * The gap this closes: every layer used to stub `receiptedBookings.listForCohort: async () => []`
 * (test-server.ts:411, period-rollup.test.ts:54), so the route's `receiptedBookingQuality` /
 * `receiptedBookingRevenue` tiles were only ever exercised against an empty static fixture. This
 * test drives the FULL chain — GET /api/dashboard/reports -> createPeriodRollup -> the
 * app.ts-shaped `listForCohort` adapter -> the REAL `PrismaReceiptedBookingStore` projection
 * (getView over the calendar-receipt cohort) -> the two tile rollups — so a regression anywhere on
 * that producer -> consumer seam is caught, not silently swallowed by a `() => []` stub.
 *
 * Only the Prisma client (the data source) and the OTHER report stores (test-server defaults) are
 * faked; the receipted-booking projection under test is the real production code.
 */

// Minimal arg shapes for the mocked Prisma legs the store touches (no `any`; cast to never at the
// store boundary, mirroring prisma-receipted-booking-store.test.ts).
type ReceiptFindManyArgs = { where?: { bookingId?: unknown }; distinct?: readonly string[] };
type FindByIdArgs = { where?: { id?: string } };

/**
 * A mocked PrismaClient that branches by query args (NOT mockResolvedValueOnce): listForCohort fans
 * getView out over the cohort with Promise.all, so call-order chaining across a >1-booking cohort is
 * racy. Branching on the args is deterministic regardless of interleaving.
 *
 * Cohort = two bookings exercising both tiles:
 *  - bk-paid:      leadgenId -> deterministic attribution; null jurisdiction -> no exceptions; a
 *                  verified T1 stripe payment receipt -> paid=true, paidValueCents=30000; live
 *                  Opportunity 45000, no persisted issuance row -> expected falls back to live.
 *  - bk-attention: no source -> unattributed + missing_source; SG jurisdiction + no consent ->
 *                  missing_consent; no payment receipt -> not paid; live Opportunity 20000.
 */
function makeMockPrisma() {
  const startsPaid = new Date("2026-06-16T02:00:00Z");
  const startsAttention = new Date("2026-06-15T01:00:00Z");
  const consentAt = new Date("2026-06-10T00:00:00Z");

  const bookings: Record<
    string,
    {
      id: string;
      contactId: string | null;
      opportunityId: string | null;
      workTraceId: string | null;
      attendance: string | null;
      service: string;
      startsAt: Date;
    }
  > = {
    "bk-paid": {
      id: "bk-paid",
      contactId: "ct-paid",
      opportunityId: "opp-paid",
      workTraceId: null,
      attendance: "attended",
      service: "Botox consult",
      startsAt: startsPaid,
    },
    "bk-attention": {
      id: "bk-attention",
      contactId: "ct-att",
      opportunityId: "opp-att",
      workTraceId: null,
      attendance: null,
      service: "Filler",
      startsAt: startsAttention,
    },
  };

  const receiptsByBooking: Record<
    string,
    Array<{
      id: string;
      kind: string;
      status: string;
      provider: string | null;
      tier: string;
      amount: number | null;
    }>
  > = {
    "bk-paid": [
      {
        id: "cal-paid",
        kind: "calendar",
        status: "booked",
        provider: null,
        tier: "T1_FETCH_BACK",
        amount: null,
      },
      {
        id: "pay-paid",
        kind: "payment",
        status: "paid",
        provider: "stripe",
        tier: "T1_FETCH_BACK",
        amount: 30000,
      },
    ],
    "bk-attention": [
      {
        id: "cal-att",
        kind: "calendar",
        status: "held",
        provider: null,
        tier: "T1_FETCH_BACK",
        amount: null,
      },
    ],
  };

  const contactsById: Record<
    string,
    {
      id: string;
      leadgenId: string | null;
      sourceType: string | null;
      firstTouchChannel: string | null;
      pdpaJurisdiction: string | null;
      consentGrantedAt: Date | null;
      consentRevokedAt: Date | null;
    }
  > = {
    "ct-paid": {
      id: "ct-paid",
      leadgenId: "lead-paid",
      sourceType: "ctwa",
      firstTouchChannel: "instagram",
      pdpaJurisdiction: null,
      consentGrantedAt: consentAt,
      consentRevokedAt: null,
    },
    "ct-att": {
      id: "ct-att",
      leadgenId: null,
      sourceType: null,
      firstTouchChannel: null,
      pdpaJurisdiction: "SG",
      consentGrantedAt: null,
      consentRevokedAt: null,
    },
  };

  const opportunitiesById: Record<string, { estimatedValue: number }> = {
    "opp-paid": { estimatedValue: 45000 },
    "opp-att": { estimatedValue: 20000 },
  };

  return {
    receipt: {
      findMany: vi.fn(async (args: ReceiptFindManyArgs) => {
        // The cohort query carries `distinct: ["bookingId"]`; getView's per-booking receipts query
        // does not. Branch on it to serve the right rows regardless of Promise.all interleaving.
        if (args?.distinct) {
          return [{ bookingId: "bk-paid" }, { bookingId: "bk-attention" }];
        }
        const bid = args?.where?.bookingId;
        return typeof bid === "string" ? (receiptsByBooking[bid] ?? []) : [];
      }),
    },
    booking: {
      findFirst: vi.fn(async (args: FindByIdArgs) => bookings[args?.where?.id ?? ""] ?? null),
    },
    contact: {
      findFirst: vi.fn(async (args: FindByIdArgs) => contactsById[args?.where?.id ?? ""] ?? null),
    },
    opportunity: {
      findFirst: vi.fn(
        async (args: FindByIdArgs) => opportunitiesById[args?.where?.id ?? ""] ?? null,
      ),
    },
    conversionRecord: { findFirst: vi.fn(async () => null) },
    lifecycleRevenueEvent: { findMany: vi.fn(async () => []) },
    workTrace: { findFirst: vi.fn(async () => null) },
    receiptedBooking: { findFirst: vi.fn(async () => null) },
  };
}

describe("GET /api/dashboard/reports — real PrismaReceiptedBookingStore projection feeds the owner tiles", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestServer();
    // Wire the receipted-booking report store to the REAL Prisma projection over a mocked client,
    // mirroring the production wiring in app.ts:709-711 (the `listForCohort` adapter that drops the
    // optional `now` to wall-clock). This is the seam under test.
    const store = new PrismaReceiptedBookingStore(makeMockPrisma() as never);
    ctx.app.reportStores!.receiptedBookings = {
      listForCohort: (input) => store.listForCohort(input.orgId, input.from, input.to),
    };
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it("rolls the real cohort projection into receiptedBookingQuality (confidence + exceptions + worklist)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/reports?window=THIS%20WEEK",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const quality = res.json().receiptedBookingQuality;

    expect(quality.cohortSize).toBe(2);
    expect(quality.confidence).toMatchObject({
      deterministic: 1,
      unattributed: 1,
      high: 0,
      medium: 0,
      low: 0,
    });
    expect(quality.exceptions).toMatchObject({
      missing_source: 1,
      missing_consent: 1,
      manual_override: 0,
      duplicate_contact_risk: 0,
    });
    expect(quality.bookingsNeedingAttention).toBe(1);
    // Only bk-attention carries open codes; bk-paid (deterministic, no exceptions) is off the worklist.
    expect(quality.worklist).toHaveLength(1);
    expect(quality.worklist[0]).toMatchObject({
      bookingId: "bk-attention",
      service: "Filler",
      startsAt: "2026-06-15T01:00:00.000Z",
      attributionConfidence: "unattributed",
      openExceptionCodes: ["missing_source", "missing_consent"],
      overridden: false,
      issuedAt: null,
    });
  });

  it("rolls the real cohort projection into receiptedBookingRevenue (expected + proven-paid)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/reports?window=THIS%20WEEK",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const revenue = res.json().receiptedBookingRevenue;

    // Both bookings are pre-issuance (no persisted row) -> live Opportunity value: 45000 + 20000.
    // Only bk-paid has a verified T1 stripe payment receipt (30000) -> proven-paid dimension.
    expect(revenue).toMatchObject({
      revenueCents: 65000,
      bookingsWithValue: 2,
      cohortSize: 2,
      paidRevenueCents: 30000,
      paidBookings: 1,
      currency: null,
    });
  });
});
