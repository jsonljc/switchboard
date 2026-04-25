import type { MetricTrendSchema, SaturationSignalSchema } from "@switchboard/schemas";

const MIN_FREQUENCY_WEEKS = 2;
const MIN_DECAY_WEEKS = 4;
const DECAY_THRESHOLD = 0.3;

export function detectSaturation(
  adSetId: string,
  trends: MetricTrendSchema[],
  audienceReachedRatio: number | null,
  weeklyConversionRates: number[] | null,
): SaturationSignalSchema[] {
  const results: SaturationSignalSchema[] = [];

  // Signal 1 — Audience saturation
  const frequencyTrend = trends.find((t) => t.metric === "frequency");
  const ctrTrend = trends.find((t) => t.metric === "ctr");

  if (
    frequencyTrend &&
    frequencyTrend.direction === "rising" &&
    frequencyTrend.consecutiveWeeks >= MIN_FREQUENCY_WEEKS &&
    ctrTrend &&
    ctrTrend.direction === "falling"
  ) {
    const signals: string[] = [
      `frequency rising ${frequencyTrend.consecutiveWeeks} consecutive weeks`,
      `ctr falling ${ctrTrend.consecutiveWeeks} consecutive weeks`,
    ];
    if (audienceReachedRatio !== null) {
      signals.push(`audience_reached_ratio: ${audienceReachedRatio}`);
    }

    results.push({
      adSetId,
      pattern: "audience_saturation",
      confidence: "high",
      signals,
      audienceReachedRatio: audienceReachedRatio ?? null,
      conversionRateDecline: null,
    });
  }

  // Signal 2 — Campaign decay
  if (weeklyConversionRates && weeklyConversionRates.length >= MIN_DECAY_WEEKS + 1) {
    const first = weeklyConversionRates[0]!;
    const current = weeklyConversionRates[weeklyConversionRates.length - 1]!;

    if (first > 0) {
      const decline = (first - current) / first;
      if (decline >= DECAY_THRESHOLD) {
        results.push({
          adSetId,
          pattern: "campaign_decay",
          confidence: "medium",
          signals: [
            `conversion rate declined ${(decline * 100).toFixed(1)}% over ${weeklyConversionRates.length} weeks`,
          ],
          audienceReachedRatio: null,
          conversionRateDecline: decline,
        });
      }
    }
  }

  return results;
}
