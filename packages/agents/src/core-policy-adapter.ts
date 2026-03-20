import type { PolicyEngine, DeliveryIntent } from "./policy-bridge.js";

export interface CoreDecisionResult {
  finalDecision: "allow" | "deny" | "modify";
  approvalRequired: "none" | "standard" | "elevated" | "mandatory";
  explanation: string;
}

/**
 * Shape of the core PolicyEngine's evaluate function.
 * Injected at the app layer to avoid importing @switchboard/core in agents.
 *
 * The `engineContext` parameter must satisfy the core `PolicyEngineContext` shape:
 * - policies: Policy[]
 * - guardrails: GuardrailConfig | null
 * - guardrailState: GuardrailState (from createGuardrailState())
 * - resolvedIdentity: ResolvedIdentity
 * - riskInput: RiskInput | null
 *
 * The app layer is responsible for constructing this context correctly.
 */
export type CoreEvaluateFn = (
  proposal: {
    id: string;
    actionType: string;
    parameters: Record<string, unknown>;
    evidence: string;
    confidence: number;
    originatingMessageId: string;
  },
  evalContext: {
    actionType: string;
    parameters: Record<string, unknown>;
    cartridgeId: string;
    principalId: string;
    organizationId: string | null;
    riskCategory: string;
    metadata: Record<string, unknown>;
  },
  engineContext: Record<string, unknown>,
  config?: Record<string, unknown>,
) => CoreDecisionResult;

export interface CorePolicyEngineAdapterConfig {
  evaluate: CoreEvaluateFn;
  organizationId: string;
  engineContext?: Record<string, unknown>;
  engineConfig?: Record<string, unknown>;
}

export class CorePolicyEngineAdapter implements PolicyEngine {
  private coreEvaluate: CoreEvaluateFn;
  private organizationId: string;
  private engineContext: Record<string, unknown>;
  private engineConfig: Record<string, unknown>;

  constructor(config: CorePolicyEngineAdapterConfig) {
    this.coreEvaluate = config.evaluate;
    this.organizationId = config.organizationId;
    this.engineContext = config.engineContext ?? {};
    this.engineConfig = config.engineConfig ?? {};
  }

  async evaluate(intent: DeliveryIntent): Promise<{ effect: string; reason?: string }> {
    let result: CoreDecisionResult;
    try {
      const proposal = {
        id: intent.eventId,
        actionType: intent.action,
        parameters: (intent.payload as Record<string, unknown>) ?? {},
        evidence: `Agent dispatch: ${intent.destinationType}/${intent.destinationId}`,
        confidence: 1.0,
        originatingMessageId: intent.eventId,
      };

      const evalContext = {
        actionType: intent.action,
        parameters: (intent.payload as Record<string, unknown>) ?? {},
        cartridgeId: "agents",
        principalId: intent.destinationId,
        organizationId: this.organizationId,
        riskCategory: intent.criticality === "required" ? "medium" : "low",
        metadata: { eventId: intent.eventId, destinationType: intent.destinationType },
      };

      result = this.coreEvaluate(proposal, evalContext, this.engineContext, this.engineConfig);
    } catch (err) {
      return {
        effect: "deny",
        reason: `policy_engine_error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (result.finalDecision === "deny") {
      return { effect: "deny", reason: result.explanation };
    }

    if (result.approvalRequired !== "none") {
      return { effect: "require_approval", reason: result.explanation };
    }

    return { effect: "allow" };
  }
}
