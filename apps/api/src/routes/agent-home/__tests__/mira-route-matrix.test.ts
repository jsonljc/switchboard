// ---------------------------------------------------------------------------
// Mira agent-home route matrix (PR3 acceptance — half-live guard).
//
// The whole point of Mira M1 is opt-in per org. This matrix is the safety net:
//   - enabled-mira org   → 200 on every surface
//   - disabled org       → 404 on every Mira surface (NO data leak)
//   - unknown agent      → 404/400
//   - alex & riley       → 200 (unchanged)
//   - enabled-mira, no jobs → empty-but-valid
//   - org isolation      → a job under org A never appears for org B
//
// All six agent-home surfaces are exercised:
//   greeting, pipeline, metrics, activity, mission, wins.
//
// The shared `buildTestServer` harness registers four of them (greeting,
// pipeline, metrics, wins) and decorates the in-memory enablement
// store + the alex/riley signal stores. We additionally:
//   - reassign `app.prisma` to a mock so the Mira read-model path (creativeJob
//     queries) and the alex/riley mission roster lookup resolve (the harness
//     defaults prisma to null);
//   - register the activity route (not wired by the harness) with trivial deps.
// ---------------------------------------------------------------------------

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import { buildTestServer, type TestContext } from "../../../__tests__/test-server.js";
import { cockpitActivityRoutes } from "../activity.js";
import { missionRoute } from "../mission.js";
import type { CockpitActivityDeps } from "../../../lib/cockpit-activity-deps.js";

const PILOT = "pilot";
const OTHER = "other";

// One awaiting-review creative job, owned by the PILOT org.
const PILOT_JOB = {
  id: "job-pilot-1",
  taskId: "t",
  organizationId: PILOT,
  deploymentId: "d",
  productDescription: "Spring promo concept",
  targetAudience: "a",
  platforms: ["meta"],
  brandVoice: null,
  productImages: [],
  references: [],
  pastPerformance: null,
  generateReferenceImages: false,
  productionTier: null,
  currentStage: "hooks",
  stageOutputs: { trends: {} }, // mid-pipeline outputs → awaiting_review
  stoppedAt: null,
  mode: "polished",
  ugcPhase: null,
  ugcPhaseOutputs: null,
  ugcPhaseOutputsVersion: null,
  ugcConfig: null,
  ugcFailure: null,
  createdAt: new Date("2026-05-26T10:00:00Z"),
  updatedAt: new Date("2026-05-26T10:00:00Z"),
};

// Org-scoped Prisma mock. creativeJob.findMany honors the organizationId filter
// (this is what enforces cross-org isolation in production via the WHERE clause),
// so the PILOT job is invisible to OTHER. agentRoster.findFirst returns a roster
// for alex/riley so their mission surface returns 200 (mission 404s on a missing
// roster — Mira's branch is roster-tolerant and never reaches it).
function buildPrismaMock() {
  return {
    creativeJob: {
      findMany: async (args: { where?: { organizationId?: string } }) => {
        const orgId = args?.where?.organizationId;
        return orgId === PILOT ? [PILOT_JOB] : [];
      },
    },
    organizationConfig: {
      findFirst: async () => null, // getOrgTimezone → fallback tz
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        name: "Pilot Medspa",
      }),
    },
    connection: {
      findMany: async () => [] as Array<{ serviceId: string; status: string }>,
    },
    managedChannel: {
      findMany: async () => [] as Array<{ channel: string; status: string }>,
    },
    agentRoster: {
      findFirst: async ({ where }: { where: { organizationId: string; agentRole: string } }) => ({
        id: `roster-${where.agentRole}`,
        organizationId: where.organizationId,
        agentRole: where.agentRole,
        displayName: where.agentRole === "responder" ? "Alex" : "Riley",
        description: "",
        status: "active",
        tier: "starter",
        config: { avgValueCents: 12000, targetCpbCents: 2500 },
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      findUnique: async () => ({ config: { avgValueCents: 12000, targetCpbCents: 2500 } }),
    },
    // Alex's Showed stat queries the opportunity store (count + findFirst).
    opportunity: {
      count: async () => 0,
      findFirst: async () => null,
    },
    // Riley's CAC denominator counts ad-attributed booked conversions.
    conversionRecord: {
      count: async () => 0,
    },
  };
}

const trivialActivityDeps: CockpitActivityDeps = {
  previewReader: { readRecentBatch: async () => ({}) },
  fetchAuditEntries: async () => [],
};

