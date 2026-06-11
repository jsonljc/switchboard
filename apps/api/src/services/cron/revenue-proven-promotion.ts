import type { CreativePastPerformance } from "@switchboard/schemas";
import type { CreativeDescriptor } from "@switchboard/creative-pipeline";

/** FETCH cap on the candidate query (the published-and-pending set is small at pilot scale). */
export const CANDIDATE_FETCH_CAP = 500;

// Promotion floors (spec §3.3). USD major units; reviewed when the first real cohort exists.
export const REVENUE_PROVEN_MIN_SPEND = 50;
export const REVENUE_PROVEN_MIN_BOOKED_COUNT = 2;
export const REVENUE_PROVEN_MIN_TRUE_ROAS = 1.5;

const HOOK_PHRASE: Record<string, string> = {
  pattern_interrupt: "pattern-interrupt hooks",
  question: "question-style hooks",
  bold_statement: "bold-statement hooks",
  none: "no leading hook",
};

/**
 * All floors required. Each numeric is `Number.isFinite`-guarded: pastPerformance
 * is JSON-parsed external data and `z.number()` does not reject NaN, so a NaN would
 * silently pass a bare `>=` comparison (the NaN-blind-gate gotcha). The floors are
 * grounded in internal booked truth (booked.count/value come from ConversionRecords),
 * which is robust to the Meta conversion-denominator trust the (deferred) RevenueState
 * veto would guard — see spec §3.5.
 */
export function passesRevenueProvenFloors(perf: CreativePastPerformance): boolean {
  if (perf.delivery !== "measured") return false;
  const { spend } = perf.meta;
  const { count } = perf.booked;
  const roas = perf.trueRoas;
  return (
    Number.isFinite(spend) &&
    spend >= REVENUE_PROVEN_MIN_SPEND &&
    Number.isFinite(count) &&
    count >= REVENUE_PROVEN_MIN_BOOKED_COUNT &&
    typeof roas === "number" &&
    Number.isFinite(roas) &&
    roas >= REVENUE_PROVEN_MIN_TRUE_ROAS
  );
}

/**
 * `revenue_proven:{mode}_{segment}` (segment = ugc structure else hook), the same
 * descriptor vocabulary as `taste` without polarity. Matches the Mira consumer regex
 * `/^revenue_proven:(polished|ugc)_([a-z0-9_]+)$/` in builders/mira.ts.
 */
export function revenueProvenCanonicalKey(d: CreativeDescriptor): string {
  return `revenue_proven:${d.mode}_${d.structureId ?? d.hookType}`;
}

/**
 * PURE function of the bucket (spec §3.6 + feedback_deployment_memory_dedup_axis):
 * the unique constraint is (org, deployment, category, CONTENT) while we dedup by
 * canonicalKey, so deterministic content makes the constraint a per-bucket constraint
 * and a concurrent duplicate create surfaces as a catchable P2002. NO per-job data
 * (provenance is logged at promotion time, never stored in content).
 */
export function revenueProvenBucketContent(
  mode: string,
  hookType: string,
  structureId?: string,
): string {
  const segment = structureId ? `${structureId} structure` : (HOOK_PHRASE[hookType] ?? hookType);
  return `Revenue-proven: ${mode} creatives with ${segment} (attributed >= ${REVENUE_PROVEN_MIN_TRUE_ROAS}x ROAS)`;
}
