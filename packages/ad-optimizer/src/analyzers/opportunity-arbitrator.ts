import type {
  RecommendationOutputSchema as RecommendationOutput,
  EconomicTierSchema as EconomicTier,
  ResetsLearningSchema as ResetsLearning,
} from "@switchboard/schemas";
import { ACTION_CONTRACT, isMutating } from "../action-contract.js";
import type { RevenueState } from "../revenue-state.js";
import { ACCOUNT_CAMPAIGN_ID } from "./source-reallocation.js";

/**
 * Riley v3 slice 2 (spec section 3): the OpportunityArbitrator. For low-volume SMB,
 * multiple simultaneous mutating edits in one cycle wreck attribution and reset
 * learning (the OutcomeLedger flags that damage after the fact as
 * same_campaign_overlap / same_kind_retry). The arbitrator closes the loop BEFORE
 * the fact, as decision support: it names the single most material mutating
 * opportunity per account per cycle (plus optionally one non-mutating measurement
 * fix) so the operator approves one change rather than many.
 *
 * ADDITIVE RANKING METADATA ONLY: arbitrate() is pure, never filters or reorders
 * candidates, and nothing in the emission or handoff path reads its output. The
 * ranking lands on the audit report for operator surfaces to consume later.
 *
 * Deterministic, model-free score per mutating candidate, every term in [0,1]:
 *   score = shareOfSpend x revenueProximity x truthConfidence
 *           - learningResetPenalty - attributionConflictPenalty
 * Tuning lives in the named constants below; tune via the eval, never silently.
 */

/** revenueProximity: how close this cycle's economic tier sits to booked revenue. */
export const PROXIMITY_BY_TIER: Record<EconomicTier, number> = {
  booked_cac: 1,
  cpl: 0.85,
  cpc: 0.7,
};

/** truthConfidence factor when the conversion denominator is suspect (producer 1). */
export const MEASUREMENT_UNTRUSTED_FACTOR = 0.5;

/** truthConfidence factor for a yellow signal-health score (red aborts upstream). */
export const SIGNAL_YELLOW_FACTOR = 0.8;

/** Penalty per learning-reset class (ACTION_CONTRACT.resetsLearning). */
export const LEARNING_RESET_PENALTY: Record<ResetsLearning, number> = {
  yes: 0.15,
  conditional: 0.05,
  no: 0,
};

/** Penalty when >=2 mutating candidates target the same campaign this cycle (the
 * intra-cycle analogue of the ledger's same_campaign_overlap flag). Account-scope
 * vs campaign-scope cross-conflicts are deliberately NOT penalized in slice 2. */
export const ATTRIBUTION_CONFLICT_PENALTY = 0.2;

const URGENCY_RANK: Record<RecommendationOutput["urgency"], number> = {
  immediate: 0,
  this_week: 1,
  next_cycle: 2,
};

/** A ranked mutating candidate. `index` is the candidate's position in the audit
 * report's recommendations[] (recs carry no id at report time; campaignId+action
 * alone is not unique, e.g. per-breach fix_signal_health recs). */
export interface RankedOpportunity {
  campaignId: string;
  action: RecommendationOutput["action"];
  index: number;
  score: number;
}

/** The selected non-mutating measurement fix (bypasses the mutating cap; unscored). */
export interface MeasurementFixRef {
  campaignId: string;
  action: RecommendationOutput["action"];
  index: number;
}

export interface ArbitrationResult {
  /** The single most material mutating opportunity; absent when no mutating candidate. */
  primary?: RankedOpportunity;
  /** Every other mutating candidate, best-first (same total order as primary). */
  secondary: RankedOpportunity[];
  /** At most one measurement-integrity fix (fix_signal_health / harden_capi_attribution). */
  measurementFix?: MeasurementFixRef;
}

