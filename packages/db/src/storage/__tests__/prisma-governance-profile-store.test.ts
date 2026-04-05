import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaGovernanceProfileStore } from "../prisma-governance-profile-store.js";

function createMockPrisma() {
  return {
    organizationConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };
}

describe("PrismaGovernanceProfileStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaGovernanceProfileStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock Prisma client for testing
    store = new PrismaGovernanceProfileStore(prisma as any);
  });

  describe("get", () => {
    it("returns 'guarded' for null orgId", async () => {
      const result = await store.get(null);
      expect(result).toBe("guarded");
      expect(prisma.organizationConfig.findUnique).not.toHaveBeenCalled();
    });

    it("returns 'guarded' when no config found", async () => {
      prisma.organizationConfig.findUnique.mockResolvedValue(null);

      const result = await store.get("org_1");
      expect(result).toBe("guarded");
      expect(prisma.organizationConfig.findUnique).toHaveBeenCalledWith({
        where: { id: "org_1" },
        select: { governanceProfile: true },
      });
    });

    it("returns stored profile", async () => {
      prisma.organizationConfig.findUnique.mockResolvedValue({
        governanceProfile: "strict",
      });

      const result = await store.get("org_1");
      expect(result).toBe("strict");
    });
  });

  describe("set", () => {
    it("no-op for null orgId", async () => {
      await store.set(null, "strict");
      expect(prisma.organizationConfig.upsert).not.toHaveBeenCalled();
    });

    it("calls upsert with correct create/update", async () => {
      prisma.organizationConfig.upsert.mockResolvedValue({});

      await store.set("org_1", "strict");
      expect(prisma.organizationConfig.upsert).toHaveBeenCalledWith({
        where: { id: "org_1" },
        create: {
          id: "org_1",
          name: "",
          governanceProfile: "strict",
        },
        update: {
          governanceProfile: "strict",
        },
      });
    });
  });

  describe("getConfig", () => {
    it("returns null for null orgId", async () => {
      const result = await store.getConfig(null);
      expect(result).toBeNull();
      expect(prisma.organizationConfig.findUnique).not.toHaveBeenCalled();
    });

    it("returns null when no config found", async () => {
      prisma.organizationConfig.findUnique.mockResolvedValue(null);

      const result = await store.getConfig("org_1");
      expect(result).toBeNull();
    });

    it("returns {profile}", async () => {
      prisma.organizationConfig.findUnique.mockResolvedValue({
        governanceProfile: "guarded",
      });

      const result = await store.getConfig("org_1");
      expect(result).toEqual({ profile: "guarded" });
    });
  });

  describe("setConfig", () => {
    it("no-op for null orgId", async () => {
      await store.setConfig(null, { profile: "guarded" });
      expect(prisma.organizationConfig.upsert).not.toHaveBeenCalled();
    });

    it("upserts with correct data", async () => {
      prisma.organizationConfig.upsert.mockResolvedValue({});

      await store.setConfig("org_1", {
        profile: "observe",
      });

      expect(prisma.organizationConfig.upsert).toHaveBeenCalledWith({
        where: { id: "org_1" },
        create: {
          id: "org_1",
          name: "",
          governanceProfile: "observe",
        },
        update: {
          governanceProfile: "observe",
        },
      });
    });
  });
});
