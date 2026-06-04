import { describe, it, expect, vi } from "vitest";
import {
  PrismaRecommendationOutcomeStore,
  PrismaAttributableRecommendationStore,
  RecommendationOutcomeAlreadyExistsError,
  extractCampaignIdentity,
} from "../recommendation-outcome-store.js";
import type { RileyOutcomeRow } from "@switchboard/core";

function buildPrismaMock() {
  return {
    recommendationOutcome: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    pendingActionRecord: {
      findMany: vi.fn(),
    },
  } as const;
}

const SAMPLE_ROW: RileyOutcomeRow = {
  recommendationId: "rec-1",
  executableWorkUnitId: null,
  organizationId: "org-1",
  agentRole: "riley",
  actionKind: "pause",
  anchorAt: new Date("2026-05-01T12:00:00Z"),
  windowStartedAt: new Date("2026-04-24T12:00:00Z"),
  windowEndedAt: new Date("2026-05-08T12:00:00Z"),
  attributionMethod: "directional",
  confidence: "medium",
  cockpitRenderable: true,
  metricSummary: {
    preWindowDays: 7,
    postWindowDays: 7,
    preWindow: { spendCents: 10000, ctr: 0.02, dailyRowCount: 7 },
    postWindow: { spendCents: 800, ctr: 0.02, dailyRowCount: 7 },
    deltas: { deltaPct: -92, deltaAmountCents: -9200 },
  },
  copyTemplate: "pause.spend.fell",
  copyValues: { deltaPct: -92, windowDays: 7 },
  visibilityFlags: [],
  causalStrength: "directional",
  businessContextStable: "unknown",
  trustDelta: "up",
};

describe("PrismaRecommendationOutcomeStore.insert", () => {
  it("creates the row with visibilityFlags serialized as JSON", async () => {
    const prisma = buildPrismaMock();
    const store = new PrismaRecommendationOutcomeStore(prisma as never);
    await store.insert(SAMPLE_ROW);
    expect(prisma.recommendationOutcome.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recommendationId: "rec-1",
        organizationId: "org-1",
        agentRole: "riley",
        actionKind: "pause",
        cockpitRenderable: true,
        copyTemplate: "pause.spend.fell",
        visibilityFlags: [],
        causalStrength: "directional",
        businessContextStable: "unknown",
        trustDelta: "up",
      }),
    });
  });

  it("translates P2002 unique violation to RecommendationOutcomeAlreadyExistsError", async () => {
    const prisma = buildPrismaMock();
    (prisma.recommendationOutcome.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      code: "P2002",
    });
    const store = new PrismaRecommendationOutcomeStore(prisma as never);
    await expect(store.insert(SAMPLE_ROW)).rejects.toBeInstanceOf(
      RecommendationOutcomeAlreadyExistsError,
    );
  });

  it("propagates non-P2002 errors", async () => {
    const prisma = buildPrismaMock();
    (prisma.recommendationOutcome.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("conn lost"),
    );
    const store = new PrismaRecommendationOutcomeStore(prisma as never);
    await expect(store.insert(SAMPLE_ROW)).rejects.toThrow("conn lost");
  });
});

describe("PrismaRecommendationOutcomeStore.existsByRecommendationId", () => {
  it("returns true when a row exists", async () => {
    const prisma = buildPrismaMock();
    (prisma.recommendationOutcome.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "outcome-1",
    });
    const store = new PrismaRecommendationOutcomeStore(prisma as never);
    expect(await store.existsByRecommendationId("rec-1")).toBe(true);
  });

  it("returns false when no row exists", async () => {
    const prisma = buildPrismaMock();
    (prisma.recommendationOutcome.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      null,
    );
    const store = new PrismaRecommendationOutcomeStore(prisma as never);
    expect(await store.existsByRecommendationId("rec-1")).toBe(false);
  });
});

