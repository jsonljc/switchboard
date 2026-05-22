import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { requireOrg, requireOrgForAuditedMutation, requireOrgForMutation } from "../org.js";
import { buildDevAuthFallback } from "../../utils/auth-fallback.js";

describe("requireOrg preHandler (read-side)", () => {
  it("narrows request.orgId + request.actorId when organizationIdFromAuth is set", async () => {
    const app = Fastify();
    app.decorate("authDisabled", true);
    app.get("/probe", { preHandler: [buildDevAuthFallback(app), requireOrg] }, (request) => ({
      orgId: request.orgId,
      actorId: request.actorId,
    }));

    const res = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-org-id": "org_a", "x-principal-id": "user_a" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ orgId: "org_a", actorId: "user_a" });
    await app.close();
  });

  it("falls back actorId to 'unknown' when principalIdFromAuth absent in auth-enabled mode", async () => {
    const app = Fastify();
    app.decorate("authDisabled", false);
    app.addHook("preHandler", async (request) => {
      request.organizationIdFromAuth = "org_b";
      // principalIdFromAuth intentionally NOT set
    });
    app.get("/probe", { preHandler: requireOrg }, (request) => ({
      orgId: request.orgId,
      actorId: request.actorId,
    }));

    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ orgId: "org_b", actorId: "unknown" });
    await app.close();
  });

  it("emits 403 normalized envelope when organizationIdFromAuth absent in auth-enabled mode", async () => {
    const app = Fastify();
    app.decorate("authDisabled", false);
    app.get("/probe", { preHandler: requireOrg }, () => ({ unreachable: true }));

    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "forbidden",
      reason: "no_org_binding",
      statusCode: 403,
    });
    await app.close();
  });
});

describe("requireOrgForMutation preHandler (write-side)", () => {
  it("narrows orgId + actorId when set (same as requireOrg)", async () => {
    const app = Fastify();
    app.decorate("authDisabled", true);
    app.post(
      "/probe",
      { preHandler: [buildDevAuthFallback(app), requireOrgForMutation] },
      (request) => ({ orgId: request.orgId, actorId: request.actorId }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/probe",
      headers: { "x-org-id": "org_c", "x-principal-id": "user_c" },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ orgId: "org_c", actorId: "user_c" });
    await app.close();
  });

  it("emits 403 normalized envelope when org absent in auth-enabled mode", async () => {
    const app = Fastify();
    app.decorate("authDisabled", false);
    app.post("/probe", { preHandler: requireOrgForMutation }, () => ({ unreachable: true }));

    const res = await app.inject({ method: "POST", url: "/probe", payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "forbidden",
      reason: "no_org_binding",
      statusCode: 403,
    });
    await app.close();
  });
});

describe("requireOrgForAuditedMutation preHandler (PDPA-grade write-side)", () => {
  // Audit-grade decorator: PDPA-regulated routes (admin-consent grant/revoke/clear)
  // must fail closed in production when the auth middleware did not bind a
  // real principal, instead of recording WorkTrace rows with actor.id = "unknown".
  // See bug_003 in PR #614 ultrareview — restores the pre-PR `resolveActor`
  // throw that was inadvertently lost in the decorator extraction.

  const originalNodeEnv = process.env["NODE_ENV"];
  beforeEach(() => {
    process.env["NODE_ENV"] = originalNodeEnv;
  });
  afterEach(() => {
    process.env["NODE_ENV"] = originalNodeEnv;
  });

  it("narrows orgId + actorId when both org and principal are bound", async () => {
    const app = Fastify();
    app.decorate("authDisabled", false);
    app.addHook("preHandler", async (request) => {
      request.organizationIdFromAuth = "org_audit";
      request.principalIdFromAuth = "user_audit";
    });
    app.post("/probe", { preHandler: requireOrgForAuditedMutation }, (request) => ({
      orgId: request.orgId,
      actorId: request.actorId,
    }));

    const res = await app.inject({ method: "POST", url: "/probe", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ orgId: "org_audit", actorId: "user_audit" });
    await app.close();
  });

  it("emits 403 normalized envelope when org absent (same as requireOrgForMutation)", async () => {
    const app = Fastify();
    app.decorate("authDisabled", false);
    app.post("/probe", { preHandler: requireOrgForAuditedMutation }, () => ({ unreachable: true }));

    const res = await app.inject({ method: "POST", url: "/probe", payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "forbidden",
      reason: "no_org_binding",
      statusCode: 403,
    });
    await app.close();
  });

  it("fails closed with 403 no_principal_binding in production when principal absent", async () => {
    process.env["NODE_ENV"] = "production";
    const warnings: Array<{ orgId?: string; decorator?: string; msg?: string }> = [];
    const app = Fastify({
      logger: {
        level: "warn",
        hooks: {
          logMethod(args: unknown[], method: (...a: unknown[]) => void) {
            const [obj, msg] = args as [{ orgId?: string; decorator?: string }, string | undefined];
            if (typeof obj === "object" && obj !== null) {
              warnings.push({ ...obj, msg });
            }
            method.apply(this, args);
          },
        },
      },
    });
    app.decorate("authDisabled", false);
    app.addHook("preHandler", async (request) => {
      request.organizationIdFromAuth = "org_audit";
      // principalIdFromAuth intentionally NOT set
    });
    app.post("/probe", { preHandler: requireOrgForAuditedMutation }, () => ({ unreachable: true }));

    const res = await app.inject({ method: "POST", url: "/probe", payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "forbidden",
      reason: "no_principal_binding",
      statusCode: 403,
    });
    // Server-side breadcrumb: SREs see which decorator + org tripped the guard.
    expect(warnings).toContainEqual(
      expect.objectContaining({
        orgId: "org_audit",
        decorator: "requireOrgForAuditedMutation",
        msg: "no_principal_binding",
      }),
    );
    await app.close();
  });

  it("falls back actorId to 'unknown' in non-production when principal absent", async () => {
    process.env["NODE_ENV"] = "development";
    const app = Fastify();
    app.decorate("authDisabled", false);
    app.addHook("preHandler", async (request) => {
      request.organizationIdFromAuth = "org_audit";
      // principalIdFromAuth intentionally NOT set
    });
    app.post("/probe", { preHandler: requireOrgForAuditedMutation }, (request) => ({
      orgId: request.orgId,
      actorId: request.actorId,
    }));

    const res = await app.inject({ method: "POST", url: "/probe", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ orgId: "org_audit", actorId: "unknown" });
    await app.close();
  });
});
