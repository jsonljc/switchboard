import { describe, it, expect } from "vitest";
import { MetaCampaignInsightsProvider } from "@switchboard/ad-optimizer";
import type { AdsClientInterface } from "@switchboard/ad-optimizer";
import type { CampaignInsightSchema as CampaignInsight } from "@switchboard/schemas";

/**
 * DENOMINATOR-REGRESSION GUARD (Phase-A spec §11 — the eval's reason for existing).
 *
 * Riley's whole abstention/act decision hinges on the target-breach COUNT, and that
 * count's per-day conversions denominator was corrected to read a specific Meta
 * `actions` action_type under a pinned attribution window (see
 * `meta-campaign-insights-provider.ts` `getTargetBreachStatus`) instead of Meta's
 * unfiltered aggregate `conversions` field. The aggregate field silently mixes
 * conversion events and attribution windows, so a campaign can look fine on the
 * aggregate while the booked-action denominator says it is breaching (or vice versa).
 *
 * The riley-recommendation matrix passes `targetBreach.periodsAboveTarget` as a fixture
 * LITERAL into the decide seam, so it can NOT see a revert of the denominator. THIS
 * test exercises the REAL provider end-to-end with daily rows constructed so the two
 * denominators give DIFFERENT breach counts, and asserts the ACTION_TYPE count.
 *
 * >>> THIS TEST FLIPS RED if anyone reverts `getTargetBreachStatus` to count breaches
 * >>> off the unfiltered aggregate `conversions` field instead of the configured
 * >>> action_type. That revert is exactly the silent regression the eval gate exists
 * >>> to catch. Do not "fix" this test by loosening the assertion — fix the engine.
 *
 * Deterministic, model-free, DB-free, no network: the ads client is a fake that
 * returns fixed rows (mirrors the fake-client pattern in
 * `meta-campaign-insights-provider.test.ts`).
 */

// Build a fake ads client returning the given partial daily rows (filled to a full
// CampaignInsight). All rows are for campaign "c1".
function fakeClient(rows: Partial<CampaignInsight>[]): AdsClientInterface {
  const full = rows.map((r) => ({
    campaignId: "c1",
    campaignName: "C1",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 0,
    inlineLinkClicks: 0,
    spend: 0,
    conversions: 0,
    revenue: 0,
    frequency: 0,
    cpm: 0,
    inlineLinkClickCtr: 0,
    costPerInlineLinkClick: 0,
    dateStart: "",
    dateStop: "",
    ...r,
  })) as CampaignInsight[];
  return {
    getCampaignInsights: async () => full,
    getAdSetInsights: async () => [],
    getAccountSummary: async () => ({
      accountId: "a",
      accountName: "A",
      currency: "USD",
      totalSpend: 0,
      totalImpressions: 0,
      totalClicks: 0,
      activeCampaigns: 1,
    }),
  };
}

const breachArgs = {
  orgId: "o",
  accountId: "a",
  campaignId: "c1",
  targetCPA: 100,
  startDate: new Date("2026-05-01"),
  endDate: new Date("2026-05-14"),
};

// Divergent-count construction: every one of 14 days has
//   - aggregate `conversions` = 10  → cpa 200/10 = 20  ≤ 100  → NOT a breach
//   - action_type "lead" value = "1" → cpa 200/1  = 200 > 100  → A breach
// 40 clicks/day keeps the volume gate satisfied so zero-day handling never interferes.
// The two denominators therefore disagree on EVERY day: aggregate => 0 breaches,
// action_type => 14 breaches. That gap is the guard's whole point.
function divergentRows(): Partial<CampaignInsight>[] {
  return Array.from({ length: 14 }, () => ({
    spend: 200,
    conversions: 10,
    inlineLinkClicks: 40,
    actions: [{ action_type: "lead", value: "1" }],
  }));
}

describe("denominator-regression guard (real MetaCampaignInsightsProvider.getTargetBreachStatus)", () => {
  it("counts breaches off the configured action_type, NOT the aggregate conversions field", async () => {
    const provider = new MetaCampaignInsightsProvider(fakeClient(divergentRows()));

    const actionTypeResult = await provider.getTargetBreachStatus({
      ...breachArgs,
      conversionActionType: "lead",
      attributionWindows: ["7d_click"],
    });
    const aggregateResult = await provider.getTargetBreachStatus(breachArgs);

    // Sanity: the construction genuinely diverges. If these two ever match, the test
    // no longer guards anything — the rows must be fixed to restore divergence.
    expect(actionTypeResult.periodsAboveTarget).not.toBe(aggregateResult.periodsAboveTarget);

    // The guard: with conversionActionType set, the breach count is action_type-based.
    // 14 days, lead-cpa 200 > 100 each → 14. A revert to the aggregate `conversions`
    // denominator would yield 0 here (aggregate cpa 20 ≤ 100) and flip this RED.
    expect(actionTypeResult.periodsAboveTarget).toBe(14);
    expect(actionTypeResult.granularity).toBe("daily");

    // Back-compat anchor: unset → aggregate denominator → 0 breaches (the pre-fix path).
    expect(aggregateResult.periodsAboveTarget).toBe(0);
  });

  it("pins the action_type denominator + a stable attribution window on the Meta call", async () => {
    const calls: Array<{ fields?: string[]; actionAttributionWindows?: string[] }> = [];
    const client: AdsClientInterface = {
      getCampaignInsights: async (p) => {
        calls.push(p);
        return divergentRows().map((r) => ({
          campaignId: "c1",
          campaignName: "C1",
          status: "ACTIVE",
          effectiveStatus: "ACTIVE",
          impressions: 0,
          inlineLinkClicks: 0,
          spend: 0,
          conversions: 0,
          revenue: 0,
          frequency: 0,
          cpm: 0,
          inlineLinkClickCtr: 0,
          costPerInlineLinkClick: 0,
          dateStart: "",
          dateStop: "",
          ...r,
        })) as CampaignInsight[];
      },
      getAdSetInsights: async () => [],
      getAccountSummary: async () => ({
        accountId: "a",
        accountName: "A",
        currency: "USD",
        totalSpend: 0,
        totalImpressions: 0,
        totalClicks: 0,
        activeCampaigns: 1,
      }),
    };

    await new MetaCampaignInsightsProvider(client).getTargetBreachStatus({
      ...breachArgs,
      conversionActionType: "lead",
      attributionWindows: ["7d_click"],
    });

    // The action_type denominator is only stable run-to-run if the `actions` breakdown
    // is requested under a PINNED attribution window. A revert that drops either of
    // these (back to unfiltered aggregate `conversions`) would also fail here.
    const call = calls[0]!;
    expect(call.fields).toContain("actions");
    expect(call.actionAttributionWindows).toEqual(["7d_click"]);
  });
});
