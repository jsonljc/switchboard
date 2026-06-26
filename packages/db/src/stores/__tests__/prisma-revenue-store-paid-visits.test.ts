import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaRevenueStore } from "../prisma-revenue-store.js";

// P3-7: paidVisitsByCampaign must attribute a paid visit DETERMINISTICALLY — the same input must
// yield the same per-campaign result regardless of the (unordered) DB row order. Two seams were
// non-deterministic: the per-booking receipt gate (first receipt won, so a Noop could mask a real
// T1 and drop the visit) and the per-booking campaign pick (first conversion row won). These tests
// shuffle the mocked row order and assert the verdict does not move.

const now = new Date("2026-03-25T12:00:00Z");
const FROM = new Date("2026-06-01T00:00:00Z");
const TO = new Date("2026-06-30T23:59:59Z");

function makeMockPrisma() {
  return {
    lifecycleRevenueEvent: { findMany: vi.fn().mockResolvedValue([]) },
    conversionRecord: { findMany: vi.fn().mockResolvedValue([]) },
    receipt: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

function paidEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "ev-1",
    amount: 50000, // cents
    currency: "SGD",
    bookingId: "bk-1",
    origin: "live",
    recordedAt: now,
    ...overrides,
  };
}

describe("PrismaRevenueStore.paidVisitsByCampaign — determinism (P3-7)", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaRevenueStore;
  const runProd = () =>
    store.paidVisitsByCampaign({ orgId: "org-1", from: FROM, to: TO, isProduction: true });

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaRevenueStore(prisma as never);
  });

  it("FIX A: a booking with BOTH a Noop and a real T1 receipt counts regardless of receipt row order (existential over the booking's receipts)", async () => {
    prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([
      paidEvent({ id: "ev-both", bookingId: "bk-both" }),
    ]);
    prisma.conversionRecord.findMany.mockResolvedValue([
      { bookingId: "bk-both", sourceCampaignId: "camp-1", createdAt: now, id: "cr-both" },
    ]);
    const noop = { bookingId: "bk-both", provider: "noop", tier: "T3_ADMIN_AUDIT" };
    const realT1 = { bookingId: "bk-both", provider: "stripe", tier: "T1_FETCH_BACK" };
    // Either receipt order -> KEPT exactly once, full amount: the Noop must never mask the real T1
    // (so no non-deterministic drop), and the visit is counted once (no inflation of the total).
    for (const receipts of [
      [noop, realT1],
      [realT1, noop],
    ]) {
      prisma.receipt.findMany.mockResolvedValue(receipts);
      const rows = await runProd();
      expect(rows.map((r) => r.bookingId)).toEqual(["bk-both"]);
      expect(rows[0]!.amountCents).toBe(50000);
    }
  });

  it("FIX B: a booking with multiple ConversionRecords attributes to its EARLIEST-touch campaign regardless of conversion row order", async () => {
    prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([paidEvent({ bookingId: "bk" })]);
    prisma.receipt.findMany.mockResolvedValue([
      { bookingId: "bk", provider: "stripe", tier: "T1_FETCH_BACK" },
    ]);
    const early = { bookingId: "bk", sourceCampaignId: "c-early", createdAt: new Date(1), id: "a" };
    const late = { bookingId: "bk", sourceCampaignId: "c-late", createdAt: new Date(2), id: "b" };
    for (const conversions of [
      [late, early], // shuffled
      [early, late],
    ]) {
      prisma.conversionRecord.findMany.mockResolvedValue(conversions);
      const rows = await runProd();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sourceCampaignId).toBe("c-early");
      expect(rows[0]!.attributionBasis).toBe("ctwa_captured");
    }
  });

  it("leaves ordinary single-receipt paid visits unchanged (count + summed amount preserved)", async () => {
    prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([
      paidEvent({ id: "ev-1", bookingId: "bk-1", amount: 50000 }),
      paidEvent({ id: "ev-2", bookingId: "bk-2", amount: 12000 }),
    ]);
    prisma.conversionRecord.findMany.mockResolvedValue([
      { bookingId: "bk-1", sourceCampaignId: "camp-1", createdAt: now, id: "cr-1" },
      { bookingId: "bk-2", sourceCampaignId: "camp-2", createdAt: now, id: "cr-2" },
    ]);
    prisma.receipt.findMany.mockResolvedValue([
      { bookingId: "bk-1", provider: "stripe", tier: "T1_FETCH_BACK" },
      { bookingId: "bk-2", provider: "stripe", tier: "T1_FETCH_BACK" },
    ]);
    const rows = await runProd();
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(62000);
  });
});
