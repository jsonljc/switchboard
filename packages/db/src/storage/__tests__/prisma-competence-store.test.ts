import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCompetenceStore } from "../prisma-competence-store.js";

// Mock matchActionTypePattern used by getPolicy
vi.mock("@switchboard/core", () => ({
  matchActionTypePattern: vi.fn((pattern: string, actionType: string) => {
    // Simple glob match: "ad.*" matches "ad.create"
    if (pattern.endsWith("*")) {
      return actionType.startsWith(pattern.slice(0, -1));
    }
    return pattern === actionType;
  }),
}));

function createMockPrisma() {
  return {
    competenceRecord: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    competencePolicy: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  };
}

const NOW = new Date("2025-01-01");

const TEST_RECORD_ROW = {
  id: "rec_1",
  principalId: "principal_1",
  actionType: "ad.create",
  successCount: 10,
  failureCount: 1,
  rollbackCount: 0,
  consecutiveSuccesses: 5,
  score: 0.9,
  lastActivityAt: NOW,
  lastDecayAppliedAt: NOW,
  history: [{ type: "success", timestamp: NOW.toISOString() }],
  createdAt: NOW,
  updatedAt: NOW,
};

const TEST_POLICY_ROW = {
  id: "cpol_1",
  name: "Ad Policy",
  description: "Policy for ad actions",
  actionTypePattern: "ad.create",
  thresholds: { promotionScore: 0.8, demotionScore: 0.3 },
  enabled: true,
  createdAt: NOW,
  updatedAt: NOW,
};

describe("PrismaCompetenceStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaCompetenceStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock Prisma client for testing
    store = new PrismaCompetenceStore(prisma as any);
  });

  describe("getRecord", () => {
    it("returns competence record when found", async () => {
      prisma.competenceRecord.findUnique.mockResolvedValue(TEST_RECORD_ROW);

      const result = await store.getRecord("principal_1", "ad.create");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("rec_1");
      expect(result!.principalId).toBe("principal_1");
      expect(result!.score).toBe(0.9);
      expect(prisma.competenceRecord.findUnique).toHaveBeenCalledWith({
        where: { principalId_actionType: { principalId: "principal_1", actionType: "ad.create" } },
      });
    });

    it("returns null when not found", async () => {
      prisma.competenceRecord.findUnique.mockResolvedValue(null);

      const result = await store.getRecord("principal_1", "missing");
      expect(result).toBeNull();
    });
  });

  describe("saveRecord", () => {
    it("upserts competence record", async () => {
      prisma.competenceRecord.upsert.mockResolvedValue({});

      const record = {
        id: "rec_1",
        principalId: "principal_1",
        actionType: "ad.create",
        successCount: 10,
        failureCount: 1,
        rollbackCount: 0,
        consecutiveSuccesses: 5,
        score: 0.9,
        lastActivityAt: NOW,
        lastDecayAppliedAt: NOW,
        history: [],
        createdAt: NOW,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test data matches interface
      await store.saveRecord(record as any);

      expect(prisma.competenceRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            principalId_actionType: { principalId: "principal_1", actionType: "ad.create" },
          },
          create: expect.objectContaining({
            id: "rec_1",
            principalId: "principal_1",
            actionType: "ad.create",
            score: 0.9,
          }),
          update: expect.objectContaining({
            score: 0.9,
            successCount: 10,
          }),
        }),
      );
    });
  });

  describe("listRecords", () => {
    it("returns all records for a principal", async () => {
      prisma.competenceRecord.findMany.mockResolvedValue([TEST_RECORD_ROW]);

      const result = await store.listRecords("principal_1");
      expect(result).toHaveLength(1);
      expect(result[0]!.actionType).toBe("ad.create");
      expect(prisma.competenceRecord.findMany).toHaveBeenCalledWith({
        where: { principalId: "principal_1" },
      });
    });
  });

  describe("getPolicy", () => {
    it("returns exact match policy", async () => {
      prisma.competencePolicy.findFirst.mockResolvedValue(TEST_POLICY_ROW);

      const result = await store.getPolicy("ad.create");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("cpol_1");
      expect(result!.name).toBe("Ad Policy");
      expect(prisma.competencePolicy.findFirst).toHaveBeenCalledWith({
        where: { actionTypePattern: "ad.create", enabled: true },
      });
    });

    it("falls back to glob match when no exact match", async () => {
      prisma.competencePolicy.findFirst.mockResolvedValue(null); // no exact match
      prisma.competencePolicy.findMany.mockResolvedValue([
        {
          ...TEST_POLICY_ROW,
          id: "cpol_glob",
          actionTypePattern: "ad.*",
        },
      ]);

      const result = await store.getPolicy("ad.create");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("cpol_glob");
    });

    it("returns null when no matching policy", async () => {
      prisma.competencePolicy.findFirst.mockResolvedValue(null);
      prisma.competencePolicy.findMany.mockResolvedValue([]);

      const result = await store.getPolicy("unknown.action");
      expect(result).toBeNull();
    });
  });

  describe("getDefaultPolicy", () => {
    it("returns default policy (actionTypePattern is null)", async () => {
      const defaultRow = { ...TEST_POLICY_ROW, id: "cpol_default", actionTypePattern: null };
      prisma.competencePolicy.findFirst.mockResolvedValue(defaultRow);

      const result = await store.getDefaultPolicy();
      expect(result).not.toBeNull();
      expect(result!.id).toBe("cpol_default");
      expect(result!.actionTypePattern).toBeNull();
      expect(prisma.competencePolicy.findFirst).toHaveBeenCalledWith({
        where: { actionTypePattern: null, enabled: true },
      });
    });

    it("returns null when no default policy exists", async () => {
      prisma.competencePolicy.findFirst.mockResolvedValue(null);

      const result = await store.getDefaultPolicy();
      expect(result).toBeNull();
    });
  });

  describe("savePolicy", () => {
    it("upserts competence policy", async () => {
      prisma.competencePolicy.upsert.mockResolvedValue({});

      const policy = {
        id: "cpol_1",
        name: "Ad Policy",
        description: "Policy for ad actions",
        actionTypePattern: "ad.create",
        thresholds: { promotionScore: 0.8, demotionScore: 0.3 },
        enabled: true,
        createdAt: NOW,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test data matches interface
      await store.savePolicy(policy as any);

      expect(prisma.competencePolicy.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cpol_1" },
          create: expect.objectContaining({
            id: "cpol_1",
            name: "Ad Policy",
            actionTypePattern: "ad.create",
            enabled: true,
          }),
          update: expect.objectContaining({
            name: "Ad Policy",
            actionTypePattern: "ad.create",
            enabled: true,
          }),
        }),
      );
    });
  });

  describe("listPolicies", () => {
    it("returns all policies", async () => {
      prisma.competencePolicy.findMany.mockResolvedValue([TEST_POLICY_ROW]);

      const result = await store.listPolicies();
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("Ad Policy");
      expect(prisma.competencePolicy.findMany).toHaveBeenCalled();
    });
  });
});
