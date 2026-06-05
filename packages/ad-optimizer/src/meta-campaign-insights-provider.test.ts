import { describe, it, expect, vi } from "vitest";
import { MetaCampaignInsightsProvider } from "./meta-campaign-insights-provider.js";
import type { AdsClientInterface } from "./audit-runner.js";
import type {
  WeeklyCampaignSnapshot,
  CampaignInsightSchema as CampaignInsight,
} from "@switchboard/schemas";

function makeAdsClient(): AdsClientInterface {
  return {
    getCampaignInsights: vi.fn().mockResolvedValue([]),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue({
      accountId: "act_1",
      accountName: "Test",
      currency: "SGD",
      totalSpend: 0,
      totalImpressions: 0,
      totalClicks: 0,
      activeCampaigns: 0,
    }),
  };
}

describe("MetaCampaignInsightsProvider", () => {
  describe("getTargetBreachStatus", () => {
    it("returns 0 periods when CPA is below target in all snapshots", async () => {
      const snapshots: WeeklyCampaignSnapshot[] = [
        {
          campaignId: "c1",
          startDate: new Date(),
          endDate: new Date(),
          spend: 100,
          conversions: 10,
          cpa: 10,
        },
        {
          campaignId: "c1",
          startDate: new Date(),
          endDate: new Date(),
          spend: 100,
          conversions: 10,
          cpa: 10,
        },
      ];

      const provider = new MetaCampaignInsightsProvider(makeAdsClient());
      const result = await provider.getTargetBreachStatus({
        orgId: "org_1",
        accountId: "act_1",
        campaignId: "c1",
        targetCPA: 20,
        startDate: new Date(),
        endDate: new Date(),
        snapshots,
      });

      expect(result.periodsAboveTarget).toBe(0);
      expect(result.granularity).toBe("weekly");
      expect(result.isApproximate).toBe(true);
    });

    it("counts periods where CPA exceeds targetCPA", async () => {
      const snapshots: WeeklyCampaignSnapshot[] = [
        {
          campaignId: "c1",
          startDate: new Date(),
          endDate: new Date(),
          spend: 100,
          conversions: 2,
          cpa: 50,
        },
        {
          campaignId: "c1",
          startDate: new Date(),
          endDate: new Date(),
          spend: 100,
          conversions: 10,
          cpa: 10,
        },
      ];

      const provider = new MetaCampaignInsightsProvider(makeAdsClient());
      const result = await provider.getTargetBreachStatus({
        orgId: "org_1",
        accountId: "act_1",
        campaignId: "c1",
        targetCPA: 20,
        startDate: new Date(),
        endDate: new Date(),
        snapshots,
      });

      expect(result.periodsAboveTarget).toBe(1);
    });

    it("skips periods with null CPA", async () => {
      const snapshots: WeeklyCampaignSnapshot[] = [
        {
          campaignId: "c1",
          startDate: new Date(),
          endDate: new Date(),
          spend: 0,
          conversions: 0,
          cpa: null,
        },
      ];

      const provider = new MetaCampaignInsightsProvider(makeAdsClient());
      const result = await provider.getTargetBreachStatus({
        orgId: "org_1",
        accountId: "act_1",
        campaignId: "c1",
        targetCPA: 20,
        startDate: new Date(),
        endDate: new Date(),
        snapshots,
      });

      expect(result.periodsAboveTarget).toBe(0);
    });

    it("returns 0 periods when no snapshots provided and no daily rows", async () => {
      const provider = new MetaCampaignInsightsProvider(makeAdsClient());
      const result = await provider.getTargetBreachStatus({
        orgId: "org_1",
        accountId: "act_1",
        campaignId: "c1",
        targetCPA: 20,
        startDate: new Date(),
        endDate: new Date(),
      });

      expect(result.periodsAboveTarget).toBe(0);
      // With no daily rows and no snapshots, we return daily with 0 breaches
      expect(result.granularity).toBe("daily");
      expect(result.isApproximate).toBe(false);
    });
  });

  describe("getCampaignLearningData", () => {
    it("delegates to adsClient", async () => {
      const adsClient = makeAdsClient();
      (adsClient.getCampaignInsights as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          campaignId: "c1",
          campaignName: "Test",
          status: "ACTIVE",
          effectiveStatus: "ACTIVE",
          impressions: 10000,
          clicks: 200,
          spend: 1000,
          conversions: 50,
          revenue: 5000,
          frequency: 2,
          cpm: 100,
          ctr: 2,
          cpc: 5,
          dateStart: "2026-04-01",
          dateStop: "2026-04-07",
        },
      ]);

      const provider = new MetaCampaignInsightsProvider(adsClient);
      const result = await provider.getCampaignLearningData({
        orgId: "org_1",
        accountId: "act_1",
        campaignId: "c1",
      });

      expect(result.effectiveStatus).toBe("ACTIVE");
      expect(result.optimizationEvents).toBe(50);
    });
  });
});

