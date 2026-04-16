// packages/core/src/creative-pipeline/ugc/identity-strategy-router.ts
import type { IdentityPlan, IdentityStrategy } from "@switchboard/schemas";
import type { CastingAssignment } from "./scene-caster.js";

// ── Types ──

interface IdentityRoutingOptions {
  requireExactReuse?: boolean;
  maxIdentityDrift?: number;
  lockHairState?: boolean;
  lockWardrobe?: boolean;
}

// ── Decision Logic ──
// Phase 1 reality: Only reference_conditioning and asset_reuse are implemented.
// platform_identity activates when Kling ships character/identity APIs.
// fine_tuned_identity is Phase 4 (SP10).

/**
 * Decides how identity is enforced for a casting assignment.
 * Returns an IdentityPlan with primary strategy and fallback chain.
 */
export function routeIdentityStrategy(
  casting: CastingAssignment,
  options: IdentityRoutingOptions,
): IdentityPlan {
  const requireExactReuse = options.requireExactReuse ?? false;

  // Decision tree (spec Section 4.3)
  let primaryStrategy: IdentityStrategy;
  let fallbackChain: IdentityStrategy[];

  if (requireExactReuse) {
    primaryStrategy = "asset_reuse";
    fallbackChain = []; // No fallback — exact reuse or fail
  } else {
    // Phase 1: reference_conditioning is the default
    primaryStrategy = "reference_conditioning";
    fallbackChain = ["asset_reuse"]; // Fall back to reusing an approved asset
  }

  return {
    creatorId: casting.creatorId,
    primaryStrategy,
    fallbackChain,
    constraints: {
      maxIdentityDrift: options.maxIdentityDrift ?? 0.5,
      lockHairState: options.lockHairState ?? false,
      lockWardrobe: options.lockWardrobe ?? false,
      requireExactReuse,
    },
  };
}