describe("PrismaRecommendationOutcomeStore.listRenderableForOrg", () => {
  it("filters cockpitRenderable=true, orders by windowEndedAt desc, includes recommendation relation", async () => {
    const prisma = buildPrismaMock();
    (prisma.recommendationOutcome.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const store = new PrismaRecommendationOutcomeStore(prisma as never);
    await store.listRenderableForOrg({ orgId: "org-1", agentRole: "riley", limit: 50 });
    expect(prisma.recommendationOutcome.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", agentRole: "riley", cockpitRenderable: true },
      orderBy: { windowEndedAt: "desc" },
      take: 50,
      include: {
        recommendation: { select: { targetEntities: true, parameters: true } },
      },
    });
  });

  it("projects campaignId/campaignName from the joined recommendation", async () => {
    const prisma = buildPrismaMock();
    (prisma.recommendationOutcome.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "outcome-1",
        recommendationId: "rec-1",
        actionKind: "pause",
        windowEndedAt: new Date("2026-05-08T12:00:00Z"),
        copyTemplate: "pause.spend.fell",
        copyValues: { deltaPct: -92, windowDays: 7 },
        recommendation: {
          targetEntities: { campaignId: "camp-A", campaignName: "Campaign A" },
          parameters: {},
        },
      },
    ]);
    const store = new PrismaRecommendationOutcomeStore(prisma as never);
    const out = await store.listRenderableForOrg({ orgId: "org-1", agentRole: "riley", limit: 50 });
    expect(out[0]).toMatchObject({
      id: "outcome-1",
      campaignId: "camp-A",
      campaignName: "Campaign A",
    });
  });
});

describe("extractCampaignIdentity", () => {
  it("reads {campaignId, campaignName} from top-level targetEntities", () => {
    expect(
      extractCampaignIdentity({
        targetEntities: { campaignId: "camp-A", campaignName: "Campaign A" },
        parameters: {},
      }),
    ).toEqual({ campaignId: "camp-A", campaignName: "Campaign A" });
  });

  it("falls back to campaignName=null when only campaignId is present", () => {
    expect(
      extractCampaignIdentity({
        targetEntities: { campaignId: "camp-A" },
        parameters: {},
      }),
    ).toEqual({ campaignId: "camp-A", campaignName: null });
  });

  it("reads from {entities: [{kind:'campaign', id, name}]} shape", () => {
    expect(
      extractCampaignIdentity({
        targetEntities: { entities: [{ kind: "campaign", id: "camp-B", name: "B" }] },
        parameters: {},
      }),
    ).toEqual({ campaignId: "camp-B", campaignName: "B" });
  });

  it("reads from bare array shape", () => {
    expect(
      extractCampaignIdentity({
        targetEntities: [{ kind: "campaign", id: "camp-C" }],
        parameters: {},
      }),
    ).toEqual({ campaignId: "camp-C", campaignName: null });
  });

  it("falls back to parameters.campaignId", () => {
    expect(
      extractCampaignIdentity({
        targetEntities: {},
        parameters: { campaignId: "camp-D" },
      }),
    ).toEqual({ campaignId: "camp-D", campaignName: null });
  });

  it("returns null when no campaign identity is findable", () => {
    expect(extractCampaignIdentity({ targetEntities: {}, parameters: {} })).toBeNull();
  });

  it("returns null on malformed entities (no campaign element)", () => {
    expect(
      extractCampaignIdentity({
        targetEntities: { entities: [{ kind: "ad", id: "ad-1" }] },
        parameters: {},
      }),
    ).toBeNull();
  });
});

