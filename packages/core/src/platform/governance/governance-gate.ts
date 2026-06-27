import type {
  ActionProposal,
  DecisionTrace,
  Policy,
  IdentitySpec,
  RoleOverlay,
  RiskInput,
  GuardrailConfig,
  GovernanceProfile,
} from "@switchboard/schemas";
import type { EvaluationContext } from "../../engine/rule-evaluator.js";
import type { PolicyEngineContext, PolicyEngineConfig } from "../../engine/policy-engine.js";
import type { ResolvedIdentity } from "../../identity/spec.js";
import type { WorkUnit } from "../work-unit.js";
import type { IntentRegistration } from "../intent-registration.js";
import { assertNotSpendBearingAutoApprove } from "../intent-registration.js";
import type { GovernanceDecision, ExecutionConstraints } from "../governance-types.js";
import { toActionProposal, toEvaluationContext } from "./work-unit-adapter.js";
import { toGovernanceDecision } from "./decision-adapter.js";
import { consultAutoApproveOrgPolicy } from "./auto-approve-policy-consult.js";
import { applySpendApprovalThreshold } from "./spend-approval-threshold.js";
import { DEFAULT_CARTRIDGE_CONSTRAINTS } from "./default-constraints.js";
import { createGuardrailState } from "../../engine/policy-engine.js";
import { extractSpendAmount, SPEND_KEYS } from "../../engine/spend-limits.js";
import { profileToPosture, DEFAULT_GOVERNANCE_PROFILE } from "../../governance/profile.js";

/**
 * Minimal cartridge interface for governance context assembly.
 * Cartridges implement these methods to enrich risk input and provide guardrails.
 */
