// ---------------------------------------------------------------------------
// Tests — Write Action Dispatch (Campaign/AdSet/Ad Creation + Management)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { DigitalAdsCartridge } from "../index.js";
import { MockMetaAdsWriteProvider } from "../providers/meta-write-provider.js";

const defaultCtx = {
  principalId: "user_1",
  organizationId: null,
  connectionCredentials: {},
};

function createCartridgeWithWriteProvider() {
  const cartridge = new DigitalAdsCartridge();
  const writeProvider = new MockMetaAdsWriteProvider();
  cartridge.registerWriteProvider(writeProvider);
  return cartridge;
}

describe("DigitalAdsCartridge — write dispatch", () => {
  // ── Existing mutations ──────────────────────────────────────────────

  it("dispatches campaign.pause", async () => {
    const cartridge = createCartridgeWithWriteProvider();
    const result = await cartridge.execute(
      "digital-ads.campaign.pause",
      { campaignId: "c1" },
      defaultCtx,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Paused");
  });

  it("dispatches campaign.resume", async () => {
    const cartridge = createCartridgeWithWriteProvider();
    const result = await cartridge.execute(
      "digital-ads.campaign.resume",
      { campaignId: "c1" },
      defaultCtx,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Resumed");
  });

  it("dispatches campaign.adjust_budget", async () => {
    const cartridge = createCartridgeWithWriteProvider();
    const result = await cartridge.execute(
      "digital-ads.campaign.adjust_budget",
      { campaignId: "c1", newBudget: 100 },
      defaultCtx,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Budget");
  });

  it("dispatches adset.pause", async () => {
    const cartridge = createCartridgeWithWriteProvider();
    const result = await cartridge.execute(
      "digital-ads.adset.pause",
      { adSetId: "as1" },
      defaultCtx,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Paused");
  });

  it("dispatches adset.resume", async () => {
    const cartridge = createCartridgeWithWriteProvider();
    const result = await cartridge.execute(
      "digital-ads.adset.resume",
      { adSetId: "as1" },
      defaultCtx,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Resumed");
  });

  it("dispatches adset.adjust_budget", async () => {
    const cartridge = createCartridgeWithWriteProvider();
    const result = await cartridge.execute(
      "digital-ads.adset.adjust_budget",
      { adSetId: "as1", newBudget: 50 },
      defaultCtx,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Budget");
  });

  it("dispatches targeting.modify", async () => {
    const cartridge = createCartridgeWithWriteProvider();
    const result = await cartridge.execute(
      "digital-ads.targeting.modify",
      { adSetId: "as1", targeting: { geo_locations: { countries: ["US"] } } },
      defaultCtx,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("targeting");
  });

  // ── New creation actions ────────────────────────────────────────────

  it("dispatches campaign.create", async () => {
    const cartridge = createCartridgeWithWriteProvider();
    const result = await cartridge.execute(
      "digital-ads.campaign.create",
      { name: "Test Campaign", objective: "OUTCOME_SALES", dailyBudget: 50 },
      defaultCtx,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Created campaign");
    expect(result.summary).toContain("Test Campaign");
    expect(result.externalRefs.campaignId).toBeTruthy();
  });

  it("dispatches adset.create", async () => {
    const cartridge = createCartridgeWithWriteProvider();
    const result = await cartridge.execute(
      "digital-ads.adset.create",
      {
        campaignId: "campaign_1",
        name: "US Audience",
        dailyBudget: 25,
        targeting: { geo_locations: { countries: ["US"] } },
      },
      defaultCtx,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Created ad set");
    expect(result.summary).toContain("US Audience");
    expect(result.externalRefs.adSetId).toBeTruthy();
  });

  it("dispatches ad.create", async () => {
    const cartridge = createCartridgeWithWriteProvider();
    const result = await cartridge.execute(
      "digital-ads.ad.create",
      {
        adSetId: "adset_1",
        name: "Image Ad v1",
        creative: { title: "Buy Now", body: "Great deals" },
      },
      defaultCtx,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Created ad");
    expect(result.summary).toContain("Image Ad v1");
    expect(result.externalRefs.adId).toBeTruthy();
  });

  // ── Error cases ─────────────────────────────────────────────────────

  it("returns failure for unknown action type", async () => {
    const cartridge = createCartridgeWithWriteProvider();
    const result = await cartridge.execute("digital-ads.nonexistent.action", {}, defaultCtx);
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Unknown action type");
  });

  it("returns failure when write provider is not registered", async () => {
    const cartridge = new DigitalAdsCartridge();
    const result = await cartridge.execute(
      "digital-ads.campaign.pause",
      { campaignId: "c1" },
      defaultCtx,
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Write provider not configured");
  });

  it("returns failure for campaign.create with missing params", async () => {
    const cartridge = createCartridgeWithWriteProvider();
    const result = await cartridge.execute(
      "digital-ads.campaign.create",
      { name: "Test" },
      defaultCtx,
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("objective");
  });
});
