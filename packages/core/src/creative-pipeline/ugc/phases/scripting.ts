// packages/core/src/creative-pipeline/ugc/phases/scripting.ts
import { createId } from "@paralleldrive/cuid2";
import type { CreatorIdentity, CreativeWeights, IdentityPlan } from "@switchboard/schemas";
import type { CastingAssignment } from "../scene-caster.js";
import type { StructureSelection } from "../structure-engine.js";
import { runUgcScriptWriter } from "../ugc-script-writer.js";
import { generateDirection } from "../ugc-director.js";

// ── Types ──

interface UgcBriefInput {
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  creatorPoolIds: string[];
  ugcFormat: string;
  brandVoice?: string | null;
}

interface PlanningOutputInput {
  structures: StructureSelection[];
  castingAssignments: CastingAssignment[];
  identityPlans: IdentityPlan[];
}

export interface ScriptingInput {
  planningOutput: PlanningOutputInput;
  brief: UgcBriefInput;
  creatorPool: CreatorIdentity[];
  creativeWeights: CreativeWeights;
  apiKey: string;
}

interface CreativeSpecOutput {
  specId: string;
  deploymentId?: string;
  mode: "ugc";
  creatorId: string;
  structureId: string;
  motivator: string;
  platform: string;
  script: { text: string; language: string; claimsPolicyTag?: string };
  style: Record<string, unknown>;
  direction: Record<string, unknown>;
  format: string;
  identityConstraints: Record<string, unknown>;
  continuityConstraints?: Record<string, unknown>;
  renderTargets: { aspect: string; durationSec: number };
  qaThresholds: { faceSimilarityMin: number; realismMin: number };
  providersAllowed: string[];
  campaignTags: Record<string, string>;
}

export interface ScriptingOutput {
  specs: CreativeSpecOutput[];
}

// ── Helpers ──

function findCreator(pool: CreatorIdentity[], id: string): CreatorIdentity | undefined {
  return pool.find((c) => c.id === id);
}

function findStructure(
  structures: StructureSelection[],
  id: string,
): StructureSelection | undefined {
  return structures.find((s) => s.structureId === id);
}

function findIdentityPlan(plans: IdentityPlan[], creatorId: string): IdentityPlan | undefined {
  return plans.find((p) => p.creatorId === creatorId);
}

function mapPlatformToUgc(platform: string): string[] {
  switch (platform) {
    case "meta":
      return ["meta_feed", "instagram_reels"];
    case "tiktok":
      return ["tiktok"];
    default:
      return [];
  }
}

function estimateDuration(sections: Array<{ durationRange: [number, number] }>): number {
  return sections.reduce((sum, s) => sum + (s.durationRange[0] + s.durationRange[1]) / 2, 0);
}

// ── Phase execution ──

export async function executeScriptingPhase(input: ScriptingInput): Promise<ScriptingOutput> {
  const { planningOutput, brief, creatorPool, creativeWeights, apiKey } = input;
  const { castingAssignments, structures, identityPlans } = planningOutput;

  if (!castingAssignments || castingAssignments.length === 0) {
    return { specs: [] };
  }

  const ugcPlatforms = brief.platforms.flatMap(mapPlatformToUgc);
  if (ugcPlatforms.length === 0) ugcPlatforms.push("meta_feed");
  const specs: CreativeSpecOutput[] = [];

  for (const casting of castingAssignments) {
    const creator = findCreator(creatorPool, casting.creatorId);
    const structure = findStructure(structures, casting.structureId);
    const identityPlan = findIdentityPlan(identityPlans, casting.creatorId);

    if (!creator || !structure) continue;

    // Generate script via Claude
    const scriptResult = await runUgcScriptWriter({
      brief: {
        productDescription: brief.productDescription,
        targetAudience: brief.targetAudience,
        brandVoice: brief.brandVoice ?? null,
      },
      creator: {
        name: creator.name,
        personality: creator.personality as {
          energy: string;
          deliveryStyle: string;
          catchphrases?: string[];
          forbiddenPhrases?: string[];
        },
      },
      structure: {
        id: structure.template.id,
        name: structure.template.name,
        sections: structure.template.sections,
      },
      scriptConstraints: creativeWeights.scriptConstraints,
      hookDirectives: creativeWeights.hookDirectives,
      apiKey,
    });

    // Generate direction (pure function)
    const { sceneStyle, ugcDirection } = generateDirection({
      creator: {
        personality: creator.personality as { energy: string; deliveryStyle: string },
        appearanceRules: creator.appearanceRules as {
          hairStates: string[];
          wardrobePalette: string[];
        },
        environmentSet: creator.environmentSet,
      },
      structure: {
        id: structure.template.id,
        name: structure.template.name,
        sections: structure.template.sections,
      },
      platform: ugcPlatforms[0],
      ugcFormat: brief.ugcFormat,
    });

    const specId = createId();
    const durationSec = estimateDuration(structure.template.sections);

    specs.push({
      specId,
      mode: "ugc",
      creatorId: casting.creatorId,
      structureId: casting.structureId,
      motivator: "general",
      platform: ugcPlatforms[0],
      script: {
        text: scriptResult.text,
        language: scriptResult.language,
        claimsPolicyTag: scriptResult.claimsPolicyTag,
      },
      style: sceneStyle as unknown as Record<string, unknown>,
      direction: ugcDirection as unknown as Record<string, unknown>,
      format: brief.ugcFormat,
      identityConstraints: identityPlan
        ? {
            strategy: identityPlan.primaryStrategy,
            ...(identityPlan.constraints as Record<string, unknown>),
          }
        : { strategy: "reference_conditioning", maxIdentityDrift: 0.5 },
      renderTargets: {
        aspect: "9:16",
        durationSec,
      },
      qaThresholds: {
        faceSimilarityMin: 0.7,
        realismMin: 0.5,
      },
      providersAllowed: ["kling"],
      campaignTags: {},
    });
  }

  return { specs };
}
