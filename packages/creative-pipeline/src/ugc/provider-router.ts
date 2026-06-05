// packages/core/src/creative-pipeline/ugc/provider-router.ts
import type { ProviderCapabilityProfile } from "@switchboard/schemas";
import { KLING_COST_PER_5S, HEYGEN_COST_PER_CLIP } from "../stages/cost-estimator.js";
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
  /**
   * Per-provider attempt cap (slice-3 spec 3.5): heygen gets ONE attempt
   * before fallback (it ranks first for avatar talking-heads, and its
   * submit-poll calls are minutes long; Kling-style triple attempts would
   * let a heygen outage stall the whole production step). Absent = the
   * spec's retryConfig.maxAttempts applies.
   */
  attemptLimit?: number;
}

const PROVIDER_ATTEMPT_LIMIT: Record<string, number> = {
  heygen: 1,
};

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

// ── Cost estimates ──
// kling + heygen are ALIGNED to the cost-estimator constants (slice-3 specs
// 3.3b/3.5): the production budget accumulator counts these per attempt, and
// the governance spend estimate uses the estimator rates; the two must not
// disagree. EXPORTED for the parity tests. Seedance/runway stay placeholders
// until their providers are real.

export const ESTIMATED_COST: Record<string, number> = {
  kling: KLING_COST_PER_5S,
  heygen: HEYGEN_COST_PER_CLIP,
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
        ...(PROVIDER_ATTEMPT_LIMIT[profile.provider] !== undefined
          ? { attemptLimit: PROVIDER_ATTEMPT_LIMIT[profile.provider] }
          : {}),
      };
    })
    .sort((a, b) => b.score - a.score);
}
