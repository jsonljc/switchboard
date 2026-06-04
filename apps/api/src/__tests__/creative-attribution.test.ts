import { describe, it, expect, vi } from "vitest";
import {
  computePastPerformance,
  executeCreativeAttributionWorker,
  executeCreativeAttributionDispatch,
  resolveMetaAdsConnectionCredentials,
  CREATIVE_ATTRIBUTION_WORKER_FAILURE_PARAMS,
  ATTRIBUTION_INSIGHT_FIELDS,
} from "../services/cron/creative-attribution.js";
import { StaleVersionError } from "@switchboard/core";
import type { CreativeJob, CampaignInsightSchema } from "@switchboard/schemas";

// Hoist so the spy exists when the vi.mock factory runs (cron test convention).
const { createFunctionSpy } = vi.hoisted(() => ({
  createFunctionSpy: vi.fn().mockReturnValue({}),
}));

vi.mock("inngest", () => ({
  Inngest: vi.fn().mockImplementation(() => ({ createFunction: createFunctionSpy })),
}));

const NOW = new Date("2026-06-04T06:30:00.000Z");
const WINDOW = { from: new Date("2026-05-05T00:00:00.000Z"), to: NOW };

function publishedJob(overrides: Partial<CreativeJob> = {}): CreativeJob {
  return {
    id: "job-1",
    taskId: "task-1",
    organizationId: "org-1",
    deploymentId: "dep-1",
    productDescription: "Hydrafacial promo",
    targetAudience: "Local professionals",
    platforms: ["meta"],
    brandVoice: null,
    productImages: [],
    references: [],
    pastPerformance: null,
    generateReferenceImages: false,
    currentStage: "complete",
    stageOutputs: {},
    stoppedAt: null,
    mode: "polished",
    reviewDecision: "kept",
    reviewDecidedAt: new Date("2026-05-04T00:00:00.000Z"),
    metaVideoId: "vid-1",
    metaCampaignId: "camp-1",
    metaAdSetId: "adset-1",
    metaCreativeId: "cr-1",
    metaAdId: "ad-1",
    metaPublishStatus: "parked_paused",
    durableAssetUrl: "https://assets.example/creative-assets/job-1/assembled.mp4",
    createdAt: new Date("2026-05-04T00:00:00.000Z"),
    updatedAt: new Date("2026-05-04T00:00:00.000Z"),
    ...overrides,
  } as CreativeJob;
}

function insight(overrides: Partial<CampaignInsightSchema> = {}): CampaignInsightSchema {
  return {
    campaignId: "camp-1",
    campaignName: "Mira draft",
    status: "PAUSED",
    effectiveStatus: "ACTIVE",
    impressions: 1000,
    inlineLinkClicks: 40,
    spend: 50,
    conversions: 3,
    revenue: 0,
    frequency: 1.2,
    cpm: 50,
    inlineLinkClickCtr: 4,
    costPerInlineLinkClick: 1.25,
    dateStart: "2026-05-05",
    dateStop: "2026-06-04",
    ...overrides,
  } as CampaignInsightSchema;
}

