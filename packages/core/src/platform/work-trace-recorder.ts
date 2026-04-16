import type { WorkTrace } from "./work-trace.js";
import type { WorkUnit } from "./work-unit.js";
import type { GovernanceDecision } from "./governance-types.js";
import type { ExecutionResult } from "./execution-result.js";

export interface TraceInput {
  workUnit: WorkUnit;
  governanceDecision: GovernanceDecision;
  governanceCompletedAt: string;
  executionResult?: ExecutionResult;
  executionStartedAt?: string;
  completedAt?: string;
  modeMetrics?: Record<string, unknown>;
}

export interface WorkTraceStore {
  persist(trace: WorkTrace): Promise<void>;
}

export function buildWorkTrace(input: TraceInput): WorkTrace {
  const { workUnit, governanceDecision, executionResult } = input;

  let outcome: WorkTrace["outcome"];
  if (executionResult) {
    outcome = executionResult.outcome;
  } else if (governanceDecision.outcome === "deny") {
    outcome = "failed";
  } else {
    outcome = "pending_approval";
  }

  const completedAt = input.completedAt ?? new Date().toISOString();
  const requestedAt = workUnit.requestedAt;
  const durationMs = executionResult?.durationMs ?? 0;

  return {
    workUnitId: workUnit.id,
    traceId: workUnit.traceId,
    parentWorkUnitId: workUnit.parentWorkUnitId,
    intent: workUnit.intent,
    mode: workUnit.resolvedMode,
    organizationId: workUnit.organizationId,
    actor: workUnit.actor,
    trigger: workUnit.trigger,
    governanceOutcome: governanceDecision.outcome,
    riskScore: governanceDecision.riskScore,
    matchedPolicies: governanceDecision.matchedPolicies,
    outcome,
    durationMs,
    error: executionResult?.error,
    modeMetrics: input.modeMetrics,
    requestedAt,
    governanceCompletedAt: input.governanceCompletedAt,
    executionStartedAt: input.executionStartedAt,
    completedAt,
  };
}
