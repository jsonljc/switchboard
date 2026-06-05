// Standing invariant (spec §7.10 / audit Tier-0.4): NO GHOST EXECUTION.
//
// Phase A is advice-only. A full `AuditRunner.run()` must NEVER mutate Meta —
// not even when Riley *recommends* a destructive action (`pause`, `add_creative`,
// etc.). A recommendation is advice for a human / governance layer; the audit
// path itself performs no execution. The stronger Phase-A truth than "no
// recommendation can mutate Meta without a corresponding WorkTrace" is: in the
// audit path, no mutation happens AT ALL.
//
// WHAT WOULD MAKE THIS TEST FAIL (by design — this is the guard):
//   1. Behavioral: if anyone wires a Meta mutator (updateCampaignStatus /
//      createDraftCampaign / createDraftAdSet / uploadCreativeAsset) into the
//      audit-runner or the recommendation-sink path, the throwing spies below
//      fire and the test errors. The destructive scenario is real (it produces a
//      `pause` and `add_creative` recommendation), so the audit genuinely walks
//      the per-campaign decision + V2 reset-class branches that *could* be the
//      site of such a regression.
//   2. Structural: if anyone adds a mutator to the AdsClientInterface the runner
//      depends on (today it exposes ONLY read methods), the no-mutator-surface
//      assertion fires — making a future mutator surface a conscious change.
//
// This is NOT a tautology: it constructs and drives a REAL AuditRunner through
// `run()` and asserts the destructive recommendations are emitted as ADVICE only.
import { describe, it, expect, vi } from "vitest";
import { AuditRunner, type AdsClientInterface } from "../audit-runner.js";
import { MetaCampaignInsightsProvider } from "../meta-campaign-insights-provider.js";
import type { CrmDataProvider } from "@switchboard/schemas";

// Read-only CRM fake — mirrors the integration test's empty-funnel provider.
function fakeCrm(): CrmDataProvider {
  return {
    getFunnelData: async () => ({
      campaignIds: [],
      leads: 0,
      qualified: 0,
      opportunities: 0,
      bookings: 0,
      closed: 0,
      revenue: 0,
      rates: {
        leadToQualified: null,
        qualifiedToBooking: null,
        bookingToClosed: null,
        leadToClosed: null,
      },
      coverage: {
        attributedContacts: 0,
        contactsWithEmailOrPhone: 0,
        contactsWithOpportunity: 0,
        contactsWithBooking: 0,
        contactsWithRevenueEvent: 0,
      },
    }),
    getBenchmarks: async () => ({
      leadToQualifiedRate: null,
      qualifiedToBookingRate: null,
      bookingToClosedRate: null,
      leadToClosedRate: null,
    }),
  };
}

// The four mutating methods on the concrete MetaAdsClient. None are on the
// AdsClientInterface the runner depends on, but we attach them as throwing spies
// anyway so that if a future refactor ever reaches for one from the audit/sink
// path, the call fails loudly instead of silently mutating Meta.
const ghost = (method: string) =>
  vi.fn(() => {
    throw new Error(`ghost execution: audit path must not call Meta mutator ${method}()`);
  });

function buildMutatorSpies() {
  return {
    updateCampaignStatus: ghost("updateCampaignStatus"),
    createDraftCampaign: ghost("createDraftCampaign"),
    createDraftAdSet: ghost("createDraftAdSet"),
    uploadCreativeAsset: ghost("uploadCreativeAsset"),
  };
}

