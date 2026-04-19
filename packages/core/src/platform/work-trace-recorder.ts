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
  getByWorkUnitId(workUnitId: string): Promise<WorkTrace | null>;
  update(workUnitId: string, fields: Partial<WorkTrace>): Promise<void>;
  getByIdempotencyKey(key: string): Promise<WorkTrace | null>;
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

  let governanceConstraints: import("./governance-types.js").ExecutionConstraints | undefined;
  if ("constraints" in governanceDecision) {
    governanceConstraints = governanceDecision.constraints;
  }

  return {
    workUnitId: workUnit.id,
    traceId: workUnit.traceId,
    parentWorkUnitId: workUnit.parentWorkUnitId,
    deploymentId: workUnit.deployment?.deploymentId,
    intent: workUnit.intent,
    mode: workUnit.resolvedMode,
    organizationId: workUnit.organizationId,
    actor: workUnit.actor,
    trigger: workUnit.trigger,
    idempotencyKey: workUnit.idempotencyKey,

    parameters: workUnit.parameters,
    deploymentContext: workUnit.deployment,
    governanceConstraints,

    governanceOutcome: governanceDecision.outcome,
    riskScore: governanceDecision.riskScore,
    matchedPolicies: governanceDecision.matchedPolicies,
    outcome,
    durationMs,
    error: executionResult?.error,
    executionSummary: executionResult?.summary,
    executionOutputs: executionResult?.outputs,
    modeMetrics: input.modeMetrics,
    requestedAt,
    governanceCompletedAt: input.governanceCompletedAt,
    executionStartedAt: input.executionStartedAt,
    completedAt,
  };
}
