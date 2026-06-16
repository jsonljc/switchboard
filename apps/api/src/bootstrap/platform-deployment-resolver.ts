import type {
  AuthoritativeDeploymentResolver,
  CanonicalSubmitRequest,
  DeploymentContext,
  DeploymentResolver,
} from "@switchboard/core/platform";

/** Options for the authoritative deployment resolver wired into PlatformIngress. */
export interface ResolveAuthoritativeDeploymentOptions {
  /**
   * Predicate identifying non-skill operator_mutation intents. When true, the request resolves to a
   * platform-direct DeploymentContext instead of the strict skillSlug deployment lookup. Operator
   * mutations (cron- or owner-initiated) carry no skill deployment and are system_auto_approved, so
   * deployment trust is never consulted; resolving them to platform-direct is the honest result AND
   * avoids the deployment_not_found throw that otherwise leaves every operator mutation inert in
   * prod (their intent prefix, e.g. "ledger" / "receipt" / "booking", has no seeded deployment slug).
   * Skill intents still resolve their real deployment (and still throw if it is missing).
   */
  isOperatorMutationIntent?: (intent: string) => boolean;
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
      // operator_mutation intents are not skill-bound: resolve them to platform-direct rather than a
      // strict slug lookup that throws deployment_not_found for their non-skill intent prefix.
      if (options?.isOperatorMutationIntent?.(request.intent)) return platformDirect();
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
