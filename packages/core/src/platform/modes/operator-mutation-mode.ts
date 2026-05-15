import type { ExecutionContext, ExecutionMode } from "../execution-context.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";
import type { WorkUnit } from "../work-unit.js";
import type { ExecutionModeName } from "../types.js";

/**
 * Result shape for a registered operator-mutation handler.
 *
 * Mirrors the relevant subset of `WorkflowHandlerResult` but is intentionally
 * scoped: operator-direct mutations are synchronous and never `"queued"` or
 * `"pending_approval"`. Approval routing is decided upstream by
 * `GovernanceGate.evaluate`: intents registered with `approvalMode: "policy"`
 * that require approval are short-circuited to `require_approval` BEFORE the
 * mode executes, so the handler never observes that outcome.
 */
export interface OperatorMutationHandlerResult {
  outcome: "completed" | "failed";
  summary: string;
  outputs?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export interface OperatorMutationHandler {
  execute(workUnit: WorkUnit): Promise<OperatorMutationHandlerResult>;
}

export interface OperatorMutationModeConfig {
  handlers: Map<string, OperatorMutationHandler>;
}

/**
 * The governed execution mode for operator-direct mutations submitted through
 * `PlatformIngress`. This mode is the architectural successor to the legacy
 * `"store_recorded_operator_mutation"` ingressPath — where stores wrote
 * WorkTrace records directly to represent operator mutations that never
 * entered ingress. Wave 2 Phase 1 eliminates that bypass; this mode is its
 * canonical replacement.
 *
 * Contract:
 * - Registered under the existing `ExecutionModeName` `"operator_mutation"`.
 * - Dispatches only handlers registered via the operator-intents bootstrap.
 * - Each handler is a thin adapter to an existing service function; no
 *   direct store writes outside the registered handler path.
 * - Reachable only through `PlatformIngress.submit()`.
 *
 * See `docs/superpowers/specs/2026-05-15-operator-direct-ingress-pattern.md`
 * Amendment 2.
 */
export class OperatorMutationMode implements ExecutionMode {
  readonly name: ExecutionModeName = "operator_mutation";

  constructor(private readonly config: OperatorMutationModeConfig) {}

  async execute(
    workUnit: WorkUnit,
    _constraints: ExecutionConstraints,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const handler = this.config.handlers.get(workUnit.intent);
    if (!handler) {
      return {
        workUnitId: workUnit.id,
        outcome: "failed",
        summary: `Operator-mutation handler not registered for ${workUnit.intent}`,
        outputs: {},
        mode: "operator_mutation",
        durationMs: 0,
        traceId: context.traceId,
        error: {
          code: "OPERATOR_MUTATION_NOT_REGISTERED",
          message: `No operator-mutation handler registered for ${workUnit.intent}`,
        },
      };
    }

    const startedAt = Date.now();
    const result = await handler.execute(workUnit);
    return {
      workUnitId: workUnit.id,
      outcome: result.outcome,
      summary: result.summary,
      outputs: result.outputs ?? {},
      mode: "operator_mutation",
      durationMs: Date.now() - startedAt,
      traceId: context.traceId,
      error: result.error,
    };
  }
}
