// ---------------------------------------------------------------------------
// Seasonality Calendar
// ---------------------------------------------------------------------------
// Provides threshold modifiers for known seasonal events. During high-
// competition periods (BFCM, Prime Day, etc.), CPM increases are expected
// and should not trigger false alarms. The correlator and advisors can
// query this module to adjust their sensitivity.
//
// Enhanced with vertical-specific, region-aware, and configurable seasonal
// calendars for international and industry-specific planning.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Original types and data (backward compatible)
// ---------------------------------------------------------------------------

export interface SeasonalEvent {
  /** Human-readable event name */
  name: string;
  /** Start date (MM-DD) -- inclusive */
  startMMDD: string;
  /** End date (MM-DD) -- inclusive */
  endMMDD: string;
  /** CPM threshold multiplier (e.g. 1.5 = allow 50% more CPM variance) */
  cpmThresholdMultiplier: number;
  /** CPA threshold multiplier */
  cpaThresholdMultiplier: number;
}

/**
 * Known seasonal events that affect ad auction costs.
 * Dates are approximate and cover the US/global e-commerce calendar.
 */
export const SEASONAL_EVENTS: SeasonalEvent[] = [
  {
    name: "Valentine's Day",
    startMMDD: "02-07",
    endMMDD: "02-14",
    cpmThresholdMultiplier: 1.2,
    cpaThresholdMultiplier: 1.15,
  },
  {
    name: "Easter / Spring Sale",
    startMMDD: "03-20",
    endMMDD: "04-05",
    cpmThresholdMultiplier: 1.15,
    cpaThresholdMultiplier: 1.1,
  },
  {
    name: "Mother's Day",
    startMMDD: "05-01",
    endMMDD: "05-12",
    cpmThresholdMultiplier: 1.2,
    cpaThresholdMultiplier: 1.15,
  },
  {
    name: "Prime Day",
    startMMDD: "07-10",
    endMMDD: "07-17",
    cpmThresholdMultiplier: 1.4,
    cpaThresholdMultiplier: 1.25,
  },
  {
    name: "Back to School",
    startMMDD: "08-01",
    endMMDD: "08-31",
    cpmThresholdMultiplier: 1.2,
    cpaThresholdMultiplier: 1.1,
  },
  {
    name: "Singles' Day (11.11)",
    startMMDD: "11-08",
    endMMDD: "11-12",
    cpmThresholdMultiplier: 1.3,
    cpaThresholdMultiplier: 1.2,
  },
  {
    name: "Black Friday / Cyber Monday",
    startMMDD: "11-20",
    endMMDD: "12-02",
    cpmThresholdMultiplier: 1.8,
    cpaThresholdMultiplier: 1.4,
  },
  {
    name: "Holiday Season (Dec)",
    startMMDD: "12-03",
    endMMDD: "12-26",
    cpmThresholdMultiplier: 1.5,
    cpaThresholdMultiplier: 1.3,
  },
  {
    name: "Year-End Clearance",
    startMMDD: "12-26",
    endMMDD: "12-31",
    cpmThresholdMultiplier: 1.3,
    cpaThresholdMultiplier: 1.2,
  },
];

/**
 * Check whether any seasonal event is active for a given date range.
 * Returns the event with the highest CPM multiplier if multiple overlap.
 */
export function getActiveSeasonalEvent(
  periodStart: string,
  periodEnd: string,
): SeasonalEvent | null {
  const startMMDD = periodStart.slice(5); // "YYYY-MM-DD" -> "MM-DD"
  const endMMDD = periodEnd.slice(5);

  let bestMatch: SeasonalEvent | null = null;

  for (const event of SEASONAL_EVENTS) {
    if (dateRangesOverlap(startMMDD, endMMDD, event.startMMDD, event.endMMDD)) {
      if (!bestMatch || event.cpmThresholdMultiplier > bestMatch.cpmThresholdMultiplier) {
        bestMatch = event;
      }
    }
  }

  return bestMatch;
}

/**
 * Get the CPM threshold multiplier for a given date range.
 * Returns 1.0 (no adjustment) when no seasonal event is active.
 */
export function getSeasonalCPMMultiplier(periodStart: string, periodEnd: string): number {
  const event = getActiveSeasonalEvent(periodStart, periodEnd);
  return event?.cpmThresholdMultiplier ?? 1.0;
}

/**
 * Check if two MM-DD date ranges overlap.
 * Properly handles year-boundary wrapping (e.g., 12-26 to 01-05).
 */
