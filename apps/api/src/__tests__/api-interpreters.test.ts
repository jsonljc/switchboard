import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { interpretersRoutes } from "../routes/interpreters.js";

describe("Interpreters API", () => {
  let app: FastifyInstance;

  const mockIdentity = {
    getPrincipal: vi.fn().mockResolvedValue({ roles: ["admin"] }),
  };

  const mockAuditLedger = {
    record: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });

    app.decorate("storageContext", { identity: mockIdentity } as unknown as never);
    app.decorate("auditLedger", mockAuditLedger as unknown as never);

    app.decorateRequest("organizationIdFromAuth", undefined);
    app.decorateRequest("principalIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
      request.principalIdFromAuth = "user_admin";
    });

    await app.register(interpretersRoutes, { prefix: "/api/interpreters" });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/interpreters", () => {
    it("lists interpreter configs", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/interpreters",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().interpreters).toBeInstanceOf(Array);
    });
  });

  describe("POST /api/interpreters", () => {
    it("registers a new interpreter", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/interpreters",
        payload: {
          name: "test-interpreter",
          enabled: true,
          priority: 10,
          model: "gpt-4",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.action).toBe("registered");
      expect(body.interpreter.name).toBe("test-interpreter");
      expect(mockAuditLedger.record).toHaveBeenCalled();
    });

    it("updates an existing interpreter", async () => {
      // Register first
      await app.inject({
        method: "POST",
        url: "/api/interpreters",
        payload: { name: "update-test", priority: 10 },
      });

      // Update
      const res = await app.inject({
        method: "POST",
        url: "/api/interpreters",
        payload: { name: "update-test", priority: 20 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().action).toBe("updated");
    });

    it("rejects invalid body", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/interpreters",
        payload: { name: "" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Invalid");
    });

    it("returns 403 for non-admin role", async () => {
      mockIdentity.getPrincipal.mockResolvedValueOnce({ roles: ["viewer"] });

      const res = await app.inject({
        method: "POST",
        url: "/api/interpreters",
        payload: { name: "forbidden-test", priority: 1 },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /api/interpreters/:name/enable", () => {
    it("enables an interpreter", async () => {
      // Register first
      await app.inject({
        method: "POST",
        url: "/api/interpreters",
        payload: { name: "enable-test", enabled: false },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/interpreters/enable-test/enable",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().interpreter.enabled).toBe(true);
    });

    it("returns 404 for unknown interpreter", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/interpreters/nonexistent/enable",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/interpreters/:name/disable", () => {
    it("disables an interpreter", async () => {
      // Register first
      await app.inject({
        method: "POST",
        url: "/api/interpreters",
        payload: { name: "disable-test", enabled: true },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/interpreters/disable-test/disable",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().interpreter.enabled).toBe(false);
    });
  });

  describe("POST /api/interpreters/routing", () => {
    it("sets routing config for an organization", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/interpreters/routing",
        payload: {
          organizationId: "org_test",
          preferredInterpreter: "gpt-4",
          fallbackChain: ["gpt-3.5-turbo"],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().routing.preferredInterpreter).toBe("gpt-4");
    });

    it("rejects org mismatch", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/interpreters/routing",
        payload: {
          organizationId: "org_other",
          preferredInterpreter: "gpt-4",
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("mismatch");
    });
  });

  describe("GET /api/interpreters/routing", () => {
    it("lists routing configs", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/interpreters/routing",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().routing).toBeInstanceOf(Array);
    });
  });
});
