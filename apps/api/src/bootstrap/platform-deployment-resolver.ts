import type {
  AuthoritativeDeploymentResolver,
  CanonicalSubmitRequest,
  DeploymentContext,
  DeploymentResolver,
} from "@switchboard/core/platform";

export function resolveAuthoritativeDeployment(
  resolver: DeploymentResolver | null,
): AuthoritativeDeploymentResolver {
  return {
    async resolve(request: CanonicalSubmitRequest): Promise<DeploymentContext> {
      const skillSlug = request.targetHint?.skillSlug ?? request.intent.split(".")[0] ?? "unknown";
      if (!resolver) {
        return {
          deploymentId: "platform-direct",
          skillSlug,
          trustLevel: "supervised" as const,
          trustScore: 0,
        };
      }
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
