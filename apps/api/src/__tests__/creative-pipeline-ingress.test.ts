/**
 * P2a-ii — creative-pipeline generation/spend routes go through the governance
 * front door (`PlatformIngress.submit()`), not direct `inngestClient.send(...)`.
 *
 * Core invariant (CLAUDE.md): "Mutating actions enter through
 * PlatformIngress.submit(); no mutating bypass paths." Generation ("submit")
 * and the storyboard "continue" trigger paid video renders (spend), so they
 * must be governed.
 *
 * These tests assert the ROUTE's contribution to the seam: it submits the
 * pre-existing governed intents with the correct intent name, parameters, the
 * AUTHENTICATED org (never a body/path-spoofable one), the authenticated actor,
 * and trigger "api" — and maps the SubmitWorkResponse back to the exact HTTP
 * contract the dashboard consumes (`{ task, job }` 201, `{ job, action }` 200,
 * 404/409 domain failures). A spy ingress stands in for the real governance
 * stack; the workflow-side enforcement (cross-org no-mutation, 409) is locked in
 * the co-located workflow tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance, FastifyError } from "fastify";

// The route module imports `@switchboard/creative-pipeline` (inngestClient +
// estimateCost). After the reroute the POST handlers must NOT touch inngest —
// we spy it so a regression that fires a direct event is caught.
const { inngestSend } = vi.hoisted(() => ({ inngestSend: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@switchboard/creative-pipeline", () => ({
  inngestClient: { send: inngestSend },
  estimateCost: vi.fn().mockReturnValue({ basic: { cost: 5 }, pro: { cost: 12 } }),
}));

const { creativePipelineRoutes } = await import("../routes/creative-pipeline.js");

const ORG = "org-acme";
const PRINCIPAL = "user-zoe";
const JOB_ID = "job-1";

const BRIEF = {
  productDescription: "Botox first-timer offer",
  targetAudience: "women 30-45",
  platforms: ["meta"],
};

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    taskId: "task-1",
    organizationId: ORG,
    deploymentId: "dep-1",
    productDescription: "Botox first-timer offer",
    targetAudience: "women 30-45",
    platforms: ["meta"],
    brandVoice: null,
    productImages: [],
    references: [],
    pastPerformance: null,
    generateReferenceImages: false,
    productionTier: null,
    currentStage: "storyboard",
    stageOutputs: {},
    stoppedAt: null,
    mode: "polished",
    ugcPhase: null,
    ugcPhaseOutputs: null,
    ugcPhaseOutputsVersion: null,
    ugcConfig: null,
    ugcFailure: null,
    reviewDecision: null,
    reviewDecidedAt: null,
    createdAt: new Date("2026-06-02"),
    updatedAt: new Date("2026-06-02"),
    ...overrides,
  };
}

interface Ctx {
  app: FastifyInstance;
  submit: ReturnType<typeof vi.fn>;
}

async function buildApp(): Promise<Ctx> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    return reply.code(statusCode).send({ error: message, statusCode });
  });

  // Dev-mode auth: the route plugin's own buildDevAuthFallback hook populates
  // organizationIdFromAuth / principalIdFromAuth from x-org-id / x-principal-id.
  app.decorate("authDisabled", true);
  app.decorate("prisma", {} as never);

  const submit = vi.fn();
  app.decorate("platformIngress", { submit } as never);

  await app.register(creativePipelineRoutes, { prefix: "/api/marketplace" });
  return { app, submit };
}

const HEADERS = {
  "x-org-id": ORG,
  "x-principal-id": PRINCIPAL,
  "content-type": "application/json",
};

describe("creative-pipeline routes → PlatformIngress (P2a-ii)", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    inngestSend.mockClear();
    ctx = await buildApp();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  // ── POST /creative-jobs → creative.job.submit ──────────────────────────────
  describe("POST /creative-jobs", () => {
    it("submits creative.job.submit with the authenticated org/actor and maps 201 {task, job}", async () => {
      const task = { id: "task-1" };
      const job = makeJob();
      ctx.submit.mockResolvedValue({
        ok: true,
        result: { outcome: "queued", outputs: { task, job }, error: undefined },
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/marketplace/creative-jobs",
        headers: HEADERS,
        payload: { deploymentId: "dep-1", listingId: "lst-1", brief: BRIEF, mode: "ugc" },
      });

      expect(res.statusCode).toBe(201);
      // Dates serialize to ISO strings over the wire — assert the contract the
      // dashboard actually receives.
      expect(res.json()).toEqual(JSON.parse(JSON.stringify({ task, job })));

      // No direct Inngest from the route — the workflow owns the pipeline kick.
      expect(inngestSend).not.toHaveBeenCalled();

      expect(ctx.submit).toHaveBeenCalledTimes(1);
      const arg = ctx.submit.mock.calls[0]![0];
      expect(arg).toMatchObject({
        intent: "creative.job.submit",
        parameters: {
          deploymentId: "dep-1",
          listingId: "lst-1",
          mode: "ugc",
        },
        actor: { id: PRINCIPAL, type: "user" },
        organizationId: ORG,
        trigger: "api",
        surface: { surface: "api" },
      });
      // Brief is forwarded verbatim (defaults applied by the route's zod parse).
      expect(arg.parameters.brief).toMatchObject({
        productDescription: "Botox first-timer offer",
        targetAudience: "women 30-45",
        platforms: ["meta"],
      });
    });

    it("defaults mode to polished when omitted", async () => {
      ctx.submit.mockResolvedValue({
        ok: true,
        result: { outcome: "queued", outputs: { task: { id: "t" }, job: makeJob() } },
      });
      await ctx.app.inject({
        method: "POST",
        url: "/api/marketplace/creative-jobs",
        headers: HEADERS,
        payload: { deploymentId: "dep-1", listingId: "lst-1", brief: BRIEF },
      });
      expect(ctx.submit.mock.calls[0]![0].parameters.mode).toBe("polished");
    });

    it("400 on invalid input and never submits", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/marketplace/creative-jobs",
        headers: HEADERS,
        payload: { deploymentId: "dep-1" },
      });
      expect(res.statusCode).toBe(400);
      expect(ctx.submit).not.toHaveBeenCalled();
    });

    it("throws (scrubbed 500) on an unexpected failed outcome", async () => {
      ctx.submit.mockResolvedValue({
        ok: true,
        result: { outcome: "failed", outputs: {}, error: { code: "BOOM", message: "kaboom" } },
      });
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/marketplace/creative-jobs",
        headers: HEADERS,
        payload: { deploymentId: "dep-1", listingId: "lst-1", brief: BRIEF },
      });
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe("Internal server error");
    });

    it("maps ingress ok:false via ingressErrorToReply (intent_not_found → 404)", async () => {
      ctx.submit.mockResolvedValue({
        ok: false,
        error: { type: "intent_not_found", message: "no such intent" },
      });
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/marketplace/creative-jobs",
        headers: HEADERS,
        payload: { deploymentId: "dep-1", listingId: "lst-1", brief: BRIEF },
      });
      expect(res.statusCode).toBe(404);
    });

    it("approval-required → 202 PENDING_APPROVAL, never a phantom 201", async () => {
      ctx.submit.mockResolvedValue({
        ok: true,
        approvalRequired: true,
        lifecycleId: "lc-1",
        bindingHash: "bh-1",
        workUnit: { id: "wu-1", traceId: "tr-1" },
        result: { outcome: "pending_approval", outputs: {} },
      });
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/marketplace/creative-jobs",
        headers: HEADERS,
        payload: { deploymentId: "dep-1", listingId: "lst-1", brief: BRIEF },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toMatchObject({
        outcome: "PENDING_APPROVAL",
        workUnitId: "wu-1",
        approvalRequest: { id: "lc-1", bindingHash: "bh-1" },
      });
      // Crucially NOT a 201 with empty job — no phantom success.
      expect(res.json().job).toBeUndefined();
    });
  });

  // ── POST /creative-jobs/:id/approve → creative.job.continue | stop ──────────
  describe("POST /creative-jobs/:id/approve", () => {
    it("continue → submits creative.job.continue {jobId, productionTier} and maps 200 {job, action}", async () => {
      const job = makeJob({ currentStage: "production" });
      ctx.submit.mockResolvedValue({
        ok: true,
        result: { outcome: "queued", outputs: { job, action: "approved" } },
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/marketplace/creative-jobs/${JOB_ID}/approve`,
        headers: HEADERS,
        payload: { action: "continue", productionTier: "pro" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(JSON.parse(JSON.stringify({ job, action: "approved" })));
      expect(inngestSend).not.toHaveBeenCalled();

      const arg = ctx.submit.mock.calls[0]![0];
      expect(arg).toMatchObject({
        intent: "creative.job.continue",
        parameters: { jobId: JOB_ID, productionTier: "pro" },
        actor: { id: PRINCIPAL, type: "user" },
        organizationId: ORG,
        trigger: "api",
      });
    });

    it("stop → submits creative.job.stop {jobId} and maps 200 {job, action}", async () => {
      const job = makeJob({ stoppedAt: "2026-06-02T00:00:00.000Z" });
      ctx.submit.mockResolvedValue({
        ok: true,
        result: { outcome: "queued", outputs: { job, action: "stopped" } },
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/marketplace/creative-jobs/${JOB_ID}/approve`,
        headers: HEADERS,
        payload: { action: "stop" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(JSON.parse(JSON.stringify({ job, action: "stopped" })));
      const arg = ctx.submit.mock.calls[0]![0];
      expect(arg.intent).toBe("creative.job.stop");
      expect(arg.parameters).toMatchObject({ jobId: JOB_ID });
    });

    it("maps failed CREATIVE_JOB_NOT_FOUND → 404", async () => {
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
        url: `/api/marketplace/creative-jobs/${JOB_ID}/approve`,
        headers: HEADERS,
        payload: { action: "continue" },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Creative job not found");
    });

    it("maps failed CREATIVE_JOB_NOT_AWAITING_APPROVAL → 409", async () => {
      ctx.submit.mockResolvedValue({
        ok: true,
        result: {
          outcome: "failed",
          outputs: {},
          error: {
            code: "CREATIVE_JOB_NOT_AWAITING_APPROVAL",
            message: "Job is not awaiting approval",
          },
        },
      });
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/marketplace/creative-jobs/${JOB_ID}/approve`,
        headers: HEADERS,
        payload: { action: "stop" },
      });
      expect(res.statusCode).toBe(409);
    });

    it("approval-required → 202 PENDING_APPROVAL, never a phantom 200 {job}", async () => {
      ctx.submit.mockResolvedValue({
        ok: true,
        approvalRequired: true,
        lifecycleId: "lc-2",
        bindingHash: "bh-2",
        workUnit: { id: "wu-2", traceId: "tr-2" },
        result: { outcome: "pending_approval", outputs: {} },
      });
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/marketplace/creative-jobs/${JOB_ID}/approve`,
        headers: HEADERS,
        payload: { action: "continue" },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toMatchObject({
        outcome: "PENDING_APPROVAL",
        approvalRequest: { id: "lc-2", bindingHash: "bh-2" },
      });
      expect(res.json().job).toBeUndefined();
    });

    it("400 on invalid action and never submits", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/marketplace/creative-jobs/${JOB_ID}/approve`,
        headers: HEADERS,
        payload: { action: "delete-everything" },
      });
      expect(res.statusCode).toBe(400);
      expect(ctx.submit).not.toHaveBeenCalled();
    });
  });
});
