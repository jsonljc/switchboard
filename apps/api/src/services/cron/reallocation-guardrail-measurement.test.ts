import { describe, it, expect, vi } from "vitest";
import { buildReallocationGuardrailMeasurement } from "./reallocation-guardrail-measurement.js";
import { DEFAULT_BLAST_RADIUS_CONTRACT, type PendingReallocation } from "@switchboard/ad-optimizer";

const APPLIED = new Date("2026-06-22T00:00:00.000Z");

function pending(over: Partial<PendingReallocation> = {}): PendingReallocation {
  return {
    executionWorkUnitId: "wu-fwd-1",
    deploymentId: "dep-1",
    organizationId: "org-1",
    adAccountId: "act_1",
    campaignId: "c1",
    observedPriorCents: 5000,
    appliedAt: APPLIED,
    // Increase: live (6000) > prior (5000), so freedBudget is 0.
    contract: DEFAULT_BLAST_RADIUS_CONTRACT,
    ...over,
  };
}

describe("buildReallocationGuardrailMeasurement", () => {
  it("computes account_booked_conversions_drop_share from a pre/post window pair", async () => {
    // baseline 10 bookings, post 7 -> drop share 0.3.
    const getBookedCountForWindow = vi.fn(async (args: { startInclusive: Date }) =>
      args.startInclusive.getTime() < APPLIED.getTime() ? 10 : 7,
    );
    const measure = buildReallocationGuardrailMeasurement({
      getCampaignBudgetCents: async () => 6000,
      getBookedCountForWindow,
    });
    const m = await measure(pending());
    expect(m.shares.account_booked_conversions_drop_share).toBeCloseTo(0.3, 5);
    expect(m.currentLiveCents).toBe(6000);
    // freed budget is 0 for an increase -> absorbed share is definitionally 0 (under the cap).
    expect(m.shares.freed_budget_absorbed_share).toBe(0);
  });

  it("treats a zero baseline as a 0 drop (you cannot drop below zero bookings)", async () => {
    const measure = buildReallocationGuardrailMeasurement({
      getCampaignBudgetCents: async () => 6000,
      getBookedCountForWindow: async (args: { startInclusive: Date }) =>
        args.startInclusive.getTime() < APPLIED.getTime() ? 0 : 5,
    });
    const m = await measure(pending());
    expect(m.shares.account_booked_conversions_drop_share).toBe(0);
  });

  it("OMITS the drop metric when a booked-count read is unmeasurable (null) -> the monitor trips", async () => {
    const measure = buildReallocationGuardrailMeasurement({
      getCampaignBudgetCents: async () => 6000,
      getBookedCountForWindow: async () => null, // CRM unavailable
    });
    const m = await measure(pending());
    expect("account_booked_conversions_drop_share" in m.shares).toBe(false);
  });

  it("OMITS both shares and reports NaN currentLiveCents when the live budget is unreadable", async () => {
    const measure = buildReallocationGuardrailMeasurement({
      getCampaignBudgetCents: async () => null, // Meta unreadable
      getBookedCountForWindow: async () => 5,
    });
    const m = await measure(pending());
    expect(Number.isNaN(m.currentLiveCents)).toBe(true);
    // drop is still measurable from CRM, but absorbed needs the live budget -> omitted.
    expect("freed_budget_absorbed_share" in m.shares).toBe(false);
  });

  it("OMITS freed_budget_absorbed_share on a DECREASE (freed > 0): absorption is deferred -> trips", async () => {
    // live (4000) < prior (5000) -> freed 1000; the v1 provider cannot yet measure absorption.
    const measure = buildReallocationGuardrailMeasurement({
      getCampaignBudgetCents: async () => 4000,
      getBookedCountForWindow: async () => 5,
    });
    const m = await measure(pending());
    expect("freed_budget_absorbed_share" in m.shares).toBe(false);
  });

  it("queries the booked windows anchored on appliedAt (pre = [applied-w, applied), post = [applied, applied+w))", async () => {
    const calls: Array<{ startInclusive: Date; endExclusive: Date }> = [];
    const measure = buildReallocationGuardrailMeasurement({
      getCampaignBudgetCents: async () => 6000,
      getBookedCountForWindow: async (a: { startInclusive: Date; endExclusive: Date }) => {
        calls.push(a);
        return 5;
      },
    });
    await measure(pending());
    // 72h window from the DEFAULT contract.
    const w = 72 * 60 * 60 * 1000;
    const post = calls.find((c) => c.startInclusive.getTime() === APPLIED.getTime())!;
    expect(post.endExclusive.getTime()).toBe(APPLIED.getTime() + w);
    const pre = calls.find((c) => c.endExclusive.getTime() === APPLIED.getTime())!;
    expect(pre.startInclusive.getTime()).toBe(APPLIED.getTime() - w);
  });
});