export function dateRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  // Convert MM-DD to day-of-year number for comparison
  const a1 = mmddToDay(aStart);
  const a2 = mmddToDay(aEnd);
  const b1 = mmddToDay(bStart);
  const b2 = mmddToDay(bEnd);

  const aWraps = a1 > a2;
  const bWraps = b1 > b2;

  // Neither range wraps: simple overlap check
  if (!aWraps && !bWraps) {
    return a1 <= b2 && b1 <= a2;
  }

  // Both ranges wrap: they always overlap (both span Dec->Jan)
  if (aWraps && bWraps) {
    return true;
  }

  // Exactly one range wraps. The wrapping range covers [wStart..365] + [1..wEnd].
  // The non-wrapping range covers [nStart..nEnd].
  // They overlap if the non-wrapping range overlaps either segment of the wrapping range.
  const wStart = aWraps ? a1 : b1;
  const wEnd = aWraps ? a2 : b2;
  const nStart = aWraps ? b1 : a1;
  const nEnd = aWraps ? b2 : a2;

  // Overlap with the [wStart..365] segment
  if (nEnd >= wStart) return true;
  // Overlap with the [1..wEnd] segment
  if (nStart <= wEnd) return true;

  return false;
}

function mmddToDay(mmdd: string): number {
  const [mm, dd] = mmdd.split("-").map(Number);
  const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let day = 0;
  for (let i = 1; i < mm!; i++) {
    day += daysInMonth[i]!;
  }
  return day + dd!;
}

// ---------------------------------------------------------------------------
// Enhanced Seasonality — Vertical-specific, Region-aware
// ---------------------------------------------------------------------------

export type EventCategory = "retail" | "cultural" | "sports" | "industry" | "platform";
export type EventRegion = "global" | "us" | "uk" | "eu" | "apac" | "latam" | "mena";
export type EventVertical = "commerce" | "leadgen" | "brand" | "all";

export interface EnhancedSeasonalEvent extends SeasonalEvent {
  category: EventCategory;
  region: EventRegion;
  verticals: EventVertical[];
  /** Detailed impact description */
  impact: string;
  /** Recommended actions during this event */
  recommendedActions: string[];
}

/**
 * Comprehensive seasonal events library organized by category, region, and vertical.
 * The original SEASONAL_EVENTS array remains untouched for backward compatibility.
 */
