/**
 * Cross-org isolation for the Mira draft-review path.
 *
 * The Mira `/mira/creatives/[id]` detail page reuses the existing creative-pipeline
 * endpoints — GET `/creative-jobs/:id` (read the draft) and POST
 * `/creative-jobs/:id/approve` (continue/stop). Both already 404 on cross-org
 * access via the route-level `job.organizationId !== orgId` guard
 * (`creative-pipeline.ts`). These tests LOCK that contract for the Mira review
 * path so a later refactor cannot silently leak another org's draft or let one
 * org continue/stop another org's job.
 *
 * The single most important assertion here: a cross-org continue/stop returns
 * 404 AND leaves the row unmutated (no `updateMany`, no Inngest event fired).
 *
 * No real Prisma in CI — we mount `creativePipelineRoutes` on a Fastify app with
 * a stateful mock `prisma.creativeJob` (keyed by id) and a spied Inngest client,
 * so we can prove the mutating store methods are never reached for an intruder.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance, FastifyError } from "fastify";

// Spy the Inngest client + cost estimator so the route fires NO real events and
// makes NO real provider calls. `vi.hoisted` makes the spy available to the
// (hoisted) `vi.mock` factory below.
const { inngestSend, estimateCostSpy } = vi.hoisted(() => ({
  inngestSend: vi.fn().mockResolvedValue(undefined),
  estimateCostSpy: vi.fn().mockReturnValue({
    basic: { cost: 5, description: "basic" },
    pro: { cost: 12, description: "pro" },
  }),
}));

vi.mock("@switchboard/creative-pipeline", () => ({
  inngestClient: { send: inngestSend },
  estimateCost: estimateCostSpy,
}));

// Imported AFTER the mock is registered so the route binds to the mocked module.
const { creativePipelineRoutes } = await import("../routes/creative-pipeline.js");

const OWNER = "org-owner";
const INTRUDER = "org-intruder";
const OWNED_JOB_ID = "job-owned-1";

const PATH = `/api/marketplace/creative-jobs/${OWNED_JOB_ID}`;
const APPROVE_PATH = `${PATH}/approve`;

/**
 * A single creative job owned by OWNER, mid-pipeline (awaiting approval): not
 * complete, not stopped → the route's 409 guard does not pre-empt the ownership
 * check, so cross-org access truly exercises the 404 path.
 */
function makeOwnedJob() {
  return {
    id: OWNED_JOB_ID,
    taskId: "task-1",
    organizationId: OWNER,
    deploymentId: "dep-1",
    productDescription: "Owner's secret draft",
    targetAudience: "people",
    platforms: ["meta"],
    brandVoice: null,
    productImages: [],
    references: [],
    pastPerformance: null,
    generateReferenceImages: false,
    productionTier: null,
    currentStage: "hooks",
    stageOutputs: { trends: {} },
    stoppedAt: null,
    mode: "polished",
    ugcPhase: null,
    ugcPhaseOutputs: null,
    ugcPhaseOutputsVersion: null,
    ugcConfig: null,
    ugcFailure: null,
    createdAt: new Date("2026-05-26"),
    updatedAt: new Date("2026-05-26"),
  };
}

interface OwnershipTestApp {
  app: FastifyInstance;
  /** Spy proving NO mutating write ever ran. */
  updateMany: ReturnType<typeof vi.fn>;
  /** The mutable row backing `findUnique` — assert it is byte-identical after intruder calls. */
  row: ReturnType<typeof makeOwnedJob>;
}

