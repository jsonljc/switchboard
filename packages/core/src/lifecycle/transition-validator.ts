import type { OpportunityStage } from "@switchboard/schemas";

export interface TransitionResult {
  valid: boolean;
  reason?: string;
}

/** Explicitly enumerated valid transitions. Each key maps to the set of valid target stages. */
export const TRANSITION_GRAPH: Record<OpportunityStage, readonly OpportunityStage[]> = {
  interested: ["qualified", "quoted", "booked", "lost", "nurturing"],
  qualified: ["quoted", "booked", "lost", "nurturing"],
  quoted: ["booked", "lost", "nurturing"],
  booked: ["showed", "lost", "nurturing"],
  showed: ["won", "lost", "nurturing"],
  won: [],
  lost: ["nurturing", "interested"],
  nurturing: ["interested", "qualified", "lost"],
};

export function validateTransition(from: OpportunityStage, to: OpportunityStage): TransitionResult {
  if (from === to) {
    return { valid: false, reason: `Already in stage "${from}"` };
  }

  const validTargets = TRANSITION_GRAPH[from];
  if (validTargets.includes(to)) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: `Invalid transition: "${from}" → "${to}". Valid targets: ${validTargets.join(", ") || "none (terminal)"}`,
  };
}
