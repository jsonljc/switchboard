import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PrismaReceiptedBookingStore } from "@switchboard/db";
import { buildTestServer, type TestContext } from "./test-server.js";

/**
 * P3.2: real-store integration proof for the owner-report receipted-booking tiles.
 *
 * The gap this closes: every layer used to stub `receiptedBookings.listForCohort: async () => []`
 * (test-server.ts:411, period-rollup.test.ts:54), so the route's `receiptedBookingQuality` /
 * `receiptedBookingRevenue` tiles were only ever exercised against an empty static fixture. These
 * tests drive the FULL chain (GET /api/dashboard/reports -> createPeriodRollup -> the
 * app.ts-shaped `listForCohort` adapter -> the REAL `PrismaReceiptedBookingStore` projection
 * (getView over the calendar-receipt cohort) -> the two tile rollups), so a regression anywhere on
 * that producer -> consumer seam is caught, not silently swallowed by a `() => []` stub.
 *
 * Only the Prisma client (the data source) and the OTHER report stores (test-server defaults) are
 * faked; the receipted-booking projection under test is the real production code. Coverage:
 *  - a populated 2-booking cohort: both tiles, counts + revenue cents equal the rollup math;
 *  - an EMPTY cohort: every tile is the zero/empty shape (never NaN, never a throw);
 *  - a NaN / negative / absent-value + paid-without-amount cohort: the revenue guards exclude every
 *    bad term while the one finite term still sums, and no headline figure renders NaN.
 */

// Minimal arg shapes for the mocked Prisma legs the store touches (no `any`; cast to never at the
// store boundary, mirroring prisma-receipted-booking-store.test.ts).
type ReceiptFindManyArgs = { where?: { bookingId?: unknown }; distinct?: readonly string[] };
type FindByIdArgs = { where?: { id?: string } };

interface ContactSpec {
  leadgenId?: string | null;
  sourceType?: string | null;
  firstTouchChannel?: string | null;
  pdpaJurisdiction?: string | null;
  consentGrantedAt?: Date | null;
  consentRevokedAt?: Date | null;
}

interface PaymentSpec {
  provider: string | null;
  tier: string;
  status: string;
  amount: number | null;
}

/**
 * One receipted booking in the cohort. The `ct-<id>` / `opp-<id>` foreign keys are derived so each
 * spec stays a single self-contained literal. `contact: null` (or omitted) models a booking with no
 * Contact row (contactId null). `opportunity: null` (or omitted) models an ABSENT Opportunity row
 * (the expected value falls to null); an object models a live Opportunity value: finite, NaN, or
 * negative, each of which the revenue rollup must guard.
 */
interface CohortSpec {
  id: string;
  service: string;
  startsAt: Date;
  calendarStatus: "booked" | "held";
  attendance?: string | null;
  contact?: ContactSpec | null;
  opportunity?: { estimatedValue: number } | null;
  payment?: PaymentSpec | null;
}

/**
 * A mocked PrismaClient that branches by query args (NOT mockResolvedValueOnce): listForCohort fans
 * getView out over the cohort with Promise.all, so call-order chaining across a multi-booking cohort
 * is racy. Branching on the args is deterministic regardless of interleaving. The same factory drives
 * the populated, empty, and guard cohorts so the projection under test is identical across all three.
 */
