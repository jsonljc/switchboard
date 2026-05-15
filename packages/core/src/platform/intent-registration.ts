import type {
  ExecutionModeName,
  Trigger,
  MutationClass,
  BudgetClass,
  ApprovalPolicy,
} from "./types.js";

export type ExecutorBinding =
  | { mode: "skill"; skillSlug: string }
  | { mode: "pipeline"; pipelineId: string }
  | { mode: "cartridge"; actionId: string }
  | { mode: "workflow"; workflowId: string }
  // Operator-direct mutations are identified by the surrounding
  // IntentRegistration.intent — the binding carries no separate identifier
  // because the handler lookup in OperatorMutationMode keys on the intent.
  | { mode: "operator_mutation" };

/**
 * Approval-evaluation mode for an intent registration.
 *
 * - `"policy"` (default): GovernanceGate runs the policy engine end-to-end.
 *   Default-deny if no policy matches.
 * - `"system_auto_approved"`: GovernanceGate short-circuits the policy lookup
 *   and returns `outcome: "execute"`. Reserved for operator-direct ingress
 *   migrations (Wave 2 Phase 1b). The short-circuit only skips the human
 *   approval-policy lookup — it does NOT bypass auth, idempotency, WorkTrace
 *   persistence, audit ledger evidence, or execution dispatch.
 *
 * See `docs/superpowers/specs/2026-05-15-operator-direct-ingress-pattern.md`
 * Amendment 1 for the rationale.
 */
export type ApprovalMode = "policy" | "system_auto_approved";

export interface IntentRegistration {
  intent: string;
  defaultMode: ExecutionModeName;
  allowedModes: ExecutionModeName[];
  executor: ExecutorBinding;
  parameterSchema: Record<string, unknown>;
  mutationClass: MutationClass;
  budgetClass: BudgetClass;
  approvalPolicy: ApprovalPolicy;
  /** See {@link ApprovalMode}. Defaults to `"policy"` when omitted. */
  approvalMode?: ApprovalMode;
  idempotent: boolean;
  allowedTriggers: Trigger[];
  timeoutMs: number;
  retryable: boolean;
}
