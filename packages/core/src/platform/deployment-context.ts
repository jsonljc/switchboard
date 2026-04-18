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
}
