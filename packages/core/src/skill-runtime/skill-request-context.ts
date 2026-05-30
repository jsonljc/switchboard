import type { SkillExecutionParams, SkillRequestContext } from "./types.js";

/**
 * Pure builder for the per-request tool context. Extracted from
 * SkillExecutorImpl.buildRequestContext so the delegation-lineage fields
 * (workUnitId, delegationDepth) are unit-testable without driving a full
 * executor run. Trust-bound ids come ONLY from params, never from LLM input.
 */
export function composeSkillRequestContext(params: SkillExecutionParams): SkillRequestContext {
  return {
    sessionId: params.sessionId ?? `${params.deploymentId}-${Date.now()}`,
    orgId: params.orgId,
    deploymentId: params.deploymentId,
    workUnitId: params.workUnitId,
    delegationDepth: params.delegationDepth,
  };
}
