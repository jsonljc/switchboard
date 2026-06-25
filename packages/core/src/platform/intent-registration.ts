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
  /**
   * Marks an intent that commits OUTBOUND spend — an amount the spend-approval
   * threshold and the hard spend-limit floor are meant to gate (e.g. an
   * ad-campaign budget change; the values `extractSpendAmount` reads:
   * spendAmount/amount/budgetChange/newBudget). Defaults to `false` when omitted.
   *
   * This is money-movement, NOT compute cost: `budgetClass: "expensive"` (an
   * expensive creative-pipeline run) is NOT spend-bearing, and recording inbound
   * revenue / verified payments is NOT spend-bearing. A spend-bearing intent MUST
   * NOT be registered `approvalMode: "system_auto_approved"` — both
   * {@link IntentRegistry.register} and the governance gate refuse it, because
   * auto-approval skips the spend gate. Distinct from
   * `RecommendationInput.financialEffect` (an advisory risk-contract flag on the
   * recommendation layer): this is a `core` registration property that gates the
   * auto-approval fast path and means OUTBOUND spend specifically — which is why
   * it is not derived from the action's spend amount (inbound money-recording
   * intents such as `revenue.record` carry an amount yet must stay auto-approved).
   * See `docs/audits/2026-06-10-security-audit/04-auth-and-governance.md` (F4) —
   * the long-standing Riley R1 registry-guard recommendation.
   */
  spendBearing?: boolean;
  /**
   * Marks an intent that RECORDS already-settled INBOUND revenue — proof that money
   * has already moved (e.g. `payment.record_verified`, whose amount/tier are anchored
   * to a server-side PSP fetch-back), as opposed to committing outbound spend. The
   * inbound counterpart of {@link spendBearing}. Defaults to `false` when omitted.
   *
   * A revenue-recording intent is EXEMPT from the entitlement gate in
   * `PlatformIngress.submit()` (step 1.5): refusing to record money the org already
   * received would discard the receipt + revenue event (corrupting the proof chain)
   * and 500 the PSP webhook into a Stripe redelivery storm. Entitlement gates OUTBOUND
   * consumption (sends, ad-spend, bookings), not inbound bookkeeping. The gate still
   * resolves entitlement and, on the carve-out, emits a reconciliation signal so
   * billing can follow up on a non-entitled org that is still transacting (A22).
   */
  revenueRecording?: boolean;
  idempotent: boolean;
  allowedTriggers: Trigger[];
  timeoutMs: number;
  retryable: boolean;
}

/**
 * Thrown when a spend-bearing intent is registered or evaluated with
 * `approvalMode: "system_auto_approved"`. Auto-approval returns `execute` at the
 * top of `GovernanceGate.evaluate()`, BEFORE the spend-approval threshold and the
 * hard spend-limit floor — so a spend-bearing intent on that path could move money
 * with no cap and no human sign-off. This is a programming/configuration invariant
 * (not user input), so it fails loudly. See the F4 registry-guard finding:
 * `docs/audits/2026-06-10-security-audit/04-auth-and-governance.md` and
 * `11-tickets.md`.
 */
export class SpendBearingAutoApproveError extends Error {
  /** The offending intent name. */
  readonly intent: string;

  constructor(intent: string) {
    super(
      `Intent "${intent}" is spendBearing and cannot use approvalMode ` +
        `"system_auto_approved": auto-approval bypasses the spend-approval ` +
        `threshold and the hard spend-limit floor. Register it with approvalMode ` +
        `"policy" (the default) so the spend gate runs.`,
    );
    this.name = "SpendBearingAutoApproveError";
    this.intent = intent;
  }
}

/**
 * The F4 safety invariant: a spend-bearing intent must never be auto-approved.
 * Called by `IntentRegistry.register()` (throws at startup) and asserted again in
 * `GovernanceGate` immediately before the auto-approve short-circuit (defence in
 * depth, for a registration that bypassed the registry). Inert for every
 * non-spend-bearing intent and for spend-bearing intents under `"policy"` mode.
 */
export function assertNotSpendBearingAutoApprove(registration: IntentRegistration): void {
  if (registration.spendBearing === true && registration.approvalMode === "system_auto_approved") {
    throw new SpendBearingAutoApproveError(registration.intent);
  }
}
