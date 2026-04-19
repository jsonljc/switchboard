import type { DeploymentResolver, DeploymentResolverResult } from "@switchboard/core/platform";

export class StaticDeploymentResolver implements DeploymentResolver {
  private readonly result: DeploymentResolverResult;

  constructor(config: { deploymentId?: string; organizationId?: string; skillSlug?: string }) {
    this.result = {
      deploymentId: config.deploymentId ?? "single-tenant",
      listingId: "single-tenant",
      organizationId: config.organizationId ?? process.env["ORGANIZATION_ID"] ?? "default",
      skillSlug: config.skillSlug ?? process.env["SKILL_SLUG"] ?? "sales-pipeline",
      trustLevel: "supervised",
      trustScore: 0,
      deploymentConfig: {},
    };
  }

  async resolveByChannelToken(_channel: string, _token: string): Promise<DeploymentResolverResult> {
    return this.result;
  }

  async resolveByDeploymentId(_deploymentId: string): Promise<DeploymentResolverResult> {
    return this.result;
  }

  async resolveByOrgAndSlug(_orgId: string, _slug: string): Promise<DeploymentResolverResult> {
    return this.result;
  }
}
