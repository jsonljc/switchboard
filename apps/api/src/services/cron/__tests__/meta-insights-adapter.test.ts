import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@switchboard/db";
import type { InsightsWindowQuery } from "@switchboard/core";

// ---------------------------------------------------------------------------
// Regression guard: PR #812 fixed the Meta Insights daily-series call
// from `breakdowns: ["day"]` (invalid — Graph API 400) to `timeIncrement: 1`
// (the correct parameter for a per-day breakdown). This test ensures the fix
// is never reverted. It would fail against the old `breakdowns: ["day"]` shape.
// ---------------------------------------------------------------------------

// Capture args passed to getCampaignInsights so we can assert on the call shape.
const getCampaignInsightsSpy = vi.fn().mockResolvedValue([]);

vi.mock("@switchboard/ad-optimizer", () => ({
  MetaAdsClient: vi.fn().mockImplementation(() => ({
    getCampaignInsights: getCampaignInsightsSpy,
  })),
}));

// Return plaintext credentials so the adapter can extract accessToken/accountId
// without needing a real encryption key.
vi.mock("@switchboard/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@switchboard/db")>();
  return {
    ...actual,
    decryptCredentials: vi.fn().mockReturnValue({
      accessToken: "test-access-token",
      accountId: "act_test123",
    }),
  };
});

// Import AFTER mocks are hoisted.
import { createMetaInsightsProviderForOrg } from "../meta-insights-adapter.js";

function makeFakePrisma(): PrismaClient {
  return {
    agentDeployment: {
      findFirst: vi.fn().mockResolvedValue({ id: "dep-1" }),
    },
    deploymentConnection: {
      findFirst: vi.fn().mockResolvedValue({
        credentials: "encrypted-placeholder",
      }),
    },
  } as unknown as PrismaClient;
}

function makeQuery(overrides: Partial<InsightsWindowQuery> = {}): InsightsWindowQuery {
  return {
    campaignId: "camp-42",
    startInclusive: new Date("2026-05-01T00:00:00Z"),
    endExclusive: new Date("2026-05-08T00:00:00Z"),
    ...overrides,
  };
}

describe("createMetaInsightsProviderForOrg — getCampaignInsights call shape", () => {
  beforeEach(() => {
    getCampaignInsightsSpy.mockClear();
  });

  it("calls getCampaignInsights with timeIncrement:1 (daily series)", async () => {
    // Regression guard for the PR #812 daily-series fix:
    // The OLD code sent breakdowns:["day"] which the Graph API rejects with 400.
    // The FIXED code sends timeIncrement:1 which is the correct daily-series param.
    const provider = createMetaInsightsProviderForOrg("org-1", makeFakePrisma());
    await provider.getWindowMetrics(makeQuery());

    expect(getCampaignInsightsSpy).toHaveBeenCalledOnce();
    const callArg = getCampaignInsightsSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg).toHaveProperty("timeIncrement", 1);
  });

  it("does NOT pass breakdowns containing 'day'", async () => {
    // The old `breakdowns:["day"]` caused Graph API 400 errors on live accounts.
    // Assert the key is absent (or at minimum does not include "day").
    const provider = createMetaInsightsProviderForOrg("org-1", makeFakePrisma());
    await provider.getWindowMetrics(makeQuery());

    const callArg = getCampaignInsightsSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const breakdowns = callArg["breakdowns"];
    // The correct call carries no breakdowns key at all.
    if (Array.isArray(breakdowns)) {
      expect(breakdowns).not.toContain("day");
    } else {
      expect(breakdowns).toBeUndefined();
    }
  });

  it("includes the required Graph API fields in the request", async () => {
    const provider = createMetaInsightsProviderForOrg("org-1", makeFakePrisma());
    await provider.getWindowMetrics(makeQuery());

    const callArg = getCampaignInsightsSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const fields = callArg["fields"] as string[];
    expect(fields).toContain("campaign_id");
    expect(fields).toContain("spend");
    expect(fields).toContain("inline_link_click_ctr");
  });

  it("maps the dateRange window correctly (endExclusive minus 1 day for Meta's inclusive until)", async () => {
    // Meta's `until` field is inclusive, so the adapter subtracts 1 day from endExclusive.
    const provider = createMetaInsightsProviderForOrg("org-1", makeFakePrisma());
    await provider.getWindowMetrics(makeQuery());

    const callArg = getCampaignInsightsSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const dateRange = callArg["dateRange"] as { since: string; until: string };
    expect(dateRange.since).toBe("2026-05-01");
    // endExclusive = 2026-05-08; until = endExclusive - 1d = 2026-05-07
    expect(dateRange.until).toBe("2026-05-07");
  });

  it("returns null when no active deployment exists for the org", async () => {
    const prisma = {
      agentDeployment: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      deploymentConnection: {
        findFirst: vi.fn(),
      },
    } as unknown as PrismaClient;

    const provider = createMetaInsightsProviderForOrg("org-no-deploy", prisma);
    const result = await provider.getWindowMetrics(makeQuery());

    expect(result).toBeNull();
    expect(getCampaignInsightsSpy).not.toHaveBeenCalled();
  });

  it("returns null when no active meta-ads connection exists", async () => {
    const prisma = {
      agentDeployment: {
        findFirst: vi.fn().mockResolvedValue({ id: "dep-1" }),
      },
      deploymentConnection: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;

    const provider = createMetaInsightsProviderForOrg("org-no-conn", prisma);
    const result = await provider.getWindowMetrics(makeQuery());

    expect(result).toBeNull();
    expect(getCampaignInsightsSpy).not.toHaveBeenCalled();
  });
});

