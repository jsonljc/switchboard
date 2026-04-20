import type { IntentRegistry } from "./intent-registry.js";
import type { ExecutionModeRegistry } from "./execution-mode-registry.js";
import type { GovernanceDecision } from "./governance-types.js";
import type { ExecutionResult } from "./execution-result.js";
import type { IngressError } from "./ingress-error.js";
import type { IntentRegistration } from "./intent-registration.js";
import type { SubmitWorkRequest, WorkUnit } from "./work-unit.js";
import type { WorkTraceStore } from "./work-trace-recorder.js";
import { normalizeWorkUnit } from "./work-unit.js";
import { buildWorkTrace } from "./work-trace-recorder.js";

export interface GovernanceGateInterface {
  evaluate(workUnit: WorkUnit, registration: IntentRegistration): Promise<GovernanceDecision>;
}

export interface PlatformIngressConfig {
  intentRegistry: IntentRegistry;
  modeRegistry: ExecutionModeRegistry;
  governanceGate: GovernanceGateInterface;
  traceStore?: WorkTraceStore;
}

export type SubmitWorkResponse =
  | { ok: true; result: ExecutionResult; workUnit: WorkUnit }
  | { ok: false; error: IngressError }
  | { ok: true; result: ExecutionResult; workUnit: WorkUnit; approvalRequired: true };

export class PlatformIngress {
  private readonly config: PlatformIngressConfig;

  constructor(config: PlatformIngressConfig) {
    this.config = config;
  }

  async submit(request: SubmitWorkRequest): Promise<SubmitWorkResponse> {
    const { intentRegistry, modeRegistry, governanceGate, traceStore } = this.config;

    // 0. Idempotency check — return existing result if key matches prior trace
    if (request.idempotencyKey && traceStore) {
      const existingTrace = await traceStore.getByIdempotencyKey(request.idempotencyKey);
      if (existingTrace) {
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

    // 3. Resolve mode + normalize
    const resolvedMode = intentRegistry.resolveMode(request.intent, request.suggestedMode);
    const workUnit = normalizeWorkUnit(request, resolvedMode);

    // 4. Governance gate
    let decision: GovernanceDecision;
    const governanceCompletedAt = new Date().toISOString();
    try {
      decision = await governanceGate.evaluate(workUnit, registration);
    } catch {
      decision = {
        outcome: "deny",
        reasonCode: "GOVERNANCE_ERROR",
        riskScore: 1,
        matchedPolicies: [],
      };

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

    // 6. Require approval
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
      return { ok: true, result, workUnit, approvalRequired: true };
    }

    // 7. Execute
    const executionStartedAt = new Date().toISOString();
    const executionResult = await modeRegistry.dispatch(
      workUnit.resolvedMode,
      workUnit,
      decision.constraints,
      { traceId: workUnit.traceId, governanceDecision: decision },
    );
    const completedAt = new Date().toISOString();

    await this.persistTrace(
      traceStore,
      workUnit,
      decision,
      governanceCompletedAt,
      executionResult,
      executionStartedAt,
      completedAt,
    );

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
    try {
      const trace = buildWorkTrace({
        workUnit,
        governanceDecision: decision,
        governanceCompletedAt,
        executionResult,
        executionStartedAt,
        completedAt,
      });
      await traceStore.persist(trace);
    } catch (err) {
      console.error("Failed to persist WorkTrace", err);
    }
  }
}
