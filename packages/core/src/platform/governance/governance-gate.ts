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
import type { GovernanceDecision } from "../governance-types.js";
import { toActionProposal, toEvaluationContext } from "./work-unit-adapter.js";
import { toGovernanceDecision } from "./decision-adapter.js";
import { DEFAULT_CARTRIDGE_CONSTRAINTS } from "./default-constraints.js";
import { createGuardrailState } from "../../engine/policy-engine.js";
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

export class GovernanceGate {
  private readonly deps: GovernanceGateDeps;

  constructor(deps: GovernanceGateDeps) {
    this.deps = deps;
  }

  async evaluate(
    workUnit: WorkUnit,
    registration: IntentRegistration,
  ): Promise<GovernanceDecision> {
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

    // Build proposal and evaluation context
    const proposal = toActionProposal(workUnit, registration);
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

    return toGovernanceDecision(trace, DEFAULT_CARTRIDGE_CONSTRAINTS);
  }
}
