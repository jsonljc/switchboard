import type { TimeRange, ComparisonPeriods } from "../types.js";

// ---------------------------------------------------------------------------
// Time period utilities
// ---------------------------------------------------------------------------

/**
 * Given a reference date and period length in days, returns current and
 * previous comparison periods.
 *
 * Example: referenceDate = 2024-01-14, periodDays = 7
 *   current:  2024-01-08 to 2024-01-14
 *   previous: 2024-01-01 to 2024-01-07
 */
export function buildComparisonPeriods(
  referenceDate: Date,
  periodDays: number
): ComparisonPeriods {
  const currentEnd = new Date(referenceDate);
  const currentStart = new Date(referenceDate);
  currentStart.setDate(currentStart.getDate() - periodDays + 1);

  const previousEnd = new Date(currentStart);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - periodDays + 1);

  return {
    current: {
      since: formatDate(currentStart),
      until: formatDate(currentEnd),
    },
    previous: {
      since: formatDate(previousStart),
      until: formatDate(previousEnd),
    },
  };
}

/**
 * Build multiple trailing periods for historical baseline calculation.
 * Returns periods from most recent to oldest.
 */
export function buildTrailingPeriods(
  referenceDate: Date,
  periodDays: number,
  count: number
): TimeRange[] {
  const periods: TimeRange[] = [];
  let end = new Date(referenceDate);

  for (let i = 0; i < count; i++) {
    const start = new Date(end);
    start.setDate(start.getDate() - periodDays + 1);

    periods.push({
      since: formatDate(start),
      until: formatDate(end),
    });

    end = new Date(start);
    end.setDate(end.getDate() - 1);
  }

  return periods;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
