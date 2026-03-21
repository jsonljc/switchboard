import { describe, it, expect } from "vitest";
import { canApprove, canApproveWithChain } from "../delegation.js";
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

// ===================================================================
// canApprove
// ===================================================================

describe("canApprove", () => {
  describe("direct approval", () => {
    it("returns true when principal is in approverIds and has approver role", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["approver"] });
      expect(canApprove(principal, ["user-1"], [])).toBe(true);
    });

    it("returns true when principal has multiple roles including approver", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester", "approver", "admin"] });
      expect(canApprove(principal, ["user-1"], [])).toBe(true);
    });

    it("rejects principal without approver role even if in approverIds", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
      expect(canApprove(principal, ["user-1"], [])).toBe(false);
    });

    it("rejects principal with empty roles even if in approverIds", () => {
      const principal = makePrincipal({ id: "user-1", roles: [] });
      expect(canApprove(principal, ["user-1"], [])).toBe(false);
    });

    it("rejects principal not in approverIds even with approver role", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["approver"] });
      expect(canApprove(principal, ["admin-1", "admin-2"], [])).toBe(false);
    });

    it("returns true when principal is one of many approverIds", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["approver"] });
      expect(canApprove(principal, ["admin-1", "user-1", "admin-2"], [])).toBe(true);
    });
  });

  describe("delegated approval", () => {
    it("allows delegated approval when grantor is in approverIds", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
      const delegation = makeDelegation({ grantor: "admin-1", grantee: "user-1" });
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

    it("allows non-expired delegation", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
      const futureDate = new Date(Date.now() + 86400_000);
      const delegation = makeDelegation({
        grantor: "admin-1",
        grantee: "user-1",
        expiresAt: futureDate,
      });
      expect(canApprove(principal, ["admin-1"], [delegation])).toBe(true);
    });

    it("rejects delegation to wrong grantee", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
      const delegation = makeDelegation({ grantor: "admin-1", grantee: "other-user" });
      expect(canApprove(principal, ["admin-1"], [delegation])).toBe(false);
    });

    it("rejects delegation from non-approver grantor", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
      const delegation = makeDelegation({ grantor: "non-approver", grantee: "user-1" });
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
  });

  describe("edge cases", () => {
    it("returns false when approverIds is empty", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["approver"] });
      expect(canApprove(principal, [], [])).toBe(false);
    });

    it("returns false when delegations is empty and principal is not an approver", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
      expect(canApprove(principal, ["admin-1"], [])).toBe(false);
    });

    it("uses provided now parameter for expiration checks", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
      const expiresAt = new Date("2025-06-01");
      const delegation = makeDelegation({
        grantor: "admin-1",
        grantee: "user-1",
        expiresAt,
      });

      // Before expiration
      const beforeExpiry = new Date("2025-05-01");
      expect(canApprove(principal, ["admin-1"], [delegation], beforeExpiry)).toBe(true);

      // After expiration
      const afterExpiry = new Date("2025-07-01");
      expect(canApprove(principal, ["admin-1"], [delegation], afterExpiry)).toBe(false);
    });

    it("handles multiple delegations where only one is valid", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
      const delegations: DelegationRule[] = [
        makeDelegation({
          id: "d1",
          grantor: "admin-1",
          grantee: "user-1",
          expiresAt: new Date("2020-01-01"), // expired
        }),
        makeDelegation({
          id: "d2",
          grantor: "admin-2",
          grantee: "user-1",
          expiresAt: null, // valid
        }),
      ];
      expect(canApprove(principal, ["admin-2"], delegations)).toBe(true);
    });
  });
});

// ===================================================================
// canApproveWithChain
// ===================================================================