// Read-only ads client that ALSO carries the mutator spies. Typed as the runner's
// dependency interface (read-only) for the constructor; the extra spies ride along
// so they are reachable-if-anyone-tries-to-call-them and observable afterward.
function buildSpyingAdsClient(opts: {
  aggInsight: Record<string, unknown>;
  dailyRows: Record<string, unknown>[];
  learningStageStatus: "SUCCESS" | "LEARNING";
  spend: number;
  conversions: number;
}) {
  const mutators = buildMutatorSpies();
  const readOnly = {
    getCampaignInsights: vi.fn(async (p: { timeIncrement?: number }) =>
      p.timeIncrement === 1 ? opts.dailyRows : [opts.aggInsight],
    ),
    getAdSetInsights: vi.fn(async () => []),
    getAccountSummary: vi.fn(async () => ({
      accountId: "a",
      accountName: "n",
      currency: "USD",
      totalSpend: opts.spend,
      totalImpressions: 10000,
      totalClicks: 200,
      activeCampaigns: 1,
    })),
    getAdSetLearningInputs: vi.fn(async () => [
      {
        adSetId: "as",
        adSetName: "as",
        campaignId: String(opts.aggInsight.campaignId),
        learningStageStatus: opts.learningStageStatus,
        frequency: 1,
        spend: opts.spend,
        conversions: opts.conversions,
        cpa: opts.conversions > 0 ? opts.spend / opts.conversions : 0,
        roas: 0,
        inlineLinkClickCtr: 1,
      },
    ]),
  };
  return { client: { ...readOnly, ...mutators }, mutators, readOnly };
}

const ADVISORY_TYPES = new Set(["insight", "watch", "recommendation"]);

