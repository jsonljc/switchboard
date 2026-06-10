/**
 * OAuth connection cross-tenant isolation — finding F2.
 *
 * Two GET endpoints listed a deployment's OAuth-backed resources:
 *   GET /api/connections/facebook/:deploymentId/accounts
 *   GET /api/connections/google-calendar/:deploymentId/calendars
 * Both took deploymentId straight from the URL, read the connection with NO org
 * filter (PrismaDeploymentConnectionStore.findByDeploymentAndType has no org
 * scoping), then decrypted and used another clinic's stored OAuth tokens. A
 * caller authenticated as Org A could pass Org B's deploymentId (which leaks in
 * the dashboard callback redirect) and exfiltrate Org B's Meta/Google data.
 *
 * These tests prove the org gate now fires AFTER the deployment load but BEFORE
 * the connection read / token decrypt / external API call.
 *
 * Auth is ENABLED here (authDisabled === false). This is essential: assertOrgAccess
 * (and the marketplace org check) allow everything when authDisabled === true, so a
 * dev-bypass harness would pass trivially and prove nothing.
 *
 * Finding: docs/audits/2026-06-10-security-audit/03-multi-tenant-isolation.md
 *          and 11-tickets.md -> F2.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance, FastifyError } from "fastify";
import { facebookOAuthRoutes } from "../routes/facebook-oauth.js";
import { googleCalendarOAuthRoutes } from "../routes/google-calendar-oauth.js";

const ORG_A = "org_A";
const ORG_B = "org_B";
const KEY_A = "key-org-a";
const KEY_B = "key-org-b";
const UNSCOPED_KEY = "key-unscoped";

// dep_A belongs to Org A and has NO stored connection (the over-block guard).
// dep_B belongs to Org B and HAS a stored connection (the cross-tenant target).
// dep_B's credentials are intentionally un-decryptable: pre-fix the vulnerable
// path reaches the connection read + decrypt and 500s (synchronously, no network);
// post-fix the org gate rejects with 403 before the connection is ever read.
const DEPLOYMENT_A = "dep_A";
const DEPLOYMENT_B = "dep_B";

interface ScopedTestApp {
  app: FastifyInstance;
  deploymentFindUnique: ReturnType<typeof vi.fn>;
  connectionFindFirst: ReturnType<typeof vi.fn>;
}

/**
 * Builds an auth-ENABLED app: bearer tokens map to organizationIdFromAuth, an
 * unscoped token sets organizationIdFromAuth=undefined, a missing/invalid token
 * returns 401. app.prisma is a mock exposing exactly the two queries the routes
 * reach through PrismaDeploymentStore.findById (agentDeployment.findUnique) and
 * PrismaDeploymentConnectionStore.findByDeploymentAndType (deploymentConnection.findFirst).
 */
