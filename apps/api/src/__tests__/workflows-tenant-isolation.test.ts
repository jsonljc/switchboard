/**
 * Workflow routes — cross-tenant isolation (audit finding F1).
 *
 * The workflow lifecycle routes historically checked clinic ownership ONLY when
 * the caller passed an optional `?organizationId=` query param, and never
 * consulted the authenticated org (`request.organizationIdFromAuth`). Omitting
 * the param skipped the check entirely — any authenticated caller who knew a
 * target id could read, cancel, or approve another clinic's workflow. The list
 * routes (`GET /`, `GET /actions/pending`) scoped by the *query-supplied* org,
 * so a caller could enumerate another clinic's workflows by passing its id.
 *
 * These tests boot the workflow routes with auth ENABLED (authDisabled=false)
 * and two scoped API keys (org_A, org_B). They assert that Org A's auth cannot
 * read/cancel/resolve Org B's workflow or checkpoint (403), that the list routes
 * scope to the AUTHENTICATED org rather than a query-supplied one, and that an
 * unscoped key fails closed (403). Own-org access still returns 200.
 *
 * CRITICAL: auth must be ENABLED. `assertOrgAccess` allows everything when
 * `app.authDisabled === true`, so a dev-bypass harness would pass trivially and
 * prove nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyError } from "fastify";
import { workflowRoutes } from "../routes/workflows.js";
import { resolveCheckpoint } from "@switchboard/core";

// `workflows.ts` imports only `resolveCheckpoint` from @switchboard/core. Mock it
// to a no-op so the happy-path resolve doesn't need a real checkpoint store. The
// route's tenant gate runs BEFORE resolveCheckpoint, so cross-tenant cases never
// reach it — letting us assert it is NOT called when access is denied.
vi.mock("@switchboard/core", () => ({
  resolveCheckpoint: vi.fn(async () => undefined),
}));

const ORG_A = "org_A";
const ORG_B = "org_B";
const KEY_A = "key-org-a";
const KEY_B = "key-org-b";
const UNSCOPED_KEY = "key-unscoped";

/**
 * Builds a Fastify app that simulates the production auth middleware: bearer
 * tokens map to `organizationIdFromAuth`, an unscoped token sets it to undefined,
 * and a missing token returns 401. `authDisabled` is false (auth-enabled mode).
 * The workflow routes are registered against an in-memory mock `workflowDeps`
 * whose resources carry org bindings, so ownership can be asserted end to end.
 */
async function buildWorkflowApp() {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    return reply.code(statusCode).send({ error: message, statusCode });
  });

  // Auth ENABLED — the production-like configuration. assertOrgAccess only
  // enforces when authDisabled is false; the requireOrg decorators fail closed
  // when no org binding is present.
  app.decorate("authDisabled", false);
  app.decorateRequest("organizationIdFromAuth", undefined);
  app.decorateRequest("principalIdFromAuth", undefined);

  // Simulated auth middleware: bearer token → org binding (app-level preHandler,
  // runs before the route-level requireOrg decorators).
  app.addHook("preHandler", async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth) {
      return reply.code(401).send({ error: "Missing Authorization header", statusCode: 401 });
    }
    const key = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
    if (key === KEY_A) {
      request.organizationIdFromAuth = ORG_A;
      request.principalIdFromAuth = "principal_A";
    } else if (key === KEY_B) {
      request.organizationIdFromAuth = ORG_B;
      request.principalIdFromAuth = "principal_B";
    } else if (key === UNSCOPED_KEY) {
      // Unscoped key — auth succeeds but org binding is undefined. Routes must
      // fail closed (403), never treat this as dev mode.
      request.organizationIdFromAuth = undefined;
      request.principalIdFromAuth = "principal_unscoped";
    } else {
      return reply.code(401).send({ error: "Invalid API key", statusCode: 401 });
    }
  });

  // ── Ownership maps. ──
  const workflowOrg = new Map<string, string>([
    ["wf_A", ORG_A],
    ["wf_B", ORG_B],
  ]);
  const checkpointWorkflow = new Map<string, string>([
    ["cp_A", "wf_A"],
    ["cp_B", "wf_B"],
  ]);
  const actionOrg = new Map<string, string>([
    ["act_A", ORG_A],
    ["act_B", ORG_B],
  ]);

  const workflowEngine = {
    getWorkflow: vi.fn(async (id: string) => {
      const organizationId = workflowOrg.get(id);
      if (!organizationId) return null;
      return { id, organizationId, status: "blocked", plan: { steps: [] }, currentStepIndex: 0 };
    }),
    cancelWorkflow: vi.fn(async (_id: string) => undefined),
    resumeAfterApproval: vi.fn(async (_workflowId: string, _checkpointId: string) => undefined),
  };

  const store = {
    workflows: {
      list: vi.fn(async (filter: { organizationId: string }) =>
        [...workflowOrg.entries()]
          .filter(([, org]) => org === filter.organizationId)
          .map(([id, organizationId]) => ({ id, organizationId })),
      ),
    },
    actions: {
      listByStatus: vi.fn(async (organizationId: string, _status: string, _limit?: number) =>
        [...actionOrg.entries()]
          .filter(([, org]) => org === organizationId)
          .map(([id, org]) => ({ id, organizationId: org })),
      ),
    },
    checkpoints: {
      getById: vi.fn(async (id: string) => {
        const workflowId = checkpointWorkflow.get(id);
        if (!workflowId) return null;
        return { id, workflowId };
      }),
    },
  };

  app.decorate("workflowDeps", { workflowEngine, store } as unknown as never);
  await app.register(workflowRoutes, { prefix: "/api/workflows" });

  return { app, workflowEngine, store };
}