function makeMockPrisma(cohort: CohortSpec[]) {
  const bookingsById: Record<
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
  > = {};
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
  > = {};
  const contactsById: Record<string, ContactSpec & { id: string }> = {};
  const opportunitiesById: Record<string, { estimatedValue: number }> = {};

  for (const m of cohort) {
    const contactId = m.contact ? `ct-${m.id}` : null;
    bookingsById[m.id] = {
      id: m.id,
      contactId,
      opportunityId: `opp-${m.id}`,
      workTraceId: null,
      attendance: m.attendance ?? null,
      service: m.service,
      startsAt: m.startsAt,
    };
    receiptsByBooking[m.id] = [
      {
        id: `cal-${m.id}`,
        kind: "calendar",
        status: m.calendarStatus,
        provider: null,
        tier: "T1_FETCH_BACK",
        amount: null,
      },
      ...(m.payment
        ? [
            {
              id: `pay-${m.id}`,
              kind: "payment",
              status: m.payment.status,
              provider: m.payment.provider,
              tier: m.payment.tier,
              amount: m.payment.amount,
            },
          ]
        : []),
    ];
    if (m.contact && contactId) contactsById[contactId] = { id: contactId, ...m.contact };
    // Only register the Opportunity row when a value is given; an omitted/null opportunity leaves the
    // lookup empty so getView's findFirst returns null and expectedValue falls to null.
    if (m.opportunity) opportunitiesById[`opp-${m.id}`] = m.opportunity;
  }

  return {
    receipt: {
      findMany: vi.fn(async (args: ReceiptFindManyArgs) => {
        // The cohort query carries `distinct: ["bookingId"]`; getView's per-booking receipts query
        // does not. Branch on it to serve the right rows regardless of Promise.all interleaving.
        if (args?.distinct) return cohort.map((m) => ({ bookingId: m.id }));
        const bid = args?.where?.bookingId;
        return typeof bid === "string" ? (receiptsByBooking[bid] ?? []) : [];
      }),
    },
    booking: {
      findFirst: vi.fn(async (args: FindByIdArgs) => bookingsById[args?.where?.id ?? ""] ?? null),
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

// Deterministic timestamps. The cohort query is date-agnostic in the mock, so these only feed the
// worklist row's `startsAt`; the report window itself is irrelevant to the projection under test.
const startsPaid = new Date("2026-06-16T02:00:00Z");
const startsAttention = new Date("2026-06-15T01:00:00Z");
const consentAt = new Date("2026-06-10T00:00:00Z");

/**
 * Populated cohort exercising both tiles:
 *  - bk-paid:      leadgenId -> deterministic attribution; null jurisdiction -> no exceptions; a
 *                  verified T1 stripe payment receipt (30000) -> paid; live Opportunity 45000, no
 *                  persisted issuance row -> expected falls back to live.
 *  - bk-attention: no source -> unattributed + missing_source; SG jurisdiction + no consent ->
 *                  missing_consent; no payment receipt -> not paid; live Opportunity 20000.
 */
const POPULATED_COHORT: CohortSpec[] = [
  {
    id: "bk-paid",
    service: "Botox consult",
    startsAt: startsPaid,
    calendarStatus: "booked",
    attendance: "attended",
    contact: {
      leadgenId: "lead-paid",
      sourceType: "ctwa",
      firstTouchChannel: "instagram",
      pdpaJurisdiction: null,
      consentGrantedAt: consentAt,
      consentRevokedAt: null,
    },
    opportunity: { estimatedValue: 45000 },
    payment: { provider: "stripe", tier: "T1_FETCH_BACK", status: "paid", amount: 30000 },
  },
  {
    id: "bk-attention",
    service: "Filler",
    startsAt: startsAttention,
    calendarStatus: "held",
    attendance: null,
    contact: {
      leadgenId: null,
      sourceType: null,
      firstTouchChannel: null,
      pdpaJurisdiction: "SG",
      consentGrantedAt: null,
      consentRevokedAt: null,
    },
    opportunity: { estimatedValue: 20000 },
  },
];

/**
 * Guard cohort: each member forces a different revenue-guard branch, plus one good member proves a
 * finite term still sums. NaN / negative / absent expected values must never poison the totals
 * (the rollup is NaN-safe per feedback_nan_blind_comparison_gates), and a verified-paid receipt with
 * no captured amount must count the booking as paid while contributing 0 (never NaN) to paid revenue.
 */
const GUARD_COHORT: CohortSpec[] = [
  {
    id: "bk-nan",
    service: "NaN value",
    startsAt: startsAttention,
    calendarStatus: "booked",
    opportunity: { estimatedValue: Number.NaN },
  },
  {
    id: "bk-neg",
    service: "Negative value",
    startsAt: startsAttention,
    calendarStatus: "booked",
    opportunity: { estimatedValue: -100 },
  },
  {
    id: "bk-absent",
    service: "Absent value",
    startsAt: startsAttention,
    calendarStatus: "held",
    opportunity: null,
  },
  {
    id: "bk-good",
    service: "Good value, paid no amount",
    startsAt: startsPaid,
    calendarStatus: "booked",
    opportunity: { estimatedValue: 5000 },
    payment: { provider: "stripe", tier: "T1_FETCH_BACK", status: "paid", amount: null },
  },
];

describe("GET /api/dashboard/reports: real PrismaReceiptedBookingStore projection feeds the owner tiles", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestServer();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  // Wire the receipted-booking report store to the REAL Prisma projection over a mocked client,
  // mirroring the production wiring in app.ts:709-711 (the `listForCohort` adapter that drops the
  // optional `now` to wall-clock). This object-arg -> positional-arg adapter is the seam under test.
  function wireRealStore(cohort: CohortSpec[]) {
    const store = new PrismaReceiptedBookingStore(makeMockPrisma(cohort) as never);
    ctx.app.reportStores!.receiptedBookings = {
      listForCohort: (input) => store.listForCohort(input.orgId, input.from, input.to),
    };
  }

  function getReport() {
    return ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/reports?window=THIS%20WEEK",
      headers: { "x-org-id": "org-1" },
    });
  }

  it("rolls the real cohort projection into receiptedBookingQuality (confidence + exceptions + worklist)", async () => {
    wireRealStore(POPULATED_COHORT);
    const res = await getReport();
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
    wireRealStore(POPULATED_COHORT);
    const res = await getReport();
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

  it("returns the zero/empty tile shape for an empty cohort (no NaN, no throw)", async () => {
    wireRealStore([]);
    const res = await getReport();
    expect(res.statusCode).toBe(200);

    expect(res.json().receiptedBookingRevenue).toMatchObject({
      revenueCents: 0,
      bookingsWithValue: 0,
      cohortSize: 0,
      paidRevenueCents: 0,
      paidBookings: 0,
      currency: null,
    });
    const quality = res.json().receiptedBookingQuality;
    expect(quality).toMatchObject({ cohortSize: 0, bookingsNeedingAttention: 0 });
    expect(quality.confidence).toMatchObject({
      deterministic: 0,
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
    expect(quality.worklist).toEqual([]);
  });

  it("guards the revenue tile against NaN / negative / absent values and paid-without-amount", async () => {
    wireRealStore(GUARD_COHORT);
    const res = await getReport();
    expect(res.statusCode).toBe(200);
    const revenue = res.json().receiptedBookingRevenue;

    // Only bk-good (5000) is a finite, nonnegative expected value; the NaN, negative, and absent
    // members are excluded by the rollup guards (Number.isFinite + `>= 0` + the null/typeof check).
    // bk-good is verified-paid (stripe T1 "paid") but carries no amount, so it counts a paid booking
    // while contributing 0 (not NaN) to paidRevenueCents.
    expect(revenue).toMatchObject({
      cohortSize: 4,
      revenueCents: 5000,
      bookingsWithValue: 1,
      paidRevenueCents: 0,
      paidBookings: 1,
      currency: null,
    });
    // The headline figures must never render NaN even with poisoned inputs in the cohort. (A NaN
    // would serialize to JSON `null`, so these also fail loudly if a guard regresses.)
    expect(Number.isFinite(revenue.revenueCents)).toBe(true);
    expect(Number.isFinite(revenue.paidRevenueCents)).toBe(true);
  });
});