export const ENHANCED_SEASONAL_EVENTS: EnhancedSeasonalEvent[] = [
  // ── Retail Events ─────────────────────────────────────────────────────
  {
    name: "New Year's Sales",
    startMMDD: "01-01",
    endMMDD: "01-07",
    cpmThresholdMultiplier: 1.1,
    cpaThresholdMultiplier: 1.05,
    category: "retail",
    region: "global",
    verticals: ["commerce"],
    impact:
      "Post-holiday clearance sales drive moderate competition. Consumers redeem gift cards and look for deals.",
    recommendedActions: [
      "Launch clearance campaigns with urgency messaging",
      "Target gift card holders with high-value product ads",
      "Reduce budgets on broad prospecting; focus on warm audiences",
    ],
  },
  {
    name: "Valentine's Day",
    startMMDD: "02-07",
    endMMDD: "02-14",
    cpmThresholdMultiplier: 1.2,
    cpaThresholdMultiplier: 1.15,
    category: "retail",
    region: "global",
    verticals: ["commerce"],
    impact:
      "Gift-oriented shopping surge. Jewelry, flowers, dining, and experience verticals see peak competition.",
    recommendedActions: [
      "Front-load gift-focused creatives 7-10 days before Feb 14",
      "Use countdown timers for shipping deadlines",
      "Target relationship-status and interest-based audiences",
    ],
  },
  {
    name: "President's Day Sales",
    startMMDD: "02-14",
    endMMDD: "02-20",
    cpmThresholdMultiplier: 1.15,
    cpaThresholdMultiplier: 1.1,
    category: "retail",
    region: "us",
    verticals: ["commerce"],
    impact: "Major US retail sale event, especially for furniture, appliances, and mattresses.",
    recommendedActions: [
      "Promote big-ticket item discounts",
      "Use 'limited-time sale' urgency messaging",
      "Increase budgets for home goods verticals",
    ],
  },
  {
    name: "Easter / Spring Sale",
    startMMDD: "03-20",
    endMMDD: "04-05",
    cpmThresholdMultiplier: 1.15,
    cpaThresholdMultiplier: 1.1,
    category: "retail",
    region: "global",
    verticals: ["commerce"],
    impact:
      "Spring shopping season with moderate CPM increase. Fashion, home, and garden categories rise.",
    recommendedActions: [
      "Refresh creatives with spring/seasonal themes",
      "Target seasonal shoppers with new arrivals",
      "Test new audience segments during moderate-competition window",
    ],
  },
  {
    name: "Spring Sale",
    startMMDD: "04-01",
    endMMDD: "04-15",
    cpmThresholdMultiplier: 1.1,
    cpaThresholdMultiplier: 1.05,
    category: "retail",
    region: "global",
    verticals: ["commerce"],
    impact:
      "Broad spring retail promotions. Moderate competition with opportunities for cost-efficient prospecting.",
    recommendedActions: [
      "Launch spring collection campaigns",
      "A/B test new creatives while CPMs are moderate",
      "Expand prospecting audiences during lower-competition window",
    ],
  },
  {
    name: "Mother's Day",
    startMMDD: "05-01",
    endMMDD: "05-12",
    cpmThresholdMultiplier: 1.2,
    cpaThresholdMultiplier: 1.15,
    category: "retail",
    region: "global",
    verticals: ["commerce"],
    impact:
      "Gift shopping surge. Flowers, jewelry, fashion, and experience categories see elevated competition.",
    recommendedActions: [
      "Front-load gift guide content 2 weeks before",
      "Target interest-based audiences for gift categories",
      "Use shipping deadline countdowns in ad copy",
    ],
  },
  {
    name: "Memorial Day",
    startMMDD: "05-24",
    endMMDD: "05-31",
    cpmThresholdMultiplier: 1.2,
    cpaThresholdMultiplier: 1.1,
    category: "retail",
    region: "us",
    verticals: ["commerce"],
    impact:
      "Major US sale event marking summer start. Outdoor, furniture, and appliance categories peak.",
    recommendedActions: [
      "Launch summer-themed campaigns with sale messaging",
      "Increase budgets for outdoor/leisure product categories",
      "Target home improvement and outdoor activity audiences",
    ],
  },
  {
    name: "Father's Day",
    startMMDD: "06-10",
    endMMDD: "06-18",
    cpmThresholdMultiplier: 1.15,
    cpaThresholdMultiplier: 1.1,
    category: "retail",
    region: "global",
    verticals: ["commerce"],
    impact:
      "Gift-oriented shopping similar to Mother's Day. Electronics, tools, and experience verticals rise.",
    recommendedActions: [
      "Promote gift-focused product collections",
      "Target audiences with recent electronics/tools interest signals",
      "Use 'Dad-approved' style creative themes",
    ],
  },
  {
    name: "4th of July",
    startMMDD: "06-28",
    endMMDD: "07-05",
    cpmThresholdMultiplier: 1.15,
    cpaThresholdMultiplier: 1.1,
    category: "retail",
    region: "us",
    verticals: ["commerce"],
    impact:
      "US Independence Day sales. Outdoor, BBQ, fashion, and home categories see elevated activity.",
    recommendedActions: [
      "Run patriotic-themed creatives with sale messaging",
      "Target outdoor and summer activity interest groups",
      "Schedule ads around holiday weekend traffic patterns",
    ],
  },
  {
    name: "Prime Day",
    startMMDD: "07-10",
    endMMDD: "07-17",
    cpmThresholdMultiplier: 1.4,
    cpaThresholdMultiplier: 1.25,
    category: "retail",
    region: "global",
    verticals: ["commerce"],
    impact:
      "Amazon Prime Day creates a halo effect across all e-commerce platforms. Significant CPM spike.",
    recommendedActions: [
      "Counter-program with competing sales to capture demand spillover",
      "Increase retargeting budgets to capture comparison shoppers",
      "Pre-build audiences before the spike to avoid high prospecting costs",
    ],
  },
  {
    name: "Back to School",
    startMMDD: "08-01",
    endMMDD: "08-31",
    cpmThresholdMultiplier: 1.2,
    cpaThresholdMultiplier: 1.1,
    category: "retail",
    region: "global",
    verticals: ["commerce"],
    impact:
      "Extended back-to-school season drives sustained CPM elevation across electronics, apparel, and supplies.",
    recommendedActions: [
      "Start campaigns early August to beat the rush",
      "Target parent and student demographics",
      "Promote bundle deals and bulk discounts",
    ],
  },
  {
    name: "Labor Day",
    startMMDD: "08-30",
    endMMDD: "09-07",
    cpmThresholdMultiplier: 1.2,
    cpaThresholdMultiplier: 1.1,
    category: "retail",
    region: "us",
    verticals: ["commerce"],
    impact:
      "End-of-summer US sale event. Furniture, mattress, and outdoor clearance categories peak.",
    recommendedActions: [
      "Promote end-of-summer clearance deals",
      "Target home improvement audiences with seasonal messaging",
      "Capture last-chance summer shoppers with urgency ads",
    ],
  },
  {
    name: "Columbus Day / Canadian Thanksgiving",
    startMMDD: "10-07",
    endMMDD: "10-14",
    cpmThresholdMultiplier: 1.1,
    cpaThresholdMultiplier: 1.05,
    category: "retail",
    region: "us",
    verticals: ["commerce"],
    impact:
      "Minor US retail event combined with Canadian Thanksgiving. Moderate competition increase.",
    recommendedActions: [
      "Run modest sale promotions for fall merchandise",
      "Target Canadian audiences with Thanksgiving-themed content",
      "Use this moderate window to test holiday season creatives",
    ],
  },
  {
    name: "Halloween",
    startMMDD: "10-15",
    endMMDD: "10-31",
    cpmThresholdMultiplier: 1.15,
    cpaThresholdMultiplier: 1.1,
    category: "retail",
    region: "us",
    verticals: ["commerce"],
    impact:
      "Halloween-driven spending on costumes, candy, and decorations. Entertainment verticals see lift.",
    recommendedActions: [
      "Launch themed creative with Halloween motifs",
      "Target costume, party supply, and candy interest groups",
      "Use countdown-to-event urgency for last-minute shoppers",
    ],
  },
  {
    name: "Singles' Day (11.11)",
    startMMDD: "11-08",
    endMMDD: "11-12",
    cpmThresholdMultiplier: 1.3,
    cpaThresholdMultiplier: 1.2,
    category: "retail",
    region: "apac",
    verticals: ["commerce"],
    impact:
      "The world's largest shopping event by GMV. APAC-focused but global e-commerce feels the impact.",
    recommendedActions: [
      "Coordinate with APAC inventory and logistics",
      "Run flash sale campaigns targeting APAC markets",
      "Leverage Singles' Day awareness for global promotions",
    ],
  },
  {
    name: "Black Friday / Cyber Monday",
    startMMDD: "11-20",
    endMMDD: "12-02",
    cpmThresholdMultiplier: 1.8,
    cpaThresholdMultiplier: 1.4,
    category: "retail",
    region: "global",
    verticals: ["commerce", "all"],
    impact:
      "Peak competition period. CPMs reach annual highs across all verticals. Critical planning required.",
    recommendedActions: [
      "Pre-build warm audiences weeks before to reduce CPA during the spike",
      "Set aggressive ROAS targets and monitor hourly",
      "Prepare creative variants to combat fatigue during the 12-day window",
      "Consider pausing underperforming campaigns to reallocate budget to winners",
    ],
  },
  {
    name: "Holiday Season (Dec)",
    startMMDD: "12-03",
    endMMDD: "12-26",
    cpmThresholdMultiplier: 1.5,
    cpaThresholdMultiplier: 1.3,
    category: "retail",
    region: "global",
    verticals: ["commerce", "all"],
    impact:
      "Sustained high competition through December. Gift shopping peaks around shipping deadlines.",
    recommendedActions: [
      "Shift to gift card and e-gift promotions after shipping cutoffs",
      "Increase retargeting frequency for cart abandoners",
      "Use 'last chance' messaging around key shipping deadlines",
    ],
  },
  {
    name: "Year-End Clearance",
    startMMDD: "12-26",
    endMMDD: "12-31",
    cpmThresholdMultiplier: 1.3,
    cpaThresholdMultiplier: 1.2,
    category: "retail",
    region: "global",
    verticals: ["commerce"],
    impact:
      "Post-holiday clearance with moderating but still elevated CPMs. Bargain hunters are active.",
    recommendedActions: [
      "Launch clearance and end-of-year sale campaigns",
      "Target deal-seeking audiences with markdown messaging",
      "Begin planning Q1 creative refresh",
    ],
  },

  // ── Cultural / International Events ───────────────────────────────────
  {
    name: "Chinese New Year",
    startMMDD: "01-20",
    endMMDD: "02-10",
    cpmThresholdMultiplier: 1.3,
    cpaThresholdMultiplier: 1.2,
    category: "cultural",
    region: "apac",
    verticals: ["commerce"],
    impact:
      "Major APAC shopping event. Gift-giving, travel, and luxury verticals see significant demand surges.",
    recommendedActions: [
      "Launch culturally appropriate red/gold themed creatives",
      "Target Chinese diaspora audiences globally",
      "Promote gift sets, luxury items, and travel packages",
      "Adjust shipping expectations for APAC logistics slowdowns",
    ],
  },
  {
    name: "Ramadan",
    startMMDD: "03-01",
    endMMDD: "04-05",
    cpmThresholdMultiplier: 1.2,
    cpaThresholdMultiplier: 1.15,
    category: "cultural",
    region: "mena",
    verticals: ["all"],
    impact:
      "Extended period of elevated ad activity in MENA. Food, fashion, and gifting categories peak. Consumer behavior shifts with altered daily schedules.",
    recommendedActions: [
      "Schedule ads for evening/night hours when engagement peaks",
      "Use culturally sensitive and Ramadan-themed creatives",
      "Promote food, fashion, and Eid gift categories",
      "Plan for Eid al-Fitr gift-shopping surge at the end",
    ],
  },
  {
    name: "Diwali",
    startMMDD: "10-20",
    endMMDD: "11-05",
    cpmThresholdMultiplier: 1.3,
    cpaThresholdMultiplier: 1.2,
    category: "cultural",
    region: "apac",
    verticals: ["commerce"],
    impact:
      "Major Indian shopping festival. Electronics, fashion, home decor, and gold/jewelry categories surge.",
    recommendedActions: [
      "Launch festive-themed creatives with Diwali motifs",
      "Promote electronics, fashion, and home decor deals",
      "Target South Asian diaspora audiences globally",
      "Coordinate with marketplace sales events (e.g., Flipkart Big Billion Days)",
    ],
  },
  {
    name: "Christmas (Global)",
    startMMDD: "12-10",
    endMMDD: "12-25",
    cpmThresholdMultiplier: 1.5,
    cpaThresholdMultiplier: 1.3,
    category: "cultural",
    region: "global",
    verticals: ["all"],
    impact:
      "Global gift-giving season peak. All verticals experience elevated competition and consumer urgency.",
    recommendedActions: [
      "Maximize retargeting on warm audiences built in November",
      "Shift to digital gift cards after shipping cutoffs",
      "Use holiday-themed creatives across all touchpoints",
      "Plan staff/budget for extended customer service demand",
    ],
  },

  // ── Sports Events ─────────────────────────────────────────────────────
  {
    name: "Super Bowl",
    startMMDD: "01-25",
    endMMDD: "02-12",
    cpmThresholdMultiplier: 1.4,
    cpaThresholdMultiplier: 1.2,
    category: "sports",
    region: "us",
    verticals: ["brand"],
    impact:
      "Highest-profile US advertising event. Brand awareness campaigns spike. Food, beverage, and entertainment verticals see massive engagement lifts.",
    recommendedActions: [
      "Align brand campaigns with Super Bowl cultural moment",
      "Capitalize on real-time engagement during the game",
      "Target sports and entertainment interest audiences",
      "Prepare post-game follow-up campaigns for sustained engagement",
    ],
  },
  {
    name: "March Madness",
    startMMDD: "03-15",
    endMMDD: "04-08",
    cpmThresholdMultiplier: 1.2,
    cpaThresholdMultiplier: 1.1,
    category: "sports",
    region: "us",
    verticals: ["brand"],
    impact:
      "Extended college basketball tournament drives sustained brand advertising. Sports betting, food, and beverage verticals see elevated competition.",
    recommendedActions: [
      "Run bracket-themed engagement campaigns",
      "Target college sports fan audiences",
      "Use real-time creative tied to tournament outcomes",
      "Consider connected TV placements for game viewership",
    ],
  },
  {
    name: "FIFA World Cup",
    startMMDD: "06-10",
    endMMDD: "07-15",
    cpmThresholdMultiplier: 1.3,
    cpaThresholdMultiplier: 1.15,
    category: "sports",
    region: "global",
    verticals: ["brand"],
    impact:
      "Global event with massive reach. Brand awareness and sports merchandise verticals see significant competition increases worldwide.",
    recommendedActions: [
      "Align creative with World Cup themes and national pride",
      "Target country-specific audiences based on team progress",
      "Use multi-language creatives for global reach",
      "Consider co-viewing and second-screen ad placements",
    ],
  },

  // ── Industry / B2B Events ─────────────────────────────────────────────
  {
    name: "New Year Planning",
    startMMDD: "01-05",
    endMMDD: "01-31",
    cpmThresholdMultiplier: 0.9,
    cpaThresholdMultiplier: 0.85,
    category: "industry",
    region: "global",
    verticals: ["leadgen"],
    impact:
      "Lower retail competition creates an opportunity window. B2B decision-makers are setting annual plans and budgets.",
    recommendedActions: [
      "Increase leadgen budgets to capture lower CPMs",
      "Launch annual planning and strategy content campaigns",
      "Target decision-makers with 'new year, new tools' messaging",
      "Promote free trials and demos for Q1 pipeline building",
    ],
  },
  {
    name: "Tax Season",
    startMMDD: "02-01",
    endMMDD: "04-15",
    cpmThresholdMultiplier: 1.1,
    cpaThresholdMultiplier: 1.05,
    category: "industry",
    region: "us",
    verticals: ["leadgen"],
    impact:
      "US tax season drives demand for financial services, accounting software, and advisory. Moderate CPM increase in financial services vertical.",
    recommendedActions: [
      "Target small business owners and self-employed audiences",
      "Promote tax preparation and financial planning services",
      "Use deadline urgency messaging as April 15 approaches",
      "Cross-promote related services (bookkeeping, payroll)",
    ],
  },
  {
    name: "Q4 Budget Cycle",
    startMMDD: "09-15",
    endMMDD: "10-31",
    cpmThresholdMultiplier: 1.15,
    cpaThresholdMultiplier: 1.1,
    category: "industry",
    region: "global",
    verticals: ["leadgen"],
    impact:
      "B2B buyers allocate remaining annual budgets. 'Use it or lose it' mentality drives procurement activity.",
    recommendedActions: [
      "Launch 'before year-end' procurement campaigns",
      "Target finance and procurement decision-makers",
      "Offer annual contract discounts to capture budget allocation",
      "Promote quick-implementation solutions for Q4 wins",
    ],
  },
  {
    name: "Year-End Closing",
    startMMDD: "11-15",
    endMMDD: "12-20",
    cpmThresholdMultiplier: 1.2,
    cpaThresholdMultiplier: 1.15,
    category: "industry",
    region: "global",
    verticals: ["leadgen"],
    impact:
      "Final push for B2B deal closing. Decision-makers rush to finalize purchases before fiscal year-end.",
    recommendedActions: [
      "Accelerate pipeline deals with special year-end pricing",
      "Target active leads with closing-focused messaging",
      "Offer expedited onboarding for year-end sign-ups",
      "Plan content for January hand-off and onboarding",
    ],
  },

  // ── Platform Events ───────────────────────────────────────────────────
  {
    name: "Meta Advantage+ Rollouts",
    startMMDD: "01-01",
    endMMDD: "12-31",
    cpmThresholdMultiplier: 1.0,
    cpaThresholdMultiplier: 0.95,
    category: "platform",
    region: "global",
    verticals: ["all"],
    impact:
      "Periodic Meta platform updates can improve CPA through automation. Monitor for new Advantage+ Shopping, Creative, and Audience features.",
    recommendedActions: [
      "Test Advantage+ Shopping campaigns for e-commerce accounts",
      "Enable Advantage+ Creative for automated creative optimization",
      "Monitor Meta Ads Manager for new automation features",
      "Compare manual vs. automated campaign performance regularly",
    ],
  },
  {
    name: "iOS Privacy Updates",
    startMMDD: "01-01",
    endMMDD: "12-31",
    cpmThresholdMultiplier: 1.0,
    cpaThresholdMultiplier: 1.1,
    category: "platform",
    region: "global",
    verticals: ["all"],
    impact:
      "Ongoing iOS privacy changes (ATT, SKAdNetwork) create measurement gaps. CPA may appear elevated due to underreported conversions.",
    recommendedActions: [
      "Ensure CAPI (Conversions API) is properly configured",
      "Use broad targeting to compensate for reduced signal",
      "Implement value optimization to offset measurement losses",
      "Monitor CAPI event match quality score regularly",
    ],
  },
];

