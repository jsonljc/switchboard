import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creativePipelineRoutes } from "../creative-pipeline.js";

describe("creativePipelineRoutes containment", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;
  const submit = vi.fn();

  beforeEach(async () => {
    submit.mockReset();
    submit.mockResolvedValue({
      ok: true,
      result: {
        workUnitId: "wu_1",
        outcome: "queued",
        summary: "queued",
        outputs: { task: { id: "task_1" }, job: { id: "job_1" } },
        mode: "workflow",
        durationMs: 5,
        traceId: "trace_1",
      },
      workUnit: {
        id: "wu_1",
        requestedAt: new Date().toISOString(),
        organizationId: "org_1",
        actor: { id: "principal_1", type: "user" },
        intent: "creative.job.submit",
        parameters: {},
        deployment: {
          deploymentId: "dep_1",
          skillSlug: "creative",
          trustLevel: "guided",
          trustScore: 42,
        },
        resolvedMode: "workflow",
        traceId: "trace_1",
        trigger: "api",
        priority: "normal",
      },
    });

    app = Fastify({ logger: false });
    app.decorate("platformIngress", { submit } as never);
    app.decorate("deploymentResolver", null);
    app.decorate("prisma", null);
    app.decorateRequest("organizationIdFromAuth", null);
    app.decorateRequest("principalIdFromAuth", null);
    app.decorateRequest("traceId", null);
    app.addHook("preHandler", async (request) => {
      (request as Record<string, unknown>).organizationIdFromAuth = "org_1";
      (request as Record<string, unknown>).principalIdFromAuth = "principal_1";
      (request as Record<string, unknown>).traceId = "trace_req_1";
    });
    await app.register(creativePipelineRoutes, { prefix: "/api/marketplace" });
  });

  afterEach(async () => {
    await app.close();
  });

  it("submits creative job creation through PlatformIngress", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/creative-jobs",
      payload: {
        deploymentId: "dep_1",
        listingId: "listing_1",
        mode: "polished",
        brief: {
          productDescription: "New drink",
          targetAudience: "Creators",
          platforms: ["tiktok"],
          productImages: [],
          references: [],
          generateReferenceImages: false,
        },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org_1",
      intent: "creative.job.submit",
      trigger: "api",
      parameters: {
        deploymentId: "dep_1",
        listingId: "listing_1",
        mode: "polished",
      },
    });
  });

  it("submits creative stop decisions through PlatformIngress", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/creative-jobs/job_1/approve",
      payload: { action: "stop" },
    });

    expect(res.statusCode).toBe(200);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      intent: "creative.job.stop",
      parameters: { jobId: "job_1", action: "stop" },
    });
  });

  it("submits creative continue decisions through PlatformIngress", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/creative-jobs/job_1/approve",
      payload: { action: "continue", productionTier: "pro" },
    });

    expect(res.statusCode).toBe(200);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      intent: "creative.job.continue",
      parameters: { jobId: "job_1", action: "continue", productionTier: "pro" },
    });
  });
});
