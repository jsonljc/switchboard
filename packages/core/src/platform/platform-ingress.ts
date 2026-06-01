/* eslint-disable max-lines -- this file crossed the 600-line guideline when the
   D1 claim-first replay guard + trace-persistence helpers (claim/finalize/
   runWithRetry) were added (PR #780). Suggested seam: extract the trace-persistence
   orchestration (runWithRetry/persistTrace/claimIdempotency/finalizeTrace/
   recordInfrastructureFailure) into a dedicated IngressTracePersister collaborator.
   Remove this disable when the file is split. */
import type { IntentRegistry } from "./intent-registry.js";
import type { ExecutionModeRegistry } from "./execution-mode-registry.js";
import type { GovernanceDecision } from "./governance-types.js";
import type { ExecutionResult } from "./execution-result.js";
import type { IngressError } from "./ingress-error.js";
import type { IntentRegistration } from "./intent-registration.js";
import type { WorkUnit } from "./work-unit.js";
import type { WorkTraceStore } from "./work-trace-recorder.js";
import type {
  AuthoritativeDeploymentResolver,
  CanonicalSubmitRequest,
} from "./canonical-request.js";
import type { BillingEntitlementResolver } from "../billing/entitlement.js";
import type { ApprovalLifecycleService } from "../approval/lifecycle-service.js";
import type { ApprovalRoutingConfig } from "../approval/router.js";
import type { AuditLedger } from "../audit/ledger.js";
import type { OperatorAlerter } from "../observability/operator-alerter.js";
import { NoopOperatorAlerter, safeAlert } from "../observability/operator-alerter.js";
import { buildInfrastructureFailureAuditParams } from "../observability/infrastructure-failure.js";
import { DEFAULT_ROUTING_CONFIG } from "../approval/router.js";
import { normalizeWorkUnit } from "./work-unit.js";
import { buildWorkTrace, buildClaimTrace } from "./work-trace-recorder.js";
import { computeBindingHash, hashObject } from "../approval/binding.js";

export const TRACE_PERSIST_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 100,
  factor: 4,
  jitterRatio: 0.25,
} as const;

const defaultDelayFn = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function jitteredDelayMs(attempt: number): number {
  // attempt is 1-indexed; delay applies BEFORE attempt 2 and BEFORE attempt 3.
  const { baseDelayMs, factor, jitterRatio } = TRACE_PERSIST_RETRY_POLICY;
  const base = baseDelayMs * Math.pow(factor, attempt - 2);
  const jitter = base * jitterRatio;
  return Math.max(0, base + (Math.random() * 2 - 1) * jitter);
}

export interface GovernanceGateInterface {
  evaluate(workUnit: WorkUnit, registration: IntentRegistration): Promise<GovernanceDecision>;
}

export interface PlatformIngressConfig {
  intentRegistry: IntentRegistry;
  modeRegistry: ExecutionModeRegistry;
  governanceGate: GovernanceGateInterface;
  deploymentResolver: AuthoritativeDeploymentResolver;
  traceStore?: WorkTraceStore;
  lifecycleService?: ApprovalLifecycleService;
  approvalRoutingConfig?: ApprovalRoutingConfig;
  entitlementResolver?: BillingEntitlementResolver;
  auditLedger?: AuditLedger;
  operatorAlerter?: OperatorAlerter;
  /** Injectable for tests — defaults to setTimeout-based delay. */
  delayFn?: (ms: number) => Promise<void>;
}

export type SubmitWorkResponse =
  | { ok: true; result: ExecutionResult; workUnit: WorkUnit }
  | { ok: false; error: IngressError }
  | {
      ok: true;
      result: ExecutionResult;
      workUnit: WorkUnit;
      approvalRequired: true;
      lifecycleId?: string;
      bindingHash?: string;
    };

export class PlatformIngress {
  private readonly config: PlatformIngressConfig;
  private readonly alerter: OperatorAlerter;

  constructor(config: PlatformIngressConfig) {
    this.config = config;
    this.alerter = config.operatorAlerter ?? new NoopOperatorAlerter();
  }

