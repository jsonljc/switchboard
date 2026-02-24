import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";
import type { MetaAdsProvider, CampaignInfo } from "../providers/meta-ads.js";
import { PostMutationVerifier } from "../interceptors/verification.js";

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------
function createMockProvider(
  campaignOverrides: Partial<CampaignInfo> = {},
): MetaAdsProvider {
  const campaign: CampaignInfo = {
    id: "camp_1",
    name: "Test Campaign",
    status: "ACTIVE",
    dailyBudget: 5000,
    lifetimeBudget: null,
    deliveryStatus: "ACTIVE",
    startTime: new Date().toISOString(),
    endTime: null,
    objective: "CONVERSIONS",
    ...campaignOverrides,
  };

  return {
    getCampaign: vi.fn().mockResolvedValue(campaign),
    searchCampaigns: vi.fn().mockResolvedValue([campaign]),
    pauseCampaign: vi.fn().mockResolvedValue({ success: true, previousStatus: "ACTIVE" }),
    resumeCampaign: vi.fn().mockResolvedValue({ success: true, previousStatus: "PAUSED" }),
    updateBudget: vi.fn().mockResolvedValue({ success: true, previousBudget: 5000 }),
    healthCheck: vi.fn().mockResolvedValue({ status: "connected", latencyMs: 10, error: null, capabilities: [] }),
  };
}

const DUMMY_CONTEXT: CartridgeContext = {
  principalId: "user_1",
  organizationId: null,
  connectionCredentials: {},
};

function successResult(summary = "Campaign paused"): ExecuteResult {
  return {
    success: true,
    summary,
    externalRefs: { campaignId: "camp_1" },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: 10,
    undoRecipe: null,
  };
}

function failResult(): ExecuteResult {
  return {
    success: false,
    summary: "Failed to pause",
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [{ step: "execute", error: "API error" }],
    durationMs: 0,
    undoRecipe: null,
  };
}

describe("PostMutationVerifier", () => {
  beforeEach(() => {
    // Mock the private delay method to resolve instantly
    vi.spyOn(PostMutationVerifier.prototype as unknown as { delay: (ms: number) => Promise<void> }, "delay")
      .mockResolvedValue(undefined);
  });

  it("appends [verified] when pause is confirmed", async () => {
    const provider = createMockProvider({ status: "PAUSED" });
    const verifier = new PostMutationVerifier(() => provider);

    const result = await verifier.afterExecute!(
      "ads.campaign.pause",
      { campaignId: "camp_1" },
      successResult(),
      DUMMY_CONTEXT,
    );

    expect(result.summary).toContain("[verified]");
    expect(result.externalRefs["verificationStatus"]).toBe("confirmed");
  });

  it("appends [verified] when resume is confirmed", async () => {
    const provider = createMockProvider({ status: "ACTIVE" });
    const verifier = new PostMutationVerifier(() => provider);

    const result = await verifier.afterExecute!(
      "ads.campaign.resume",
      { campaignId: "camp_1" },
      successResult("Campaign resumed"),
      DUMMY_CONTEXT,
    );

    expect(result.summary).toContain("[verified]");
    expect(result.externalRefs["verificationStatus"]).toBe("confirmed");
  });

  it("appends [verification pending] when status hasn't changed", async () => {
    // getCampaign still returns ACTIVE even though we paused
    const provider = createMockProvider({ status: "ACTIVE" });
    const verifier = new PostMutationVerifier(() => provider);

    const result = await verifier.afterExecute!(
      "ads.campaign.pause",
      { campaignId: "camp_1" },
      successResult(),
      DUMMY_CONTEXT,
    );

    expect(result.summary).toContain("[verification pending]");
    expect(result.externalRefs["verificationStatus"]).toBe("unconfirmed");
    // Should have polled 3 times
    expect(provider.getCampaign).toHaveBeenCalledTimes(3);
  });

  it("skips verification on failed execution", async () => {
    const provider = createMockProvider();
    const verifier = new PostMutationVerifier(() => provider);

    const result = await verifier.afterExecute!(
      "ads.campaign.pause",
      { campaignId: "camp_1" },
      failResult(),
      DUMMY_CONTEXT,
    );

    expect(result.summary).toBe("Failed to pause");
    expect(provider.getCampaign).not.toHaveBeenCalled();
  });

  it("skips verification when no campaignId in parameters", async () => {
    const provider = createMockProvider();
    const verifier = new PostMutationVerifier(() => provider);

    const result = await verifier.afterExecute!(
      "ads.campaign.pause",
      {},
      successResult(),
      DUMMY_CONTEXT,
    );

    expect(result.summary).toBe("Campaign paused");
    expect(provider.getCampaign).not.toHaveBeenCalled();
  });

  it("verifies budget adjustment by comparing dailyBudget", async () => {
    const provider = createMockProvider({ dailyBudget: 20000 });
    const verifier = new PostMutationVerifier(() => provider);

    const result = await verifier.afterExecute!(
      "ads.budget.adjust",
      { campaignId: "camp_1", newBudget: 200 }, // $200 → 20000 cents
      successResult("Budget updated"),
      DUMMY_CONTEXT,
    );

    expect(result.summary).toContain("[verified]");
  });

  it("handles getCampaign errors gracefully", async () => {
    const provider = createMockProvider();
    (provider.getCampaign as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API down"));
    const verifier = new PostMutationVerifier(() => provider);

    const result = await verifier.afterExecute!(
      "ads.campaign.pause",
      { campaignId: "camp_1" },
      successResult(),
      DUMMY_CONTEXT,
    );

    expect(result.summary).toContain("[verification pending]");
  });
});
