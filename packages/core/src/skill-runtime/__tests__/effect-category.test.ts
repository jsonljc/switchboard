import { describe, it, expect } from "vitest";
import {
  GOVERNANCE_POLICY,
  getToolGovernanceDecision,
  type EffectCategory,
  type TrustLevel,
  type GovernanceDecision,
} from "../governance.js";
import type { SkillToolOperation } from "../types.js";
import { ok } from "../tool-result.js";

const ALL_EFFECT_CATEGORIES: EffectCategory[] = [
  "read",
  "propose",
  "simulate",
  "write",
  "external_send",
  "external_mutation",
  "irreversible",
];

const ALL_TRUST_LEVELS: TrustLevel[] = ["supervised", "guided", "autonomous"];

function makeOp(
  tier: EffectCategory,
  override?: Partial<Record<TrustLevel, GovernanceDecision>>,
): SkillToolOperation {
  return {
    description: "test op",
    inputSchema: {},
    effectCategory: tier,
    governanceOverride: override,
    execute: async () => ok(),
  };
}

describe("EffectCategory governance policy", () => {
  it("has all 7 effect categories in GOVERNANCE_POLICY", () => {
    const keys = Object.keys(GOVERNANCE_POLICY);
    for (const cat of ALL_EFFECT_CATEGORIES) {
      expect(keys).toContain(cat);
    }
    expect(keys).toHaveLength(7);
  });

  describe("read, propose, simulate → auto-approve at all trust levels", () => {
    for (const cat of ["read", "propose", "simulate"] as EffectCategory[]) {
      for (const trust of ALL_TRUST_LEVELS) {
        it(`${cat} + ${trust} = auto-approve`, () => {
          expect(GOVERNANCE_POLICY[cat][trust]).toBe("auto-approve");
        });
      }
    }
  });

  describe("write → require-approval under supervised, auto-approve otherwise", () => {
    it("write + supervised = require-approval", () => {
      expect(GOVERNANCE_POLICY.write.supervised).toBe("require-approval");
    });
    it("write + guided = auto-approve", () => {
      expect(GOVERNANCE_POLICY.write.guided).toBe("auto-approve");
    });
    it("write + autonomous = auto-approve", () => {
      expect(GOVERNANCE_POLICY.write.autonomous).toBe("auto-approve");
    });
  });

  describe("external_send and external_mutation → require-approval under supervised+guided", () => {
    for (const cat of ["external_send", "external_mutation"] as EffectCategory[]) {
      it(`${cat} + supervised = require-approval`, () => {
        expect(GOVERNANCE_POLICY[cat].supervised).toBe("require-approval");
      });
      it(`${cat} + guided = require-approval`, () => {
        expect(GOVERNANCE_POLICY[cat].guided).toBe("require-approval");
      });
      it(`${cat} + autonomous = auto-approve`, () => {
        expect(GOVERNANCE_POLICY[cat].autonomous).toBe("auto-approve");
      });
    }
  });

  describe("irreversible → deny under supervised, require-approval otherwise", () => {
    it("irreversible + supervised = deny", () => {
      expect(GOVERNANCE_POLICY.irreversible.supervised).toBe("deny");
    });
    it("irreversible + guided = require-approval", () => {
      expect(GOVERNANCE_POLICY.irreversible.guided).toBe("require-approval");
    });
    it("irreversible + autonomous = require-approval", () => {
      expect(GOVERNANCE_POLICY.irreversible.autonomous).toBe("require-approval");
    });
  });
});

describe("getToolGovernanceDecision with EffectCategory", () => {
  it("returns policy decision for a new category", () => {
    const op = makeOp("external_send");
    expect(getToolGovernanceDecision(op, "guided")).toBe("require-approval");
  });

  it("returns policy decision for simulate", () => {
    const op = makeOp("simulate");
    expect(getToolGovernanceDecision(op, "supervised")).toBe("auto-approve");
  });

  it("respects governanceOverride on new categories", () => {
    const op = makeOp("irreversible", { supervised: "auto-approve" });
    expect(getToolGovernanceDecision(op, "supervised")).toBe("auto-approve");
  });

  it("falls back to policy when override is not set for the trust level", () => {
    const op = makeOp("irreversible", { guided: "auto-approve" });
    expect(getToolGovernanceDecision(op, "supervised")).toBe("deny");
  });
});
