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
  /** Granular approval level when requiresApproval is true */
  approvalLevel?: "standard" | "elevated" | "mandatory";
  reason?: string;
}

export interface PolicyEngine {
  evaluate(intent: DeliveryIntent): Promise<{
    effect: string;
    reason?: string;
    approvalLevel?: string;
  }>;
}

export class PolicyBridge {
  constructor(private engine: PolicyEngine | null) {}

  async evaluate(intent: DeliveryIntent): Promise<PolicyEvaluation> {
    if (!this.engine) {
      return { approved: true };
    }

    let result: { effect: string; reason?: string; approvalLevel?: string };
    try {
      result = await this.engine.evaluate(intent);
    } catch {
      // policy engine failure defaults to deny for safety
      return { approved: false, reason: "policy_engine_error" };
    }

    if (result.effect === "allow") {
      return { approved: true };
    }

    if (result.effect === "require_approval") {
      return {
        approved: false,
        requiresApproval: true,
        approvalLevel: (result.approvalLevel as PolicyEvaluation["approvalLevel"]) ?? "standard",
        reason: result.reason,
      };
    }

    return { approved: false, reason: result.reason };
  }
}
