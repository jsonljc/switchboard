import type {
  RecommendationOutputSchema as RecommendationOutput,
  WatchOutputSchema as WatchOutput,
  CampaignInsightSchema as CampaignInsight,
  AdSetLearningInput,
} from "@switchboard/schemas";
import type { SourceComparisonRow } from "./source-comparator.js";
import type { SourceFunnel } from "../crm-data-provider/real-provider.js";
import { compareSources } from "./source-comparator.js";
import { computeSpendBySource } from "./spend-attributor.js";
import { resetsLearningFor, learningPhaseImpactText } from "../action-reset-classification.js";
import { meetsEvidenceFloor } from "../evidence-floor.js";

/**
 * Account-level identity for a cross-source reallocation rec. This is ONE decision
 * about the account's source mix, not a single campaign's, so it carries the same
 * `"account"` sentinel the audit-runner coverage insight uses rather than a real
 * Meta campaign id.
 */
const ACCOUNT_CAMPAIGN_ID = "account";

// Meaningful-difference + winner-quality thresholds. Relocated verbatim from the
// former (never-reached) per-campaign shift branch in recommendation-engine.ts;
// this module is now the single source of truth for the source-shift rule.
const SHIFT_TRUE_ROAS_RATIO = 2;
const SHIFT_MIN_CLOSE_RATE = 0.05;

/**
 * Per-source evidence floor: the Phase-A "sufficient evidence on BOTH sides"
 * requirement. Named config, not magic numbers (evidence-floor.ts §11 convention).
 * `booked` is the trueRoas revenue denominator, so it carries the floor;
 * MIN_SOURCE_BOOKINGS mirrors the `scale` family's `conversions: 3`. Eligibility
 * already implies `spend>0`/`received>0` (trueRoas/closeRate non-null), so this adds
 * a minimum VOLUME, not just non-zero. Tune via the eval, never silently.
 */
export const MIN_SOURCE_LEADS = 10;
export const MIN_SOURCE_BOOKINGS = 3;

/**
 * Best-vs-worst by trueRoas with a meaningful-difference gate. Returns
 * `{ from: worst, to: best }` or null when there is no clear, sufficiently-better
 * winner (<2 eligible, ratio < 2x, or thin winner close rate). Eligibility requires
 * non-null trueRoas + closeRate (honest-null). Relocated from recommendation-engine.ts.
 */
export function findShiftCandidates(
  rows: SourceComparisonRow[],
): { from: SourceComparisonRow; to: SourceComparisonRow } | null {
  const eligible = rows.filter(
    (r) => r.trueRoas !== null && r.trueRoas !== undefined && r.closeRate !== null,
  );
  if (eligible.length < 2) return null;
  let best: SourceComparisonRow | null = null;
  let worst: SourceComparisonRow | null = null;
  for (const r of eligible) {
    if (best === null || (r.trueRoas ?? 0) > (best.trueRoas ?? 0)) best = r;
    if (worst === null || (r.trueRoas ?? 0) < (worst.trueRoas ?? 0)) worst = r;
  }
  if (!best || !worst || best === worst) return null;
  const bestRoas = best.trueRoas ?? 0;
  const worstRoas = worst.trueRoas ?? 0;
  if (worstRoas <= 0) return null;
  if (bestRoas < worstRoas * SHIFT_TRUE_ROAS_RATIO) return null;
  if ((best.closeRate ?? 0) < SHIFT_MIN_CLOSE_RATE) return null;
  return { from: worst, to: best };
}

export interface SourceReallocationInput {
  sourceComparison: { rows: SourceComparisonRow[] };
  /** Per-source funnel counts (received/booked) for the per-source evidence floor. */
  bySource: Record<string, SourceFunnel>;
  /** Account-wide window evidence for the scale-family floor. */
  accountEvidence: { clicks: number; conversions: number; days: number };
  /** Phase-A Gate 1: false ⇒ a suspected account-wide conversion-denominator step-change. */
  measurementTrusted: boolean;
  nextCycleDate: string;
}

function abstain(pattern: string, message: string, nextCycleDate: string): WatchOutput {
  return {
    type: "watch",
    campaignId: ACCOUNT_CAMPAIGN_ID,
    campaignName: "Budget across sources",
    pattern,
    message,
    checkBackDate: nextCycleDate,
  };
}

function sourceHasEvidence(funnel: SourceFunnel | undefined): boolean {
  return (
    funnel !== undefined &&
    funnel.received >= MIN_SOURCE_LEADS &&
    funnel.booked >= MIN_SOURCE_BOOKINGS
  );
}

