// packages/core/src/creative-pipeline/ugc/phases/scripting.ts
import { createId } from "@paralleldrive/cuid2";
import type { CreatorIdentity, CreativeWeights, IdentityPlan } from "@switchboard/schemas";
import type { CastingAssignment } from "../scene-caster.js";
import type { StructureSelection } from "../structure-engine.js";
import { runUgcScriptWriter } from "../ugc-script-writer.js";
import { generateDirection } from "../ugc-director.js";
import { getProviderRef } from "../identity-refs.js";
import { evaluateClaimSafety, deriveClaimsPolicyTag } from "../claim-safety.js";

// ── Types ──

interface UgcBriefInput {
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  creatorPoolIds: string[];
  ugcFormat: string;
  brandVoice?: string | null;
  productImages?: string[];
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
  /** Claude model id override; threaded from the UGC runner's LLMConfig. */
  model?: string;
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
  /** Product grounding image for image2video (product_in_hand only; spec 3.2). */
  referenceImageUrl?: string;
  /** Avatar refs from the cast creator (slice-3 spec 3.5; heygen routing). */
  creator?: { heygenAvatarId: string; heygenVoiceId?: string };
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
  const { planningOutput, brief, creatorPool, creativeWeights, apiKey, model } = input;
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
      model,
    });

    // Claim-safety gate (EV-13 / BUG-8): run the deterministic detector over the
    // generated script and DERIVE the validated `claimsPolicyTag` from its
    // verdict, superseding any unvalidated model-emitted tag. A flagged script is
    // tagged "review_required"; the production phase blocks it before any paid
    // video generation. The creator's forbidden phrases join the global UGC list.
    const claimSafety = evaluateClaimSafety({
      text: scriptResult.text,
      forbiddenPhrases: (creator.personality as { forbiddenPhrases?: string[] }).forbiddenPhrases,
    });
    const claimsPolicyTag = deriveClaimsPolicyTag(claimSafety);
    if (claimSafety.verdict === "flagged") {
      console.warn(
        `[scripting] claim-safety flagged the generated script for creator "${creator.name}" ` +
          `(spec routed to human review, blocked from paid production): ` +
          claimSafety.violations.map((v) => `${v.category}:"${v.matchedText}"`).join(", "),
      );
    }

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
      platform: ugcPlatforms[0]!,
      ugcFormat: brief.ugcFormat,
    });

    const specId = createId();
    const durationSec = estimateDuration(structure.template.sections);

    // Capability-aware routing (slice-3 spec 3.5): heygen joins the allowed
    // set ONLY for talking_head specs whose creator carries an explicit
    // heygen avatar ref (avatars speak; lifestyle b-roll stays kling).
    const heygenAvatarId = getProviderRef(creator, "heygen");
    const heygenAllowed = brief.ugcFormat === "talking_head" && !!heygenAvatarId;

    specs.push({
      specId,
      mode: "ugc",
      creatorId: casting.creatorId,
      structureId: casting.structureId,
      motivator: "general",
      platform: ugcPlatforms[0]!,
      script: {
        text: scriptResult.text,
        language: scriptResult.language,
        // Validated + derived from the deterministic detector, NOT the raw model
        // string (which was captured but never parsed/enforced before EV-13).
        claimsPolicyTag,
      },
      style: sceneStyle as unknown as Record<string, unknown>,
      direction: ugcDirection as unknown as Record<string, unknown>,
      // image2video uses the reference as the FIRST FRAME: grounding a
      // talking-head video on a product still would hijack the scene, so the
      // image rides product_in_hand specs only (slice-3 spec 3.2).
      ...(brief.ugcFormat === "product_in_hand" && brief.productImages?.[0]
        ? { referenceImageUrl: brief.productImages[0] }
        : {}),
      ...(heygenAllowed ? { creator: { heygenAvatarId: heygenAvatarId! } } : {}),
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
      providersAllowed: heygenAllowed ? ["kling", "heygen"] : ["kling"],
      campaignTags: {},
    });
  }

  return { specs };
}
