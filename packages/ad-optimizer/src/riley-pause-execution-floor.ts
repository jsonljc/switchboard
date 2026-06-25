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

/**
 * Pure-burn execution floor (D1-1). The standard floor's `conversions >= 10` is a
 * statistical-confidence bar on the CPA — but a PURE BURN has cpa = spend/0 = undefined,
 * not "high", so the conversions floor structurally EXCLUDES the worst case Riley faces:
 * a campaign spending real money with ZERO attributed conversions. Here conversions === 0
 * is the SIGNAL, not missing evidence; confidence comes from the volume axes instead — high
 * clicks (real traffic that never converted) over the full audit window. Same click/day bars
 * as the standard floor; only the conversions requirement is replaced by the exact-zero burn
 * signal. The click/day bars are INHERITED from the standard floor (not re-tuned for the
 * burn case): 100 clicks with zero conversions over 7 days is a strong burn signal in any
 * converting funnel, and a higher burn-specific bar is a possible future refinement.
 *
 * Safety envelope, stated precisely: the pause still parks for MANDATORY human approval and
 * is re-checked at the executor, so a burn pause never self-EXECUTES without a human. The
 * account-level measurement-trust gate (denominator-step-change) auto-demotes a burn during
 * an ACCOUNT-WIDE conversion-tracking outage — but it does NOT catch a CAMPAIGN-SPECIFIC
 * false zero (one campaign's pixel misfiring while the rest of the account converts). For
 * that residual case the mandatory human approval, not the automated gate, is the backstop;
 * the action is also reversible (un-pause).
 */
const RILEY_PAUSE_BURN_EXECUTION_FLOOR = {
  clicks: RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.clicks,
  days: RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.days,
} as const;

export function meetsRileyPauseExecutionFloor(evidence: Evidence): boolean {
  const meetsStandardFloor =
    evidence.clicks >= RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.clicks &&
    evidence.conversions >= RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.conversions &&
    evidence.days >= RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.days;
  // `=== 0` (not `<= 0`) is deliberate: a NaN/negative conversions is missing evidence, not a
  // burn, so it must NOT pass this path (NaN === 0 is false → fail-closed).
  const meetsBurnFloor =
    evidence.conversions === 0 &&
    evidence.clicks >= RILEY_PAUSE_BURN_EXECUTION_FLOOR.clicks &&
    evidence.days >= RILEY_PAUSE_BURN_EXECUTION_FLOOR.days;
  return meetsStandardFloor || meetsBurnFloor;
}
