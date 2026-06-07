import {
  OPERATIONAL_STATE_VOUCH_MS,
  type OperationalInterval,
  type OperationalState,
  type OperationalStateConfirmation,
} from "@switchboard/schemas";
import type { BusinessContextStability } from "./outcome-attribution-types.js";

/**
 * Derive businessContextStable for a PAST attribution window from the
 * operator operational-state confirmations overlapping it (Riley v3 slice
 * 4c; spec sections 2.5 and 7.4).
 *
 * Input contract (the 4a store's getConfirmationsOverlappingWindow): the
 * latest confirmation at-or-before windowStart (the regime governing entry,
 * at most one) plus every confirmation inside (windowStart, windowEnd],
 * oldest first, ties by (confirmedAt, createdAt, id). The derivation
 * re-sorts defensively by the same triple, so its verdict is independent of
 * caller ordering. Malformed rows were already degraded to absence by the
 * store with a warning; nothing here resurrects them. The window spans BOTH
 * attribution sub-windows (anchorAt ± windowDays) and is HALF-OPEN
 * [windowStartedAt, windowEndedAt): the engine's Meta window queries are
 * endExclusive at postEnd, so the verdict covers exactly the measured
 * pre/post span.
 *
 * Since slice 4e the input may ALSO contain confirmations recorded after
 * windowEndedAt (the orchestrator widens the read's end bound to the
 * attribution moment). Such late rows are bucketed out internally and admit
 * DISRUPTION-ONLY evidence through their dated promo/closure intervals:
 * geometry alone, never scalars, never the declaration-change detector,
 * never certification. The asymmetry is structural, not policed:
 * certification reads only the governing row, and a late row can never
 * govern (governing requires confirmedAt <= windowStartedAt).
 *
 * The verdict applies the DIFFERENCING principle: a pre/post delta is
 * comparable when the context did not CHANGE across the window. A condition
 * constant across the whole window (a promo running throughout, a staffing
 * shortfall in force the entire time) differences out; a condition that
 * starts, ends, or flips inside the window confounds the delta. The one
 * carve-out is closure: a temporarily_closed regime or a closure interval
 * overlapping any part of the window voids the result outright (spec 2.5:
 * "stable enough for the result to mean anything"; a closed business
 * transacts nothing, so constancy does not rescue comparability).
 *
 * Output:
 * - "unstable": affirmative disruption evidence (closure overlap,
 *   temporarily_closed in force, a promo partially overlapping the window,
 *   a scalar value flipping mid-window, the window-overlapping subset of a
 *   declared interval list changing mid-window, or a disrupted scalar first
 *   confirmed mid-window with no prior knowledge). Disruption evidence is
 *   exempt from the vouch window; evidence does not expire the way an
 *   attestation of normalcy does.
 * - "stable": an affirmative certification requiring a governing row that
 *   is fresh at window entry (windowStart - confirmedAt <=
 *   OPERATIONAL_STATE_VOUCH_MS), confirms ALL FIVE operational dimensions
 *   (an unconfirmed dimension is "operator never said" and silence must not
 *   vouch; explicit [] = "confirmed none" is a POSITIVE signal and counts),
 *   and no disruption per the rules above.
 * - "unknown": everything else, meaning an empty set, no governing row, a
 *   stale governing row, or unconfirmed dimensions (honest absence; never a
 *   fabricated "stable").
 */
export interface DeriveBusinessContextStabilityInput {
  /**
   * Confirmations overlapping the window (governing + in-window, oldest
   * first) plus, since slice 4e, any rows recorded after windowEndedAt that
   * exist at attribution time (the widened orchestrator read). Bucketing is
   * internal; late rows contribute dated-interval disruption evidence only.
   */
  confirmations: OperationalStateConfirmation[];
  windowStartedAt: Date;
  windowEndedAt: Date;
}

type ScalarDimension = "operatingStatus" | "staffing" | "inventory";
const SCALAR_DIMENSIONS: readonly ScalarDimension[] = ["operatingStatus", "staffing", "inventory"];

/** Scalar values that are themselves disruption evidence when first seen mid-window. */
const DISRUPTED_SCALAR_VALUES: ReadonlySet<string> = new Set([
  "temporarily_closed",
  "shortfall",
  "outage",
]);

type IntervalDimension = "promoWindows" | "closures";
const INTERVAL_DIMENSIONS: readonly IntervalDimension[] = ["promoWindows", "closures"];

function intervalBoundsMs(interval: OperationalInterval): { startMs: number; endMs: number } {
  return {
    startMs: Date.parse(interval.start),
    // Open-ended ("until further notice") runs forever. Bounds are half-open
    // [start, end) per the 4b editor's org-timezone day-boundary conversion.
    endMs: interval.end !== undefined ? Date.parse(interval.end) : Number.POSITIVE_INFINITY,
  };
}

