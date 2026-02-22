import { describe, it, expect } from "vitest";

import {
  canApprove,
  canApproveWithChain,
  routeApproval,
  DEFAULT_ROUTING_CONFIG,
  applyPatch,
  describePatch,
  checkExpiry,
  getExpiryMs,
  createApprovalState,
} from "../index.js";

import type { ResolvedIdentity } from "../index.js";
import type { Principal, DelegationRule } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: "user-1",
    type: "user",
    name: "Test User",
    organizationId: "org-1",
    roles: ["approver"],
    ...overrides,
  };
}

function makeDelegation(overrides: Partial<DelegationRule> = {}): DelegationRule {
  return {
    id: "del-1",
    grantor: "admin-1",
    grantee: "user-1",
    scope: "*",
    expiresAt: null,
    ...overrides,
  };
}

function makeResolvedIdentity(overrides: Partial<ResolvedIdentity> = {}): ResolvedIdentity {
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
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
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
    ...overrides,
  };
}

// ===================================================================
// DELEGATION
// ===================================================================

describe("Approval Delegation", () => {
  it("allows direct approver with approver role", () => {
    const principal = makePrincipal({ id: "user-1", roles: ["approver"] });
    expect(canApprove(principal, ["user-1"], [])).toBe(true);
  });

  it("rejects principal without approver role even if in approverIds", () => {
    const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
    expect(canApprove(principal, ["user-1"], [])).toBe(false);
  });

  it("rejects principal not in approverIds even with approver role", () => {
    const principal = makePrincipal({ id: "user-1", roles: ["approver"] });
    expect(canApprove(principal, ["admin-1", "admin-2"], [])).toBe(false);
  });

  it("allows delegated approval when grantor is in approverIds", () => {
    const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
    const delegation = makeDelegation({
      grantor: "admin-1",
      grantee: "user-1",
    });
    expect(canApprove(principal, ["admin-1"], [delegation])).toBe(true);
  });

  it("rejects expired delegation", () => {
    const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
    const delegation = makeDelegation({
      grantor: "admin-1",
      grantee: "user-1",
      expiresAt: new Date("2020-01-01"),
    });
    expect(canApprove(principal, ["admin-1"], [delegation])).toBe(false);
  });

  it("rejects delegation to wrong grantee", () => {
    const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
    const delegation = makeDelegation({
      grantor: "admin-1",
      grantee: "other-user",
    });
    expect(canApprove(principal, ["admin-1"], [delegation])).toBe(false);
  });

  it("rejects delegation from non-approver grantor", () => {
    const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
    const delegation = makeDelegation({
      grantor: "non-approver",
      grantee: "user-1",
    });
    // "non-approver" is not in the approverIds list
    expect(canApprove(principal, ["admin-1"], [delegation])).toBe(false);
  });

  it("allows multi-hop delegation via chain resolution", () => {
    const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
    const delegations: DelegationRule[] = [
      makeDelegation({ id: "d1", grantor: "mid-1", grantee: "user-1", maxChainDepth: 5 }),
      makeDelegation({ id: "d2", grantor: "admin-1", grantee: "mid-1", maxChainDepth: 5 }),
    ];
    expect(canApprove(principal, ["admin-1"], delegations)).toBe(true);
  });

  it("canApproveWithChain returns chain details", () => {
    const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
    const delegations: DelegationRule[] = [
      makeDelegation({ id: "d1", grantor: "mid-1", grantee: "user-1", maxChainDepth: 5 }),
      makeDelegation({ id: "d2", grantor: "admin-1", grantee: "mid-1", maxChainDepth: 5 }),
    ];
    const result = canApproveWithChain(principal, ["admin-1"], delegations);
    expect(result.authorized).toBe(true);
    expect(result.chain).toEqual(["user-1", "mid-1", "admin-1"]);
    expect(result.depth).toBe(2);
  });

  it("canApproveWithChain returns direct approver chain for approver", () => {
    const principal = makePrincipal({ id: "admin-1", roles: ["approver"] });
    const result = canApproveWithChain(principal, ["admin-1"], []);
    expect(result.authorized).toBe(true);
    expect(result.chain).toEqual(["admin-1"]);
    expect(result.depth).toBe(0);
  });

  it("canApproveWithChain returns unauthorized for no path", () => {
    const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
    const result = canApproveWithChain(principal, ["admin-1"], []);
    expect(result.authorized).toBe(false);
    expect(result.chain).toEqual([]);
  });
});

// ===================================================================
// APPROVAL ROUTER
// ===================================================================

