/**
 * Cross-tenant isolation tests — TI-1..4.
 *
 * Boots Fastify with two scoped API keys (org_A and org_B) and asserts that:
 *   - Org A's auth cannot mutate Org B's resources (403/404).
 *   - Sending Org B's organizationId in the body with Org A's auth returns 400 (mismatch).
 *   - Auth-enabled requests without an org binding return 403 (no organization binding).
 *
 * Covers the mutating routes called out in the spec: ingress/submit,
 * governance/emergency-halt, governance/resume, actions/propose, execute,
 * sessions, approvals, plus the unscoped-key fail-closed default.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance, FastifyError } from "fastify";
import { actionsRoutes } from "../routes/actions.js";
import { executeRoutes } from "../routes/execute.js";
import { approvalsRoutes } from "../routes/approvals.js";
import { sessionRoutes } from "../routes/sessions.js";
import { ingressRoutes } from "../routes/ingress.js";
import { governanceRoutes } from "../routes/governance.js";

// Mock the readiness module exactly like the existing governance test does. Resume's
// happy path queries multiple Prisma models; this lets us assert on auth/org binding
// without standing up Prisma.
vi.mock("../routes/readiness.js", () => ({
  checkReadiness: vi.fn(() => ({ ready: true, checks: [] })),
  buildReadinessContext: vi.fn(async () => ({ deployment: { status: "paused" } })),
}));

const ORG_A = "org_A";
const ORG_B = "org_B";
const KEY_A = "key-org-a";
const KEY_B = "key-org-b";
const UNSCOPED_KEY = "key-unscoped";

interface ScopedTestApp {
  app: FastifyInstance;
  approvalsByOrg: Map<string, string>;
  envelopesByOrg: Map<string, string>;
  sessionsByOrg: Map<string, string>;
}

/**
 * Builds an app that simulates the production auth middleware: bearer tokens map
 * to organizationIdFromAuth, an unscoped token sets organizationIdFromAuth=undefined,
 * and a missing/invalid token returns 401. authDisabled is false (auth-enabled mode).
 */
async function buildScopedApp(): Promise<ScopedTestApp> {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    return reply.code(statusCode).send({ error: message, statusCode });
  });

  // Mark auth as ENABLED — this is the production-like configuration the spec
  // requires to fail closed on unscoped/missing org binding.
  app.decorate("authDisabled", false);

  app.decorateRequest("organizationIdFromAuth", undefined);
  app.decorateRequest("principalIdFromAuth", undefined);

  app.addHook("preHandler", async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth) {
      return reply.code(401).send({ error: "Missing Authorization header", statusCode: 401 });
    }
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    const key = match?.[1];
    if (key === KEY_A) {
      request.organizationIdFromAuth = ORG_A;
      request.principalIdFromAuth = "principal_A";
    } else if (key === KEY_B) {
      request.organizationIdFromAuth = ORG_B;
      request.principalIdFromAuth = "principal_B";
    } else if (key === UNSCOPED_KEY) {
      // Unscoped key — auth succeeds but org binding is undefined. The spec's
      // fail-closed contract: routes must reject with 403, never treat this as dev mode.
      request.organizationIdFromAuth = undefined;
      request.principalIdFromAuth = "principal_unscoped";
    } else {
      return reply.code(401).send({ error: "Invalid API key", statusCode: 401 });
    }
  });

  // ── Approval store: minimal in-memory map keyed by approval id with org binding. ──
  const approvalsByOrg = new Map<string, string>();
  approvalsByOrg.set("approval_A", ORG_A);
  approvalsByOrg.set("approval_B", ORG_B);

  const envelopesByOrg = new Map<string, string>();
  envelopesByOrg.set("env_A", ORG_A);
  envelopesByOrg.set("env_B", ORG_B);

  const sessionsByOrg = new Map<string, string>();
  sessionsByOrg.set("sess_A", ORG_A);
  sessionsByOrg.set("sess_B", ORG_B);

  const storageContext = {
    cartridges: { get: vi.fn().mockReturnValue(undefined), list: vi.fn().mockReturnValue([]) },
    approvals: {
      getById: vi.fn(async (id: string) => {
        const orgId = approvalsByOrg.get(id);
        if (!orgId) return null;
        return {
          id,
          organizationId: orgId,
          envelopeId: "env_x",
          status: "pending",
          version: 1,
        } as unknown;
      }),
    },
    envelopes: {
      getById: vi.fn(async (id: string) => {
        const orgId = envelopesByOrg.get(id);
        if (!orgId) return null;
        return {
          id,
          proposals: [{ parameters: { _organizationId: orgId } }],
        } as unknown;
      }),
    },
  };

  // ── Mocks for governance + lifecycle. ──
  const governanceProfileStore = {
    get: vi.fn().mockResolvedValue("guarded"),
    set: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockResolvedValue(null),
    setConfig: vi.fn(),
  };
  const deploymentLifecycleStore = {
    haltAll: vi.fn().mockResolvedValue({
      workTraceId: "wt",
      affectedDeploymentIds: [],
      count: 0,
    }),
    resume: vi.fn().mockResolvedValue({
      workTraceId: "wt",
      affectedDeploymentIds: [],
      count: 0,
    }),
  };
  const auditLedger = { record: vi.fn().mockResolvedValue(undefined) };

  // platformIngress.submit returns a successful response. The test cases that exercise
  // mutation routes don't care about the result shape — they only care whether the
  // route accepted or rejected the request based on auth/body org binding.
  const platformIngress = {
    submit: vi.fn(async (req: { organizationId: string }) => ({
      ok: true,
      result: { outcome: "completed", summary: "ok", outputs: {} },
      workUnit: { id: `wu_${req.organizationId}`, traceId: "trace_1" },
    })),
  };
  const platformLifecycle = {
    executeApproved: vi.fn(),
    requestUndo: vi.fn(),
  };

  const sessionManager = {
    createSession: vi.fn(async (input: { organizationId: string; principalId: string }) => ({
      session: {
        id: `sess_${input.organizationId}`,
        organizationId: input.organizationId,
        principalId: input.principalId,
        roleId: "role_default",
        safetyEnvelope: { sessionTimeoutMs: 60_000 },
      },
      run: { id: "run_1" },
    })),
    getSession: vi.fn(async (id: string) => {
      const orgId = sessionsByOrg.get(id);
      if (!orgId) return null;
      return { id, organizationId: orgId, principalId: "principal_x" };
    }),
    cancelSession: vi.fn(),
  };

  app.decorate("storageContext", storageContext as unknown as never);
  app.decorate("governanceProfileStore", governanceProfileStore as unknown as never);
  app.decorate("platformIngress", platformIngress as unknown as never);
  app.decorate("platformLifecycle", platformLifecycle as unknown as never);
  app.decorate("deploymentLifecycleStore", deploymentLifecycleStore as unknown as never);
  app.decorate("auditLedger", auditLedger as unknown as never);
  app.decorate("sessionManager", sessionManager as unknown as never);
  app.decorate("prisma", {} as unknown as never);
  app.decorate("approvalRoutingConfig", {
    defaultApprovers: ["reviewer_1"],
    defaultFallbackApprover: null,
    defaultExpiryMs: 60_000,
    defaultExpiredBehavior: "deny" as const,
    elevatedExpiryMs: 60_000,
    mandatoryExpiryMs: 60_000,
    denyWhenNoApprovers: true,
  } as unknown as never);
  app.decorate("lifecycleService", null);
  app.decorate("resolvedSkin", null);

  await app.register(actionsRoutes, { prefix: "/api/actions" });
  await app.register(executeRoutes, { prefix: "/api" });
  await app.register(approvalsRoutes, { prefix: "/api/approvals" });
  await app.register(sessionRoutes, { prefix: "/api/sessions" });
  await app.register(ingressRoutes, { prefix: "/api" });
  await app.register(governanceRoutes, { prefix: "/api/governance" });

  return { app, approvalsByOrg, envelopesByOrg, sessionsByOrg };
}

