import type { VerticalBenchmarks } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Commerce Default Benchmarks
// ---------------------------------------------------------------------------
// These are used as fallback thresholds for accounts with < 4 weeks of data.
// They represent "typical" e-commerce funnel behavior across a broad range
// of DTC/retail advertisers. Once an account has enough history, the
// threshold engine switches to account-specific variance.
// ---------------------------------------------------------------------------

export const commerceBenchmarks: VerticalBenchmarks = {
  vertical: "commerce",
  benchmarks: {
    impressions: {
      // Impression volume can swing ~20% week-to-week from auction dynamics
      expectedDropoffRate: 1, // top of funnel — no stage above
      normalVariancePercent: 20,
    },
    inline_link_clicks: {
      // ~1-3% of impressions become link clicks
      expectedDropoffRate: 0.02,
      normalVariancePercent: 15,
    },
    landing_page_view: {
      // ~70-90% of clicks result in a landing page view loading
      expectedDropoffRate: 0.8,
      normalVariancePercent: 10,
    },
    view_content: {
      // ~60-80% of LPVs trigger a view_content event
      expectedDropoffRate: 0.7,
      normalVariancePercent: 12,
    },
    add_to_cart: {
      // ~5-15% of view_content become add_to_cart
      expectedDropoffRate: 0.08,
      normalVariancePercent: 18,
    },
    purchase: {
      // ~20-50% of ATC become purchases
      expectedDropoffRate: 0.35,
      normalVariancePercent: 20,
    },
  },
};