  async submit(request: CanonicalSubmitRequest): Promise<SubmitWorkResponse> {
    const { intentRegistry, modeRegistry, governanceGate, traceStore, deploymentResolver } =
      this.config;

    // 0. Idempotency check — return existing result if key matches prior trace.
    // Note: this runs before the entitlement check (step 1.5), so a replay of a
    // previously-authorized request returns the cached response even if the org
    // has since become unentitled. This is intentional: idempotency guarantees
    // identical replay, and the original mutation was already authorized at the
    // time of first submission. Entitlement is enforced for new (non-cached)
    // submissions, not re-evaluated on replays.
    if (request.idempotencyKey && traceStore) {
      const existingResult = await traceStore.getByIdempotencyKey(
        request.organizationId,
        request.idempotencyKey,
      );
      if (existingResult) {
        const existingTrace = existingResult.trace;
        // D1: a `running` trace is an unresolved CLAIM from a prior keyed
        // attempt — committed-but-unconfirmed (finalize blipped), or a
        // concurrent in-flight submit. The prior mutation may have committed,
        // so we must never re-execute. Fail closed (non-retryable; needs
        // reconciliation). A `running` trace reached via this org-scoped
        // idempotency-key lookup is exclusively an ingress claim — the
        // conversation/lifecycle stores persist only KEYLESS `running` rows,
        // which this lookup can never return — so the branch never shadows a
        // legitimate cached result (completed/failed/queued/pending_approval
        // fall through).
        if (existingTrace.outcome === "running") {
          return {
            ok: false,
            error: {
              type: "idempotency_in_flight",
              intent: request.intent,
              message:
                `A prior attempt for idempotency key "${request.idempotencyKey}" is unresolved and ` +
                `may have already committed. Not re-executing to avoid a double-apply; manual ` +
                `reconciliation required.`,
              retryable: false,
            },
          };
        }
        const result: ExecutionResult = {
          workUnitId: existingTrace.workUnitId,
          outcome: existingTrace.outcome,
          summary: existingTrace.executionSummary ?? "Duplicate request — returning prior result",
          outputs: existingTrace.executionOutputs ?? {},
          mode: existingTrace.mode,
          durationMs: existingTrace.durationMs,
          traceId: existingTrace.traceId,
          error: existingTrace.error,
        };
        return {
          ok: true as const,
          result,
          workUnit: {
            id: existingTrace.workUnitId,
            requestedAt: existingTrace.requestedAt,
            organizationId: existingTrace.organizationId,
            actor: existingTrace.actor,
            intent: existingTrace.intent,
            parameters: existingTrace.parameters ?? {},
            deployment: existingTrace.deploymentContext!,
            resolvedMode: existingTrace.mode,
            traceId: existingTrace.traceId,
            trigger: existingTrace.trigger,
            priority: "normal" as const,
            idempotencyKey: existingTrace.idempotencyKey,
          },
        };
      }
    }

    // 1. Lookup intent
    const registration = intentRegistry.lookup(request.intent);
    if (!registration) {
      return {
        ok: false,
        error: {
          type: "intent_not_found",
          intent: request.intent,
          message: `Intent not found: ${request.intent}`,
        },
      };
    }

    // 1.5. Entitlement check — block unpaid/canceled/etc. orgs at the canonical chokepoint.
    // No generic actor.kind="system" bypass: every real action checks the org's entitlement.
    if (this.config.entitlementResolver) {
      const entitlement = await this.config.entitlementResolver.resolve(request.organizationId);
      if (!entitlement.entitled) {
        return {
          ok: false,
          error: {
            type: "entitlement_required",
            intent: request.intent,
            message: `Organization ${request.organizationId} is not entitled to execute paid actions (status: ${entitlement.blockedStatus})`,
            blockedStatus: entitlement.blockedStatus,
          },
        };
      }
    }

    // 2. Validate trigger
    if (!intentRegistry.validateTrigger(request.intent, request.trigger)) {
      return {
        ok: false,
        error: {
          type: "trigger_not_allowed",
          intent: request.intent,
          message: `Trigger "${request.trigger}" is not allowed for intent "${request.intent}"`,
        },
      };
    }

    // 3. Resolve deployment + mode + normalize
    const resolvedMode = intentRegistry.resolveMode(request.intent, request.suggestedMode);

    let deployment;
    try {
      deployment = await deploymentResolver.resolve(request);
    } catch (err) {
      return {
        ok: false,
        error: {
          type: "deployment_not_found",
          intent: request.intent,
          message:
            err instanceof Error
              ? `Deployment resolution failed: ${err.message}`
              : "Deployment resolution failed",
        },
      };
    }

    const workUnit = normalizeWorkUnit(
      {
        ...request,
        deployment,
        suggestedMode: resolvedMode,
      },
      resolvedMode,
    );

    // 4. Governance gate
    let decision: GovernanceDecision;
    const governanceCompletedAt = new Date().toISOString();
    try {
      decision = await governanceGate.evaluate(workUnit, registration);
    } catch (governanceErr) {
      decision = {
        outcome: "deny",
        reasonCode: "GOVERNANCE_ERROR",
        riskScore: 1,
        matchedPolicies: [],
      };

      await this.recordInfrastructureFailure({
        errorType: "governance_eval_exception",
        error: governanceErr,
        workUnit,
        retryable: false,
      });

      const result = this.buildFailedResult(
        workUnit,
        "GOVERNANCE_ERROR",
        "Governance evaluation failed",
      );
      await this.persistTrace(traceStore, workUnit, decision, governanceCompletedAt, result);
      return { ok: true, result, workUnit };
    }

    // 5. Deny
    if (decision.outcome === "deny") {
      const result = this.buildFailedResult(workUnit, decision.reasonCode, "Denied by governance");
      await this.persistTrace(traceStore, workUnit, decision, governanceCompletedAt, result);
      return { ok: true, result, workUnit };
    }

    // 6. Require approval — create lifecycle atomically if service available
    if (decision.outcome === "require_approval") {
      const result: ExecutionResult = {
        workUnitId: workUnit.id,
        outcome: "pending_approval",
        summary: "Awaiting approval",
        outputs: {},
        mode: workUnit.resolvedMode,
        durationMs: 0,
        traceId: workUnit.traceId,
      };
      await this.persistTrace(traceStore, workUnit, decision, governanceCompletedAt, result);

      if (this.config.lifecycleService) {
        const routingConfig = this.config.approvalRoutingConfig ?? DEFAULT_ROUTING_CONFIG;
        const expiresAt = new Date(Date.now() + routingConfig.defaultExpiryMs);
        const bindingHash = computeBindingHash({
          envelopeId: workUnit.id,
          envelopeVersion: 1,
          actionId: `prop_${workUnit.id}`,
          parameters: workUnit.parameters,
          decisionTraceHash: hashObject({ intent: workUnit.intent }),
          contextSnapshotHash: hashObject({ actor: workUnit.actor.id }),
        });

        const { lifecycle, revision } = await this.config.lifecycleService.createGatedLifecycle({
          actionEnvelopeId: workUnit.id,
          organizationId: workUnit.organizationId,
          expiresAt,
          initialRevision: {
            parametersSnapshot: workUnit.parameters,
            approvalScopeSnapshot: {
              approvers: routingConfig.defaultApprovers,
              riskCategory: (decision as Record<string, unknown>).riskCategory ?? "medium",
              fallbackApprover: routingConfig.defaultFallbackApprover,
            },
            bindingHash,
            createdBy: workUnit.actor.id,
          },
        });

        return {
          ok: true,
          result,
          workUnit,
          approvalRequired: true,
          lifecycleId: lifecycle.id,
          bindingHash: revision.bindingHash,
        };
      }

      return { ok: true, result, workUnit, approvalRequired: true };
    }

    // 7. Execute — claim-first for keyed requests (D1). For keyed requests we
    // persist a `running` claim BEFORE dispatch so a retry can never see
    // "nothing happened"; we finalize the claim (running -> terminal) after.
    // No-key requests keep the legacy single-persist path (no replay risk).
    const executionStartedAt = new Date().toISOString();
    const claim = await this.claimIdempotency(
      traceStore,
      workUnit,
      decision,
      governanceCompletedAt,
      executionStartedAt,
    );
    if (claim.kind === "conflict") {
      // Lost the atomic claim race — a concurrent winner is already executing
      // this idempotency key. Fail closed; do not run a duplicate.
      return {
        ok: false,
        error: {
          type: "idempotency_in_flight",
          intent: request.intent,
          message:
            `A concurrent attempt for idempotency key "${request.idempotencyKey}" is in progress. ` +
            `Not executing a duplicate; the prior attempt may commit — reconcile if it does not complete.`,
          retryable: false,
        },
      };
    }
    if (claim.kind === "claim_failed") {
      // The canonical claim could not be recorded; nothing was dispatched, so
      // no mutation committed. Safe to retry (distinct from idempotency_in_flight).
      return {
        ok: false,
        error: {
          type: "upstream_error",
          intent: request.intent,
          message:
            "Could not record the idempotency claim before execution; no action was taken. Safe to retry.",
          retryable: true,
        },
      };
    }
    const keyed = claim.kind === "claimed";

    let executionResult: ExecutionResult;
    try {
      executionResult = await modeRegistry.dispatch(
        workUnit.resolvedMode,
        workUnit,
        decision.constraints,
        { traceId: workUnit.traceId, governanceDecision: decision },
      );
    } catch (executionErr) {
      // Invariant (#677 §2.4): the trace write (persistTrace/finalizeTrace) never
      // rethrows (it owns its own retry + infra-failure audit), and
      // recordInfrastructureFailure is non-throwing, so the original executionErr
      // always survives to the rethrow below — trace-persist failure can never mask
      // it. EXECUTION_EXCEPTION is a platform code, never a domain code (#677 §2.3):
      // it must not appear in OPERATOR_INTENT_ERROR_CODES.
      const completedAt = new Date().toISOString();
      const failed = this.buildFailedResult(workUnit, "EXECUTION_EXCEPTION", "Execution failed");
      if (keyed) {
        // Update the running claim -> failed. A handler that throws commits
        // nothing (its domain write is atomic), so this matches reality. If
        // THIS update fails, the running claim remains and a retry fails closed.
        await this.finalizeTrace(traceStore, workUnit, failed, completedAt);
      } else {
        await this.persistTrace(
          traceStore,
          workUnit,
          decision,
          governanceCompletedAt,
          failed,
          executionStartedAt,
          completedAt,
        );
      }
      await this.recordInfrastructureFailure({
        errorType: "execution_exception",
        error: executionErr,
        workUnit,
        retryable: false,
      });
      throw executionErr;
    }
    const completedAt = new Date().toISOString();

    if (keyed) {
      // Domain mutation committed. Finalize the claim; if finalize fails we
      // STILL return the successful result (the mutation happened) and leave the
      // running claim for reconciliation — the retry, not this call, prevents
      // the double spend.
      await this.finalizeTrace(traceStore, workUnit, executionResult, completedAt);
    } else {
      await this.persistTrace(
        traceStore,
        workUnit,
        decision,
        governanceCompletedAt,
        executionResult,
        executionStartedAt,
        completedAt,
      );
    }

    return { ok: true, result: executionResult, workUnit };
  }

