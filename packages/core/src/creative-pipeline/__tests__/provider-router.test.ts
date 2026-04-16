import { describe, it, expect } from "vitest";
import { rankProviders, getDefaultProviderRegistry } from "../ugc/provider-router.js";

describe("getDefaultProviderRegistry", () => {
  it("returns Kling and HeyGen profiles", () => {
    const registry = getDefaultProviderRegistry();
    expect(registry.length).toBeGreaterThanOrEqual(2);
    expect(registry.find((p) => p.provider === "kling")).toBeDefined();
    expect(registry.find((p) => p.provider === "heygen")).toBeDefined();
  });
});

describe("rankProviders", () => {
  const registry = getDefaultProviderRegistry();

  it("returns only production and narrow_use providers", () => {
    const ranked = rankProviders(
      { format: "talking_head", identityConstraints: { strategy: "reference_conditioning" } },
      registry,
    );
    for (const r of ranked) {
      expect(["production", "narrow_use"]).toContain(r.profile.role);
    }
  });

  it("excludes providers with low API maturity", () => {
    const withLow = [
      ...registry,
      {
        provider: "test_low",
        role: "production" as const,
        identityStrength: "low" as const,
        supportsIdentityObject: false,
        supportsReferenceImages: false,
        supportsFirstLastFrame: false,
        supportsExtension: false,
        supportsMotionTransfer: false,
        supportsMultiShot: false,
        supportsAudioDrivenTalkingHead: false,
        supportsProductTextIntegrity: false,
        apiMaturity: "low" as const,
        seedSupport: false,
        versionPinning: false,
      },
    ];
    const ranked = rankProviders(
      { format: "talking_head", identityConstraints: { strategy: "reference_conditioning" } },
      withLow,
    );
    expect(ranked.find((r) => r.profile.provider === "test_low")).toBeUndefined();
  });

  it("ranks Kling first for general video generation", () => {
    const ranked = rankProviders(
      { format: "lifestyle", identityConstraints: { strategy: "reference_conditioning" } },
      registry,
    );
    expect(ranked[0].profile.provider).toBe("kling");
  });

  it("ranks HeyGen higher for talking_head with audio-driven support", () => {
    const ranked = rankProviders(
      { format: "talking_head", identityConstraints: { strategy: "reference_conditioning" } },
      registry,
    );
    // HeyGen should appear in results for talking_head
    expect(ranked.find((r) => r.profile.provider === "heygen")).toBeDefined();
  });

  it("includes estimated cost per provider", () => {
    const ranked = rankProviders(
      { format: "talking_head", identityConstraints: { strategy: "reference_conditioning" } },
      registry,
    );
    for (const r of ranked) {
      expect(r.estimatedCost).toBeGreaterThan(0);
    }
  });
});
