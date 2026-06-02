/**
 * Cross-org isolation for the Mira draft-review path — at the HTTP route boundary.
 *
 * The Mira `/mira/creatives/[id]` detail page reuses the creative-pipeline
 * endpoints — GET `/creative-jobs/:id` (read the draft) and POST
 * `/creative-jobs/:id/approve` (continue/stop).
 *
 * GET stays a direct, route-owned read: its `job.organizationId !== orgId`
 * guard is the only thing between an intruder and the draft, so these tests lock
 * it directly.
 *
 * POST /approve now flows through PlatformIngress (P2a-ii) — the ownership check
 * and any mutation live in the `creative.job.*` workflow (see
 * `creative-job-decision-workflow.test.ts`, which locks "cross-org → no
 * mutation, no event"). At the ROUTE boundary the security-relevant guarantees
 * are: (1) the route forwards the AUTHENTICATED org to `submit` — never an
 * attacker-influenced value, so an intruder can never act as the owner; and
 * (2) the route performs NO direct DB write or Inngest send of its own (no
 * mutating bypass path). These tests lock both.
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
  /** Spy proving NO direct mutating write ever ran from the route. */
  updateMany: ReturnType<typeof vi.fn>;
  /** Spy ingress: records what org/intent/params the route forwards. */
  submit: ReturnType<typeof vi.fn>;
}

async function buildOwnershipApp(): Promise<OwnershipTestApp> {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    return reply.code(statusCode).send({ error: message, statusCode });
  });

  // Auth via x-org-id header → organizationIdFromAuth (the route plugin's own
  // buildDevAuthFallback handles this when authDisabled is true).
  app.decorate("authDisabled", true);

  // `findUnique` returns the row by id REGARDLESS of org — the GET route is solely
  // responsible for the org check. This is exactly the shape that makes the
  // route-level guard the only thing standing between an intruder and the data.
  const row = makeOwnedJob();
  const findUnique = vi.fn(
    async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
      if (where.id !== row.id) return null;
      if (select && Object.keys(select).length > 0) {
        const projected: Record<string, unknown> = {};
        for (const key of Object.keys(select))
          projected[key] = (row as Record<string, unknown>)[key];
        return projected;
      }
      return { ...row };
    },
  );

  // A direct mutating write. After P2a-ii the route must NEVER call this — all
  // mutation flows through the governed workflow. If it is EVER called, a
  // mutating bypass path has regressed.
  const updateMany = vi.fn(async () => ({ count: 1 }));

  const prisma = { creativeJob: { findUnique, updateMany } };
  app.decorate("prisma", prisma as unknown as never);

  // Spy ingress — records the submit payload so we can assert the route forwards
  // the authenticated org. Default resolution: a successful queued decision.
  const submit = vi.fn().mockResolvedValue({
    ok: true,
    result: { outcome: "queued", outputs: { job: { ...row }, action: "approved" } },
  });
  app.decorate("platformIngress", { submit } as never);

  await app.register(creativePipelineRoutes, { prefix: "/api/marketplace" });

  return { app, updateMany, submit };
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

  // ── GET: route-owned direct read, route-owned org guard ─────────────────────
  it("GET /creative-jobs/:id from a different org → 404 (no data leak)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: PATH,
      headers: { "x-org-id": INTRUDER },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).not.toContain("Owner's secret draft");
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

  // ── POST /approve: governed via ingress; org is never spoofable ─────────────
  it("POST /approve {continue} from a different org → forwards the INTRUDER org to ingress (never the owner's), and never writes directly", async () => {
    // The workflow rejects org mismatch; simulate that failed outcome here.
    ctx.submit.mockResolvedValue({
      ok: true,
      result: {
        outcome: "failed",
        outputs: {},
        error: { code: "CREATIVE_JOB_NOT_FOUND", message: "Creative job not found" },
      },
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: APPROVE_PATH,
      headers: { "x-org-id": INTRUDER, "content-type": "application/json" },
      payload: { action: "continue" },
    });

    expect(res.statusCode).toBe(404);
    // The route forwarded the caller's authenticated org — NOT the owner's.
    const arg = ctx.submit.mock.calls[0]![0];
    expect(arg.organizationId).toBe(INTRUDER);
    expect(arg.intent).toBe("creative.job.continue");
    expect(arg.parameters).toMatchObject({ jobId: OWNED_JOB_ID });
    // No direct mutating bypass path.
    expect(ctx.updateMany).not.toHaveBeenCalled();
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("POST /approve {stop} from a different org → forwards INTRUDER org with the stop intent, no direct write", async () => {
    ctx.submit.mockResolvedValue({
      ok: true,
      result: {
        outcome: "failed",
        outputs: {},
        error: { code: "CREATIVE_JOB_NOT_FOUND", message: "Creative job not found" },
      },
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: APPROVE_PATH,
      headers: { "x-org-id": INTRUDER, "content-type": "application/json" },
      payload: { action: "stop" },
    });

    expect(res.statusCode).toBe(404);
    const arg = ctx.submit.mock.calls[0]![0];
    expect(arg.organizationId).toBe(INTRUDER);
    expect(arg.intent).toBe("creative.job.stop");
    expect(ctx.updateMany).not.toHaveBeenCalled();
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("owner stop → route forwards the OWNER org + stop intent and maps the governed result (no direct write)", async () => {
    ctx.submit.mockResolvedValue({
      ok: true,
      result: { outcome: "queued", outputs: { job: makeOwnedJob(), action: "stopped" } },
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: APPROVE_PATH,
      headers: { "x-org-id": OWNER, "content-type": "application/json" },
      payload: { action: "stop" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().action).toBe("stopped");
    const arg = ctx.submit.mock.calls[0]![0];
    expect(arg.organizationId).toBe(OWNER);
    expect(arg.intent).toBe("creative.job.stop");
    // The route itself never wrote — the governed workflow owns the mutation.
    expect(ctx.updateMany).not.toHaveBeenCalled();
    expect(inngestSend).not.toHaveBeenCalled();
  });
});
