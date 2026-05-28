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
}): Promise<{ app: FastifyInstance; executeApproved: ReturnType<typeof vi.fn> }> {
  const app = Fastify({ logger: false });
  app.decorate("authDisabled", opts.authDisabled);
  const executeApproved = vi.fn().mockResolvedValue({ workUnitId: "wu_1", success: true });
  const getById = vi.fn().mockResolvedValue(opts.envelope ?? null);
  app.decorate("platformLifecycle", { executeApproved, requestUndo: vi.fn() } as unknown as never);
  app.decorate("storageContext", { envelopes: { getById } } as unknown as never);
  app.decorate("platformIngress", {} as unknown as never);
  app.decorateRequest("organizationIdFromAuth", undefined);
  app.addHook("onRequest", async (request) => {
    request.organizationIdFromAuth = opts.authOrgId;
  });
  await app.register(actionLifecycleRoutes, { prefix: "/api/actions" });
  return { app, executeApproved };
}

describe("POST /api/actions/:id/execute — tenant isolation", () => {
  it("returns 403 on cross-tenant execute and never reaches executeApproved", async () => {
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

  it("allows execution in dev mode (authDisabled) regardless of org", async () => {
    const { app, executeApproved } = await buildApp({
      authDisabled: true,
      authOrgId: "org_b",
      envelope: envOwnedBy("org_a"),
    });
    const res = await app.inject({ method: "POST", url: "/api/actions/env_1/execute" });
    expect(res.statusCode).toBe(200);
    expect(executeApproved).toHaveBeenCalledWith("env_1");
    await app.close();
  });

  it("falls through to executeApproved when no envelope exists (preserves the non-existent 400 contract)", async () => {
    // Execute is a lifecycle transition on a WorkTrace/envelope addressed by id.
    // When the legacy envelope lookup misses, the org gate is skipped and the
    // call falls through to executeApproved, which owns the not-found/non-approved
    // 400 — we must not turn that into a 403/404.
    const { app, executeApproved } = await buildApp({
      authDisabled: false,
      authOrgId: "org_b",
      envelope: null,
    });
    const res = await app.inject({ method: "POST", url: "/api/actions/missing/execute" });
    expect(executeApproved).toHaveBeenCalledWith("missing");
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
