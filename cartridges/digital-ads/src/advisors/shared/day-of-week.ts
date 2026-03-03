import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Day-of-Week Advisor
// ---------------------------------------------------------------------------
// WoW comparison masks intra-week patterns. B2B leadgen drops on weekends;
// e-commerce spikes on Sundays. If an anomaly only affects weekday
// performance, the engine averages it into the weekly number.
//
// This advisor identifies which days drove the WoW change and flags
// weekend/weekday skew for day-parting optimization.
//
// Data: DailyBreakdown[] from DiagnosticContext (current + previous periods).
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const dayOfWeekAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  _current: MetricSnapshot,
  _previous: MetricSnapshot,
  context?: DiagnosticContext,
): Finding[] => {
  if (
    !context?.dailyBreakdowns ||
    !context?.previousDailyBreakdowns ||
    context.dailyBreakdowns.length === 0 ||
    context.previousDailyBreakdowns.length === 0
  ) {
    return [];
  }

  const findings: Finding[] = [];
  const current = context.dailyBreakdowns;
  const previous = context.previousDailyBreakdowns;

  // 1. Identify which days contributed most to the WoW spend change
  const currentTotal = current.reduce((sum, d) => sum + d.spend, 0);
  const previousTotal = previous.reduce((sum, d) => sum + d.spend, 0);
  const spendDelta = currentTotal - previousTotal;

  if (previousTotal === 0 || Math.abs(spendDelta) < previousTotal * 0.05) {
    return findings; // negligible change, nothing to analyze
  }

  // Group by day of week
  const currentByDay = groupByDayOfWeek(current);
  const previousByDay = groupByDayOfWeek(previous);

  // Find which days drove the change
  const dayContributions: Array<{
    day: number;
    name: string;
    currentSpend: number;
    previousSpend: number;
    delta: number;
    share: number;
  }> = [];

  for (let d = 0; d < 7; d++) {
    const cs = currentByDay[d]?.spend ?? 0;
    const ps = previousByDay[d]?.spend ?? 0;
    const delta = cs - ps;
    const share = spendDelta !== 0 ? delta / spendDelta : 0;

    dayContributions.push({
      day: d,
      name: DAY_NAMES[d]!,
      currentSpend: cs,
      previousSpend: ps,
      delta,
      share,
    });
  }

  // Sort by absolute contribution
  dayContributions.sort((a, b) => Math.abs(b.share) - Math.abs(a.share));

  // If a single day accounts for >50% of the change, flag it
  const topContributor = dayContributions[0]!;
  if (Math.abs(topContributor.share) > 0.5 && Math.abs(topContributor.delta) > 10) {
    findings.push({
      severity: "info",
      stage: "day_of_week",
      message: `${topContributor.name} drove ${(Math.abs(topContributor.share) * 100).toFixed(0)}% of the WoW spend change ($${topContributor.previousSpend.toFixed(2)} → $${topContributor.currentSpend.toFixed(2)}).`,
      recommendation:
        "Investigate what happened on this specific day — was there a budget change, an ad approval delay, or a platform outage? If this is a recurring pattern, consider day-parting adjustments.",
    });
  }

  // 2. Weekend vs weekday efficiency analysis
  const weekdaySpend = [1, 2, 3, 4, 5].reduce((sum, d) => sum + (currentByDay[d]?.spend ?? 0), 0);
  const weekendSpend = [0, 6].reduce((sum, d) => sum + (currentByDay[d]?.spend ?? 0), 0);
  const weekdayConversions = [1, 2, 3, 4, 5].reduce(
    (sum, d) => sum + (currentByDay[d]?.conversions ?? 0),
    0,
  );
  const weekendConversions = [0, 6].reduce(
    (sum, d) => sum + (currentByDay[d]?.conversions ?? 0),
    0,
  );

  if (weekdaySpend > 0 && weekendSpend > 0 && weekdayConversions > 0 && weekendConversions > 0) {
    const weekdayCPA = weekdaySpend / weekdayConversions;
    const weekendCPA = weekendSpend / weekendConversions;

    if (weekendCPA > weekdayCPA * 2 && weekendSpend > currentTotal * 0.15) {
      findings.push({
        severity: "warning",
        stage: "day_of_week",
        message: `Weekend CPA ($${weekendCPA.toFixed(2)}) is ${(weekendCPA / weekdayCPA).toFixed(1)}x weekday CPA ($${weekdayCPA.toFixed(2)}). Weekend spend is ${((weekendSpend / currentTotal) * 100).toFixed(0)}% of total.`,
        recommendation:
          "Consider reducing weekend budgets or implementing day-parting. For B2B campaigns, weekends typically underperform. For e-commerce, verify that weekend traffic converts at a different rate or value.",
      });
    } else if (weekdayCPA > weekendCPA * 2 && weekdaySpend > currentTotal * 0.5) {
      findings.push({
        severity: "warning",
        stage: "day_of_week",
        message: `Weekday CPA ($${weekdayCPA.toFixed(2)}) is ${(weekdayCPA / weekendCPA).toFixed(1)}x weekend CPA ($${weekendCPA.toFixed(2)}).`,
        recommendation:
          "Consider shifting more budget to weekends where CPA is more efficient. If weekday traffic has different intent (e.g., research vs. purchase), optimize creative accordingly.",
      });
    }
  }

  // 3. Zero-conversion days
  const zeroConversionDays = current.filter((d) => d.spend > 0 && d.conversions === 0);
  if (zeroConversionDays.length >= 2 && current.length >= 5) {
    const dayNames = zeroConversionDays.map((d) => DAY_NAMES[d.dayOfWeek]).join(", ");
    const totalWasted = zeroConversionDays.reduce((sum, d) => sum + d.spend, 0);

    findings.push({
      severity: "info",
      stage: "day_of_week",
      message: `${zeroConversionDays.length} days had spend but zero conversions: ${dayNames} ($${totalWasted.toFixed(2)} total).`,
      recommendation:
        "If certain days consistently produce zero conversions, consider day-parting to pause delivery on those days and concentrate budget on higher-performing days.",
    });
  }

  return findings;
};

function groupByDayOfWeek(
  daily: Array<{ dayOfWeek: number; spend: number; conversions: number }>,
): Record<number, { spend: number; conversions: number }> {
  const result: Record<number, { spend: number; conversions: number }> = {};

  for (const d of daily) {
    if (!result[d.dayOfWeek]) {
      result[d.dayOfWeek] = { spend: 0, conversions: 0 };
    }
    result[d.dayOfWeek]!.spend += d.spend;
    result[d.dayOfWeek]!.conversions += d.conversions;
  }

  return result;
}
