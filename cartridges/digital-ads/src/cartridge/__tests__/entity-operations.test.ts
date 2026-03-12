// ---------------------------------------------------------------------------
// Tests for entity operations (captureSnapshot, searchCampaigns, resolveEntity)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { captureSnapshot, searchCampaigns, resolveEntity } from "../entity-operations.js";

const defaultCtx = {
  principalId: "user_1",
  organizationId: null,
  connectionCredentials: {},
};

describe("captureSnapshot", () => {
  it("returns empty object for read-only actions", async () => {
    const result = await captureSnapshot(
      "digital-ads.funnel.diagnose",
      { entityId: "act_123" },
      defaultCtx,
      null,
    );
    expect(result).toEqual({});
  });

  it("returns empty object for write actions without write provider", async () => {
    const result = await captureSnapshot(
      "digital-ads.campaign.pause",
      { campaignId: "c1" },
      defaultCtx,
      null,
    );
    expect(result).toEqual({});
  });
});

describe("searchCampaigns", () => {
  it("returns empty array when no write provider", async () => {
    const result = await searchCampaigns("test query", null);
    expect(result).toEqual([]);
  });
});

describe("resolveEntity", () => {
  it("returns not_found when no write provider", async () => {
    const result = await resolveEntity("Campaign ABC", "campaign", {}, null);
    expect(result.status).toBe("not_found");
    expect(result.inputRef).toBe("Campaign ABC");
    expect(result.resolvedType).toBe("campaign");
    expect(result.confidence).toBe(0);
    expect(result.alternatives).toEqual([]);
  });
});