describe("computePastPerformance", () => {
  it("classifies a present insight row as measured with joined booked stats", () => {
    const row = computePastPerformance({
      job: publishedJob(),
      insight: insight(),
      booked: { valueCents: 25000, count: 2 },
      window: WINDOW,
      now: NOW,
    });
    expect(row).toMatchObject({
      kind: "measured_performance",
      version: 1,
      delivery: "measured",
      meta: { spend: 50, conversions: 3, impressions: 1000 },
      booked: { valueCents: 25000, count: 2 },
      trueRoas: 5, // 25000 cents = $250 over $50 spend; cents normalized exactly once
      join: { metaCampaignId: "camp-1", metaAdId: "ad-1", metaVideoId: "vid-1" },
      source: { insights: "meta_campaign_insights", conversions: "conversion_records" },
    });
    expect(row?.asOf).toBe(NOW.toISOString());
    expect(row?.window.from).toBe(WINDOW.from.toISOString());
    expect(row?.window.to).toBe(NOW.toISOString());
    expect(row?.window.days).toBe(30);
  });

  it("classifies an ABSENT insight row as no_delivery with zeroed meta block", () => {
    const row = computePastPerformance({
      job: publishedJob(),
      insight: undefined,
      booked: undefined,
      window: WINDOW,
      now: NOW,
    });
    expect(row).toMatchObject({
      delivery: "no_delivery",
      meta: { spend: 0, impressions: 0, conversions: 0, inlineLinkClicks: 0, cpm: 0 },
      booked: { valueCents: 0, count: 0 },
      trueRoas: null,
    });
  });

  it("NO-DOWNGRADE: returns null (skip) when the row is absent but a prior measured row exists", () => {
    const prior = computePastPerformance({
      job: publishedJob(),
      insight: insight(),
      booked: { valueCents: 25000, count: 2 },
      window: WINDOW,
      now: NOW,
    });
    const job = publishedJob({ pastPerformance: prior as unknown as Record<string, unknown> });
    const row = computePastPerformance({
      job,
      insight: undefined,
      booked: undefined,
      window: WINDOW,
      now: NOW,
    });
    expect(row).toBeNull();
  });

  it("overwrites a prior no_delivery row with a fresh no_delivery row (asOf advances)", () => {
    const earlier = new Date("2026-06-03T06:30:00.000Z");
    const prior = computePastPerformance({
      job: publishedJob(),
      insight: undefined,
      booked: undefined,
      window: { from: WINDOW.from, to: earlier },
      now: earlier,
    });
    const job = publishedJob({ pastPerformance: prior as unknown as Record<string, unknown> });
    const row = computePastPerformance({
      job,
      insight: undefined,
      booked: undefined,
      window: WINDOW,
      now: NOW,
    });
    expect(row?.delivery).toBe("no_delivery");
    expect(row?.asOf).toBe(NOW.toISOString());
  });

  it("overwrites a prior measured row when a fresh insight row exists (idempotent re-sweep)", () => {
    const prior = computePastPerformance({
      job: publishedJob(),
      insight: insight({ spend: 25 }),
      booked: { valueCents: 10000, count: 1 },
      window: WINDOW,
      now: new Date("2026-06-03T06:30:00.000Z"),
    });
    const job = publishedJob({ pastPerformance: prior as unknown as Record<string, unknown> });
    const row = computePastPerformance({
      job,
      insight: insight({ spend: 75 }),
      booked: { valueCents: 30000, count: 3 },
      window: WINDOW,
      now: NOW,
    });
    expect(row?.meta.spend).toBe(75);
    expect(row?.booked).toEqual({ valueCents: 30000, count: 3 });
    expect(row?.asOf).toBe(NOW.toISOString());
  });

  it("trueRoas is null when booked.count===0 (absence is not zero earnings)", () => {
    const row = computePastPerformance({
      job: publishedJob(),
      insight: insight(),
      booked: { valueCents: 0, count: 0 },
      window: WINDOW,
      now: NOW,
    });
    expect(row?.trueRoas).toBeNull();
    expect(row?.booked.valueCents).toBe(0); // stays a non-negative int, never null
  });

  it("computes cents-normalized trueRoas for a measured row with bookings", () => {
    const row = computePastPerformance({
      job: publishedJob(),
      insight: insight({ spend: 100 }),
      booked: { valueCents: 10000, count: 1 },
      window: WINDOW,
      now: NOW,
    });
    expect(row?.trueRoas).toBe(1); // $100 booked over $100 spend
  });

  it("produces rows that validate against CreativePastPerformanceSchema", async () => {
    const { CreativePastPerformanceSchema } = await import("@switchboard/schemas");
    const measured = computePastPerformance({
      job: publishedJob(),
      insight: insight(),
      booked: { valueCents: 25000, count: 2 },
      window: WINDOW,
      now: NOW,
    });
    const noDelivery = computePastPerformance({
      job: publishedJob({ metaAdId: null, metaVideoId: null }),
      insight: undefined,
      booked: undefined,
      window: WINDOW,
      now: NOW,
    });
    expect(CreativePastPerformanceSchema.safeParse(measured).success).toBe(true);
    expect(CreativePastPerformanceSchema.safeParse(noDelivery).success).toBe(true);
  });
});

