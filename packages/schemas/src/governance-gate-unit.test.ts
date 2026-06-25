import { describe, it, expect } from "vitest";
import {
  GOVERNANCE_GATE_UNITS,
  GovernanceGateUnitSchema,
  sourceGuardToGateUnit,
  GATE_UNIT_CONFIG_KEY,
  readGateMode,
} from "./governance-gate-unit.js";
import { buildObserveGovernanceConfig } from "./governance-config.js";

describe("governance gate units", () => {
  it("has exactly the four flippable units", () => {
    expect([...GOVERNANCE_GATE_UNITS]).toEqual(["deterministic", "claims", "consent", "whatsapp"]);
  });

  it("parses a valid unit and rejects an unknown one", () => {
    expect(GovernanceGateUnitSchema.parse("consent")).toBe("consent");
    expect(GovernanceGateUnitSchema.safeParse("recovery").success).toBe(false);
  });

  it("maps each unit to its config sub-block key", () => {
    expect(GATE_UNIT_CONFIG_KEY).toEqual({
      deterministic: "deterministicGate",
      claims: "claimClassifier",
      consent: "consentState",
      whatsapp: "whatsappWindow",
    });
  });

  it("maps the five flippable-gate sourceGuards to units; escalation_trigger -> null", () => {
    expect(sourceGuardToGateUnit("banned_phrase_scanner")).toBe("deterministic");
    expect(sourceGuardToGateUnit("price_gate")).toBe("deterministic");
    expect(sourceGuardToGateUnit("claim_classifier")).toBe("claims");
    expect(sourceGuardToGateUnit("consent_gate")).toBe("consent");
    expect(sourceGuardToGateUnit("whatsapp_window")).toBe("whatsapp");
    expect(sourceGuardToGateUnit("escalation_trigger")).toBeNull();
  });
});

describe("readGateMode", () => {
  const observe = buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" });

  it("reads each unit's mode from an all-observe config", () => {
    expect(readGateMode(observe, "deterministic")).toBe("observe");
    expect(readGateMode(observe, "claims")).toBe("observe");
    expect(readGateMode(observe, "consent")).toBe("observe");
    expect(readGateMode(observe, "whatsapp")).toBe("observe");
  });

  it("reads a per-unit enforce flip", () => {
    const flipped = { ...observe, deterministicGate: { mode: "enforce" as const } };
    expect(readGateMode(flipped, "deterministic")).toBe("enforce");
    expect(readGateMode(flipped, "claims")).toBe("observe"); // siblings unaffected
  });

  it("returns off for a null config or an absent sub-block", () => {
    expect(readGateMode(null, "deterministic")).toBe("off");
    expect(readGateMode(null, "whatsapp")).toBe("off");
    expect(
      readGateMode(
        { jurisdiction: "SG", clinicType: "medical" } as never as typeof observe,
        "whatsapp",
      ),
    ).toBe("off");
  });

  it("coerces a malformed whatsappWindow.mode to off", () => {
    const bad = { ...observe, whatsappWindow: { enabled: true, mode: "bogus" } } as never;
    expect(readGateMode(bad, "whatsapp")).toBe("off");
  });

  it("does NOT throw on a parent-valid config with a corrupt claimClassifier sub-block (reads off)", () => {
    // The parent schema is passthrough, so a bad claimClassifier sub-block survives a
    // parent safeParse; readGateMode must coerce it to "off", never throw (regression).
    const corrupt = {
      ...observe,
      claimClassifier: { mode: "bogus", latencyBudgetMs: -5 },
    } as never;
    expect(() => readGateMode(corrupt, "claims")).not.toThrow();
    expect(readGateMode(corrupt, "claims")).toBe("off");
  });
});