const HEADERS_A = { authorization: `Bearer ${KEY_A}` };
const HEADERS_UNSCOPED = { authorization: `Bearer ${UNSCOPED_KEY}` };

describe("Workflow routes — cross-tenant isolation (F1)", () => {
  let ctx: Awaited<ReturnType<typeof buildWorkflowApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await buildWorkflowApp();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  // ── GET /:id ─────────────────────────────────────────────────────────
  describe("GET /api/workflows/:id", () => {
    it("returns 403 when Org A reads Org B's workflow", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/workflows/wf_B",
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 200 for Org A's own workflow", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/workflows/wf_A",
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe("wf_A");
    });

    it("returns 403 for an unscoped key (fail closed)", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/workflows/wf_A",
        headers: HEADERS_UNSCOPED,
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── POST /:id/cancel ─────────────────────────────────────────────────
  describe("POST /api/workflows/:id/cancel", () => {
    it("returns 403 and does not cancel Org B's workflow", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/workflows/wf_B/cancel",
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(403);
      expect(ctx.workflowEngine.cancelWorkflow).not.toHaveBeenCalled();
    });

    it("cancels Org A's own workflow (200)", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/workflows/wf_A/cancel",
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(200);
      expect(ctx.workflowEngine.cancelWorkflow).toHaveBeenCalledWith("wf_A");
    });

    it("returns 403 for an unscoped key (fail closed)", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/workflows/wf_A/cancel",
        headers: HEADERS_UNSCOPED,
      });
      expect(res.statusCode).toBe(403);
      expect(ctx.workflowEngine.cancelWorkflow).not.toHaveBeenCalled();
    });
  });

  // ── POST /checkpoints/:id/resolve ────────────────────────────────────
  describe("POST /api/workflows/checkpoints/:id/resolve", () => {
    it("returns 403 and does not resolve Org B's checkpoint", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/workflows/checkpoints/cp_B/resolve",
        headers: HEADERS_A,
        payload: { decidedBy: "principal_A", action: "approve" },
      });
      expect(res.statusCode).toBe(403);
      expect(vi.mocked(resolveCheckpoint)).not.toHaveBeenCalled();
      expect(ctx.workflowEngine.resumeAfterApproval).not.toHaveBeenCalled();
    });

    it("resolves Org A's own checkpoint (200)", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/workflows/checkpoints/cp_A/resolve",
        headers: HEADERS_A,
        payload: { decidedBy: "principal_A", action: "approve" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it("returns 403 for an unscoped key (fail closed)", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/workflows/checkpoints/cp_A/resolve",
        headers: HEADERS_UNSCOPED,
        payload: { decidedBy: "x", action: "approve" },
      });
      expect(res.statusCode).toBe(403);
      expect(vi.mocked(resolveCheckpoint)).not.toHaveBeenCalled();
    });
  });

  // ── GET / (list) — must scope to the authenticated org ───────────────
  describe("GET /api/workflows (list)", () => {
    it("ignores a cross-org ?organizationId= and never returns Org B's workflows", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/workflows?organizationId=${ORG_B}`,
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(200);
      const ids = (res.json() as Array<{ id: string }>).map((w) => w.id);
      expect(ids).not.toContain("wf_B");
      expect(ctx.store.workflows.list).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_A }),
      );
    });

    it("returns 403 for an unscoped key (fail closed)", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/workflows",
        headers: HEADERS_UNSCOPED,
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── GET /actions/pending — must scope to the authenticated org ───────
  describe("GET /api/workflows/actions/pending", () => {
    it("ignores a cross-org ?organizationId= and lists only the authenticated org's actions", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/workflows/actions/pending?organizationId=${ORG_B}`,
        headers: HEADERS_A,
      });
      expect(res.statusCode).toBe(200);
      const ids = (res.json() as Array<{ id: string }>).map((a) => a.id);
      expect(ids).not.toContain("act_B");
      expect(ctx.store.actions.listByStatus).toHaveBeenCalledWith(ORG_A, "proposed", undefined);
    });
  });
});
