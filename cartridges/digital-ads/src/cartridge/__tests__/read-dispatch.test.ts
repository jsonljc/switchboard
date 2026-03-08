// ---------------------------------------------------------------------------
// Tests — Read Action Dispatch (wired-up read actions)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DigitalAdsCartridge } from "../index.js";
import { MockProvider } from "../providers/mock-provider.js";

const ctx = {
  principalId: "user_1",
  organizationId: null,
  connectionCredentials: {
    meta: { platform: "meta" as const, accessToken: "mock-token-12345678901234567890" },
  },
};

function createCartridge(): DigitalAdsCartridge {
  const cartridge = new DigitalAdsCartridge();
  // Register a mock provider so that initialize() establishes the meta connection
  cartridge.registerProvider(new MockProvider("meta"));
  return cartridge;
}

describe("DigitalAdsCartridge — read dispatch", () => {
  let cartridge: DigitalAdsCartridge;

  beforeEach(async () => {
    cartridge = createCartridge();
    await cartridge.initialize(ctx);
    // Ensure meta connection is established for API-dependent tests
    const session = cartridge.getSession();
    if (!session.connections.has("meta")) {
      session.connections.set("meta", {
        platform: "meta",
        status: "connected",
        connectedAt: Date.now(),
        credentials: { platform: "meta" as const, accessToken: "mock-token-12345678901234567890" },
        accountName: "test-account",
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Strategy actions (no API needed) ────────────────────────────────

  it("strategy.recommend returns real recommendation data (not stub)", async () => {
    const result = await cartridge.execute(
      "digital-ads.strategy.recommend",
      {
        businessGoal: "increase sales",
        monthlyBudget: 3000,
        targetAudience: "US adults 25-45",
        vertical: "commerce",
        hasExistingCampaigns: false,
      },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Strategy recommendation");
    const data = (result as Record<string, unknown>).data as Record<string, unknown>;
    expect(data).toBeDefined();
    expect(data.objective).toBe("OUTCOME_SALES");
    expect(data.structure).toBeDefined();
    const structure = data.structure as Record<string, unknown>;
    expect(structure.campaignCount).toBeGreaterThanOrEqual(1);
    expect(structure.adSetsPerCampaign).toBeGreaterThanOrEqual(1);
    expect(structure.totalBudget).toBe(3000);
    expect(typeof data.bidStrategy).toBe("string");
    expect(typeof data.targeting).toBe("string");
    expect(typeof data.creative).toBe("string");
    expect(Array.isArray(data.bestPractices)).toBe(true);
    expect((data.bestPractices as string[]).length).toBeGreaterThan(0);
    expect(typeof data.performanceFiveScore).toBe("number");
  });

  it("strategy.mediaplan returns real media plan (not stub)", async () => {
    const result = await cartridge.execute(
      "digital-ads.strategy.mediaplan",
      {
        totalBudget: 5000,
        durationDays: 30,
        objective: "OUTCOME_SALES",
        targetAudience: "broad",
      },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Media plan");
    const data = (result as Record<string, unknown>).data as Record<string, unknown>;
    expect(data).toBeDefined();
    expect(data.totalBudget).toBe(5000);
    expect(data.duration).toBe(30);
    expect(Array.isArray(data.phases)).toBe(true);
    const phases = data.phases as Array<Record<string, unknown>>;
    expect(phases.length).toBeGreaterThan(0);
    expect(data.estimatedResults).toBeDefined();
    const estimated = data.estimatedResults as Record<string, unknown>;
    expect(typeof estimated.estimatedConversions).toBe("number");
  });

  // ── Creative generate (no API needed) ──────────────────────────────

  it("creative.generate returns real variants (not stub)", async () => {
    const result = await cartridge.execute(
      "digital-ads.creative.generate",
      {
        productDescription: "Premium wireless headphones with noise cancellation",
        targetAudience: "audiophiles and remote workers",
      },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Generated");
    expect(result.summary).toContain("creative variant");
    const data = (result as Record<string, unknown>).data as Record<string, unknown>;
    expect(data).toBeDefined();
    const variants = data.variants as Array<Record<string, unknown>>;
    expect(variants.length).toBeGreaterThan(0);
    expect(typeof variants[0]!.headline).toBe("string");
    expect(typeof variants[0]!.primaryText).toBe("string");
    expect(typeof variants[0]!.callToAction).toBe("string");
    expect(typeof variants[0]!.angle).toBe("string");
    expect(data.totalGenerated).toBe(variants.length);
  });

  // ── Budget recommend (no API needed, but needs campaign data) ──────

  it("budget.recommend returns real plan data with campaigns", async () => {
    const result = await cartridge.execute(
      "digital-ads.budget.recommend",
      {
        campaigns: [
          {
            campaignId: "c1",
            campaignName: "Sales Campaign",
            dailyBudget: 100,
            spend: 90,
            conversions: 10,
            cpa: 9,
            roas: 3.5,
            impressions: 50000,
            deliveryStatus: "ACTIVE",
          },
          {
            campaignId: "c2",
            campaignName: "Brand Campaign",
            dailyBudget: 100,
            spend: 95,
            conversions: 2,
            cpa: 47.5,
            roas: 0.5,
            impressions: 80000,
            deliveryStatus: "ACTIVE",
          },
        ],
      },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Budget recommendation");
    const data = (result as Record<string, unknown>).data as Record<string, unknown>;
    expect(data).toBeDefined();
    expect(typeof data.totalCurrentBudget).toBe("number");
    expect(typeof data.totalRecommendedBudget).toBe("number");
    expect(Array.isArray(data.entries)).toBe(true);
    const entries = data.entries as Array<Record<string, unknown>>;
    expect(entries.length).toBe(2);
  });

  // ── Optimization review (no API needed) ────────────────────────────

  it("optimization.review returns real review result", async () => {
    const result = await cartridge.execute(
      "digital-ads.optimization.review",
      {
        accountId: "act_123",
        campaigns: [
          {
            campaignId: "c1",
            campaignName: "Test Campaign",
            dailyBudget: 50,
            spend: 45,
            conversions: 5,
            cpa: 9,
            roas: 3,
            deliveryStatus: "ACTIVE",
          },
        ],
        adSets: [
          {
            adSetId: "as1",
            campaignId: "c1",
            dailyBudget: 50,
            spend: 45,
            conversions: 5,
            cpa: 9,
            bidStrategy: "COST_CAP",
            bidAmount: 10,
            learningPhase: false,
          },
        ],
      },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Optimization review");
    expect(result.summary).toContain("score");
    const data = (result as Record<string, unknown>).data as Record<string, unknown>;
    expect(data).toBeDefined();
    expect(typeof data.overallScore).toBe("number");
    expect(Array.isArray(data.tier1Actions)).toBe(true);
    expect(Array.isArray(data.tier2Actions)).toBe(true);
    expect(typeof data.reviewedAt).toBe("string");
  });

  // ── API-dependent actions return errors without real API ────────────

  it("report.performance returns error when API not reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );
    const result = await cartridge.execute(
      "digital-ads.report.performance",
      { adAccountId: "act_123" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Failed to generate performance report");
  });

  it("signal.pixel.diagnose returns error when API not reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );
    const result = await cartridge.execute(
      "digital-ads.signal.pixel.diagnose",
      { adAccountId: "act_123" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Failed to diagnose pixels");
  });

  it("audience.list returns error when API not reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );
    const result = await cartridge.execute(
      "digital-ads.audience.list",
      { adAccountId: "act_123" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Failed to list audiences");
  });

  it("creative.analyze returns error when API not reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );
    const result = await cartridge.execute(
      "digital-ads.creative.analyze",
      { adAccountId: "act_123" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Failed to analyze creatives");
  });

  it("rule.list returns error when API not reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );
    const result = await cartridge.execute(
      "digital-ads.rule.list",
      { adAccountId: "act_123" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Failed to list rules");
  });

  it("experiment.list returns error when API not reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );
    const result = await cartridge.execute(
      "digital-ads.experiment.list",
      { adAccountId: "act_123" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Failed to list experiments");
  });

  it("reach.estimate returns error when API not reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );
    const result = await cartridge.execute(
      "digital-ads.reach.estimate",
      {
        adAccountId: "act_123",
        targetingSpec: { geo_locations: { countries: ["US"] } },
      },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Failed to estimate reach");
  });
});
