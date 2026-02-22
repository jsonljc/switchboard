import { describe, it, expect, beforeEach } from "vitest";
import { CompetenceTracker, DEFAULT_COMPETENCE_THRESHOLDS } from "../competence/index.js";
import { InMemoryCompetenceStore } from "../storage/in-memory.js";
import { AuditLedger, InMemoryLedgerStorage } from "../audit/ledger.js";
import { applyCompetenceAdjustments } from "../identity/spec.js";
import type { ResolvedIdentity } from "../identity/spec.js";
import type { CompetenceStore } from "../storage/interfaces.js";
import type { IdentitySpec, CompetencePolicy } from "@switchboard/schemas";

function makeResolvedIdentity(overrides?: Partial<ResolvedIdentity>): ResolvedIdentity {
  const now = new Date();
  const spec: IdentitySpec = {
    id: "spec_1",
    principalId: "agent_1",
    organizationId: null,
    name: "Test Agent",
    description: "Test identity",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: 10000, weekly: null, monthly: null, perAction: 5000 },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    createdAt: now,
    updatedAt: now,
  };

  return {
    spec,
    activeOverlays: [],
    effectiveRiskTolerance: { ...spec.riskTolerance },
    effectiveSpendLimits: { ...spec.globalSpendLimits },
    effectiveForbiddenBehaviors: [],
    effectiveTrustBehaviors: [],
    ...overrides,
  };
}

