// ---------------------------------------------------------------------------
// Cross-tenant scoping for GET /api/connections/google-calendar/:deploymentId/
// calendars (security-audit F2, google twin of facebook-oauth-tenancy). The
// listing route read+decrypted a deployment's Google refresh token with no org
// check, so any authenticated tenant could read another tenant's calendars by
// supplying a foreign deploymentId. The route must verify the deployment
// belongs to the caller's org BEFORE any credential read.
// ---------------------------------------------------------------------------

import Fastify, { type FastifyInstance } from "fastify";
import { describe, it, expect, vi } from "vitest";
import { googleCalendarOAuthRoutes } from "../google-calendar-oauth.js";

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
          hasConnection ? { id: "conn_1", type: "google_calendar", credentials: "enc" } : null,
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
  await app.register(googleCalendarOAuthRoutes, { prefix: "/api/connections" });
  return app;
}

describe("google-calendar-oauth listing route — cross-tenant authorization (F2)", () => {
  it("403s when the deployment is not owned by the caller, before any credential read", async () => {
    const prisma = buildMockPrisma("org_b", true);
    const app = await buildApp({ prisma, organizationId: "org_a" });
    const res = await app.inject({
      method: "GET",
      url: "/api/connections/google-calendar/dep_b/calendars",
    });
    expect(res.statusCode).toBe(403);
    expect(prisma.deploymentConnection.findFirst).not.toHaveBeenCalled();
  });

  it("does not over-block a deployment the caller owns (reaches the connection lookup)", async () => {
    const prisma = buildMockPrisma("org_a", false);
    const app = await buildApp({ prisma, organizationId: "org_a" });
    const res = await app.inject({
      method: "GET",
      url: "/api/connections/google-calendar/dep_a/calendars",
    });
    expect(res.statusCode).toBe(404);
    expect(prisma.deploymentConnection.findFirst).toHaveBeenCalled();
  });

  it("404s a deployment that does not exist, without leaking org membership", async () => {
    const prisma = buildMockPrisma(null, false);
    const app = await buildApp({ prisma, organizationId: "org_a" });
    const res = await app.inject({
      method: "GET",
      url: "/api/connections/google-calendar/dep_missing/calendars",
    });
    expect(res.statusCode).toBe(404);
    expect(prisma.deploymentConnection.findFirst).not.toHaveBeenCalled();
  });

  it("fails closed (401) when auth is enabled but the request has no org binding", async () => {
    const prisma = buildMockPrisma("org_a", true);
    const app = await buildApp({ prisma });
    const res = await app.inject({
      method: "GET",
      url: "/api/connections/google-calendar/dep_a/calendars",
    });
    expect(res.statusCode).toBe(401);
    expect(prisma.agentDeployment.findUnique).not.toHaveBeenCalled();
  });
});
