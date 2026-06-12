import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import { buildTestServer, type TestContext } from "../../../__tests__/test-server.js";
import { creativesRoute } from "../creatives.js";

const PILOT = "pilot";
const OTHER = "other";

// Raw CreativeJob rows (the reader maps them through the seam). Newest first.
function baseJob(over: Record<string, unknown>) {
  return {
    taskId: "t",
    deploymentId: "d",
    productDescription: "P",
    targetAudience: "a",
    platforms: ["meta"],
    brandVoice: null,
    productImages: [],
    references: [],
    pastPerformance: null,
    generateReferenceImages: false,
    productionTier: null,
    currentStage: "trends",
    stageOutputs: {},
    stoppedAt: null,
    mode: "polished",
    ugcPhase: null,
    ugcPhaseOutputs: null,
    ugcPhaseOutputsVersion: null,
    ugcConfig: null,
    ugcFailure: null,
    organizationId: PILOT,
    createdAt: new Date("2026-05-26T10:00:00Z"),
    updatedAt: new Date("2026-05-26T10:00:00Z"),
    ...over,
  };
}

// Newest → oldest. Two newest have NO video (rendering); two older ARE reviewable.
// A stopped row is included to exercise the desk's reviewed_stopped bucket.
const PILOT_ROWS = [
  baseJob({
    id: "rendering-newest",
    createdAt: new Date("2026-05-28"),
    currentStage: "trends",
    stageOutputs: {},
  }), // in_progress
  baseJob({
    id: "rendering-2",
    createdAt: new Date("2026-05-27"),
    currentStage: "hooks",
    stageOutputs: { trends: {} },
  }), // awaiting_review, no video
  baseJob({
    id: "polished-ready",
    createdAt: new Date("2026-05-26"),
    currentStage: "complete",
    stageOutputs: {
      production: {
        assembledVideos: [
          { videoUrl: "https://x/p.mp4", thumbnailUrl: "https://x/p.jpg", duration: 12 },
        ],
      },
    },
  }), // draft_ready + video
  baseJob({
    id: "ugc-ready",
    createdAt: new Date("2026-05-25"),
    mode: "ugc",
    ugcPhase: "complete",
    ugcPhaseOutputs: { production: { assets: [{ outputs: { videoUrl: "https://x/u.mp4" } }] } },
  }), // draft_ready + UGC video
  baseJob({
    id: "ugc-gated",
    createdAt: new Date("2026-05-25"),
    mode: "ugc",
    ugcPhase: "scripting",
    ugcPhaseOutputs: { planning: { structures: [] } },
  }), // ugc parked at a pre-video approval gate (slice-3 spec 3.4)
  baseJob({
    id: "stopped-1",
    createdAt: new Date("2026-05-24"),
    currentStage: "production",
    stoppedAt: new Date("2026-05-24T12:00:00Z"),
    stageOutputs: {},
  }), // stopped — exercises the reviewed_stopped desk bucket
];

// An old published creative OUTSIDE the feed window: findMany (the windowed
// read) never returns it; only the detail fallback's org-scoped findFirst can.
const OUT_OF_WINDOW_PUBLISHED = baseJob({
  id: "old-published",
  createdAt: new Date("2026-01-05"),
  currentStage: "complete",
  reviewDecision: "kept",
  metaCampaignId: "camp-old",
  pastPerformance: {
    kind: "measured_performance",
    version: 1,
    asOf: "2026-06-04T06:30:00.000Z",
    window: { from: "2026-03-06T00:00:00.000Z", to: "2026-06-04T06:30:00.000Z", days: 90 },
    delivery: "measured",
    join: { metaCampaignId: "camp-old", metaAdId: null, metaVideoId: null },
    meta: {
      spend: 40,
      impressions: 900,
      inlineLinkClicks: 30,
      inlineLinkClickCtr: 3.3,
      conversions: 2,
      cpm: 44,
    },
    booked: { valueCents: 20000, count: 2 },
    trueRoas: 5,
    source: { insights: "meta_campaign_insights", conversions: "conversion_records" },
  },
  stageOutputs: {
    production: { assembledVideos: [{ videoUrl: "https://x/old.mp4", thumbnailUrl: "t" }] },
  },
});

