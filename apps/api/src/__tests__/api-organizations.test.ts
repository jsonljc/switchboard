import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { organizationsRoutes } from "../routes/organizations.js";

describe("Organizations API — Config", () => {
  let app: FastifyInstance;

  const mockPrisma = {
    organizationConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    managedChannel: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    connection: {
      create: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    app.decorate("prisma", mockPrisma as unknown as never);
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
    it("returns existing config", async () => {
      const config = {
        id: "org_test",
        name: "Test Org",
        runtimeType: "http",
        runtimeConfig: {},
        governanceProfile: "guarded",
        onboardingComplete: false,
        managedChannels: [],
        provisioningStatus: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.organizationConfig.upsert.mockResolvedValue(config);

      const res = await app.inject({
        method: "GET",
        url: "/api/organizations/org_test/config",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.config.id).toBe("org_test");
      expect(body.config.name).toBe("Test Org");
    });

    it("auto-creates default config when none exists", async () => {
      const defaultConfig = {
        id: "org_test",
        name: "",
        runtimeType: "http",
        runtimeConfig: {},
        governanceProfile: "guarded",
        onboardingComplete: false,
        managedChannels: [],
        provisioningStatus: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.organizationConfig.upsert.mockResolvedValue(defaultConfig);

      const res = await app.inject({
        method: "GET",
        url: "/api/organizations/org_test/config",
      });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.organizationConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "org_test" },
          create: expect.objectContaining({
            id: "org_test",
            onboardingComplete: false,
            provisioningStatus: "pending",
          }),
          update: {},
        }),
      );
    });

    it("returns 403 for wrong org", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/organizations/org_other/config",
      });

      expect(res.statusCode).toBe(403);
    });

    it("returns 403 when unauthenticated", async () => {
      const unauthApp = Fastify({ logger: false });
      unauthApp.decorate("prisma", mockPrisma as unknown as never);
      unauthApp.decorateRequest("organizationIdFromAuth", undefined);
      await unauthApp.register(organizationsRoutes, { prefix: "/api/organizations" });

      const res = await unauthApp.inject({
        method: "GET",
        url: "/api/organizations/org_test/config",
      });

      expect(res.statusCode).toBe(403);
      await unauthApp.close();
    });
  });

  describe("PUT /api/organizations/:orgId/config", () => {
    it("updates allowed fields", async () => {
      const updated = {
        id: "org_test",
        name: "Updated Org",
        runtimeType: "http",
        runtimeConfig: {},
        governanceProfile: "permissive",
        onboardingComplete: true,
        managedChannels: [],
        provisioningStatus: "pending",
      };
      mockPrisma.organizationConfig.update.mockResolvedValue(updated);

      const res = await app.inject({
        method: "PUT",
        url: "/api/organizations/org_test/config",
        payload: { name: "Updated Org", governanceProfile: "permissive", onboardingComplete: true },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().config.name).toBe("Updated Org");
    });

    it("rejects writes to server-derived fields", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/organizations/org_test/config",
        payload: { id: "org_hacked", managedChannels: ["evil"], provisioningStatus: "complete" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for wrong org", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/organizations/org_other/config",
        payload: { name: "Nope" },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