async function buildOwnershipApp(): Promise<OwnershipTestApp> {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    return reply.code(statusCode).send({ error: message, statusCode });
  });

  // Auth is simulated by an x-org-id header → organizationIdFromAuth, mirroring
  // the dev-auth fallback used by the agent-home routes. No body-org affordance.
  app.decorateRequest("organizationIdFromAuth", undefined);
  app.addHook("preHandler", async (request, reply) => {
    const org = request.headers["x-org-id"];
    if (typeof org !== "string" || !org.trim()) {
      return reply.code(401).send({ error: "Organization required", statusCode: 401 });
    }
    request.organizationIdFromAuth = org.trim();
  });

  const row = makeOwnedJob();

  // `findUnique` returns the row by id REGARDLESS of org — the route is solely
  // responsible for the org check. This is exactly the shape that makes the
  // route-level guard the only thing standing between an intruder and the data.
  const findUnique = vi.fn(
    async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
      if (where.id !== row.id) return null;
      // assertMode() does a select:{mode:true} probe before UGC writes; honor it.
      if (select && Object.keys(select).length > 0) {
        const projected: Record<string, unknown> = {};
        for (const key of Object.keys(select))
          projected[key] = (row as Record<string, unknown>)[key];
        return projected;
      }
      return { ...row };
    },
  );

  // The mutating path. If this is EVER called for an intruder, the test fails.
  const updateMany = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string; organizationId: string };
      data: Record<string, unknown>;
    }) => {
      if (where.id === row.id && where.organizationId === row.organizationId) {
        Object.assign(row, data);
        return { count: 1 };
      }
      return { count: 0 };
    },
  );

  const findFirstOrThrow = vi.fn(
    async ({ where }: { where: { id: string; organizationId: string } }) => {
      if (where.id === row.id && where.organizationId === row.organizationId) return { ...row };
      throw new Error("Record not found");
    },
  );

  const prisma = {
    creativeJob: { findUnique, updateMany, findFirstOrThrow },
  };

  app.decorate("prisma", prisma as unknown as never);

  await app.register(creativePipelineRoutes, { prefix: "/api/marketplace" });

  return { app, updateMany, row };
}

describe("creative-job ownership isolation (Mira review path)", () => {
  let ctx: OwnershipTestApp;

  beforeEach(async () => {
    inngestSend.mockClear();
    ctx = await buildOwnershipApp();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it("GET /creative-jobs/:id from a different org → 404 (no data leak)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: PATH,
      headers: { "x-org-id": INTRUDER },
    });
    expect(res.statusCode).toBe(404);
    // The intruder must not see the owner's draft contents.
    expect(JSON.stringify(res.json())).not.toContain("Owner's secret draft");
  });

  it("POST /approve {continue} from a different org → 404 and does NOT mutate or fire events", async () => {
    const before = JSON.stringify(ctx.row);
    const res = await ctx.app.inject({
      method: "POST",
      url: APPROVE_PATH,
      headers: { "x-org-id": INTRUDER, "content-type": "application/json" },
      payload: { action: "continue" },
    });
    expect(res.statusCode).toBe(404);
    // No mutating write, no Inngest event — the job is untouched.
    expect(ctx.updateMany).not.toHaveBeenCalled();
    expect(inngestSend).not.toHaveBeenCalled();
    expect(JSON.stringify(ctx.row)).toBe(before);
    expect(ctx.row.stoppedAt).toBeNull();
    expect(ctx.row.currentStage).toBe("hooks");
  });

  it("POST /approve {stop} from a different org → 404 and does NOT stop the job", async () => {
    const before = JSON.stringify(ctx.row);
    const res = await ctx.app.inject({
      method: "POST",
      url: APPROVE_PATH,
      headers: { "x-org-id": INTRUDER, "content-type": "application/json" },
      payload: { action: "stop" },
    });
    expect(res.statusCode).toBe(404);
    expect(ctx.updateMany).not.toHaveBeenCalled();
    expect(inngestSend).not.toHaveBeenCalled();
    expect(ctx.row.stoppedAt).toBeNull();
    expect(JSON.stringify(ctx.row)).toBe(before);
  });

  it("owner CAN read their own job", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: PATH,
      headers: { "x-org-id": OWNER },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().job.id).toBe(OWNED_JOB_ID);
    expect(res.json().job.productDescription).toBe("Owner's secret draft");
  });

  it("owner CAN stop their own job (and the row is mutated)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: APPROVE_PATH,
      headers: { "x-org-id": OWNER, "content-type": "application/json" },
      payload: { action: "stop" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().action).toBe("stopped");
    // Owner's write went through — proves the no-mutation result above is real
    // isolation, not a globally-inert mock.
    expect(ctx.updateMany).toHaveBeenCalledTimes(1);
    expect(ctx.row.stoppedAt).not.toBeNull();
    expect(inngestSend).toHaveBeenCalled();
  });
});
