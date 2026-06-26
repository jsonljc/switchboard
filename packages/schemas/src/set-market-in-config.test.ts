import { describe, it, expect } from "vitest";
import { buildObserveGovernanceConfig, GovernanceConfigSchema } from "./governance-config.js";
import { setMarketInConfig, GovernanceSetMarketParametersSchema } from "./set-market-in-config.js";

describe("setMarketInConfig", () => {
  const base = buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" });

  it("sets jurisdiction + clinicType", () => {
    const next = setMarketInConfig(base, { jurisdiction: "MY", clinicType: "nonMedical" });
    expect(next.jurisdiction).toBe("MY");
    expect(next.clinicType).toBe("nonMedical");
  });

  it("preserves every gate sub-block (mode + non-mode fields) unchanged", () => {
    // First flip a gate field to a non-default so we can prove it survives the market write.
    const withEnforce = {
      ...base,
      deterministicGate: { mode: "enforce" as const },
      whatsappWindow: { ...base.whatsappWindow, allowMarketingTemplateSubstitution: true },
    };
    const next = setMarketInConfig(withEnforce, { jurisdiction: "MY", clinicType: "medical" });
    expect(next.deterministicGate).toEqual({ mode: "enforce" });
    expect(next.claimClassifier).toEqual(base.claimClassifier);
    expect(next.consentState).toEqual(base.consentState);
    expect((next as typeof withEnforce).whatsappWindow.allowMarketingTemplateSubstitution).toBe(
      true,
    );
    expect(next.lifecycleTagging).toEqual(base.lifecycleTagging);
  });

  it("returns a config that still parses under GovernanceConfigSchema", () => {
    const next = setMarketInConfig(base, { jurisdiction: "MY", clinicType: "nonMedical" });
    expect(GovernanceConfigSchema.safeParse(next).success).toBe(true);
  });

  it("does not mutate the input", () => {
    setMarketInConfig(base, { jurisdiction: "MY", clinicType: "nonMedical" });
    expect(base.jurisdiction).toBe("SG");
    expect(base.clinicType).toBe("medical");
  });
});

describe("GovernanceSetMarketParametersSchema", () => {
  it("accepts a valid market mutation", () => {
    const parsed = GovernanceSetMarketParametersSchema.safeParse({
      deploymentId: "dep_1",
      jurisdiction: "MY",
      clinicType: "nonMedical",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown jurisdiction and an empty deploymentId", () => {
    expect(
      GovernanceSetMarketParametersSchema.safeParse({
        deploymentId: "dep_1",
        jurisdiction: "TH",
        clinicType: "medical",
      }).success,
    ).toBe(false);
    expect(
      GovernanceSetMarketParametersSchema.safeParse({
        deploymentId: "",
        jurisdiction: "SG",
        clinicType: "medical",
      }).success,
    ).toBe(false);
  });
});
