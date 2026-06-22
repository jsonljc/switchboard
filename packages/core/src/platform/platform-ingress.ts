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
import type { ApprovalNotifier, ApprovalNotification } from "../notifications/notifier.js";
import type { OperatorAlerter } from "../observability/operator-alerter.js";
import { NoopOperatorAlerter } from "../observability/operator-alerter.js";
import { DEFAULT_ROUTING_CONFIG } from "../approval/router.js";
import { normalizeWorkUnit } from "./work-unit.js";
import { computeBindingHash, hashObject } from "../approval/binding.js";
import { IngressTracePersister, TRACE_PERSIST_RETRY_POLICY } from "./ingress-trace-persister.js";

// Re-exported from the trace-persister collaborator for back-compat: existing
// tests import this constant from "./platform-ingress.js".
export { TRACE_PERSIST_RETRY_POLICY };

/**
 * The notification surface renders four known risk categories; anything else
 * (including absent) is schema drift and falls back to "medium" explicitly
 * rather than leaking free-form strings into operator copy.
 */
function normalizeRiskCategory(value: unknown): string {
  return value === "critical" || value === "high" || value === "medium" || value === "low"
    ? value
    : "medium";
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
  /**
   * Optional best-effort notifier fired when a submission parks as a gated
   * lifecycle (require_approval with a lifecycleService). Failures are logged
   * and never affect the park; the dashboard Inbox remains canonical (spec:
   * 2026-06-05-slack-approval-notifications-design.md section 2).
   */
  approvalNotifier?: ApprovalNotifier;
  /**
   * Optional best-effort hook fired once after submit() processes a work unit
   * (success, deny, governance-error, or require_approval). Read-only telemetry:
   * a synchronous throw is caught and logged and NEVER affects the submission;
   * the async export is the hook implementation's own concern. Wired in app.ts to
   * the OTel work-unit span exporter (one-directional projection; WorkTrace stays
   * canonical). Mirrors the approvalNotifier fire-and-forget posture.
   */
  onWorkUnitComplete?: (info: { organizationId: string; workUnitId: string }) => void;
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
  private readonly tracePersister: IngressTracePersister;

  constructor(config: PlatformIngressConfig) {
    this.config = config;
    this.alerter = config.operatorAlerter ?? new NoopOperatorAlerter();
    this.tracePersister = new IngressTracePersister({
      auditLedger: config.auditLedger,
      alerter: this.alerter,
      delayFn: config.delayFn,
    });
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
        const replayResponse = {
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
        // D5-3/D4-1: an ingress park (require_approval) persists a pending_approval
        // WorkTrace; a replay MUST preserve the approvalRequired marker so an
        // approval-aware consumer (e.g. the Riley pause submitter) classifies the
        // replay as parked instead of misreading it as an ungated execution. Match on
        // BOTH outcome AND ingressPath: pending_approval is not unique to ingress — the
        // recommendation emission mirror also persists a KEYED pending_approval row
        // (ingressPath "agent_recommendation_emission"), so outcome alone would mis-mark
        // a non-park trace if a key ever collided. Only a platform_ingress park is
        // re-marked. lifecycleId/bindingHash are intentionally NOT reconstructed:
        // buildWorkTrace persists neither, and they were already minted on the first
        // park (the submitter tolerates their absence).
        if (
          existingTrace.outcome === "pending_approval" &&
          existingTrace.ingressPath === "platform_ingress"
        ) {
          return { ...replayResponse, approvalRequired: true as const };
        }
        return replayResponse;
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

      await this.tracePersister.recordInfrastructureFailure({
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
      await this.tracePersister.persistTrace(
        traceStore,
        workUnit,
        decision,
        governanceCompletedAt,
        result,
      );
      // E4c: best-effort work-unit span export (after trace persist).
      this.fireWorkUnitComplete(workUnit);
      return { ok: true, result, workUnit };
    }

    // 5. Deny
    if (decision.outcome === "deny") {
      const result = this.buildFailedResult(workUnit, decision.reasonCode, "Denied by governance");
      await this.tracePersister.persistTrace(
        traceStore,
        workUnit,
        decision,
        governanceCompletedAt,
        result,
      );
      // E4c: best-effort work-unit span export (after trace persist).
      this.fireWorkUnitComplete(workUnit);
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
      await this.tracePersister.persistTrace(
        traceStore,
        workUnit,
        decision,
        governanceCompletedAt,
        result,
      );
      // E4c: best-effort work-unit span export (after trace persist). One fire
      // here covers BOTH approval returns (with- and without-lifecycle).
      this.fireWorkUnitComplete(workUnit);

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

        if (this.config.approvalNotifier) {
          const notification: ApprovalNotification = {
            approvalId: lifecycle.id,
            envelopeId: workUnit.id,
            summary: `${workUnit.intent} (requested by ${workUnit.actor.id})`,
            riskCategory: normalizeRiskCategory(
              (decision as Record<string, unknown>)["riskCategory"],
            ),
            explanation: `Approval level: ${decision.approvalLevel}. Policies: ${
              decision.matchedPolicies.join(", ") || "default"
            }.`,
            bindingHash: revision.bindingHash,
            expiresAt,
            // Routing config wins (it is what the scope snapshot enforces); the
            // governance decision's approvers inform when routing is silent.
            // Informational in the pilot: Slack targeting never reads this field.
            approvers:
              routingConfig.defaultApprovers.length > 0
                ? routingConfig.defaultApprovers
                : decision.approvers,
            evidenceBundle: { intent: workUnit.intent, organizationId: workUnit.organizationId },
          };
          // Fire-and-forget with logged failure (the propose-pipeline precedent).
          // try/catch guards a synchronously-throwing notifier; .catch guards the
          // async leg. Neither can fail the park.
          try {
            this.config.approvalNotifier.notify(notification).catch((err) => {
              console.error("[PlatformIngress] approval notification failed", err);
            });
          } catch (err) {
            console.error("[PlatformIngress] approval notification failed", err);
          }
        }

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
    const claim = await this.tracePersister.claimIdempotency(
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
        await this.tracePersister.finalizeTrace(traceStore, workUnit, failed, completedAt);
      } else {
        await this.tracePersister.persistTrace(
          traceStore,
          workUnit,
          decision,
          governanceCompletedAt,
          failed,
          executionStartedAt,
          completedAt,
        );
      }
      await this.tracePersister.recordInfrastructureFailure({
        errorType: "execution_exception",
        error: executionErr,
        workUnit,
        retryable: false,
      });
      // E4c follow-up: fire the work-unit-complete hook on the failed-execution path too. The trace
      // is already sealed above (finalizeTrace/persistTrace), so a downstream exporter reads a
      // complete (failed) trace. Best-effort + swallowing (fireWorkUnitComplete try/catch); the
      // original executionErr still rethrows below, so submit's error contract is unchanged.
      this.fireWorkUnitComplete(workUnit);
      throw executionErr;
    }
    const completedAt = new Date().toISOString();

    if (keyed) {
      // Domain mutation committed. Finalize the claim; if finalize fails we
      // STILL return the successful result (the mutation happened) and leave the
      // running claim for reconciliation — the retry, not this call, prevents
      // the double spend.
      await this.tracePersister.finalizeTrace(traceStore, workUnit, executionResult, completedAt);
    } else {
      await this.tracePersister.persistTrace(
        traceStore,
        workUnit,
        decision,
        governanceCompletedAt,
        executionResult,
        executionStartedAt,
        completedAt,
      );
    }

    // E4c: best-effort work-unit span export (after trace persist).
    this.fireWorkUnitComplete(workUnit);
    return { ok: true, result: executionResult, workUnit };
  }

  /**
   * Best-effort work-unit-complete hook. A synchronously-throwing hook is caught
   * and logged; it can never affect the submission. The hook itself is responsible
   * for not awaiting / swallowing any async work (telemetry must never block submit).
   */
  private fireWorkUnitComplete(workUnit: WorkUnit): void {
    if (!this.config.onWorkUnitComplete) return;
    try {
      this.config.onWorkUnitComplete({
        organizationId: workUnit.organizationId,
        workUnitId: workUnit.id,
      });
    } catch (err) {
      console.warn("[PlatformIngress] onWorkUnitComplete hook threw", err);
    }
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
}
