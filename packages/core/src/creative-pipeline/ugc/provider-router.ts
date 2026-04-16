// packages/core/src/creative-pipeline/ugc/provider-router.ts
import type { ProviderCapabilityProfile } from "@switchboard/schemas";
import type { ProviderPerformanceHistory } from "./provider-performance.js";

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
    {
      provider: "seedance",
      role: "planned",
      identityStrength: "medium",
      supportsIdentityObject: false,
      supportsReferenceImages: true,
      supportsFirstLastFrame: true,
      supportsExtension: true,
      supportsMotionTransfer: false,
      supportsMultiShot: false,
      supportsAudioDrivenTalkingHead: false,
      supportsProductTextIntegrity: false,
      apiMaturity: "low",
      seedSupport: false,
      versionPinning: false,
    },
    {
      provider: "runway",
      role: "planned",
      identityStrength: "medium",
      supportsIdentityObject: false,
      supportsReferenceImages: true,
      supportsFirstLastFrame: true,
      supportsExtension: false,
      supportsMotionTransfer: false,
      supportsMultiShot: false,
      supportsAudioDrivenTalkingHead: false,
      supportsProductTextIntegrity: false,
      apiMaturity: "low",
      seedSupport: true,
      versionPinning: true,
    },
  ];
}

// ── Cost estimates (placeholder — SP7 adds real cost tracking) ──

const ESTIMATED_COST: Record<string, number> = {
  kling: 0.5,
  heygen: 1.0,
  seedance: 0.6,
  runway: 0.8,
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
 * Optionally integrates performance history to boost scores.
 */
export function rankProviders(
  spec: SpecForRouting,
  registry: ProviderCapabilityProfile[],
  history?: ProviderPerformanceHistory,
): RankedProvider[] {
  return registry
    .filter((p) => (p.role === "production" || p.role === "narrow_use") && p.apiMaturity !== "low")
    .map((profile) => {
      let score = scoreProvider(profile, spec);

      // Historical performance bonus (if available)
      if (history) {
        const passRate = history.passRateByProvider[profile.provider];
        if (passRate !== undefined) {
          score += passRate * 0.3; // up to +0.3 for 100% pass rate
        }
        const avgLatency = history.avgLatencyByProvider[profile.provider];
        if (avgLatency !== undefined && avgLatency > 0) {
          // Faster = better: bonus inversely proportional to latency (capped)
          score += Math.min(0.2, (5000 / avgLatency) * 0.1);
        }
      }

      return {
        profile,
        score,
        estimatedCost: ESTIMATED_COST[profile.provider] ?? 1.0,
      };
    })
    .sort((a, b) => b.score - a.score);
}
