import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// Mock @switchboard/db before importing routes
const mockStore = {
  save: vi.fn(),
  list: vi.fn(),
  getById: vi.fn(),
  delete: vi.fn(),
  updateStatus: vi.fn(),
  getByService: vi.fn(),
};

vi.mock("@switchboard/db", () => ({
  PrismaConnectionStore: vi.fn().mockImplementation(() => mockStore),
}));

import { connectionsRoutes } from "../routes/connections.js";

describe("Connections API", () => {
  let app: FastifyInstance;
  let savedEncryptionKey: string | undefined;

  const mockCartridges = {
    list: vi.fn(() => []),
    get: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    savedEncryptionKey = process.env["CREDENTIALS_ENCRYPTION_KEY"];
    process.env["CREDENTIALS_ENCRYPTION_KEY"] = "test-key";

    app = Fastify({ logger: false });

    app.decorate("prisma", { _mock: true } as any);
    app.decorate("storageContext", { cartridges: mockCartridges } as any);

    app.decorateRequest("organizationIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
    });

    await app.register(connectionsRoutes, { prefix: "/api/connections" });
  });

  afterEach(async () => {
    await app.close();
    if (savedEncryptionKey !== undefined) {
      process.env["CREDENTIALS_ENCRYPTION_KEY"] = savedEncryptionKey;
    } else {
      delete process.env["CREDENTIALS_ENCRYPTION_KEY"];
    }
  });

  // ── POST /api/connections ──────────────────────────────────────────

  describe("POST /api/connections", () => {
    it("creates a connection and returns 201 with redacted credentials", async () => {
      mockStore.save.mockResolvedValue(undefined);

      const res = await app.inject({
        method: "POST",
        url: "/api/connections",
        payload: {
          serviceId: "meta-ads",
          serviceName: "Meta Ads",
          authType: "oauth2",
          credentials: { accessToken: "secret-token-123" },
          scopes: ["ads_read", "ads_management"],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.connection).toBeDefined();
      expect(body.connection.serviceId).toBe("meta-ads");
      expect(body.connection.serviceName).toBe("Meta Ads");
      expect(body.connection.credentials).toBe("***");
      expect(body.connection.organizationId).toBe("org_test");
      expect(body.connection.id).toBeDefined();

      expect(mockStore.save).toHaveBeenCalledTimes(1);
      const savedConnection = mockStore.save.mock.calls[0]![0];
      expect(savedConnection.serviceId).toBe("meta-ads");
      expect(savedConnection.credentials).toEqual({ accessToken: "secret-token-123" });
    });

    it("returns 400 when required fields are missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/connections",
        payload: {
          serviceId: "meta-ads",
          // missing serviceName, authType, credentials
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.toLowerCase()).toContain("required");
    });

    it("returns 503 if encryption key is not set", async () => {
      delete process.env["CREDENTIALS_ENCRYPTION_KEY"];

      mockStore.save.mockResolvedValue(undefined);

      const res = await app.inject({
        method: "POST",
        url: "/api/connections",
        payload: {
          serviceId: "meta-ads",
          serviceName: "Meta Ads",
          authType: "oauth2",
          credentials: { accessToken: "token" },
        },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toContain("CREDENTIALS_ENCRYPTION_KEY");
    });

    it("returns 403 if no organization context", async () => {
      // Rebuild app without organization context
      await app.close();

      app = Fastify({ logger: false });
      app.decorate("prisma", { _mock: true } as any);
      app.decorate("storageContext", { cartridges: mockCartridges } as any);
      app.decorateRequest("organizationIdFromAuth", undefined);
      // Do NOT add the onRequest hook that sets organizationIdFromAuth
      await app.register(connectionsRoutes, { prefix: "/api/connections" });

      const res = await app.inject({
        method: "POST",
        url: "/api/connections",
        payload: {
          serviceId: "meta-ads",
          serviceName: "Meta Ads",
          authType: "oauth2",
          credentials: { accessToken: "token" },
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("Organization context required");
    });

    it("defaults scopes to empty array and sets status and refreshStrategy", async () => {
      mockStore.save.mockResolvedValue(undefined);

      const res = await app.inject({
        method: "POST",
        url: "/api/connections",
        payload: {
          serviceId: "stripe",
          serviceName: "Stripe",
          authType: "api_key",
          credentials: { secretKey: "sk_test_123" },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.connection.scopes).toEqual([]);
      expect(body.connection.status).toBe("connected");
      expect(body.connection.refreshStrategy).toBe("auto");

      const savedConnection = mockStore.save.mock.calls[0]![0];
      expect(savedConnection.scopes).toEqual([]);
    });
  });

  // ── GET /api/connections ───────────────────────────────────────────

  describe("GET /api/connections", () => {
    it("lists connections with redacted credentials", async () => {
      mockStore.list.mockResolvedValue([
        {
          id: "conn_1",
          serviceId: "meta-ads",
          serviceName: "Meta Ads",
          organizationId: "org_test",
          authType: "oauth2",
          credentials: { accessToken: "secret" },
          scopes: ["ads_read"],
          status: "connected",
        },
        {
          id: "conn_2",
          serviceId: "stripe",
          serviceName: "Stripe",
          organizationId: "org_test",
          authType: "api_key",
          credentials: { secretKey: "sk_123" },
          scopes: [],
          status: "connected",
        },
      ]);

      const res = await app.inject({
        method: "GET",
        url: "/api/connections",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.connections).toHaveLength(2);
      // Credentials should be redacted
      expect(body.connections[0].credentials).toBe("***");
      expect(body.connections[1].credentials).toBe("***");
      // Other fields preserved
      expect(body.connections[0].serviceId).toBe("meta-ads");
      expect(body.connections[1].serviceId).toBe("stripe");

      expect(mockStore.list).toHaveBeenCalledWith("org_test");
    });
  });

  // ── GET /api/connections/:id ───────────────────────────────────────

  describe("GET /api/connections/:id", () => {
    it("returns a connection with redacted credentials", async () => {
      mockStore.getById.mockResolvedValue({
        id: "conn_1",
        serviceId: "meta-ads",
        serviceName: "Meta Ads",
        organizationId: "org_test",
        authType: "oauth2",
        credentials: { accessToken: "secret" },
        scopes: ["ads_read"],
        status: "connected",
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/connections/conn_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.connection.id).toBe("conn_1");
      expect(body.connection.credentials).toBe("***");
    });

    it("returns 404 if connection not found", async () => {
      mockStore.getById.mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/api/connections/conn_nonexistent",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("not found");
    });

    it("returns 404 if connection belongs to different org", async () => {
      mockStore.getById.mockResolvedValue({
        id: "conn_1",
        serviceId: "meta-ads",
        organizationId: "org_other",
        credentials: {},
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/connections/conn_1",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("not found");
    });
  });

  // ── DELETE /api/connections/:id ────────────────────────────────────

  describe("DELETE /api/connections/:id", () => {
    it("deletes a connection and returns confirmation", async () => {
      mockStore.getById.mockResolvedValue({
        id: "conn_1",
        serviceId: "meta-ads",
        organizationId: "org_test",
        credentials: {},
      });
      mockStore.delete.mockResolvedValue(undefined);

      const res = await app.inject({
        method: "DELETE",
        url: "/api/connections/conn_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe("conn_1");
      expect(body.deleted).toBe(true);

      expect(mockStore.delete).toHaveBeenCalledWith("conn_1");
    });

    it("returns 404 if connection not found", async () => {
      mockStore.getById.mockResolvedValue(null);

      const res = await app.inject({
        method: "DELETE",
        url: "/api/connections/conn_nonexistent",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("not found");
    });

    it("returns 404 if connection belongs to different org", async () => {
      mockStore.getById.mockResolvedValue({
        id: "conn_1",
        serviceId: "meta-ads",
        organizationId: "org_other",
        credentials: {},
      });

      const res = await app.inject({
        method: "DELETE",
        url: "/api/connections/conn_1",
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
