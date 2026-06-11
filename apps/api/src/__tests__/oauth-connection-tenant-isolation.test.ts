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
import { buildSignedState, verifySignedState } from "@switchboard/ad-optimizer";
import { resolveOAuthStateSecret } from "../utils/oauth-state-secret.js";

// Partial-mock the Meta token-exchange network calls so the facebook callback success path runs
// without hitting Graph. buildSignedState / verifySignedState / buildAuthorizationUrl stay REAL
// (spread from the actual module) — the signed-state crypto is exactly what these tests verify.
vi.mock("@switchboard/ad-optimizer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@switchboard/ad-optimizer")>();
  return {
    ...actual,
    exchangeCodeForToken: vi.fn(async () => ({
      accessToken: "short-lived-token",
      expiresIn: 3600,
    })),
    exchangeForLongLivedToken: vi.fn(async () => ({
      accessToken: "long-lived-token",
      expiresIn: 5184000,
    })),
    listAdAccounts: vi.fn(async () => [
      { accountId: "999", name: "Test Ad Account", currency: "USD", status: 1 },
    ]),
  };
});

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
  connectionCreate: ReturnType<typeof vi.fn>;
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

  // PrismaDeploymentConnectionStore.create → prisma.deploymentConnection.create({ data })
  const connectionCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "conn_new",
    ...data,
  }));

  app.decorate("prisma", {
    agentDeployment: { findUnique: deploymentFindUnique },
    deploymentConnection: { findFirst: connectionFindFirst, create: connectionCreate },
  } as unknown as never);

  await app.register(facebookOAuthRoutes, { prefix: "/api/connections" });
  await app.register(googleCalendarOAuthRoutes, { prefix: "/api/connections" });

  return { app, deploymentFindUnique, connectionFindFirst, connectionCreate };
}

const HEADERS_A = { authorization: `Bearer ${KEY_A}` };
const HEADERS_B = { authorization: `Bearer ${KEY_B}` };
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

    it("scopes the connection read to the caller's org at the store layer (defense-in-depth)", async () => {
      // Org B reads its OWN deployment, so the gate passes and the route reaches the store read.
      // That read must carry the caller's org in the WHERE, so it stays tenant-safe even if the
      // route-level gate were ever removed (findByDeploymentAndTypeForOrg, not the org-blind read).
      await ctx.app.inject({ method: "GET", url: FB_URL(DEPLOYMENT_B), headers: HEADERS_B });
      expect(ctx.connectionFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deploymentId: DEPLOYMENT_B,
            type: "meta-ads",
            deployment: { organizationId: ORG_B },
          }),
        }),
      );
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

    it("scopes the connection read to the caller's org at the store layer (defense-in-depth)", async () => {
      await ctx.app.inject({ method: "GET", url: GCAL_URL(DEPLOYMENT_B), headers: HEADERS_B });
      expect(ctx.connectionFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deploymentId: DEPLOYMENT_B,
            type: "google_calendar",
            deployment: { organizationId: ORG_B },
          }),
        }),
      );
    });
  });

  it("returns 401 when no Authorization header is present on either endpoint", async () => {
    const fb = await ctx.app.inject({ method: "GET", url: FB_URL(DEPLOYMENT_B) });
    const gcal = await ctx.app.inject({ method: "GET", url: GCAL_URL(DEPLOYMENT_B) });
    expect(fb.statusCode).toBe(401);
    expect(gcal.statusCode).toBe(401);
  });
});

/**
 * OAuth authorize (mint) + callback (consume) signed-state flow (D10-3 / PR 0.2b).
 *
 * - The authorize leg stays Bearer-authed and runs assertOrgAccess BEFORE minting a signed state,
 *   so a caller cannot mint a state for a deployment their org does not own (connection-fixation).
 * - The callback (auth-exempt at the real middleware; here it just ignores the Bearer) trusts ONLY
 *   the signed state: it verifies the HMAC, resolves the org from the deployment via a trusted DB
 *   lookup, and rejects any forged / tampered / expired state with 400.
 *
 * The auth-EXEMPTION of the callback (reachable without a Bearer) is proven separately in
 * middleware/__tests__/auth-webhook-exemption.test.ts; this harness uses a custom preHandler that
 * requires a Bearer, so callback requests here carry one even though the route logic never reads it.
 */