export interface ArbitrateInput {
  /** The report's recommendations[] verbatim (order defines `index`). Never mutated. */
  candidates: RecommendationOutput[];
  /** Account-level pre-flight state; pass the economics-ENRICHED state (producer 6). */
  revenueState: RevenueState;
  /** Structured materiality source: per-campaign current-window spend (dollars). */
  currentInsights: ReadonlyArray<{ campaignId: string; spend: number }>;
  /** Per-source attributed spend (dollars); keys the account-scoped shift candidate's
   * magnitude (its params.from pool). Absent -> that candidate's magnitude is 0. */
  spendBySource?: Record<string, number>;
  /** Per-campaign VERIFIED-PAID value (cents) for the window, when the paid-value provider
   * is wired (the live audit-runner already computes this Map for the scale paid-value gate).
   * Used to rank value-capture (`scale`) candidates by PROVEN paid value rather than current
   * spend share — the north-star money move reallocates TOWARD proven value. Absent, or an
   * account with zero total attributed paid value (prod reality until booked value is stamped),
   * ⇒ spend-share materiality, exactly as before (back-compat with every caller and the eval). */
  paidValueByCampaign?: ReadonlyMap<string, number>;
}

/**
 * Value-capture materiality: a `scale` (budget-INCREASE) candidate's materiality should be
 * its share of PROVEN paid value, not its current spend share — the reallocation money move
 * pushes budget TOWARD what pays, so a cheap-CPA low-value campaign must not out-rank a
 * far-more-valuable one just because it currently spends more. `valueShareByCampaign` is
 * present only when paid-value data exists AND the account has positive total paid value;
 * otherwise scale falls back to spend share. Destructive/structural candidates (pause, etc.)
 * always keep spend-share materiality: pausing the biggest bleeder is the right call
 * regardless of its (irrelevant) paid value.
 */
function materialityFor(
  candidate: RecommendationOutput,
  shareOfSpend: number,
  valueShareByCampaign: ReadonlyMap<string, number> | undefined,
): number {
  if (candidate.action === "scale" && valueShareByCampaign !== undefined) {
    return valueShareByCampaign.get(candidate.campaignId) ?? 0;
  }
  return shareOfSpend;
}

/** Build per-campaign value shares in [0,1] from the paid-value Map, or `undefined` when no
 * usable signal exists (absent map, or zero/non-finite total) so callers fall back to spend
 * share. Fail-closed: a campaign with non-finite/negative value contributes 0. */
function buildValueShares(
  paidValueByCampaign: ReadonlyMap<string, number> | undefined,
): Map<string, number> | undefined {
  if (paidValueByCampaign === undefined) return undefined;
  let total = 0;
  for (const v of paidValueByCampaign.values()) {
    if (Number.isFinite(v) && v > 0) total += v;
  }
  if (total <= 0) return undefined;
  const shares = new Map<string, number>();
  for (const [campaignId, v] of paidValueByCampaign) {
    shares.set(campaignId, Number.isFinite(v) && v > 0 ? v / total : 0);
  }
  return shares;
}

/** Structured magnitude (dollars) for one candidate: its campaign's spend, or for the
 * account-scoped shift candidate, the from-source attributed spend being re-potted.
 * Never the estimateRisk prose dollar-scrape (spec 7.6). A campaignId absent from the
 * audited insights (defensive; not produced today) falls back to 0, so such a
 * candidate stays rankable but can never become primary. */
function magnitudeFor(
  candidate: RecommendationOutput,
  spendByCampaign: ReadonlyMap<string, number>,
  spendBySource: Record<string, number> | undefined,
): number {
  if (candidate.campaignId === ACCOUNT_CAMPAIGN_ID) {
    const from = candidate.params?.from;
    return from !== undefined ? (spendBySource?.[from] ?? 0) : 0;
  }
  return spendByCampaign.get(candidate.campaignId) ?? 0;
}

/** Per-candidate truth confidence in [0,1] from the RevenueState composite. The
 * per-source attribution-coverage factor applies ONLY to the cross-source shift
 * candidate (it is a per-source signal; campaign candidates are not gated on it). */