describe("canApproveWithChain", () => {
  describe("direct approver", () => {
    it("returns authorized with chain of self for direct approver", () => {
      const principal = makePrincipal({ id: "admin-1", roles: ["approver"] });
      const result = canApproveWithChain(principal, ["admin-1"], []);
      expect(result.authorized).toBe(true);
      expect(result.chain).toEqual(["admin-1"]);
      expect(result.depth).toBe(0);
      expect(result.effectiveScope).toBe("*");
    });

    it("falls through to chain resolver when missing approver role", () => {
      const principal = makePrincipal({ id: "admin-1", roles: ["requester"] });
      const result = canApproveWithChain(principal, ["admin-1"], []);
      // canApproveWithChain's direct check requires "approver" role,
      // but resolveDelegationChain has its own role-agnostic direct match
      expect(result.authorized).toBe(true);
      expect(result.chain).toEqual(["admin-1"]);
      expect(result.depth).toBe(0);
    });

    it("rejects when not in approverIds even with approver role", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["approver"] });
      const result = canApproveWithChain(principal, ["admin-1"], []);
      expect(result.authorized).toBe(false);
    });
  });

  describe("delegated approval with chain", () => {
    it("returns chain details for single-hop delegation", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
      const delegations: DelegationRule[] = [
        makeDelegation({ id: "d1", grantor: "admin-1", grantee: "user-1" }),
      ];
      const result = canApproveWithChain(principal, ["admin-1"], delegations);
      expect(result.authorized).toBe(true);
      expect(result.chain).toEqual(["user-1", "admin-1"]);
      expect(result.depth).toBe(1);
    });

    it("returns chain details for multi-hop delegation", () => {
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

    it("returns unauthorized result when no path exists", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
      const result = canApproveWithChain(principal, ["admin-1"], []);
      expect(result.authorized).toBe(false);
      expect(result.chain).toEqual([]);
      expect(result.depth).toBe(0);
      expect(result.effectiveScope).toBe("");
    });
  });

  describe("scope handling", () => {
    it("returns effectiveScope * for direct approver", () => {
      const principal = makePrincipal({ id: "admin-1", roles: ["approver"] });
      const result = canApproveWithChain(principal, ["admin-1"], []);
      expect(result.effectiveScope).toBe("*");
    });

    it("returns narrowed scope through delegation chain", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
      const delegations: DelegationRule[] = [
        makeDelegation({
          id: "d1",
          grantor: "admin-1",
          grantee: "user-1",
          scope: "digital-ads.campaign.*",
        }),
      ];
      const result = canApproveWithChain(principal, ["admin-1"], delegations);
      expect(result.authorized).toBe(true);
      expect(result.effectiveScope).toBe("digital-ads.campaign.*");
    });
  });

  describe("edge cases", () => {
    it("uses provided now parameter for expiration checks", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
      const expiresAt = new Date("2025-06-01");
      const delegation = makeDelegation({
        grantor: "admin-1",
        grantee: "user-1",
        expiresAt,
      });

      const beforeExpiry = new Date("2025-05-01");
      const result = canApproveWithChain(principal, ["admin-1"], [delegation], beforeExpiry);
      expect(result.authorized).toBe(true);

      const afterExpiry = new Date("2025-07-01");
      const resultExpired = canApproveWithChain(principal, ["admin-1"], [delegation], afterExpiry);
      expect(resultExpired.authorized).toBe(false);
    });

    it("returns empty chain for unauthorized result", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
      const result = canApproveWithChain(principal, [], []);
      expect(result.authorized).toBe(false);
      expect(result.chain).toEqual([]);
    });

    it("handles delegation with null expiresAt (never expires)", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
      const delegation = makeDelegation({
        grantor: "admin-1",
        grantee: "user-1",
        expiresAt: null,
      });
      const result = canApproveWithChain(principal, ["admin-1"], [delegation]);
      expect(result.authorized).toBe(true);
    });

    it("handles expired delegation in chain", () => {
      const principal = makePrincipal({ id: "user-1", roles: ["requester"] });
      const delegations: DelegationRule[] = [
        makeDelegation({
          id: "d1",
          grantor: "mid-1",
          grantee: "user-1",
          maxChainDepth: 5,
          expiresAt: null,
        }),
        makeDelegation({
          id: "d2",
          grantor: "admin-1",
          grantee: "mid-1",
          maxChainDepth: 5,
          expiresAt: new Date("2020-01-01"), // expired
        }),
      ];
      const result = canApproveWithChain(principal, ["admin-1"], delegations);
      expect(result.authorized).toBe(false);
    });

    it("prefers direct approval over delegation when both are possible", () => {
      const principal = makePrincipal({ id: "admin-1", roles: ["approver"] });
      const delegation = makeDelegation({
        grantor: "admin-1",
        grantee: "admin-1",
        scope: "limited.*",
      });
      // Direct approval should return depth 0 and scope * (not limited.*)
      const result = canApproveWithChain(principal, ["admin-1"], [delegation]);
      expect(result.authorized).toBe(true);
      expect(result.depth).toBe(0);
      expect(result.effectiveScope).toBe("*");
    });
  });
});