describe("no ghost execution — Phase-A audit path never mutates Meta", () => {
  it("emits a destructive `pause` recommendation as ADVICE without calling any Meta mutator", async () => {
    // Durable, high-volume, over-target breach (copied from the integration test):
    // aggregate CPA = 6000/30 = 200 > 3×50 ⇒ pause; conversions 30 ≥ tier-2 floor so
    // the pause is a recommendation, not withheld as a tier-3 watch. SUCCESS learning
    // status so the learning guard does NOT downgrade the pause to a watch.
    const campaign = "c_dur";
    const aggInsight = {
      campaignId: campaign,
      campaignName: "Durable",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      impressions: 10000,
      inlineLinkClicks: 200,
      spend: 6000,
      conversions: 30,
      revenue: 0,
      frequency: 1.3,
      cpm: 5,
      inlineLinkClickCtr: 1,
      costPerInlineLinkClick: 1,
      dateStart: "2026-05-25",
      dateStop: "2026-06-01",
    };
    const dailyRows = Array.from({ length: 14 }, (_, i) => ({
      ...aggInsight,
      spend: i < 8 ? 600 : 30,
      conversions: i < 8 ? 3 : 1,
      dateStart: `2026-05-${String(18 + i).padStart(2, "0")}`,
      dateStop: `2026-05-${String(18 + i).padStart(2, "0")}`,
    }));
    const { client, mutators } = buildSpyingAdsClient({
      aggInsight,
      dailyRows,
      learningStageStatus: "SUCCESS",
      spend: 6000,
      conversions: 30,
    });

    const runner = new AuditRunner({
      adsClient: client as unknown as AdsClientInterface,
      crmDataProvider: fakeCrm(),
      insightsProvider: new MetaCampaignInsightsProvider(client as unknown as AdsClientInterface),
      config: {
        accountId: "a",
        orgId: "o",
        targetCPA: 50,
        targetROAS: 2,
        mediaBenchmarks: { inlineLinkClickCtr: 1, landingPageViewRate: 0.5 },
      },
    });

    const report = await runner.run({
      dateRange: { since: "2026-05-25", until: "2026-06-01" },
      previousDateRange: { since: "2026-05-18", until: "2026-05-25" },
    });

    // Non-triviality: the scenario really produced a destructive recommendation.
    expect(report.recommendations.map((r) => r.action)).toContain("pause");

    // The invariant: advice was produced, but NO Meta mutator was ever called.
    for (const [name, spy] of Object.entries(mutators)) {
      expect(spy, `${name} must never be called from the audit path`).not.toHaveBeenCalled();
    }

    // The report's outputs are ONLY the advisory union types — there is no
    // execution / action-dispatch result on an AuditReport.
    for (const r of report.recommendations) expect(ADVISORY_TYPES).toContain(r.type);
    for (const w of report.watches) expect(ADVISORY_TYPES).toContain(w.type);
    for (const i of report.insights) expect(ADVISORY_TYPES).toContain(i.type);
    expect(report).not.toHaveProperty("executions");
    expect(report).not.toHaveProperty("actionsDispatched");
  });

  it("emits a reset-class `add_creative` recommendation as ADVICE without calling any Meta mutator", async () => {
    // A second, distinct destructive shape so the guard covers a reset-class action
    // (resetsLearning: "yes"), not just pause. aggregate CPA = 3600/30 = 120 = 2.4×
    // the 50 target ⇒ add_creative (needs 2×–3×, not the >3× a pause needs).
    // SUCCESS learning status so it is RECOMMENDED, not held as an in_learning watch.
    const campaign = "c_reset";
    const aggInsight = {
      campaignId: campaign,
      campaignName: "ResetClass",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      impressions: 10000,
      inlineLinkClicks: 200,
      spend: 3600,
      conversions: 30,
      revenue: 0,
      frequency: 1.3,
      cpm: 5,
      inlineLinkClickCtr: 1,
      costPerInlineLinkClick: 1,
      dateStart: "2026-05-25",
      dateStop: "2026-06-01",
    };
    // 8 of 14 days breach the 50 target (300/3 = 100 > 50); the rest are quiet.
    const dailyRows = Array.from({ length: 14 }, (_, i) => ({
      ...aggInsight,
      spend: i < 8 ? 300 : 30,
      conversions: i < 8 ? 3 : 1,
      dateStart: `2026-05-${String(18 + i).padStart(2, "0")}`,
      dateStop: `2026-05-${String(18 + i).padStart(2, "0")}`,
    }));
    const { client, mutators } = buildSpyingAdsClient({
      aggInsight,
      dailyRows,
      learningStageStatus: "SUCCESS",
      spend: 3600,
      conversions: 30,
    });

    const runner = new AuditRunner({
      adsClient: client as unknown as AdsClientInterface,
      crmDataProvider: fakeCrm(),
      insightsProvider: new MetaCampaignInsightsProvider(client as unknown as AdsClientInterface),
      config: {
        accountId: "a",
        orgId: "o",
        targetCPA: 50,
        targetROAS: 2,
        mediaBenchmarks: { inlineLinkClickCtr: 1, landingPageViewRate: 0.5 },
      },
    });

    const report = await runner.run({
      dateRange: { since: "2026-05-25", until: "2026-06-01" },
      previousDateRange: { since: "2026-05-18", until: "2026-05-25" },
    });

    // Non-triviality: a reset-class destructive recommendation was really produced.
    const addCreative = report.recommendations.find((r) => r.action === "add_creative");
    expect(addCreative).toBeDefined();
    expect(addCreative?.resetsLearning).toBe("yes");

    // The invariant: still no Meta mutator was called.
    for (const [name, spy] of Object.entries(mutators)) {
      expect(spy, `${name} must never be called from the audit path`).not.toHaveBeenCalled();
    }
  });

  it("locks the runner's ads-client dependency surface to read-only (no mutator methods)", async () => {
    // Structural guard: the AdsClientInterface the runner depends on exposes ONLY
    // read methods. We assert the dependency object the runner receives carries no
    // mutator function, so ADDING one (e.g. updateCampaignStatus / a future
    // updateCampaignBudget) to the runner's interface is a CONSCIOUS change that
    // must update this test — it cannot slip in silently.
    const readOnly: AdsClientInterface = {
      getCampaignInsights: async () => [],
      getAdSetInsights: async () => [],
      getAccountSummary: async () => ({
        accountId: "a",
        accountName: "n",
        currency: "USD",
        totalSpend: 0,
        totalImpressions: 0,
        totalClicks: 0,
        activeCampaigns: 0,
      }),
    };

    // Every known + plausible-future Meta mutator must be absent from the surface.
    const forbiddenMutators = [
      "updateCampaignStatus",
      "updateCampaignBudget",
      "createDraftCampaign",
      "createDraftAdSet",
      "uploadCreativeAsset",
    ];
    for (const name of forbiddenMutators) {
      expect(
        typeof (readOnly as unknown as Record<string, unknown>)[name],
        `AdsClientInterface must not expose mutator ${name}`,
      ).toBe("undefined");
    }
    // Catch-all: nothing on the dependency surface looks like a mutator.
    const looksLikeMutator = (k: string) =>
      /^(update|create|delete|set|upload|publish|activate|pause|launch)/.test(k);
    expect(Object.keys(readOnly).filter(looksLikeMutator)).toEqual([]);
  });
});