describe("PrismaAttributableRecommendationStore.findAttributableCandidates", () => {
  it("filters intent/sourceAgent/status and excludes existing outcomes", async () => {
    const prisma = buildPrismaMock();
    (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const store = new PrismaAttributableRecommendationStore(prisma as never);
    await store.findAttributableCandidates({
      organizationId: "org-1",
      now: new Date("2026-05-15T07:00:00Z"),
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const call = (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(call.where.organizationId).toBe("org-1");
    expect(call.where.sourceAgent).toBe("riley");
    expect(call.where.status).toBe("acted");
    expect(call.where.intent.startsWith).toBe("recommendation.");
    expect(call.where.resolvedAt.not).toBeNull();
    expect(call.where.recommendationOutcome.is).toBeNull();
    expect(call.orderBy).toEqual({ resolvedAt: "asc" });
  });

  it("SQL cutoff uses minWindowDays (7d) so pause candidates 8–14 days old are included", async () => {
    // Regression guard for the max→min fix.
    //
    // KIND_CONFIG: pause=7d, refresh_creative=14d.
    // Correct cutoff = now - 7d - 24h (minWindowDays).
    // Wrong cutoff   = now - 14d - 24h (maxWindowDays).
    //
    // A pause acted 10 days ago has resolvedAt = now - 10d.
    // With the CORRECT cutoff (now - 7d - 24h = now - 8d):
    //   resolvedAt (now-10d) <= cutoff (now-8d) → TRUE → row included in SQL fetch.
    // With the WRONG cutoff (now - 14d - 24h = now - 15d):
    //   resolvedAt (now-10d) <= cutoff (now-15d) → FALSE → row silently excluded.
    //
    // The test verifies the cutoff passed to findMany equals now - 7d - 24h.
    const prisma = buildPrismaMock();
    (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const store = new PrismaAttributableRecommendationStore(prisma as never);

    const now = new Date("2026-05-15T07:00:00Z");
    await store.findAttributableCandidates({ organizationId: "org-1", now });

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const call = (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    const cutoff: Date = call.where.resolvedAt.lte;

    // Expected: now - 7d - 24h (minWindowDays=7 for pause)
    const MS_PER_HOUR = 60 * 60 * 1000;
    const MS_PER_DAY = 24 * MS_PER_HOUR;
    const expectedCutoff = new Date(now.getTime() - 24 * MS_PER_HOUR - 7 * MS_PER_DAY);

    expect(cutoff.getTime()).toBe(expectedCutoff.getTime());

    // Also confirm it is NOT the wrong value (now - 14d - 24h)
    const wrongCutoff = new Date(now.getTime() - 24 * MS_PER_HOUR - 14 * MS_PER_DAY);
    expect(cutoff.getTime()).not.toBe(wrongCutoff.getTime());
  });
});

describe("PrismaAttributableRecommendationStore.findOverlapsForCampaign", () => {
  it("excludes the candidate id and filters by campaignId in targetEntities", async () => {
    const prisma = buildPrismaMock();
    (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const store = new PrismaAttributableRecommendationStore(prisma as never);
    await store.findOverlapsForCampaign({
      organizationId: "org-1",
      campaignId: "camp-A",
      excludeRecommendationId: "rec-1",
      windowStart: new Date("2026-04-17T12:00:00Z"),
      windowEnd: new Date("2026-05-08T12:00:00Z"),
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const call = (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(call.where.id.not).toBe("rec-1");
    expect(call.where.organizationId).toBe("org-1");
    expect(call.where.sourceAgent).toBe("riley");
    expect(call.where.status).toBe("acted");
  });

  it("filters out same-window acted recs on a DIFFERENT campaign", async () => {
    const prisma = buildPrismaMock();
    (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "rec-other-campaign",
        organizationId: "org-1",
        resolvedAt: new Date("2026-05-01T12:00:00Z"),
        parameters: { __recommendation: { action: "pause" } },
        targetEntities: { campaignId: "camp-B" }, // different campaign
      },
    ]);
    const store = new PrismaAttributableRecommendationStore(prisma as never);
    const out = await store.findOverlapsForCampaign({
      organizationId: "org-1",
      campaignId: "camp-A",
      excludeRecommendationId: "rec-1",
      windowStart: new Date("2026-04-17T12:00:00Z"),
      windowEnd: new Date("2026-05-08T12:00:00Z"),
    });
    expect(out).toEqual([]);
  });

  it("includes same-window acted rec on the SAME campaign even if its window has not yet closed", async () => {
    const prisma = buildPrismaMock();
    // A pause acted 2 days before windowEnd — its 7d window has NOT yet closed
    (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "rec-mid-window",
        organizationId: "org-1",
        resolvedAt: new Date("2026-05-06T12:00:00Z"), // 2 days before windowEnd
        parameters: { __recommendation: { action: "pause" } },
        targetEntities: { campaignId: "camp-A" },
      },
    ]);
    const store = new PrismaAttributableRecommendationStore(prisma as never);
    const out = await store.findOverlapsForCampaign({
      organizationId: "org-1",
      campaignId: "camp-A",
      excludeRecommendationId: "rec-1",
      windowStart: new Date("2026-04-17T12:00:00Z"),
      windowEnd: new Date("2026-05-08T12:00:00Z"),
    });
    expect(out).toEqual([{ id: "rec-mid-window", actionKind: "pause" }]);
  });
});
