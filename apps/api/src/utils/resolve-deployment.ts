import type { DeploymentResolver, DeploymentContext } from "@switchboard/core/platform";
import { toDeploymentContext } from "@switchboard/core/platform";

export async function resolveDeploymentForIntent(
  resolver: DeploymentResolver | null,
  organizationId: string,
  intent: string,
): Promise<DeploymentContext> {
  const skillSlug = intent.split(".")[0] ?? "unknown";

  if (!resolver) {
    return {
      deploymentId: "api-direct",
      skillSlug,
      trustLevel: "supervised",
      trustScore: 0,
    };
  }

  try {
    const result = await resolver.resolveByOrgAndSlug(organizationId, skillSlug);
    return toDeploymentContext(result);
  } catch {
    return {
      deploymentId: "api-direct",
      skillSlug,
      trustLevel: "supervised",
      trustScore: 0,
    };
  }
}