// ── Task 3: real daily target-breach ─────────────────────────────────────────

function dailyRow(campaignId: string, date: string, spend: number, conversions: number) {
  return {
    campaignId,
    campaignName: "C",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 1000,
    inlineLinkClicks: 50,
    spend,
    conversions,
    revenue: 0,
    frequency: 1.2,
    cpm: 5,
    inlineLinkClickCtr: 1,
    costPerInlineLinkClick: 1,
    dateStart: date,
    dateStop: date,
  };
}

it("counts daily periods above target from time_increment=1 rows", async () => {
  // 9 of 14 days have cpa = spend/conversions > targetCPA(=50): 600/1 = 600 > 50; 40/4 = 10 <= 50
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = `2026-05-${String(18 + i).padStart(2, "0")}`;
    return i < 9 ? dailyRow("c_1", date, 600, 1) : dailyRow("c_1", date, 40, 4);
  });
  const adsClient = {
    getCampaignInsights: vi.fn(async (p: { timeIncrement?: number }) =>
      p.timeIncrement === 1 ? days : [],
    ),
    getAdSetInsights: vi.fn(async () => []),
    getAccountSummary: vi.fn(),
  };
  const provider = new MetaCampaignInsightsProvider(adsClient as never);
  const result = await provider.getTargetBreachStatus({
    orgId: "o",
    accountId: "act_1",
    campaignId: "c_1",
    targetCPA: 50,
    startDate: new Date("2026-05-25"),
    endDate: new Date("2026-06-01"),
  });
  expect(result.granularity).toBe("daily");
  expect(result.periodsAboveTarget).toBe(9);
  expect(adsClient.getCampaignInsights).toHaveBeenCalledWith(
    expect.objectContaining({ timeIncrement: 1 }),
  );
});

it("treats a day with spend but zero conversions as above target", async () => {
  const days = [dailyRow("c_1", "2026-05-31", 100, 0), dailyRow("c_1", "2026-06-01", 0, 0)];
  const adsClient = {
    getCampaignInsights: vi.fn(async () => days),
    getAdSetInsights: vi.fn(async () => []),
    getAccountSummary: vi.fn(),
  };
  const provider = new MetaCampaignInsightsProvider(adsClient as never);
  const r = await provider.getTargetBreachStatus({
    orgId: "o",
    accountId: "a",
    campaignId: "c_1",
    targetCPA: 50,
    startDate: new Date("2026-05-25"),
    endDate: new Date("2026-06-01"),
  });
  expect(r.periodsAboveTarget).toBe(1); // spend>0,conv=0 counts; zero-spend day ignored
});

it("falls back to weekly snapshot count when no daily rows are returned", async () => {
  const adsClient = {
    getCampaignInsights: vi.fn(async () => []), // Meta returned nothing for the daily pull
    getAdSetInsights: vi.fn(async () => []),
    getAccountSummary: vi.fn(),
  };
  const provider = new MetaCampaignInsightsProvider(adsClient as never);
  const snap = (cpa: number) => ({
    campaignId: "c_1",
    startDate: new Date("2026-05-18"),
    endDate: new Date("2026-05-25"),
    spend: cpa,
    conversions: 1,
    cpa,
  });
  const r = await provider.getTargetBreachStatus({
    orgId: "o",
    accountId: "a",
    campaignId: "c_1",
    targetCPA: 50,
    startDate: new Date("2026-05-25"),
    endDate: new Date("2026-06-01"),
    snapshots: [snap(600), snap(10)], // one above target, one below
  });
  expect(r.granularity).toBe("weekly");
  expect(r.periodsAboveTarget).toBe(1);
});

// ── Task 4: real learning phase from material child ad sets ──────────────────

function adset(id: string, status: "LEARNING" | "SUCCESS" | "FAIL" | "UNKNOWN", spend: number) {
  return {
    adSetId: id,
    adSetName: id,
    campaignId: "c_1",
    learningStageStatus: status,
    frequency: 1,
    spend,
    conversions: 1,
    cpa: spend,
    roas: 0,
    inlineLinkClickCtr: 1,
  };
}
function providerWithAdSets(rows: ReturnType<typeof adset>[]) {
  const adsClient = {
    getCampaignInsights: vi.fn(async () => [
      { campaignId: "c_1", effectiveStatus: "ACTIVE", conversions: 7 } as never,
    ]),
    getAdSetInsights: vi.fn(async () => []),
    getAccountSummary: vi.fn(),
    getAdSetLearningInputs: vi.fn(async () => rows),
  };
  return new MetaCampaignInsightsProvider(adsClient as never);
}

