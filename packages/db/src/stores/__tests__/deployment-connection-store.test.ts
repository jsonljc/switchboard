import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaDeploymentConnectionStore } from "../prisma-deployment-connection-store.js";

function createMockPrisma() {
  return {
    deploymentConnection: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe("PrismaDeploymentConnectionStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaDeploymentConnectionStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaDeploymentConnectionStore(prisma as never);
  });

  describe("create", () => {
    it("creates a connection with all fields", async () => {
      const input = {
        deploymentId: "dep_1",
        type: "telegram",
        slot: "primary",
        credentials: "encrypted-creds",
        metadata: { chatId: "123456" },
      };
      const expected = {
        id: "conn_1",
        ...input,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.deploymentConnection.create.mockResolvedValue(expected);

      const result = await store.create(input);

      expect(result).toEqual(expected);
      expect(prisma.deploymentConnection.create).toHaveBeenCalledWith({
        data: {
          deploymentId: "dep_1",
          type: "telegram",
          slot: "primary",
          credentials: "encrypted-creds",
          metadata: { chatId: "123456" },
        },
      });
    });

    it("creates a connection with default slot", async () => {
      const input = {
        deploymentId: "dep_1",
        type: "telegram",
        credentials: "encrypted-creds",
      };
      const expected = {
        id: "conn_1",
        ...input,
        slot: "default",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.deploymentConnection.create.mockResolvedValue(expected);

      await store.create(input);

      expect(prisma.deploymentConnection.create).toHaveBeenCalledWith({
        data: {
          deploymentId: "dep_1",
          type: "telegram",
          slot: "default",
          credentials: "encrypted-creds",
          metadata: undefined,
        },
      });
    });

    it("creates a connection without metadata", async () => {
      const input = {
        deploymentId: "dep_1",
        type: "telegram",
        credentials: "encrypted-creds",
      };
      prisma.deploymentConnection.create.mockResolvedValue({
        id: "conn_1",
        ...input,
        slot: "default",
        metadata: null,
      });

      await store.create(input);

      expect(prisma.deploymentConnection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: undefined,
        }),
      });
    });
  });

  describe("listByDeployment", () => {
    it("lists all connections for deployment", async () => {
      const mockConnections = [
        { id: "conn_1", deploymentId: "dep_1", type: "telegram", status: "active" },
        { id: "conn_2", deploymentId: "dep_1", type: "whatsapp", status: "active" },
      ];
      prisma.deploymentConnection.findMany.mockResolvedValue(mockConnections);

      const result = await store.listByDeployment("dep_1");

      expect(result).toEqual(mockConnections);
      expect(prisma.deploymentConnection.findMany).toHaveBeenCalledWith({
        where: { deploymentId: "dep_1" },
      });
    });

    it("returns empty array when no connections", async () => {
      prisma.deploymentConnection.findMany.mockResolvedValue([]);

      const result = await store.listByDeployment("dep_1");

      expect(result).toEqual([]);
    });
  });

  describe("updateStatus", () => {
    it("updates connection status", async () => {
      const updated = {
        id: "conn_1",
        status: "inactive",
        updatedAt: new Date(),
      };
      prisma.deploymentConnection.update.mockResolvedValue(updated);

      const result = await store.updateStatus("conn_1", "inactive");

      expect(result).toEqual(updated);
      expect(prisma.deploymentConnection.update).toHaveBeenCalledWith({
        where: { id: "conn_1" },
        data: { status: "inactive" },
      });
    });
  });

  describe("delete", () => {
    it("deletes a connection", async () => {
      prisma.deploymentConnection.delete.mockResolvedValue({
        id: "conn_1",
        deploymentId: "dep_1",
      });

      await store.delete("conn_1");

      expect(prisma.deploymentConnection.delete).toHaveBeenCalledWith({
        where: { id: "conn_1" },
      });
    });
  });
});