function workerDeps(overrides: Record<string, unknown> = {}) {
  return {
    failure: {
      auditLedger: { record: vi.fn().mockResolvedValue({}) },
      operatorAlerter: { alert: vi.fn().mockResolvedValue(undefined) },
      inngest: { send: vi.fn().mockResolvedValue(undefined) },
    },
    readEnabledFlag: vi.fn().mockReturnValue(true),
    jobStore: {
      listPublished: vi.fn().mockResolvedValue([publishedJob()]),
      setPastPerformance: vi.fn().mockResolvedValue(undefined),
    },
    conversionStore: {
      queryBookedStatsByCampaign: vi
        .fn()
        .mockResolvedValue(new Map([["camp-1", { valueCents: 25000, count: 2 }]])),
    },
    resolveMetaCredentials: vi.fn().mockResolvedValue({ accessToken: "tok", accountId: "act_1" }),
    makeAdsClient: vi.fn().mockReturnValue({
      getCampaignInsights: vi.fn().mockResolvedValue([insight()]),
    }),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

const EVENT = { data: { orgId: "org-1" }, name: "creative-pipeline/attribution.refresh" };

describe("executeCreativeAttributionWorker", () => {
  it("kill-switch off: short-circuits before ANY job read, Meta call, or DB write", async () => {
    const deps = workerDeps({ readEnabledFlag: vi.fn().mockReturnValue(false) });
    const out = await executeCreativeAttributionWorker(deps as never, EVENT);
    expect(out).toEqual({ skipped: "disabled" });
    expect(deps.jobStore.listPublished).not.toHaveBeenCalled();
    expect(deps.makeAdsClient).not.toHaveBeenCalled();
    expect(deps.jobStore.setPastPerformance).not.toHaveBeenCalled();
  });

  it("missing orgId throws", async () => {
    const deps = workerDeps();
    await expect(
      executeCreativeAttributionWorker(deps as never, { data: {}, name: EVENT.name }),
    ).rejects.toThrow("missing orgId");
  });

  it("no published jobs: graceful no-op without credentials or Meta call", async () => {
    const deps = workerDeps({
      jobStore: { listPublished: vi.fn().mockResolvedValue([]), setPastPerformance: vi.fn() },
    });
    const out = await executeCreativeAttributionWorker(deps as never, EVENT);
    expect(out).toEqual({ skipped: "no_published_jobs" });
    expect(deps.resolveMetaCredentials).not.toHaveBeenCalled();
  });

  it("missing credentials: graceful no-op, no Meta call, no writes", async () => {
    const deps = workerDeps({ resolveMetaCredentials: vi.fn().mockResolvedValue(null) });
    const out = await executeCreativeAttributionWorker(deps as never, EVENT);
    expect(out).toEqual({ skipped: "no_meta_credentials" });
    expect(deps.makeAdsClient).not.toHaveBeenCalled();
    expect(deps.jobStore.setPastPerformance).not.toHaveBeenCalled();
  });

  it("happy path: ONE insights call with the explicit fields list, writes a measured row per job", async () => {
    const deps = workerDeps();
    const out = await executeCreativeAttributionWorker(deps as never, EVENT);
    expect(out).toMatchObject({
      orgId: "org-1",
      published: 1,
      written: 1,
      noDowngradeSkips: 0,
      vanishedSkips: 0,
    });
    const ads = deps.makeAdsClient.mock.results[0]!.value;
    expect(ads.getCampaignInsights).toHaveBeenCalledTimes(1);
    const call = ads.getCampaignInsights.mock.calls[0]![0];
    expect(call.fields).toEqual([...ATTRIBUTION_INSIGHT_FIELDS]);
    expect(call.dateRange.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(call.dateRange.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const written = deps.jobStore.setPastPerformance.mock.calls[0]!;
    expect(written[0]).toBe("org-1");
    expect(written[1]).toBe("job-1");
    expect(written[2]).toMatchObject({ kind: "measured_performance", delivery: "measured" });
  });

  it("passes the published campaign ids into the booked aggregate", async () => {
    const deps = workerDeps();
    await executeCreativeAttributionWorker(deps as never, EVENT);
    const q = deps.conversionStore.queryBookedStatsByCampaign.mock.calls[0]![0];
    expect(q.orgId).toBe("org-1");
    expect(q.campaignIds).toEqual(["camp-1"]);
    expect(q.from).toBeInstanceOf(Date);
    expect(q.to).toBeInstanceOf(Date);
  });

  it("clamps the window start to 90 days before now", async () => {
    const old = publishedJob({ createdAt: new Date("2025-01-01T00:00:00.000Z") });
    const deps = workerDeps({
      jobStore: {
        listPublished: vi.fn().mockResolvedValue([old]),
        setPastPerformance: vi.fn().mockResolvedValue(undefined),
      },
    });
    await executeCreativeAttributionWorker(deps as never, EVENT);
    const q = deps.conversionStore.queryBookedStatsByCampaign.mock.calls[0]![0];
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    expect(Date.now() - q.from.getTime()).toBeLessThanOrEqual(ninetyDaysMs + 60_000);
  });

  it("a job vanished mid-run (StaleVersionError) is skipped, not fatal", async () => {
    const deps = workerDeps({
      jobStore: {
        listPublished: vi.fn().mockResolvedValue([publishedJob()]),
        setPastPerformance: vi.fn().mockRejectedValue(new StaleVersionError("job-1", -1, -1)),
      },
    });
    const out = await executeCreativeAttributionWorker(deps as never, EVENT);
    expect(out).toMatchObject({ written: 0, vanishedSkips: 1 });
  });

  it("a non-stale store error propagates (retries + dead-letter own it)", async () => {
    const deps = workerDeps({
      jobStore: {
        listPublished: vi.fn().mockResolvedValue([publishedJob()]),
        setPastPerformance: vi.fn().mockRejectedValue(new Error("db down")),
      },
    });
    await expect(executeCreativeAttributionWorker(deps as never, EVENT)).rejects.toThrow("db down");
  });

  it("NO-DOWNGRADE end-to-end: absent insight row + prior measured row = no write", async () => {
    const prior = computePastPerformance({
      job: publishedJob(),
      insight: insight(),
      booked: { valueCents: 25000, count: 2 },
      window: WINDOW,
      now: NOW,
    });
    const deps = workerDeps({
      jobStore: {
        listPublished: vi
          .fn()
          .mockResolvedValue([
            publishedJob({ pastPerformance: prior as unknown as Record<string, unknown> }),
          ]),
        setPastPerformance: vi.fn().mockResolvedValue(undefined),
      },
      makeAdsClient: vi
        .fn()
        .mockReturnValue({ getCampaignInsights: vi.fn().mockResolvedValue([]) }),
    });
    const out = await executeCreativeAttributionWorker(deps as never, EVENT);
    expect(out).toMatchObject({ written: 0, noDowngradeSkips: 1 });
    expect(deps.jobStore.setPastPerformance).not.toHaveBeenCalled();
  });

  it("locks the Class-E failure contract (audit always, no domain event, no alert)", () => {
    expect(CREATIVE_ATTRIBUTION_WORKER_FAILURE_PARAMS).toEqual({
      functionId: "creative-attribution-worker",
      eventDomain: "creative.attribution",
      riskCategory: "low",
      alert: false,
      emitEvent: false,
    });
  });
});

describe("executeCreativeAttributionDispatch", () => {
  it("emits one attribution.refresh event per published-creative org", async () => {
    const sendEvent = vi.fn().mockResolvedValue(undefined);
    const step = { run: vi.fn(async (_name: string, fn: () => unknown) => fn()) };
    const out = await executeCreativeAttributionDispatch(step as never, {
      listPublishedCreativeOrgs: vi.fn().mockResolvedValue(["org-1", "org-2"]),
      sendEvent,
    });
    expect(out).toEqual({ dispatched: 2 });
    expect(sendEvent).toHaveBeenCalledTimes(2);
    expect(sendEvent).toHaveBeenCalledWith({
      name: "creative-pipeline/attribution.refresh",
      data: { orgId: "org-1" },
    });
    expect(sendEvent).toHaveBeenCalledWith({
      name: "creative-pipeline/attribution.refresh",
      data: { orgId: "org-2" },
    });
  });

  it("dispatches nothing when no org has published creatives", async () => {
    const sendEvent = vi.fn();
    const step = { run: vi.fn(async (_name: string, fn: () => unknown) => fn()) };
    const out = await executeCreativeAttributionDispatch(step as never, {
      listPublishedCreativeOrgs: vi.fn().mockResolvedValue([]),
      sendEvent,
    });
    expect(out).toEqual({ dispatched: 0 });
    expect(sendEvent).not.toHaveBeenCalled();
  });
});

describe("resolveMetaAdsConnectionCredentials", () => {
  function prismaWith(connection: unknown) {
    return { connection: { findFirst: vi.fn().mockResolvedValue(connection) } };
  }
  const decrypt = (encrypted: unknown) => encrypted as Record<string, unknown>;

  it("resolves accessToken/accountId from the org meta-ads connection", async () => {
    const prisma = prismaWith({
      credentials: { accessToken: "tok", accountId: "act_1" },
      externalAccountId: null,
    });
    const out = await resolveMetaAdsConnectionCredentials(prisma as never, decrypt, "org-1");
    expect(out).toEqual({ accessToken: "tok", accountId: "act_1" });
    expect(prisma.connection.findFirst).toHaveBeenCalledWith({
      where: { serviceId: "meta-ads", organizationId: "org-1" },
      select: { credentials: true, externalAccountId: true },
    });
  });

  it("falls back to externalAccountId when credentials carry no accountId", async () => {
    const prisma = prismaWith({
      credentials: { accessToken: "tok" },
      externalAccountId: "act_ext",
    });
    const out = await resolveMetaAdsConnectionCredentials(prisma as never, decrypt, "org-1");
    expect(out).toEqual({ accessToken: "tok", accountId: "act_ext" });
  });

  it("returns null for missing connection or missing token (graceful no-op)", async () => {
    expect(
      await resolveMetaAdsConnectionCredentials(prismaWith(null) as never, decrypt, "org-1"),
    ).toBeNull();
    expect(
      await resolveMetaAdsConnectionCredentials(
        prismaWith({ credentials: {}, externalAccountId: "x" }) as never,
        decrypt,
        "org-1",
      ),
    ).toBeNull();
  });
});