// ---------------------------------------------------------------------------
// Month names utility
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// ---------------------------------------------------------------------------
// Enhanced query functions
// ---------------------------------------------------------------------------

export interface SeasonalEventFilterOptions {
  region?: EventRegion;
  vertical?: string;
  month?: number;
  category?: EventCategory;
}

/**
 * Filter the enhanced events by region, vertical, month, and/or category.
 * Returns matching events sorted by CPM multiplier (highest first).
 */
export function getSeasonalEvents(
  options: SeasonalEventFilterOptions = {},
): EnhancedSeasonalEvent[] {
  const { region, vertical, month, category } = options;

  let filtered = ENHANCED_SEASONAL_EVENTS.filter((event) => {
    // Filter by region: match if event is global, or event.region matches requested region
    if (region && region !== "global" && event.region !== "global" && event.region !== region) {
      return false;
    }

    // Filter by vertical: match if event targets 'all' or includes the requested vertical
    if (
      vertical &&
      !event.verticals.includes("all") &&
      !event.verticals.includes(vertical as EventVertical)
    ) {
      return false;
    }

    // Filter by category
    if (category && event.category !== category) {
      return false;
    }

    // Filter by month: check if the event is active during the given month
    if (month !== undefined) {
      if (!isEventActiveInMonth(event, month)) {
        return false;
      }
    }

    return true;
  });

  // Sort by CPM multiplier descending (highest impact first)
  filtered = filtered.sort((a, b) => b.cpmThresholdMultiplier - a.cpmThresholdMultiplier);

  return filtered;
}