function buildPrismaMock() {
  const all: Array<Record<string, unknown>> = [...PILOT_ROWS, OUT_OF_WINDOW_PUBLISHED];
  return {
    creativeJob: {
      findMany: async (args: { where?: { organizationId?: string } }) =>
        args?.where?.organizationId === PILOT ? PILOT_ROWS : [],
      // Detail-fallback read: org-scoped single-row lookup (slice 2).
      findFirst: async (args: { where?: { id?: string; organizationId?: string } }) =>
        all.find(
          (r) => r.id === args?.where?.id && r.organizationId === args?.where?.organizationId,
        ) ?? null,
    },
    organizationConfig: { findFirst: async () => null },
  };
}

describe("GET /agents/mira/creatives", () => {
  let ctx: TestContext;

  async function get(org: string, path: string): Promise<LightMyRequestResponse> {
    return ctx.app.inject({ method: "GET", url: path, headers: { "x-org-id": org } });
  }

  beforeAll(async () => {
    ctx = await buildTestServer();
    (ctx.app as unknown as { prisma: unknown }).prisma = buildPrismaMock();
    await ctx.app.register(creativesRoute, { prefix: "/api/dashboard" });
    await ctx.app.orgAgentEnablementStore!.enable(PILOT, "mira");
  });
  afterAll(async () => ctx.app.close());

  it("disabled org → 404 (no leak)", async () => {
    const res = await get(OTHER, "/api/dashboard/agents/mira/creatives");
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("polished-ready");
  });

  it("non-mira agent → 404 (feed is mira-only)", async () => {
    const res = await get(PILOT, "/api/dashboard/agents/alex/creatives");
    expect(res.statusCode).toBe(404);
  });

  it("enabled org → only reviewable jobs, with feed meta", async () => {
    const res = await get(PILOT, "/api/dashboard/agents/mira/creatives");
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      jobs: Array<{ id: string; draft?: { videoUrl?: string } }>;
      feed: { reviewableCount: number; renderingCount: number };
    };
    expect(body.jobs.map((j) => j.id).sort()).toEqual(["polished-ready", "ugc-ready"]);
    expect(body.jobs.every((j) => typeof j.draft?.videoUrl === "string")).toBe(true);
    // renderingCount includes the ugc-gated fixture (awaiting_review, no video)
    expect(body.feed).toEqual({ reviewableCount: 2, renderingCount: 3 });
  });

  it("filter-before-limit: older reviewable survives newer no-video clips", async () => {
    const res = await get(PILOT, "/api/dashboard/agents/mira/creatives?limit=1");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { jobs: Array<{ id: string }>; feed: { reviewableCount: number } };
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]!.id).toBe("polished-ready"); // newest *reviewable*, not newest overall
    expect(body.feed.reviewableCount).toBe(2);
  });

  it("invalid limit → 400", async () => {
    const res = await get(PILOT, "/api/dashboard/agents/mira/creatives?limit=999");
    expect(res.statusCode).toBe(400);
  });

  it("single: UGC creative returns a seam-derived draft video", async () => {
    const res = await get(PILOT, "/api/dashboard/agents/mira/creatives/ugc-ready");
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      job: { id: string; draft?: { videoUrl?: string }; source: { mode: string } };
    };
    expect(body.job.id).toBe("ugc-ready");
    expect(body.job.draft?.videoUrl).toBe("https://x/u.mp4");
    expect(body.job.source.mode).toBe("ugc");
  });

  it("single: cross-org id → 404", async () => {
    // PILOT's job is invisible to OTHER (enable OTHER so the gate passes, prove WHERE isolation).
    await ctx.app.orgAgentEnablementStore!.enable(OTHER, "mira");
    try {
      const res = await get(OTHER, "/api/dashboard/agents/mira/creatives/polished-ready");
      expect(res.statusCode).toBe(404);
    } finally {
      await ctx.app.orgAgentEnablementStore!.setStatus(OTHER, "mira", "disabled");
    }
  });

  it("single: out-of-window published id resolves via the org-scoped fallback", async () => {
    // old-published is NOT in the windowed findMany rows; only the slice-2
    // detail fallback (org-scoped findFirst -> same mapper) can resolve it.
    const res = await get(PILOT, "/api/dashboard/agents/mira/creatives/old-published");
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      job: { id: string; performance?: { delivery: string; spend: number; asOf: string } };
    };
    expect(body.job.id).toBe("old-published");
    // The fallback path flows through the same mapper, so the slice-2
    // performance projection rides along.
    expect(body.job.performance).toMatchObject({ delivery: "measured", spend: 40 });
    expect(body.job.performance?.asOf).toBe("2026-06-04T06:30:00.000Z");
  });

  it("single: out-of-window id from another org stays 404 through the fallback", async () => {
    await ctx.app.orgAgentEnablementStore!.enable(OTHER, "mira");
    try {
      const res = await get(OTHER, "/api/dashboard/agents/mira/creatives/old-published");
      expect(res.statusCode).toBe(404);
    } finally {
      await ctx.app.orgAgentEnablementStore!.setStatus(OTHER, "mira", "disabled");
    }
  });

  it("single: unknown id stays 404 (fallback finds nothing)", async () => {
    const res = await get(PILOT, "/api/dashboard/agents/mira/creatives/never-existed");
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /agents/mira/desk", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestServer();
    (ctx.app as unknown as { prisma: unknown }).prisma = buildPrismaMock();
    await ctx.app.register(creativesRoute, { prefix: "/api/dashboard" });
    await ctx.app.orgAgentEnablementStore!.enable(PILOT, "mira");
  });
  afterAll(async () => ctx.app.close());

  it("returns the bucketed desk model for an enabled org", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/desk",
      headers: { "x-org-id": PILOT },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      desk: { inProduction: unknown[]; readyToReviewCount: number; isEmpty: boolean };
    };
    expect(body.desk.readyToReviewCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.desk.inProduction)).toBe(true);
  });

  it("surfaces a pre-video ugc gate in the tray with ugcPhase + awaitingGo (slice-3 spec 3.4)", async () => {
    // Regression guard for the operator path: the desk endpoint builds over
    // the FULL window (never the reviewable-only feed filter), so an
    // in-flight ugc job parked at a gate must reach the tray with the fields
    // the link/caption UI reads.
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/desk",
      headers: { "x-org-id": PILOT },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      desk: {
        inProduction: Array<{ id: string; ugcPhase?: string; awaitingGo: boolean }>;
      };
    };
    const gated = body.desk.inProduction.find((i) => i.id === "ugc-gated");
    expect(gated).toBeDefined();
    expect(gated!.ugcPhase).toBe("scripting");
    expect(gated!.awaitingGo).toBe(true);
  });

  it("404s for a non-mira agent", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/desk",
      headers: { "x-org-id": PILOT },
    });
    expect(res.statusCode).toBe(404);
  });

  it("404s when the org is not enabled (no cross-org leak)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/desk",
      headers: { "x-org-id": OTHER },
    });
    // OTHER is never enabled in this suite → gating must 404 (matches the sibling
    // creatives cross-org test; asserting 404 actually enforces the leak guard).
    expect(res.statusCode).toBe(404);
  });
});

