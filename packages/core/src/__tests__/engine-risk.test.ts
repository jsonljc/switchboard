import { describe, it, expect } from "vitest";

import {
  computeRiskScore,
  DEFAULT_RISK_CONFIG,
  resolveIdentity,
  getActiveOverlays,
  createGuardrailState,
} from "../index.js";

import type { RiskInput, IdentitySpec, RoleOverlay } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRiskInput(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    baseRisk: "low",
    exposure: { dollarsAtRisk: 0, blastRadius: 1 },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    ...overrides,
  };
}

function makeBaseIdentitySpec(overrides: Partial<IdentitySpec> = {}): IdentitySpec {
  return {
    id: "spec-1",
    principalId: "user-1",
    organizationId: "org-1",
    name: "Test Agent",
    description: "A test identity spec",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: {
      daily: 10000,
      weekly: 50000,
      monthly: 200000,
      perAction: 5000,
    },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: ["account.delete"],
    trustBehaviors: ["campaign.read"],
    delegatedApprovers: [],
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

function makeOverlay(overrides: Partial<RoleOverlay> = {}): RoleOverlay {
  return {
    id: "overlay-1",
    identitySpecId: "spec-1",
    name: "Test Overlay",
    description: "A test overlay",
    mode: "restrict",
    priority: 0,
    active: true,
    conditions: {},
    overrides: {},
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

// ===================================================================
// RISK SCORER
// ===================================================================

describe("Risk Scorer", () => {
  it("base risk contribution only", () => {
    const input = makeRiskInput({ baseRisk: "medium" });
    const result = computeRiskScore(input);
    const baseFactor = result.factors.find((f) => f.factor === "base_risk");
    expect(baseFactor?.contribution).toBe(DEFAULT_RISK_CONFIG.baseWeights.medium);
    expect(result.rawScore).toBeGreaterThanOrEqual(35);
  });

  it("dollar exposure contribution", () => {
    const input = makeRiskInput({
      baseRisk: "none",
      exposure: { dollarsAtRisk: 5000, blastRadius: 1 },
    });
    const result = computeRiskScore(input);
    const dollarFactor = result.factors.find((f) => f.factor === "dollars_at_risk");
    // 5000/10000 * 20 = 10
    expect(dollarFactor?.contribution).toBe(10);
  });

  it("blast radius contribution (logarithmic)", () => {
    const input = makeRiskInput({
      baseRisk: "none",
      exposure: { dollarsAtRisk: 0, blastRadius: 8 },
    });
    const result = computeRiskScore(input);
    const blastFactor = result.factors.find((f) => f.factor === "blast_radius");
    // log2(8) = 3, weight=10, contribution = 10*3 = 30, capped at 20
    expect(blastFactor).toBeDefined();
    expect(blastFactor!.contribution).toBe(20); // capped at blastRadiusWeight * 2
  });

  it("irreversibility penalty: none -> full penalty", () => {
    const input = makeRiskInput({ baseRisk: "none", reversibility: "none" });
    const result = computeRiskScore(input);
    const irrevFactor = result.factors.find((f) => f.factor === "irreversibility");
    expect(irrevFactor?.contribution).toBe(DEFAULT_RISK_CONFIG.irreversibilityPenalty);
  });

  it("irreversibility penalty: partial -> half penalty", () => {
    const input = makeRiskInput({ baseRisk: "none", reversibility: "partial" });
    const result = computeRiskScore(input);
    const partialFactor = result.factors.find((f) => f.factor === "partial_reversibility");
    expect(partialFactor?.contribution).toBe(DEFAULT_RISK_CONFIG.irreversibilityPenalty * 0.5);
  });

  it("irreversibility: full -> no penalty", () => {
    const input = makeRiskInput({ baseRisk: "none", reversibility: "full" });
    const result = computeRiskScore(input);
    const irrevFactor = result.factors.find(
      (f) => f.factor === "irreversibility" || f.factor === "partial_reversibility",
    );
    expect(irrevFactor).toBeUndefined();
  });

  it("full scoring with all sensitivity flags", () => {
    const input = makeRiskInput({
      baseRisk: "high",
      exposure: { dollarsAtRisk: 10000, blastRadius: 4 },
      reversibility: "none",
      sensitivity: { entityVolatile: true, learningPhase: true, recentlyModified: true },
    });
    const result = computeRiskScore(input);
    expect(result.factors.some((f) => f.factor === "entity_volatile")).toBe(true);
    expect(result.factors.some((f) => f.factor === "learning_phase")).toBe(true);
    expect(result.factors.some((f) => f.factor === "recently_modified")).toBe(true);
    // Score should be very high with all penalties
    expect(result.rawScore).toBeGreaterThan(80);
  });

  it("score capping at 100", () => {
    const input = makeRiskInput({
      baseRisk: "critical",
      exposure: { dollarsAtRisk: 100000, blastRadius: 1024 },
      reversibility: "none",
      sensitivity: { entityVolatile: true, learningPhase: true, recentlyModified: true },
    });
    const result = computeRiskScore(input);
    expect(result.rawScore).toBeLessThanOrEqual(100);
    expect(result.rawScore).toBe(100);
  });

  it("category mapping: 0-20=none, 21-40=low, 41-60=medium, 61-80=high, 81-100=critical", () => {
    // none: baseRisk "none" = 0 score
    const noneResult = computeRiskScore(makeRiskInput({ baseRisk: "none" }));
    expect(noneResult.category).toBe("none");

    // low: baseRisk "low" = 15 score
    const lowResult = computeRiskScore(makeRiskInput({ baseRisk: "low" }));
    expect(lowResult.category).toBe("none"); // 15 <= 20 => "none"

    // medium: baseRisk "medium" = 35 score
    const medResult = computeRiskScore(makeRiskInput({ baseRisk: "medium" }));
    expect(medResult.category).toBe("low"); // 35 is in 21-40 range

    // high: baseRisk "high" = 55 score
    const highResult = computeRiskScore(makeRiskInput({ baseRisk: "high" }));
    expect(highResult.category).toBe("medium"); // 55 is in 41-60 range

    // critical: baseRisk "critical" = 80 score
    const critResult = computeRiskScore(makeRiskInput({ baseRisk: "critical" }));
    expect(critResult.category).toBe("high"); // 80 is in 61-80 range
  });
});

// ===================================================================
// IDENTITY + OVERLAY MERGING
// ===================================================================

describe("Identity + Overlay Merging", () => {
  it("base identity without overlays", () => {
    const spec = makeBaseIdentitySpec();
    const result = resolveIdentity(spec, [], {});
    expect(result.effectiveRiskTolerance).toEqual(spec.riskTolerance);
    expect(result.effectiveSpendLimits).toEqual(spec.globalSpendLimits);
    expect(result.effectiveForbiddenBehaviors).toEqual(["account.delete"]);
    expect(result.effectiveTrustBehaviors).toEqual(["campaign.read"]);
    expect(result.activeOverlays).toHaveLength(0);
  });

  it("restrictive overlay merging: takes more restrictive approval requirement", () => {
    const spec = makeBaseIdentitySpec({
      riskTolerance: {
        none: "none",
        low: "none",
        medium: "standard",
        high: "elevated",
        critical: "mandatory",
      },
    });
    const overlay = makeOverlay({
      mode: "restrict",
      overrides: {
        riskTolerance: {
          none: "none",
          low: "standard", // more restrictive than "none"
          medium: "elevated", // more restrictive than "standard"
          high: "mandatory", // more restrictive than "elevated"
          critical: "mandatory",
        },
      },
    });
    const result = resolveIdentity(spec, [overlay], {});
    expect(result.effectiveRiskTolerance.low).toBe("standard");
    expect(result.effectiveRiskTolerance.medium).toBe("elevated");
    expect(result.effectiveRiskTolerance.high).toBe("mandatory");
  });

  it("permissive overlay merging: takes less restrictive approval requirement", () => {
    const spec = makeBaseIdentitySpec({
      riskTolerance: {
        none: "none",
        low: "standard",
        medium: "elevated",
        high: "mandatory",
        critical: "mandatory",
      },
    });
    const overlay = makeOverlay({
      mode: "extend",
      overrides: {
        riskTolerance: {
          none: "none",
          low: "none", // less restrictive
          medium: "standard", // less restrictive
          high: "elevated", // less restrictive
          critical: "mandatory",
        },
      },
    });
    const result = resolveIdentity(spec, [overlay], {});
    expect(result.effectiveRiskTolerance.low).toBe("none");
    expect(result.effectiveRiskTolerance.medium).toBe("standard");
    expect(result.effectiveRiskTolerance.high).toBe("elevated");
  });

  it("additional forbidden behaviors overlay", () => {
    const spec = makeBaseIdentitySpec({ forbiddenBehaviors: ["account.delete"] });
    const overlay = makeOverlay({
      overrides: {
        additionalForbiddenBehaviors: ["campaign.pause_all", "billing.change_card"],
      },
    });
    const result = resolveIdentity(spec, [overlay], {});
    expect(result.effectiveForbiddenBehaviors).toContain("account.delete");
    expect(result.effectiveForbiddenBehaviors).toContain("campaign.pause_all");
    expect(result.effectiveForbiddenBehaviors).toContain("billing.change_card");
  });

  it("remove trust behaviors overlay", () => {
    const spec = makeBaseIdentitySpec({
      trustBehaviors: ["campaign.read", "campaign.update_budget", "report.view"],
    });
    const overlay = makeOverlay({
      overrides: {
        removeTrustBehaviors: ["campaign.update_budget"],
      },
    });
    const result = resolveIdentity(spec, [overlay], {});
    expect(result.effectiveTrustBehaviors).toContain("campaign.read");
    expect(result.effectiveTrustBehaviors).not.toContain("campaign.update_budget");
    expect(result.effectiveTrustBehaviors).toContain("report.view");
  });

  it("time window filtering: overlay only active during matching time", () => {
    const spec = makeBaseIdentitySpec();
    const now = new Date("2025-06-15T14:30:00Z"); // Sunday=0, but this is a Sunday
    const dayOfWeek = now.getDay(); // 0 for Sunday
    const hour = now.getHours(); // 14

    const activeOverlay = makeOverlay({
      id: "overlay-active",
      conditions: {
        timeWindows: [
          { dayOfWeek: [dayOfWeek], startHour: hour, endHour: hour + 1, timezone: "UTC" },
        ],
      },
      overrides: { additionalForbiddenBehaviors: ["test.action"] },
    });

    const inactiveOverlay = makeOverlay({
      id: "overlay-inactive",
      conditions: {
        timeWindows: [
          { dayOfWeek: [dayOfWeek], startHour: hour + 5, endHour: hour + 6, timezone: "UTC" },
        ],
      },
      overrides: { additionalForbiddenBehaviors: ["other.action"] },
    });

    const result = resolveIdentity(spec, [activeOverlay, inactiveOverlay], { now });
    expect(result.activeOverlays).toHaveLength(1);
    expect(result.activeOverlays[0]?.id).toBe("overlay-active");
    expect(result.effectiveForbiddenBehaviors).toContain("test.action");
    expect(result.effectiveForbiddenBehaviors).not.toContain("other.action");
  });

  it("cartridge filtering: overlay only active for matching cartridge", () => {
    const spec = makeBaseIdentitySpec();
    const overlay = makeOverlay({
      conditions: {
        cartridgeIds: ["meta-ads"],
      },
      overrides: { additionalForbiddenBehaviors: ["meta.action"] },
    });

    // Does not match
    const result1 = resolveIdentity(spec, [overlay], { cartridgeId: "google-ads" });
    expect(result1.activeOverlays).toHaveLength(0);

    // Matches
    const result2 = resolveIdentity(spec, [overlay], { cartridgeId: "meta-ads" });
    expect(result2.activeOverlays).toHaveLength(1);
    expect(result2.effectiveForbiddenBehaviors).toContain("meta.action");
  });
});

// ===================================================================
// getActiveOverlays
// ===================================================================

describe("getActiveOverlays", () => {
  it("returns only active overlays sorted by priority", () => {
    const o1 = makeOverlay({ id: "o1", priority: 10, active: true });
    const o2 = makeOverlay({ id: "o2", priority: 5, active: true });
    const o3 = makeOverlay({ id: "o3", priority: 1, active: false }); // inactive

    const result = getActiveOverlays([o1, o2, o3], {});
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("o2"); // priority 5
    expect(result[1]?.id).toBe("o1"); // priority 10
  });
});

// ===================================================================
// createGuardrailState
// ===================================================================

describe("createGuardrailState", () => {
  it("creates empty guardrail state", () => {
    const state = createGuardrailState();
    expect(state.actionCounts.size).toBe(0);
    expect(state.lastActionTimes.size).toBe(0);
  });
});
