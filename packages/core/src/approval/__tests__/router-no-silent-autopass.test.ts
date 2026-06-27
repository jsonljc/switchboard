import { describe, it, expect } from "vitest";
import { routeApproval, DEFAULT_ROUTING_CONFIG } from "../router.js";
import type { ApprovalRoutingConfig } from "../router.js";
import type { ResolvedIdentity } from "../../identity/spec.js";

// ---------------------------------------------------------------------------
// EV-9b / GOV-7 — an empty-approver config must NEVER become an implicit
// approval.
//
// routeApproval (router.ts:62-77) handles the dangerous shape: governance
// requires approval, but there are no approvers configured and no fallback. The
// safe-by-default config (`denyWhenNoApprovers: true`) returns a "mandatory" +
// empty-approver routing so the orchestrator denies. The invariant under test is
// the OTHER leg: even with `denyWhenNoApprovers: false`, routeApproval must NOT
// silently downgrade `approvalRequired` to "none". Returning "none" here would
// be a silent auto-pass — an action that required approval executing with zero
// human approvers. The required outcome is "approval still required, zero
// approvers available" so the downstream orchestrator blocks.
// ---------------------------------------------------------------------------

/** Identity whose effective risk tolerance forces `mandatory`/`elevated` for the
 * tested risk categories and supplies NO delegated approvers (so the config's
 * empty `defaultApprovers` is the effective approver set). */
function emptyApproverIdentity(): ResolvedIdentity {
  return {
    spec: {
      id: "spec-1",
      principalId: "user-1",
      organizationId: "org-1",
      name: "Test",
      description: "",
      riskTolerance: {
        none: "none",
        low: "none",
        medium: "standard",
        high: "elevated",
        critical: "mandatory",
      },
      globalSpendLimits: { daily: 10000, weekly: 50000, monthly: null, perAction: 5000 },
      cartridgeSpendLimits: {},
      forbiddenBehaviors: [],
      trustBehaviors: [],
      delegatedApprovers: [],
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    },
    activeOverlays: [],
    effectiveRiskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    effectiveSpendLimits: { daily: 10000, weekly: 50000, monthly: null, perAction: 5000 },
    effectiveForbiddenBehaviors: [],
    effectiveTrustBehaviors: [],
    delegatedApprovers: [],
  };
}

const NO_APPROVERS_NO_FALLBACK: ApprovalRoutingConfig = {
  ...DEFAULT_ROUTING_CONFIG,
  defaultApprovers: [],
  defaultFallbackApprover: null,
};

describe("routeApproval — GOV-7: empty approvers cannot silently auto-pass", () => {
  it("denyWhenNoApprovers:false keeps a mandatory action REQUIRED (never downgraded to none)", () => {
    const result = routeApproval("critical", emptyApproverIdentity(), {
      ...NO_APPROVERS_NO_FALLBACK,
      denyWhenNoApprovers: false,
    });

    // The headline: approval is NOT silently dropped to "none". An action that
    // required approval cannot execute just because nobody is configured to
    // approve it.
    expect(result.approvalRequired).not.toBe("none");
    expect(result.approvalRequired).toBe("mandatory");
    // Zero approvers + no fallback => the orchestrator has nobody to route to and
    // must block; the config must not have invented an approver either.
    expect(result.approvers).toEqual([]);
    expect(result.fallbackApprover).toBeNull();
    expect(result.expiredBehavior).toBe("deny");
  });

  it("denyWhenNoApprovers:false keeps an elevated action REQUIRED (never downgraded to none)", () => {
    const result = routeApproval("high", emptyApproverIdentity(), {
      ...NO_APPROVERS_NO_FALLBACK,
      denyWhenNoApprovers: false,
    });

    expect(result.approvalRequired).not.toBe("none");
    expect(result.approvalRequired).toBe("elevated");
    expect(result.approvers).toEqual([]);
    expect(result.fallbackApprover).toBeNull();
  });

  it("denyWhenNoApprovers:true returns the explicit deny signal (mandatory + empty approvers)", () => {
    const result = routeApproval("critical", emptyApproverIdentity(), {
      ...NO_APPROVERS_NO_FALLBACK,
      denyWhenNoApprovers: true,
    });

    // The safe-by-default leg: forced to "mandatory" with an empty approver list
    // so the orchestrator denies (router.ts:65-76).
    expect(result.approvalRequired).toBe("mandatory");
    expect(result.approvers).toEqual([]);
    expect(result.fallbackApprover).toBeNull();
  });

  it("a genuinely none-risk action is unaffected (no false-positive blocking)", () => {
    // Control: when the identity's effective tolerance IS "none" for the category,
    // the empty-approver guard does not fire and approval is legitimately not
    // required — proving the invariant above is about REQUIRED actions only.
    const result = routeApproval("low", emptyApproverIdentity(), {
      ...NO_APPROVERS_NO_FALLBACK,
      denyWhenNoApprovers: false,
    });
    expect(result.approvalRequired).toBe("none");
  });
});
