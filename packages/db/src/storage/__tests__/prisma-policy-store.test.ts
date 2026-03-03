import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaPolicyStore } from "../prisma-policy-store.js";

function createMockPrisma() {
  return {
    policy: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

function createMockRedis() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  };
}

const NOW = new Date("2025-01-01");

const TEST_POLICY = {
  id: "pol_1",
  name: "Spend Limit",
  description: "Max daily spend",
  organizationId: "org_1",
  cartridgeId: "digital-ads",
  priority: 1,
  active: true,
  rule: { type: "spend_limit", maxAmount: 1000 },
  effect: "require_approval" as const,
  effectParams: { threshold: 500 },
  approvalRequirement: "manager" as const,
  riskCategoryOverride: "high" as const,
  createdAt: NOW,
  updatedAt: NOW,
};

const TEST_DB_ROW = {
  id: "pol_1",
  name: "Spend Limit",
  description: "Max daily spend",
  organizationId: "org_1",
  cartridgeId: "digital-ads",
  priority: 1,
  active: true,
  rule: { type: "spend_limit", maxAmount: 1000 },
  effect: "require_approval",
  effectParams: { threshold: 500 },
  approvalRequirement: "manager",
  riskCategoryOverride: "high",
  createdAt: NOW,
  updatedAt: NOW,
};

describe("PrismaPolicyStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaPolicyStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaPolicyStore(prisma as any);
  });

  describe("save", () => {
    it("upserts a policy", async () => {
      prisma.policy.upsert.mockResolvedValue({});

      await store.save(TEST_POLICY as any);

      expect(prisma.policy.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "pol_1" },
          create: expect.objectContaining({
            id: "pol_1",
            name: "Spend Limit",
            priority: 1,
            active: true,
            effect: "require_approval",
          }),
          update: expect.objectContaining({
            name: "Spend Limit",
            priority: 1,
            active: true,
            effect: "require_approval",
          }),
        }),
      );
    });
  });

  describe("getById", () => {
    it("returns policy when found", async () => {
      prisma.policy.findUnique.mockResolvedValue(TEST_DB_ROW);

      const result = await store.getById("pol_1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("pol_1");
      expect(result!.name).toBe("Spend Limit");
      expect(result!.effect).toBe("require_approval");
      expect(prisma.policy.findUnique).toHaveBeenCalledWith({ where: { id: "pol_1" } });
    });

    it("returns null when not found", async () => {
      prisma.policy.findUnique.mockResolvedValue(null);

      const result = await store.getById("missing");
      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    it("updates specific fields dynamically", async () => {
      prisma.policy.update.mockResolvedValue({});

      await store.update("pol_1", { name: "Updated Name", active: false });

      expect(prisma.policy.update).toHaveBeenCalledWith({
        where: { id: "pol_1" },
        data: expect.objectContaining({
          name: "Updated Name",
          active: false,
          updatedAt: expect.any(Date),
        }),
      });
    });

    it("only includes provided fields in update data", async () => {
      prisma.policy.update.mockResolvedValue({});

      await store.update("pol_1", { priority: 5 });

      const callArgs = prisma.policy.update.mock.calls[0]![0];
      expect(callArgs.data).toHaveProperty("priority", 5);
      expect(callArgs.data).toHaveProperty("updatedAt");
      expect(callArgs.data).not.toHaveProperty("name");
      expect(callArgs.data).not.toHaveProperty("active");
    });
  });

  describe("delete", () => {
    it("returns true on successful delete", async () => {
      prisma.policy.delete.mockResolvedValue({});

      const result = await store.delete("pol_1");
      expect(result).toBe(true);
      expect(prisma.policy.delete).toHaveBeenCalledWith({ where: { id: "pol_1" } });
    });

    it("returns false when delete throws (record not found)", async () => {
      prisma.policy.delete.mockRejectedValue(new Error("Record not found"));

      const result = await store.delete("missing");
      expect(result).toBe(false);
    });
  });

  describe("listActive", () => {
    it("lists active policies without filter", async () => {
      prisma.policy.findMany.mockResolvedValue([TEST_DB_ROW]);

      const result = await store.listActive();
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("pol_1");
      expect(prisma.policy.findMany).toHaveBeenCalledWith({
        where: { active: true },
        orderBy: { priority: "asc" },
      });
    });

    it("filters by cartridgeId", async () => {
      prisma.policy.findMany.mockResolvedValue([]);

      await store.listActive({ cartridgeId: "digital-ads" });

      expect(prisma.policy.findMany).toHaveBeenCalledWith({
        where: {
          active: true,
          OR: [{ cartridgeId: null }, { cartridgeId: "digital-ads" }],
        },
        orderBy: { priority: "asc" },
      });
    });

    it("filters by organizationId", async () => {
      prisma.policy.findMany.mockResolvedValue([]);

      await store.listActive({ organizationId: "org_1" });

      expect(prisma.policy.findMany).toHaveBeenCalledWith({
        where: {
          active: true,
          OR: [{ organizationId: null }, { organizationId: "org_1" }],
        },
        orderBy: { priority: "asc" },
      });
    });

    it("combines cartridgeId and organizationId filters with AND", async () => {
      prisma.policy.findMany.mockResolvedValue([]);

      await store.listActive({ cartridgeId: "digital-ads", organizationId: "org_1" });

      expect(prisma.policy.findMany).toHaveBeenCalledWith({
        where: {
          active: true,
          AND: [
            { OR: [{ cartridgeId: null }, { cartridgeId: "digital-ads" }] },
            { OR: [{ organizationId: null }, { organizationId: "org_1" }] },
          ],
        },
        orderBy: { priority: "asc" },
      });
    });
  });

  describe("listActive with Redis cache", () => {
    let redis: ReturnType<typeof createMockRedis>;
    let cachedStore: PrismaPolicyStore;

    beforeEach(() => {
      redis = createMockRedis();
      cachedStore = new PrismaPolicyStore(prisma as any, {
        redis: redis as any,
        cacheTtlSeconds: 120,
      });
    });

    it("returns cached results on cache hit", async () => {
      const cached = JSON.stringify([
        { ...TEST_DB_ROW, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
      ]);
      redis.get.mockResolvedValue(cached);

      const result = await cachedStore.listActive();
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("pol_1");
      expect(prisma.policy.findMany).not.toHaveBeenCalled();
    });

    it("queries DB and caches on cache miss", async () => {
      redis.get.mockResolvedValue(null);
      prisma.policy.findMany.mockResolvedValue([TEST_DB_ROW]);

      const result = await cachedStore.listActive();
      expect(result).toHaveLength(1);
      expect(prisma.policy.findMany).toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining("switchboard:policies:"),
        expect.any(String),
        "EX",
        120,
      );
    });

    it("falls through to DB when redis.get throws", async () => {
      redis.get.mockRejectedValue(new Error("redis down"));
      prisma.policy.findMany.mockResolvedValue([TEST_DB_ROW]);

      const result = await cachedStore.listActive();
      expect(result).toHaveLength(1);
    });

    it("invalidates cache on save", async () => {
      prisma.policy.upsert.mockResolvedValue({});
      redis.del.mockResolvedValue(1);

      await cachedStore.save(TEST_POLICY as any);

      expect(redis.del).toHaveBeenCalledWith(expect.stringContaining("switchboard:policies:"));
    });
  });
});
