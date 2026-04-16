import { describe, it, expect, vi } from "vitest";
import { executeScriptingPhase, type ScriptingInput } from "../ugc/phases/scripting.js";

vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn().mockResolvedValue({
    text: "Hey so honestly I need to tell you about this scheduling tool...",
    language: "en",
  }),
}));

function makeCreator(id: string) {
  return {
    id,
    name: `Creator ${id}`,
    personality: { energy: "conversational", deliveryStyle: "friendly" },
    appearanceRules: { hairStates: ["down"], wardrobePalette: ["earth_tones"] },
    environmentSet: ["kitchen"],
  };
}

function makeStructure(id: string) {
  return {
    structureId: id,
    template: {
      id,
      name: `Structure ${id}`,
      sections: [
        { name: "hook", purposeGuide: "Open strong", durationRange: [3, 5] as [number, number] },
        { name: "body", purposeGuide: "Main content", durationRange: [10, 20] as [number, number] },
        { name: "cta", purposeGuide: "Close", durationRange: [3, 5] as [number, number] },
      ],
      platformAffinity: {},
      funnelFrictionAffinity: {},
    },
    score: 0.9,
  };
}

describe("executeScriptingPhase", () => {
  const baseInput: ScriptingInput = {
    planningOutput: {
      structures: [makeStructure("confession")],
      castingAssignments: [{ creatorId: "cr_1", structureId: "confession", score: 0.9 }],
      identityPlans: [
        {
          creatorId: "cr_1",
          primaryStrategy: "reference_conditioning",
          fallbackChain: ["asset_reuse"],
          constraints: {
            maxIdentityDrift: 0.5,
            lockHairState: false,
            lockWardrobe: false,
            requireExactReuse: false,
          },
        },
      ],
    },
    brief: {
      productDescription: "AI scheduling tool",
      targetAudience: "Small business owners",
      platforms: ["meta"],
      creatorPoolIds: ["cr_1"],
      ugcFormat: "talking_head",
    },
    creatorPool: [makeCreator("cr_1")] as any,
    creativeWeights: {
      structurePriorities: {},
      motivatorPriorities: {},
      scriptConstraints: [],
      hookDirectives: [],
    },
    apiKey: "test-key",
  };

  it("produces one CreativeSpec per casting assignment", async () => {
    const result = await executeScriptingPhase(baseInput);
    expect(result.specs).toHaveLength(1);
  });

  it("each spec has a unique specId", async () => {
    const inputWith2 = {
      ...baseInput,
      planningOutput: {
        ...baseInput.planningOutput,
        castingAssignments: [
          { creatorId: "cr_1", structureId: "confession", score: 0.9 },
          { creatorId: "cr_2", structureId: "social_proof", score: 0.8 },
        ],
        structures: [makeStructure("confession"), makeStructure("social_proof")],
        identityPlans: [
          {
            creatorId: "cr_1",
            primaryStrategy: "reference_conditioning" as const,
            fallbackChain: [],
            constraints: {
              maxIdentityDrift: 0.5,
              lockHairState: false,
              lockWardrobe: false,
              requireExactReuse: false,
            },
          },
          {
            creatorId: "cr_2",
            primaryStrategy: "reference_conditioning" as const,
            fallbackChain: [],
            constraints: {
              maxIdentityDrift: 0.5,
              lockHairState: false,
              lockWardrobe: false,
              requireExactReuse: false,
            },
          },
        ],
      },
      creatorPool: [makeCreator("cr_1"), makeCreator("cr_2")] as any,
    };
    const result = await executeScriptingPhase(inputWith2);
    expect(result.specs).toHaveLength(2);
    expect(result.specs[0].specId).not.toBe(result.specs[1].specId);
  });

  it("spec includes script, style, direction, and identity constraints", async () => {
    const result = await executeScriptingPhase(baseInput);
    const spec = result.specs[0];
    expect(spec.script.text).toBeTruthy();
    expect(spec.style).toBeDefined();
    expect(spec.direction).toBeDefined();
    expect(spec.identityConstraints).toBeDefined();
    expect(spec.mode).toBe("ugc");
  });

  it("returns empty specs when no casting assignments", async () => {
    const emptyInput = {
      ...baseInput,
      planningOutput: { ...baseInput.planningOutput, castingAssignments: [], identityPlans: [] },
    };
    const result = await executeScriptingPhase(emptyInput);
    expect(result.specs).toEqual([]);
  });
});
