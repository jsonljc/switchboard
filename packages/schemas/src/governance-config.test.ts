import { describe, it, expect } from "vitest";
import {
  GovernanceConfigSchema,
  buildObserveGovernanceConfig,
  resolveGovernanceMode,
  resolveClaimClassifierConfig,
  resolveConsentStateConfig,
  resolveLifecycleTaggingMechanicalConfig,
  resolveLifecycleQualificationConfig,
} from "./governance-config.js";

describe("buildObserveGovernanceConfig", () => {
  const cfg = buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" });

  it("parses under GovernanceConfigSchema and keeps the policy fields", () => {
    const parsed = GovernanceConfigSchema.parse(cfg);
    expect(parsed.jurisdiction).toBe("SG");
    expect(parsed.clinicType).toBe("medical");
  });

  it("puts the deterministic gate (input scanner + output safety gate) in observe", () => {
    expect(resolveGovernanceMode(GovernanceConfigSchema.parse(cfg))).toBe("observe");
  });

  it("puts the claim classifier in observe with resolver defaults intact", () => {
    const resolved = resolveClaimClassifierConfig(GovernanceConfigSchema.parse(cfg));
    expect(resolved.mode).toBe("observe");
    expect(resolved.latencyBudgetMs).toBe(800);
    expect(resolved.model).toBe("claude-haiku-4-5-20251001");
    expect(resolved.confidenceThreshold).toBe(0.7);
  });

  it("puts the consent gate in observe", () => {
    expect(resolveConsentStateConfig(GovernanceConfigSchema.parse(cfg)).mode).toBe("observe");
  });

  it("ships the whatsapp window block enabled in observe with marketing substitution off", () => {
    expect(cfg.whatsappWindow).toEqual({
      enabled: true,
      mode: "observe",
      allowMarketingTemplateSubstitution: false,
    });
  });

  it("keeps both lifecycle tagging layers off", () => {
    const parsed = GovernanceConfigSchema.parse(cfg);
    expect(resolveLifecycleTaggingMechanicalConfig(parsed).mode).toBe("off");
    expect(resolveLifecycleQualificationConfig(parsed).mode).toBe("off");
  });

  it("threads MY/nonMedical through unchanged", () => {
    const my = buildObserveGovernanceConfig({ jurisdiction: "MY", clinicType: "nonMedical" });
    expect(my.jurisdiction).toBe("MY");
    expect(my.clinicType).toBe("nonMedical");
  });

  it("never puts any gate in enforce (P2-A: the seeded posture cannot block)", () => {
    const parsed = GovernanceConfigSchema.parse(cfg);
    expect(resolveGovernanceMode(parsed)).not.toBe("enforce");
    expect(resolveClaimClassifierConfig(parsed).mode).not.toBe("enforce");
    expect(resolveConsentStateConfig(parsed).mode).not.toBe("enforce");
    expect(cfg.whatsappWindow.mode).not.toBe("enforce");
    // Structural sweep: no "enforce" string anywhere in the serialized config.
    expect(JSON.stringify(cfg)).not.toContain("enforce");
  });
});
