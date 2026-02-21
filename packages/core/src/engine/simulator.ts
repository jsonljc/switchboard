import type { DecisionTrace } from "@switchboard/schemas";

export interface SimulationInput {
  actionType: string;
  parameters: Record<string, unknown>;
  principalId: string;
  organizationId?: string | null;
  cartridgeId?: string;
}

export interface SimulationResult {
  decisionTrace: DecisionTrace;
  wouldExecute: boolean;
  approvalRequired: string;
  explanation: string;
}

// The simulator delegates to the policy engine but never persists anything
// Actual implementation is wired up in the PolicyEngine.simulate() method
export function formatSimulationResult(trace: DecisionTrace): SimulationResult {
  return {
    decisionTrace: trace,
    wouldExecute: trace.finalDecision === "allow" || trace.finalDecision === "modify",
    approvalRequired: trace.approvalRequired,
    explanation: trace.explanation,
  };
}
