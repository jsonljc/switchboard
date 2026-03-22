import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

const mockConnectionStore = {
  save: vi.fn(),
  list: vi.fn(),
  getById: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@switchboard/db", () => ({
  PrismaConnectionStore: vi.fn().mockImplementation(() => mockConnectionStore),
}));

import { organizationsRoutes } from "../routes/organizations.js";

describe("Organizations API", () => {
  let app: FastifyInstance;

  const mockOrgConfig = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  };

  const mockManagedChannel = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const mockPrisma = {
    organizationConfig: mockOrgConfig,
    managedChannel: mockManagedChannel,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });

    app.decorate("prisma", mockPrisma as any);
    app.decorate("storageContext", { cartridges: { get: vi.fn(), list: vi.fn() } } as any);

    app.decorateRequest("organizationIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
    });

    await app.register(organizationsRoutes, { prefix: "/api/organizations" });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/organizations/:orgId/config", () => {
    it("returns organization config", async () => {
      mockOrgConfig.findUnique.mockResolvedValue({
        id: "org_test",
        name: "Test Org",
        runtimeType: "http",
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/organizations/org_test/config",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().config.name).toBe("Test Org");
    });

    it("returns 404 when config not found", async () => {
      mockOrgConfig.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/api/organizations/org_test/config",
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 403 on org mismatch", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/organizations/org_other/config",
      });

      expect(res.statusCode).toBe(403);
    });

    it("returns 503 when prisma is unavailable", async () => {
      await app.close();

      app = Fastify({ logger: false });
      app.decorate("prisma", null);
      app.decorate("storageContext", { cartridges: { get: vi.fn() } } as any);
      app.decorateRequest("organizationIdFromAuth", undefined);
      await app.register(organizationsRoutes, { prefix: "/api/organizations" });

      const res = await app.inject({
        method: "GET",
        url: "/api/organizations/org_test/config",
      });

      expect(res.statusCode).toBe(503);
    });
  });

  describe("PUT /api/organizations/:orgId/config", () => {
    it("creates or updates organization config", async () => {
      mockOrgConfig.upsert.mockResolvedValue({
        id: "org_test",
        name: "Updated Org",
        runtimeType: "http",
      });

      const res = await app.inject({
        method: "PUT",
        url: "/api/organizations/org_test/config",
        payload: { name: "Updated Org" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().config.name).toBe("Updated Org");
    });
  });

  describe("GET /api/organizations/:orgId/channels", () => {
    it("lists managed channels", async () => {
      mockManagedChannel.findMany.mockResolvedValue([
        { id: "ch_1", channel: "telegram", status: "active" },
      ]);

      const res = await app.inject({
        method: "GET",
        url: "/api/organizations/org_test/channels",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().channels).toHaveLength(1);
    });
  });

  describe("DELETE /api/organizations/:orgId/channels/:channelId", () => {
    it("deletes a managed channel", async () => {
      mockManagedChannel.findUnique.mockResolvedValue({
        id: "ch_1",
        organizationId: "org_test",
        connectionId: "conn_1",
      });
      mockManagedChannel.delete.mockResolvedValue({});
      mockConnectionStore.delete.mockResolvedValue(undefined);
      mockManagedChannel.findMany.mockResolvedValue([]);
      mockOrgConfig.update.mockResolvedValue({});

      const res = await app.inject({
        method: "DELETE",
        url: "/api/organizations/org_test/channels/ch_1",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(true);
    });

    it("returns 404 when channel not found", async () => {
      mockManagedChannel.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: "DELETE",
        url: "/api/organizations/org_test/channels/nonexistent",
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
