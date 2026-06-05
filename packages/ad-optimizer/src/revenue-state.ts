import { OPERATIONAL_STATE_VOUCH_MS } from "@switchboard/schemas";
import type {
  EconomicTierSchema as EconomicTier,
  MarginBasisSchema as MarginBasis,
} from "@switchboard/schemas";

/** Signal-health score (red short-circuits the audit before the decision layer). */
export type SignalHealthScore = "red" | "yellow" | "green";

/**
 * Slice-4c: freshness of the operator-confirmed operational-state source
 * (the 4a substrate; spec 7.4 "staleness of the input itself").
 * - "fresh": the latest confirmation is at most OPERATIONAL_STATE_VOUCH_DAYS old.
 * - "stale": a confirmation exists but is older than the vouch window.
 * - "unknown": no confirmation exists (honest absence; legacy orgs and orgs
 *   that never confirmed stay "unknown" forever) or no source is wired (the
 *   eval harness and analysis-only callers).
 * Advisory CARRY in this slice: nothing in the decision layer gates on it.
 * It is the designed input for slice-5/Phase-C gating, which must bring its
 * own pin when it flips.
 */
export type BusinessContextFreshness = "fresh" | "stale" | "unknown";

/**
 * Account-level "is it safe to act?" pre-flight object for one audit cycle. Consolidates
 * the six independent signals that AuditRunner.run() previously threaded as loose
 * positional variables. Assembled PROGRESSIVELY in producer order: it is only ever built
 * on the post-abort happy path, and its late fields (economicTier, effectiveTarget,
 * marginBasis, coverage, signalHealthScore, spendAttributionCoverageBySource) are
 * optional because they are unavailable at the two early aborts. Per-campaign economic
 * tier/target are NOT here; they are resolved per-campaign and passed separately.
 */
export interface RevenueState {
  /** Producer 1 (evaluateDenominatorStepChange): account-wide conversion-denominator trust.
   *  Present whenever the decision layer runs (computed after both aborts). */
  measurementTrusted: boolean;
  /** Producer 2 (resolveEconomicTarget): account economic tier (the Tier-2 fallback feeding
   *  per-campaign resolution and slice-2's revenueProximity). */
  economicTier?: EconomicTier;
  /** Producer 2: account effective target paired with economicTier. */
  effectiveTarget?: number;
  /** Producer 3: margin basis. Currently always "unavailable" (no AOV/margin source plumbed). */
  marginBasis?: MarginBasis;
  /** Producer 4 (CoverageValidator Gate-0): tracked-source coverage. Present only when a
   *  coverage validator was injected; on the happy path it is always sufficient (an
   *  insufficient result aborts before the decision layer). Read by slice-2 truthConfidence. */
  coverage?: { coveragePct: number; sufficient: boolean };
  /** Producer 5 (SignalHealthChecker): signal-health score. Present only when checker+pixelId
   *  were wired; on the happy path it is never "red" (red aborts first). Read by slice-2. */
  signalHealthScore?: SignalHealthScore;
  /** Producer 6 (computeSpendBySource): per-source spend-attribution coverage [0,1]. Completed
   *  LATE inside computeAuditEconomicsSections; absent at both aborts and during the
   *  per-campaign loop. Read by decideSourceReallocation. */
  spendAttributionCoverageBySource?: Record<string, number>;
  /** Slice-4 reserved; always "unknown" in slice 1. */
  businessContextFreshness: BusinessContextFreshness;
}

/** The account-level producer outputs known by the time the per-campaign loop begins. */
export interface AssembleRevenueStateInput {
  measurementTrusted: boolean;
  economicTier?: EconomicTier;
  effectiveTarget?: number;
  marginBasis?: MarginBasis;
  coverage?: { coveragePct: number; sufficient: boolean };
  signalHealthScore?: SignalHealthScore;
  /** Slice-4c: derived freshness. Absent (eval harness, analysis-only callers) ⇒ "unknown". */
  businessContextFreshness?: BusinessContextFreshness;
}

/**
 * Pure assembly of the account-level RevenueState from producer outputs already in scope.
 * No new computation: every field is a pass-through; this only co-locates them and stamps
 * the slice-4 reserved default. Omits undefined optional fields so partial (pre-economics)
 * states are honest.
 */
export function assembleRevenueState(input: AssembleRevenueStateInput): RevenueState {
  return {
    measurementTrusted: input.measurementTrusted,
    ...(input.economicTier !== undefined ? { economicTier: input.economicTier } : {}),
    ...(input.effectiveTarget !== undefined ? { effectiveTarget: input.effectiveTarget } : {}),
    ...(input.marginBasis !== undefined ? { marginBasis: input.marginBasis } : {}),
    ...(input.coverage !== undefined ? { coverage: input.coverage } : {}),
    ...(input.signalHealthScore !== undefined
      ? { signalHealthScore: input.signalHealthScore }
      : {}),
    businessContextFreshness: input.businessContextFreshness ?? "unknown",
  };
}

/**
 * Progressive late-field completion: returns a NEW RevenueState with the per-source
 * spend-attribution coverage filled in. Pure (does not mutate the input). Called by
 * computeAuditEconomicsSections once computeSpendBySource has produced coverageBySource.
 */
export function withSpendAttributionCoverage(
  state: RevenueState,
  spendAttributionCoverageBySource: Record<string, number>,
): RevenueState {
  return { ...state, spendAttributionCoverageBySource };
}

/**
 * Derive freshness from the latest operator confirmation (spec 7.4: the
 * anchor is when the operator last confirmed, immune to unrelated writes by
 * the 4a append-only design). Structural input; only confirmedAt matters.
 * Boundary: age <= the vouch window is fresh (a confirmation made exactly
 * OPERATIONAL_STATE_VOUCH_DAYS ago still vouches). A future-dated
 * confirmedAt (clock skew) is fresh, never stale.
 */
export function deriveBusinessContextFreshness(
  latest: { confirmedAt: Date } | null,
  now: Date,
): BusinessContextFreshness {
  if (latest === null) return "unknown";
  return now.getTime() - latest.confirmedAt.getTime() <= OPERATIONAL_STATE_VOUCH_MS
    ? "fresh"
    : "stale";
}

/**
 * Async wrapper the audit runner calls: resolve the latest confirmation from
 * the injected provider and derive freshness. Degrades a read failure to
 * "unknown" with a warning rather than sinking the weekly audit: freshness
 * is an advisory carry field (not a gate), and the audit re-runs weekly so a
 * transient blip self-heals. (Deliberate asymmetry with the outcome path,
 * which PROPAGATES read failures: outcome rows are insert-once, so a blip
 * written there would freeze "unknown" forever.)
 */
export async function resolveBusinessContextFreshness(
  provider:
    | { getLatest(organizationId: string): Promise<{ confirmedAt: Date } | null> }
    | undefined,
  organizationId: string,
  now: Date,
): Promise<BusinessContextFreshness> {
  if (!provider) return "unknown";
  try {
    return deriveBusinessContextFreshness(await provider.getLatest(organizationId), now);
  } catch (err) {
    console.warn(
      `[ad-optimizer] operational-state read failed for org=${organizationId}; ` +
        `businessContextFreshness=unknown this run: ${String(err)}`,
    );
    return "unknown";
  }
}