// End-to-end inbox-zero: prove `reviewDecision` flows raw row → reader →
// build-read-model → {isReviewable (feed), buildMiraDeskModel (desk)}. The
// per-unit tests cover the model in isolation; this locks the reader↔model seam
// through the real endpoints (a decided draft must leave the feed AND the desk
// ready-count; kept → shelf; passed → gone).
describe("review decisions through the real endpoints (inbox-zero)", () => {
  let ctx: TestContext;

  // Three draft_ready+video rows — all would be reviewable IF undecided.
  function ready(id: string, over: Record<string, unknown>) {
    return baseJob({
      id,
      createdAt: new Date("2026-05-26"),
      currentStage: "complete",
      stageOutputs: {
        production: { assembledVideos: [{ videoUrl: `https://x/${id}.mp4`, thumbnailUrl: "t" }] },
      },
      ...over,
    });
  }
  const INBOX_ROWS = [
    ready("ibz-undecided", {}),
    ready("ibz-kept", { reviewDecision: "kept" }),
    ready("ibz-passed", { reviewDecision: "passed" }),
  ];

  beforeAll(async () => {
    ctx = await buildTestServer();
    (ctx.app as unknown as { prisma: unknown }).prisma = {
      creativeJob: {
        findMany: async (args: { where?: { organizationId?: string } }) =>
          args?.where?.organizationId === PILOT ? INBOX_ROWS : [],
      },
      organizationConfig: { findFirst: async () => null },
    };
    await ctx.app.register(creativesRoute, { prefix: "/api/dashboard" });
    await ctx.app.orgAgentEnablementStore!.enable(PILOT, "mira");
  });
  afterAll(async () => ctx.app.close());

  it("feed excludes decided drafts (only the undecided one is reviewable)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/creatives",
      headers: { "x-org-id": PILOT },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { jobs: { id: string }[]; feed: { reviewableCount: number } };
    expect(body.feed.reviewableCount).toBe(1);
    expect(body.jobs.map((j) => j.id)).toEqual(["ibz-undecided"]);
    expect(res.body).not.toContain("ibz-kept");
    expect(res.body).not.toContain("ibz-passed");
  });

  it("desk: kept → shelf; passed → gone; ready-count excludes both", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/desk",
      headers: { "x-org-id": PILOT },
    });
    expect(res.statusCode).toBe(200);
    const { desk } = res.json() as {
      desk: {
        readyToReviewCount: number;
        keptDrafts: { id: string }[];
        inProduction: { id: string }[];
      };
    };
    expect(desk.readyToReviewCount).toBe(1); // only ibz-undecided
    expect(desk.keptDrafts.map((d) => d.id)).toEqual(["ibz-kept"]);
    expect(desk.inProduction).toEqual([]);
    expect(JSON.stringify(desk)).not.toContain("ibz-passed");
  });
});

