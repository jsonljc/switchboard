// ---------------------------------------------------------------------------
// Policy Bridge — evaluates DeliveryIntents against the governance policy engine
// ---------------------------------------------------------------------------

export interface DeliveryIntent {
  eventId: string;
  destinationType: "agent" | "connector" | "webhook" | "manual_queue" | "system";
  destinationId: string;
  action: string;
  payload: unknown;
  criticality: "required" | "optional" | "best_effort";
}

export interface PolicyEvaluation {
  approved: boolean;
  requiresApproval?: boolean;
  reason?: string;
}

export interface PolicyEngine {
  evaluate(intent: DeliveryIntent): Promise<{ effect: string; reason?: string }>;
}

export class PolicyBridge {
  constructor(private engine: PolicyEngine | null) {}

  async evaluate(intent: DeliveryIntent): Promise<PolicyEvaluation> {
    if (!this.engine) {
      return { approved: true };
    }

    const result = await this.engine.evaluate(intent);

    if (result.effect === "allow") {
      return { approved: true };
    }

    if (result.effect === "require_approval") {
      return { approved: false, requiresApproval: true, reason: result.reason };
    }

    return { approved: false, reason: result.reason };
  }
}
