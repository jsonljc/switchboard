import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaRiskPostureStore } from "../prisma-risk-posture-store.js";

function createMockPrisma() {
  return {
    systemRiskPosture: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };
}

describe("PrismaRiskPostureStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaRiskPostureStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock Prisma client for testing
    store = new PrismaRiskPostureStore(prisma as any);
  });

  describe("get", () => {
    it("returns stored posture", async () => {
      prisma.systemRiskPosture.findUnique.mockResolvedValue({ posture: "elevated" });

      const result = await store.get();
      expect(result).toBe("elevated");
      expect(prisma.systemRiskPosture.findUnique).toHaveBeenCalledWith({
        where: { id: "singleton" },
      });
    });

    it("returns default 'normal' when no row exists", async () => {
      prisma.systemRiskPosture.findUnique.mockResolvedValue(null);

      const result = await store.get();
      expect(result).toBe("normal");
    });
  });

  describe("set", () => {
    it("upserts with singleton key", async () => {
      prisma.systemRiskPosture.upsert.mockResolvedValue({});

      await store.set("elevated");

      expect(prisma.systemRiskPosture.upsert).toHaveBeenCalledWith({
        where: { id: "singleton" },
        create: { id: "singleton", posture: "elevated" },
        update: { posture: "elevated" },
      });
    });
  });
});
