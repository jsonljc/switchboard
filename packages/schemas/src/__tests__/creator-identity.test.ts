import { describe, expect, it } from "vitest";
import { CreatorIdentitySchema } from "../creator-identity.js";

const base = {
  id: "cr_1",
  deploymentId: "dep_1",
  name: "Julia",
  identityRefIds: [],
  heroImageAssetId: "asset_hero",
  identityDescription: "calm, neutral",
  voice: {
    voiceId: "v_1",
    provider: "elevenlabs" as const,
    tone: "warm",
    pace: "moderate" as const,
    sampleUrl: "https://cdn/v.mp3",
  },
  personality: { energy: "calm" as const, deliveryStyle: "natural" },
  appearanceRules: {
    hairStates: ["loose"],
    wardrobePalette: ["neutral"],
  },
  environmentSet: ["bathroom"],
  approved: true,
  isActive: true,
  bibleVersion: "1.0",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("CreatorIdentitySchema with tier extensions", () => {
  it("accepts a record without tier fields (back-compat)", () => {
    const r = CreatorIdentitySchema.parse(base);
    expect(r.qualityTier).toBeUndefined();
  });

  it("accepts qualityTier=anchored with consentRecordId null", () => {
    const r = CreatorIdentitySchema.parse({
      ...base,
      qualityTier: "anchored",
      consentRecordId: null,
      identityAdapter: null,
    });
    expect(r.qualityTier).toBe("anchored");
    expect(r.identityAdapter).toBeNull();
  });

  it("accepts qualityTier=soul_id with a populated identityAdapter", () => {
    const r = CreatorIdentitySchema.parse({
      ...base,
      qualityTier: "soul_id",
      consentRecordId: "cr_consent_1",
      identityAdapter: {
        provider: "internal_lora",
        modelRef: "s3://bucket/lora.safetensors",
        trainedAt: new Date().toISOString(),
        trainedFromAssetIds: ["a1", "a2"],
        tenantId: "dep_1",
        status: "ready",
      },
    });
    expect(r.identityAdapter?.status).toBe("ready");
  });

  it("rejects unknown qualityTier", () => {
    expect(() => CreatorIdentitySchema.parse({ ...base, qualityTier: "platinum" })).toThrow();
  });
});