describe("Approval Router", () => {
  const identity = makeResolvedIdentity();

  it("mandatory approval gets mandatoryExpiryMs timeout", () => {
    const result = routeApproval("critical", identity);
    expect(result.approvalRequired).toBe("mandatory");
    expect(result.expiresInMs).toBe(DEFAULT_ROUTING_CONFIG.mandatoryExpiryMs);
  });

  it("elevated approval gets elevatedExpiryMs timeout", () => {
    const result = routeApproval("high", identity);
    expect(result.approvalRequired).toBe("elevated");
    expect(result.expiresInMs).toBe(DEFAULT_ROUTING_CONFIG.elevatedExpiryMs);
  });

  it("standard approval gets defaultExpiryMs timeout", () => {
    const result = routeApproval("medium", identity);
    expect(result.approvalRequired).toBe("standard");
    expect(result.expiresInMs).toBe(DEFAULT_ROUTING_CONFIG.defaultExpiryMs);
  });

  it("none approval gets defaultExpiryMs timeout", () => {
    const result = routeApproval("low", identity);
    expect(result.approvalRequired).toBe("none");
    expect(result.expiresInMs).toBe(DEFAULT_ROUTING_CONFIG.defaultExpiryMs);
  });

  it("custom config overrides default timeouts", () => {
    const config = {
      ...DEFAULT_ROUTING_CONFIG,
      mandatoryExpiryMs: 1000,
      elevatedExpiryMs: 2000,
      defaultExpiryMs: 3000,
    };
    const result = routeApproval("critical", identity, config);
    expect(result.expiresInMs).toBe(1000);
  });

  it("returns configured approvers and fallback", () => {
    const config = {
      ...DEFAULT_ROUTING_CONFIG,
      defaultApprovers: ["admin-1", "admin-2"],
      defaultFallbackApprover: "super-admin",
    };
    const result = routeApproval("medium", identity, config);
    expect(result.approvers).toEqual(["admin-1", "admin-2"]);
    expect(result.fallbackApprover).toBe("super-admin");
  });

  it("defaults expiredBehavior to deny", () => {
    const result = routeApproval("medium", identity);
    expect(result.expiredBehavior).toBe("deny");
  });
});

// ===================================================================
// PATCHING
// ===================================================================

describe("Approval Patching", () => {
  it("merges patchValue over originalParams", () => {
    const result = applyPatch({ a: 1, b: 2 }, { b: 99, c: 3 });
    expect(result).toEqual({ a: 1, b: 99, c: 3 });
  });

  it("preserves original when patch is empty", () => {
    const result = applyPatch({ a: 1, b: 2 }, {});
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("returns only patch keys when original is empty", () => {
    const result = applyPatch({}, { x: 10 });
    expect(result).toEqual({ x: 10 });
  });

  it("describePatch identifies changed fields", () => {
    const desc = describePatch({ amount: 500, target: "camp-1" }, { amount: 1000 });
    expect(desc).toContain("Modified");
    expect(desc).toContain("amount");
    expect(desc).toContain("500");
    expect(desc).toContain("1000");
  });

  it("describePatch returns no changes when values match", () => {
    const desc = describePatch({ amount: 500 }, { amount: 500 });
    expect(desc).toBe("No changes applied");
  });

  it("describePatch shows new keys as changes", () => {
    const desc = describePatch({}, { newField: "value" });
    expect(desc).toContain("Modified");
    expect(desc).toContain("newField");
  });
});

// ===================================================================
// EXPIRY
// ===================================================================

describe("Approval Expiry", () => {
  it("checkExpiry returns true when pending and past expiresAt", () => {
    const state = createApprovalState(new Date("2020-01-01"));
    expect(checkExpiry(state)).toBe(true);
  });

  it("checkExpiry returns false when pending and before expiresAt", () => {
    const state = createApprovalState(new Date(Date.now() + 3600_000));
    expect(checkExpiry(state)).toBe(false);
  });

  it("checkExpiry returns false when not pending", () => {
    const state = createApprovalState(new Date("2020-01-01"));
    // Manually set status to approved
    const approved = { ...state, status: "approved" as const };
    expect(checkExpiry(approved)).toBe(false);
  });

  it("getExpiryMs returns time remaining", () => {
    const futureDate = new Date(Date.now() + 5000);
    const ms = getExpiryMs(futureDate);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(5000);
  });

  it("getExpiryMs returns 0 when already expired", () => {
    const pastDate = new Date(Date.now() - 5000);
    expect(getExpiryMs(pastDate)).toBe(0);
  });
});