  private buildFailedResult(workUnit: WorkUnit, code: string, message: string): ExecutionResult {
    return {
      workUnitId: workUnit.id,
      outcome: "failed",
      summary: message,
      outputs: {},
      mode: workUnit.resolvedMode,
      durationMs: 0,
      traceId: workUnit.traceId,
      error: { code, message },
    };
  }

  private async persistTrace(
    traceStore: WorkTraceStore | undefined,
    workUnit: WorkUnit,
    decision: GovernanceDecision,
    governanceCompletedAt: string,
    executionResult?: ExecutionResult,
    executionStartedAt?: string,
    completedAt?: string,
  ): Promise<void> {
    if (!traceStore) return;
    // Built once outside the retry loop: every attempt persists the same logical
    // WorkTrace (same traceId/workUnitId/idempotencyKey). Do not move inside the loop.
    const trace = buildWorkTrace({
      workUnit,
      governanceDecision: decision,
      governanceCompletedAt,
      executionResult,
      executionStartedAt,
      completedAt,
    });

    const result = await this.runWithRetry(() => traceStore.persist(trace));
    if (!result.ok) {
      // Terminal failure — exactly one infra-failure audit + one alert.
      await this.recordInfrastructureFailure({
        errorType: "trace_persist_failed",
        error: result.error,
        workUnit,
        retryable: false,
      });
    }
  }

