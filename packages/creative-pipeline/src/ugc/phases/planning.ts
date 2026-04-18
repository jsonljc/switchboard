// packages/core/src/creative-pipeline/ugc/phases/planning.ts
import type {
  CreatorIdentity,
  FunnelFriction,
  ProviderCapabilityProfile,
  IdentityPlan,
} from "@switchboard/schemas";
import { translateFrictions } from "../funnel-friction-translator.js";
import { selectStructures, type StructureSelection } from "../structure-engine.js";
import { castCreators, type CastingAssignment } from "../scene-caster.js";
import { routeIdentityStrategy } from "../identity-strategy-router.js";

// ── Types ──

interface UgcBriefInput {
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  creatorPoolIds: string[];
  ugcFormat: string;
  imperfectionProfile?: unknown;
  productImages?: string[];
  references?: string[];
  generateReferenceImages?: boolean;
}

interface PerformanceMemory {
  structureHistory: Record<string, { avgCtr?: number; avgHoldRate?: number }>;
  creatorHistory: Record<string, unknown>;
}

export interface PlanningInput {
  brief: UgcBriefInput;
  creatorPool: CreatorIdentity[];
  funnelFrictions: FunnelFriction[];
  performanceMemory: PerformanceMemory;
  providerCapabilities: ProviderCapabilityProfile[];
}

export interface PlanningOutput {
  structures: StructureSelection[];
  castingAssignments: CastingAssignment[];
  identityPlans: IdentityPlan[];
}

// ── Platform mapping ──

function mapPlatformToUgc(platform: string): string[] {
  switch (platform) {
    case "meta":
      return ["meta_feed", "instagram_reels"];
    case "tiktok":
      return ["tiktok"];
    default:
      return []; // youtube and others not supported by UGC v2
  }
}

// ── Phase execution ──

const MAX_STRUCTURES = 3;

export function executePlanningPhase(input: PlanningInput): PlanningOutput {
  const { brief, creatorPool, funnelFrictions, performanceMemory } = input;

  // 1. Map platforms to UGC-specific targets
  const ugcPlatforms = brief.platforms.flatMap(mapPlatformToUgc);
  if (ugcPlatforms.length === 0) {
    // Fallback: if no UGC platforms matched, use meta_feed
    ugcPlatforms.push("meta_feed");
  }

  // 2. Translate funnel frictions into creative weights
  const creativeWeights = translateFrictions(funnelFrictions);

  // 3. Select structures
  const structures = selectStructures({
    platforms: ugcPlatforms,
    creativeWeights,
    performanceMemory,
    recentStructureIds: [], // TODO: SP8 adds recent structure tracking
    maxResults: MAX_STRUCTURES,
  });

  // 4. Cast creators to structures
  const castingAssignments = castCreators({
    structures,
    creatorPool,
    platforms: ugcPlatforms,
    creativeWeights,
    performanceMemory,
    recentCastings: [], // TODO: SP8 adds recent casting tracking
  });

  // 5. Route identity strategy for each casting
  const identityPlans: IdentityPlan[] = castingAssignments.map((casting) =>
    routeIdentityStrategy(casting, {}),
  );

  return { structures, castingAssignments, identityPlans };
}
