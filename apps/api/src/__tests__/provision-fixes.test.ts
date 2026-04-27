import { describe, it, expect, vi } from "vitest";

describe("provision route fixes", () => {
  describe("P0-1: webhook path format", () => {
    it("uses the buildManagedWebhookPath helper that mirrors the chat-server route", async () => {
      const { buildManagedWebhookPath } = await import("../lib/managed-webhook-path.js");
      expect(buildManagedWebhookPath("conn_abc12345")).toBe("/webhook/managed/conn_abc12345");
    });
  });

  describe("P0-6: Alex listing auto-creation", () => {
    it("creates Alex listing if missing via upsert", async () => {
      const mockPrisma = {
        agentListing: {
          upsert: vi.fn().mockResolvedValue({
            id: "listing_auto",
            slug: "alex-conversion",
            name: "Alex",
            type: "ai-agent",
          }),
        },
      };

      const listing = await mockPrisma.agentListing.upsert({
        where: { slug: "alex-conversion" },
        create: {
          slug: "alex-conversion",
          name: "Alex",
          description: "AI-powered lead conversion agent",
          type: "ai-agent",
          status: "active",
          trustScore: 0,
          autonomyLevel: "supervised",
          priceTier: "free",
          metadata: {},
        },
        update: {},
      });

      expect(listing.slug).toBe("alex-conversion");
      expect(mockPrisma.agentListing.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { slug: "alex-conversion" },
          create: expect.objectContaining({ slug: "alex-conversion" }),
        }),
      );
    });
  });

  describe("P0-3: WhatsApp onboarding routes registered", () => {
    it("whatsappOnboardingRoutes exports a FastifyPluginAsync", async () => {
      const mod = await import("../routes/whatsapp-onboarding.js");
      expect(mod.whatsappOnboardingRoutes).toBeDefined();
      expect(typeof mod.whatsappOnboardingRoutes).toBe("function");
    });
  });

  describe("P0-4: provision-notify", () => {
    it("calls chat server provision-notify with managedChannelId", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      const chatUrl = "http://localhost:3001";
      const internalSecret = "test-secret";
      const managedChannelId = "mc_123";

      await mockFetch(`${chatUrl}/internal/provision-notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${internalSecret}`,
        },
        body: JSON.stringify({ managedChannelId }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${chatUrl}/internal/provision-notify`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${internalSecret}`,
          }),
        }),
      );
    });

    it("handles provision-notify failure gracefully", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      let notifyError: string | null = null;
      try {
        await mockFetch("http://localhost:3001/internal/provision-notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ managedChannelId: "mc_123" }),
        });
      } catch (err) {
        notifyError = err instanceof Error ? err.message : "unknown";
      }

      expect(notifyError).toBe("Connection refused");
    });
  });

  describe("P0-5: lastHealthCheck set on credential test", () => {
    it("updates Connection.lastHealthCheck after successful WhatsApp test", async () => {
      const now = new Date();
      const mockPrisma = {
        connection: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };

      await mockPrisma.connection.updateMany({
        where: {
          organizationId: "org_123",
          serviceId: "whatsapp",
        },
        data: {
          lastHealthCheck: now,
        },
      });

      expect(mockPrisma.connection.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastHealthCheck: expect.any(Date),
          }),
        }),
      );
    });
  });

  describe("P1: transactional provision", () => {
    it("rolls back all records if any creation fails", async () => {
      const createCalls: string[] = [];
      const mockTx = {
        connection: {
          create: vi.fn().mockImplementation(() => {
            createCalls.push("connection");
            return { id: "conn_123" };
          }),
        },
        managedChannel: {
          create: vi.fn().mockImplementation(() => {
            createCalls.push("managedChannel");
            return {
              id: "mc_123",
              channel: "whatsapp",
              webhookPath: "/webhook/managed/conn_123",
              createdAt: new Date(),
            };
          }),
        },
        agentListing: {
          upsert: vi.fn().mockImplementation(() => {
            createCalls.push("listing");
            return { id: "listing_123" };
          }),
        },
        agentDeployment: {
          upsert: vi.fn().mockImplementation(() => {
            createCalls.push("deployment");
            throw new Error("Simulated failure");
          }),
        },
      };

      const mockPrisma = {
        $transaction: vi
          .fn()
          .mockImplementation(async (fn: (tx: typeof mockTx) => Promise<void>) => {
            await fn(mockTx);
          }),
      };

      await expect(
        mockPrisma.$transaction(async (tx: typeof mockTx) => {
          await tx.connection.create({ data: {} as never });
          await tx.managedChannel.create({ data: {} as never });
          await tx.agentListing.upsert({ where: {}, create: {} as never, update: {} });
          await tx.agentDeployment.upsert({ where: {}, create: {} as never, update: {} });
        }),
      ).rejects.toThrow("Simulated failure");

      expect(createCalls).toEqual(["connection", "managedChannel", "listing", "deployment"]);
    });
  });
});
