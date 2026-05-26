// ---------------------------------------------------------------------------
// Cross-tenant scoping for /api/marketplace/:orgId/deployments/* — A1
//
// The deployment-memory routes take :orgId from the path and pass it straight
// to the store. Without an authorization guard, a principal authenticated for
// org_a can read and mutate org_b's learned memory + FAQ-draft knowledge chunks
// simply by putting org_b in the path. Every endpoint must reject a path orgId
// that does not match the authenticated org, BEFORE any data access.
// ---------------------------------------------------------------------------

import Fastify, { type FastifyInstance } from "fastify";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { deploymentMemoryRoutes } from "../deployment-memory.js";

function buildMockPrisma() {
  return {
    knowledgeChunk: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "faq-1",
          content: "org_b confidential FAQ content",
          sourceType: "owner",
          draftStatus: "pending",
          draftExpiresAt: null,
          createdAt: new Date("2026-05-01T00:00:00Z"),
        },
      ]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    deploymentMemory: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "mem-1" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

async function buildApp(opts: {
  prisma: unknown;
  organizationId?: string;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("prisma", opts.prisma as never);
  app.decorate("authDisabled", false as never);
  app.addHook("preHandler", async (request) => {
    if (opts.organizationId !== undefined) {
      request.organizationIdFromAuth = opts.organizationId;
    }
  });
  await app.register(deploymentMemoryRoutes, { prefix: "/api/marketplace" });
  return app;
}

describe("deployment-memory routes — cross-tenant authorization (A1)", () => {
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    prisma = buildMockPrisma();
  });

  it("rejects a cross-org READ of FAQ drafts with 403 before touching the data layer", async () => {
    // org_a authenticates but asks for org_b's deployment in the path.
    const app = await buildApp({ prisma, organizationId: "org_a" });
    const res = await app.inject({
      method: "GET",
      url: "/api/marketplace/org_b/deployments/dep-1/faq-drafts",
    });
    expect(res.statusCode).toBe(403);
    // The data layer must never be reached — no leak of org_b's content.
    expect(prisma.knowledgeChunk.findMany).not.toHaveBeenCalled();
  });

  it("rejects a cross-org WRITE (FAQ approve) with 403 before touching the data layer", async () => {
    const app = await buildApp({ prisma, organizationId: "org_a" });
    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/org_b/deployments/dep-1/faq-drafts/faq-1/approve",
    });
    expect(res.statusCode).toBe(403);
    expect(prisma.knowledgeChunk.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a cross-org memory create with 403 before touching the data layer", async () => {
    const app = await buildApp({ prisma, organizationId: "org_a" });
    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/org_b/deployments/dep-1/memory",
      payload: { content: "injected fact", category: "fact" },
    });
    expect(res.statusCode).toBe(403);
    expect(prisma.deploymentMemory.create).not.toHaveBeenCalled();
  });

  it("allows a same-org read (guard does not over-block)", async () => {
    const app = await buildApp({ prisma, organizationId: "org_a" });
    const res = await app.inject({
      method: "GET",
      url: "/api/marketplace/org_a/deployments/dep-1/faq-drafts",
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.knowledgeChunk.findMany).toHaveBeenCalledTimes(1);
    const body = JSON.parse(res.body) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it("rejects a cross-org memory delete with 403 before touching the data layer", async () => {
    const app = await buildApp({ prisma, organizationId: "org_a" });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/marketplace/org_b/deployments/dep-1/memory/mem-1",
    });
    expect(res.statusCode).toBe(403);
    expect(prisma.deploymentMemory.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects a cross-org FAQ reject (destructive) with 403 before touching the data layer", async () => {
    const app = await buildApp({ prisma, organizationId: "org_a" });
    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/org_b/deployments/dep-1/faq-drafts/faq-1/reject",
    });
    expect(res.statusCode).toBe(403);
    expect(prisma.knowledgeChunk.deleteMany).not.toHaveBeenCalled();
  });

  it("fails closed (403) when auth is enabled but the request has no org binding", async () => {
    // authDisabled is false and no organizationIdFromAuth is set (e.g. an
    // unscoped static API key). assertOrgAccess must deny, never treat it as
    // dev mode. Even a same-looking path must not reach the data layer.
    const app = await buildApp({ prisma }); // organizationId omitted
    const res = await app.inject({
      method: "GET",
      url: "/api/marketplace/org_a/deployments/dep-1/faq-drafts",
    });
    expect(res.statusCode).toBe(403);
    expect(prisma.knowledgeChunk.findMany).not.toHaveBeenCalled();
  });
});
