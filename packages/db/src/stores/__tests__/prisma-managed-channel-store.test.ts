import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaManagedChannelStore } from "../prisma-managed-channel-store.js";

function createMockPrisma() {
  return {
    managedChannel: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe("PrismaManagedChannelStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaManagedChannelStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaManagedChannelStore(prisma as never);
  });

  describe("listByOrg", () => {
    it("returns channels for the given orgId", async () => {
      const channels = [
        {
          id: "ch_1",
          organizationId: "org_1",
          channel: "telegram",
          connectionId: "conn_1",
          botUsername: "mybot",
          webhookPath: "/webhooks/tg/abc",
          webhookRegistered: true,
          status: "active",
          statusDetail: null,
          lastHealthCheck: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      prisma.managedChannel.findMany.mockResolvedValue(channels);

      const result = await store.listByOrg("org_1");

      expect(prisma.managedChannel.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org_1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.channel).toBe("telegram");
    });

    it("returns empty array when no channels exist", async () => {
      prisma.managedChannel.findMany.mockResolvedValue([]);

      const result = await store.listByOrg("org_999");

      expect(result).toHaveLength(0);
    });
  });

  describe("create", () => {
    it("persists all fields and returns the created row", async () => {
      const data = {
        organizationId: "org_1",
        channel: "telegram",
        connectionId: "conn_1",
        botUsername: "mybot",
        webhookPath: "/webhooks/tg/abc",
      };
      const created = {
        id: "ch_1",
        ...data,
        webhookRegistered: false,
        status: "provisioning",
        statusDetail: null,
        lastHealthCheck: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.managedChannel.create.mockResolvedValue(created);

      const result = await store.create(data);

      expect(prisma.managedChannel.create).toHaveBeenCalledWith({ data });
      expect(result.id).toBe("ch_1");
      expect(result.status).toBe("provisioning");
    });
  });

  describe("delete", () => {
    it("deletes when orgId matches", async () => {
      const existing = { id: "ch_1", organizationId: "org_1" };
      prisma.managedChannel.findUnique.mockResolvedValue(existing);
      prisma.managedChannel.delete.mockResolvedValue(existing);

      await store.delete("ch_1", "org_1");

      expect(prisma.managedChannel.findUnique).toHaveBeenCalledWith({
        where: { id: "ch_1" },
      });
      expect(prisma.managedChannel.delete).toHaveBeenCalledWith({
        where: { id: "ch_1" },
      });
    });

    it("throws when orgId does not match", async () => {
      const existing = { id: "ch_1", organizationId: "org_other" };
      prisma.managedChannel.findUnique.mockResolvedValue(existing);

      await expect(store.delete("ch_1", "org_1")).rejects.toThrow("not found");
    });

    it("throws when channel does not exist", async () => {
      prisma.managedChannel.findUnique.mockResolvedValue(null);

      await expect(store.delete("ch_999", "org_1")).rejects.toThrow("not found");
    });
  });
});
