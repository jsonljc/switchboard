import {
  CreativePastPerformanceSchema,
  CreativePerformanceHistorySchema,
  type CreativeJob,
  type CreativePastPerformance,
  type CreativePerformanceHistory,
} from "@switchboard/schemas";
import { extractCreativeDescriptor } from "@switchboard/creative-pipeline";

/**
 * Aggregate a deployment's measured attribution rows (the slice-2 sweep's
 * output) into the typed history a NEW brief carries (spec 3.8). Parse-don't-
 * cast: unparseable rows, performance_history rows, and no_delivery rows
 * contribute nothing. Returns null when no measured row exists; the caller
 * then leaves pastPerformance null (no fabricated history).
 */
export function buildPerformanceHistory(
  deploymentJobs: CreativeJob[],
  now: Date,
): CreativePerformanceHistory | null {
  const measured: Array<{ job: CreativeJob; perf: CreativePastPerformance }> = [];
  for (const job of deploymentJobs) {
    const parsed = CreativePastPerformanceSchema.safeParse(job.pastPerformance);
    if (parsed.success && parsed.data.delivery === "measured") {
      measured.push({ job, perf: parsed.data });
    }
  }
  if (measured.length === 0) return null;

  // trueRoas desc, nulls last (a measured row with no booked leg ranks below
  // every attributed winner, never above).
  measured.sort(
    (a, b) =>
      (b.perf.trueRoas ?? Number.NEGATIVE_INFINITY) - (a.perf.trueRoas ?? Number.NEGATIVE_INFINITY),
  );

  const topPerformers = measured.slice(0, 3).map(({ job, perf }) => {
    const d = extractCreativeDescriptor(job.stageOutputs, job.mode === "ugc" ? "ugc" : "polished");
    return {
      jobId: job.id,
      descriptor: `${d.mode}:${d.hookType}`,
      trueRoas: perf.trueRoas,
      spend: perf.meta.spend,
      bookedValueCents: perf.booked.valueCents,
      window: { from: perf.window.from, to: perf.window.to },
    };
  });

  // Self-check parse: an authoring bug here must throw, never persist junk.
  return CreativePerformanceHistorySchema.parse({
    kind: "performance_history",
    version: 1,
    generatedAt: now.toISOString(),
    topPerformers,
    summary: `${measured.length} measured creative(s) on this deployment; top by trueROAS listed.`,
  });
}
