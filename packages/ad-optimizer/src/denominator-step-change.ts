export interface AccountWindowTotals {
  clicks: number;
  conversions: number;
  spend: number;
}

export interface StepChangeResult {
  suspected: boolean;
  reason: string;
}

const DROP_RATIO = 0.5; // conversion-rate fell to <=50% of prior
const FLATNESS_BAND = 0.2; // while clicks stayed within +/-20%

/**
 * Account-level click floor below which a zero-conversion window is "too little
 * traffic to judge" (genuinely insufficient evidence), not a suspected measurement
 * outage. Matches the destructive recommendation evidence-floor click axis (50):
 * an account drawing >=50 clicks/week with ZERO attributed conversions is an
 * anomaly worth holding on, not noise.
 */
const MIN_ACCOUNT_CLICKS_FOR_ZERO_CONVERSION_SUSPICION = 50;

/**
 * Detect an account-wide conversion-DENOMINATOR break: the cost signal (conv/clicks)
 * is untrustworthy this cycle, so the runner must abstain on cost-driven actions and
 * surface a measurement signal rather than killing/scaling campaigns. Two signatures:
 *
 *  1. RATE COLLAPSE (the Jan-2026-class event): conversion rate fell >=50% while
 *     clicks/spend stayed flat — an attribution-window/action-type reporting shift,
 *     not a real performance drop.
 *  2. SUSTAINED ZERO-DESPITE-TRAFFIC (the account-wide CAPI/pixel-outage signature):
 *     ZERO attributed conversions across BOTH windows while real traffic continues.
 *     The rate-collapse math degenerates here (prevRate=0), and the prior code early-
 *     returned "trusted" on previous.conversions<=0 — so an outage that zeroed the
 *     whole account read as TRUSTED and Riley could pause/scale on a broken signal.
 *     With enough clicks in BOTH windows to rule out "too small to judge", the
 *     conversions may be real but unreported, so demote (the safe direction: the
 *     operator is told to verify pixel/CAPI rather than have campaigns acted on).
 */
export function detectDenominatorStepChange(input: {
  current: AccountWindowTotals;
  previous: AccountWindowTotals;
}): StepChangeResult {
  const { current, previous } = input;
  // No prior traffic at all → nothing to compare. The per-campaign evidence floors
  // handle a brand-new account; this account-level guard stays out of it.
  if (previous.clicks <= 0) {
    return { suspected: false, reason: "insufficient prior baseline" };
  }

  // Signature 2: both windows reported zero conversions. The rate math below can't
  // express this (prevRate=0), so decide it explicitly. Require real, current traffic
  // (both windows above the click floor) so a thin/paused account is not flagged, and
  // require the current window to still be drawing traffic (no live signal => nothing
  // to judge). A previously-zero account that has STARTED converting (current.conversions
  // > 0) is a recovery, not an outage — it falls through to the rate logic and is not
  // flagged (curRate>0, prevRate=0 ⇒ rateCollapsed false).
  if (previous.conversions <= 0) {
    // `=== 0` (not `<= 0`) is explicitly fail-closed (NaN/negative are missing/garbage, not a
    // zero-despite-traffic outage, so they must NOT flag): NaN === 0 is false, matching the
    // repo's NaN-comparison-guard convention. The click bars are also finite-checked by `>=`.
    const sustainedZeroDespiteTraffic =
      current.conversions === 0 &&
      previous.clicks >= MIN_ACCOUNT_CLICKS_FOR_ZERO_CONVERSION_SUSPICION &&
      current.clicks >= MIN_ACCOUNT_CLICKS_FOR_ZERO_CONVERSION_SUSPICION;
    if (sustainedZeroDespiteTraffic) {
      return {
        suspected: true,
        reason:
          "zero attributed conversions across both windows despite sustained real traffic — suspected account-wide conversion-tracking outage (verify pixel/CAPI)",
      };
    }
    return { suspected: false, reason: "insufficient prior baseline" };
  }

  // Signature 1: rate collapse with flat clicks.
  const prevRate = previous.conversions / previous.clicks;
  const curRate = current.clicks > 0 ? current.conversions / current.clicks : 0;
  const clicksFlat = Math.abs(current.clicks - previous.clicks) / previous.clicks <= FLATNESS_BAND;
  const rateCollapsed = curRate <= prevRate * DROP_RATIO;
  const suspected = clicksFlat && rateCollapsed;
  return {
    suspected,
    reason: suspected
      ? `conversion rate fell ${(prevRate ? (1 - curRate / prevRate) * 100 : 0).toFixed(0)}% with flat clicks — suspected denominator/window shift`
      : "no step-change",
  };
}
