import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { businessConfigRoutes } from "../routes/business-config.js";

describe("Business Config API — org-scoping", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    app.decorate("prisma", null);
    app.decorateRequest("organizationIdFromAuth", undefined);
    app.decorateRequest("principalIdFromAuth", undefined);
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /:orgId returns 403 when no org in auth token", async () => {
    app.addHook("onRequest", async (request) => {
      request.principalIdFromAuth = "user_1";
    });
    await app.register(businessConfigRoutes, { prefix: "/api/business-config" });

    const res = await app.inject({
      method: "GET",
      url: "/api/business-config/org_other",
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("organization-scoped");
  });

  it("PUT /:orgId returns 403 when no org in auth token", async () => {
    app.addHook("onRequest", async (request) => {
      request.principalIdFromAuth = "user_1";
    });
    await app.register(businessConfigRoutes, { prefix: "/api/business-config" });

    const res = await app.inject({
      method: "PUT",
      url: "/api/business-config/org_other",
      payload: {},
    });

    expect(res.statusCode).toBe(403);
  });

  it("GET /:orgId/versions returns 403 when no org in auth token", async () => {
    app.addHook("onRequest", async (request) => {
      request.principalIdFromAuth = "user_1";
    });
    await app.register(businessConfigRoutes, { prefix: "/api/business-config" });

    const res = await app.inject({
      method: "GET",
      url: "/api/business-config/org_other/versions",
    });

    expect(res.statusCode).toBe(403);
  });

  it("GET /:orgId/readiness returns 403 when no org in auth token", async () => {
    app.addHook("onRequest", async (request) => {
      request.principalIdFromAuth = "user_1";
    });
    await app.register(businessConfigRoutes, { prefix: "/api/business-config" });

    const res = await app.inject({
      method: "GET",
      url: "/api/business-config/org_other/readiness",
    });

    expect(res.statusCode).toBe(403);
  });
});
