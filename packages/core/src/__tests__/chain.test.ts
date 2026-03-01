import { describe, it, expect } from "vitest";
import { resolveDelegationChain, narrowScope } from "../approval/chain.js";
import type { DelegationRule } from "@switchboard/schemas";

function makeRule(overrides: Partial<DelegationRule> = {}): DelegationRule {
  return {
    id: "del-1",
    grantor: "admin-1",
    grantee: "user-1",
    scope: "*",
    expiresAt: null,
    ...overrides,
  };
}

describe("Delegation Chain Resolution", () => {
  it("direct approver (chain length 1)", () => {
    const result = resolveDelegationChain("admin-1", ["admin-1"], []);
    expect(result.authorized).toBe(true);
    expect(result.chain).toEqual(["admin-1"]);
    expect(result.depth).toBe(0);
  });

  it("single-hop delegation (A→B, chain length 2)", () => {
    const delegations: DelegationRule[] = [
      makeRule({ id: "d1", grantor: "admin-1", grantee: "user-1", maxChainDepth: 1 }),
    ];
    const result = resolveDelegationChain("user-1", ["admin-1"], delegations);
    expect(result.authorized).toBe(true);
    expect(result.chain).toEqual(["user-1", "admin-1"]);
    expect(result.depth).toBe(1);
  });

  it("multi-hop chain (A→B→C→D)", () => {
    const delegations: DelegationRule[] = [
      makeRule({ id: "d1", grantor: "B", grantee: "A", maxChainDepth: 5 }),
      makeRule({ id: "d2", grantor: "C", grantee: "B", maxChainDepth: 5 }),
      makeRule({ id: "d3", grantor: "D", grantee: "C", maxChainDepth: 5 }),
    ];
    const result = resolveDelegationChain("A", ["D"], delegations);
    expect(result.authorized).toBe(true);
    expect(result.chain).toEqual(["A", "B", "C", "D"]);
    expect(result.depth).toBe(3);
  });

  it("cycle detection (A→B→A)", () => {
    const delegations: DelegationRule[] = [
      makeRule({ id: "d1", grantor: "B", grantee: "A", maxChainDepth: 5 }),
      makeRule({ id: "d2", grantor: "A", grantee: "B", maxChainDepth: 5 }),
    ];
    // Neither A nor B is in approverIds, so this should not loop forever
    const result = resolveDelegationChain("A", ["C"], delegations);
    expect(result.authorized).toBe(false);
    expect(result.chain).toEqual([]);
  });

  it("expired rule in chain breaks the chain", () => {
    const delegations: DelegationRule[] = [
      makeRule({ id: "d1", grantor: "B", grantee: "A", maxChainDepth: 5 }),
      makeRule({
        id: "d2",
        grantor: "C",
        grantee: "B",
        maxChainDepth: 5,
        expiresAt: new Date("2020-01-01"),
      }),
    ];
    const result = resolveDelegationChain("A", ["C"], delegations);
    expect(result.authorized).toBe(false);
    expect(result.chain).toEqual([]);
  });

  it("maxChainDepth enforcement per rule", () => {
    const delegations: DelegationRule[] = [
      makeRule({ id: "d1", grantor: "B", grantee: "A", maxChainDepth: 2 }),
      makeRule({ id: "d2", grantor: "C", grantee: "B", maxChainDepth: 1 }),
    ];
    // B→C rule has maxChainDepth=1, so at depth 2 it's blocked
    const result = resolveDelegationChain("A", ["C"], delegations);
    expect(result.authorized).toBe(false);
  });

  it("global depth cap", () => {
    const delegations: DelegationRule[] = [];
    const nodes = ["A", "B", "C", "D", "E", "F", "G"];
    for (let i = 0; i < nodes.length - 1; i++) {
      delegations.push(
        makeRule({
          id: `d${i}`,
          grantor: nodes[i + 1]!,
          grantee: nodes[i]!,
          maxChainDepth: 10,
        }),
      );
    }

    // With maxDepth=5, path A→B→C→D→E→F (depth 5) should succeed
    const result5 = resolveDelegationChain("A", ["F"], delegations, { maxDepth: 5 });
    expect(result5.authorized).toBe(true);
    expect(result5.depth).toBe(5);

    // G is at depth 6, should fail with maxDepth=5
    const result6 = resolveDelegationChain("A", ["G"], delegations, { maxDepth: 5 });
    expect(result6.authorized).toBe(false);
  });

  it("scope narrowing across chain", () => {
    const delegations: DelegationRule[] = [
      makeRule({ id: "d1", grantor: "B", grantee: "A", scope: "digital-ads.*", maxChainDepth: 5 }),
      makeRule({ id: "d2", grantor: "C", grantee: "B", scope: "digital-ads.campaign.*", maxChainDepth: 5 }),
    ];
    const result = resolveDelegationChain("A", ["C"], delegations, { requiredScope: "digital-ads.campaign.adjust_budget" });
    expect(result.authorized).toBe(true);
    expect(result.effectiveScope).toBe("digital-ads.campaign.*");
  });

  it("scope widening is prevented — keeps narrower scope", () => {
    const delegations: DelegationRule[] = [
      makeRule({ id: "d1", grantor: "B", grantee: "A", scope: "digital-ads.campaign.*", maxChainDepth: 5 }),
      makeRule({ id: "d2", grantor: "C", grantee: "B", scope: "digital-ads.*", maxChainDepth: 5 }),
    ];
    // B→C tries to widen from "digital-ads.campaign.*" to "digital-ads.*" but narrowScope keeps "digital-ads.campaign.*"
    const result = resolveDelegationChain("A", ["C"], delegations);
    expect(result.authorized).toBe(true);
    // Effective scope stays narrowed at "digital-ads.campaign.*"
    expect(result.effectiveScope).toBe("digital-ads.campaign.*");
  });

  it("no valid path returns unauthorized result", () => {
    const result = resolveDelegationChain("user-1", ["admin-1"], []);
    expect(result.authorized).toBe(false);
    expect(result.chain).toEqual([]);
    expect(result.depth).toBe(0);
    expect(result.effectiveScope).toBe("");
  });

  it("default maxChainDepth=1 blocks multi-hop", () => {
    const delegations: DelegationRule[] = [
      makeRule({ id: "d1", grantor: "B", grantee: "A" }), // no maxChainDepth specified → defaults to 1
      makeRule({ id: "d2", grantor: "C", grantee: "B" }),
    ];
    const result = resolveDelegationChain("A", ["C"], delegations);
    // d2 has default maxChainDepth=1, so at depth 2 it's blocked
    expect(result.authorized).toBe(false);
  });
});

describe("narrowScope", () => {
  it("wildcard defers to specific", () => {
    expect(narrowScope("*", "digital-ads.*")).toBe("digital-ads.*");
    expect(narrowScope("digital-ads.*", "*")).toBe("digital-ads.*");
  });

  it("equal scopes remain equal", () => {
    expect(narrowScope("digital-ads.campaign.adjust_budget", "digital-ads.campaign.adjust_budget")).toBe("digital-ads.campaign.adjust_budget");
  });

  it("narrows from broader to narrower", () => {
    expect(narrowScope("digital-ads.*", "digital-ads.budget.*")).toBe("digital-ads.budget.*");
  });

  it("returns null for incompatible scopes", () => {
    expect(narrowScope("digital-ads.*", "billing.*")).toBeNull();
  });

  it("widening keeps the narrower scope", () => {
    expect(narrowScope("digital-ads.budget.*", "digital-ads.*")).toBe("digital-ads.budget.*");
  });
});
