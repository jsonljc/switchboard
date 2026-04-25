import { describe, it, expect } from "vitest";
import type { CampaignBudgetEntrySchema } from "@switchboard/schemas";
import { detectCBO, analyzeBudgetDistribution } from "../budget-analyzer.js";

function makeEntry(overrides: Partial<CampaignBudgetEntrySchema> = {}): CampaignBudgetEntrySchema {
  return {
    campaignId: "c1",
    campaignName: "Campaign 1",
    spendShare: 0.25,
    spend: 100,
    cpa: 50,
    roas: 3.0,
    isCbo: false,
    dailyBudget: null,
    lifetimeBudget: null,
    spendCap: null,
    objective: "CONVERSIONS",
    ...overrides,
  };
}

describe("detectCBO", () => {
  it("returns true for nonzero daily budget", () => {
    expect(detectCBO(100, null)).toBe(true);
  });

  it("returns true for nonzero lifetime budget", () => {
    expect(detectCBO(null, 5000)).toBe(true);
  });

  it("returns false for null/zero budgets", () => {
    expect(detectCBO(null, null)).toBe(false);
    expect(detectCBO(0, null)).toBe(false);
    expect(detectCBO(null, 0)).toBe(false);
    expect(detectCBO(0, 0)).toBe(false);
  });
});

describe("analyzeBudgetDistribution", () => {
  it("returns empty imbalances for fewer than 2 entries", () => {
    const result = analyzeBudgetDistribution([makeEntry()], 100, null);
    expect(result.imbalances).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.currency).toBe("USD");
  });

  it("flags overspending underperformer", () => {
    const entries: CampaignBudgetEntrySchema[] = [
      makeEntry({
        campaignId: "overspender",
        campaignName: "Overspender",
        spendShare: 0.7,
        spend: 700,
        cpa: 150,
        roas: 1.0,
      }),
      makeEntry({
        campaignId: "normal",
        campaignName: "Normal",
        spendShare: 0.3,
        spend: 300,
        cpa: 50,
        roas: 4.0,
      }),
    ];

    const result = analyzeBudgetDistribution(entries, 100, null);
    const overspender = result.imbalances.find((i) => i.type === "overspending_underperformer");
    expect(overspender).toBeDefined();
    expect(overspender!.campaignId).toBe("overspender");
  });

  it("flags underspending winner", () => {
    const entries: CampaignBudgetEntrySchema[] = [
      makeEntry({
        campaignId: "winner",
        campaignName: "Winner",
        spendShare: 0.05,
        spend: 50,
        cpa: 20,
        roas: 6.0,
      }),
      makeEntry({
        campaignId: "bulk",
        campaignName: "Bulk",
        spendShare: 0.95,
        spend: 950,
        cpa: 90,
        roas: 2.0,
      }),
    ];

    const result = analyzeBudgetDistribution(entries, 100, 5000);
    const winner = result.imbalances.find((i) => i.type === "underspending_winner");
    expect(winner).toBeDefined();
    expect(winner!.campaignId).toBe("winner");
    expect(result.accountSpendCap).toBe(5000);
  });

  it("returns no imbalances when campaigns are balanced", () => {
    const entries: CampaignBudgetEntrySchema[] = [
      makeEntry({
        campaignId: "a",
        campaignName: "A",
        spendShare: 0.5,
        spend: 500,
        cpa: 50,
        roas: 3.0,
      }),
      makeEntry({
        campaignId: "b",
        campaignName: "B",
        spendShare: 0.5,
        spend: 500,
        cpa: 55,
        roas: 2.8,
      }),
    ];

    const result = analyzeBudgetDistribution(entries, 100, null);
    expect(result.imbalances).toHaveLength(0);
  });
});