function truthConfidenceFor(candidate: RecommendationOutput, state: RevenueState): number {
  let confidence =
    (state.measurementTrusted ? 1 : MEASUREMENT_UNTRUSTED_FACTOR) *
    (state.signalHealthScore === "yellow" ? SIGNAL_YELLOW_FACTOR : 1) *
    (state.coverage?.coveragePct ?? 1);
  if (
    candidate.action === "shift_budget_to_source" &&
    candidate.params?.from !== undefined &&
    candidate.params?.to !== undefined &&
    state.spendAttributionCoverageBySource !== undefined
  ) {
    const fromCov = state.spendAttributionCoverageBySource[candidate.params.from];
    const toCov = state.spendAttributionCoverageBySource[candidate.params.to];
    // The decision gate already enforced the 0.7 floor at creation; absence here is a
    // plumbing gap, not a signal gap, so missing entries do not re-penalize.
    confidence *= Math.min(fromCov ?? 1, toCov ?? 1, 1);
  }
  return confidence;
}

/** Total deterministic order: score desc, campaignId asc, action asc, index asc. */
function compareRanked(a: RankedOpportunity, b: RankedOpportunity): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.campaignId !== b.campaignId) return a.campaignId < b.campaignId ? -1 : 1;
  if (a.action !== b.action) return a.action < b.action ? -1 : 1;
  return a.index - b.index;
}

export function arbitrate(input: ArbitrateInput): ArbitrationResult {
  const { candidates, revenueState, spendBySource } = input;

  const spendByCampaign = new Map<string, number>();
  let accountSpend = 0;
  for (const i of input.currentInsights) {
    spendByCampaign.set(i.campaignId, i.spend);
    accountSpend += i.spend;
  }

  // Conflict detection: a campaign with >=2 mutating candidates this cycle.
  const mutatingCountByCampaign = new Map<string, number>();
  for (const c of candidates) {
    if (!isMutating(c.action)) continue;
    mutatingCountByCampaign.set(c.campaignId, (mutatingCountByCampaign.get(c.campaignId) ?? 0) + 1);
  }

  const proximity = PROXIMITY_BY_TIER[revenueState.economicTier ?? "cpc"];
  const valueShareByCampaign = buildValueShares(input.paidValueByCampaign);

  const ranked: RankedOpportunity[] = [];
  let measurementFix: MeasurementFixRef | undefined;
  let measurementFixRank = Number.POSITIVE_INFINITY;

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!;
    const contract = ACTION_CONTRACT[candidate.action];

    if (contract.evidenceFamily === "measurement") {
      // Measurement-integrity fixes bypass the mutating cap: non-mutating, they do not
      // conflict with attribution and must never be starved by it. Pick ONE, by
      // urgency rank then report order.
      const rank = URGENCY_RANK[candidate.urgency] * candidates.length + index;
      if (rank < measurementFixRank) {
        measurementFixRank = rank;
        measurementFix = { campaignId: candidate.campaignId, action: candidate.action, index };
      }
      continue;
    }

    if (!isMutating(candidate.action)) continue; // hold/test: informational, unranked.

    const magnitude = magnitudeFor(candidate, spendByCampaign, spendBySource);
    const shareOfSpend = accountSpend > 0 ? Math.min(magnitude / accountSpend, 1) : 0;
    // Value-capture (scale) candidates rank on proven paid-value share; all others on spend
    // share (see materialityFor). Both are in [0,1] but use DIFFERENT denominators (value-pool
    // vs spend-pool), so a high-paid-value scale can outrank a lower-value pause and become
    // primary. That is intended (push budget toward proven value), and safe today: this output
    // is advisory ranking metadata, and the only primary-gated consumer (pause self-submission)
    // is double-flag-gated (env + per-deployment) AND inert until paid-value data exists (with
    // zero account paid value, valueShareByCampaign is undefined ⇒ pure spend-share, as before).
    const materiality = materialityFor(candidate, shareOfSpend, valueShareByCampaign);
    const conflictPenalty =
      (mutatingCountByCampaign.get(candidate.campaignId) ?? 0) >= 2
        ? ATTRIBUTION_CONFLICT_PENALTY
        : 0;
    const score =
      materiality * proximity * truthConfidenceFor(candidate, revenueState) -
      LEARNING_RESET_PENALTY[candidate.resetsLearning] -
      conflictPenalty;
    ranked.push({ campaignId: candidate.campaignId, action: candidate.action, index, score });
  }

  ranked.sort(compareRanked);
  const [primary, ...secondary] = ranked;
  return {
    ...(primary !== undefined ? { primary } : {}),
    secondary,
    ...(measurementFix !== undefined ? { measurementFix } : {}),
  };
}