describe("Mira agent-home route matrix", () => {
  let ctx: TestContext;

  const SURFACES = [
    { path: (a: string) => `/api/dashboard/agents/${a}/greeting`, key: "greeting" },
    { path: (a: string) => `/api/dashboard/agents/${a}/pipeline`, key: "pipeline" },
    { path: (a: string) => `/api/dashboard/agents/${a}/metrics?window=week`, key: "metrics" },
    { path: (a: string) => `/api/dashboard/agents/${a}/activity`, key: "activity" },
    { path: (a: string) => `/api/dashboard/agents/${a}/mission`, key: "mission" },
    { path: (a: string) => `/api/dashboard/agents/${a}/wins`, key: "wins" },
  ];

  async function request(org: string, path: string): Promise<LightMyRequestResponse> {
    return ctx.app.inject({ method: "GET", url: path, headers: { "x-org-id": org } });
  }

  beforeAll(async () => {
    ctx = await buildTestServer();
    // The harness defaults prisma to null; the Mira read-model path and the
    // alex/riley roster lookup need a (mock) client.
    (ctx.app as unknown as { prisma: unknown }).prisma = buildPrismaMock();
    // Activity and mission are not registered by the harness — wire them here.
    await ctx.app.register(cockpitActivityRoutes(trivialActivityDeps), {
      prefix: "/api/dashboard",
    });
    await ctx.app.register(missionRoute, { prefix: "/api/dashboard" });
    // Opt PILOT into Mira; OTHER stays disabled.
    await ctx.app.orgAgentEnablementStore!.enable(PILOT, "mira");
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("enabled Mira org → 200 on every surface", async () => {
    for (const s of SURFACES) {
      const res = await request(PILOT, s.path("mira"));
      expect(res.statusCode, `${s.key} enabled-mira`).toBe(200);
    }
  });

  it("disabled org → 404 on every Mira surface (no data leak)", async () => {
    for (const s of SURFACES) {
      const res = await request(OTHER, s.path("mira"));
      expect(res.statusCode, `${s.key} disabled-mira`).toBe(404);
      // The 404 body must not carry any creative-job payload.
      const raw = res.body;
      expect(raw, `${s.key} disabled-mira leak`).not.toContain(PILOT_JOB.id);
      expect(raw, `${s.key} disabled-mira leak`).not.toContain("Spring promo concept");
    }
  });

  it("unknown agent → 404/400 on every surface", async () => {
    for (const s of SURFACES) {
      const res = await request(PILOT, s.path("nova"));
      expect([400, 404], `${s.key} unknown-agent`).toContain(res.statusCode);
    }
  });

  it("Alex & Riley still 200 on every surface for the pilot org", async () => {
    for (const a of ["alex", "riley"]) {
      for (const s of SURFACES) {
        const res = await request(PILOT, s.path(a));
        expect(res.statusCode, `${a} ${s.key}`).toBe(200);
      }
    }
  });

  it("Alex & Riley unaffected by Mira enablement (also 200 for the disabled org)", async () => {
    for (const a of ["alex", "riley"]) {
      const res = await request(OTHER, s_pipeline(a));
      expect(res.statusCode, `${a} pipeline disabled-org`).toBe(200);
    }
  });

  it("enabled Mira org with creative jobs → pipeline tiles populated", async () => {
    const res = await request(PILOT, s_pipeline("mira"));
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vm: { tiles: Array<{ id: string }>; totalCount: number } };
    expect(body.vm.tiles.map((t) => t.id)).toContain(PILOT_JOB.id);
    expect(body.vm.totalCount).toBe(1);
  });

  it("org isolation: a pilot org's job never appears for another org", async () => {
    // OTHER is not enabled, so the Mira surface 404s outright — but to prove the
    // WHERE-clause isolation independent of the gate, enable Mira for OTHER too
    // and assert its pipeline is empty (the job lives under PILOT only).
    await ctx.app.orgAgentEnablementStore!.enable(OTHER, "mira");
    try {
      const res = await request(OTHER, s_pipeline("mira"));
      expect(res.statusCode).toBe(200);
      const body = res.json() as { vm: { tiles: Array<{ id: string }>; totalCount: number } };
      expect(body.vm.tiles).toEqual([]);
      expect(body.vm.totalCount).toBe(0);
    } finally {
      await ctx.app.orgAgentEnablementStore!.setStatus(OTHER, "mira", "disabled");
    }
  });

  it("enabled Mira org with NO creative jobs → empty-but-valid pipeline", async () => {
    // Enable Mira for an org that has no creative jobs in the mock (only PILOT does).
    await ctx.app.orgAgentEnablementStore!.enable("emptyorg", "mira");
    try {
      const res = await request("emptyorg", s_pipeline("mira"));
      expect(res.statusCode).toBe(200);
      const body = res.json() as { vm: { tiles: unknown[]; totalCount: number } };
      expect(body.vm.tiles).toEqual([]);
      expect(body.vm.totalCount).toBe(0);
    } finally {
      await ctx.app.orgAgentEnablementStore!.setStatus("emptyorg", "mira", "disabled");
    }
  });

  // Convenience: the pipeline surface path (index 1).
  function s_pipeline(a: string): string {
    return `/api/dashboard/agents/${a}/pipeline`;
  }
});
