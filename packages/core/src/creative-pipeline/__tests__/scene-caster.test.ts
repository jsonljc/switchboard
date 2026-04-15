import { describe, it, expect } from "vitest";
import { castCreators, type CastingInput } from "../ugc/scene-caster.js";
import type { StructureSelection } from "../ugc/structure-engine.js";

function makeCreator(id: string, energy: string = "conversational") {
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
    personality: { energy, deliveryStyle: "friendly" },
    appearanceRules: { hairStates: ["down"], wardrobePalette: ["earth_tones"] },
    environmentSet: ["kitchen"],
    approved: true,
    isActive: true,
    bibleVersion: "1.0",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeStructure(id: string, score: number): StructureSelection {
  return {
    structureId: id as any,
    template: {
      id: id as any,
      name: id,
      sections: [],
      platformAffinity: {},
      funnelFrictionAffinity: {},
    },
    score,
  };
}

describe("castCreators", () => {
  it("assigns each creator to a structure", () => {
    const input: CastingInput = {
      structures: [makeStructure("confession", 0.9), makeStructure("social_proof", 0.7)],
      creatorPool: [makeCreator("cr_1"), makeCreator("cr_2")],
      platforms: ["meta_feed"],
      creativeWeights: {
        structurePriorities: {},
        motivatorPriorities: {},
        scriptConstraints: [],
        hookDirectives: [],
      },
      performanceMemory: { structureHistory: {}, creatorHistory: {} },
      recentCastings: [],
    };
    const result = castCreators(input);
    expect(result.length).toBeGreaterThan(0);
    // Each assignment has a creatorId and structureId
    for (const assignment of result) {
      expect(assignment.creatorId).toBeTruthy();
      expect(assignment.structureId).toBeTruthy();
      expect(assignment.score).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns empty when no creators", () => {
    const input: CastingInput = {
      structures: [makeStructure("confession", 0.9)],
      creatorPool: [],
      platforms: ["meta_feed"],
      creativeWeights: {
        structurePriorities: {},
        motivatorPriorities: {},
        scriptConstraints: [],
        hookDirectives: [],
      },
      performanceMemory: { structureHistory: {}, creatorHistory: {} },
      recentCastings: [],
    };
    expect(castCreators(input)).toEqual([]);
  });

  it("applies repetition penalty for recent castings", () => {
    const creator = makeCreator("cr_1");
    const structure = makeStructure("confession", 0.9);

    const fresh: CastingInput = {
      structures: [structure],
      creatorPool: [creator],
      platforms: ["meta_feed"],
      creativeWeights: {
        structurePriorities: {},
        motivatorPriorities: {},
        scriptConstraints: [],
        hookDirectives: [],
      },
      performanceMemory: { structureHistory: {}, creatorHistory: {} },
      recentCastings: [],
    };
    const repeated: CastingInput = {
      ...fresh,
      recentCastings: [{ creatorId: "cr_1", structureId: "confession" }],
    };

    const freshResult = castCreators(fresh);
    const repeatedResult = castCreators(repeated);
    expect(repeatedResult[0].score).toBeLessThan(freshResult[0].score);
  });
});
