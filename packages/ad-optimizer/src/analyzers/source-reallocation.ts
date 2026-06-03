import type {
  RecommendationOutputSchema as RecommendationOutput,
  WatchOutputSchema as WatchOutput,
  CampaignInsightSchema as CampaignInsight,
  AdSetLearningInput,
} from "@switchboard/schemas";
import type { SourceComparisonRow, CampaignEconomicsRow } from "./source-comparator.js";
import type { SourceFunnel, CampaignFunnel } from "../crm-data-provider/real-provider.js";
import { compareSources, compareCampaigns } from "./source-comparator.js";
import { computeSpendBySource, SPEND_ATTRIBUTION_COVERAGE_FLOOR } from "./spend-attributor.js";
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
 * Absolute profitability floor on the WINNER source. The 2x ratio is RELATIVE, so
 * without this a "from 0.05x -> to 0.10x" pair (both losing ~90%) would clear it and
 * Riley would confidently advise "shift toward the winner" when that winner is itself
 * deeply unprofitable. A trueROAS below 1 means the source does not even return its
 * spend; there is no honest "shift toward it" signal, so we abstain to null (the
 * account-wide unprofitability surfaces through the per-campaign recs, not here).
 */
const SHIFT_MIN_WINNER_TRUE_ROAS = 1;

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
  /**
   * False ⇒ per-source spend came from the lead-share fallback (no ad-set destination
   * attribution), so the trueROAS comparison rests on synthetic spend and is too
   * approximate to drive a budget decision. Derived by the orchestrator from `adSetData`.
   */
  spendAttributionTrusted: boolean;
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
 *   2. winner itself unprofitable (trueRoas < 1) → null
 *   3. per-source spend not ad-set-attributed (lead-share fallback) → null
 *   4. measurementTrusted === false → measurement_untrusted watch
 *   5. either side under the per-source floor → insufficient_evidence watch
 *   6. account-wide under the scale floor → insufficient_evidence watch
 *   7. else → shift_budget_to_source recommendation
 *
 * Units: trueRoas is already a major ratio; it is compared and formatted, never re-divided.
 */
export function decideSourceReallocation(
  input: SourceReallocationInput,
): RecommendationOutput | WatchOutput | null {
  const candidate = findShiftCandidates(input.sourceComparison.rows);
  if (!candidate) return null;
  const { from, to } = candidate;
  // findShiftCandidates guarantees both trueRoas are non-null and worst > 0; the `?? 0`
  // only satisfies the type, so fromRoas is always > 0 (a safe ratio denominator).
  const fromRoas = from.trueRoas ?? 0;
  const toRoas = to.trueRoas ?? 0;

  // Absolute winner-profitability floor — the relative 2x ratio is not enough alone.
  if (toRoas < SHIFT_MIN_WINNER_TRUE_ROAS) return null;

  // Per-source spend must come from ad-set destination attribution, not the lead-share
  // fallback (synthetic). Without it the trueROAS comparison is too approximate to drive a
  // budget decision -> no signal (the economics still reach the report's display).
  if (!input.spendAttributionTrusted) return null;

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

  const ratio = (toRoas / fromRoas).toFixed(1);
  return {
    type: "recommendation",
    action: "shift_budget_to_source",
    campaignId: ACCOUNT_CAMPAIGN_ID,
    campaignName: `${from.source} to ${to.source}`,
    confidence: 0.6,
    urgency: "this_week",
    estimatedImpact: `${to.source} trueRoas is ${ratio}x ${from.source}. Consider shifting budget toward ${to.source}.`,
    steps: [
      `Reduce budget on ${from.source} (trueRoas ${fromRoas.toFixed(2)})`,
      `Increase budget on ${to.source} (trueRoas ${toRoas.toFixed(2)})`,
      "Source attribution is heuristic; operator should validate before large reallocations.",
    ],
    learningPhaseImpact: learningPhaseImpactText("shift_budget_to_source"),
    resetsLearning: resetsLearningFor("shift_budget_to_source"),
    params: {
      from: from.source,
      to: to.source,
      fromTrueRoas: fromRoas.toFixed(2),
      toTrueRoas: toRoas.toFixed(2),
    },
  };
}

/**
 * Minimal shape of the injected booked-VALUE port (audit-runner's
 * BookedValueByCampaignProvider). Declared structurally so this module does NOT
 * import from audit-runner (which imports this module). Values are CENTS.
 */