// Prove the publish axis flows raw row → reader → build-read-model →
// buildMiraDeskModel → desk JSON (D9-F3): a kept draft whose free-form
// metaPublishStatus dead-lettered must surface in the desk's needsAttention
// bucket, NOT sit silently in the calm kept shelf. The per-unit tests cover the
// model in isolation; this locks the reader↔model↔route seam end to end so a
// future reader/mapper change can't quietly drop the publish marker.
describe("publish failures through the real endpoints (D9-F3)", () => {
  let ctx: TestContext;

  function readyKept(id: string, over: Record<string, unknown>) {
    return baseJob({
      id,
      createdAt: new Date("2026-05-26"),
      currentStage: "complete",
      stageOutputs: {
        production: { assembledVideos: [{ videoUrl: `https://x/${id}.mp4`, thumbnailUrl: "t" }] },
      },
      reviewDecision: "kept",
      ...over,
    });
  }
  // A failed publish, a successful (parked) publish, and an unattempted one —
  // all kept, all draft_ready. Only the failed one needs the operator.
  const ROWS = [
    readyKept("pub-failed", { metaPublishStatus: "publish_failed" }),
    readyKept("pub-ok", { metaPublishStatus: "parked_paused" }),
    readyKept("pub-none", {}),
  ];

  beforeAll(async () => {
    ctx = await buildTestServer();
    (ctx.app as unknown as { prisma: unknown }).prisma = {
      creativeJob: {
        findMany: async (args: { where?: { organizationId?: string } }) =>
          args?.where?.organizationId === PILOT ? ROWS : [],
      },
      organizationConfig: { findFirst: async () => null },
    };
    await ctx.app.register(creativesRoute, { prefix: "/api/dashboard" });
    await ctx.app.orgAgentEnablementStore!.enable(PILOT, "mira");
  });
  afterAll(async () => ctx.app.close());

  it("desk: a dead-lettered publish surfaces in needsAttention, never the calm kept shelf", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/desk",
      headers: { "x-org-id": PILOT },
    });
    expect(res.statusCode).toBe(200);
    const { desk } = res.json() as {
      desk: {
        needsAttention: { id: string; problem?: string }[];
        keptDrafts: { id: string }[];
      };
    };
    // The failed publish is pulled out for attention, tagged with its reason…
    expect(desk.needsAttention.map((d) => d.id)).toEqual(["pub-failed"]);
    expect(desk.needsAttention[0]?.problem).toBe("publish_failed");
    // …and the successful + unattempted kept drafts stay calm on the shelf.
    expect(desk.keptDrafts.map((d) => d.id).sort()).toEqual(["pub-none", "pub-ok"]);
  });
});
