import { describe, it, expect } from "vitest";
import type { ActionProposal } from "@switchboard/schemas";
import { applySpendApprovalThreshold } from "../platform/governance/spend-approval-threshold.js";
import type { GovernanceDecision, ExecutionConstraints } from "../platform/governance-types.js";
import { extractSpendAmount } from "../engine/spend-limits.js";
import {
  deriveCorroboration,
  type DeriveCorroborationInput,
} from "../recommendations/outcome-corroboration.js";
import { attributeOneRecommendation } from "../recommendations/outcome-attribution.js";
import type { WindowMetrics } from "../recommendations/outcome-attribution-types.js";

/**
 * GOV-10 - the cross-site NaN/Infinity numeric-safety matrix.
 *
 * Four independent sites guard a numeric input against non-finite values and
 * FAIL SAFE - never a silent dangerous pass. A poisoned spend/budget must not
 * auto-approve, and a poisoned outcome metric must not fabricate a corroboration
 * or render a NaN movement. Each site's guard previously had only partial (or no)
 * non-finite coverage; this single suite pins all four against {NaN, +Infinity,
 * -Infinity} plus a finite control, so the invariant lives in one place with one
 * regression signal. `Number.isFinite` is the canonical guard across all four.
 *
 *   Site 1  spend-approval-threshold.applySpendApprovalThreshold - a non-finite
 *           spendAmount/threshold is a no-op, so a require_approval is NEVER
 *           relaxed to execute (fails toward require-approval).
 *   Site 2  spend-limits.extractSpendAmount - a non-finite candidate reads as null
 *           (no usable amount), so the spend-limit + threshold levers see no spend.
 *   Site 3  outcome-corroboration.deriveCorroboration - any non-finite input field
 *           rejects with "non_finite_input" (no fabricated "corroborated").
 *   Site 4  outcome-attribution.attributeOneRecommendation - a non-finite computed
 *           delta is coerced to honest absence (no NaN/Infinity reaches the cockpit).
 */