async function buildScopedApp(): Promise<ScopedTestApp> {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    return reply.code(statusCode).send({ error: message, statusCode });
  });

  // Auth ENABLED — assertOrgAccess only enforces when authDisabled === false.
  app.decorate("authDisabled", false);
  app.decorateRequest("organizationIdFromAuth", undefined);

  app.addHook("preHandler", async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth) {
      return reply.code(401).send({ error: "Missing Authorization header", statusCode: 401 });
    }
    const match = /^Bearer\s+(\S+)$/i.exec(auth);
    const key = match?.[1];
    if (key === KEY_A) {
      request.organizationIdFromAuth = ORG_A;
    } else if (key === KEY_B) {
      request.organizationIdFromAuth = ORG_B;
    } else if (key === UNSCOPED_KEY) {
      // Unscoped key: auth succeeds but no org binding. Must fail closed (403).
      request.organizationIdFromAuth = undefined;
    } else {
      return reply.code(401).send({ error: "Invalid API key", statusCode: 401 });
    }
  });

  // PrismaDeploymentStore.findById → prisma.agentDeployment.findUnique({ where: { id } })
  const deploymentsById: Record<string, { id: string; organizationId: string }> = {
    [DEPLOYMENT_A]: { id: DEPLOYMENT_A, organizationId: ORG_A },
    [DEPLOYMENT_B]: { id: DEPLOYMENT_B, organizationId: ORG_B },
  };
  const deploymentFindUnique = vi.fn(
    async ({ where }: { where: { id: string } }) => deploymentsById[where.id] ?? null,
  );

  // PrismaDeploymentConnectionStore.findByDeploymentAndType →
  // prisma.deploymentConnection.findFirst({ where: { deploymentId, type } })
  const connectionFindFirst = vi.fn(
    async ({ where }: { where: { deploymentId: string; type: string } }) => {
      if (where.deploymentId === DEPLOYMENT_B) {
        return {
          id: "conn_B",
          deploymentId: DEPLOYMENT_B,
          type: where.type,
          slot: "default",
          credentials: "not-a-real-ciphertext",
          metadata: {},
          status: "active",
        };
      }
      return null;
    },
  );

  app.decorate("prisma", {
    agentDeployment: { findUnique: deploymentFindUnique },
    deploymentConnection: { findFirst: connectionFindFirst },
  } as unknown as never);

  await app.register(facebookOAuthRoutes, { prefix: "/api/connections" });
  await app.register(googleCalendarOAuthRoutes, { prefix: "/api/connections" });

  return { app, deploymentFindUnique, connectionFindFirst };
}

const HEADERS_A = { authorization: `Bearer ${KEY_A}` };
const HEADERS_UNSCOPED = { authorization: `Bearer ${UNSCOPED_KEY}` };

const FB_URL = (dep: string) => `/api/connections/facebook/${dep}/accounts`;
const GCAL_URL = (dep: string) => `/api/connections/google-calendar/${dep}/calendars`;

describe("OAuth connection cross-tenant isolation (F2)", () => {
  let ctx: ScopedTestApp;

  beforeEach(async () => {
    ctx = await buildScopedApp();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  describe("GET /api/connections/facebook/:deploymentId/accounts", () => {
    it("rejects Org A reading Org B's deployment with 403, before any connection read", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: FB_URL(DEPLOYMENT_B),
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(403);
      // The token is never touched: the gate fires before the connection lookup.
      expect(ctx.connectionFindFirst).not.toHaveBeenCalled();
    });

    it("returns 404 for Org A's own deployment with no connection (does not over-block)", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: FB_URL(DEPLOYMENT_A),
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(404);
      // Org check passed, so the route proceeded to look up the (absent) connection.
      expect(ctx.connectionFindFirst).toHaveBeenCalled();
    });

    it("rejects an unscoped key with 403 (fail closed, no org binding)", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: FB_URL(DEPLOYMENT_A),
        headers: HEADERS_UNSCOPED,
      });
      expect(res.statusCode).toBe(403);
      expect(ctx.connectionFindFirst).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/connections/google-calendar/:deploymentId/calendars", () => {
    it("rejects Org A reading Org B's deployment with 403, before any connection read", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: GCAL_URL(DEPLOYMENT_B),
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(403);
      expect(ctx.connectionFindFirst).not.toHaveBeenCalled();
    });

    it("returns 404 for Org A's own deployment with no connection (does not over-block)", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: GCAL_URL(DEPLOYMENT_A),
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(404);
      expect(ctx.connectionFindFirst).toHaveBeenCalled();
    });

    it("rejects an unscoped key with 403 (fail closed, no org binding)", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: GCAL_URL(DEPLOYMENT_A),
        headers: HEADERS_UNSCOPED,
      });
      expect(res.statusCode).toBe(403);
      expect(ctx.connectionFindFirst).not.toHaveBeenCalled();
    });
  });

  it("returns 401 when no Authorization header is present on either endpoint", async () => {
    const fb = await ctx.app.inject({ method: "GET", url: FB_URL(DEPLOYMENT_B) });
    const gcal = await ctx.app.inject({ method: "GET", url: GCAL_URL(DEPLOYMENT_B) });
    expect(fb.statusCode).toBe(401);
    expect(gcal.statusCode).toBe(401);
  });
});
