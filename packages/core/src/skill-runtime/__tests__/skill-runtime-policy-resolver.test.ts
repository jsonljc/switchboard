import { describe, it, expect } from "vitest";
import { SkillRuntimePolicyResolver } from "../skill-runtime-policy-resolver.js";
import type { SkillDefinition } from "../types.js";
import { DEFAULT_SKILL_RUNTIME_POLICY } from "../types.js";

const baseSkill: SkillDefinition = {
  name: "test",
  slug: "test",
  version: "1.0.0",
  description: "test",
  author: "test",
  parameters: [],
  tools: [],
  body: "test",
  context: [],
};

const baseDeployment = { trustLevel: "guarded" };

describe("SkillRuntimePolicyResolver", () => {
  const resolver = new SkillRuntimePolicyResolver();

  it("returns default policy when deployment has no overrides", () => {
    const policy = resolver.resolve(baseDeployment, baseSkill);
    expect(policy.maxToolCalls).toBe(DEFAULT_SKILL_RUNTIME_POLICY.maxToolCalls);
    expect(policy.maxLlmTurns).toBe(DEFAULT_SKILL_RUNTIME_POLICY.maxLlmTurns);
    expect(policy.maxTotalTokens).toBe(DEFAULT_SKILL_RUNTIME_POLICY.maxTotalTokens);
    expect(policy.maxRuntimeMs).toBe(DEFAULT_SKILL_RUNTIME_POLICY.maxRuntimeMs);
    expect(policy.maxWritesPerExecution).toBe(DEFAULT_SKILL_RUNTIME_POLICY.maxWritesPerExecution);
    expect(policy.maxWritesPerHour).toBe(DEFAULT_SKILL_RUNTIME_POLICY.maxWritesPerHour);
    expect(policy.writeApprovalRequired).toBe(DEFAULT_SKILL_RUNTIME_POLICY.writeApprovalRequired);
    expect(policy.circuitBreakerThreshold).toBe(
      DEFAULT_SKILL_RUNTIME_POLICY.circuitBreakerThreshold,
    );
    expect(policy.maxConcurrentExecutions).toBe(
      DEFAULT_SKILL_RUNTIME_POLICY.maxConcurrentExecutions,
    );
  });

  it("maps observe trust level to autonomous", () => {
    const policy = resolver.resolve({ trustLevel: "observe" }, baseSkill);
    expect(policy.trustLevel).toBe("autonomous");
  });

  it("maps guarded trust level to guided", () => {
    const policy = resolver.resolve({ trustLevel: "guarded" }, baseSkill);
    expect(policy.trustLevel).toBe("guided");
  });

  it("maps strict trust level to supervised", () => {
    const policy = resolver.resolve({ trustLevel: "strict" }, baseSkill);
    expect(policy.trustLevel).toBe("supervised");
  });

  it("maps locked trust level to supervised", () => {
    const policy = resolver.resolve({ trustLevel: "locked" }, baseSkill);
    expect(policy.trustLevel).toBe("supervised");
  });

  it("defaults unknown trust level to guided", () => {
    const policy = resolver.resolve({ trustLevel: "unknown-level" }, baseSkill);
    expect(policy.trustLevel).toBe("guided");
  });

  it("uses deployment circuitBreakerThreshold when set", () => {
    const policy = resolver.resolve(
      { trustLevel: "guarded", circuitBreakerThreshold: 10 },
      baseSkill,
    );
    expect(policy.circuitBreakerThreshold).toBe(10);
  });

  it("uses deployment maxWritesPerHour when set", () => {
    const policy = resolver.resolve({ trustLevel: "guarded", maxWritesPerHour: 50 }, baseSkill);
    expect(policy.maxWritesPerHour).toBe(50);
  });

  it("uses deployment allowedModelTiers when non-empty", () => {
    const policy = resolver.resolve(
      { trustLevel: "guarded", allowedModelTiers: ["default", "premium"] },
      baseSkill,
    );
    expect(policy.allowedModelTiers).toEqual(["default", "premium"]);
  });

  it("uses all tiers when allowedModelTiers is empty", () => {
    const policy = resolver.resolve({ trustLevel: "guarded", allowedModelTiers: [] }, baseSkill);
    expect(policy.allowedModelTiers).toEqual(["default", "premium", "critical"]);
  });

  it("throws when minimumModelTier not in allowedModelTiers", () => {
    const skillWithMinimum: SkillDefinition = {
      ...baseSkill,
      minimumModelTier: "critical",
    };
    expect(() =>
      resolver.resolve(
        { trustLevel: "guarded", allowedModelTiers: ["default", "premium"] },
        skillWithMinimum,
      ),
    ).toThrow(
      'Skill "test" requires minimumModelTier "critical" but deployment only allows [default, premium]',
    );
  });

  it("accepts minimumModelTier that is in allowedModelTiers", () => {
    const skillWithMinimum: SkillDefinition = {
      ...baseSkill,
      minimumModelTier: "premium",
    };
    const policy = resolver.resolve(
      { trustLevel: "guarded", allowedModelTiers: ["default", "premium", "critical"] },
      skillWithMinimum,
    );
    expect(policy.minimumModelTier).toBe("premium");
    expect(policy.allowedModelTiers).toContain("premium");
  });

  it("returns frozen policy object", () => {
    const policy = resolver.resolve(baseDeployment, baseSkill);
    expect(Object.isFrozen(policy)).toBe(true);
  });
});
