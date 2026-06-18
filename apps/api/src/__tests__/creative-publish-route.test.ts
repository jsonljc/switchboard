/**
 * POST /creative-jobs/:id/publish — pre-flight (assertPublishable) → governed
 * submit → 202 PENDING_APPROVAL. The route runs the REAL assertPublishable against
 * a mocked prisma + decrypt, so a doomed publish gets an immediate, actionable 4xx
 * and never parks; a viable one submits creative.job.publish and (because the
 * seeded require_approval policy always parks it) returns 202 — never a phantom 2xx.
 * A spy ingress stands in for the real governance stack (proven in
 * creative-publish-gate.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance, FastifyError } from "fastify";

const { findUnique, connFindFirst, submit, decrypt } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  connFindFirst: vi.fn(),
  submit: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock("@switchboard/creative-pipeline", () => ({
  inngestClient: { send: vi.fn() },
  estimateCost: vi.fn().mockReturnValue({ basic: { cost: 5 }, pro: { cost: 12 } }),
}));
vi.mock("@switchboard/db", () => ({
  PrismaCreativeJobStore: class {
    findById = vi.fn();
  },
  decryptCredentials: decrypt,
}));

const { creativePipelineRoutes } = await import("../routes/creative-pipeline.js");

const ORG = "org-acme";
const PRINCIPAL = "user-zoe";
const JOB_ID = "job-1";

const KEPT_JOB = {
  id: JOB_ID,
  organizationId: ORG,
  productDescription: "Botox first-timer offer",
  currentStage: "complete",
  stoppedAt: null,
  reviewDecision: "kept",
  durableAssetUrl: "https://cdn.example/a.mp4",
};

interface Ctx {
  app: FastifyInstance;
}

async function buildApp(): Promise<Ctx> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    return reply.code(statusCode).send({ error: message, statusCode });
  });
  app.decorate("authDisabled", true);
  app.decorate("prisma", {
    creativeJob: { findUnique },
    connection: { findFirst: connFindFirst },
  } as never);
  app.decorate("platformIngress", { submit } as never);
  await app.register(creativePipelineRoutes, { prefix: "/api/marketplace" });
  return { app };
}

function publish() {
  // No body — omit content-type so Fastify's JSON parser doesn't 400 on empty body.
  return {
    method: "POST" as const,
    url: `/api/marketplace/creative-jobs/${JOB_ID}/publish`,
    headers: { "x-org-id": ORG, "x-principal-id": PRINCIPAL },
  };
}

describe("POST /creative-jobs/:id/publish", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    findUnique.mockReset();
    connFindFirst.mockReset();
    submit.mockReset();
    decrypt.mockReset();
    // assertPublishable reads only the meta-ads connection (WABA/whatsapp is not
    // a publish precondition for paused LEARN_MORE drafts). Decrypt returns the
    // meta-ads creds for any ciphertext.
    decrypt.mockImplementation(() => ({
      accessToken: "tok",
      accountId: "act_1",
      pageId: "page_1",
    }));
    connFindFirst.mockImplementation(async ({ where }: { where?: { serviceId?: string } }) =>
      where?.serviceId === "whatsapp"
        ? null
        : { credentials: "enc", externalAccountId: "act_1", status: "connected" },
    );
    ctx = await buildApp();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it("parks → 202 PENDING_APPROVAL for a publishable creative", async () => {
    findUnique.mockResolvedValue(KEPT_JOB);
    submit.mockResolvedValue({
      ok: true,
      approvalRequired: true,
      lifecycleId: "lc-1",
      bindingHash: "bh-1",
      workUnit: { id: "wu-1", traceId: "tr-1" },
      result: { outcome: "pending_approval", outputs: {} },
    });

    const res = await ctx.app.inject(publish());

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      outcome: "PENDING_APPROVAL",
      workUnitId: "wu-1",
      approvalRequest: { id: "lc-1", bindingHash: "bh-1" },
    });
    const arg = submit.mock.calls[0]![0];
    expect(arg).toMatchObject({
      intent: "creative.job.publish",
      parameters: { jobId: JOB_ID },
      actor: { id: PRINCIPAL, type: "user" },
      organizationId: ORG,
      trigger: "api",
    });
  });

  it("422 CREATIVE_ASSET_NOT_DURABLE (pre-flight) and never submits", async () => {
    findUnique.mockResolvedValue({ ...KEPT_JOB, durableAssetUrl: null });

    const res = await ctx.app.inject(publish());

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CREATIVE_ASSET_NOT_DURABLE");
    expect(submit).not.toHaveBeenCalled();
  });

  it("404 CREATIVE_JOB_NOT_FOUND for a missing/cross-org job and never submits", async () => {
    findUnique.mockResolvedValue(null);

    const res = await ctx.app.inject(publish());

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("CREATIVE_JOB_NOT_FOUND");
    expect(submit).not.toHaveBeenCalled();
  });

  it("422 META_PAGE_NOT_CONFIGURED when no Page id resolvable", async () => {
    findUnique.mockResolvedValue(KEPT_JOB);
    // meta-ads creds lose the pageId — page check blocks publish before submit.
    decrypt.mockImplementation(() => ({ accessToken: "tok", accountId: "act_1" }));

    const res = await ctx.app.inject(publish());

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("META_PAGE_NOT_CONFIGURED");
    expect(submit).not.toHaveBeenCalled();
  });

  it("422 META_CONNECTION_NOT_CONNECTED when the meta-ads connection is not connected", async () => {
    findUnique.mockResolvedValue(KEPT_JOB);
    connFindFirst.mockImplementation(async ({ where }: { where?: { serviceId?: string } }) =>
      where?.serviceId === "whatsapp"
        ? { credentials: "enc-waba", externalAccountId: "waba_1", status: "connected" }
        : { credentials: "enc", externalAccountId: "act_1", status: "revoked" },
    );

    const res = await ctx.app.inject(publish());

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("META_CONNECTION_NOT_CONNECTED");
    expect(submit).not.toHaveBeenCalled();
  });

  it("parks → 202 PENDING_APPROVAL when the org has no whatsapp connection (WABA is not a publish blocker)", async () => {
    // The beforeEach default already returns null for whatsapp — this test uses
    // that default to prove a no-WABA org can still publish a paused Meta draft.
    findUnique.mockResolvedValue(KEPT_JOB);
    submit.mockResolvedValue({
      ok: true,
      approvalRequired: true,
      lifecycleId: "lc-2",
      bindingHash: "bh-2",
      workUnit: { id: "wu-2", traceId: "tr-2" },
      result: { outcome: "pending_approval", outputs: {} },
    });

    const res = await ctx.app.inject(publish());

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      outcome: "PENDING_APPROVAL",
      approvalRequest: { id: "lc-2", bindingHash: "bh-2" },
    });
    expect(submit).toHaveBeenCalledOnce();
  });
});