const NON_FINITE: ReadonlyArray<readonly [string, number]> = [
  ["NaN", NaN],
  ["+Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
];

// --- Site 1: spend-approval-threshold ---------------------------------------
describe("numeric-safety matrix - site 1 - applySpendApprovalThreshold fails toward require_approval", () => {
  const constraints: ExecutionConstraints = {
    allowedModelTiers: ["default"],
    maxToolCalls: 10,
    maxLlmTurns: 1,
    maxTotalTokens: 0,
    maxRuntimeMs: 30_000,
    maxWritesPerExecution: 10,
    trustLevel: "autonomous",
  };
  const requireApproval = (): GovernanceDecision => ({
    outcome: "require_approval",
    riskScore: 10,
    approvalLevel: "standard",
    approvers: [],
    constraints,
    matchedPolicies: ["POLICY_RULE"],
  });
  // The ONLY posture that relaxes require_approval → execute for a finite amount:
  // an explicitly-autonomous, opted-in deployment, under threshold.
  const autonomousBase = {
    trustLevelOverride: "autonomous" as const,
    spendAutonomyEnabled: true,
    threshold: 100,
    spendAmount: 50,
    mutationClass: "write" as const,
    reversibility: "full" as const,
  };

  it("control: a finite under-threshold amount DOES relax to execute", () => {
    const r = applySpendApprovalThreshold(requireApproval(), autonomousBase);
    expect(r.outcome).toBe("execute");
    expect(r.matchedPolicies).toContain("SPEND_APPROVAL_THRESHOLD");
  });

  it.each(NON_FINITE)(
    "a %s spendAmount never relaxes require_approval (no-op)",
    (_label, value) => {
      const r = applySpendApprovalThreshold(requireApproval(), {
        ...autonomousBase,
        spendAmount: value,
      });
      expect(r.outcome).toBe("require_approval");
      expect(r.matchedPolicies).not.toContain("SPEND_APPROVAL_THRESHOLD");
    },
  );

  it.each(NON_FINITE)("a %s threshold never relaxes require_approval (no-op)", (_label, value) => {
    const r = applySpendApprovalThreshold(requireApproval(), {
      ...autonomousBase,
      threshold: value,
    });
    expect(r.outcome).toBe("require_approval");
    expect(r.matchedPolicies).not.toContain("SPEND_APPROVAL_THRESHOLD");
  });
});

// --- Site 2: spend-limits.extractSpendAmount --------------------------------
describe("numeric-safety matrix - site 2 - extractSpendAmount reads non-finite as null", () => {
  const proposal = (amount: number): ActionProposal =>
    ({ parameters: { spendAmount: amount } }) as unknown as ActionProposal;

  it("control: a finite amount reads through", () => {
    expect(extractSpendAmount(proposal(4200))).toBe(4200);
  });

  it.each(NON_FINITE)("a %s amount reads as null (no usable spend)", (_label, value) => {
    expect(extractSpendAmount(proposal(value))).toBeNull();
  });
});

// --- Site 3: outcome-corroboration.deriveCorroboration ----------------------
describe("numeric-safety matrix - site 3 - deriveCorroboration rejects non-finite input", () => {
  const passing = (): DeriveCorroborationInput => ({
    actionKind: "pause",
    visibilityFlagCount: 0,
    deltaPct: -92,
    businessContextStable: "unknown",
    preAccountSpendCents: 100000,
    postAccountSpendCents: 80000,
    orgBookedStats: {
      preWindow: { bookedValueCents: 50000, bookedCount: 5 },
      postWindow: { bookedValueCents: 45000, bookedCount: 5 },
    },
  });

  it("control: the finite passing input corroborates", () => {
    expect(deriveCorroboration(passing())).toEqual({
      causalStrengthUpgrade: "corroborated",
      reason: "corroborated",
    });
  });

  it.each(NON_FINITE)("a %s deltaPct never corroborates (fails safe)", (_label, value) => {
    // A non-finite deltaPct fails safe to causalStrengthUpgrade:null. The reason
    // varies by sign: NaN / -Infinity reach the finite guard (non_finite_input),
    // while a +Infinity is first caught by the directional gate for a pause (a
    // positive delta is an unfavorable_direction). Either path can never fabricate
    // a "corroborated", so the safety property is the null verdict, not the reason.
    expect(deriveCorroboration({ ...passing(), deltaPct: value }).causalStrengthUpgrade).toBeNull();
  });

  it.each(NON_FINITE)(
    "a %s postAccountSpendCents rejects as non_finite_input (no directional gate to mask it)",
    (_label, value) => {
      expect(deriveCorroboration({ ...passing(), postAccountSpendCents: value })).toEqual({
        causalStrengthUpgrade: null,
        reason: "non_finite_input",
      });
    },
  );
});

// --- Site 4: outcome-attribution.attributeOneRecommendation -----------------
describe("numeric-safety matrix - site 4 - attributeOneRecommendation coerces a non-finite delta to absence", () => {
  const REC = {
    id: "rec-1",
    organizationId: "org-1",
    campaignId: "camp-A",
    actionKind: "pause" as const,
    resolvedAt: new Date("2026-05-01T12:00:00Z"),
    executableWorkUnitId: null,
  };
  const w = (spendCents: number, ctr: number): WindowMetrics => ({
    spendCents,
    ctr,
    dailyRowCount: 7,
  });

  it("control: a finite spend drop renders a real deltaPct", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [],
    });
    expect(row.copyValues?.deltaPct).toBe(-92);
  });

  it.each(NON_FINITE)(
    "a %s post-window spend coerces the delta to honest absence (no NaN/Infinity leaks to the cockpit)",
    (_label, value) => {
      const row = attributeOneRecommendation({
        candidate: REC,
        preWindow: w(10000, 0.02),
        postWindow: w(value, 0.02),
        overlaps: [],
      });
      // The non-finite delta is coerced to null at source, so nothing downstream
      // renders a NaN/Infinity movement. (Removing the coercion makes deltaPct
      // Infinity/NaN and fails this assertion.)
      const deltaPct = row.copyValues?.deltaPct;
      expect(deltaPct == null || Number.isFinite(deltaPct)).toBe(true);
    },
  );
});
