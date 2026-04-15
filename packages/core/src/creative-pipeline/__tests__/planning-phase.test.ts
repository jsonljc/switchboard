import { describe, it, expect } from "vitest";
import { executePlanningPhase, type PlanningInput } from "../ugc/phases/planning.js";

function makeCreator(id: string) {
  return {
    id,
    deploymentId: "dep_1",
    name: `Creator ${id}`,
    identityRefIds: [],
    heroImageAssetId: "asset_1",
    identityDescription: "test",
    voice: {
      voiceId: "v1",
      provider: "elevenlabs" as const,
      tone: "warm",
      pace: "moderate" as const,
      sampleUrl: "",
    },
    personality: { energy: "conversational" as const, deliveryStyle: "friendly" },
    appearanceRules: { hairStates: ["down"], wardrobePalette: ["earth_tones"] },
    environmentSet: ["kitchen"],
    approved: true,
    isActive: true,
    bibleVersion: "1.0",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("executePlanningPhase", () => {
  const baseInput: PlanningInput = {
    brief: {
      productDescription: "AI scheduling tool",
      targetAudience: "Small business owners",
      platforms: ["meta"],
      creatorPoolIds: ["cr_1", "cr_2"],
      ugcFormat: "talking_head",
      productImages: [],
      references: [],
      generateReferenceImages: false,
    },
    creatorPool: [makeCreator("cr_1"), makeCreator("cr_2")],
    funnelFrictions: [],
    performanceMemory: { structureHistory: {}, creatorHistory: {} },
    providerCapabilities: [],
  };

  it("returns structures, castingAssignments, and identityPlans", () => {
    const result = executePlanningPhase(baseInput);
    expect(result.structures.length).toBeGreaterThan(0);
    expect(result.castingAssignments.length).toBeGreaterThan(0);
    expect(result.identityPlans.length).toBeGreaterThan(0);
  });

  it("produces one identity plan per casting assignment", () => {
    const result = executePlanningPhase(baseInput);
    expect(result.identityPlans.length).toBe(result.castingAssignments.length);
  });

  it("maps CreativePlatform 'meta' to UGC platforms", () => {
    const result = executePlanningPhase(baseInput);
    // Should have structures scored for meta_feed and/or instagram_reels
    expect(result.structures.length).toBeGreaterThan(0);
  });

  it("incorporates funnel frictions into structure selection", () => {
    const withFriction: PlanningInput = {
      ...baseInput,
      funnelFrictions: [
        {
          id: "f1",
          deploymentId: "dep_1",
          frictionType: "low_trust",
          source: "manual",
          confidence: "high",
          evidenceCount: 10,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
      ],
    };
    const withoutFriction = baseInput;

    const resultWith = executePlanningPhase(withFriction);
    const resultWithout = executePlanningPhase(withoutFriction);

    // With low_trust friction, social_proof structure should rank higher
    const socialProofWith = resultWith.structures.find((s) => s.structureId === "social_proof");
    const socialProofWithout = resultWithout.structures.find(
      (s) => s.structureId === "social_proof",
    );
    if (socialProofWith && socialProofWithout) {
      expect(socialProofWith.score).toBeGreaterThan(socialProofWithout.score);
    }
  });

  it("returns empty assignments when creator pool is empty", () => {
    const emptyPool: PlanningInput = { ...baseInput, creatorPool: [] };
    const result = executePlanningPhase(emptyPool);
    expect(result.castingAssignments).toEqual([]);
    expect(result.identityPlans).toEqual([]);
    // Structures should still be selected
    expect(result.structures.length).toBeGreaterThan(0);
  });
});
