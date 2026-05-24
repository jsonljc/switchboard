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
      };
    },
  };
}