export interface GovernanceCartridge {
  manifest: { id: string; actions?: Array<{ actionType: string }> };
  getGuardrails(): GuardrailConfig | null;
  enrichContext(
    actionType: string,
    parameters: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  getRiskInput(
    actionType: string,
    parameters: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<RiskInput>;
}

export interface GovernanceGateDeps {
  evaluate: (
    proposal: ActionProposal,
    evalContext: EvaluationContext,
    engineContext: PolicyEngineContext,
    config?: PolicyEngineConfig,
  ) => DecisionTrace;

  resolveIdentity: (
    spec: IdentitySpec,
    overlays: RoleOverlay[],
    context: { cartridgeId?: string; riskCategory?: string; now?: Date },
  ) => ResolvedIdentity;

  loadPolicies: (organizationId: string) => Promise<Policy[]>;

  loadIdentitySpec: (actorId: string) => Promise<{ spec: IdentitySpec; overlays: RoleOverlay[] }>;

  loadCartridge: (cartridgeId: string) => Promise<GovernanceCartridge | null>;

  getGovernanceProfile: (organizationId: string | null) => Promise<GovernanceProfile | null>;

  riskScoringConfig?: PolicyEngineConfig["riskScoringConfig"];
}

const DEFAULT_RISK_INPUT: RiskInput = {
  baseRisk: "low",
  exposure: { dollarsAtRisk: 0, blastRadius: 1 },
  reversibility: "full",
  sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
};

/**
 * OUTBOUND-spend parameter keys: the engine's canonical SPEND_KEYS
 * (engine/spend-limits.ts) MINUS the generic "amount" key. Derived from SPEND_KEYS
 * rather than hand-copied, so a new outbound key added there is automatically
 * covered here and the two lists cannot silently drift (a drift would re-open the
 * very bypass this guard closes). "amount" is excluded because inbound
 * money-recording intents legitimately carry it yet must stay auto-approved:
 * operator.record_revenue is registered system_auto_approved + write and submits
 * parameters.amount, and payment.record_verified records inbound value too.
 * spendBearing is a static flag precisely so "outbound spend" is NOT inferred from a
 * bare amount (intent-registration.ts); this runtime guard mirrors that by reading
 * only the outbound-specific keys, never the generic "amount".
 */
const OUTBOUND_SPEND_KEYS = SPEND_KEYS.filter((key) => key !== "amount");

/**
 * Money-AFFECTING self-execution intent prefixes that must NEVER ride the system_auto_approved
 * short-circuit, even when no spend delta can be read from their parameters (the dollars may live
 * in a field the extractor cannot see, or — for pause — there is no outbound delta at all). The
 * CONFIRMED reallocate entry is the Spec-1B reallocation intent
 * (docs/superpowers/specs/2026-06-05-close-the-revenue-loop-design.md, C6 / 1B-1), which that spec
 * registers require_approval; scale + shift_budget_to_source are anticipated outbound siblings.
 * `adoptimizer.campaign.pause` is here as DEFENSE-IN-DEPTH (D9-2): a self-executing pause stops
 * spend on a campaign — money-affecting, and dangerous on a broken signal — so it must require a
 * human even though it carries no outbound delta. It is already gated by its seeded mandatory
 * require_approval policy; this denylist is the structural backstop if that policy is ever
 * stripped/misconfigured. Keep tiny; add new money-affecting self-execution intents here. See the
 * F4 registry guard and feedback_system_auto_approved_bypasses_spend_gates.
 */
const FINANCIAL_AUTO_APPROVE_DENYLIST = [
  "adoptimizer.campaign.reallocate",
  "adoptimizer.campaign.scale",
  "adoptimizer.campaign.shift_budget_to_source",
  "adoptimizer.campaign.pause",
] as const;

/** True when the proposal carries a finite, non-zero OUTBOUND budget delta under
 *  OUTBOUND_SPEND_KEYS (NOT the generic "amount"). Reuses extractSpendAmount's
 *  finiteness-guarded read so the guard and the spend gate agree on "the amount"
 *  (a NaN never reads as a spend, feedback_nan_blind_comparison_gates). */
function carriesOutboundSpend(proposal: ActionProposal): boolean {
  const amount = extractSpendAmount(proposal, OUTBOUND_SPEND_KEYS);
  return amount !== null && amount !== 0;
}

/**
 * D9-2 runtime financial-intent test for the auto-approve guard. OR of two signals:
 *  (1) a write/destructive intent carrying an OUTBOUND spend delta (carriesOutboundSpend);
 *  (2) a denylisted outbound money-move intent prefix, even with no extractable delta.
 * Complementary to assertNotSpendBearingAutoApprove, which catches a STATICALLY
 * declared spendBearing:true registration; this catches an UNDECLARED outbound intent
 * whose runtime parameters carry an outbound delta, or a known money-move family.
 * Inbound money-recording (operator.record_revenue carries the generic "amount") is
 * intentionally NOT financial here, so it keeps short-circuiting to execute.
 */
function isFinancialIntent(registration: IntentRegistration, proposal: ActionProposal): boolean {
  if (FINANCIAL_AUTO_APPROVE_DENYLIST.some((prefix) => registration.intent.startsWith(prefix))) {
    return true;
  }
  if (registration.mutationClass === "read") return false;
  return carriesOutboundSpend(proposal);
}

export class GovernanceGate {
  private readonly deps: GovernanceGateDeps;

  constructor(deps: GovernanceGateDeps) {
    this.deps = deps;
  }

  async evaluate(
    workUnit: WorkUnit,
    registration: IntentRegistration,
  ): Promise<GovernanceDecision> {
    // Launch-posture trust override: when a deployment pins an explicit
    // trustLevelOverride (governanceSettings.trustLevelOverride), use it for
    // tool-call admission instead of the default trust level — without consulting
    // the score-based ramp. Absent ⇒ unchanged DEFAULT_CARTRIDGE_CONSTRAINTS.
    // This only affects approve-vs-park; the deny-based compliance floor (banned
    // phrase / claim classifier / consent) runs independently of trust level.
    const constraints: ExecutionConstraints = workUnit.deployment?.trustLevelOverride
      ? { ...DEFAULT_CARTRIDGE_CONSTRAINTS, trustLevel: workUnit.deployment.trustLevelOverride }
      : DEFAULT_CARTRIDGE_CONSTRAINTS;

    // Build the action proposal once, before the short-circuit, so the D9-2
    // financial guard below and the downstream policy evaluation / spend read
    // share a single instance (toActionProposal is a pure projection of workUnit).
    const proposal = toActionProposal(workUnit, registration);

    // Amendment 1 — system_auto_approved short-circuit.
    // Skips the human approval-policy lookup only. Auth, idempotency,
    // WorkTrace, audit, and execution dispatch all run unchanged downstream.
    if (registration.approvalMode === "system_auto_approved") {
      // F4 defence in depth: a spend-bearing intent must never reach the
      // auto-approve short-circuit. IntentRegistry.register() already refuses to
      // register one; this catches a registration that bypassed the registry.
      // A programming invariant (not user input) ⇒ throw loudly rather than
      // silently downgrade to require_approval.
      assertNotSpendBearingAutoApprove(registration);
      // D9-2 structural guard: a financial intent must NEVER ride the
      // short-circuit, which returns execute BEFORE the downstream spend gate
      // (applySpendApprovalThreshold over extractSpendAmount). The F4 throw above
      // covers a STATICALLY declared spendBearing:true registration; this covers
      // an UNDECLARED one whose runtime parameters carry a spend amount, or a
      // money-move family on the denylist. Fall through to the full policy path so
      // the seeded require_approval policy parks it (else default-deny). This makes
      // "financial intents are require_approval, never system_auto_approved" a
      // structural invariant, not a convention (#931,
      // feedback_system_auto_approved_bypasses_spend_gates).
      if (!isFinancialIntent(registration, proposal)) {
        // P3-6: an intent that opts in via consultOrgPolicyOnAutoApprove still honors
        // the operator's per-org governance dial — an org-scoped DENY / require_approval
        // Policy — before the execute short-circuit, WITHOUT resolving identity. The
        // short-circuit otherwise returns execute before loadPolicies, so a deny is never
        // consulted (the gap). We consult ONLY the org-policy layer because the draft
        // child is also submitted with an unseeded agent actor (delegate tool); the full
        // path's loadIdentitySpec would throw and hard-deny. No flag ⇒ unchanged fast path.
        if (registration.consultOrgPolicyOnAutoApprove) {
          const policies = await this.deps.loadPolicies(workUnit.organizationId);
          const consulted = consultAutoApproveOrgPolicy(
            policies,
            toEvaluationContext(workUnit, registration),
            constraints,
          );
          if (consulted) return consulted;
        }
        return {
          outcome: "execute",
          riskScore: 0,
          budgetProfile: "cheap",
          constraints,
          matchedPolicies: [],
        };
      }
      // Financial intent: deliberately do not return; continue to the full policy
      // evaluation below so it parks or denies.
    }

    // Derive cartridgeId from executor binding (first segment of action ID)
    const rawActionId =
      registration.executor.mode === "cartridge" ? registration.executor.actionId : undefined;
    const cartridgeId = rawActionId
      ? rawActionId.indexOf(".") > 0
        ? rawActionId.slice(0, rawActionId.indexOf("."))
        : rawActionId
      : undefined;

    // Load identity, policies, cartridge, and governance profile in parallel
    const [identityResult, policies, cartridge, govProfile] = await Promise.all([
      this.deps.loadIdentitySpec(workUnit.actor.id),
      this.deps.loadPolicies(workUnit.organizationId),
      cartridgeId ? this.deps.loadCartridge(cartridgeId) : Promise.resolve(null),
      this.deps.getGovernanceProfile(workUnit.organizationId),
    ]);

    // Resolve identity with cartridge context
    const resolvedIdentity = this.deps.resolveIdentity(
      identityResult.spec,
      identityResult.overlays,
      { cartridgeId },
    );

    // Get risk input from cartridge (with safe default fallback)
    let riskInput: RiskInput = DEFAULT_RISK_INPUT;
    if (cartridge) {
      try {
        riskInput = await cartridge.getRiskInput(workUnit.intent, workUnit.parameters, {});
      } catch {
        // Fall back to default risk input if cartridge fails
      }
    }

    // Load guardrails from cartridge
    const guardrails = cartridge?.getGuardrails() ?? null;

    // Build system risk posture from governance profile
    const profile = govProfile ?? DEFAULT_GOVERNANCE_PROFILE;
    const systemRiskPosture = profileToPosture(profile);

    // Build evaluation context. The proposal was built once above, before the
    // short-circuit, and is reused here.
    const evalContext = toEvaluationContext(workUnit, registration);

    // Assemble full PolicyEngineContext
    const engineContext: PolicyEngineContext = {
      policies,
      guardrails,
      guardrailState: createGuardrailState(),
      resolvedIdentity,
      riskInput,
      systemRiskPosture,
    };

    const config: PolicyEngineConfig | undefined = this.deps.riskScoringConfig
      ? { riskScoringConfig: this.deps.riskScoringConfig }
      : undefined;

    const trace = this.deps.evaluate(proposal, evalContext, engineContext, config);

    const decision = toGovernanceDecision(trace, constraints);

    // Spend-approval threshold — the per-deployment "less-human-in-loop" autonomy
    // lever. Dormant unless the deployment is explicitly autonomous; it can only
    // relax a reversible financial approval at/under the threshold to execute, or
    // escalate an over-threshold execute to require_approval. It NEVER touches a
    // deny, so the compliance/limit floor is unaffected.
    return applySpendApprovalThreshold(decision, {
      trustLevelOverride: workUnit.deployment?.trustLevelOverride,
      spendAutonomyEnabled: workUnit.deployment?.spendAutonomyEnabled,
      threshold: workUnit.deployment?.policyOverrides?.spendApprovalThreshold,
      spendAmount: extractSpendAmount(proposal),
      mutationClass: registration.mutationClass,
      reversibility: riskInput.reversibility,
    });
  }
}
