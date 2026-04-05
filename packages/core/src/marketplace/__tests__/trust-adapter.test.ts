import { describe, it, expect } from "vitest";
import { TrustScoreAdapter, applyAutonomyToRiskTolerance } from "../trust-adapter.js";
import type { ResolvedIdentity } from "../../identity/spec.js";
import type { TrustScoreStore } from "../trust-score-engine.js";
import { TrustScoreEngine } from "../trust-score-engine.js";

function makeIdentity(overrides?: Partial<ResolvedIdentity>): ResolvedIdentity {
  return {
    spec: {
      id: "spec_1",
      principalId: "agent_1",
      organizationId: "org_1",
      name: "Test Agent",
      description: "Test agent for trust adapter tests",
      riskTolerance: {
        none: "none",
        low: "none",
        medium: "standard",
        high: "elevated",
        critical: "mandatory",
      },
      globalSpendLimits: { perAction: null, daily: null, weekly: null, monthly: null },
      cartridgeSpendLimits: {},
      forbiddenBehaviors: [],
      trustBehaviors: [],
      delegatedApprovers: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    activeOverlays: [],
    effectiveRiskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    effectiveSpendLimits: { perAction: null, daily: null, weekly: null, monthly: null },
    effectiveForbiddenBehaviors: [],
    effectiveTrustBehaviors: [],
    delegatedApprovers: [],
    ...overrides,
  };
}

describe("applyAutonomyToRiskTolerance", () => {
  it("returns identity unchanged for supervised level", () => {
    const identity = makeIdentity();
    const result = applyAutonomyToRiskTolerance(identity, "supervised");
    expect(result.effectiveRiskTolerance).toEqual(identity.effectiveRiskTolerance);
  });

  it("relaxes low risk to none for guided level", () => {
    const identity = makeIdentity();
    const result = applyAutonomyToRiskTolerance(identity, "guided");
    expect(result.effectiveRiskTolerance.low).toBe("none");
  });

  it("relaxes medium risk to none for autonomous level", () => {
    const identity = makeIdentity();
    const result = applyAutonomyToRiskTolerance(identity, "autonomous");
    expect(result.effectiveRiskTolerance.medium).toBe("none");
  });

  it("never relaxes critical risk regardless of autonomy", () => {
    const identity = makeIdentity();
    const result = applyAutonomyToRiskTolerance(identity, "autonomous");
    expect(result.effectiveRiskTolerance.critical).toBe("mandatory");
  });

  it("never relaxes high risk below standard for autonomous", () => {
    const identity = makeIdentity();
    const result = applyAutonomyToRiskTolerance(identity, "autonomous");
    expect(result.effectiveRiskTolerance.high).toBe("standard");
  });

  it("relaxes low and medium for autonomous level", () => {
    const identity = makeIdentity();
    const result = applyAutonomyToRiskTolerance(identity, "autonomous");
    expect(result.effectiveRiskTolerance.low).toBe("none");
    expect(result.effectiveRiskTolerance.medium).toBe("none");
  });

  it("preserves all other identity fields", () => {
    const identity = makeIdentity({
      effectiveForbiddenBehaviors: ["forbidden_action"],
      effectiveTrustBehaviors: ["trusted_action"],
      delegatedApprovers: ["approver_1"],
    });
    const result = applyAutonomyToRiskTolerance(identity, "autonomous");
    expect(result.effectiveForbiddenBehaviors).toEqual(["forbidden_action"]);
    expect(result.effectiveTrustBehaviors).toEqual(["trusted_action"]);
    expect(result.delegatedApprovers).toEqual(["approver_1"]);
  });
});

describe("TrustScoreAdapter", () => {
  function createMockStore(): TrustScoreStore {
    const records = new Map<
      string,
      {
        id: string;
        listingId: string;
        taskCategory: string;
        score: number;
        totalApprovals: number;
        totalRejections: number;
        consecutiveApprovals: number;
        lastActivityAt: Date;
        createdAt: Date;
        updatedAt: Date;
      }
    >();
    return {
      getOrCreate: async (listingId: string, taskCategory: string) => {
        const key = `${listingId}:${taskCategory}`;
        if (!records.has(key)) {
          const now = new Date();
          records.set(key, {
            id: key,
            listingId,
            taskCategory,
            score: 50,
            totalApprovals: 0,
            totalRejections: 0,
            consecutiveApprovals: 0,
            lastActivityAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }
        return records.get(key)!;
      },
      update: async (id: string, data: Record<string, unknown>) => {
        const record = records.get(id);
        if (!record) throw new Error("not found");
        Object.assign(record, data);
        return record;
      },
      listByListing: async (listingId: string) =>
        [...records.values()].filter((r) => r.listingId === listingId),
      getAggregateScore: async () => 50,
    };
  }

  it("adjusts identity when principal maps to a listing", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);
    const resolver = async (_principalId: string) => ({
      listingId: "lst_1",
      taskCategory: "email",
    });
    const adapter = new TrustScoreAdapter(engine, resolver);

    const identity = makeIdentity();
    const result = await adapter.adjustIdentity("agent_1", "send_email", identity);

    // Default score 50 → guided → should relax low risk
    expect(result.effectiveRiskTolerance.low).toBe("none");
  });

  it("returns identity unchanged when principal has no listing", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);
    const resolver = async (_principalId: string) => null;
    const adapter = new TrustScoreAdapter(engine, resolver);

    const identity = makeIdentity();
    const result = await adapter.adjustIdentity("user_1", "send_email", identity);

    expect(result).toEqual(identity);
  });

  it("records approval via adapter", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);
    const resolver = async (_principalId: string) => ({
      listingId: "lst_1",
      taskCategory: "email",
    });
    const adapter = new TrustScoreAdapter(engine, resolver);

    await adapter.recordApproval("agent_1", "send_email");
    const record = await store.getOrCreate("lst_1", "email");
    expect(record.totalApprovals).toBe(1);
  });

  it("records rejection via adapter", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);
    const resolver = async (_principalId: string) => ({
      listingId: "lst_1",
      taskCategory: "email",
    });
    const adapter = new TrustScoreAdapter(engine, resolver);

    await adapter.recordRejection("agent_1", "send_email");
    const record = await store.getOrCreate("lst_1", "email");
    expect(record.totalRejections).toBe(1);
  });

  it("silently skips when principal has no listing on record/reject", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);
    const resolver = async (_principalId: string) => null;
    const adapter = new TrustScoreAdapter(engine, resolver);

    // Should not throw
    await adapter.recordApproval("user_1", "send_email");
    await adapter.recordRejection("user_1", "send_email");
  });

  it("uses resolver parameters to determine mapping", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);
    const resolver = async (principalId: string, actionType?: string) => {
      if (principalId === "agent_1" && actionType === "send_email") {
        return { listingId: "lst_1", taskCategory: "email" };
      }
      return null;
    };
    const adapter = new TrustScoreAdapter(engine, resolver);

    const identity = makeIdentity();

    // Should map
    const result1 = await adapter.adjustIdentity("agent_1", "send_email", identity);
    expect(result1.effectiveRiskTolerance.low).toBe("none");

    // Should not map
    const result2 = await adapter.adjustIdentity("agent_1", "send_sms", identity);
    expect(result2).toEqual(identity);
  });
});
