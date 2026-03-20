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
