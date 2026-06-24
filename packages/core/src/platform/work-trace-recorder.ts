import type { WorkTrace } from "./work-trace.js";
import type { WorkUnit } from "./work-unit.js";
import type { GovernanceDecision } from "./governance-types.js";
import type { ExecutionResult } from "./execution-result.js";
import type { IntegrityVerdict } from "./work-trace-integrity.js";
import { WORK_TRACE_HASH_VERSION_LATEST } from "./work-trace-hash.js";
import { assertNoMutatingBypass } from "./work-trace-bypass-guard.js";

export interface TraceInput {
  workUnit: WorkUnit;
  governanceDecision: GovernanceDecision;
  governanceCompletedAt: string;
  executionResult?: ExecutionResult;
  executionStartedAt?: string;
  completedAt?: string;
  modeMetrics?: Record<string, unknown>;
  /**
   * How this row enters persistence. Defaults to "platform_ingress" — the
   * standard PlatformIngress.submit() path. Stores that record operator
   * mutations outside ingress (see ConversationStateStore) pass
   * "store_recorded_operator_mutation".
   */
  ingressPath?: WorkTrace["ingressPath"];
}

export type WorkTraceUpdateResult =
  | { ok: true; trace: WorkTrace }
  | { ok: false; code: "WORK_TRACE_LOCKED"; traceUnchanged: true; reason: string };

export interface WorkTraceReadResult {
  trace: WorkTrace;
  integrity: IntegrityVerdict;
}

export type WorkTraceClaimResult = { claimed: true } | { claimed: false };

export interface WorkTraceStore {
  persist(trace: WorkTrace): Promise<void>;
  /**
   * Atomically claim an idempotency key by inserting a `running` WorkTrace
   * BEFORE the domain mutation (D1). Returns `{ claimed: false }` when the
   * (organizationId, idempotencyKey) unique already exists — the caller lost
   * the race or a prior attempt already claimed. Throws on transient store
   * errors so the caller can retry. This return value is the concurrency lock
   * for PlatformIngress's claim-first execute path; unlike persist(), it must
   * NOT swallow the idempotency P2002 to void.
   */
  claim(trace: WorkTrace): Promise<WorkTraceClaimResult>;
  getByWorkUnitId(workUnitId: string): Promise<WorkTraceReadResult | null>;
  update(
    workUnitId: string,
    fields: Partial<WorkTrace>,
    options?: {
      caller?: string;
      /**
       * Opt-in tenant tripwire (#643). When provided, the store asserts the
       * fetched row's organizationId matches before mutating, throwing a
       * not-found error otherwise. Omit to preserve back-compat (no guard).
       * Other WorkTraceStore implementations may ignore this field.
       */
      organizationId?: string;
    },
  ): Promise<WorkTraceUpdateResult>;
  getByIdempotencyKey(organizationId: string, key: string): Promise<WorkTraceReadResult | null>;
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

  const trace: WorkTrace = {
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
    injectedPatternIds: executionResult?.injectedPatternIds ?? [],
    modeMetrics: input.modeMetrics,
    requestedAt,
    governanceCompletedAt: input.governanceCompletedAt,
    executionStartedAt: input.executionStartedAt,
    completedAt,
    ingressPath: input.ingressPath ?? "platform_ingress",
    hashInputVersion: WORK_TRACE_HASH_VERSION_LATEST,
    contactId: workUnit.contactId,
    conversationThreadId: workUnit.conversationThreadId,
  };

  // Doctrine guard: never emit a trace that attests to a mutating bypass
  // (executed-without-approval / approve-after-execute). See work-trace-bypass-guard.ts.
  assertNoMutatingBypass(trace);

  return trace;
}

export interface ClaimTraceInput {
  workUnit: WorkUnit;
  governanceDecision: GovernanceDecision;
  governanceCompletedAt: string;
  executionStartedAt: string;
}

/**
 * Build the `running` WorkTrace persisted as an idempotency CLAIM before the
 * domain mutation (D1). Unlike buildWorkTrace there is no executionResult yet:
 * outcome is `running`, executionStartedAt is sealed here (ONE_SHOT — never
 * re-sent at finalize), and completedAt/error/outputs are intentionally absent.
 */
export function buildClaimTrace(input: ClaimTraceInput): WorkTrace {
  const { workUnit, governanceDecision } = input;

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
    outcome: "running",
    durationMs: 0,
    injectedPatternIds: [],
    requestedAt: workUnit.requestedAt,
    governanceCompletedAt: input.governanceCompletedAt,
    executionStartedAt: input.executionStartedAt,
    ingressPath: "platform_ingress",
    hashInputVersion: WORK_TRACE_HASH_VERSION_LATEST,
    contactId: workUnit.contactId,
    conversationThreadId: workUnit.conversationThreadId,
  };
}