describe("CompetenceTracker", () => {
  let store: CompetenceStore;
  let ledger: AuditLedger;
  let tracker: CompetenceTracker;

  beforeEach(() => {
    store = new InMemoryCompetenceStore();
    const ledgerStorage = new InMemoryLedgerStorage();
    ledger = new AuditLedger(ledgerStorage);
    tracker = new CompetenceTracker(store, ledger);
  });

  describe("recordSuccess", () => {
    it("should increment score with streak bonus", async () => {
      await tracker.recordSuccess("agent_1", "ads.campaign.pause");
      const adj = await tracker.getAdjustment("agent_1", "ads.campaign.pause");

      expect(adj).not.toBeNull();
      // First success: base 3 + streak bonus min(1 * 0.5, 5) = 3.5
      expect(adj!.score).toBe(3.5);
      expect(adj!.record.successCount).toBe(1);
      expect(adj!.record.consecutiveSuccesses).toBe(1);

      // Second success: 3.5 + 3 + min(2 * 0.5, 5) = 3.5 + 3 + 1 = 7.5
      await tracker.recordSuccess("agent_1", "ads.campaign.pause");
      const adj2 = await tracker.getAdjustment("agent_1", "ads.campaign.pause");
      expect(adj2!.score).toBe(7.5);
      expect(adj2!.record.consecutiveSuccesses).toBe(2);
    });
  });

  describe("recordFailure", () => {
    it("should decrement score and reset streak", async () => {
      // Build up some score first
      for (let i = 0; i < 5; i++) {
        await tracker.recordSuccess("agent_1", "ads.campaign.pause");
      }

      const beforeFailure = await tracker.getAdjustment("agent_1", "ads.campaign.pause");
      expect(beforeFailure!.record.consecutiveSuccesses).toBe(5);

      await tracker.recordFailure("agent_1", "ads.campaign.pause");

      const afterFailure = await tracker.getAdjustment("agent_1", "ads.campaign.pause");
      expect(afterFailure!.record.consecutiveSuccesses).toBe(0);
      expect(afterFailure!.record.failureCount).toBe(1);
      expect(afterFailure!.score).toBe(beforeFailure!.score - 10);
    });
  });

  describe("recordRollback", () => {
    it("should decrement score more heavily and reset streak", async () => {
      // Build up some score first
      for (let i = 0; i < 8; i++) {
        await tracker.recordSuccess("agent_1", "ads.campaign.pause");
      }

      const beforeRollback = await tracker.getAdjustment("agent_1", "ads.campaign.pause");

      await tracker.recordRollback("agent_1", "ads.campaign.pause");

      const afterRollback = await tracker.getAdjustment("agent_1", "ads.campaign.pause");
      expect(afterRollback!.record.consecutiveSuccesses).toBe(0);
      expect(afterRollback!.record.rollbackCount).toBe(1);
      expect(afterRollback!.score).toBe(beforeRollback!.score - 15);
    });
  });

  describe("score bounds", () => {
    it("should never exceed ceiling (100) or go below floor (0)", async () => {
      // Try to go above 100 - lots of successes
      for (let i = 0; i < 50; i++) {
        await tracker.recordSuccess("agent_1", "ads.campaign.pause");
      }
      const high = await tracker.getAdjustment("agent_1", "ads.campaign.pause");
      expect(high!.score).toBeLessThanOrEqual(100);

      // Try to go below 0 - lots of failures
      for (let i = 0; i < 20; i++) {
        await tracker.recordFailure("agent_1", "ads.campaign.pause");
      }
      const low = await tracker.getAdjustment("agent_1", "ads.campaign.pause");
      expect(low!.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe("lazy decay", () => {
    it("should reduce score at read time without persisting", async () => {
      // Build up score
      for (let i = 0; i < 10; i++) {
        await tracker.recordSuccess("agent_1", "ads.campaign.pause");
      }

      const current = await tracker.getAdjustment("agent_1", "ads.campaign.pause");
      expect(current!.score).toBeGreaterThan(0);

      // Simulate 5 days passing
      const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const decayed = await tracker.getAdjustment("agent_1", "ads.campaign.pause", future);

      // 5 days * 2 points/day = 10 points decay
      expect(decayed!.score).toBe(current!.score - 10);

      // But the stored record should NOT have changed (lazy - not persisted)
      const raw = await store.getRecord("agent_1", "ads.campaign.pause");
      expect(raw!.score).toBe(current!.score);
    });
  });

  describe("promotion event", () => {
    it("should be recorded when crossing threshold", async () => {
      // We need score >= 80 AND >= 10 successes
      // Each success gives 3 + streak bonus (min(n*0.5, 5))
      // Sum for 25 successes: enough to exceed 80
      for (let i = 0; i < 25; i++) {
        await tracker.recordSuccess("agent_1", "ads.campaign.pause");
      }

      const adj = await tracker.getAdjustment("agent_1", "ads.campaign.pause");
      expect(adj!.shouldTrust).toBe(true);
      expect(adj!.record.successCount).toBeGreaterThanOrEqual(10);
      expect(adj!.score).toBeGreaterThanOrEqual(80);

      // Check history has a promotion event
      const promoted = adj!.record.history.find((e) => e.type === "promoted");
      expect(promoted).toBeDefined();
    });
  });

  describe("demotion event", () => {
    it("should be recorded when score drops below 40", async () => {
      // Build up to just above 40
      for (let i = 0; i < 15; i++) {
        await tracker.recordSuccess("agent_1", "ads.campaign.pause");
      }

      const before = await tracker.getAdjustment("agent_1", "ads.campaign.pause");
      expect(before!.score).toBeGreaterThanOrEqual(40);

      // Cause failures to drop below 40
      // Each failure is -10, so a few should be enough
      while (true) {
        const current = await tracker.getAdjustment("agent_1", "ads.campaign.pause");
        if (current!.score < 40) break;
        await tracker.recordFailure("agent_1", "ads.campaign.pause");
      }

      const after = await tracker.getAdjustment("agent_1", "ads.campaign.pause");
      expect(after!.shouldEscalate).toBe(true);

      const demoted = after!.record.history.find((e) => e.type === "demoted");
      expect(demoted).toBeDefined();
    });
  });

  describe("action-type-specific policy", () => {
    it("should override defaults", async () => {
      const now = new Date();
      const customPolicy: CompetencePolicy = {
        id: "policy_custom",
        name: "Custom Ads Policy",
        description: "Custom thresholds for ads actions",
        actionTypePattern: "ads.*",
        thresholds: {
          ...DEFAULT_COMPETENCE_THRESHOLDS,
          successPoints: 10, // Much higher success points
          promotionScore: 30, // Lower promotion threshold
          promotionMinSuccesses: 3,
        },
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
      await store.savePolicy(customPolicy);

      // With 10 points per success + streak bonus, 3 successes should promote
      for (let i = 0; i < 4; i++) {
        await tracker.recordSuccess("agent_1", "ads.campaign.pause");
      }

      const adj = await tracker.getAdjustment("agent_1", "ads.campaign.pause");
      expect(adj!.shouldTrust).toBe(true);
      expect(adj!.score).toBeGreaterThanOrEqual(30);
    });
  });

  describe("getAdjustment for unknown principal/action", () => {
    it("should return null", async () => {
      const adj = await tracker.getAdjustment("unknown_agent", "unknown.action");
      expect(adj).toBeNull();
    });
  });
});

describe("applyCompetenceAdjustments", () => {
  it("should add trusted action to effectiveTrustBehaviors", () => {
    const identity = makeResolvedIdentity();
    const adj = {
      principalId: "agent_1",
      actionType: "ads.campaign.pause",
      score: 85,
      shouldTrust: true,
      shouldEscalate: false,
      record: {
        id: "rec_1",
        principalId: "agent_1",
        actionType: "ads.campaign.pause",
        successCount: 12,
        failureCount: 0,
        rollbackCount: 0,
        consecutiveSuccesses: 12,
        score: 85,
        lastActivityAt: new Date(),
        lastDecayAppliedAt: new Date(),
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };

    const result = applyCompetenceAdjustments(identity, [adj]);
    expect(result.effectiveTrustBehaviors).toContain("ads.campaign.pause");
  });

  it("should NOT add if action is in effectiveForbiddenBehaviors", () => {
    const identity = makeResolvedIdentity({
      effectiveForbiddenBehaviors: ["ads.campaign.pause"],
    });
    const adj = {
      principalId: "agent_1",
      actionType: "ads.campaign.pause",
      score: 85,
      shouldTrust: true,
      shouldEscalate: false,
      record: {
        id: "rec_1",
        principalId: "agent_1",
        actionType: "ads.campaign.pause",
        successCount: 12,
        failureCount: 0,
        rollbackCount: 0,
        consecutiveSuccesses: 12,
        score: 85,
        lastActivityAt: new Date(),
        lastDecayAppliedAt: new Date(),
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };

    const result = applyCompetenceAdjustments(identity, [adj]);
    expect(result.effectiveTrustBehaviors).not.toContain("ads.campaign.pause");
  });

  it("should NOT duplicate if action already trusted", () => {
    const identity = makeResolvedIdentity({
      effectiveTrustBehaviors: ["ads.campaign.pause"],
    });
    const adj = {
      principalId: "agent_1",
      actionType: "ads.campaign.pause",
      score: 85,
      shouldTrust: true,
      shouldEscalate: false,
      record: {
        id: "rec_1",
        principalId: "agent_1",
        actionType: "ads.campaign.pause",
        successCount: 12,
        failureCount: 0,
        rollbackCount: 0,
        consecutiveSuccesses: 12,
        score: 85,
        lastActivityAt: new Date(),
        lastDecayAppliedAt: new Date(),
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };

    const result = applyCompetenceAdjustments(identity, [adj]);
    const count = result.effectiveTrustBehaviors.filter((b) => b === "ads.campaign.pause").length;
    expect(count).toBe(1);
  });
});