const HEADERS_A = { authorization: `Bearer ${KEY_A}` };
const HEADERS_B = { authorization: `Bearer ${KEY_B}` };
const HEADERS_UNSCOPED = { authorization: `Bearer ${UNSCOPED_KEY}` };

describe("Cross-tenant isolation (TI-1..4)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const ctx = await buildScopedApp();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  // ── ingress/submit ──────────────────────────────────────────────────

  describe("POST /api/ingress/submit", () => {
    it("rejects body.organizationId that mismatches authenticated org with 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ingress/submit",
        headers: HEADERS_A,
        payload: {
          organizationId: ORG_B,
          actor: { id: "u", type: "user" },
          intent: "x.y.z",
          parameters: {},
          trigger: "api",
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("does not match authenticated context");
    });

    it("uses authenticated org when body omits organizationId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ingress/submit",
        headers: HEADERS_A,
        payload: {
          actor: { id: "u", type: "user" },
          intent: "x.y.z",
          parameters: {},
          trigger: "api",
        },
      });
      // Submit succeeds against the platformIngress mock (200 envelope).
      expect(res.statusCode).toBe(200);
    });

    it("rejects unscoped key with 403 (no organization binding)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ingress/submit",
        headers: HEADERS_UNSCOPED,
        payload: {
          organizationId: ORG_A,
          actor: { id: "u", type: "user" },
          intent: "x.y.z",
          parameters: {},
          trigger: "api",
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("no organization binding");
    });
  });

  // ── governance/emergency-halt + resume ──────────────────────────────

  describe("POST /api/governance/emergency-halt", () => {
    it("rejects cross-org body claim with 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        headers: HEADERS_A,
        payload: { organizationId: ORG_B, reason: "test" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("does not match authenticated context");
    });

    it("rejects unscoped key with 403", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        headers: HEADERS_UNSCOPED,
        payload: { organizationId: ORG_A },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("no organization binding");
    });

    it("accepts request when body org matches auth org", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        headers: HEADERS_A,
        payload: { organizationId: ORG_A, reason: "test" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().organizationId).toBe(ORG_A);
    });
  });

  describe("POST /api/governance/resume", () => {
    it("rejects cross-org body claim with 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/governance/resume",
        headers: HEADERS_A,
        payload: { organizationId: ORG_B },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("does not match authenticated context");
    });

    it("rejects unscoped key with 403", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/governance/resume",
        headers: HEADERS_UNSCOPED,
        payload: { organizationId: ORG_A },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("no organization binding");
    });
  });

  describe("PUT /api/governance/:orgId/profile", () => {
    it("rejects cross-org write with 403", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/governance/${ORG_B}/profile`,
        headers: HEADERS_A,
        payload: { profile: "observe" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("organization mismatch");
    });
  });

  // ── actions/propose + actions/batch ──────────────────────────────────

  describe("POST /api/actions/propose", () => {
    it("rejects body.organizationId mismatch with 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        headers: { ...HEADERS_A, "Idempotency-Key": "k1" },
        payload: {
          actionType: "x.y.z",
          parameters: {},
          principalId: "p_1",
          organizationId: ORG_B,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("does not match authenticated context");
    });

    it("rejects unscoped key with 403", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        headers: { ...HEADERS_UNSCOPED, "Idempotency-Key": "k2" },
        payload: {
          actionType: "x.y.z",
          parameters: {},
          principalId: "p_1",
          organizationId: ORG_A,
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("no organization binding");
    });
  });

  describe("POST /api/actions/batch", () => {
    it("rejects body.organizationId mismatch with 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/batch",
        headers: { ...HEADERS_A, "Idempotency-Key": "kbatch" },
        payload: {
          principalId: "p_1",
          organizationId: ORG_B,
          proposals: [{ actionType: "x.y.z", parameters: {} }],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("does not match authenticated context");
    });

    it("rejects unscoped key with 403", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/batch",
        headers: { ...HEADERS_UNSCOPED, "Idempotency-Key": "kbatch2" },
        payload: {
          principalId: "p_1",
          organizationId: ORG_A,
          proposals: [{ actionType: "x.y.z", parameters: {} }],
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("no organization binding");
    });
  });

  // ── actions/:id (GET) + actions/:id/undo (cross-tenant on existing entity) ──

  describe("GET /api/actions/:id (cross-tenant entity access)", () => {
    it("returns 403 when Org A tries to read Org B's envelope", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/actions/env_B",
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /api/actions/:id/undo (cross-tenant)", () => {
    it("returns 403 when Org A tries to undo Org B's envelope", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/env_B/undo",
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── execute ─────────────────────────────────────────────────────────

  describe("POST /api/execute", () => {
    it("rejects body.organizationId mismatch with 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/execute",
        headers: { ...HEADERS_A, "Idempotency-Key": "exec1" },
        payload: {
          actorId: "actor_1",
          organizationId: ORG_B,
          action: {
            actionType: "x.y.z",
            parameters: {},
            sideEffect: true,
          },
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("does not match authenticated context");
    });

    it("rejects unscoped key with 403", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/execute",
        headers: { ...HEADERS_UNSCOPED, "Idempotency-Key": "exec2" },
        payload: {
          actorId: "actor_1",
          organizationId: ORG_A,
          action: {
            actionType: "x.y.z",
            parameters: {},
            sideEffect: true,
          },
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("no organization binding");
    });
  });

  // ── sessions ────────────────────────────────────────────────────────

  describe("POST /api/sessions (create)", () => {
    it("rejects cross-org body.organizationId with 403 via assertOrgAccess", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions/",
        headers: HEADERS_A,
        payload: {
          organizationId: ORG_B,
          roleId: "role_default",
          principalId: "p_1",
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("organization mismatch");
    });

    it("rejects unscoped key with 403", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions/",
        headers: HEADERS_UNSCOPED,
        payload: {
          organizationId: ORG_A,
          roleId: "role_default",
          principalId: "p_1",
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("no organization binding");
    });
  });

  describe("GET /api/sessions/:id and POST /api/sessions/:id/cancel", () => {
    it("returns 403 when Org A reads Org B's session", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/sessions/sess_B",
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 403 when Org A cancels Org B's session", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions/sess_B/cancel",
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── approvals ───────────────────────────────────────────────────────

  describe("POST /api/approvals/:id/respond (cross-tenant)", () => {
    it("returns 403 when Org A tries to respond to Org B's approval", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/approvals/approval_B/respond",
        headers: HEADERS_A,
        payload: {
          action: "approve",
          respondedBy: "principal_A",
          bindingHash: "deadbeef",
        },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Symmetric direction (Org B → Org A) ─────────────────────────────

  describe("Symmetric direction", () => {
    it("Org B's auth cannot read Org A's envelope", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/actions/env_A",
        headers: HEADERS_B,
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Missing auth fall-through (401) ─────────────────────────────────

  describe("Missing authorization", () => {
    it("returns 401 when no Authorization header on a mutation route", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ingress/submit",
        payload: {
          organizationId: ORG_A,
          actor: { id: "u", type: "user" },
          intent: "x.y.z",
          parameters: {},
          trigger: "api",
        },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
