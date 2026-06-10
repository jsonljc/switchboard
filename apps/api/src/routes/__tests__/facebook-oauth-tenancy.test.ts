// ---------------------------------------------------------------------------
// Cross-tenant scoping for GET /api/connections/facebook/:deploymentId/accounts
// (security-audit F2). The listing route took :deploymentId from the path and
// read+decrypted that deployment's Meta connection with NO org check, so any
// authenticated tenant could read any other tenant's ad accounts (and decrypt
// its Meta token) by supplying a foreign deploymentId. The route must verify
// the deployment belongs to the caller's org BEFORE any credential read.
// ---------------------------------------------------------------------------

import Fastify, { type FastifyInstance } from "fastify";
import { describe, it, expect, vi } from "vitest";
import { facebookOAuthRoutes } from "../facebook-oauth.js";

function buildMockPrisma(deploymentOrgId: string | null, hasConnection: boolean) {
  return {
    agentDeployment: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          deploymentOrgId === null ? null : { id: "dep_x", organizationId: deploymentOrgId },
        ),
    },
    deploymentConnection: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          hasConnection ? { id: "conn_1", type: "meta-ads", credentials: "enc" } : null,
        ),
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
  await app.register(facebookOAuthRoutes, { prefix: "/api/connections" });
  return app;
}

describe("facebook-oauth listing route — cross-tenant authorization (F2)", () => {
  it("403s when the deployment is not owned by the caller, before any credential read", async () => {
    const prisma = buildMockPrisma("org_b", true); // deployment belongs to org_b
    const app = await buildApp({ prisma, organizationId: "org_a" });
    const res = await app.inject({
      method: "GET",
      url: "/api/connections/facebook/dep_b/accounts",
    });
    expect(res.statusCode).toBe(403);
    // The foreign tenant's connection is never read or decrypted.
    expect(prisma.deploymentConnection.findFirst).not.toHaveBeenCalled();
  });

  it("does not over-block a deployment the caller owns (reaches the connection lookup)", async () => {
    const prisma = buildMockPrisma("org_a", false); // owned, but no connection yet
    const app = await buildApp({ prisma, organizationId: "org_a" });
    const res = await app.inject({
      method: "GET",
      url: "/api/connections/facebook/dep_a/accounts",
    });
    expect(res.statusCode).toBe(404); // org check passed; no meta-ads connection found
    expect(prisma.deploymentConnection.findFirst).toHaveBeenCalled();
  });

  it("404s a deployment that does not exist, without leaking org membership", async () => {
    const prisma = buildMockPrisma(null, false);
    const app = await buildApp({ prisma, organizationId: "org_a" });
    const res = await app.inject({
      method: "GET",
      url: "/api/connections/facebook/dep_missing/accounts",
    });
    expect(res.statusCode).toBe(404);
    expect(prisma.deploymentConnection.findFirst).not.toHaveBeenCalled();
  });

  it("fails closed (401) when auth is enabled but the request has no org binding", async () => {
    const prisma = buildMockPrisma("org_a", true);
    const app = await buildApp({ prisma }); // organizationId omitted
    const res = await app.inject({
      method: "GET",
      url: "/api/connections/facebook/dep_a/accounts",
    });
    expect(res.statusCode).toBe(401);
    expect(prisma.agentDeployment.findUnique).not.toHaveBeenCalled();
  });
});
