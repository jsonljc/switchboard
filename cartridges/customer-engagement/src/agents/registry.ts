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
    actionType.startsWith("customer-engagement.lead.") ||
    actionType === "customer-engagement.conversation.handle_objection"
  ) {
    return agents.get("intake") ?? null;
  }

  if (
    actionType.startsWith("customer-engagement.appointment.") ||
    actionType.startsWith("customer-engagement.reminder.")
  ) {
    return agents.get("scheduling") ?? null;
  }

  if (
    actionType.startsWith("customer-engagement.treatment.") ||
    actionType.startsWith("customer-engagement.review.")
  ) {
    return agents.get("followup") ?? null;
  }

  if (actionType.startsWith("customer-engagement.cadence.")) {
    return agents.get("retention") ?? null;
  }

  // Direct actions (no agent routing)
  if (
    actionType.startsWith("customer-engagement.pipeline.") ||
    actionType.startsWith("customer-engagement.contact.") ||
    actionType === "customer-engagement.conversation.escalate" ||
    actionType === "customer-engagement.journey.update_stage"
  ) {
    return null;
  }

  return null;
}
