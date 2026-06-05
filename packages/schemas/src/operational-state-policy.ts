/**
 * Staleness policy for operational-state CONSUMPTION (Riley v3 slice 4c;
 * spec 2026-06-03-riley-v3-control-plane sections 2.1 net-new paragraph
 * and 7.4).
 *
 * Slice 4a deliberately did not encode staleness in the data: confirmation
 * rows record who confirmed what when, and "how old a confirmation may be
 * and still vouch" is a consumption-side policy. This module is that
 * policy's single home. It lives in Layer 1 because BOTH consumers need it
 * and neither may import the other: packages/ad-optimizer (Layer 2,
 * RevenueState.businessContextFreshness) and packages/core (Layer 3,
 * RecommendationOutcome.businessContextStable).
 *
 * The two consumers ask DIFFERENT questions against the same constant:
 * - "fresh enough to act": age of the LATEST confirmation at the moment the
 *   weekly audit runs (point-in-time, ad-optimizer).
 * - "governed the window": age of the GOVERNING confirmation at the moment a
 *   PAST attribution window opened (window-anchored, core). Disruption
 *   evidence is exempt from the vouch window; evidence of disruption does
 *   not expire the way an attestation of normalcy does.
 *
 * Why 14 days: the audit cron is weekly, so 14 days means two full
 * re-confirmation opportunities were missed; it equals the longest
 * attribution half-window (refresh_creative windowDays = 14); medspa
 * operational tempo (promos 2-6 weeks, closures/staffing days-to-weeks)
 * makes an attestation older than two weeks genuinely weak; and the 4b
 * editor's one-click "Everything still accurate" re-confirm makes the
 * expectation operationally cheap to meet.
 */
export const OPERATIONAL_STATE_VOUCH_DAYS = 14;

/** Millisecond form of OPERATIONAL_STATE_VOUCH_DAYS (single source of truth). */
export const OPERATIONAL_STATE_VOUCH_MS = OPERATIONAL_STATE_VOUCH_DAYS * 24 * 60 * 60 * 1000;
