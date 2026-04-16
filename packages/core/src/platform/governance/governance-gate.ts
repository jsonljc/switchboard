import type {
  ActionProposal,
  DecisionTrace,
  Policy,
  IdentitySpec,
  RoleOverlay,
} from "@switchboard/schemas";
import type { EvaluationContext } from "../../engine/rule-evaluator.js";
import type { PolicyEngineContext, PolicyEngineConfig } from "../../engine/policy-engine.js";
import type { ResolvedIdentity } from "../../identity/spec.js";
import type { WorkUnit } from "../work-unit.js";
import type { IntentRegistration } from "../intent-registration.js";
import type { GovernanceDecision, ExecutionConstraints } from "../governance-types.js";
import { toActionProposal, toEvaluationContext } from "./work-unit-adapter.js";
import { toGovernanceDecision } from "./decision-adapter.js";
import { resolveConstraints } from "./constraint-resolver.js";
import { createGuardrailState } from "../../engine/policy-engine.js";

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
}

export class GovernanceGate {
  private readonly deps: GovernanceGateDeps;

  constructor(deps: GovernanceGateDeps) {
    this.deps = deps;
  }

  async evaluate(
    workUnit: WorkUnit,
    registration: IntentRegistration,
    overrides?: Partial<ExecutionConstraints>,
  ): Promise<GovernanceDecision> {
    const [policies, identityResult] = await Promise.all([
      this.deps.loadPolicies(workUnit.organizationId),
      this.deps.loadIdentitySpec(workUnit.actor.id),
    ]);

    const resolvedIdentity = this.deps.resolveIdentity(
      identityResult.spec,
      identityResult.overlays,
      {},
    );

    const proposal = toActionProposal(workUnit, registration);
    const evalContext = toEvaluationContext(workUnit, registration);

    const engineContext: PolicyEngineContext = {
      policies,
      guardrails: null,
      guardrailState: createGuardrailState(),
      resolvedIdentity,
      riskInput: null,
    };

    const trace = this.deps.evaluate(proposal, evalContext, engineContext);

    const constraints = resolveConstraints(registration, overrides);

    return toGovernanceDecision(trace, constraints);
  }
}
