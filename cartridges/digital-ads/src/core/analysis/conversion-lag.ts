import type {
  DailyBreakdown,
} from "../types.js";

// ---------------------------------------------------------------------------
// Conversion Lag Adjustment
// ---------------------------------------------------------------------------
// Discounts recent days' conversion counts to account for delayed
// attribution. Most conversion events (especially purchase, lead
// qualification) have a lag between the click/impression and the
// actual conversion being reported.
//
// Typical lag patterns:
// - Day 0 (today): only 30-50% of conversions reported
// - Day 1 (yesterday): ~70-80% reported
// - Day 2: ~85-90% reported
// - Day 3+: ~95%+ reported
//
// This module provides utilities to:
// 1. Estimate the "maturity" of a period's conversion data
// 2. Flag when comparing a period with immature data against
//    a fully matured period
// 3. Apply discount factors to recent days
// ---------------------------------------------------------------------------

/** Default decay factors for each day's lag (0 = report date, 1 = 1 day ago, etc.) */
const DEFAULT_MATURITY_FACTORS: Record<number, number> = {
  0: 0.35, // Day of: only 35% of conversions reported
  1: 0.65, // 1 day ago: 65% reported
  2: 0.85, // 2 days ago: 85% reported
  3: 0.95, // 3 days ago: 95% reported
  // 4+ days: assumed fully mature (100%)
};

/**
 * Compute the maturity score of a period's conversion data.
 *
 * Returns a value between 0 and 1 indicating what fraction of
 * conversions are expected to have been reported.
 *
 * @param periodEnd - ISO date string for the period's last day
 * @param referenceDate - The current date (when the report is generated)
 * @param periodDays - Number of days in the period
 * @returns Maturity score (0-1, where 1 = fully mature)
 */
export function computePeriodMaturity(
  periodEnd: string,
  referenceDate: Date,
  periodDays: number
): number {
  const endDate = new Date(periodEnd);
  const daysSinceEnd = Math.floor(
    (referenceDate.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSinceEnd >= 4) {
    // Period ended 4+ days ago — fully mature
    return 1.0;
  }

  // For periods where the end date is recent, compute a weighted average
  // maturity across all days in the period
  let totalWeight = 0;
  let matureWeight = 0;

  for (let dayInPeriod = 0; dayInPeriod < periodDays; dayInPeriod++) {
    // How many days ago was this day of the period?
    const daysAgo = daysSinceEnd + (periodDays - 1 - dayInPeriod);
    const maturityFactor = DEFAULT_MATURITY_FACTORS[daysAgo] ?? 1.0;

    totalWeight += 1;
    matureWeight += maturityFactor;
  }

  return totalWeight > 0 ? matureWeight / totalWeight : 1.0;
}

/**
 * Determine if conversion lag is likely affecting the comparison.
 *
 * @param currentPeriodEnd - End date of the current period
 * @param previousPeriodEnd - End date of the previous period
 * @param referenceDate - The report generation date
 * @param periodDays - Number of days per period
 * @returns Object with maturity scores and a flag indicating if lag is a concern
 */
export function assessConversionLag(
  currentPeriodEnd: string,
  previousPeriodEnd: string,
  referenceDate: Date,
  periodDays: number
): {
  currentMaturity: number;
  previousMaturity: number;
  lagIsSignificant: boolean;
  maturityGap: number;
} {
  const currentMaturity = computePeriodMaturity(
    currentPeriodEnd,
    referenceDate,
    periodDays
  );
  const previousMaturity = computePeriodMaturity(
    previousPeriodEnd,
    referenceDate,
    periodDays
  );
  const maturityGap = previousMaturity - currentMaturity;

  return {
    currentMaturity,
    previousMaturity,
    // Flag if the maturity gap is >10% — this would cause a meaningful
    // undercount in the current period relative to the previous period
    lagIsSignificant: maturityGap > 0.1,
    maturityGap,
  };
}

/**
 * Adjust daily breakdown conversions by applying maturity factors.
 *
 * Given a set of daily breakdowns and a reference date, inflate
 * conversion counts for recent days to estimate the "mature" total.
 *
 * @param dailyBreakdowns - Daily performance data
 * @param referenceDate - The current date
 * @returns Adjusted daily breakdowns with inflated conversion counts
 */
export function adjustForConversionLag(
  dailyBreakdowns: DailyBreakdown[],
  referenceDate: Date
): DailyBreakdown[] {
  return dailyBreakdowns.map((day) => {
    const dayDate = new Date(day.date);
    const daysAgo = Math.floor(
      (referenceDate.getTime() - dayDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const maturityFactor = DEFAULT_MATURITY_FACTORS[daysAgo] ?? 1.0;

    if (maturityFactor >= 1.0) {
      return day; // Already mature, no adjustment needed
    }

    // Inflate conversions to estimate mature count
    const adjustedConversions = maturityFactor > 0
      ? Math.round(day.conversions / maturityFactor)
      : day.conversions;

    return {
      ...day,
      conversions: adjustedConversions,
    };
  });
}

/**
 * Compute the estimated conversion deficit due to attribution lag.
 *
 * Returns the estimated number of conversions that haven't been
 * attributed yet (i.e., will appear in later reporting).
 *
 * @param dailyBreakdowns - Daily performance data with actual conversions
 * @param referenceDate - The current date
 * @returns Estimated unreported conversions
 */
export function estimateConversionDeficit(
  dailyBreakdowns: DailyBreakdown[],
  referenceDate: Date
): number {
  let deficit = 0;

  for (const day of dailyBreakdowns) {
    const dayDate = new Date(day.date);
    const daysAgo = Math.floor(
      (referenceDate.getTime() - dayDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const maturityFactor = DEFAULT_MATURITY_FACTORS[daysAgo] ?? 1.0;

    if (maturityFactor < 1.0 && maturityFactor > 0) {
      const estimatedMature = day.conversions / maturityFactor;
      deficit += estimatedMature - day.conversions;
    }
  }

  return Math.round(deficit);
}