describe("createMetaInsightsProviderForOrg — account-level spend enrichment (riley v3 slice 4d)", () => {
  beforeEach(() => {
    getCampaignInsightsSpy.mockReset();
  });

  it("sums accountSpendCents across ALL campaigns in the same Graph response (zero extra calls)", async () => {
    getCampaignInsightsSpy.mockResolvedValue([
      { campaignId: "camp-42", spend: 10.5, inlineLinkClickCtr: 0.02 },
      { campaignId: "camp-42", spend: 4.5, inlineLinkClickCtr: 0.03 },
      { campaignId: "camp-99", spend: 5.25, inlineLinkClickCtr: 0.01 },
    ]);
    const provider = createMetaInsightsProviderForOrg("org-1", makeFakePrisma());

    const metrics = await provider.getWindowMetrics(makeQuery());

    expect(getCampaignInsightsSpy).toHaveBeenCalledTimes(1);
    // Campaign-level: 10.50 + 4.50 dollars = 1500 cents (unchanged behavior).
    expect(metrics?.spendCents).toBe(1500);
    // Account-level: 10.50 + 4.50 + 5.25 dollars = 2025 cents, summed BEFORE
    // the campaign filter (the same dollars-to-cents conversion).
    expect(metrics?.accountSpendCents).toBe(2025);
  });

  it("never narrows the Graph request to one campaign (accountSpendCents depends on the account-wide fetch)", async () => {
    getCampaignInsightsSpy.mockResolvedValue([
      { campaignId: "camp-42", spend: 10.5, inlineLinkClickCtr: 0.02 },
    ]);
    const provider = createMetaInsightsProviderForOrg("org-1", makeFakePrisma());

    await provider.getWindowMetrics(makeQuery());

    // MetaAdsClient.getCampaignInsights SUPPORTS a campaignId filtering
    // param; a future "optimization" passing it would silently turn
    // accountSpendCents into campaign spend and destroy corroboration.
    const callArgs = getCampaignInsightsSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("campaignId");
    expect(callArgs).not.toHaveProperty("filtering");
  });

  it("omits accountSpendCents when any row's spend is non-finite (honest absence beats a poisoned sum)", async () => {
    // MetaAdsClient parses Graph spend strings with parseFloat; a non-numeric
    // sentinel ("N/A", "") yields NaN, and one NaN row poisons the whole
    // account sum. The predicate treats absence as unjudgeable
    // (missing_account_spend); a NaN would be comparison-blind. Review-caught.
    getCampaignInsightsSpy.mockResolvedValue([
      { campaignId: "camp-42", spend: 10.5, inlineLinkClickCtr: 0.02 },
      { campaignId: "camp-99", spend: NaN, inlineLinkClickCtr: 0.01 },
    ]);
    const provider = createMetaInsightsProviderForOrg("org-1", makeFakePrisma());

    const metrics = await provider.getWindowMetrics(makeQuery());

    expect(metrics?.spendCents).toBe(1050);
    expect(metrics).not.toHaveProperty("accountSpendCents");
  });

  it("still returns null when the requested campaign has no rows even if account rows exist (account data alone never fabricates a campaign window)", async () => {
    getCampaignInsightsSpy.mockResolvedValue([
      { campaignId: "camp-99", spend: 5.25, inlineLinkClickCtr: 0.01 },
    ]);
    const provider = createMetaInsightsProviderForOrg("org-1", makeFakePrisma());

    const metrics = await provider.getWindowMetrics(makeQuery());

    expect(metrics).toBeNull();
  });
});
