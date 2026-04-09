import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaDeploymentStateStore } from "../prisma-deployment-state-store.js";

function createMockPrisma() {
  return {
    deploymentState: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe("PrismaDeploymentStateStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaDeploymentStateStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaDeploymentStateStore(prisma as never);
  });

  describe("get", () => {
    it("gets a state value", async () => {
      prisma.deploymentState.findUnique.mockResolvedValue({
        id: "st_1",
        deploymentId: "dep_1",
        key: "count",
        value: 42,
        updatedAt: new Date(),
      });

      const result = await store.get("dep_1", "count");

      expect(result).toBe(42);
      expect(prisma.deploymentState.findUnique).toHaveBeenCalledWith({
        where: { deploymentId_key: { deploymentId: "dep_1", key: "count" } },
      });
    });

    it("returns null for missing key", async () => {
      prisma.deploymentState.findUnique.mockResolvedValue(null);

      const result = await store.get("dep_1", "missing");

      expect(result).toBeNull();
    });

    it("handles complex JSON values", async () => {
      const complexValue = { nested: { data: [1, 2, 3], flag: true } };
      prisma.deploymentState.findUnique.mockResolvedValue({
        id: "st_1",
        deploymentId: "dep_1",
        key: "config",
        value: complexValue,
        updatedAt: new Date(),
      });

      const result = await store.get("dep_1", "config");

      expect(result).toEqual(complexValue);
    });
  });

  describe("set", () => {
    it("sets a state value via upsert", async () => {
      prisma.deploymentState.upsert.mockResolvedValue({
        id: "st_1",
        deploymentId: "dep_1",
        key: "count",
        value: 42,
        updatedAt: new Date(),
      });

      await store.set("dep_1", "count", 42);

      expect(prisma.deploymentState.upsert).toHaveBeenCalledWith({
        where: { deploymentId_key: { deploymentId: "dep_1", key: "count" } },
        create: { deploymentId: "dep_1", key: "count", value: 42 },
        update: { value: 42 },
      });
    });

    it("sets a string value", async () => {
      prisma.deploymentState.upsert.mockResolvedValue({});

      await store.set("dep_1", "name", "test-agent");

      expect(prisma.deploymentState.upsert).toHaveBeenCalledWith({
        where: { deploymentId_key: { deploymentId: "dep_1", key: "name" } },
        create: { deploymentId: "dep_1", key: "name", value: "test-agent" },
        update: { value: "test-agent" },
      });
    });

    it("sets a complex object value", async () => {
      const complexValue = { settings: { enabled: true, threshold: 100 } };
      prisma.deploymentState.upsert.mockResolvedValue({});

      await store.set("dep_1", "config", complexValue);

      expect(prisma.deploymentState.upsert).toHaveBeenCalledWith({
        where: { deploymentId_key: { deploymentId: "dep_1", key: "config" } },
        create: { deploymentId: "dep_1", key: "config", value: complexValue },
        update: { value: complexValue },
      });
    });
  });

  describe("list", () => {
    it("lists by prefix", async () => {
      prisma.deploymentState.findMany.mockResolvedValue([
        { key: "leads:a", value: 1 },
        { key: "leads:b", value: 2 },
      ]);

      const result = await store.list("dep_1", "leads:");

      expect(result).toEqual([
        { key: "leads:a", value: 1 },
        { key: "leads:b", value: 2 },
      ]);
      expect(prisma.deploymentState.findMany).toHaveBeenCalledWith({
        where: { deploymentId: "dep_1", key: { startsWith: "leads:" } },
      });
    });

    it("returns empty array when no matches", async () => {
      prisma.deploymentState.findMany.mockResolvedValue([]);

      const result = await store.list("dep_1", "unknown:");

      expect(result).toEqual([]);
    });
  });

  describe("delete", () => {
    it("deletes a key", async () => {
      prisma.deploymentState.delete.mockResolvedValue({
        id: "st_1",
        deploymentId: "dep_1",
        key: "count",
        value: 42,
        updatedAt: new Date(),
      });

      await store.delete("dep_1", "count");

      expect(prisma.deploymentState.delete).toHaveBeenCalledWith({
        where: { deploymentId_key: { deploymentId: "dep_1", key: "count" } },
      });
    });
  });
});
