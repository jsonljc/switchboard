import { CreativePastPerformanceSchema, type CreativeJob } from "@switchboard/schemas";
import type { MiraCreativePerformance } from "./types.js";

/**
 * Parse-don't-cast: only a valid measured_performance row projects. A
 * performance_history row (disjoint `kind` literal, slice-2 PR-B), legacy
 * passthrough payloads, and malformed rows all fail safeParse and project
 * nothing.
 */
export function derivePerformance(job: CreativeJob): MiraCreativePerformance | undefined {
  const parsed = CreativePastPerformanceSchema.safeParse(job.pastPerformance);
  if (!parsed.success) return undefined;
  const p = parsed.data;
  return {
    asOf: p.asOf,
    delivery: p.delivery,
    spend: p.meta.spend,
    trueRoas: p.trueRoas,
    bookedValueCents: p.booked.valueCents,
    bookedCount: p.booked.count,
    metaConversions: p.meta.conversions,
  };
}
