import { describe, it, expect } from "vitest";
import { AccountProfileManager } from "../account-profile.js";
import { InMemoryAccountProfileStore } from "../../stores/in-memory.js";
import type {
  AccountLearningProfile,
  CreativeAssetSummary,
  Intervention,
} from "@switchboard/schemas";

function makeProfile(overrides: Partial<AccountLearningProfile> = {}): AccountLearningProfile {
  return {
    accountId: "acct-1",
    organizationId: "org-1",
    creativePatterns: [],
    constraintHistory: [],
    calibration: {},
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeIntervention(overrides: Partial<Intervention> = {}): Intervention {
  return {
    id: crypto.randomUUID(),
    cycleId: "cycle-1",
    constraintType: "SIGNAL",
    actionType: "FIX_TRACKING",
    status: "EXECUTED",
    priority: 1,
    estimatedImpact: "HIGH",
    reasoning: "score 20/60",
    artifacts: [],
    outcomeStatus: "IMPROVED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("AccountProfileManager", () => {
  const manager = new AccountProfileManager();

  describe("getOrCreate", () => {
    it("creates a default profile when none exists", async () => {
      const store = new InMemoryAccountProfileStore();
      const profile = await manager.getOrCreate("acct-1", "org-1", {
        accountProfileStore: store,
      });

      expect(profile.accountId).toBe("acct-1");
      expect(profile.organizationId).toBe("org-1");
      expect(profile.creativePatterns).toEqual([]);
      expect(profile.constraintHistory).toEqual([]);
      expect(profile.calibration).toEqual({});
    });

    it("returns existing profile when one exists", async () => {
      const store = new InMemoryAccountProfileStore();
      const existing = makeProfile({ accountId: "acct-1" });
      await store.save(existing);

      const profile = await manager.getOrCreate("acct-1", "org-1", {
        accountProfileStore: store,
      });

      expect(profile).toEqual(existing);
    });
  });

  describe("updateCreativePatterns", () => {
    it("returns unchanged profile when creativeAssets is null", () => {
      const profile = makeProfile();
      const result = manager.updateCreativePatterns(profile, null);
      expect(result.creativePatterns).toEqual([]);
    });

    it("derives patterns from creative asset summary", () => {
      const profile = makeProfile();
      const assets: CreativeAssetSummary = {
        totalAssets: 20,
        activeAssets: 15,
        averageScore: 70,
        fatigueRate: 0.2,
        topPerformerCount: 5,
        bottomPerformerCount: 3,
        diversityScore: 60,
      };

      const result = manager.updateCreativePatterns(profile, assets);

      expect(result.creativePatterns.length).toBeGreaterThan(0);
      expect(result.creativePatterns.find((p) => p.format === "top-performer")).toBeDefined();
      expect(result.creativePatterns.find((p) => p.format === "portfolio-diversity")).toBeDefined();
      expect(result.creativePatterns.find((p) => p.format === "fatigue-resistance")).toBeDefined();
    });

    it("skips patterns when no active assets", () => {
      const profile = makeProfile();
      const assets: CreativeAssetSummary = {
        totalAssets: 0,
        activeAssets: 0,
        averageScore: null,
        fatigueRate: null,
        topPerformerCount: 0,
        bottomPerformerCount: 0,
        diversityScore: null,
      };

      const result = manager.updateCreativePatterns(profile, assets);
      expect(result.creativePatterns).toEqual([]);
    });
  });

  describe("updateConstraintHistory", () => {
    it("starts a new constraint entry", () => {
      const profile = makeProfile();
      const result = manager.updateConstraintHistory(profile, "SIGNAL", null);

      expect(result.constraintHistory).toHaveLength(1);
      expect(result.constraintHistory[0]!.constraintType).toBe("SIGNAL");
      expect(result.constraintHistory[0]!.cycleCount).toBe(1);
      expect(result.constraintHistory[0]!.endedAt).toBeNull();
    });

    it("increments cycle count for same constraint", () => {
      const profile = makeProfile({
        constraintHistory: [
          {
            constraintType: "SIGNAL",
            startedAt: "2025-01-01T00:00:00Z",
            endedAt: null,
            cycleCount: 2,
          },
        ],
      });

      const result = manager.updateConstraintHistory(profile, "SIGNAL", "SIGNAL");

      expect(result.constraintHistory).toHaveLength(1);
      expect(result.constraintHistory[0]!.cycleCount).toBe(3);
    });

    it("closes previous and opens new on constraint transition", () => {
      const profile = makeProfile({
        constraintHistory: [
          {
            constraintType: "SIGNAL",
            startedAt: "2025-01-01T00:00:00Z",
            endedAt: null,
            cycleCount: 3,
          },
        ],
      });

      const result = manager.updateConstraintHistory(profile, "CREATIVE", "SIGNAL");

      expect(result.constraintHistory).toHaveLength(2);
      // Old entry should be closed
      const signalEntry = result.constraintHistory.find((h) => h.constraintType === "SIGNAL");
      expect(signalEntry!.endedAt).not.toBeNull();
      // New entry should be open
      const creativeEntry = result.constraintHistory.find((h) => h.constraintType === "CREATIVE");
      expect(creativeEntry!.endedAt).toBeNull();
      expect(creativeEntry!.cycleCount).toBe(1);
    });

    it("handles null current constraint (no binding constraint)", () => {
      const profile = makeProfile({
        constraintHistory: [
          {
            constraintType: "SIGNAL",
            startedAt: "2025-01-01T00:00:00Z",
            endedAt: null,
            cycleCount: 2,
          },
        ],
      });

      const result = manager.updateConstraintHistory(profile, null, "SIGNAL");

      // Previous should be closed, no new entry added
      expect(result.constraintHistory).toHaveLength(1);
      expect(result.constraintHistory[0]!.endedAt).not.toBeNull();
    });
  });

  describe("updateCalibration", () => {
    it("updates calibration from intervention history", () => {
      const profile = makeProfile();
      const interventions: Intervention[] = [
        makeIntervention({ constraintType: "SIGNAL", outcomeStatus: "IMPROVED" }),
        makeIntervention({ constraintType: "SIGNAL", outcomeStatus: "NO_CHANGE" }),
        makeIntervention({ constraintType: "CREATIVE", outcomeStatus: "IMPROVED" }),
      ];

      const result = manager.updateCalibration(profile, interventions);

      expect(result.calibration["SIGNAL"]).toBeDefined();
      expect(result.calibration["SIGNAL"]!.successRate).toBe(0.5);
      expect(result.calibration["SIGNAL"]!.totalCount).toBe(2);
      expect(result.calibration["CREATIVE"]).toBeDefined();
      expect(result.calibration["CREATIVE"]!.successRate).toBe(1);
    });

    it("handles empty intervention list", () => {
      const profile = makeProfile();
      const result = manager.updateCalibration(profile, []);
      expect(result.calibration).toEqual({});
    });
  });
});