describe("OAuth signed-state authorize + callback (D10-3)", () => {
  let ctx: ScopedTestApp;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    "SESSION_TOKEN_SECRET",
    "CREDENTIALS_ENCRYPTION_KEY",
    "META_APP_ID",
    "META_APP_SECRET",
    "META_OAUTH_REDIRECT_URI",
    "GOOGLE_CALENDAR_CLIENT_ID",
    "GOOGLE_CALENDAR_CLIENT_SECRET",
    "GOOGLE_CALENDAR_REDIRECT_URI",
  ];

  const secret = () => resolveOAuthStateSecret(process.env);
  const FB_AUTHORIZE = (dep?: string) =>
    `/api/connections/facebook/authorize${dep ? `?deploymentId=${dep}` : ""}`;
  const GCAL_AUTHORIZE = (dep?: string) =>
    `/api/connections/google-calendar/authorize${dep ? `?deploymentId=${dep}` : ""}`;
  const FB_CALLBACK = (qs: string) => `/api/connections/facebook/callback?${qs}`;
  const GCAL_CALLBACK = (qs: string) => `/api/connections/google-calendar/callback?${qs}`;

  const stateFor = (dep: string, issuedAtMs?: number) =>
    buildSignedState(dep, secret(), issuedAtMs ?? Date.now());

  beforeEach(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env["SESSION_TOKEN_SECRET"] = "test-oauth-state-secret-deterministic-value";
    process.env["CREDENTIALS_ENCRYPTION_KEY"] = "test-key";
    process.env["META_APP_ID"] = "test-meta-app-id";
    process.env["META_APP_SECRET"] = "test-meta-app-secret";
    process.env["META_OAUTH_REDIRECT_URI"] =
      "https://api.example.com/api/connections/facebook/callback";
    process.env["GOOGLE_CALENDAR_CLIENT_ID"] = "test-google-client-id";
    process.env["GOOGLE_CALENDAR_CLIENT_SECRET"] = "test-google-client-secret";
    process.env["GOOGLE_CALENDAR_REDIRECT_URI"] =
      "https://api.example.com/api/connections/google-calendar/callback";
    ctx = await buildScopedApp();
  });

  afterEach(async () => {
    await ctx.app.close();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  const extractState = (authorizeUrl: string): string => {
    const u = new URL(authorizeUrl);
    return u.searchParams.get("state") ?? "";
  };

  describe("authorize leg (authed + assertOrgAccess + sign)", () => {
    it("facebook: 403s minting a state for a foreign deployment, before signing", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: FB_AUTHORIZE(DEPLOYMENT_B),
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(403);
    });

    it("facebook: returns an authorizeUrl carrying a state bound to the owned deployment", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: FB_AUTHORIZE(DEPLOYMENT_A),
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(200);
      const { authorizeUrl } = res.json() as { authorizeUrl: string };
      expect(authorizeUrl).toContain("facebook.com");
      expect(verifySignedState(extractState(authorizeUrl), secret())).toEqual({
        deploymentId: DEPLOYMENT_A,
      });
    });

    it("facebook: 403s an unscoped key (fail closed)", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: FB_AUTHORIZE(DEPLOYMENT_A),
        headers: HEADERS_UNSCOPED,
      });
      expect(res.statusCode).toBe(403);
    });

    it("facebook: 400s when deploymentId is missing", async () => {
      const res = await ctx.app.inject({ method: "GET", url: FB_AUTHORIZE(), headers: HEADERS_A });
      expect(res.statusCode).toBe(400);
    });

    it("google: 403s minting a state for a foreign deployment", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: GCAL_AUTHORIZE(DEPLOYMENT_B),
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(403);
    });

    it("google: returns an authorizeUrl carrying a state bound to the owned deployment", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: GCAL_AUTHORIZE(DEPLOYMENT_A),
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(200);
      const { authorizeUrl } = res.json() as { authorizeUrl: string };
      expect(verifySignedState(extractState(authorizeUrl), secret())).toEqual({
        deploymentId: DEPLOYMENT_A,
      });
    });
  });

  describe("callback leg (verify signed state + trusted org lookup)", () => {
    it("facebook: 400s a missing state", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: FB_CALLBACK("code=abc"),
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(400);
      expect(ctx.connectionCreate).not.toHaveBeenCalled();
    });

    it("facebook: 400s a raw/unsigned state (the pre-fix format)", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: FB_CALLBACK(`code=abc&state=${DEPLOYMENT_A}`),
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(400);
      expect(ctx.connectionCreate).not.toHaveBeenCalled();
    });

    it("facebook: 400s a tampered state", async () => {
      const valid = stateFor(DEPLOYMENT_A);
      const [payload, sig] = valid.split(".") as [string, string];
      const tampered = `${(payload[0] === "A" ? "B" : "A") + payload.slice(1)}.${sig}`;
      const res = await ctx.app.inject({
        method: "GET",
        url: FB_CALLBACK(`code=abc&state=${encodeURIComponent(tampered)}`),
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(400);
      expect(ctx.connectionCreate).not.toHaveBeenCalled();
    });

    it("facebook: 400s an expired state", async () => {
      const expired = stateFor(DEPLOYMENT_A, Date.now() - 11 * 60 * 1000);
      const res = await ctx.app.inject({
        method: "GET",
        url: FB_CALLBACK(`code=abc&state=${encodeURIComponent(expired)}`),
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(400);
      expect(ctx.connectionCreate).not.toHaveBeenCalled();
    });

    it("facebook: a valid round-trip writes a connection bound to the state's deployment", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: FB_CALLBACK(`code=abc&state=${encodeURIComponent(stateFor(DEPLOYMENT_A))}`),
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(302); // redirects back to the dashboard
      expect(ctx.connectionCreate).toHaveBeenCalledTimes(1);
      const data = ctx.connectionCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
      expect(data).toMatchObject({ deploymentId: DEPLOYMENT_A, type: "meta-ads" });
    });

    it("facebook: binds to the state's deployment, not the caller's Bearer org", async () => {
      // Caller authenticates as Org B, but the signed state names Org A's deployment. The callback
      // trusts the state (and the deployment's own org), not the Bearer.
      const res = await ctx.app.inject({
        method: "GET",
        url: FB_CALLBACK(`code=abc&state=${encodeURIComponent(stateFor(DEPLOYMENT_A))}`),
        headers: HEADERS_B,
      });
      expect(res.statusCode).toBe(302);
      const data = ctx.connectionCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
      expect(data).toMatchObject({ deploymentId: DEPLOYMENT_A });
    });

    it("google: 400s a forged/raw state", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: GCAL_CALLBACK(`code=abc&state=${DEPLOYMENT_A}`),
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(400);
      expect(ctx.connectionCreate).not.toHaveBeenCalled();
    });

    it("google: 400s a missing state", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: GCAL_CALLBACK("code=abc"),
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(400);
      expect(ctx.connectionCreate).not.toHaveBeenCalled();
    });
  });
});