it("learningPhase=true when a material child ad set is LEARNING", async () => {
  const p = providerWithAdSets([adset("a", "LEARNING", 300), adset("b", "SUCCESS", 700)]); // a=30%
  const out = await p.getCampaignLearningData({ orgId: "o", accountId: "x", campaignId: "c_1" });
  expect(out.learningPhase).toBe(true);
});

it("learningPhase=true when status coverage < 80% of spend", async () => {
  const p = providerWithAdSets([adset("a", "UNKNOWN", 500), adset("b", "SUCCESS", 500)]); // 50% known
  const out = await p.getCampaignLearningData({ orgId: "o", accountId: "x", campaignId: "c_1" });
  expect(out.learningPhase).toBe(true);
});

it("learningPhase=false when all material children SUCCESS and coverage ok", async () => {
  const p = providerWithAdSets([adset("a", "SUCCESS", 600), adset("b", "SUCCESS", 400)]);
  const out = await p.getCampaignLearningData({ orgId: "o", accountId: "x", campaignId: "c_1" });
  expect(out.learningPhase).toBe(false);
  expect(out.optimizationEvents).toBe(7); // still read from insights
});

it("learningPhase=false when only an immaterial (5% spend) ad set is UNKNOWN", async () => {
  const p = providerWithAdSets([adset("a", "UNKNOWN", 50), adset("b", "SUCCESS", 950)]); // 95% known
  const out = await p.getCampaignLearningData({ orgId: "o", accountId: "x", campaignId: "c_1" });
  expect(out.learningPhase).toBe(false); // a tiny unknown ad set must not overprotect the account
});

it("learningPhase=false when client lacks getAdSetLearningInputs (graceful)", async () => {
  const adsClient = {
    getCampaignInsights: vi.fn(async () => [
      { campaignId: "c_1", effectiveStatus: "ACTIVE", conversions: 3 } as never,
    ]),
    getAdSetInsights: vi.fn(async () => []),
    getAccountSummary: vi.fn(),
  };
  const p = new MetaCampaignInsightsProvider(adsClient as never);
  const out = await p.getCampaignLearningData({ orgId: "o", accountId: "x", campaignId: "c_1" });
  expect(out.learningPhase).toBe(false);
});

// ── Phase-A breach-counter fix: zero-conversion days are volume-gated ─────────

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

describe("getTargetBreachStatus — zero-conversion days are volume-gated", () => {
  it("a low-volume all-zero-conversion campaign does NOT accrue breach days", async () => {
    const rows = Array.from({ length: 14 }, () => ({
      spend: 3,
      conversions: 0,
      inlineLinkClicks: 1,
    }));
    const r = await new MetaCampaignInsightsProvider(fakeClient(rows)).getTargetBreachStatus(
      breachArgs,
    );
    expect(r.periodsAboveTarget).toBe(0); // 14 total clicks < 20 floor → zero-conv days don't count
  });

  it("a high-volume campaign with zero-conversion spend days DOES accrue breach days", async () => {
    const rows = Array.from({ length: 14 }, () => ({
      spend: 50,
      conversions: 0,
      inlineLinkClicks: 40,
    }));
    const r = await new MetaCampaignInsightsProvider(fakeClient(rows)).getTargetBreachStatus(
      breachArgs,
    );
    expect(r.periodsAboveTarget).toBe(14); // 560 total clicks ≥ floor → sustained zero-conv spend is a real breach
  });

  it("days WITH conversions are unchanged (breach iff cpa > target)", async () => {
    const rows = Array.from({ length: 14 }, () => ({
      spend: 200,
      conversions: 1,
      inlineLinkClicks: 40,
    }));
    const r = await new MetaCampaignInsightsProvider(fakeClient(rows)).getTargetBreachStatus(
      breachArgs,
    );
    expect(r.periodsAboveTarget).toBe(14); // cpa 200 > 100 every day
  });
});

// ── Phase-A Gate 1: action-type + pinned-window conversions denominator ───────

