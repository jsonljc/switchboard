import type { TrustLevel } from "../skill-runtime/governance.js";

export interface AgentPersona {
  businessName: string;
  tone: string;
  qualificationCriteria?: string[];
  disqualificationCriteria?: string[];
  escalationRules?: string[];
  bookingLink?: string;
  customInstructions?: string;
}

export interface DeploymentPolicyOverrides {
  circuitBreakerThreshold?: number;
  maxWritesPerHour?: number;
  allowedModelTiers?: string[];
  spendApprovalThreshold?: number;
}

export interface DeploymentContext {
  deploymentId: string;
  skillSlug: string;
  trustLevel: TrustLevel;
  trustScore: number;
  persona?: AgentPersona;
  policyOverrides?: DeploymentPolicyOverrides;
  // PR-3.2e: raw AgentDeployment.inputConfig forwarded for builders that
  // need to read typed sub-namespaces (e.g. resolveOutcomePatternsConfig
  // for the pilotMode surfacing flag). Optional because not every
  // DeploymentContext construction path resolves from a real AgentDeployment
  // row (e.g. api-direct fallback in resolve-deployment.ts).
  inputConfig?: Record<string, unknown>;
}
