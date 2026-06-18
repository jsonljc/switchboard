import type {
  AuthoritativeDeploymentResolver,
  CanonicalSubmitRequest,
  DeploymentContext,
  DeploymentResolver,
} from "@switchboard/core/platform";

/** Options for the authoritative deployment resolver wired into PlatformIngress. */
export interface ResolveAuthoritativeDeploymentOptions {
  /**
   * Predicate identifying non-skill, platform-initiated intents that resolve to a platform-direct
   * DeploymentContext instead of the strict skillSlug deployment lookup. Two classes qualify:
   *  - operator_mutation intents (cron- or owner-initiated, e.g. "ledger" / "receipt" / "booking"),
   *    which are system_auto_approved so deployment trust is never consulted; and
   *  - Robin's no-show recovery campaign (robin.recovery_campaign.send), a cron-initiated no-agent
   *    capability that PARKS via a seeded mandatory require_approval policy. platform-direct
   *    (supervised / trustScore 0) cannot relax that mandatory gate, so resolving it here is the
   *    honest result AND avoids the deployment_not_found throw that would otherwise leave the gate
   *    inert in prod (slug "robin" has no seeded deployment).
   * Skill intents still resolve their real deployment (and still throw if it is missing).
   */
  isPlatformDirectIntent?: (intent: string) => boolean;
}

export function resolveAuthoritativeDeployment(
  resolver: DeploymentResolver | null,
  options?: ResolveAuthoritativeDeploymentOptions,
): AuthoritativeDeploymentResolver {
  return {
    async resolve(request: CanonicalSubmitRequest): Promise<DeploymentContext> {
      const skillSlug = request.targetHint?.skillSlug ?? request.intent.split(".")[0] ?? "unknown";
      const platformDirect = (): DeploymentContext => ({
        deploymentId: "platform-direct",
        skillSlug,
        trustLevel: "supervised" as const,
        trustScore: 0,
      });
      // Non-skill, platform-initiated intents (operator_mutation crons + Robin's recovery campaign)
      // resolve to platform-direct rather than a strict slug lookup that throws deployment_not_found
      // for their non-skill intent prefix.
      if (options?.isPlatformDirectIntent?.(request.intent)) return platformDirect();
      if (!resolver) return platformDirect();
      const result = await resolver.resolveByOrgAndSlug(request.organizationId, skillSlug);
      return {
        deploymentId: result.deploymentId,
        skillSlug: result.skillSlug,
        trustLevel: result.trustLevel,
        trustScore: result.trustScore,
        // Forward the launch-posture trust override so GovernanceGate can honor it.
        // Without this, the resolved override is silently dropped before reaching
        // the gate and the auto-allow posture has no runtime effect.
        trustLevelOverride: result.trustLevelOverride,
        // Forward policyOverrides so spendApprovalThreshold reaches GovernanceGate's
        // spend-approval autonomy lever. Dropping it here is the #644 footgun that
        // left the stored threshold inert in production. (persona/inputConfig are
        // also dropped by this live mapper — a separate, out-of-scope #644 gap.)
        policyOverrides: result.policyOverrides,
        // Forward the explicit spend-autonomy opt-in. The threshold column is
        // always populated (Float @default 50), so this separate flag — not the
        // threshold's presence — is what activates the lever.
        spendAutonomyEnabled: result.spendAutonomyEnabled,
      };
    },
  };
}
