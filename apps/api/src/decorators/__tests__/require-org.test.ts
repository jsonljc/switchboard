import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { requireOrg, requireOrgForMutation } from "../require-org.js";
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
