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
];

function buildPrismaMock() {
  return {
    creativeJob: {
      findMany: async (args: { where?: { organizationId?: string } }) =>
        args?.where?.organizationId === PILOT ? PILOT_ROWS : [],
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
    expect(body.feed).toEqual({ reviewableCount: 2, renderingCount: 2 });
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
});
