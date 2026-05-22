import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { buildDevAuthFallback } from "../auth-fallback.js";

describe("buildDevAuthFallback (factory)", () => {
  it("populates organizationIdFromAuth + principalIdFromAuth from headers in dev mode", async () => {
    const app = Fastify();
    app.decorate("authDisabled", true);
    app.addHook("preHandler", buildDevAuthFallback(app));
    app.get("/probe", (request) => ({
      org: request.organizationIdFromAuth,
      principal: request.principalIdFromAuth,
    }));

    const res = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-org-id": "org_demo", "x-principal-id": "alice" },
    });
    expect(res.json()).toEqual({ org: "org_demo", principal: "alice" });
    await app.close();
  });

  it("defaults to 'default' org + principal when headers absent in dev mode", async () => {
    const app = Fastify();
    app.decorate("authDisabled", true);
    app.addHook("preHandler", buildDevAuthFallback(app));
    app.get("/probe", (request) => ({
      org: request.organizationIdFromAuth,
      principal: request.principalIdFromAuth,
    }));

    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.json()).toEqual({ org: "default", principal: "default" });
    await app.close();
  });

  it("does not overwrite existing organizationIdFromAuth set by auth middleware", async () => {
    const app = Fastify();
    app.decorate("authDisabled", true);
    app.addHook("preHandler", async (request) => {
      request.organizationIdFromAuth = "org_from_auth";
      request.principalIdFromAuth = "user_from_auth";
    });
    app.addHook("preHandler", buildDevAuthFallback(app));
    app.get("/probe", (request) => ({
      org: request.organizationIdFromAuth,
      principal: request.principalIdFromAuth,
    }));

    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.json()).toEqual({ org: "org_from_auth", principal: "user_from_auth" });
    await app.close();
  });

  it("does nothing in auth-enabled mode (authDisabled === false)", async () => {
    const app = Fastify();
    app.decorate("authDisabled", false);
    app.addHook("preHandler", buildDevAuthFallback(app));
    app.get("/probe", (request) => ({
      org: request.organizationIdFromAuth ?? null,
      principal: request.principalIdFromAuth ?? null,
    }));

    const res = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-org-id": "org_demo" },
    });
    expect(res.json()).toEqual({ org: null, principal: null });
    await app.close();
  });

  it("integrates correctly when registered inside a plugin", async () => {
    const app = Fastify();
    app.decorate("authDisabled", true);
    await app.register(async (plugin) => {
      plugin.addHook("preHandler", buildDevAuthFallback(plugin));
      plugin.get("/p", (request) => ({ org: request.organizationIdFromAuth }));
    });
    const res = await app.inject({ method: "GET", url: "/p", headers: { "x-org-id": "org_int" } });
    expect(res.json()).toEqual({ org: "org_int" });
    await app.close();
  });
});