interface BookedValueProvider {
  queryBookedValueCentsByCampaign(query: {
    orgId: string;
    from: Date;
    to: Date;
    campaignIds?: string[];
  }): Promise<Map<string, number>>;
}

export interface AuditEconomicsSectionsInput {
  /** Per-source funnel (real-provider only); undefined ⇒ no source comparison / reallocation. */
  bySource: Record<string, SourceFunnel> | undefined;
  /** Per-campaign funnel (real-provider only); undefined ⇒ no campaign economics. */
  byCampaign: Record<string, CampaignFunnel> | undefined;
  currentInsights: CampaignInsight[];
  adSetData: AdSetLearningInput[] | null;
  measurementTrusted: boolean;
  nextCycleDate: string;
  orgId: string;
  dateRange: { since: string; until: string };
  /** Injected booked-VALUE port; absent ⇒ trueROAS reported null (graceful). */
  bookedValueProvider?: BookedValueProvider;
}

/**
 * Audit-runner Step-8b economics orchestrator, relocated from audit-runner.ts to keep
 * that file under the 600-line cap. Computes BOTH the per-source comparison (and the
 * account-level reallocation advisory it now drives) AND the per-campaign economics
 * (booked-CAC + trueROAS) in one place. The reallocation is the NEW behavior: the
 * per-source economics, previously computed-then-discarded, now drive one advisory
 * `shift_budget_to_source` rec. The campaignEconomics computation is moved verbatim
 * (behavior-preserving).
 */
export async function computeAuditEconomicsSections(input: AuditEconomicsSectionsInput): Promise<{
  sourceComparison?: { rows: SourceComparisonRow[] };
  campaignEconomics?: { rows: CampaignEconomicsRow[] };
  reallocation: RecommendationOutput | WatchOutput | null;
}> {
  // Per-source comparison + the account-level reallocation advisory.
  let sourceComparison: { rows: SourceComparisonRow[] } | undefined;
  let reallocation: RecommendationOutput | WatchOutput | null = null;
  const { bySource } = input;
  if (bySource && Object.keys(bySource).length > 0) {
    const { spendBySource, attributedFraction } = computeSpendBySource(
      input.currentInsights,
      bySource,
      input.adSetData,
    );
    sourceComparison = compareSources({ bySource, spendBySource });
    // Per-source spend is trustworthy only when a sufficient FRACTION of total spend is
    // ad-set-attributed (coverage), not on mere ad-set presence; below the floor the
    // trueROAS comparison rests too heavily on the synthetic lead-share fallback to move
    // budget. Gate the DECISION on coverage (the comparison still feeds the report's
    // display). With ad-set attribution now wired into the weekly cron, this fires in
    // production when coverage clears the floor and abstains (honest-null) when it does not.
    const spendAttributionTrusted = attributedFraction >= SPEND_ATTRIBUTION_COVERAGE_FLOOR;
    reallocation = decideSourceReallocation({
      sourceComparison,
      bySource,
      spendAttributionTrusted,
      accountEvidence: {
        clicks: input.currentInsights.reduce((s, i) => s + i.inlineLinkClicks, 0),
        conversions: input.currentInsights.reduce((s, i) => s + i.conversions, 0),
        // Weekly audit cadence. Only clicks/conversions actually gate the scale floor
        // (the `days` floor is 7 and a weekly audit always satisfies it).
        days: 7,
      },
      measurementTrusted: input.measurementTrusted,
      nextCycleDate: input.nextCycleDate,
    });
  }

  // Per-campaign economics (booked-CAC + trueROAS). Booked VALUE (cents) comes from the
  // injected port; absent ⇒ trueROAS null (graceful degradation, never a fabricated 0).
  let campaignEconomics: { rows: CampaignEconomicsRow[] } | undefined;
  const { byCampaign } = input;
  if (byCampaign && Object.keys(byCampaign).length > 0) {
    const spendByCampaign: Record<string, number> = {};
    for (const i of input.currentInsights) spendByCampaign[i.campaignId] = i.spend;
    const bookedValueCentsByCampaign = input.bookedValueProvider
      ? await input.bookedValueProvider.queryBookedValueCentsByCampaign({
          orgId: input.orgId,
          from: new Date(input.dateRange.since),
          to: new Date(input.dateRange.until),
          campaignIds: input.currentInsights.map((i) => i.campaignId),
        })
      : new Map<string, number>();
    campaignEconomics = compareCampaigns({
      byCampaign,
      spendByCampaign,
      bookedValueCentsByCampaign,
    });
  }

  return { sourceComparison, campaignEconomics, reallocation };
}
