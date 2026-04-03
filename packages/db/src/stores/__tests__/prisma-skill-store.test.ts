import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaSkillStore } from "../prisma-skill-store.js";

function makeMockPrisma() {
  return {
    employeeSkill: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

function makeSkillRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    employeeId: "emp-1",
    organizationId: "org-1",
    type: "performance_pattern",
    pattern: "Use emoji in captions for higher engagement",
    evidence: ["post-123 got 2x likes"],
    channel: "instagram",
    version: 1,
    performanceScore: 0.85,
    createdAt: new Date("2026-04-01T00:00:00Z"),
    updatedAt: new Date("2026-04-01T00:00:00Z"),
    ...overrides,
  };
}

describe("PrismaSkillStore", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaSkillStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaSkillStore(prisma as never);
  });

  describe("getRelevant", () => {
    it("queries skills by type ordered by performance score", async () => {
      const rows = [makeSkillRow(), makeSkillRow({ id: "skill-2", performanceScore: 0.7 })];
      prisma.employeeSkill.findMany.mockResolvedValue(rows);

      const result = await store.getRelevant("org-1", "emp-1", "performance_pattern");

      expect(prisma.employeeSkill.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          employeeId: "emp-1",
          type: "performance_pattern",
        },
        orderBy: { performanceScore: "desc" },
        take: 10,
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "skill-1",
        pattern: "Use emoji in captions for higher engagement",
        score: 0.85,
        version: 1,
      });
    });

    it("filters by format (channel) when provided", async () => {
      prisma.employeeSkill.findMany.mockResolvedValue([]);

      await store.getRelevant("org-1", "emp-1", "style_preference", "instagram", 5);

      expect(prisma.employeeSkill.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          employeeId: "emp-1",
          type: "style_preference",
          channel: "instagram",
        },
        orderBy: { performanceScore: "desc" },
        take: 5,
      });
    });
  });

  describe("save", () => {
    it("creates a new skill", async () => {
      await store.save("org-1", "emp-1", {
        type: "performance_pattern",
        pattern: "Short captions outperform long ones",
        evidence: ["post-456 engagement data"],
        channel: "tiktok",
      });

      expect(prisma.employeeSkill.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          employeeId: "emp-1",
          organizationId: "org-1",
          type: "performance_pattern",
          pattern: "Short captions outperform long ones",
          evidence: ["post-456 engagement data"],
          channel: "tiktok",
          version: 1,
          performanceScore: 0,
        }),
      });
    });

    it("defaults channel to null when not provided", async () => {
      await store.save("org-1", "emp-1", {
        type: "rejection",
        pattern: "Avoid controversial topics",
        evidence: ["draft-789 rejected"],
      });

      expect(prisma.employeeSkill.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          channel: null,
        }),
      });
    });
  });

  describe("evolve", () => {
    it("updates pattern, increments version, and merges evidence", async () => {
      const existing = makeSkillRow({
        evidence: ["original-evidence"],
        version: 2,
      });
      prisma.employeeSkill.findFirst.mockResolvedValue(existing);

      await store.evolve("skill-1", "Updated pattern", ["new-evidence-1", "new-evidence-2"]);

      expect(prisma.employeeSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          pattern: "Updated pattern",
          evidence: ["original-evidence", "new-evidence-1", "new-evidence-2"],
          version: 3,
          updatedAt: expect.any(Date),
        },
      });
    });

    it("throws when skill not found", async () => {
      await expect(store.evolve("skill-999", "new pattern", ["evidence"])).rejects.toThrow(
        /not found/,
      );
    });
  });
});
