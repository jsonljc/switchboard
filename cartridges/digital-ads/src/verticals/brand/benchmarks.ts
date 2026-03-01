import type { VerticalBenchmarks } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Brand Default Benchmarks
// ---------------------------------------------------------------------------
// Fallback thresholds for brand awareness campaigns.
// Brand metrics have higher natural variance than commerce because they
// depend heavily on content quality, audience overlap, and campaign
// duration/frequency caps.
// ---------------------------------------------------------------------------

export const brandBenchmarks: VerticalBenchmarks = {
  vertical: "brand",
  benchmarks: {
    impressions: {
      expectedDropoffRate: 1,
      // Brand campaigns can have high delivery variance
      normalVariancePercent: 25,
    },
    reach: {
      // Reach is typically 40-70% of impressions depending on frequency
      expectedDropoffRate: 0.5,
      normalVariancePercent: 20,
    },
    video_thruplay_actions: {
      // ThruPlay rate: 15-40% of impressions depending on content quality
      expectedDropoffRate: 0.25,
      normalVariancePercent: 20,
    },
    video_views: {
      // Google video view rate: 20-40% of impressions
      expectedDropoffRate: 0.3,
      normalVariancePercent: 18,
    },
    video_views_p50: {
      // TikTok 50% completion rate varies widely
      expectedDropoffRate: 0.2,
      normalVariancePercent: 22,
    },
    estimated_ad_recall_lift: {
      // Ad recall lift: typically 5-15% of reach
      expectedDropoffRate: 0.1,
      normalVariancePercent: 30,
    },
    clicks: {
      // Engagement clicks: 0.5-2% of impressions for brand campaigns
      expectedDropoffRate: 0.01,
      normalVariancePercent: 25,
    },
  },
};
