// ---------------------------------------------------------------------------
// Lifecycle Stage Guard
// ---------------------------------------------------------------------------

export type LifecycleStage = "lead" | "qualified" | "booked" | "treated" | "churned";

const NON_REQUALIFIABLE_STAGES: LifecycleStage[] = ["treated", "booked"];

/**
 * Determines if a contact at the given lifecycle stage can be requalified.
 * Treated and booked contacts should not be requalified — they are active customers.
 */
export function canRequalify(stage: LifecycleStage | undefined): boolean {
  if (!stage) return true;
  return !NON_REQUALIFIABLE_STAGES.includes(stage);
}

const STAGE_TO_AGENT: Record<LifecycleStage, string | null> = {
  lead: "lead-responder",
  qualified: "sales-closer",
  booked: null, // escalate to owner — Nurture doesn't handle message.received
  treated: null, // escalate to owner
  churned: null, // escalate to owner
};

export function agentForStage(stage: LifecycleStage | undefined): string | null {
  if (!stage) return "lead-responder";
  return STAGE_TO_AGENT[stage];
}
