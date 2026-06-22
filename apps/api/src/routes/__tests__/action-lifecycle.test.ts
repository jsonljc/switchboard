import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { actionLifecycleRoutes } from "../action-lifecycle.js";

/** An envelope whose single proposal is owned by `org` (via _organizationId). */
function envOwnedBy(org: string) {
  return { proposals: [{ parameters: { _organizationId: org } }] };
}

async function buildApp(opts: {
  authDisabled: boolean;
  authOrgId?: string;
  envelope?: ReturnType<typeof envOwnedBy> | null;
  trace?: { organizationId: string } | null;
  principalId?: string;
  roles?: string[];
}): Promise<{ app: FastifyInstance; executeApproved: ReturnType<typeof vi.fn> }> {
  const app = Fastify({ logger: false });
  app.decorate("authDisabled", opts.authDisabled);
  const executeApproved = vi.fn().mockResolvedValue({ workUnitId: "wu_1", success: true });
  const getById = vi.fn().mockResolvedValue(opts.envelope ?? null);
  const getByWorkUnitId = vi
    .fn()
    .mockResolvedValue(opts.trace ? { trace: opts.trace, integrity: { status: "ok" } } : null);
  // A16: the approver-role floor (requireRole) resolves the principal from the
  // identity store. Existing cases default to an approver-role principal so the
  // floor passes and the ORG gate stays the asserted reason; new cases override
  // principalId (incl. an explicit `undefined` for the no-principal-binding case)
  // and roles.
  const roles = opts.roles ?? ["operator"];
  const getPrincipal = vi.fn(async (id: string) =>
    id ? { id, type: "user", name: "P", organizationId: opts.authOrgId ?? null, roles } : null,
  );
  app.decorate("platformLifecycle", { executeApproved, requestUndo: vi.fn() } as unknown as never);
  app.decorate("storageContext", {
    envelopes: { getById },
    identity: { getPrincipal },
  } as unknown as never);
  app.decorate("workTraceStore", { getByWorkUnitId } as unknown as never);
  app.decorate("platformIngress", {} as unknown as never);
  app.decorateRequest("organizationIdFromAuth", undefined);
  app.decorateRequest("principalIdFromAuth", undefined);
  const principalId = "principalId" in opts ? opts.principalId : "op_default";
  app.addHook("onRequest", async (request) => {
    request.organizationIdFromAuth = opts.authOrgId;
    request.principalIdFromAuth = principalId;
  });
  await app.register(actionLifecycleRoutes, { prefix: "/api/actions" });
  return { app, executeApproved };
}

describe("POST /api/actions/:id/execute — tenant isolation", () => {
  // --- legacy envelope path ---
  it("returns 403 on cross-tenant execute (legacy envelope) and never reaches executeApproved", async () => {
    const { app, executeApproved } = await buildApp({
      authDisabled: false,
      authOrgId: "org_b",
      envelope: envOwnedBy("org_a"),
    });
    const res = await app.inject({ method: "POST", url: "/api/actions/env_1/execute" });
    expect(res.statusCode).toBe(403);
    expect(executeApproved).not.toHaveBeenCalled();
    await app.close();
  });

  it("executes when the caller's org matches the envelope's org", async () => {
    const { app, executeApproved } = await buildApp({
      authDisabled: false,
      authOrgId: "org_a",
      envelope: envOwnedBy("org_a"),
    });
    const res = await app.inject({ method: "POST", url: "/api/actions/env_1/execute" });
    expect(res.statusCode).toBe(200);
    expect(executeApproved).toHaveBeenCalledWith("env_1");
    await app.close();
  });

  // --- modern WorkTrace path (no envelope) — platform-native submissions ---
  it("returns 403 on cross-tenant execute (trace-only, no envelope) and never reaches executeApproved", async () => {
    const { app, executeApproved } = await buildApp({
      authDisabled: false,
      authOrgId: "org_b",
      envelope: null,
      trace: { organizationId: "org_a" },
    });
    const res = await app.inject({ method: "POST", url: "/api/actions/wt_1/execute" });
    expect(res.statusCode).toBe(403);
    expect(executeApproved).not.toHaveBeenCalled();
    await app.close();
  });

  it("executes a trace-only unit when the caller's org matches the trace's org", async () => {
    const { app, executeApproved } = await buildApp({
      authDisabled: false,
      authOrgId: "org_a",
      envelope: null,
      trace: { organizationId: "org_a" },
    });
    const res = await app.inject({ method: "POST", url: "/api/actions/wt_1/execute" });
    expect(res.statusCode).toBe(200);
    expect(executeApproved).toHaveBeenCalledWith("wt_1");
    await app.close();
  });

  // --- dev mode + fall-through ---
  it("allows execution in dev mode (authDisabled) regardless of org", async () => {
    const { app, executeApproved } = await buildApp({
      authDisabled: true,
      authOrgId: "org_b",
      envelope: null,
      trace: { organizationId: "org_a" },
    });
    const res = await app.inject({ method: "POST", url: "/api/actions/wt_1/execute" });
    expect(res.statusCode).toBe(200);
    expect(executeApproved).toHaveBeenCalledWith("wt_1");
    await app.close();
  });

  it("falls through to executeApproved when neither envelope nor trace exists (preserves the non-existent 400 contract)", async () => {
    // Execute is a lifecycle transition addressed by id. When BOTH the legacy
    // envelope and the WorkTrace lookups miss, the org gate is skipped and the
    // call falls through to executeApproved, which owns the not-found/non-approved
    // 400 — we must not turn that into a 403/404.
    const { app, executeApproved } = await buildApp({
      authDisabled: false,
      authOrgId: "org_b",
      envelope: null,
      trace: null,
    });
    const res = await app.inject({ method: "POST", url: "/api/actions/missing/execute" });
    expect(executeApproved).toHaveBeenCalledWith("missing");
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe("POST /api/actions/:id/execute — approver-role floor (A16)", () => {
  it("403s a requester-only principal and never reaches executeApproved", async () => {
    const { app, executeApproved } = await buildApp({
      authDisabled: false,
      authOrgId: "org_a",
      principalId: "req_1",
      roles: ["requester"],
      trace: { organizationId: "org_a" },
    });
    const res = await app.inject({ method: "POST", url: "/api/actions/wt_1/execute" });
    expect(res.statusCode).toBe(403);
    expect(executeApproved).not.toHaveBeenCalled();
    await app.close();
  });

  it("403s when auth is enabled but no principal is bound", async () => {
    const { app, executeApproved } = await buildApp({
      authDisabled: false,
      authOrgId: "org_a",
      principalId: undefined,
      trace: { organizationId: "org_a" },
    });
    const res = await app.inject({ method: "POST", url: "/api/actions/wt_1/execute" });
    expect(res.statusCode).toBe(403);
    expect(executeApproved).not.toHaveBeenCalled();
    await app.close();
  });

  it("lets an operator-role principal past the role floor and execute", async () => {
    const { app, executeApproved } = await buildApp({
      authDisabled: false,
      authOrgId: "org_a",
      principalId: "op_1",
      roles: ["operator"],
      trace: { organizationId: "org_a" },
    });
    const res = await app.inject({ method: "POST", url: "/api/actions/wt_1/execute" });
    expect(res.statusCode).toBe(200);
    expect(executeApproved).toHaveBeenCalledWith("wt_1");
    await app.close();
  });
});
