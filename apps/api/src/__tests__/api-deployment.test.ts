import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { deploymentRoutes } from "../routes/deployment.js";

describe("Deployment API — org-scoping", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    app.decorate("prisma", null);
    app.decorate("resolvedProfile", null);
    app.decorateRequest("organizationIdFromAuth", undefined);
    app.decorateRequest("principalIdFromAuth", undefined);
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 403 when no org in auth token", async () => {
    app.addHook("onRequest", async (request) => {
      request.principalIdFromAuth = "user_1";
    });
    await app.register(deploymentRoutes, { prefix: "/api/deployment" });

    const res = await app.inject({
      method: "GET",
      url: "/api/deployment/readiness",
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("organization-scoped");
  });

  it("returns 404 when no profile loaded", async () => {
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
      request.principalIdFromAuth = "user_1";
    });
    await app.register(deploymentRoutes, { prefix: "/api/deployment" });

    const res = await app.inject({
      method: "GET",
      url: "/api/deployment/readiness",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("No business profile");
  });

  it("no longer accepts orgId from query string", async () => {
    app.addHook("onRequest", async (request) => {
      request.principalIdFromAuth = "user_1";
    });
    await app.register(deploymentRoutes, { prefix: "/api/deployment" });

    const res = await app.inject({
      method: "GET",
      url: "/api/deployment/readiness?orgId=org_other",
    });

    expect(res.statusCode).toBe(403);
  });
});
