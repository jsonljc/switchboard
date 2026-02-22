import { describe, it, expect } from "vitest";

import { canActAs, resolveApprovers } from "../index.js";

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
    roles: ["requester"],
    ...overrides,
  };
}

function makeDelegation(overrides: Partial<DelegationRule> = {}): DelegationRule {
  return {
    id: "del-1",
    grantor: "target-user",
    grantee: "user-1",
    scope: "*",
    expiresAt: null,
    ...overrides,
  };
}

// ===================================================================
// canActAs
// ===================================================================

describe("Identity Principals — canActAs", () => {
  it("principal can always act as themselves", () => {
    const principal = makePrincipal({ id: "user-1" });
    expect(canActAs(principal, "user-1", [], "any.action")).toBe(true);
  });

  it("system principals can act as anyone", () => {
    const principal = makePrincipal({ id: "system-1", type: "system" });
    expect(canActAs(principal, "other-user", [], "any.action")).toBe(true);
  });

  it("valid delegation allows acting as grantor", () => {
    const principal = makePrincipal({ id: "user-1" });
    const delegation = makeDelegation({
      grantor: "target-user",
      grantee: "user-1",
      scope: "*",
    });
    expect(canActAs(principal, "target-user", [delegation], "any.action")).toBe(true);
  });

  it("expired delegation is rejected", () => {
    const principal = makePrincipal({ id: "user-1" });
    const delegation = makeDelegation({
      grantor: "target-user",
      grantee: "user-1",
      expiresAt: new Date("2020-01-01"),
    });
    expect(canActAs(principal, "target-user", [delegation], "any.action")).toBe(false);
  });

  it("delegation to wrong grantee is rejected", () => {
    const principal = makePrincipal({ id: "user-1" });
    const delegation = makeDelegation({
      grantor: "target-user",
      grantee: "other-user",
    });
    expect(canActAs(principal, "target-user", [delegation], "any.action")).toBe(false);
  });

  it("delegation from wrong grantor is rejected", () => {
    const principal = makePrincipal({ id: "user-1" });
    const delegation = makeDelegation({
      grantor: "wrong-user",
      grantee: "user-1",
    });
    expect(canActAs(principal, "target-user", [delegation], "any.action")).toBe(false);
  });

  it("scope wildcard '*' matches any action", () => {
    const principal = makePrincipal({ id: "user-1" });
    const delegation = makeDelegation({ scope: "*" });
    expect(canActAs(principal, "target-user", [delegation], "ads.budget.adjust")).toBe(true);
  });

  it("exact scope match works", () => {
    const principal = makePrincipal({ id: "user-1" });
    const delegation = makeDelegation({ scope: "ads.budget.adjust" });
    expect(canActAs(principal, "target-user", [delegation], "ads.budget.adjust")).toBe(true);
  });

  it("exact scope mismatch is rejected", () => {
    const principal = makePrincipal({ id: "user-1" });
    const delegation = makeDelegation({ scope: "ads.budget.adjust" });
    expect(canActAs(principal, "target-user", [delegation], "ads.campaign.pause")).toBe(false);
  });

  it("prefix wildcard 'ads.*' matches 'ads.budget.adjust'", () => {
    const principal = makePrincipal({ id: "user-1" });
    const delegation = makeDelegation({ scope: "ads.*" });
    expect(canActAs(principal, "target-user", [delegation], "ads.budget.adjust")).toBe(true);
  });

  it("prefix wildcard 'ads.*' does not match 'other.action'", () => {
    const principal = makePrincipal({ id: "user-1" });
    const delegation = makeDelegation({ scope: "ads.*" });
    expect(canActAs(principal, "target-user", [delegation], "other.action")).toBe(false);
  });

  it("non-delegated non-self principal cannot act as target", () => {
    const principal = makePrincipal({ id: "user-1", type: "user" });
    expect(canActAs(principal, "other-user", [], "any.action")).toBe(false);
  });
});

// ===================================================================
// resolveApprovers
// ===================================================================

describe("Identity Principals — resolveApprovers", () => {
  it("filters to principals with approver role", () => {
    const principals: Principal[] = [
      makePrincipal({ id: "admin-1", roles: ["approver"] }),
      makePrincipal({ id: "user-2", roles: ["requester"] }),
      makePrincipal({ id: "admin-2", roles: ["approver", "admin"] }),
    ];
    const result = resolveApprovers(["admin-1", "user-2", "admin-2"], null, principals);
    expect(result).toEqual(["admin-1", "admin-2"]);
  });

  it("returns fallback approver when no valid approvers found", () => {
    const principals: Principal[] = [
      makePrincipal({ id: "user-1", roles: ["requester"] }),
    ];
    const result = resolveApprovers(["user-1"], "fallback-admin", principals);
    expect(result).toEqual(["fallback-admin"]);
  });

  it("returns empty array when no valid approvers and no fallback", () => {
    const principals: Principal[] = [
      makePrincipal({ id: "user-1", roles: ["requester"] }),
    ];
    const result = resolveApprovers(["user-1"], null, principals);
    expect(result).toEqual([]);
  });

  it("ignores approverIds not present in principals list", () => {
    const principals: Principal[] = [
      makePrincipal({ id: "admin-1", roles: ["approver"] }),
    ];
    const result = resolveApprovers(["admin-1", "missing-user"], null, principals);
    expect(result).toEqual(["admin-1"]);
  });
});
