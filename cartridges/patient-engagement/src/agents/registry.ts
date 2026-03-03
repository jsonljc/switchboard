// ---------------------------------------------------------------------------
// Agent Registry — Routes by action prefix or journey stage
// ---------------------------------------------------------------------------

import type { AgentModule, AgentType } from "./types.js";

/**
 * Resolve the appropriate agent for an action type.
 */
export function resolveAgent(
  actionType: string,
  agents: Map<AgentType, AgentModule>,
): AgentModule | null {
  // Route by action type prefix
  if (
    actionType.startsWith("patient-engagement.lead.") ||
    actionType === "patient-engagement.conversation.handle_objection"
  ) {
    return agents.get("intake") ?? null;
  }

  if (
    actionType.startsWith("patient-engagement.appointment.") ||
    actionType.startsWith("patient-engagement.reminder.")
  ) {
    return agents.get("scheduling") ?? null;
  }

  if (
    actionType.startsWith("patient-engagement.treatment.") ||
    actionType.startsWith("patient-engagement.review.")
  ) {
    return agents.get("followup") ?? null;
  }

  if (
    actionType.startsWith("patient-engagement.cadence.") ||
    actionType === "patient-engagement.journey.update_stage"
  ) {
    return agents.get("retention") ?? null;
  }

  // Direct actions (no agent routing)
  if (
    actionType.startsWith("patient-engagement.pipeline.") ||
    actionType.startsWith("patient-engagement.patient.") ||
    actionType === "patient-engagement.conversation.escalate"
  ) {
    return null;
  }

  return null;
}