/**
 * Account-level advisory budget reallocation across sources, fired ONCE per audit
 * from the live per-source economics (which were otherwise discarded before any
 * decision). ADVISORY-ONLY: emits a `shift_budget_to_source` recommendation (queued
 * to the approval surface via the existing sink) or abstains to a watch; it never
 * executes anything — no PlatformIngress, no Meta write.
 *
 * Gates, in order (each pinned by an eval fixture):
 *   1. no clear winner (≥2 eligible, ≥2x trueRoas, winner closeRate ≥5%) → null
 *   2. measurementTrusted === false → measurement_untrusted watch
 *   3. either side under the per-source floor → insufficient_evidence watch
 *   4. account-wide under the scale floor → insufficient_evidence watch
 *   5. else → shift_budget_to_source recommendation
 *
 * Units: trueRoas is already a major ratio; it is compared and formatted, never re-divided.
 */
export function decideSourceReallocation(
  input: SourceReallocationInput,
): RecommendationOutput | WatchOutput | null {
  const candidate = findShiftCandidates(input.sourceComparison.rows);
  if (!candidate) return null;
  const { from, to } = candidate;

  if (input.measurementTrusted === false) {
    return abstain(
      "measurement_untrusted",
      `Holding a budget shift toward ${to.source}: a suspected account-wide conversion-reporting shift makes the cost signal untrustworthy this cycle.`,
      input.nextCycleDate,
    );
  }

  const fromHasEvidence = sourceHasEvidence(input.bySource[from.source]);
  const toHasEvidence = sourceHasEvidence(input.bySource[to.source]);
  if (!fromHasEvidence || !toHasEvidence) {
    return abstain(
      "insufficient_evidence",
      `Not enough per-source evidence to shift budget between ${from.source} and ${to.source} (need at least ${MIN_SOURCE_LEADS} leads and ${MIN_SOURCE_BOOKINGS} bookings on both). Re-checking next cycle.`,
      input.nextCycleDate,
    );
  }

  if (!meetsEvidenceFloor("shift_budget_to_source", input.accountEvidence)) {
    return abstain(
      "insufficient_evidence",
      `Not enough account-wide evidence to shift budget toward ${to.source}: ${input.accountEvidence.clicks} clicks / ${input.accountEvidence.conversions} conversions in window. Re-checking next cycle.`,
      input.nextCycleDate,
    );
  }

  const ratio = ((to.trueRoas ?? 0) / (from.trueRoas ?? 1)).toFixed(1);
  return {
    type: "recommendation",
    action: "shift_budget_to_source",
    campaignId: ACCOUNT_CAMPAIGN_ID,
    campaignName: `${from.source} to ${to.source}`,
    confidence: 0.6,
    urgency: "this_week",
    estimatedImpact: `${to.source} trueRoas is ${ratio}x ${from.source}. Consider shifting budget toward ${to.source}.`,
    steps: [
      `Reduce budget on ${from.source} (trueRoas ${from.trueRoas?.toFixed(2)})`,
      `Increase budget on ${to.source} (trueRoas ${to.trueRoas?.toFixed(2)})`,
      "Source attribution is heuristic; operator should validate before large reallocations.",
    ],
    learningPhaseImpact: learningPhaseImpactText("shift_budget_to_source"),
    resetsLearning: resetsLearningFor("shift_budget_to_source"),
    params: {
      from: from.source,
      to: to.source,
      fromTrueRoas: String(from.trueRoas),
      toTrueRoas: String(to.trueRoas),
    },
  };
}

export interface SourceReallocationSectionInput {
  crmData: { bySource?: Record<string, SourceFunnel> };
  currentInsights: CampaignInsight[];
  adSetData: AdSetLearningInput[] | null;
  measurementTrusted: boolean;
  nextCycleDate: string;
}

/**
 * Audit-runner Step-8b orchestrator (relocated from audit-runner.ts to keep that
 * file under the 600-line cap). Computes the per-source comparison AND the
 * account-level reallocation decision together. Pure/sync — the booked-VALUE
 * per-campaign economics stay in audit-runner (they need an async provider call).
 * Returns `sourceComparison` for the report plus the reallocation rec/watch (or null).
 */
export function computeSourceReallocationSection(input: SourceReallocationSectionInput): {
  sourceComparison?: { rows: SourceComparisonRow[] };
  reallocation: RecommendationOutput | WatchOutput | null;
} {
  const bySource = input.crmData.bySource;
  if (!bySource || Object.keys(bySource).length === 0) {
    return { reallocation: null };
  }
  const spendBySource = computeSpendBySource(input.currentInsights, bySource, input.adSetData);
  const sourceComparison = compareSources({ bySource, spendBySource });
  const reallocation = decideSourceReallocation({
    sourceComparison,
    bySource,
    accountEvidence: {
      clicks: input.currentInsights.reduce((s, i) => s + i.inlineLinkClicks, 0),
      conversions: input.currentInsights.reduce((s, i) => s + i.conversions, 0),
      days: 7,
    },
    measurementTrusted: input.measurementTrusted,
    nextCycleDate: input.nextCycleDate,
  });
  return { sourceComparison, reallocation };
}