  /**
   * Run `fn` under the trace-persist retry policy (jittered backoff). Returns
   * the value on success, or the last error if every attempt threw. Never
   * throws — callers decide how a terminal failure is surfaced.
   */
  private async runWithRetry<T>(
    fn: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    const delayFn = this.config.delayFn ?? defaultDelayFn;
    const { maxAttempts } = TRACE_PERSIST_RETRY_POLICY;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        await delayFn(jitteredDelayMs(attempt));
      }
      try {
        return { ok: true, value: await fn() };
      } catch (err) {
        lastError = err;
      }
    }
    return { ok: false, error: lastError };
  }

  /**
   * Claim the idempotency key by persisting a `running` trace BEFORE dispatch (D1).
   * - skipped: no key (or no store) -> legacy single-persist path.
   * - claimed: running claim persisted; caller must finalize via update().
   * - conflict: lost the race (P2002) -> caller fails closed.
   * - claim_failed: transient store error before any mutation -> caller returns retryable.
   */
  private async claimIdempotency(
    traceStore: WorkTraceStore | undefined,
    workUnit: WorkUnit,
    decision: GovernanceDecision,
    governanceCompletedAt: string,
    executionStartedAt: string,
  ): Promise<{ kind: "skipped" | "claimed" | "conflict" | "claim_failed" }> {
    if (!traceStore || !workUnit.idempotencyKey) return { kind: "skipped" };
    const claimTrace = buildClaimTrace({
      workUnit,
      governanceDecision: decision,
      governanceCompletedAt,
      executionStartedAt,
    });
    const result = await this.runWithRetry(() => traceStore.claim(claimTrace));
    if (!result.ok) {
      await this.recordInfrastructureFailure({
        errorType: "trace_persist_failed",
        error: result.error,
        workUnit,
        retryable: true,
      });
      return { kind: "claim_failed" };
    }
    return result.value.claimed ? { kind: "claimed" } : { kind: "conflict" };
  }

  /**
   * Finalize a `running` claim by updating it to its terminal outcome. Never
   * throws: a terminal update failure leaves the running claim in place (a retry
   * then fails closed) and records an infra-failure. executionStartedAt is NOT
   * re-sent — it is ONE_SHOT and was sealed at claim time.
   */
  private async finalizeTrace(
    traceStore: WorkTraceStore | undefined,
    workUnit: WorkUnit,
    executionResult: ExecutionResult,
    completedAt: string,
  ): Promise<void> {
    if (!traceStore) return;
    const result = await this.runWithRetry(() =>
      traceStore.update(
        workUnit.id,
        {
          outcome: executionResult.outcome,
          durationMs: executionResult.durationMs,
          executionSummary: executionResult.summary,
          executionOutputs: executionResult.outputs,
          error: executionResult.error,
          injectedPatternIds: executionResult.injectedPatternIds ?? [],
          completedAt,
        },
        { caller: "platform_ingress_finalize", organizationId: workUnit.organizationId },
      ),
    );
    if (!result.ok) {
      await this.recordInfrastructureFailure({
        errorType: "trace_persist_failed",
        error: result.error,
        workUnit,
        retryable: false,
      });
      return;
    }
    if (!result.value.ok) {
      await this.recordInfrastructureFailure({
        errorType: "trace_persist_failed",
        error: new Error(`finalize update rejected: ${result.value.reason}`),
        workUnit,
        retryable: false,
      });
    }
  }

  private async recordInfrastructureFailure(input: {
    errorType: "governance_eval_exception" | "trace_persist_failed" | "execution_exception";
    error: unknown;
    workUnit?: WorkUnit;
    retryable: boolean;
  }): Promise<void> {
    const { ledgerParams, alert } = buildInfrastructureFailureAuditParams({
      errorType: input.errorType,
      error: input.error,
      workUnit: input.workUnit
        ? {
            id: input.workUnit.id,
            intent: input.workUnit.intent,
            traceId: input.workUnit.traceId,
            organizationId: input.workUnit.organizationId,
            deployment: input.workUnit.deployment
              ? { deploymentId: input.workUnit.deployment.deploymentId }
              : undefined,
          }
        : undefined,
      retryable: input.retryable,
    });

    if (this.config.auditLedger) {
      try {
        await this.config.auditLedger.record({
          ...ledgerParams,
          // Typed snapshot widened to ledger's generic Record<string, unknown> envelope.
          snapshot: ledgerParams.snapshot as unknown as Record<string, unknown>,
        });
      } catch (auditErr) {
        // Invariant: no recursive failure logging.
        console.error(
          "[PlatformIngress] failed to record infrastructure-failure audit entry",
          auditErr,
        );
      }
    }

    await safeAlert(this.alerter, alert);
  }
}
