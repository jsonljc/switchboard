import type { VerticalType } from "../core/types.js";
import type { PlatformType } from "../platforms/types.js";
import type { FindingAdvisor } from "../core/analysis/funnel-walker.js";

// Shared advisors
import {
  creativeFatigueAdvisor,
  leadgenCreativeFatigueAdvisor,
  auctionCompetitionAdvisor,
  leadgenAuctionCompetitionAdvisor,
  creativeExhaustionAdvisor,
  roasEfficiencyAdvisor,
  marginalEfficiencyAdvisor,
  audienceSaturationAdvisor,
  placementEfficiencyAdvisor,
  dayOfWeekAdvisor,
  bidStrategyAdvisor,
  audienceOverlapAdvisor,
  creativeWinLossAdvisor,
  deviceBreakdownAdvisor,
  attributionAwarenessAdvisor,
} from "./shared/index.js";

// Platform-specific advisors
import { landingPageAdvisor } from "./platform/meta/index.js";
import { googleChannelAdvisor } from "./platform/google/index.js";

// Structural advisors
import {
  adsetFragmentationAdvisor,
  budgetSkewAdvisor,
  learningInstabilityAdvisor,
  budgetPacingAdvisor,
  creativeDiversityAdvisor,
} from "./structural/index.js";

// Vertical-specific advisors
import {
  productPageAdvisor,
  checkoutFrictionAdvisor,
} from "./vertical/commerce/index.js";
import {
  leadQualityAdvisor,
  formConversionAdvisor,
  qualifiedCostAdvisor,
} from "./vertical/leadgen/index.js";
import {
  reachSaturationAdvisor,
  frequencyManagementAdvisor,
  videoCompletionAdvisor,
} from "./vertical/brand/index.js";

// ---------------------------------------------------------------------------
// Advisor Registry
// ---------------------------------------------------------------------------
// Resolves the correct set of advisors based on platform + vertical.
//
// The advisor set is composed of three layers:
// 1. Shared advisors (universal — creative fatigue, auction competition)
// 2. Platform-specific advisors (e.g., Meta landing page)
// 3. Vertical-specific advisors (e.g., commerce checkout friction)
// ---------------------------------------------------------------------------

/**
 * Resolve the correct advisors for a given platform + vertical combination.
 *
 * Examples:
 * - Meta + commerce → 5 advisors (2 shared + 1 platform + 2 vertical)
 * - Google + commerce → 2 advisors (2 shared only)
 * - Meta + leadgen → 5 advisors (2 shared + 3 vertical)
 * - TikTok + commerce → 4 advisors (2 shared + 2 vertical)
 */
export function resolveAdvisors(
  platform: PlatformType,
  vertical: VerticalType
): FindingAdvisor[] {
  const advisors: FindingAdvisor[] = [];

  // 1. Shared advisors (all platforms)
  if (vertical === "leadgen") {
    advisors.push(leadgenCreativeFatigueAdvisor);
    advisors.push(leadgenAuctionCompetitionAdvisor);
  } else {
    advisors.push(creativeFatigueAdvisor);
    advisors.push(auctionCompetitionAdvisor);
  }

  // Creative exhaustion advisor (predictive, all platforms/verticals)
  advisors.push(creativeExhaustionAdvisor);

  // ROAS efficiency advisor (commerce only — leadgen doesn't have ROAS)
  if (vertical === "commerce") {
    advisors.push(roasEfficiencyAdvisor);
  }

  // Marginal efficiency advisor (all platforms/verticals)
  advisors.push(marginalEfficiencyAdvisor);

  // Audience saturation advisor (all platforms/verticals)
  advisors.push(audienceSaturationAdvisor);

  // Structural advisors (universal — account structure is platform-agnostic)
  advisors.push(adsetFragmentationAdvisor);
  advisors.push(budgetSkewAdvisor);
  advisors.push(learningInstabilityAdvisor);
  advisors.push(budgetPacingAdvisor);
  advisors.push(creativeDiversityAdvisor);

  // Context-enrichment advisors (require additional breakdowns)
  advisors.push(placementEfficiencyAdvisor);
  advisors.push(dayOfWeekAdvisor);

  // Bid strategy mismatch advisor (all platforms/verticals)
  advisors.push(bidStrategyAdvisor);

  // Audience overlap advisor (all platforms, most useful on Meta)
  advisors.push(audienceOverlapAdvisor);

  // Creative win/loss advisor (requires ad-level breakdowns)
  advisors.push(creativeWinLossAdvisor);

  // Device breakdown advisor (requires device breakdowns)
  advisors.push(deviceBreakdownAdvisor);

  // Attribution awareness advisor (pre-check for measurement changes)
  advisors.push(attributionAwarenessAdvisor);

  // 2. Platform-specific advisors
  if (platform === "meta") {
    if (vertical === "commerce") {
      // Landing page advisor requires the LPV stage (Meta-only)
      advisors.push(landingPageAdvisor);
    }
  }
  if (platform === "google") {
    // Google channel allocation advisor (Search vs Display vs Video vs PMax)
    advisors.push(googleChannelAdvisor);
  }

  // 3. Vertical-specific advisors
  if (vertical === "commerce") {
    // Product page advisor works on Meta + TikTok (both have VC→ATC stages)
    // but not on Google (which has no view_content stage)
    if (platform === "meta" || platform === "tiktok") {
      advisors.push(productPageAdvisor);
      advisors.push(checkoutFrictionAdvisor);
    }
  } else if (vertical === "leadgen") {
    // Leadgen advisors apply to all platforms that have lead + qualified_lead stages
    advisors.push(leadQualityAdvisor);
    advisors.push(formConversionAdvisor);
    advisors.push(qualifiedCostAdvisor);
  } else if (vertical === "brand") {
    // Brand-specific advisors for reach, frequency, and video completion
    advisors.push(reachSaturationAdvisor);
    advisors.push(frequencyManagementAdvisor);
    advisors.push(videoCompletionAdvisor);
  }

  return advisors;
}
