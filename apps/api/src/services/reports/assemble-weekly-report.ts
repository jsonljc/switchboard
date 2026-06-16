// apps/api/src/services/reports/assemble-weekly-report.ts
// ---------------------------------------------------------------------------
// Assemble the completed-week ReportDataV1 for the weekly owner report. Reuses
// the existing report machinery (createPeriodRollup + the report stores), so the
// digest is built from the SAME projection the dashboard /reports surface reads.
//
// `completedWeekRange` is pure and exported for unit math testing. The rollup
// call itself is exercised through the delivery-service test with an injected
// assembleReport (this module's external I/O is the Prisma-backed stores).
// ---------------------------------------------------------------------------
import type { ReportDataV1 } from "@switchboard/schemas";
import {
  createPeriodRollup,
  createPullQuoteGenerator,
  priorPeriodRange,
  type BaselineStore,
  type PeriodRange,
  type ReportCacheStore,
  type ReportStores,
} from "@switchboard/core/reports";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Monday 00:00:00.000 UTC of the ISO week containing `d`. */
function startOfWeekUTC(d: Date): Date {
  const dayStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // getUTCDay: Sun=0..Sat=6. Offset back to Monday.
  const offset = (dayStart.getUTCDay() + 6) % 7;
  return new Date(dayStart.getTime() - offset * ONE_DAY_MS);
}

/**
 * The most recent FULLY-ELAPSED Mon..Sun week before `now`, returned as an
 * inclusive-start / exclusive-end range. `end` is this week's Monday 00:00:00
 * (i.e. the start of the in-progress week), `start` is the Monday before that.
 * Always exactly 7 days. UTC throughout (the cadence is uniqueness-per-week,
 * not org-local calendar semantics).
 */
export function completedWeekRange(now: Date): { start: Date; end: Date } {
  const currentWeekStart = startOfWeekUTC(now);
  const start = new Date(currentWeekStart.getTime() - 7 * ONE_DAY_MS);
  return { start, end: currentWeekStart };
}

export interface AssembleWeeklyReportDeps {
  stores: ReportStores;
  reportCache: ReportCacheStore;
  baselineStore: BaselineStore;
}

/**
 * Build the completed-week ReportDataV1 for `orgId`. The current range is tagged
 * with the "THIS WEEK" window so the rollup labels and folio-formats it; the
 * prior range is the synthetic preceding 7-day span (priorPeriodRange's generic
 * branch). insightsProvider is null and planMonthlyUSD is 0: the owner digest
 * surfaces only the receipted-bookings / revenue / held-rate / consent sections,
 * not the ad-insights cost rollup.
 */
export async function assembleWeeklyReport(
  deps: AssembleWeeklyReportDeps,
  orgId: string,
  now: Date,
): Promise<ReportDataV1> {
  const range = completedWeekRange(now);
  const current: PeriodRange = { start: range.start, end: range.end, window: "THIS WEEK" };
  const prior = priorPeriodRange(current);

  const rollup = createPeriodRollup({
    stores: deps.stores,
    insightsProvider: null,
    reportCache: deps.reportCache,
    baselineStore: deps.baselineStore,
    planMonthlyUSD: 0,
    pullQuoteGenerator: createPullQuoteGenerator({ llm: null }),
  });

  return rollup({ orgId, current, prior, computedAt: now });
}
