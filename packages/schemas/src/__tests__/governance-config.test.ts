import { describe, it, expect } from "vitest";
import {
  GovernanceConfigSchema,
  GovernanceModeSchema,
  resolveGovernanceMode,
  ClaimClassifierConfigSchema,
  resolveClaimClassifierConfig,
  ConsentStateConfigSchema,
  resolveConsentStateConfig,
  LifecycleTaggingMechanicalConfigSchema,
  resolveLifecycleTaggingMechanicalConfig,
} from "../governance-config.js";

describe("GovernanceModeSchema", () => {
  it("accepts off, observe, enforce", () => {
    for (const m of ["off", "observe", "enforce"]) {
      expect(GovernanceModeSchema.safeParse(m).success).toBe(true);
    }
  });

  it("rejects other strings", () => {
    expect(GovernanceModeSchema.safeParse("disabled").success).toBe(false);
  });
});

describe("GovernanceConfigSchema", () => {
  it("validates a minimal SG enforce config", () => {
    const cfg = {
      jurisdiction: "SG",
      clinicType: "medical",
      deterministicGate: { mode: "enforce" },
    };
    const result = GovernanceConfigSchema.safeParse(cfg);
    expect(result.success).toBe(true);
  });

  it("defaults deterministicGate.mode to 'off'", () => {
    const result = GovernanceConfigSchema.parse({
      jurisdiction: "MY",
      clinicType: "nonMedical",
    });
    expect(result.deterministicGate.mode).toBe("off");
  });

  it("rejects unknown jurisdiction", () => {
    expect(
      GovernanceConfigSchema.safeParse({
        jurisdiction: "US",
        clinicType: "medical",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown clinicType", () => {
    expect(
      GovernanceConfigSchema.safeParse({
        jurisdiction: "SG",
        clinicType: "wellness",
      }).success,
    ).toBe(false);
  });

  it("preserves unknown sub-blocks via passthrough", () => {
    const result = GovernanceConfigSchema.parse({
      jurisdiction: "SG",
      clinicType: "medical",
      consent: { phase: "1c-stub" },
    } as unknown);
    expect((result as { consent?: unknown }).consent).toEqual({
      phase: "1c-stub",
    });
  });
});

describe("resolveGovernanceMode", () => {
  it("returns 'off' for null", () => {
    expect(resolveGovernanceMode(null)).toBe("off");
  });

  it("returns the configured mode", () => {
    expect(
      resolveGovernanceMode({
        jurisdiction: "SG",
        clinicType: "medical",
        deterministicGate: { mode: "observe" },
      }),
    ).toBe("observe");
  });
});

describe("ClaimClassifierConfigSchema", () => {
  it("applies defaults when no fields provided", () => {
    const parsed = ClaimClassifierConfigSchema.parse({});
    expect(parsed).toEqual({
      mode: "off",
      latencyBudgetMs: 800,
      model: "claude-haiku-4-5-20251001",
    });
  });

  it("accepts an explicit enforce config", () => {
    const parsed = ClaimClassifierConfigSchema.parse({
      mode: "enforce",
      latencyBudgetMs: 1200,
      model: "claude-sonnet-4-6",
    });
    expect(parsed).toEqual({
      mode: "enforce",
      latencyBudgetMs: 1200,
      model: "claude-sonnet-4-6",
    });
  });

  it("rejects non-positive latencyBudgetMs", () => {
    expect(ClaimClassifierConfigSchema.safeParse({ latencyBudgetMs: 0 }).success).toBe(false);
    expect(ClaimClassifierConfigSchema.safeParse({ latencyBudgetMs: -1 }).success).toBe(false);
  });

  it("rejects unknown mode", () => {
    expect(ClaimClassifierConfigSchema.safeParse({ mode: "warn" }).success).toBe(false);
  });
});

describe("resolveClaimClassifierConfig", () => {
  it("returns full defaults for null config", () => {
    const resolved = resolveClaimClassifierConfig(null);
    expect(resolved.mode).toBe("off");
    expect(resolved.latencyBudgetMs).toBe(800);
    expect(resolved.model).toBe("claude-haiku-4-5-20251001");
  });

  it("returns defaults when claimClassifier sub-block is absent", () => {
    const config = GovernanceConfigSchema.parse({
      jurisdiction: "SG",
      clinicType: "medical",
    });
    const resolved = resolveClaimClassifierConfig(config);
    expect(resolved.mode).toBe("off");
  });

  it("reads enforce mode from passthrough sub-block", () => {
    const config = GovernanceConfigSchema.parse({
      jurisdiction: "SG",
      clinicType: "medical",
      claimClassifier: {
        mode: "enforce",
        latencyBudgetMs: 600,
        model: "claude-haiku-4-5-20251001",
      },
    });
    const resolved = resolveClaimClassifierConfig(config);
    expect(resolved.mode).toBe("enforce");
    expect(resolved.latencyBudgetMs).toBe(600);
  });
});

describe("ConsentStateConfigSchema", () => {
  it("defaults mode to off", () => {
    expect(ConsentStateConfigSchema.parse({})).toEqual({ mode: "off" });
  });

  it("accepts explicit observe / enforce", () => {
    expect(ConsentStateConfigSchema.parse({ mode: "observe" })).toEqual({ mode: "observe" });
    expect(ConsentStateConfigSchema.parse({ mode: "enforce" })).toEqual({ mode: "enforce" });
  });

  it("rejects unknown modes", () => {
    expect(() => ConsentStateConfigSchema.parse({ mode: "audit" })).toThrow();
  });
});

describe("resolveConsentStateConfig", () => {
  it("returns default when config is null", () => {
    expect(resolveConsentStateConfig(null)).toEqual({ mode: "off" });
  });

  it("returns default when sub-block is absent", () => {
    const config = GovernanceConfigSchema.parse({
      jurisdiction: "SG",
      clinicType: "medical",
    });
    expect(resolveConsentStateConfig(config)).toEqual({ mode: "off" });
  });

  it("reads sub-block via passthrough", () => {
    const config = GovernanceConfigSchema.parse({
      jurisdiction: "MY",
      clinicType: "nonMedical",
      consentState: { mode: "enforce" },
    });
    expect(resolveConsentStateConfig(config)).toEqual({ mode: "enforce" });
  });
});

describe("LifecycleTaggingMechanicalConfigSchema", () => {
  it("defaults mode to off when absent", () => {
    expect(LifecycleTaggingMechanicalConfigSchema.parse({}).mode).toBe("off");
  });

  it("accepts mode='on'", () => {
    expect(LifecycleTaggingMechanicalConfigSchema.parse({ mode: "on" }).mode).toBe("on");
  });

  it("rejects unknown modes", () => {
    expect(() => LifecycleTaggingMechanicalConfigSchema.parse({ mode: "observe" })).toThrow();
  });
});

describe("resolveLifecycleTaggingMechanicalConfig", () => {
  it("returns mode=off when the sub-block is absent (and when config is null)", () => {
    expect(resolveLifecycleTaggingMechanicalConfig(null).mode).toBe("off");
    const cfg = GovernanceConfigSchema.parse({ jurisdiction: "SG", clinicType: "medical" });
    expect(resolveLifecycleTaggingMechanicalConfig(cfg).mode).toBe("off");
  });

  it("returns mode=on when set under lifecycleTagging.mechanical", () => {
    const cfg = GovernanceConfigSchema.parse({
      jurisdiction: "SG",
      clinicType: "medical",
      lifecycleTagging: { mechanical: { mode: "on" } },
    });
    expect(resolveLifecycleTaggingMechanicalConfig(cfg).mode).toBe("on");
  });
});
