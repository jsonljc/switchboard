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
      // Task 10: provision route precheck calls findFirst at the top of the
      // per-channel loop. Default null so the precheck is a no-op for these
      // first-time-provision tests.
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      delete: vi.fn(),
    },
    connection: {
      create: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    agentListing: {
      upsert: vi.fn(),
    },
    agentDeployment: {
      upsert: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Default Alex-listing seed mocks: stable ids regardless of call count so
    // multiple lazy-config requests resolve to the same listing/deployment.
    mockPrisma.agentListing.upsert.mockResolvedValue({
      id: "listing_alex",
      slug: "alex-conversion",
    });
    mockPrisma.agentDeployment.upsert.mockResolvedValue({ id: "deployment_alex" });
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

    it("seeds the Alex listing+deployment on first config access (Decision 10)", async () => {
      mockPrisma.organizationConfig.upsert.mockResolvedValue({
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
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/organizations/org_test/config",
      });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.agentListing.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.agentDeployment.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.agentListing.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { slug: "alex-conversion" },
          create: expect.objectContaining({
            slug: "alex-conversion",
            name: "Alex",
            type: "ai-agent",
            status: "active",
            autonomyLevel: "supervised",
            priceTier: "free",
          }),
        }),
      );
      expect(mockPrisma.agentDeployment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId_listingId: {
              organizationId: "org_test",
              listingId: "listing_alex",
            },
          },
          create: expect.objectContaining({
            organizationId: "org_test",
            listingId: "listing_alex",
            status: "active",
            skillSlug: "alex",
          }),
        }),
      );
    });

    it("repeated config access does not duplicate the listing+deployment (idempotent upsert)", async () => {
      mockPrisma.organizationConfig.upsert.mockResolvedValue({
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
      });

      for (let i = 0; i < 3; i++) {
        const res = await app.inject({
          method: "GET",
          url: "/api/organizations/org_test/config",
        });
        expect(res.statusCode).toBe(200);
      }

      // Each call hits the upsert (idempotent at the DB level — same slug and
      // same composite key resolve to the same row).
      expect(mockPrisma.agentListing.upsert).toHaveBeenCalledTimes(3);
      expect(mockPrisma.agentDeployment.upsert).toHaveBeenCalledTimes(3);
      // All calls used the same slug + composite key, so DB state stays at one
      // listing + one deployment.
      const listingCalls = mockPrisma.agentListing.upsert.mock.calls;
      for (const [args] of listingCalls) {
        expect(args.where).toEqual({ slug: "alex-conversion" });
      }
      const deploymentCalls = mockPrisma.agentDeployment.upsert.mock.calls;
      for (const [args] of deploymentCalls) {
        expect(args.where).toEqual({
          organizationId_listingId: {
            organizationId: "org_test",
            listingId: "listing_alex",
          },
        });
      }
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

  describe("GET /api/organizations/:orgId/channels", () => {
    it("returns channels for the org", async () => {
      const channels = [
        {
          id: "ch_1",
          organizationId: "org_test",
          channel: "telegram",
          botUsername: "mybot",
          webhookPath: "/webhooks/tg/abc",
          webhookRegistered: true,
          status: "active",
          statusDetail: null,
          lastHealthCheck: new Date("2026-04-20"),
          createdAt: new Date("2026-04-19"),
          updatedAt: new Date("2026-04-19"),
        },
      ];
      mockPrisma.managedChannel.findMany.mockResolvedValue(channels);

      const res = await app.inject({
        method: "GET",
        url: "/api/organizations/org_test/channels",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.channels).toHaveLength(1);
      expect(body.channels[0].channel).toBe("telegram");
      expect(body.channels[0].lastHealthCheck).toBe("2026-04-20T00:00:00.000Z");
    });

    it("returns empty array when no channels exist", async () => {
      mockPrisma.managedChannel.findMany.mockResolvedValue([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/organizations/org_test/channels",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().channels).toEqual([]);
    });

    it("returns 403 for wrong org", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/organizations/org_other/channels",
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /api/organizations/:orgId/provision", () => {
    it("creates connection and channel rows", async () => {
      const createdChannel = {
        id: "ch_1",
        organizationId: "org_test",
        channel: "telegram",
        connectionId: "conn_1",
        botUsername: null,
        webhookPath: expect.any(String),
        webhookRegistered: false,
        status: "active",
        statusDetail: null,
        lastHealthCheck: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.connection.create.mockResolvedValue({ id: "conn_1" });
      mockPrisma.managedChannel.create.mockResolvedValue(createdChannel);

      const res = await app.inject({
        method: "POST",
        url: "/api/organizations/org_test/provision",
        payload: {
          channels: [{ channel: "telegram", botToken: "123:ABC" }],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.channels).toHaveLength(1);
    });

    it("returns 403 for wrong org", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/organizations/org_other/provision",
        payload: { channels: [{ channel: "telegram", botToken: "123:ABC" }] },
      });

      expect(res.statusCode).toBe(403);
    });

    it("Task 7: provision route routes Alex seed through ensureAlexListingForOrg helper (safety net, idempotent)", async () => {
      // Build a stateful tx mock that mimics composite-key idempotency.
      const txAgentListing = vi.fn().mockResolvedValue({ id: "L1", slug: "alex-conversion" });
      const txAgentDeployment = vi.fn().mockResolvedValue({ id: "D1" });
      const txDeploymentConnection = vi.fn().mockResolvedValue({ id: "DC1" });
      const txConnection = vi.fn().mockResolvedValue({ id: "conn_1" });
      const txManagedChannel = vi.fn().mockResolvedValue({
        id: "mc_1",
        channel: "telegram",
        connectionId: "conn_1",
        botUsername: null,
        webhookPath: "/webhook/managed/conn_1",
        createdAt: new Date(),
      });
      const tx = {
        connection: { create: txConnection },
        managedChannel: { create: txManagedChannel },
        agentListing: { upsert: txAgentListing },
        agentDeployment: { upsert: txAgentDeployment },
        deploymentConnection: { upsert: txDeploymentConnection },
      };
      const txPrisma = {
        ...mockPrisma,
        $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
      };
      const fastify = Fastify({ logger: false });
      fastify.decorate("prisma", txPrisma as unknown as never);
      fastify.decorateRequest("organizationIdFromAuth", undefined);
      fastify.addHook("onRequest", async (request) => {
        request.organizationIdFromAuth = "org_test";
      });
      await fastify.register(organizationsRoutes, { prefix: "/api/organizations" });
      process.env.CREDENTIALS_ENCRYPTION_KEY =
        process.env.CREDENTIALS_ENCRYPTION_KEY ?? "test-key-for-task7-test-1234567890";

      const res = await fastify.inject({
        method: "POST",
        url: "/api/organizations/org_test/provision",
        payload: { channels: [{ channel: "telegram", botToken: "123:ABC" }] },
      });
      expect(res.statusCode).toBe(200);
      // Helper called once per provision via the tx client.
      expect(txAgentListing).toHaveBeenCalledTimes(1);
      expect(txAgentDeployment).toHaveBeenCalledTimes(1);
      expect(txAgentListing).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: "alex-conversion" } }),
      );
      // deploymentId returned by helper flows into deploymentConnection.upsert.
      expect(txDeploymentConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deploymentId_type_slot: expect.objectContaining({ deploymentId: "D1" }),
          }),
        }),
      );
      await fastify.close();
    });
  });

  describe("DELETE /api/organizations/:orgId/channels/:channelId", () => {
    it("deletes channel owned by the org", async () => {
      mockPrisma.managedChannel.findUnique.mockResolvedValue({
        id: "ch_1",
        organizationId: "org_test",
      });
      mockPrisma.managedChannel.delete.mockResolvedValue({ id: "ch_1" });

      const res = await app.inject({
        method: "DELETE",
        url: "/api/organizations/org_test/channels/ch_1",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(true);
    });

    it("returns 403 for wrong org param", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/organizations/org_other/channels/ch_1",
      });

      expect(res.statusCode).toBe(403);
    });

    it("returns 404 when channel belongs to different org", async () => {
      mockPrisma.managedChannel.findUnique.mockResolvedValue({
        id: "ch_1",
        organizationId: "org_other",
      });

      const res = await app.inject({
        method: "DELETE",
        url: "/api/organizations/org_test/channels/ch_1",
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 404 when channel does not exist", async () => {
      mockPrisma.managedChannel.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: "DELETE",
        url: "/api/organizations/org_test/channels/ch_999",
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