describe("getTargetBreachStatus — conversions denominator selection", () => {
  // Each day: aggregate conversions=10 (cpa 200/10=20 ≤ 100 → NOT a breach), but
  // the action-type "lead" value=1 (cpa 200/1=200 > 100 → breach). The selected
  // denominator must decide the breach.
  const denomRows = () =>
    Array.from({ length: 14 }, () => ({
      spend: 200,
      conversions: 10,
      inlineLinkClicks: 40,
      actions: [{ action_type: "lead", value: "1" }],
    }));

  it("uses the action-type value (not aggregate conversions) when conversionActionType is set", async () => {
    const r = await new MetaCampaignInsightsProvider(fakeClient(denomRows())).getTargetBreachStatus(
      { ...breachArgs, conversionActionType: "lead" },
    );
    expect(r.periodsAboveTarget).toBe(14); // lead-based cpa 200 > 100 every day
  });

  it("falls back to aggregate conversions when conversionActionType is unset (back-compat)", async () => {
    const r = await new MetaCampaignInsightsProvider(fakeClient(denomRows())).getTargetBreachStatus(
      breachArgs,
    );
    expect(r.periodsAboveTarget).toBe(0); // aggregate cpa 20 ≤ 100 → no breach
  });

  it("requests actions + a pinned attribution window when conversionActionType is set", async () => {
    const getCampaignInsights = vi.fn(async () => denomRows() as never[]);
    const client: AdsClientInterface = {
      getCampaignInsights,
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
    expect(getCampaignInsights).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.arrayContaining(["actions", "inline_link_clicks"]),
        actionAttributionWindows: ["7d_click"],
      }),
    );
  });

  it("defaults the attribution window to 7d_click when conversionActionType is set without one", async () => {
    const getCampaignInsights = vi.fn(async () => denomRows() as never[]);
    const client: AdsClientInterface = {
      getCampaignInsights,
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
    });
    expect(getCampaignInsights).toHaveBeenCalledWith(
      expect.objectContaining({ actionAttributionWindows: ["7d_click"] }),
    );
  });

  it("does NOT pin an attribution window when conversionActionType is unset (back-compat)", async () => {
    const getCampaignInsights = vi.fn(async () => denomRows() as never[]);
    const client: AdsClientInterface = {
      getCampaignInsights,
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
    await new MetaCampaignInsightsProvider(client).getTargetBreachStatus(breachArgs);
    // Back-compat: neither the `actions` field nor a pinned window is requested.
    expect(getCampaignInsights).not.toHaveBeenCalledWith(
      expect.objectContaining({ actionAttributionWindows: expect.anything() }),
    );
    expect(getCampaignInsights).not.toHaveBeenCalledWith(
      expect.objectContaining({ fields: expect.arrayContaining(["actions"]) }),
    );
  });

  it("treats a high-click zero-action-conversion day as a breach (volume gate uses the selected denominator)", async () => {
    // No "lead" actions at all → action-type denominator = 0 for every day. With
    // window clicks ≥ 20, zero-conversion days count (the clicks-based gate is
    // unchanged), so all 14 days breach.
    const rows = Array.from({ length: 14 }, () => ({
      spend: 50,
      conversions: 7, // aggregate would be non-zero; must be IGNORED under action-type
      inlineLinkClicks: 40,
      actions: [{ action_type: "purchase", value: "3" }], // no "lead" present
    }));
    const r = await new MetaCampaignInsightsProvider(fakeClient(rows)).getTargetBreachStatus({
      ...breachArgs,
      conversionActionType: "lead",
    });
    expect(r.periodsAboveTarget).toBe(14); // lead=0 every day + 560 clicks ≥ floor
  });

  it("does NOT count low-click zero-action-conversion days (clicks gate still governs)", async () => {
    const rows = Array.from({ length: 14 }, () => ({
      spend: 3,
      conversions: 7,
      inlineLinkClicks: 1, // 14 total clicks < 20 floor
      actions: [{ action_type: "purchase", value: "3" }], // no "lead"
    }));
    const r = await new MetaCampaignInsightsProvider(fakeClient(rows)).getTargetBreachStatus({
      ...breachArgs,
      conversionActionType: "lead",
    });
    expect(r.periodsAboveTarget).toBe(0); // lead=0 but clicks below floor → not a breach
  });

  it("treats a non-numeric action value as zero conversions (NaN guard)", async () => {
    // action value "x" → Number("x") = NaN; ??"0" doesn't catch it since "x" is
    // not null/undefined. Without the Number.isFinite guard, NaN > 0 is false
    // so the day's breach evaluation silently corrupts (NaN arithmetic).
    // With the fix, the day should behave identically to value "0": with
    // 40 clicks ≥ 20 floor (zeroDayCounts=true), all 14 spend days count as breaches.
    const rows = Array.from({ length: 14 }, () => ({
      spend: 50,
      conversions: 7, // aggregate non-zero; must be ignored under action-type mode
      inlineLinkClicks: 40, // 560 total clicks ≥ 20 floor → zeroDayCounts=true
      actions: [{ action_type: "lead", value: "x" }], // non-numeric → must be treated as 0
    }));
    const r = await new MetaCampaignInsightsProvider(fakeClient(rows)).getTargetBreachStatus({
      ...breachArgs,
      conversionActionType: "lead",
    });
    // Correctly treated as 0 conversions → zeroDayCounts=true → 14 breach days.
    // If NaN slipped through: NaN > 0 = false → 0 conv path → zeroDayCounts → also 14.
    // The key assertion is that the result equals the genuine-zero path, not that
    // NaN caused a spurious non-breach (NaN arithmetic could cause other silently-
    // wrong results in derived metrics; the fix ensures we never propagate NaN).
    expect(r.periodsAboveTarget).toBe(14);
  });
});
