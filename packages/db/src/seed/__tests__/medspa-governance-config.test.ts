import { describe, it, expect } from "vitest";
import {
  GovernanceConfigSchema,
  buildObserveGovernanceConfig,
  resolveGovernanceMode,
  resolveClaimClassifierConfig,
  resolveConsentStateConfig,
  resolveLifecycleTaggingMechanicalConfig,
  resolveLifecycleQualificationConfig,
} from "@switchboard/schemas";
import type { WhatsAppWindowGateConfig } from "@switchboard/core/skill-runtime";
import { MEDSPA_PILOT_GOVERNANCE_CONFIG } from "../medspa-governance-config.js";

// Producer-parity net: the LITERAL value the seed writes must parse and resolve to a
// strictly observe (log-only) posture for every gate. A schema/resolver change that
// silently de-activates or escalates the seeded posture reds this file.
describe("MEDSPA_PILOT_GOVERNANCE_CONFIG (the literal seeded blob)", () => {
  it("is exactly the canonical observe posture for SG/medical", () => {
    expect(MEDSPA_PILOT_GOVERNANCE_CONFIG).toEqual(
      buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" }),
    );
  });

  it("parses under GovernanceConfigSchema", () => {
    expect(() => GovernanceConfigSchema.parse(MEDSPA_PILOT_GOVERNANCE_CONFIG)).not.toThrow();
  });

  it("resolves observe for every mode-bearing gate and off for lifecycle tagging", () => {
    const parsed = GovernanceConfigSchema.parse(MEDSPA_PILOT_GOVERNANCE_CONFIG);
    expect(resolveGovernanceMode(parsed)).toBe("observe");
    expect(resolveClaimClassifierConfig(parsed).mode).toBe("observe");
    expect(resolveConsentStateConfig(parsed).mode).toBe("observe");
    expect(resolveLifecycleTaggingMechanicalConfig(parsed).mode).toBe("off");
    expect(resolveLifecycleQualificationConfig(parsed).mode).toBe("off");
  });

  it("matches the whatsapp window gate's config block shape (compile-time pin)", () => {
    // The gate casts this block without Zod validation (whatsapp-window-gate.ts
    // resolveConfig); this assignment breaks at typecheck if the gate's config
    // interface gains or renames a required field.
    const block: Omit<WhatsAppWindowGateConfig, "jurisdiction" | "clinicType"> =
      MEDSPA_PILOT_GOVERNANCE_CONFIG.whatsappWindow;
    expect(block).toEqual({
      enabled: true,
      mode: "observe",
      allowMarketingTemplateSubstitution: false,
    });
  });
});
