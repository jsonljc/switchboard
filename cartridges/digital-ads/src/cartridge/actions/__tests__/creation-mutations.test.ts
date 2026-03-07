// ---------------------------------------------------------------------------
// Tests — Creation Mutation Handlers
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  executeCampaignCreate,
  executeAdSetCreate,
  executeAdCreate,
} from "../creation-mutations.js";
import { MockMetaAdsWriteProvider } from "../../providers/meta-write-provider.js";

describe("executeCampaignCreate", () => {
  const provider = new MockMetaAdsWriteProvider();

  it("creates a campaign with valid parameters", async () => {
    const result = await executeCampaignCreate(
      {
        name: "Summer Sale 2026",
        objective: "OUTCOME_SALES",
        dailyBudget: 50,
      },
      provider,
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("Summer Sale 2026");
    expect(result.summary).toContain("$50.00/day");
    expect(result.summary).toContain("OUTCOME_SALES");
    expect(result.externalRefs.campaignId).toBe("campaign_new_1");
    expect(result.rollbackAvailable).toBe(true);
    expect(result.undoRecipe).not.toBeNull();
    expect(result.undoRecipe?.reverseActionType).toBe("digital-ads.campaign.pause");
    expect(result.partialFailures).toHaveLength(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("fails when name is missing", async () => {
    const result = await executeCampaignCreate(
      { objective: "OUTCOME_SALES", dailyBudget: 50 },
      provider,
    );

    expect(result.success).toBe(false);
    expect(result.summary).toContain("name");
    expect(result.partialFailures).toHaveLength(1);
  });

  it("fails when objective is missing", async () => {
    const result = await executeCampaignCreate({ name: "Test", dailyBudget: 50 }, provider);

    expect(result.success).toBe(false);
    expect(result.summary).toContain("objective");
  });

  it("fails when dailyBudget is invalid", async () => {
    const result = await executeCampaignCreate(
      { name: "Test", objective: "OUTCOME_SALES", dailyBudget: -10 },
      provider,
    );

    expect(result.success).toBe(false);
    expect(result.summary).toContain("dailyBudget");
  });

  it("fails when dailyBudget is not a number", async () => {
    const result = await executeCampaignCreate(
      { name: "Test", objective: "OUTCOME_SALES", dailyBudget: "fifty" },
      provider,
    );

    expect(result.success).toBe(false);
    expect(result.summary).toContain("dailyBudget");
  });

  it("passes status and specialAdCategories through", async () => {
    const result = await executeCampaignCreate(
      {
        name: "Housing Campaign",
        objective: "OUTCOME_LEADS",
        dailyBudget: 100,
        status: "ACTIVE",
        specialAdCategories: ["HOUSING"],
      },
      provider,
    );

    expect(result.success).toBe(true);
    expect(result.externalRefs.name).toBe("Housing Campaign");
  });
});

describe("executeAdSetCreate", () => {
  const provider = new MockMetaAdsWriteProvider();

  it("creates an ad set with valid parameters", async () => {
    const result = await executeAdSetCreate(
      {
        campaignId: "campaign_1",
        name: "US Women 25-34",
        dailyBudget: 25,
        targeting: { geo_locations: { countries: ["US"] } },
      },
      provider,
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("US Women 25-34");
    expect(result.summary).toContain("campaign_1");
    expect(result.summary).toContain("$25.00/day");
    expect(result.externalRefs.adSetId).toBe("adset_new_1");
    expect(result.rollbackAvailable).toBe(true);
    expect(result.undoRecipe?.reverseActionType).toBe("digital-ads.adset.pause");
  });

  it("fails when campaignId is missing", async () => {
    const result = await executeAdSetCreate(
      { name: "Test", dailyBudget: 25, targeting: {} },
      provider,
    );

    expect(result.success).toBe(false);
    expect(result.summary).toContain("campaignId");
  });

  it("fails when name is missing", async () => {
    const result = await executeAdSetCreate(
      { campaignId: "c1", dailyBudget: 25, targeting: {} },
      provider,
    );

    expect(result.success).toBe(false);
    expect(result.summary).toContain("name");
  });

  it("fails when targeting is missing", async () => {
    const result = await executeAdSetCreate(
      { campaignId: "c1", name: "Test", dailyBudget: 25 },
      provider,
    );

    expect(result.success).toBe(false);
    expect(result.summary).toContain("targeting");
  });

  it("fails when dailyBudget is invalid", async () => {
    const result = await executeAdSetCreate(
      { campaignId: "c1", name: "Test", dailyBudget: 0, targeting: {} },
      provider,
    );

    expect(result.success).toBe(false);
    expect(result.summary).toContain("dailyBudget");
  });
});

describe("executeAdCreate", () => {
  const provider = new MockMetaAdsWriteProvider();

  it("creates an ad with valid parameters", async () => {
    const result = await executeAdCreate(
      {
        adSetId: "adset_1",
        name: "Summer Sale - Image Ad",
        creative: {
          title: "Summer Sale!",
          body: "Shop now",
          imageUrl: "https://example.com/img.jpg",
        },
      },
      provider,
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("Summer Sale - Image Ad");
    expect(result.summary).toContain("adset_1");
    expect(result.externalRefs.adId).toBe("ad_new_1");
    expect(result.rollbackAvailable).toBe(true);
  });

  it("fails when adSetId is missing", async () => {
    const result = await executeAdCreate({ name: "Test", creative: {} }, provider);

    expect(result.success).toBe(false);
    expect(result.summary).toContain("adSetId");
  });

  it("fails when name is missing", async () => {
    const result = await executeAdCreate({ adSetId: "as1", creative: {} }, provider);

    expect(result.success).toBe(false);
    expect(result.summary).toContain("name");
  });

  it("fails when creative is missing", async () => {
    const result = await executeAdCreate({ adSetId: "as1", name: "Test" }, provider);

    expect(result.success).toBe(false);
    expect(result.summary).toContain("creative");
  });
});
