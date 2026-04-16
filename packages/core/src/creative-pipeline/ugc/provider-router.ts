// packages/core/src/creative-pipeline/ugc/provider-router.ts
import type { ProviderCapabilityProfile } from "@switchboard/schemas";

// ── Types ──

interface SpecForRouting {
  format: string;
  identityConstraints: { strategy: string };
}

export interface RankedProvider {
  profile: ProviderCapabilityProfile;
  score: number;
  estimatedCost: number;
}

// ── Default Provider Registry (Phase 1) ──

export function getDefaultProviderRegistry(): ProviderCapabilityProfile[] {
  return [
    {
      provider: "kling",
      role: "production",
      identityStrength: "medium",
      supportsIdentityObject: false,
      supportsReferenceImages: true,
      supportsFirstLastFrame: false,
      supportsExtension: false,
      supportsMotionTransfer: false,
      supportsMultiShot: false,
      supportsAudioDrivenTalkingHead: false,
      supportsProductTextIntegrity: false,
      apiMaturity: "high",
      seedSupport: false,
      versionPinning: false,
    },
    {
      provider: "heygen",
      role: "narrow_use",
      identityStrength: "high",
      supportsIdentityObject: true,
      supportsReferenceImages: true,
      supportsFirstLastFrame: false,
      supportsExtension: false,
      supportsMotionTransfer: false,
      supportsMultiShot: false,
      supportsAudioDrivenTalkingHead: true,
      supportsProductTextIntegrity: false,
      apiMaturity: "medium",
      seedSupport: false,
      versionPinning: false,
    },
  ];
}

// ── Cost estimates (placeholder — SP7 adds real cost tracking) ──

const ESTIMATED_COST: Record<string, number> = {
  kling: 0.5,
  heygen: 1.0,
};

// ── Ranking ──

function scoreProvider(profile: ProviderCapabilityProfile, spec: SpecForRouting): number {
  let score = 0;

  // Base role score
  if (profile.role === "production") score += 1.0;
  else if (profile.role === "narrow_use") score += 0.5;

  // API maturity
  if (profile.apiMaturity === "high") score += 0.5;
  else if (profile.apiMaturity === "medium") score += 0.25;

  // Format-specific scoring
  if (spec.format === "talking_head" && profile.supportsAudioDrivenTalkingHead) {
    score += 0.8;
  }

  // Identity strategy fit
  if (spec.identityConstraints.strategy === "platform_identity" && profile.supportsIdentityObject) {
    score += 0.6;
  }
  if (
    spec.identityConstraints.strategy === "reference_conditioning" &&
    profile.supportsReferenceImages
  ) {
    score += 0.4;
  }

  return score;
}

/**
 * Ranks eligible providers for a given spec.
 * Only production and narrow_use providers with non-low maturity are eligible.
 */
export function rankProviders(
  spec: SpecForRouting,
  registry: ProviderCapabilityProfile[],
): RankedProvider[] {
  return registry
    .filter((p) => (p.role === "production" || p.role === "narrow_use") && p.apiMaturity !== "low")
    .map((profile) => ({
      profile,
      score: scoreProvider(profile, spec),
      estimatedCost: ESTIMATED_COST[profile.provider] ?? 1.0,
    }))
    .sort((a, b) => b.score - a.score);
}
