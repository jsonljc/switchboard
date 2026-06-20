import type { HomeSummary } from "@switchboard/schemas";
import { buildWeekContext } from "./metrics-buckets.js";

export interface HomeSummarySignals {
  sumAttributedBookedValueCentsForWindow(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<number>;
  countBookedConversionsForWindow(input: { orgId: string; from: Date; to: Date }): Promise<number>;
}

export interface BuildHomeSummaryInput {
  orgId: string;
  now: Date;
  timezone: string;
  signals: HomeSummarySignals;
}

export async function buildHomeSummary(input: BuildHomeSummaryInput): Promise<HomeSummary> {
  const { orgId, now, timezone, signals } = input;
  const week = buildWeekContext(now, timezone);
  const generatedAt = now.toISOString();
  const freshness = { generatedAt, window: "week" as const, dataSource: "live" as const };

  const [valueThis, valuePrev, countThis, countPrev] = await Promise.all([
    signals.sumAttributedBookedValueCentsForWindow({
      orgId,
      from: week.weekStart,
      to: week.weekEnd,
    }),
    signals.sumAttributedBookedValueCentsForWindow({
      orgId,
      from: week.prevWeekStart,
      to: week.prevWeekEnd,
    }),
    signals.countBookedConversionsForWindow({ orgId, from: week.weekStart, to: week.weekEnd }),
    signals.countBookedConversionsForWindow({
      orgId,
      from: week.prevWeekStart,
      to: week.prevWeekEnd,
    }),
  ]);

  return {
    attributedValueCents:
      valueThis > 0
        ? {
            state: "ready",
            value: valueThis,
            ...(valuePrev > 0 ? { comparator: { window: "week" as const, value: valuePrev } } : {}),
            freshness,
          }
        : { state: "empty", reason: "no_current_week_bookings" },
    bookings:
      countThis > 0
        ? {
            state: "ready",
            value: countThis,
            ...(countPrev > 0 ? { comparator: { window: "week" as const, value: countPrev } } : {}),
            freshness,
          }
        : { state: "empty", reason: "no_current_week_bookings" },
    currency: "SGD",
    generatedAt,
  };
}
