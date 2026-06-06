import type { Evidence } from "./evidence-floor.js";

/**
 * PHASE-C wiring: the EXECUTION evidence floor for a Riley self-submitted pause.
 * Deliberately RAISED above the destructive recommendation floor ({clicks: 50,
 * conversions: 5, days: 7}, evidence-floor.ts): advising a pause and asking to
 * EXECUTE one are different acts; weak-evidence pauses stay advisory.
 *
 * `days` stays 7 ON PURPOSE: the weekly audit's evidence window IS 7 days
 * (audit-runner.ts windowDays), so any higher days floor would make the feature
 * permanently inert (the producer-population trap). Raise volume axes only.
 *
 * Consumed by: the apps/api submit builder (abstention), the pause executor
 * (defense-in-depth re-check), and the pause dispatch gate. ONE constant so the
 * sites cannot drift.
 */
export const RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR: Evidence = {
  clicks: 100,
  conversions: 10,
  days: 7,
};

export function meetsRileyPauseExecutionFloor(evidence: Evidence): boolean {
  return (
    evidence.clicks >= RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.clicks &&
    evidence.conversions >= RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.conversions &&
    evidence.days >= RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.days
  );
}