/**
 * True when both declared bounds parse as instants. Store-validated rows
 * always pass (OperationalIntervalSchema pins datetime bounds); this guards
 * DIRECT callers of this pure unit: an uninterpretable declared bound makes
 * every overlap comparison silently false, which would let a garbage closure
 * certify "stable". Such intervals are routed to disruption evidence instead
 * (fail-safe toward "unstable", never toward fabricated stability).
 */
function hasParseableBounds(interval: OperationalInterval): boolean {
  if (Number.isNaN(Date.parse(interval.start))) return false;
  return interval.end === undefined || !Number.isNaN(Date.parse(interval.end));
}

function overlapsWindow(interval: OperationalInterval, wsMs: number, weMs: number): boolean {
  const { startMs, endMs } = intervalBoundsMs(interval);
  // Both sides are half-open: intervals are [start, end) (the 4b day-boundary
  // conversion) and the window is [windowStartedAt, windowEndedAt) (the
  // engine's Meta window queries are endExclusive at postEnd, so the instant
  // windowEndedAt is never measured). Therefore an interval starting exactly
  // at windowEnd does not overlap, and one ending exactly at windowStart
  // does not either.
  return startMs < weMs && endMs > wsMs;
}

function coversWindow(interval: OperationalInterval, wsMs: number, weMs: number): boolean {
  const { startMs, endMs } = intervalBoundsMs(interval);
  // Covers every MEASURED instant of the half-open window: an interval
  // ending exactly at windowEnd still covers through the last measured
  // instant, so end >= windowEnd suffices (not strictly greater).
  return startMs <= wsMs && endMs >= weMs;
}

/**
 * Stable serialization of the WINDOW-OVERLAPPING subset of a declared
 * interval list. Used to detect mid-window declaration changes while
 * ignoring out-of-window intervals (announcing a future promo mid-window is
 * not a regime change inside this window) and tolerating identical
 * re-confirms (the 4b "everything still accurate" flow).
 */
function overlappingSubsetKey(
  intervals: OperationalInterval[],
  wsMs: number,
  weMs: number,
): string {
  return intervals
    .filter((interval) => overlapsWindow(interval, wsMs, weMs))
    .map((interval) => `${interval.start}|${interval.end ?? "open"}`)
    .sort()
    .join(",");
}

/**
 * Interval-geometry disruption rules, shared verbatim by the
 * governing/in-window walk and the slice-4e late pass so the two can never
 * drift:
 * - a closure interval overlapping the window disrupts (the closure
 *   carve-out has no covers-exemption: a closed business transacts nothing,
 *   so constancy does not rescue it);
 * - a promo interval overlapping but NOT covering the window disrupts
 *   (partial overlap breaks pre/post comparability), while a promo covering
 *   the ENTIRE window is constant background that differences out;
 * - an interval with unparseable bounds disrupts (fail-safe toward
 *   "unstable", never toward fabricated stability; see hasParseableBounds).
 */
function declaredIntervalsDisrupt(state: OperationalState, wsMs: number, weMs: number): boolean {
  for (const closure of state.closures ?? []) {
    if (!hasParseableBounds(closure) || overlapsWindow(closure, wsMs, weMs)) return true;
  }
  for (const promo of state.promoWindows ?? []) {
    if (
      !hasParseableBounds(promo) ||
      (overlapsWindow(promo, wsMs, weMs) && !coversWindow(promo, wsMs, weMs))
    ) {
      return true;
    }
  }
  return false;
}

