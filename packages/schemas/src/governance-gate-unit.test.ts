import { describe, it, expect } from "vitest";
import {
  GOVERNANCE_GATE_UNITS,
  GovernanceGateUnitSchema,
  sourceGuardToGateUnit,
  GATE_UNIT_CONFIG_KEY,
} from "./governance-gate-unit.js";

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