/**
 * Check if an event's date range includes any days in the given month (1-12).
 */
function isEventActiveInMonth(event: EnhancedSeasonalEvent, month: number): boolean {
  // For year-round platform events, they are active every month
  if (event.startMMDD === "01-01" && event.endMMDD === "12-31") {
    return true;
  }

  const startMonth = parseInt(event.startMMDD.split("-")[0]!, 10);
  const endMonth = parseInt(event.endMMDD.split("-")[0]!, 10);

  if (startMonth <= endMonth) {
    // Non-wrapping range
    return month >= startMonth && month <= endMonth;
  } else {
    // Wrapping range (Dec->Jan)
    return month >= startMonth || month <= endMonth;
  }
}

// ---------------------------------------------------------------------------
// Monthly Seasonal Profile
// ---------------------------------------------------------------------------

export interface MonthlySeasonalProfile {
  events: EnhancedSeasonalEvent[];
  avgCPMMultiplier: number;
  avgCPAMultiplier: number;
  competitionLevel: "low" | "medium" | "high" | "peak";
  recommendations: string[];
}

/**
 * Returns a profile for a specific month including all active events,
 * average multipliers, and aggregated recommendations.
 */
export function getMonthlySeasonalProfile(
  month: number,
  vertical: string,
  region?: EventRegion,
): MonthlySeasonalProfile {
  const events = getSeasonalEvents({ month, vertical, region });

  // Filter out year-round platform events for multiplier calculation
  const impactEvents = events.filter((e) => !(e.startMMDD === "01-01" && e.endMMDD === "12-31"));

  let avgCPM = 1.0;
  let avgCPA = 1.0;
  if (impactEvents.length > 0) {
    const totalCPM = impactEvents.reduce((sum, e) => sum + e.cpmThresholdMultiplier, 0);
    const totalCPA = impactEvents.reduce((sum, e) => sum + e.cpaThresholdMultiplier, 0);
    avgCPM = totalCPM / impactEvents.length;
    avgCPA = totalCPA / impactEvents.length;
  }

  const competitionLevel = computeCompetitionLevel(impactEvents);

  // Aggregate unique recommendations from all active events
  const recommendations = aggregateRecommendations(events);

  return {
    events,
    avgCPMMultiplier: Math.round(avgCPM * 100) / 100,
    avgCPAMultiplier: Math.round(avgCPA * 100) / 100,
    competitionLevel,
    recommendations,
  };
}

