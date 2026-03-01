// ---------------------------------------------------------------------------
// Seasonality Calendar
// ---------------------------------------------------------------------------
// Provides threshold modifiers for known seasonal events. During high-
// competition periods (BFCM, Prime Day, etc.), CPM increases are expected
// and should not trigger false alarms. The correlator and advisors can
// query this module to adjust their sensitivity.
// ---------------------------------------------------------------------------

export interface SeasonalEvent {
  /** Human-readable event name */
  name: string;
  /** Start date (MM-DD) — inclusive */
  startMMDD: string;
  /** End date (MM-DD) — inclusive */
  endMMDD: string;
  /** CPM threshold multiplier (e.g. 1.5 = allow 50% more CPM variance) */
  cpmThresholdMultiplier: number;
  /** CPA threshold multiplier */
  cpaThresholdMultiplier: number;
}

/**
 * Known seasonal events that affect ad auction costs.
 * Dates are approximate and cover the US/global e-commerce calendar.
 */
export const SEASONAL_EVENTS: SeasonalEvent[] = [
  {
    name: "Valentine's Day",
    startMMDD: "02-07",
    endMMDD: "02-14",
    cpmThresholdMultiplier: 1.2,
    cpaThresholdMultiplier: 1.15,
  },
  {
    name: "Easter / Spring Sale",
    startMMDD: "03-20",
    endMMDD: "04-05",
    cpmThresholdMultiplier: 1.15,
    cpaThresholdMultiplier: 1.1,
  },
  {
    name: "Mother's Day",
    startMMDD: "05-01",
    endMMDD: "05-12",
    cpmThresholdMultiplier: 1.2,
    cpaThresholdMultiplier: 1.15,
  },
  {
    name: "Prime Day",
    startMMDD: "07-10",
    endMMDD: "07-17",
    cpmThresholdMultiplier: 1.4,
    cpaThresholdMultiplier: 1.25,
  },
  {
    name: "Back to School",
    startMMDD: "08-01",
    endMMDD: "08-31",
    cpmThresholdMultiplier: 1.2,
    cpaThresholdMultiplier: 1.1,
  },
  {
    name: "Singles' Day (11.11)",
    startMMDD: "11-08",
    endMMDD: "11-12",
    cpmThresholdMultiplier: 1.3,
    cpaThresholdMultiplier: 1.2,
  },
  {
    name: "Black Friday / Cyber Monday",
    startMMDD: "11-20",
    endMMDD: "12-02",
    cpmThresholdMultiplier: 1.8,
    cpaThresholdMultiplier: 1.4,
  },
  {
    name: "Holiday Season (Dec)",
    startMMDD: "12-03",
    endMMDD: "12-26",
    cpmThresholdMultiplier: 1.5,
    cpaThresholdMultiplier: 1.3,
  },
  {
    name: "Year-End Clearance",
    startMMDD: "12-26",
    endMMDD: "12-31",
    cpmThresholdMultiplier: 1.3,
    cpaThresholdMultiplier: 1.2,
  },
];

/**
 * Check whether any seasonal event is active for a given date range.
 * Returns the event with the highest CPM multiplier if multiple overlap.
 */
export function getActiveSeasonalEvent(
  periodStart: string,
  periodEnd: string
): SeasonalEvent | null {
  const startMMDD = periodStart.slice(5); // "YYYY-MM-DD" → "MM-DD"
  const endMMDD = periodEnd.slice(5);

  let bestMatch: SeasonalEvent | null = null;

  for (const event of SEASONAL_EVENTS) {
    if (dateRangesOverlap(startMMDD, endMMDD, event.startMMDD, event.endMMDD)) {
      if (!bestMatch || event.cpmThresholdMultiplier > bestMatch.cpmThresholdMultiplier) {
        bestMatch = event;
      }
    }
  }

  return bestMatch;
}

/**
 * Get the CPM threshold multiplier for a given date range.
 * Returns 1.0 (no adjustment) when no seasonal event is active.
 */
export function getSeasonalCPMMultiplier(
  periodStart: string,
  periodEnd: string
): number {
  const event = getActiveSeasonalEvent(periodStart, periodEnd);
  return event?.cpmThresholdMultiplier ?? 1.0;
}

/**
 * Check if two MM-DD date ranges overlap.
 * Handles year-boundary wrapping (e.g., 12-26 to 01-05).
 */
function dateRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  // Convert MM-DD to day-of-year number for comparison
  const a1 = mmddToDay(aStart);
  const a2 = mmddToDay(aEnd);
  const b1 = mmddToDay(bStart);
  const b2 = mmddToDay(bEnd);

  // Simple non-wrapping overlap check
  if (a1 <= a2 && b1 <= b2) {
    return a1 <= b2 && b1 <= a2;
  }

  // If either range wraps around year boundary, use conservative overlap
  // (this handles Dec→Jan transitions)
  return true;
}

function mmddToDay(mmdd: string): number {
  const [mm, dd] = mmdd.split("-").map(Number);
  const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let day = 0;
  for (let i = 1; i < mm!; i++) {
    day += daysInMonth[i]!;
  }
  return day + dd!;
}
