import { describe, it, expect } from "vitest";
import {
  GovernanceConfigSchema,
  GovernanceModeSchema,
  resolveGovernanceMode,
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
