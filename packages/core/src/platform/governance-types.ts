import type { ModelSlot } from "../model-router.js";

/**
 * Per-execution resource limits set by the governance gate.
 * Intentionally a subset of SkillRuntimePolicy — Phase 3 maps
 * these into SkillRuntimePolicy for skill-mode execution.
 * Remaining SkillRuntimePolicy fields come from deployment config.
 */
export interface ExecutionConstraints {
  allowedModelTiers: ModelSlot[];
  maxToolCalls: number;
  maxLlmTurns: number;
  maxTotalTokens: number;
  maxRuntimeMs: number;
  maxWritesPerExecution: number;
  trustLevel: "supervised" | "guided" | "autonomous";
}

export type GovernanceDecision =
  | {
      outcome: "execute";
      riskScore: number;
      budgetProfile: string;
      constraints: ExecutionConstraints;
      matchedPolicies: string[];
    }
  | {
      outcome: "require_approval";
      riskScore: number;
      approvalLevel: string;
      approvers: string[];
      constraints: ExecutionConstraints;
      matchedPolicies: string[];
    }
  | {
      outcome: "deny";
      reasonCode: string;
      riskScore: number;
      matchedPolicies: string[];
    };
