import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  EconomicTierSchema as EconomicTier,
  MarginBasisSchema as MarginBasis,
  RecommendationOutputSchema as RecommendationOutput,
  UrgencySchema as Urgency,
  WatchOutputSchema as WatchOutput,
} from "@switchboard/schemas";

// ── Tunable thresholds (spec §5; defaults, not magic constants buried in logic) ──
export const MIN_BOOKED_FOR_TIER1 = 10;
export const MIN_LEADS_FOR_TIER2 = 30;
export const TIER2_CONFIDENCE_PENALTY = 0.15;

// Tier 3 (cpc) forbids every destructive or spend-influencing action — only
// delivery-hygiene survives as a recommendation; everything else becomes a watch.
const TIER3_ALLOWED_ACTIONS = new Set<AdRecommendationAction>(["fix_signal_health"]);

const URGENCY_ORDER: Urgency[] = ["immediate", "this_week", "next_cycle"];

function lowerUrgencyOneBand(u: Urgency): Urgency {
  const i = URGENCY_ORDER.indexOf(u);
  // Math.min clamps to a valid index, so the lookup is always defined at runtime;
  // the `?? u` only satisfies noUncheckedIndexedAccess.
  return URGENCY_ORDER[Math.min(i + 1, URGENCY_ORDER.length - 1)] ?? u;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Operator-facing one-liner naming the economic basis (spec §3.5). No "$" so it
// never perturbs the recommendation-sink dollars-at-risk scrape.
function basisNote(tier: EconomicTier, marginBasis: MarginBasis): string {
  if (tier === "booked_cac") {
    return marginBasis === "configured"
      ? "Judged on booked-CAC basis (margin-aware)."
      : "Judged on booked-CAC basis.";
  }
  if (tier === "cpl") {
    return "Booking data is thin, so this is judged on a CPL proxy with reduced confidence.";
  }
  return "Signal too thin to act; delivery-hygiene only.";
}

export interface TierSelectionInput {
  bookings: number;
  leads: number;
  hasBookedTarget: boolean;
  minBooked?: number;
  minLeads?: number;
}

/**
 * Pick the economic tier for this audit window from account-level volume.
 * Tier 1 (booked_cac) requires BOTH a configured cost-per-booked target AND
 * enough realized bookings; otherwise CPL if leads are sufficient, else CPC.
 */
export function selectEconomicTier(input: TierSelectionInput): EconomicTier {
  const minBooked = input.minBooked ?? MIN_BOOKED_FOR_TIER1;
  const minLeads = input.minLeads ?? MIN_LEADS_FOR_TIER2;
  if (input.hasBookedTarget && input.bookings >= minBooked) return "booked_cac";
  if (input.leads >= minLeads) return "cpl";
  return "cpc";
}

export interface CalibrationInput {
  targetCostPerBooked: number; // dollars per booked customer
  accountBookings: number;
  accountConversions: number; // Meta-reported conversions (the engine's CPL denominator)
}

/**
 * Convert a cost-per-booked target into the equivalent per-conversion (CPL)
 * target using the account's realized bookings-per-conversion rate, so it is
 * directly comparable to the engine's CPL = spend / Meta-conversions. Returns
 * null when the rate is undefined (no conversions) — callers must fall back,
 * never divide by zero.
 */
export function calibrateTargetFromBooking(input: CalibrationInput): number | null {
  if (input.accountConversions <= 0) return null;
  const bookingsPerConversion = input.accountBookings / input.accountConversions;
  return round2(input.targetCostPerBooked * bookingsPerConversion);
}

export interface ApplyTierInput {
  recommendation: RecommendationOutput;
  tier: EconomicTier;
  marginBasis: MarginBasis;
  confidencePenalty?: number;
  checkBackDate?: string;
}

export interface TieredResult {
  recommendation?: RecommendationOutput;
  watch?: WatchOutput;
}

/**
 * Post-process a single recommendation for its economic tier (spec §5). The
 * tier gates the allowed action *family*, not just confidence:
 *  - Tier 1 (booked_cac): full strength; stamp tier + marginBasis.
 *  - Tier 2 (cpl): confidence − penalty (floored at 0), urgency one band lower.
 *  - Tier 3 (cpc): any non-hygiene action is withheld and downgraded to a watch.
 * Every surviving recommendation also gets a plain-language basis clause appended
 * to its rationale (spec §3.5) so the operator sees the basis, not just the field.
 */
export function applyTier(input: ApplyTierInput): TieredResult {
  const { recommendation: rec, tier, marginBasis } = input;
  const penalty = input.confidencePenalty ?? TIER2_CONFIDENCE_PENALTY;

  if (tier === "cpc" && !TIER3_ALLOWED_ACTIONS.has(rec.action)) {
    return {
      watch: {
        type: "watch",
        campaignId: rec.campaignId,
        campaignName: rec.campaignName,
        pattern: `economic-tier-cpc-withheld`,
        message: `Withheld "${rec.action}": downstream booking/lead signal too thin to act (tier cpc). ${rec.estimatedImpact}`,
        checkBackDate: input.checkBackDate ?? "",
      },
    };
  }

  let confidence = rec.confidence;
  let urgency = rec.urgency;
  if (tier === "cpl") {
    confidence = Math.max(0, round2(rec.confidence - penalty));
    urgency = lowerUrgencyOneBand(rec.urgency);
  }

  return {
    recommendation: {
      ...rec,
      confidence,
      urgency,
      economicTier: tier,
      marginBasis,
      estimatedImpact: `${rec.estimatedImpact}. ${basisNote(tier, marginBasis)}`,
    },
  };
}

export interface ResolveEconomicTargetInput {
  targetCostPerBooked?: number;
  targetCPA: number;
  accountBookings: number;
  accountConversions: number;
}

export interface ResolvedEconomicTarget {
  economicTier: EconomicTier;
  effectiveTarget: number;
}

/**
 * Resolve the account-level economic tier and the target the engine judges
 * against, ONCE per audit. INVARIANT: calibrate FIRST, then derive the tier from
 * calibration success — so a "booked_cac" tier always carries the calibrated
 * target, never the legacy targetCPA.
 */
export function resolveEconomicTarget(input: ResolveEconomicTargetInput): ResolvedEconomicTarget {
  const configuredCpb =
    typeof input.targetCostPerBooked === "number" && input.targetCostPerBooked > 0
      ? input.targetCostPerBooked
      : null;
  const calibratedTarget =
    configuredCpb !== null
      ? calibrateTargetFromBooking({
          targetCostPerBooked: configuredCpb,
          accountBookings: input.accountBookings,
          accountConversions: input.accountConversions,
        })
      : null;
  const bookedCacAvailable = calibratedTarget !== null && calibratedTarget > 0;
  const economicTier = selectEconomicTier({
    bookings: input.accountBookings,
    leads: input.accountConversions,
    hasBookedTarget: bookedCacAvailable,
  });
  const effectiveTarget = economicTier === "booked_cac" ? calibratedTarget! : input.targetCPA;
  return { economicTier, effectiveTarget };
}
