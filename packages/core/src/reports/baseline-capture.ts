import type { ReportInsightsProvider } from "@switchboard/schemas";
import type { BaselineStore, BaselineRow } from "./interfaces.js";

function monthBuckets(now: Date): Array<{ start: Date; end: Date }> {
  const buckets: Array<{ start: Date; end: Date }> = [];
  for (let i = 3; i >= 1; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    buckets.push({ start, end });
  }
  return buckets;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function captureAdsBaseline(
  orgId: string,
  insightsProvider: ReportInsightsProvider,
  baselineStore: BaselineStore,
  now: Date = new Date(),
): Promise<void> {
  const buckets = monthBuckets(now);
  const capturedAt = now;
  const rows: BaselineRow[] = [];

  for (const bucket of buckets) {
    const metrics = await insightsProvider.getAggregateMetrics({
      since: formatDate(bucket.start),
      until: formatDate(bucket.end),
    });

    for (const [metric, value] of [
      ["spend", metrics.spend],
      ["impressions", metrics.impressions],
      ["inlineLinkClicks", metrics.inlineLinkClicks],
    ] as const) {
      rows.push({
        organizationId: orgId,
        dimension: "ads",
        metric,
        value,
        periodStart: bucket.start,
        periodEnd: bucket.end,
        capturedAt,
      });
    }
  }

  await baselineStore.insertMany(rows);
}
