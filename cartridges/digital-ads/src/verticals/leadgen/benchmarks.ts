import type { VerticalBenchmarks, StageBenchmark } from "../../core/types.js";
import { DEFAULT_QUALIFIED_LEAD_ACTION } from "../../platforms/meta/funnels/leadgen.js";

// ---------------------------------------------------------------------------
// Lead Generation Default Benchmarks
// ---------------------------------------------------------------------------
// Fallback thresholds for accounts with < 4 weeks of history.
// Leadgen benchmarks vary more than commerce because lead quality
// depends heavily on the form design, industry, and what "qualified" means.
// These represent broad defaults across B2B/B2C instant form campaigns.
// ---------------------------------------------------------------------------

/** Benchmark values for the qualified lead stage (reused across action types) */
const QUALIFIED_LEAD_BENCHMARK: StageBenchmark = {
  // Qualified rate varies enormously by industry and form design.
  // Instant forms with "more volume" optimization: 5-15% qualify
  // Instant forms with "higher intent" (review screen): 15-40% qualify
  expectedDropoffRate: 0.15,
  normalVariancePercent: 30,
};

/**
 * Create leadgen benchmarks with the correct key for the qualified lead action type.
 */
export function createLeadgenBenchmarks(
  qualifiedLeadAction: string = DEFAULT_QUALIFIED_LEAD_ACTION
): VerticalBenchmarks {
  return {
    vertical: "leadgen",
    benchmarks: {
      impressions: {
        expectedDropoffRate: 1,
        // Leadgen campaigns often have more volatile delivery
        // due to narrower audiences (especially B2B)
        normalVariancePercent: 25,
      },
      inline_link_clicks: {
        // ~1-4% of impressions become clicks (instant form CTAs
        // tend to have slightly higher CTR than website CTAs)
        expectedDropoffRate: 0.025,
        normalVariancePercent: 15,
      },
      lead: {
        // Instant form conversion rates are high — typically 10-30%
        // of clicks submit the form (low friction, pre-filled fields)
        expectedDropoffRate: 0.2,
        normalVariancePercent: 18,
      },
      [qualifiedLeadAction]: QUALIFIED_LEAD_BENCHMARK,
    },
  };
}

/** Default leadgen benchmarks (qualified lead = offsite_conversion.fb_pixel_lead) */
export const leadgenBenchmarks: VerticalBenchmarks = createLeadgenBenchmarks();
