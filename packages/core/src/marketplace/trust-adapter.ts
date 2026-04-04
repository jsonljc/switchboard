import type { AutonomyLevel } from "@switchboard/schemas";
import type { ResolvedIdentity } from "../identity/spec.js";
import { TrustScoreEngine } from "./trust-score-engine.js";

/**
 * Resolves a governance principalId to a marketplace listing.
 * Returns null if the principal is not a marketplace agent.
 */
export type PrincipalListingResolver = (
  principalId: string,
  actionType?: string,
) => Promise<{ listingId: string; taskCategory: string } | null>;

/**
 * Adjusts a ResolvedIdentity's risk tolerance based on autonomy level.
 *
 * Rules:
 * - supervised: no changes (everything requires normal approval)
 * - guided: relax low risk to no-approval
 * - autonomous: relax low + medium risk to no-approval, high to standard
 * - critical risk is NEVER relaxed (always mandatory)
 */
export function applyAutonomyToRiskTolerance(
  identity: ResolvedIdentity,
  autonomyLevel: AutonomyLevel,
): ResolvedIdentity {
  if (autonomyLevel === "supervised") return identity;

  const tolerance = { ...identity.effectiveRiskTolerance };

  if (autonomyLevel === "guided") {
    tolerance.low = "none";
  } else if (autonomyLevel === "autonomous") {
    tolerance.low = "none";
    tolerance.medium = "none";
    if (tolerance.high === "elevated") {
      tolerance.high = "standard";
    }
  }
  // critical is never relaxed

  return { ...identity, effectiveRiskTolerance: tolerance };
}

/**
 * Bridges marketplace trust scores into the governance identity model.
 */
export class TrustScoreAdapter {
  constructor(
    private engine: TrustScoreEngine,
    private resolver: PrincipalListingResolver,
  ) {}

  async adjustIdentity(
    principalId: string,
    actionType: string,
    identity: ResolvedIdentity,
  ): Promise<ResolvedIdentity> {
    const mapping = await this.resolver(principalId, actionType);
    if (!mapping) return identity;

    const level = await this.engine.getAutonomyLevel(mapping.listingId, mapping.taskCategory);
    return applyAutonomyToRiskTolerance(identity, level);
  }

  async recordApproval(principalId: string, actionType: string): Promise<void> {
    const mapping = await this.resolver(principalId, actionType);
    if (!mapping) return;
    await this.engine.recordApproval(mapping.listingId, mapping.taskCategory);
  }

  async recordRejection(principalId: string, actionType: string): Promise<void> {
    const mapping = await this.resolver(principalId, actionType);
    if (!mapping) return;
    await this.engine.recordRejection(mapping.listingId, mapping.taskCategory);
  }
}