function computeCompetitionLevel(
  events: EnhancedSeasonalEvent[],
): "low" | "medium" | "high" | "peak" {
  if (events.length === 0) return "low";

  const maxCPM = Math.max(...events.map((e) => e.cpmThresholdMultiplier));

  if (events.length >= 3 && maxCPM >= 1.4) return "peak";
  if (events.length >= 2 && maxCPM >= 1.3) return "peak";
  if (maxCPM >= 1.5) return "peak";
  if (events.length >= 2 && maxCPM >= 1.2) return "high";
  if (maxCPM >= 1.3) return "high";
  if (events.length >= 1 && maxCPM >= 1.1) return "medium";
  return "low";
}

function aggregateRecommendations(events: EnhancedSeasonalEvent[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const event of events) {
    for (const rec of event.recommendedActions) {
      if (!seen.has(rec)) {
        seen.add(rec);
        result.push(rec);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Annual Seasonal Calendar
// ---------------------------------------------------------------------------

export interface AnnualCalendarMonth {
  month: number;
  monthName: string;
  events: EnhancedSeasonalEvent[];
  avgCPMMultiplier: number;
  competitionLevel: string;
  budgetRecommendation: "increase" | "maintain" | "decrease" | "opportunistic";
}

/**
 * Returns a 12-month calendar with events and recommendations per month
 * for a given vertical and optional region.
 */
export function getAnnualSeasonalCalendar(
  vertical: string,
  region?: EventRegion,
): AnnualCalendarMonth[] {
  const calendar: AnnualCalendarMonth[] = [];

  for (let month = 1; month <= 12; month++) {
    const profile = getMonthlySeasonalProfile(month, vertical, region);

    const budgetRecommendation = computeBudgetRecommendation(profile);

    calendar.push({
      month,
      monthName: MONTH_NAMES[month]!,
      events: profile.events,
      avgCPMMultiplier: profile.avgCPMMultiplier,
      competitionLevel: profile.competitionLevel,
      budgetRecommendation,
    });
  }

  return calendar;
}

function computeBudgetRecommendation(
  profile: MonthlySeasonalProfile,
): "increase" | "maintain" | "decrease" | "opportunistic" {
  // If CPM multipliers are below 1.0, it's an opportunity to spend more efficiently
  if (profile.avgCPMMultiplier < 1.0) return "opportunistic";

  switch (profile.competitionLevel) {
    case "peak":
      return "increase";
    case "high":
      return "increase";
    case "medium":
      return "maintain";
    case "low":
    default:
      return profile.avgCPMMultiplier <= 1.0 ? "opportunistic" : "decrease";
  }
}

// ---------------------------------------------------------------------------
// Custom Event Registry — SeasonalCalendar class
// ---------------------------------------------------------------------------

/**
 * A configurable seasonal calendar that merges built-in enhanced events
 * with custom user-defined events. Supports all query methods.
 */
export class SeasonalCalendar {
  private customEvents: EnhancedSeasonalEvent[] = [];

  /**
   * Add a custom seasonal event to the calendar.
   */
  addCustomEvent(event: Omit<EnhancedSeasonalEvent, "name"> & { name: string }): void {
    // Validate MMDD format
    if (!/^\d{2}-\d{2}$/.test(event.startMMDD) || !/^\d{2}-\d{2}$/.test(event.endMMDD)) {
      throw new Error(
        `Invalid date format. Expected MM-DD, got startMMDD="${event.startMMDD}", endMMDD="${event.endMMDD}"`,
      );
    }
    this.customEvents.push(event as EnhancedSeasonalEvent);
  }

  /**
   * Remove a custom event by name. Returns true if found and removed, false otherwise.
   * Only removes custom events, not built-in events.
   */
  removeCustomEvent(name: string): boolean {
    const idx = this.customEvents.findIndex((e) => e.name === name);
    if (idx === -1) return false;
    this.customEvents.splice(idx, 1);
    return true;
  }

  /**
   * Get all events (built-in + custom), optionally filtered.
   */
  getEvents(options: SeasonalEventFilterOptions = {}): EnhancedSeasonalEvent[] {
    const allEvents = [...ENHANCED_SEASONAL_EVENTS, ...this.customEvents];
    return filterAndSortEvents(allEvents, options);
  }

  /**
   * Get the monthly seasonal profile including custom events.
   */
  getMonthlyProfile(month: number, vertical: string, region?: EventRegion): MonthlySeasonalProfile {
    const events = this.getEvents({ month, vertical, region });

    const impactEvents = events.filter((e) => !(e.startMMDD === "01-01" && e.endMMDD === "12-31"));

    let avgCPM = 1.0;
    let avgCPA = 1.0;
    if (impactEvents.length > 0) {
      const totalCPM = impactEvents.reduce((sum, e) => sum + e.cpmThresholdMultiplier, 0);
      const totalCPA = impactEvents.reduce((sum, e) => sum + e.cpaThresholdMultiplier, 0);
      avgCPM = totalCPM / impactEvents.length;
      avgCPA = totalCPA / impactEvents.length;
    }

    const competitionLevel = computeCompetitionLevel(impactEvents);
    const recommendations = aggregateRecommendations(events);

    return {
      events,
      avgCPMMultiplier: Math.round(avgCPM * 100) / 100,
      avgCPAMultiplier: Math.round(avgCPA * 100) / 100,
      competitionLevel,
      recommendations,
    };
  }

  /**
   * Get the full annual calendar including custom events.
   */
  getAnnualCalendar(vertical: string, region?: EventRegion): AnnualCalendarMonth[] {
    const calendar: AnnualCalendarMonth[] = [];

    for (let month = 1; month <= 12; month++) {
      const profile = this.getMonthlyProfile(month, vertical, region);
      const budgetRecommendation = computeBudgetRecommendation(profile);

      calendar.push({
        month,
        monthName: MONTH_NAMES[month]!,
        events: profile.events,
        avgCPMMultiplier: profile.avgCPMMultiplier,
        competitionLevel: profile.competitionLevel,
        budgetRecommendation,
      });
    }

    return calendar;
  }

  /**
   * List all custom events.
   */
  listCustomEvents(): EnhancedSeasonalEvent[] {
    return [...this.customEvents];
  }
}

/**
 * Internal helper: filter and sort events from any source array.
 */
function filterAndSortEvents(
  events: EnhancedSeasonalEvent[],
  options: SeasonalEventFilterOptions,
): EnhancedSeasonalEvent[] {
  const { region, vertical, month, category } = options;

  let filtered = events.filter((event) => {
    if (region && region !== "global" && event.region !== "global" && event.region !== region) {
      return false;
    }
    if (
      vertical &&
      !event.verticals.includes("all") &&
      !event.verticals.includes(vertical as EventVertical)
    ) {
      return false;
    }
    if (category && event.category !== category) {
      return false;
    }
    if (month !== undefined) {
      if (!isEventActiveInMonth(event, month)) {
        return false;
      }
    }
    return true;
  });

  filtered = filtered.sort((a, b) => b.cpmThresholdMultiplier - a.cpmThresholdMultiplier);

  return filtered;
}