export function deriveBusinessContextStability(
  input: DeriveBusinessContextStabilityInput,
): BusinessContextStability {
  const { confirmations, windowStartedAt, windowEndedAt } = input;
  if (confirmations.length === 0) return "unknown";

  const wsMs = windowStartedAt.getTime();
  const weMs = windowEndedAt.getTime();

  // Sort defensively by the 4a tie-break triple (confirmedAt, createdAt, id)
  // instead of trusting caller order: governing-row selection and the
  // transition walk below are order-sensitive, and this is a pure exported
  // unit whose correctness must not depend on the store contract having been
  // honored upstream. Contract-shaped input is already sorted, so this is a
  // no-op there (pinned by the order-independence test).
  const sorted = [...confirmations].sort(
    (a, b) =>
      a.confirmedAt.getTime() - b.confirmedAt.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  // Partition by confirmedAt, not array position: the governing row may be
  // absent entirely (org first confirmed mid-window). Bucketing follows the
  // STORE contract (governing at-or-before windowStart; in-window rows in
  // (windowStart, windowEnd]), which governs which ROWS are candidates;
  // interval geometry against the measured half-open span lives in the
  // helpers above.
  const atOrBefore = sorted.filter((c) => c.confirmedAt.getTime() <= wsMs);
  const governing = atOrBefore.at(-1) ?? null;
  const inWindow = sorted.filter((c) => {
    const t = c.confirmedAt.getTime();
    return t > wsMs && t <= weMs;
  });
  // Slice 4e: rows recorded after the window closed, STRICTLY after
  // windowEndedAt (a row AT windowEndedAt is an in-window row, the shipped
  // 4c bucketing; the buckets partition with no gap and no double-count).
  // Processed by the late pass below only: never walked, never governing.
  const late = sorted.filter((c) => c.confirmedAt.getTime() > weMs);
  const ordered = [...(governing ? [governing] : []), ...inWindow];

  let disrupted = false;

  for (const c of ordered) {
    // 1. Closure carve-out, scalar leg. Every row in the walked set has
    //    derived validity overlapping the window (governing row or in-window
    //    row), so any temporarily_closed declaration was in force over part
    //    of it.
    if (c.state.operatingStatus === "temporarily_closed") disrupted = true;
    // 2. Declared-interval geometry (closure overlap always disrupts; a
    //    promo disrupts unless it covers the ENTIRE window), shared verbatim
    //    with the slice-4e late pass below so the two can never drift.
    if (declaredIntervalsDisrupt(c.state, wsMs, weMs)) disrupted = true;
  }

  // 3. Mid-window regime changes. Walk declarations in order; a dimension
  //    declared with a DIFFERENT value than its previous declaration flipped
  //    mid-window (re-confirming the same value is NOT a change). A
  //    disrupted scalar first declared by an in-window row with no prior
  //    declaration is disruption evidence whose onset is unknowable.
  const lastScalar: Partial<Record<ScalarDimension, string>> = {};
  const lastIntervalKey: Partial<Record<IntervalDimension, string>> = {};
  for (const c of ordered) {
    const isInWindowRow = c.confirmedAt.getTime() > wsMs;
    for (const dim of SCALAR_DIMENSIONS) {
      const value = c.state[dim];
      if (value === undefined) continue;
      const prior = lastScalar[dim];
      if (isInWindowRow) {
        if (prior !== undefined && prior !== value) disrupted = true;
        if (prior === undefined && DISRUPTED_SCALAR_VALUES.has(value)) disrupted = true;
      }
      lastScalar[dim] = value;
    }
    for (const dim of INTERVAL_DIMENSIONS) {
      const list = c.state[dim];
      if (list === undefined) continue;
      const key = overlappingSubsetKey(list, wsMs, weMs);
      const prior = lastIntervalKey[dim];
      if (isInWindowRow && prior !== undefined && prior !== key) disrupted = true;
      lastIntervalKey[dim] = key;
    }
  }

  // 4. Late-interval retroactive evidence (slice 4e). A confirmation
  //    recorded AFTER windowEnd has zero validity overlap with the window,
  //    but its promoWindows/closures are operator-DATED facts whose spans
  //    may reach back into the measured window ("promo ran June 1-7",
  //    confirmed June 16; attribution runs >= 24h after windowEnd, so late
  //    rows exist for every live candidate). Admission is geometry-only and
  //    disruption-only: scalars are never read (they describe the regime
  //    from confirmedAt forward, and backward reach from an undated scalar
  //    is the forbidden retroactive transition inference); the
  //    declaration-change detector never runs here (a late declaration
  //    change happened after the window, not inside it); certification
  //    below reads only the governing row. Late evidence can therefore flip
  //    unknown -> unstable and stable -> unstable, never the reverse.
  for (const c of late) {
    if (declaredIntervalsDisrupt(c.state, wsMs, weMs)) disrupted = true;
  }

  if (disrupted) return "unstable";

  // 5. Affirmative certification: the window must have OPENED under fresh,
  //    complete, confirmed knowledge. No governing row (the window's start
  //    is uncovered), a stale governing row, or unconfirmed dimensions leave
  //    the verdict "unknown": honest absence, never fabricated stability.
  if (!governing) return "unknown";
  if (wsMs - governing.confirmedAt.getTime() > OPERATIONAL_STATE_VOUCH_MS) return "unknown";
  const state: OperationalState = governing.state;
  const allDimensionsConfirmed =
    state.operatingStatus !== undefined &&
    state.staffing !== undefined &&
    state.inventory !== undefined &&
    state.promoWindows !== undefined &&
    state.closures !== undefined;
  if (!allDimensionsConfirmed) return "unknown";

  return "stable";
}
