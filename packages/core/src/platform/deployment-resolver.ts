import type {
  AgentPersona,
  DeploymentContext,
  DeploymentPolicyOverrides,
} from "./deployment-context.js";
import type { TrustLevel } from "../skill-runtime/governance.js";

export interface DeploymentResolverResult {
  deploymentId: string;
  listingId: string;
  organizationId: string;
  skillSlug: string;
  trustLevel: TrustLevel;
  trustScore: number;
  persona?: AgentPersona;
  deploymentConfig: Record<string, unknown>;
  policyOverrides?: DeploymentPolicyOverrides;
}

export interface DeploymentResolver {
  resolveByChannelToken(channel: string, token: string): Promise<DeploymentResolverResult>;
  resolveByDeploymentId(deploymentId: string): Promise<DeploymentResolverResult>;
  resolveByOrgAndSlug(organizationId: string, skillSlug: string): Promise<DeploymentResolverResult>;
}

export class DeploymentInactiveError extends Error {
  constructor(
    public readonly deploymentId: string,
    reason: string,
  ) {
    super(`Deployment ${deploymentId} is inactive: ${reason}`);
    this.name = "DeploymentInactiveError";
  }
}

export function toDeploymentContext(result: DeploymentResolverResult): DeploymentContext {
  return {
    deploymentId: result.deploymentId,
    skillSlug: result.skillSlug,
    trustLevel: result.trustLevel,
    trustScore: result.trustScore,
    persona: result.persona,
    policyOverrides: result.policyOverrides,
  };
}
