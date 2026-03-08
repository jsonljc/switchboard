// ---------------------------------------------------------------------------
// Digital Ads Cartridge Manifest
// ---------------------------------------------------------------------------
// Declares 72 actions: 6 read (diagnostics) + 10 write (campaign management) + 38 (reporting, signal health, audience, optimization, creative, experimentation, rules, strategy) + 8 (compliance, measurement) + 10 (pacing, alerting, forecasting, catalog).
// ---------------------------------------------------------------------------

import type { CartridgeManifest } from "./types.js";

export const DIGITAL_ADS_MANIFEST: CartridgeManifest = {
  id: "digital-ads",
  name: "Digital Ads",
  version: "1.0.0",
  description:
    "Multi-platform ad performance diagnostics, campaign management, reporting, signal health, audience management, bid/budget optimization, creative management, A/B testing, automated optimization, and strategy planning.",
  requiredConnections: ["meta-ads"],
  defaultPolicies: ["digital-ads-default"],
  actions: [
    {
      actionType: "digital-ads.platform.connect",
      name: "Connect Platform",
      description:
        "Validate credentials and establish connectivity to an ad platform. Returns connection health, account name, and available entity levels.",
      parametersSchema: {
        type: "object",
        required: ["platform", "credentials", "entityId"],
        properties: {
          platform: {
            type: "string",
            enum: ["meta", "google", "tiktok"],
            description: "The ad platform to connect to",
          },
          credentials: {
            type: "object",
            description: "Platform-specific credentials",
          },
          entityId: {
            type: "string",
            description: 'The ad account or entity ID (e.g. "act_123456789")',
          },
        },
      },
      baseRiskCategory: "none",
      reversible: true,
    },
    {
      actionType: "digital-ads.funnel.diagnose",
      name: "Diagnose Funnel",
      description:
        "Run a complete single-platform funnel diagnostic. Fetches metrics, walks the funnel, runs all relevant advisors, and returns stage analysis, dropoffs, bottleneck, findings, and economic impact.",
      parametersSchema: {
        type: "object",
        required: ["platform", "entityId", "vertical"],
        properties: {
          platform: {
            type: "string",
            enum: ["meta", "google", "tiktok"],
            description: "The ad platform to diagnose",
          },
          entityId: {
            type: "string",
            description: "The ad account or entity ID",
          },
          entityLevel: {
            type: "string",
            enum: ["account", "campaign", "adset", "ad"],
            description: "Entity level to analyze (default: account)",
          },
          vertical: {
            type: "string",
            enum: ["commerce", "leadgen", "brand"],
            description: "Business vertical for this account",
          },
          periodDays: {
            type: "number",
            description: "Number of days per comparison period (default: 7 = WoW)",
          },
          referenceDate: {
            type: "string",
            description:
              'Reference date for current period end (default: yesterday). Format: "YYYY-MM-DD"',
          },
          enableStructuralAnalysis: {
            type: "boolean",
            description: "Enable ad set fragmentation and structure analysis (default: false)",
          },
          enableHistoricalTrends: {
            type: "boolean",
            description:
              "Enable creative exhaustion and historical trend detection (default: false)",
          },
          targetROAS: {
            type: "number",
            description:
              "Target ROAS for efficiency comparison (e.g. 4.0 = $4 revenue per $1 spent)",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.portfolio.diagnose",
      name: "Diagnose Portfolio",
      description:
        "Run diagnostics across all configured platforms and produce cross-platform insights, budget recommendations, portfolio actions, and an executive summary.",
      parametersSchema: {
        type: "object",
        required: ["name", "vertical", "platforms"],
        properties: {
          name: {
            type: "string",
            description: "Human-readable account/portfolio name",
          },
          vertical: {
            type: "string",
            enum: ["commerce", "leadgen", "brand"],
            description: "Business vertical for all platforms",
          },
          platforms: {
            type: "array",
            description: "Platform configurations to include",
            items: {
              type: "object",
              required: ["platform", "credentials", "entityId"],
              properties: {
                platform: {
                  type: "string",
                  enum: ["meta", "google", "tiktok"],
                },
                credentials: { type: "object" },
                entityId: { type: "string" },
                entityLevel: { type: "string" },
                enableStructuralAnalysis: { type: "boolean" },
                enableHistoricalTrends: { type: "boolean" },
                qualifiedLeadActionType: { type: "string" },
                targetROAS: { type: "number" },
              },
            },
          },
          periodDays: {
            type: "number",
            description: "Number of days per comparison period (default: 7)",
          },
          referenceDate: {
            type: "string",
            description: 'Reference date (default: yesterday). Format: "YYYY-MM-DD"',
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.snapshot.fetch",
      name: "Fetch Snapshot",
      description:
        "Fetch raw metric data without analysis. Returns normalized metrics (spend, stage volumes, top-level KPIs) for a specific time range. Useful for exploration or custom comparisons.",
      parametersSchema: {
        type: "object",
        required: ["platform", "entityId", "vertical", "timeRange"],
        properties: {
          platform: {
            type: "string",
            enum: ["meta", "google", "tiktok"],
            description: "The ad platform to fetch from",
          },
          entityId: {
            type: "string",
            description: "The ad account or entity ID",
          },
          entityLevel: {
            type: "string",
            enum: ["account", "campaign", "adset", "ad"],
            description: "Entity level to fetch (default: account)",
          },
          vertical: {
            type: "string",
            enum: ["commerce", "leadgen", "brand"],
            description: "Business vertical (determines which funnel metrics to fetch)",
          },
          timeRange: {
            type: "object",
            required: ["since", "until"],
            properties: {
              since: {
                type: "string",
                description: "Start date (YYYY-MM-DD)",
              },
              until: {
                type: "string",
                description: "End date (YYYY-MM-DD)",
              },
            },
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.structure.analyze",
      name: "Analyze Structure",
      description:
        "Analyze ad account structure including ad set fragmentation, budget skew, creative diversity, pacing, and overlap. Returns sub-entity breakdowns and structural findings.",
      parametersSchema: {
        type: "object",
        required: ["platform", "entityId", "vertical"],
        properties: {
          platform: {
            type: "string",
            enum: ["meta", "google", "tiktok"],
            description: "The ad platform to analyze",
          },
          entityId: {
            type: "string",
            description: "The ad account or entity ID",
          },
          vertical: {
            type: "string",
            enum: ["commerce", "leadgen", "brand"],
            description: "Business vertical",
          },
          periodDays: {
            type: "number",
            description: "Number of days to analyze (default: 7)",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.health.check",
      name: "Check Health",
      description:
        "Check connectivity and capabilities for all specified ad platforms. Returns per-platform connection health, latency, and available capabilities.",
      parametersSchema: {
        type: "object",
        required: ["platforms"],
        properties: {
          platforms: {
            type: "array",
            description: "Platforms to check",
            items: {
              type: "object",
              required: ["platform", "credentials", "entityId"],
              properties: {
                platform: {
                  type: "string",
                  enum: ["meta", "google", "tiktok"],
                },
                credentials: { type: "object" },
                entityId: { type: "string" },
              },
            },
          },
        },
      },
      baseRiskCategory: "none",
      reversible: true,
    },
    // ── Write actions ──────────────────────────────────────────────────
    {
      actionType: "digital-ads.campaign.pause",
      name: "Pause Campaign",
      description: "Pause an active ad campaign on Meta.",
      parametersSchema: {
        type: "object",
        required: ["campaignId"],
        properties: {
          campaignId: { type: "string", description: "The campaign ID to pause" },
        },
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "digital-ads.campaign.resume",
      name: "Resume Campaign",
      description: "Resume a paused ad campaign on Meta.",
      parametersSchema: {
        type: "object",
        required: ["campaignId"],
        properties: {
          campaignId: { type: "string", description: "The campaign ID to resume" },
        },
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "digital-ads.campaign.adjust_budget",
      name: "Adjust Campaign Budget",
      description: "Adjust the daily or lifetime budget of a Meta campaign.",
      parametersSchema: {
        type: "object",
        required: ["campaignId", "newBudget"],
        properties: {
          campaignId: { type: "string", description: "The campaign ID" },
          newBudget: { type: "number", description: "New daily budget in dollars" },
        },
      },
      baseRiskCategory: "high",
      reversible: true,
    },
    {
      actionType: "digital-ads.adset.pause",
      name: "Pause Ad Set",
      description: "Pause an active ad set on Meta.",
      parametersSchema: {
        type: "object",
        required: ["adSetId"],
        properties: {
          adSetId: { type: "string", description: "The ad set ID to pause" },
        },
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "digital-ads.adset.resume",
      name: "Resume Ad Set",
      description: "Resume a paused ad set on Meta.",
      parametersSchema: {
        type: "object",
        required: ["adSetId"],
        properties: {
          adSetId: { type: "string", description: "The ad set ID to resume" },
        },
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "digital-ads.adset.adjust_budget",
      name: "Adjust Ad Set Budget",
      description: "Adjust the daily or lifetime budget of a Meta ad set.",
      parametersSchema: {
        type: "object",
        required: ["adSetId", "newBudget"],
        properties: {
          adSetId: { type: "string", description: "The ad set ID" },
          newBudget: { type: "number", description: "New daily budget in dollars" },
        },
      },
      baseRiskCategory: "high",
      reversible: true,
    },
    {
      actionType: "digital-ads.targeting.modify",
      name: "Modify Targeting",
      description:
        "Modify targeting parameters for a Meta ad set. Irreversible — triggers learning phase reset.",
      parametersSchema: {
        type: "object",
        required: ["adSetId", "targeting"],
        properties: {
          adSetId: { type: "string", description: "The ad set ID to modify" },
          targeting: {
            type: "object",
            description: "New targeting parameters",
            additionalProperties: true,
          },
        },
      },
      baseRiskCategory: "high",
      reversible: false,
    },
    // ── Campaign/AdSet/Ad Creation ───────────────────────────────────
    {
      actionType: "digital-ads.campaign.create",
      name: "Create Campaign",
      description: "Create a new ad campaign on Meta. Requires name, objective, and budget.",
      parametersSchema: {
        type: "object",
        required: ["name", "objective", "dailyBudget"],
        properties: {
          name: { type: "string", description: "Campaign name" },
          objective: {
            type: "string",
            enum: [
              "OUTCOME_LEADS",
              "OUTCOME_SALES",
              "OUTCOME_AWARENESS",
              "OUTCOME_TRAFFIC",
              "OUTCOME_ENGAGEMENT",
            ],
            description: "Campaign objective",
          },
          dailyBudget: { type: "number", description: "Daily budget in dollars" },
          status: {
            type: "string",
            enum: ["ACTIVE", "PAUSED"],
            description: "Initial status (default: PAUSED)",
          },
          specialAdCategories: {
            type: "array",
            items: { type: "string" },
            description: "Special ad categories (e.g., HOUSING, CREDIT, EMPLOYMENT)",
          },
        },
      },
      baseRiskCategory: "high",
      reversible: true,
      executorHint: "l2-llm",
      stepType: "EXECUTE",
    },
    {
      actionType: "digital-ads.adset.create",
      name: "Create Ad Set",
      description:
        "Create a new ad set within an existing campaign. Requires campaign ID, targeting, and budget.",
      parametersSchema: {
        type: "object",
        required: ["campaignId", "name", "dailyBudget", "targeting"],
        properties: {
          campaignId: { type: "string", description: "Parent campaign ID" },
          name: { type: "string", description: "Ad set name" },
          dailyBudget: { type: "number", description: "Daily budget in dollars" },
          targeting: { type: "object", description: "Targeting specification" },
          optimizationGoal: {
            type: "string",
            description: "Optimization goal (e.g., LEAD_GENERATION, CONVERSIONS)",
          },
          billingEvent: { type: "string", description: "Billing event (default: IMPRESSIONS)" },
          status: {
            type: "string",
            enum: ["ACTIVE", "PAUSED"],
            description: "Initial status (default: PAUSED)",
          },
        },
      },
      baseRiskCategory: "high",
      reversible: true,
      executorHint: "l2-llm",
      stepType: "EXECUTE",
    },
    {
      actionType: "digital-ads.ad.create",
      name: "Create Ad",
      description:
        "Create a new ad within an existing ad set. Requires ad set ID, creative, and ad name.",
      parametersSchema: {
        type: "object",
        required: ["adSetId", "name", "creative"],
        properties: {
          adSetId: { type: "string", description: "Parent ad set ID" },
          name: { type: "string", description: "Ad name" },
          creative: {
            type: "object",
            description: "Ad creative specification (title, body, imageUrl, callToAction)",
          },
          status: {
            type: "string",
            enum: ["ACTIVE", "PAUSED"],
            description: "Initial status (default: PAUSED)",
          },
        },
      },
      baseRiskCategory: "critical",
      reversible: true,
      executorHint: "l2-llm",
      stepType: "EXECUTE",
    },
    // ── Phase 1: Reporting & Analytics ────────────────────────────────
    {
      actionType: "digital-ads.report.performance",
      name: "Performance Report",
      description:
        "Generate a performance report with configurable breakdowns, date ranges, and aggregation levels.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string", description: "Ad account ID" },
          datePreset: { type: "string", description: "Date preset (e.g. last_7d, last_30d)" },
          timeRange: { type: "object", description: "Custom date range {since, until}" },
          level: { type: "string", enum: ["account", "campaign", "adset", "ad"] },
          breakdowns: { type: "array", items: { type: "string" } },
          fields: { type: "array", items: { type: "string" } },
          limit: { type: "number" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.report.creative",
      name: "Creative Report",
      description: "Generate a creative performance report with per-ad metrics and creative metadata.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string" },
          datePreset: { type: "string" },
          timeRange: { type: "object" },
          limit: { type: "number" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.report.audience",
      name: "Audience Report",
      description: "Generate audience breakdown report by age, gender, and country.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string" },
          datePreset: { type: "string" },
          timeRange: { type: "object" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.report.placement",
      name: "Placement Report",
      description: "Generate placement breakdown report by platform and position.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string" },
          datePreset: { type: "string" },
          timeRange: { type: "object" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.report.comparison",
      name: "Period Comparison Report",
      description: "Compare performance between two time periods with metric-level change analysis.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId", "currentPeriod", "previousPeriod"],
        properties: {
          adAccountId: { type: "string" },
          currentPeriod: { type: "object", required: ["since", "until"] },
          previousPeriod: { type: "object", required: ["since", "until"] },
          level: { type: "string", enum: ["account", "campaign", "adset", "ad"] },
          metrics: { type: "array", items: { type: "string" } },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    // ── Phase 2: Signal Health ────────────────────────────────────────
    {
      actionType: "digital-ads.signal.pixel.diagnose",
      name: "Diagnose Pixel",
      description: "Validate pixel events, check firing status, and identify missing standard events.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: { adAccountId: { type: "string" } },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.signal.capi.diagnose",
      name: "Diagnose CAPI",
      description: "Check server-side event health, deduplication rates, and CAPI coverage.",
      parametersSchema: {
        type: "object",
        required: ["pixelId"],
        properties: { pixelId: { type: "string" } },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.signal.emq.check",
      name: "Check EMQ",
      description: "Check Event Match Quality score and parameter coverage for a dataset.",
      parametersSchema: {
        type: "object",
        required: ["datasetId"],
        properties: { datasetId: { type: "string" } },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.account.learning_phase",
      name: "Check Learning Phase",
      description: "Check learning phase status for ad sets — identifies stuck or limited learning.",
      parametersSchema: {
        type: "object",
        properties: {
          adSetId: { type: "string", description: "Single ad set ID (optional)" },
          adAccountId: { type: "string", description: "Check all active ad sets in account" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.account.delivery.diagnose",
      name: "Diagnose Delivery",
      description: "Diagnose delivery issues for a campaign including delivery estimates.",
      parametersSchema: {
        type: "object",
        required: ["campaignId"],
        properties: { campaignId: { type: "string" } },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    // ── Phase 3: Audience Management ─────────────────────────────────
    {
      actionType: "digital-ads.audience.custom.create",
      name: "Create Custom Audience",
      description: "Create a custom audience from website visitors, customer lists, or engagement.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId", "name", "source"],
        properties: {
          adAccountId: { type: "string" },
          name: { type: "string" },
          source: { type: "string", enum: ["website", "customer_list", "engagement", "app", "offline"] },
          description: { type: "string" },
          rule: { type: "object" },
          retentionDays: { type: "number" },
        },
      },
      baseRiskCategory: "high",
      reversible: true,
    },
    {
      actionType: "digital-ads.audience.lookalike.create",
      name: "Create Lookalike Audience",
      description: "Create a lookalike audience from a source audience with configurable ratio.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId", "name", "sourceAudienceId", "targetCountries", "ratio"],
        properties: {
          adAccountId: { type: "string" },
          name: { type: "string" },
          sourceAudienceId: { type: "string" },
          targetCountries: { type: "array", items: { type: "string" } },
          ratio: { type: "number", description: "0.01-0.20 (1%-20%)" },
        },
      },
      baseRiskCategory: "high",
      reversible: true,
    },
    {
      actionType: "digital-ads.audience.list",
      name: "List Audiences",
      description: "List custom audiences for an ad account with size and status info.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string" },
          limit: { type: "number" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.audience.insights",
      name: "Audience Insights",
      description: "Get audience size estimates and delivery estimates for targeting specs.",
      parametersSchema: {
        type: "object",
        properties: {
          audienceId: { type: "string" },
          adAccountId: { type: "string" },
          targetingSpec: { type: "object" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.audience.delete",
      name: "Delete Audience",
      description: "Permanently delete a custom audience. This action is irreversible.",
      parametersSchema: {
        type: "object",
        required: ["audienceId"],
        properties: { audienceId: { type: "string" } },
      },
      baseRiskCategory: "critical",
      reversible: false,
    },
    // ── Phase 4: Bid & Budget Optimization ───────────────────────────
    {
      actionType: "digital-ads.bid.update_strategy",
      name: "Update Bid Strategy",
      description: "Update the bid strategy and/or bid amount for an ad set.",
      parametersSchema: {
        type: "object",
        required: ["adSetId", "bidStrategy"],
        properties: {
          adSetId: { type: "string" },
          bidStrategy: { type: "string", enum: ["LOWEST_COST_WITHOUT_CAP", "LOWEST_COST_WITH_BID_CAP", "COST_CAP", "MINIMUM_ROAS"] },
          bidAmount: { type: "number" },
        },
      },
      baseRiskCategory: "high",
      reversible: true,
    },
    {
      actionType: "digital-ads.budget.reallocate",
      name: "Reallocate Budget",
      description: "Reallocate budget across campaigns based on performance analysis.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string" },
          maxShiftPercent: { type: "number", description: "Max % shift per campaign (default: 30)" },
        },
      },
      baseRiskCategory: "high",
      reversible: true,
    },
    {
      actionType: "digital-ads.budget.recommend",
      name: "Budget Recommendation",
      description: "Generate budget allocation recommendations without making changes.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: { adAccountId: { type: "string" } },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.schedule.set",
      name: "Set Ad Schedule",
      description: "Set dayparting schedule for an ad set based on performance analysis.",
      parametersSchema: {
        type: "object",
        required: ["adSetId", "schedule"],
        properties: {
          adSetId: { type: "string" },
          schedule: { type: "array", description: "Array of {day, startMinute, endMinute}" },
        },
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "digital-ads.campaign.update_objective",
      name: "Update Campaign Objective",
      description: "Change the objective of an existing campaign. High-impact, irreversible change.",
      parametersSchema: {
        type: "object",
        required: ["campaignId", "objective"],
        properties: {
          campaignId: { type: "string" },
          objective: { type: "string" },
        },
      },
      baseRiskCategory: "critical",
      reversible: false,
    },
    // ── Phase 5: Creative Management ─────────────────────────────────
    {
      actionType: "digital-ads.creative.upload",
      name: "Upload Creative",
      description: "Upload a new ad creative to the ad account.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId", "creative"],
        properties: {
          adAccountId: { type: "string" },
          creative: { type: "object", description: "Creative specification" },
        },
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "digital-ads.creative.list",
      name: "List Creatives",
      description: "List ad creatives for an ad account.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string" },
          limit: { type: "number" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.creative.analyze",
      name: "Analyze Creatives",
      description: "Analyze creative performance — top/bottom performers, fatigue, format mix.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string" },
          datePreset: { type: "string" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.creative.rotate",
      name: "Rotate Creatives",
      description: "Execute creative rotation — pause fatigued ads and activate replacements.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string" },
          minSpendThreshold: { type: "number" },
        },
      },
      baseRiskCategory: "high",
      reversible: true,
    },
    {
      actionType: "digital-ads.creative.generate",
      name: "Generate Creative Variants",
      description: "Generate ad creative text variants using the creative variant generator.",
      parametersSchema: {
        type: "object",
        required: ["productDescription", "targetAudience"],
        properties: {
          productDescription: { type: "string" },
          targetAudience: { type: "string" },
          angles: { type: "array", items: { type: "string" } },
          variantsPerAngle: { type: "number" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.creative.score_assets",
      name: "Score Creative Assets",
      description:
        "Score creative assets by combining pre-computed vision model outputs (visual attributes) with performance data. Returns per-asset scores across 5 dimensions (performance, engagement, creative quality, fatigue, format), letter grades, strengths/weaknesses, and portfolio-level insights including attribute correlations and diversity scoring.",
      parametersSchema: {
        type: "object",
        required: ["accountId", "assets"],
        properties: {
          accountId: { type: "string", description: "Ad account ID" },
          assets: {
            type: "array",
            description: "Array of asset performance data objects (adId, adName, assetType, impressions, clicks, conversions, spend, ctr, cpa, frequency, and optional video metrics)",
          },
          visualAttributes: {
            type: "object",
            description: "Map of adId to visual attributes (pre-computed by vision model). Keys are adId strings, values are VisualAttributes objects.",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.creative.generate_brief",
      name: "Generate Creative Brief",
      description:
        "Generate an actionable creative brief based on top-performing assets and identified weaknesses. Returns recommended formats, visual guidelines, copy guidelines, CTA recommendations, avoid list, and example references.",
      parametersSchema: {
        type: "object",
        required: ["topPerformers"],
        properties: {
          topPerformers: {
            type: "array",
            description: "Array of AssetScore objects from score_assets results (top performers to model the brief after)",
          },
          weaknesses: {
            type: "array",
            items: { type: "string" },
            description: "Array of weakness strings to address in the brief",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    // ── Phase 6: A/B Testing ─────────────────────────────────────────
    {
      actionType: "digital-ads.experiment.create",
      name: "Create Experiment",
      description: "Create an A/B test experiment using Meta Ad Studies API.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId", "name", "cells"],
        properties: {
          adAccountId: { type: "string" },
          name: { type: "string" },
          cells: { type: "array", description: "Test cells with ad sets and treatment %" },
          startTime: { type: "string" },
          endTime: { type: "string" },
        },
      },
      baseRiskCategory: "high",
      reversible: true,
    },
    {
      actionType: "digital-ads.experiment.check",
      name: "Check Experiment",
      description: "Check experiment status and results from Meta Ad Studies.",
      parametersSchema: {
        type: "object",
        required: ["studyId"],
        properties: { studyId: { type: "string" } },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.experiment.conclude",
      name: "Conclude Experiment",
      description: "Conclude an experiment — pause losers, scale winner.",
      parametersSchema: {
        type: "object",
        required: ["experimentId", "winnerId"],
        properties: {
          experimentId: { type: "string" },
          winnerId: { type: "string" },
        },
      },
      baseRiskCategory: "medium",
      reversible: false,
    },
    {
      actionType: "digital-ads.experiment.list",
      name: "List Experiments",
      description: "List all A/B test experiments for an ad account.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: { adAccountId: { type: "string" } },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    // ── Phase 7: Automated Optimization ──────────────────────────────
    {
      actionType: "digital-ads.optimization.review",
      name: "Optimization Review",
      description: "Run a full optimization review — budget, bids, creatives, audiences.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: { adAccountId: { type: "string" } },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.optimization.apply",
      name: "Apply Optimizations",
      description: "Execute a batch of optimization actions (tier 1 auto, tier 2 approval).",
      parametersSchema: {
        type: "object",
        required: ["actions"],
        properties: {
          actions: { type: "array", description: "Array of {actionType, parameters}" },
          autoApproveThreshold: { type: "string", enum: ["tier1", "tier2", "none"] },
        },
      },
      baseRiskCategory: "high",
      reversible: true,
    },
    {
      actionType: "digital-ads.rule.create",
      name: "Create Automated Rule",
      description: "Create an automated ad rule in the ad account.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId", "name", "schedule", "evaluation", "execution"],
        properties: {
          adAccountId: { type: "string" },
          name: { type: "string" },
          schedule: { type: "object" },
          evaluation: { type: "object" },
          execution: { type: "object" },
        },
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "digital-ads.rule.list",
      name: "List Automated Rules",
      description: "List all automated ad rules for an ad account.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: { adAccountId: { type: "string" } },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.rule.delete",
      name: "Delete Automated Rule",
      description: "Delete an automated ad rule.",
      parametersSchema: {
        type: "object",
        required: ["ruleId"],
        properties: { ruleId: { type: "string" } },
      },
      baseRiskCategory: "medium",
      reversible: false,
    },
    // ── Phase 8: Strategy & Planning ─────────────────────────────────
    {
      actionType: "digital-ads.strategy.recommend",
      name: "Strategy Recommendation",
      description: "Get campaign strategy recommendations based on business goals and budget.",
      parametersSchema: {
        type: "object",
        required: ["businessGoal", "monthlyBudget"],
        properties: {
          businessGoal: { type: "string" },
          monthlyBudget: { type: "number" },
          targetAudience: { type: "string" },
          vertical: { type: "string" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.strategy.mediaplan",
      name: "Media Plan",
      description: "Generate a media plan with budget allocation, timeline, and reach forecasting.",
      parametersSchema: {
        type: "object",
        required: ["totalBudget", "durationDays", "objective"],
        properties: {
          totalBudget: { type: "number" },
          durationDays: { type: "number" },
          objective: { type: "string" },
          targetAudience: { type: "string" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.reach.estimate",
      name: "Reach Estimate",
      description: "Get reach and audience size estimates for a targeting specification.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId", "targetingSpec"],
        properties: {
          adAccountId: { type: "string" },
          targetingSpec: { type: "object" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.campaign.setup_guided",
      name: "Guided Campaign Setup",
      description: "Multi-step guided campaign creation — campaign + ad set + ad with best practices.",
      parametersSchema: {
        type: "object",
        required: ["objective", "campaignName", "dailyBudget", "targeting", "creative"],
        properties: {
          objective: { type: "string" },
          campaignName: { type: "string" },
          dailyBudget: { type: "number" },
          targeting: { type: "object" },
          creative: { type: "object" },
          optimizationGoal: { type: "string" },
          status: { type: "string", enum: ["ACTIVE", "PAUSED"] },
        },
      },
      baseRiskCategory: "high",
      reversible: true,
    },
    // ── Phase 9: Compliance & Brand Safety ─────────────────────────
    {
      actionType: "digital-ads.compliance.review_status",
      name: "Check Ad Review Status",
      description: "Check review status and policy violations for disapproved or flagged ads.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string", description: "Ad account ID" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.compliance.audit",
      name: "Compliance Audit",
      description: "Run a comprehensive compliance audit — ad review, special categories, pixel health, CAPI, and overall compliance score.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string", description: "Ad account ID" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.compliance.publisher_blocklist",
      name: "Manage Publisher Blocklist",
      description: "List or create publisher block lists for brand safety.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string", description: "Ad account ID" },
          action: { type: "string", enum: ["list", "create"], description: "Action to perform (default: list)" },
          name: { type: "string", description: "Blocklist name (required for create)" },
          publishers: { type: "array", items: { type: "string" }, description: "Publishers to block (required for create)" },
        },
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "digital-ads.compliance.content_exclusions",
      name: "Content Exclusions",
      description: "Configure content exclusion settings and brand safety filters for campaigns.",
      parametersSchema: {
        type: "object",
        required: ["campaignId"],
        properties: {
          campaignId: { type: "string", description: "Campaign ID" },
          excludedPublisherCategories: { type: "array", items: { type: "string" } },
          brandSafetyContentFilterLevel: { type: "string", enum: ["STANDARD", "LIMITED", "FULL"] },
        },
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    // ── Phase 9: Measurement & Attribution ─────────────────────────
    {
      actionType: "digital-ads.measurement.lift_study.create",
      name: "Create Lift Study",
      description: "Create a conversion lift study to measure incremental impact of ads.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId", "name", "startTime", "endTime", "cells"],
        properties: {
          adAccountId: { type: "string", description: "Ad account ID" },
          name: { type: "string", description: "Study name" },
          startTime: { type: "number", description: "Start time (Unix timestamp)" },
          endTime: { type: "number", description: "End time (Unix timestamp)" },
          cells: {
            type: "array",
            description: "Test cells with ad set/campaign assignments",
            items: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string" },
                adSetIds: { type: "array", items: { type: "string" } },
                campaignIds: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
      baseRiskCategory: "high",
      reversible: false,
    },
    {
      actionType: "digital-ads.measurement.lift_study.check",
      name: "Check Lift Study",
      description: "Check status and results of a conversion lift study.",
      parametersSchema: {
        type: "object",
        required: ["studyId"],
        properties: {
          studyId: { type: "string", description: "Lift study ID" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.measurement.attribution.compare",
      name: "Compare Attribution Windows",
      description: "Compare conversions across attribution windows (1d click, 7d click, 1d view) to understand attribution sensitivity.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string", description: "Ad account ID" },
          datePreset: { type: "string", description: "Date preset (default: last_30d)" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.measurement.mmm_export",
      name: "MMM Data Export",
      description: "Export daily-grain data formatted for Marketing Mix Modeling tools (Robyn, Meridian).",
      parametersSchema: {
        type: "object",
        required: ["adAccountId", "timeRange"],
        properties: {
          adAccountId: { type: "string", description: "Ad account ID" },
          timeRange: {
            type: "object",
            required: ["since", "until"],
            properties: {
              since: { type: "string", description: "Start date (YYYY-MM-DD)" },
              until: { type: "string", description: "End date (YYYY-MM-DD)" },
            },
          },
          format: { type: "string", enum: ["csv", "json"], description: "Export format (default: json)" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    // ── Phase 10: Pacing & Flight Management ────────────────────────
    {
      actionType: "digital-ads.pacing.check",
      name: "Check Pacing",
      description: "Check pacing status for a flight plan — compares actual vs planned spend based on pacing curve.",
      parametersSchema: {
        type: "object",
        required: ["flightId"],
        properties: {
          flightId: { type: "string", description: "Flight plan ID to check" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.pacing.create_flight",
      name: "Create Flight Plan",
      description: "Create a flight plan with budget, dates, and pacing curve for a campaign.",
      parametersSchema: {
        type: "object",
        required: ["name", "campaignId", "startDate", "endDate", "totalBudget"],
        properties: {
          name: { type: "string", description: "Flight plan name" },
          campaignId: { type: "string", description: "Campaign ID" },
          startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
          endDate: { type: "string", description: "End date (YYYY-MM-DD)" },
          totalBudget: { type: "number", description: "Total flight budget in dollars" },
          pacingCurve: { type: "string", enum: ["even", "front-loaded", "back-loaded"], description: "Pacing curve (default: even)" },
        },
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "digital-ads.pacing.auto_adjust",
      name: "Auto-Adjust Pacing",
      description: "Automatically adjust daily budget to correct pacing based on flight plan.",
      parametersSchema: {
        type: "object",
        required: ["flightId"],
        properties: {
          flightId: { type: "string", description: "Flight plan ID to adjust" },
        },
      },
      baseRiskCategory: "high",
      reversible: true,
    },
    // ── Phase 11: Anomaly Detection & Alerting ─────────────────────
    {
      actionType: "digital-ads.alert.anomaly_scan",
      name: "Anomaly Scan",
      description: "Scan daily metrics for statistical anomalies using z-score and IQR methods.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string", description: "Ad account ID" },
          datePreset: { type: "string", description: "Date preset for historical data (default: last_30d)" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.alert.budget_forecast",
      name: "Budget Forecast",
      description: "Forecast budget exhaustion timelines for all campaigns in an ad account.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string", description: "Ad account ID" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.alert.policy_scan",
      name: "Policy Scan",
      description: "Scan for disapproved ads, policy violations, and approaching spend limits.",
      parametersSchema: {
        type: "object",
        required: ["adAccountId"],
        properties: {
          adAccountId: { type: "string", description: "Ad account ID" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    // ── Phase 12: Forecasting & Scenarios ──────────────────────────
    {
      actionType: "digital-ads.forecast.budget_scenario",
      name: "Budget Scenario",
      description: "Model budget scenarios using diminishing returns to project CPA at different spend levels.",
      parametersSchema: {
        type: "object",
        required: ["currentSpend", "currentConversions", "currentCPA", "scenarioBudgets"],
        properties: {
          currentSpend: { type: "number", description: "Current daily/period spend" },
          currentConversions: { type: "number", description: "Current conversions" },
          currentCPA: { type: "number", description: "Current CPA" },
          scenarioBudgets: { type: "array", items: { type: "number" }, description: "Array of budget levels to model" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.forecast.diminishing_returns",
      name: "Diminishing Returns Analysis",
      description: "Analyze spend vs conversions data to find optimal spend point and saturation.",
      parametersSchema: {
        type: "object",
        required: ["dataPoints"],
        properties: {
          dataPoints: {
            type: "array",
            items: {
              type: "object",
              required: ["spend", "conversions"],
              properties: {
                spend: { type: "number" },
                conversions: { type: "number" },
              },
            },
            description: "Array of {spend, conversions} data points",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    // ── Phase 12b: Annual Planning ────────────────────────────────
    {
      actionType: "digital-ads.plan.annual",
      name: "Annual Plan",
      description:
        "Create a 12-month annual plan with quarterly roll-ups, seasonal budget distribution, monthly CPA projections, strategic themes, and risk assessment.",
      parametersSchema: {
        type: "object",
        required: [
          "totalAnnualBudget",
          "vertical",
          "businessGoal",
          "currentMonthlyCPA",
          "currentMonthlyConversions",
          "currentMonthlySpend",
        ],
        properties: {
          totalAnnualBudget: { type: "number", description: "Total annual budget in dollars" },
          vertical: {
            type: "string",
            enum: ["commerce", "leadgen", "brand"],
            description: "Business vertical",
          },
          businessGoal: { type: "string", description: "High-level business goal" },
          currentMonthlyCPA: { type: "number", description: "Current monthly CPA" },
          currentMonthlyConversions: {
            type: "number",
            description: "Current monthly conversions",
          },
          currentMonthlySpend: { type: "number", description: "Current monthly spend" },
          currentROAS: { type: "number", description: "Current ROAS (optional)" },
          targetAnnualGrowth: {
            type: "number",
            description: "Target annual growth rate, e.g. 0.20 for 20%",
          },
          targetCPA: { type: "number", description: "Target CPA" },
          historicalMonthlyData: {
            type: "array",
            items: {
              type: "object",
              properties: {
                month: { type: "number" },
                spend: { type: "number" },
                conversions: { type: "number" },
                revenue: { type: "number" },
              },
            },
            description: "Historical monthly data for custom seasonality weights",
          },
          frontLoadBudget: {
            type: "boolean",
            description: "Whether to front-load budget in H1",
          },
          aggressiveScaling: {
            type: "boolean",
            description: "Whether to take more risk for growth",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.plan.quarterly",
      name: "Quarterly Plan",
      description:
        "Get a detailed plan for a single quarter, including monthly budgets, CPA projections, strategic theme, and key milestones.",
      parametersSchema: {
        type: "object",
        required: [
          "quarter",
          "totalAnnualBudget",
          "vertical",
          "businessGoal",
          "currentMonthlyCPA",
          "currentMonthlyConversions",
          "currentMonthlySpend",
        ],
        properties: {
          quarter: {
            type: "string",
            enum: ["Q1", "Q2", "Q3", "Q4"],
            description: "Which quarter to return",
          },
          totalAnnualBudget: { type: "number", description: "Total annual budget in dollars" },
          vertical: {
            type: "string",
            enum: ["commerce", "leadgen", "brand"],
            description: "Business vertical",
          },
          businessGoal: { type: "string", description: "High-level business goal" },
          currentMonthlyCPA: { type: "number", description: "Current monthly CPA" },
          currentMonthlyConversions: {
            type: "number",
            description: "Current monthly conversions",
          },
          currentMonthlySpend: { type: "number", description: "Current monthly spend" },
          currentROAS: { type: "number", description: "Current ROAS (optional)" },
          targetAnnualGrowth: {
            type: "number",
            description: "Target annual growth rate, e.g. 0.20 for 20%",
          },
          targetCPA: { type: "number", description: "Target CPA" },
          historicalMonthlyData: {
            type: "array",
            items: {
              type: "object",
              properties: {
                month: { type: "number" },
                spend: { type: "number" },
                conversions: { type: "number" },
                revenue: { type: "number" },
              },
            },
            description: "Historical monthly data for custom seasonality weights",
          },
          frontLoadBudget: {
            type: "boolean",
            description: "Whether to front-load budget in H1",
          },
          aggressiveScaling: {
            type: "boolean",
            description: "Whether to take more risk for growth",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    // ── Phase 13: Catalog Health ───────────────────────────────────
    {
      actionType: "digital-ads.catalog.health",
      name: "Catalog Health Check",
      description: "Check product catalog health — review statuses, error rates, and diagnostics.",
      parametersSchema: {
        type: "object",
        required: ["catalogId"],
        properties: {
          catalogId: { type: "string", description: "Product catalog ID" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.catalog.product_sets",
      name: "Manage Product Sets",
      description: "List or create product sets within a catalog for dynamic ads.",
      parametersSchema: {
        type: "object",
        required: ["catalogId"],
        properties: {
          catalogId: { type: "string", description: "Product catalog ID" },
          action: { type: "string", enum: ["list", "create"], description: "Operation to perform (default: list)" },
          name: { type: "string", description: "Product set name (required for create)" },
          filter: { type: "object", description: "Product set filter rules (required for create)" },
        },
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    // ── Phase 14: Notification Delivery ──────────────────────────────
    {
      actionType: "digital-ads.alert.configure_notifications",
      name: "Configure Notification Channels",
      description: "Set up notification channels (webhook, Slack, email) for automated alert delivery.",
      parametersSchema: {
        type: "object",
        required: ["channels"],
        properties: {
          channels: {
            type: "array",
            items: {
              type: "object",
              required: ["type"],
              properties: {
                type: { type: "string", enum: ["webhook", "slack", "email"], description: "Channel type" },
                url: { type: "string", description: "Webhook URL (for webhook type)" },
                webhookUrl: { type: "string", description: "Slack incoming webhook URL (for slack type)" },
                channel: { type: "string", description: "Slack channel override" },
                smtpHost: { type: "string", description: "SMTP host (for email type)" },
                smtpPort: { type: "number", description: "SMTP port (for email type)" },
                from: { type: "string", description: "Sender email (for email type)" },
                to: { type: "array", items: { type: "string" }, description: "Recipient emails (for email type)" },
              },
            },
            description: "Array of notification channel configurations",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.alert.send_notifications",
      name: "Send Alert Notifications",
      description: "Dispatch alert notifications to all configured channels. Accepts anomaly, budget, or policy alert data.",
      parametersSchema: {
        type: "object",
        required: ["accountId"],
        properties: {
          accountId: { type: "string", description: "Ad account ID" },
          alertType: { type: "string", enum: ["anomaly", "budget_forecast", "policy_violation"], description: "Filter to specific alert type" },
          anomalies: { type: "array", description: "Anomaly results to dispatch" },
          forecasts: { type: "array", description: "Budget forecast results to dispatch" },
          scanResult: { type: "object", description: "Policy scan result to dispatch" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    // ── Phase 14: Auction Insights ───────────────────────────────────
    {
      actionType: "digital-ads.auction.insights",
      name: "Auction Insights",
      description: "Fetch competitive auction insights showing impression share, overlap rate, outbid rate, and position data against competitors.",
      parametersSchema: {
        type: "object",
        required: ["entityId"],
        properties: {
          entityId: { type: "string", description: "Campaign, ad set, or account ID" },
          entityLevel: { type: "string", enum: ["campaign", "adset", "account"], description: "Entity level (default: campaign)" },
          datePreset: { type: "string", description: "Date preset (e.g. last_7d, last_30d)" },
          since: { type: "string", description: "Start date (YYYY-MM-DD)" },
          until: { type: "string", description: "End date (YYYY-MM-DD)" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    // ── Phase 15: Creative Testing Queue ─────────────────────────────
    {
      actionType: "digital-ads.creative.power_calculate",
      name: "Power Calculator",
      description: "Calculate required sample size, estimated duration, and budget for a creative test given baseline conversion rate and minimum detectable effect.",
      parametersSchema: {
        type: "object",
        required: ["baselineRate", "minimumDetectableEffect"],
        properties: {
          baselineRate: { type: "number", description: "Baseline conversion rate (e.g. 0.02 for 2%)" },
          minimumDetectableEffect: { type: "number", description: "Relative lift to detect (e.g. 0.10 for 10%)" },
          significanceLevel: { type: "number", description: "Alpha level (default: 0.05)" },
          power: { type: "number", description: "Statistical power (default: 0.80)" },
          numVariants: { type: "number", description: "Number of variants including control (default: 2)" },
          estimatedDailyTraffic: { type: "number", description: "Estimated daily impressions per variant (default: 1000)" },
          estimatedCPM: { type: "number", description: "Estimated CPM in dollars (default: 10)" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.creative.test_queue",
      name: "List Creative Tests & Calendar",
      description: "List all creative tests and generate a week-by-week test calendar showing available/occupied slots.",
      parametersSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["queued", "running", "concluded", "cancelled"], description: "Filter by test status" },
          calendarWeeks: { type: "number", description: "Number of weeks to show in calendar (default: 8)" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.creative.test_evaluate",
      name: "Evaluate Creative Test",
      description: "Check a running creative test for statistical significance using chi-squared test with Wilson score confidence intervals.",
      parametersSchema: {
        type: "object",
        required: ["testId", "variantMetrics"],
        properties: {
          testId: { type: "string", description: "Test ID to evaluate" },
          variantMetrics: {
            type: "array",
            items: {
              type: "object",
              required: ["variantId", "impressions", "clicks", "conversions", "spend"],
              properties: {
                variantId: { type: "string" },
                impressions: { type: "number" },
                clicks: { type: "number" },
                conversions: { type: "number" },
                spend: { type: "number" },
              },
            },
            description: "Performance metrics for each variant",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.creative.test_create",
      name: "Queue Creative Test",
      description: "Add a new creative test to the testing queue with hypothesis, variants, and scheduling.",
      parametersSchema: {
        type: "object",
        required: ["name", "hypothesis", "variants", "primaryMetric"],
        properties: {
          name: { type: "string", description: "Test name" },
          hypothesis: { type: "string", description: "What you're testing and why" },
          variants: {
            type: "array",
            items: {
              type: "object",
              required: ["variantId", "description"],
              properties: {
                variantId: { type: "string" },
                description: { type: "string" },
                adId: { type: "string", description: "Optional Meta ad ID" },
              },
            },
            description: "Test variants (minimum 2)",
          },
          primaryMetric: { type: "string", enum: ["cpa", "ctr", "conversion_rate", "roas"], description: "Primary metric to optimize" },
          scheduledStartDate: { type: "string", description: "When to start the test (ISO date)" },
          minBudgetPerVariant: { type: "number", description: "Minimum daily budget per variant" },
        },
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "digital-ads.creative.test_conclude",
      name: "Conclude Creative Test",
      description: "Mark a creative test as concluded and record the winner.",
      parametersSchema: {
        type: "object",
        required: ["testId"],
        properties: {
          testId: { type: "string", description: "Test ID to conclude" },
        },
      },
      baseRiskCategory: "medium",
      reversible: false,
    },
    // --- Phase 16: Account Memory ---
    {
      actionType: "digital-ads.memory.insights",
      name: "Get Account Memory Insights",
      description:
        "Retrieve aggregated insights from historical optimization records for an account. Shows success rates, average impact, and recommendations per action type.",
      parametersSchema: {
        type: "object",
        required: ["accountId"],
        properties: {
          accountId: {
            type: "string",
            description: "The ad account ID to retrieve insights for",
          },
        },
      },
      baseRiskCategory: "none",
      reversible: true,
    },
    {
      actionType: "digital-ads.memory.list",
      name: "List Optimization Records",
      description:
        "List historical optimization records for an account with optional filtering by action type, entity, outcome status, and limit.",
      parametersSchema: {
        type: "object",
        required: ["accountId"],
        properties: {
          accountId: {
            type: "string",
            description: "The ad account ID",
          },
          actionType: {
            type: "string",
            description: "Filter by optimization action type (e.g. 'budget_increase', 'bid_strategy_change')",
          },
          entityId: {
            type: "string",
            description: "Filter by entity ID",
          },
          status: {
            type: "string",
            enum: ["positive", "negative", "neutral", "pending"],
            description: "Filter by outcome status",
          },
          limit: {
            type: "number",
            description: "Maximum number of records to return (default: all)",
          },
        },
      },
      baseRiskCategory: "none",
      reversible: true,
    },
    {
      actionType: "digital-ads.memory.recommend",
      name: "Get Memory-Based Recommendation",
      description:
        "Get a recommendation for a proposed optimization action based on historical performance data. Considers account-wide and entity-specific history, plus recent trends.",
      parametersSchema: {
        type: "object",
        required: ["accountId", "proposedAction"],
        properties: {
          accountId: {
            type: "string",
            description: "The ad account ID",
          },
          proposedAction: {
            type: "string",
            description: "The optimization action type being considered (e.g. 'budget_increase', 'creative_rotation')",
          },
          entityId: {
            type: "string",
            description: "Optional entity ID for entity-specific history lookup",
          },
        },
      },
      baseRiskCategory: "none",
      reversible: true,
    },
    {
      actionType: "digital-ads.memory.record",
      name: "Record Optimization Action",
      description:
        "Record a new optimization action with before-metrics. Creates a persistent record that can later be updated with outcome data.",
      parametersSchema: {
        type: "object",
        required: ["accountId", "actionType", "entityId", "entityType", "changeDescription", "parameters", "metricsBefore"],
        properties: {
          accountId: {
            type: "string",
            description: "The ad account ID",
          },
          actionType: {
            type: "string",
            description: "The optimization action type (e.g. 'budget_increase', 'bid_strategy_change')",
          },
          entityId: {
            type: "string",
            description: "The entity that was modified",
          },
          entityType: {
            type: "string",
            enum: ["campaign", "adset", "ad", "account"],
            description: "The type of entity modified",
          },
          changeDescription: {
            type: "string",
            description: "Human-readable description of the change",
          },
          parameters: {
            type: "object",
            description: "Parameters of the change",
          },
          metricsBefore: {
            type: "object",
            description: "Metrics before the change (spend, conversions, cpa, roas, ctr, impressions)",
          },
          triggeringFinding: {
            type: "string",
            description: "The finding that triggered this action (if any)",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: false,
    },
    {
      actionType: "digital-ads.memory.record_outcome",
      name: "Record Optimization Outcome",
      description:
        "Update an existing optimization record with post-change metrics. Automatically computes the outcome (positive/negative/neutral) based on metric deltas.",
      parametersSchema: {
        type: "object",
        required: ["recordId", "metricsAfter"],
        properties: {
          recordId: {
            type: "string",
            description: "The optimization record ID to update",
          },
          metricsAfter: {
            type: "object",
            required: ["daysAfterChange"],
            properties: {
              spend: { type: "number" },
              conversions: { type: "number" },
              cpa: { type: "number" },
              roas: { type: "number" },
              ctr: { type: "number" },
              impressions: { type: "number" },
              daysAfterChange: {
                type: "number",
                description: "Number of days after the change that these metrics were captured",
              },
            },
            description: "Metrics after the change",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: false,
    },
    {
      actionType: "digital-ads.memory.export",
      name: "Export Account Memory",
      description:
        "Export all optimization records for an account as a JSON string. Used for persistence by the orchestrator layer.",
      parametersSchema: {
        type: "object",
        required: ["accountId"],
        properties: {
          accountId: {
            type: "string",
            description: "The ad account ID to export memory for",
          },
        },
      },
      baseRiskCategory: "none",
      reversible: true,
    },
    {
      actionType: "digital-ads.memory.import",
      name: "Import Account Memory",
      description:
        "Import previously exported optimization records. Deduplicates by record ID — existing records are not overwritten.",
      parametersSchema: {
        type: "object",
        required: ["data"],
        properties: {
          data: {
            type: "string",
            description: "JSON string of exported memory data",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: false,
    },
    // ── Cross-Platform Conversion Deduplication ──────────────────────
    {
      actionType: "digital-ads.deduplication.analyze",
      name: "Analyze Cross-Platform Deduplication",
      description:
        "Estimate deduplicated conversion totals across Meta, Google, and TikTok using probabilistic overlap estimation. Computes overcounting factor, blended CPA/ROAS, and per-platform adjusted shares. Accepts pre-fetched daily conversion data per platform.",
      parametersSchema: {
        type: "object",
        required: ["platforms"],
        properties: {
          platforms: {
            type: "array",
            description: "Per-platform conversion data (at least 2 required)",
            items: {
              type: "object",
              required: ["platform", "dailyData", "attributionWindow", "attributionModel"],
              properties: {
                platform: {
                  type: "string",
                  enum: ["meta", "google", "tiktok"],
                  description: "Ad platform",
                },
                dailyData: {
                  type: "array",
                  description: "Daily conversion data points",
                  items: {
                    type: "object",
                    required: ["date", "conversions", "revenue", "spend", "impressions", "clicks"],
                    properties: {
                      date: { type: "string", description: "Date (YYYY-MM-DD)" },
                      conversions: { type: "number" },
                      revenue: { type: "number" },
                      spend: { type: "number" },
                      impressions: { type: "number" },
                      clicks: { type: "number" },
                    },
                  },
                },
                attributionWindow: {
                  type: "string",
                  enum: ["1d_click", "7d_click", "28d_click", "1d_view", "7d_click_1d_view"],
                  description: "Attribution window used by this platform",
                },
                attributionModel: {
                  type: "string",
                  enum: ["last_click", "data_driven", "first_click", "linear", "time_decay"],
                  description: "Attribution model used by this platform",
                },
              },
            },
          },
          config: {
            type: "object",
            description: "Optional overlap estimation configuration",
            properties: {
              method: {
                type: "string",
                enum: ["statistical", "time_decay", "hybrid"],
                description: "Overlap estimation method (default: hybrid)",
              },
              defaultOverlapRates: {
                type: "object",
                description: "Custom default overlap rates by platform pair (e.g. { 'meta+google': 0.20 })",
              },
              minDaysForStatistical: {
                type: "number",
                description: "Minimum days of data for statistical method (default: 14)",
              },
            },
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.deduplication.estimate_overlap",
      name: "Estimate Pairwise Platform Overlap",
      description:
        "Estimate the conversion overlap between two specific ad platforms. Returns overlap rate, estimated overlapping conversions, confidence level, and methodology used.",
      parametersSchema: {
        type: "object",
        required: ["platform1", "platform2"],
        properties: {
          platform1: {
            type: "object",
            description: "First platform's conversion data (PlatformConversionData)",
          },
          platform2: {
            type: "object",
            description: "Second platform's conversion data (PlatformConversionData)",
          },
          method: {
            type: "string",
            enum: ["statistical", "time_decay", "hybrid"],
            description: "Overlap estimation method (default: hybrid)",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },

    // ── Geo-Holdout Experiments ──────────────────────────────────────
    {
      actionType: "digital-ads.geo_experiment.design",
      name: "Design Geo Experiment",
      description:
        "Design a geographic holdout experiment with matched-pair region assignment for true incrementality measurement. Returns balanced treatment/holdout groups.",
      parametersSchema: {
        type: "object",
        required: ["name", "hypothesis", "availableRegions", "testDays", "treatmentBudgetPerDay"],
        properties: {
          name: { type: "string", description: "Experiment name" },
          hypothesis: { type: "string", description: "What you expect to prove" },
          availableRegions: {
            type: "array",
            description: "Regions available for the experiment (min 2)",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                type: { type: "string", enum: ["dma", "state", "country", "custom"] },
                population: { type: "number" },
                historicalSpend: { type: "number" },
                historicalConversions: { type: "number" },
              },
            },
          },
          primaryMetric: {
            type: "string",
            enum: ["conversions", "revenue", "store_visits"],
            description: "Primary metric to measure incrementality (default: conversions)",
          },
          testDays: { type: "number", description: "Duration of the test period in days" },
          preTestDays: { type: "number", description: "Baseline measurement period in days (default: 14)" },
          cooldownDays: { type: "number", description: "Post-test observation period in days (default: 7)" },
          treatmentBudgetPerDay: { type: "number", description: "Daily budget for treatment regions" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.geo_experiment.analyze",
      name: "Analyze Geo Experiment",
      description:
        "Analyze a completed geo-holdout experiment using difference-in-differences. Computes incremental lift, statistical significance, incremental CPA, and incremental ROAS.",
      parametersSchema: {
        type: "object",
        required: ["experimentId", "regionMetrics"],
        properties: {
          experimentId: { type: "string", description: "Geo experiment ID to analyze" },
          regionMetrics: {
            type: "array",
            description: "Per-region metrics for pre-test, test, and post-test periods",
            items: {
              type: "object",
              required: ["regionId", "preTestConversions", "preTestRevenue", "testConversions", "testRevenue"],
              properties: {
                regionId: { type: "string" },
                preTestConversions: { type: "number" },
                preTestRevenue: { type: "number" },
                testConversions: { type: "number" },
                testRevenue: { type: "number" },
                postTestConversions: { type: "number" },
                postTestRevenue: { type: "number" },
              },
            },
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.geo_experiment.power",
      name: "Geo Experiment Power Analysis",
      description:
        "Calculate minimum test duration for a geo-holdout experiment using difference-in-differences power analysis. Accounts for between-region variance.",
      parametersSchema: {
        type: "object",
        required: ["baselineConversionRatePerRegion", "minimumDetectableLift", "numberOfRegions"],
        properties: {
          baselineConversionRatePerRegion: {
            type: "number",
            description: "Average daily conversions per region at baseline",
          },
          minimumDetectableLift: {
            type: "number",
            description: "Minimum relative lift to detect (e.g. 0.05 for 5%)",
          },
          numberOfRegions: {
            type: "number",
            description: "Total number of regions available (split between treatment and holdout)",
          },
          significanceLevel: {
            type: "number",
            description: "Statistical significance level (default: 0.05)",
          },
          power: {
            type: "number",
            description: "Statistical power (default: 0.80)",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.geo_experiment.create",
      name: "Create Geo Experiment",
      description:
        "Create and start a geographic holdout experiment. Designs matched-pair region assignment and transitions to running state.",
      parametersSchema: {
        type: "object",
        required: ["name", "hypothesis", "availableRegions", "testDays", "treatmentBudgetPerDay"],
        properties: {
          name: { type: "string", description: "Experiment name" },
          hypothesis: { type: "string", description: "What you expect to prove" },
          availableRegions: {
            type: "array",
            description: "Regions available for the experiment (min 2)",
          },
          primaryMetric: {
            type: "string",
            enum: ["conversions", "revenue", "store_visits"],
            description: "Primary metric (default: conversions)",
          },
          testDays: { type: "number", description: "Test period duration in days" },
          preTestDays: { type: "number", description: "Baseline period in days (default: 14)" },
          cooldownDays: { type: "number", description: "Post-test period in days (default: 7)" },
          treatmentBudgetPerDay: { type: "number", description: "Daily budget for treatment regions" },
        },
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "digital-ads.geo_experiment.conclude",
      name: "Conclude Geo Experiment",
      description: "Mark a running geo-holdout experiment as concluded.",
      parametersSchema: {
        type: "object",
        required: ["experimentId"],
        properties: {
          experimentId: { type: "string", description: "Geo experiment ID to conclude" },
        },
      },
      baseRiskCategory: "medium",
      reversible: false,
    },
    // --- Custom KPI actions ---
    {
      actionType: "digital-ads.kpi.list",
      name: "List Custom KPIs",
      description:
        "List all registered custom KPI definitions and available preset KPI templates. Returns both user-defined KPIs and built-in preset definitions (Blended CPA, ROAS, CPM Efficiency, etc.).",
      parametersSchema: {
        type: "object",
        properties: {},
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.kpi.compute",
      name: "Compute Custom KPIs",
      description:
        "Compute one or all registered custom KPIs against a provided metrics map. If kpiId is provided, computes only that KPI; otherwise computes all registered KPIs. Returns computed values with formatting, threshold status, and target percentage.",
      parametersSchema: {
        type: "object",
        required: ["metrics"],
        properties: {
          kpiId: {
            type: "string",
            description: "Optional KPI ID to compute a single KPI. If omitted, all registered KPIs are computed.",
          },
          metrics: {
            type: "object",
            description:
              "Map of metric names to numeric values (e.g. { spend: 1000, conversions: 50, revenue: 5000 })",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.kpi.register",
      name: "Register Custom KPI",
      description:
        "Define and register a new custom KPI with a formula type (sum, average, weighted_average, ratio, or custom expression), formatting, and optional threshold alerts. Custom expressions support arithmetic operators (+, -, *, /) with metric names as variables.",
      parametersSchema: {
        type: "object",
        required: ["name", "description", "type", "format", "higherIsBetter"],
        properties: {
          name: { type: "string", description: "Human-readable KPI name" },
          description: { type: "string", description: "What this KPI measures" },
          type: {
            type: "string",
            enum: ["sum", "average", "weighted_average", "ratio", "custom"],
            description: "Formula type for computing this KPI",
          },
          numerator: { type: "string", description: "For ratio type: numerator metric key" },
          denominator: { type: "string", description: "For ratio type: denominator metric key" },
          metrics: {
            type: "array",
            items: { type: "string" },
            description: "For sum/average/weighted_average: list of metric keys to aggregate",
          },
          weightMetric: { type: "string", description: "For weighted_average: weight metric key" },
          expression: {
            type: "string",
            description: "For custom type: arithmetic expression using metric names as variables (e.g. 'revenue / spend', '(clicks + video_views) / impressions')",
          },
          format: {
            type: "string",
            enum: ["number", "currency", "percentage", "multiplier"],
            description: "How to format the computed value",
          },
          higherIsBetter: {
            type: "boolean",
            description: "Whether higher values are better (used for threshold evaluation and ranking)",
          },
          target: { type: "number", description: "Optional target value for threshold alerts" },
          warningThreshold: { type: "number", description: "Value that triggers a warning status" },
          criticalThreshold: { type: "number", description: "Value that triggers a critical status" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.kpi.remove",
      name: "Remove Custom KPI",
      description: "Remove a previously registered custom KPI definition by its ID.",
      parametersSchema: {
        type: "object",
        required: ["kpiId"],
        properties: {
          kpiId: { type: "string", description: "The ID of the KPI to remove" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    // ── Multi-Touch Attribution ────────────────────────────────────────
    {
      actionType: "digital-ads.attribution.multi_touch",
      name: "Multi-Touch Attribution",
      description:
        "Apply a multi-touch attribution model (last_click, first_click, linear, time_decay, position_based, or data_driven) to aggregate touchpoint data. Returns per-channel attributed conversions, revenue, CPA, ROAS, channel roles, and actionable recommendations.",
      parametersSchema: {
        type: "object",
        required: ["touchpoints", "paths", "model"],
        properties: {
          touchpoints: {
            type: "array",
            description: "Array of touchpoint objects with channel info, position distribution, spend, and last-click conversions",
          },
          paths: {
            type: "array",
            description: "Array of conversion path objects with ordered touchpoint channel IDs, conversions, revenue, and avg days to convert",
          },
          model: {
            type: "string",
            enum: ["last_click", "first_click", "linear", "time_decay", "position_based", "data_driven"],
            description: "Attribution model to apply",
          },
          decayHalfLife: {
            type: "number",
            description: "Half-life in days for time_decay model (default: 7)",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.attribution.compare_models",
      name: "Compare Attribution Models",
      description:
        "Run all six attribution models (last_click, first_click, linear, time_decay, position_based, data_driven) and produce a comparison showing how each model values each channel differently. Highlights channels most affected by model choice.",
      parametersSchema: {
        type: "object",
        required: ["touchpoints", "paths"],
        properties: {
          touchpoints: {
            type: "array",
            description: "Array of touchpoint objects with channel info, position distribution, spend, and last-click conversions",
          },
          paths: {
            type: "array",
            description: "Array of conversion path objects with ordered touchpoint channel IDs, conversions, revenue, and avg days to convert",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.attribution.channel_roles",
      name: "Identify Channel Roles",
      description:
        "Analyze each channel's position distribution to determine if it primarily acts as an introducer (top-of-funnel awareness), influencer (mid-funnel consideration), closer (bottom-funnel conversion), or independent (single-touch journeys).",
      parametersSchema: {
        type: "object",
        required: ["touchpoints"],
        properties: {
          touchpoints: {
            type: "array",
            description: "Array of touchpoint objects with channel info and position distribution",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    // --- Seasonality actions ---
    {
      actionType: "digital-ads.seasonal.calendar",
      name: "Seasonal Calendar",
      description:
        "Get a 12-month seasonal calendar for a given vertical and region. Returns events, CPM multipliers, competition levels, and budget recommendations per month. Use this for annual planning and budget allocation.",
      parametersSchema: {
        type: "object",
        required: ["vertical"],
        properties: {
          vertical: {
            type: "string",
            enum: ["commerce", "leadgen", "brand"],
            description: "Business vertical for seasonal analysis",
          },
          region: {
            type: "string",
            enum: ["global", "us", "uk", "eu", "apac", "latam", "mena"],
            description: "Region for region-specific events (default: global)",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.seasonal.events",
      name: "Seasonal Events",
      description:
        "Query seasonal events filtered by region, vertical, month, and/or category. Returns matching events sorted by CPM impact (highest first) with recommendations.",
      parametersSchema: {
        type: "object",
        properties: {
          region: {
            type: "string",
            enum: ["global", "us", "uk", "eu", "apac", "latam", "mena"],
            description: "Filter by region",
          },
          vertical: {
            type: "string",
            enum: ["commerce", "leadgen", "brand"],
            description: "Filter by business vertical",
          },
          month: {
            type: "number",
            description: "Filter by month (1-12)",
          },
          category: {
            type: "string",
            enum: ["retail", "cultural", "sports", "industry", "platform"],
            description: "Filter by event category",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.seasonal.add_event",
      name: "Add Custom Seasonal Event",
      description:
        "Register a custom seasonal event to the calendar. Custom events are merged with built-in events for all seasonal queries. Use this for industry-specific or client-specific events not in the default calendar.",
      parametersSchema: {
        type: "object",
        required: ["name", "startMMDD", "endMMDD", "cpmThresholdMultiplier", "cpaThresholdMultiplier", "category", "region", "verticals"],
        properties: {
          name: { type: "string", description: "Human-readable event name" },
          startMMDD: { type: "string", description: "Start date in MM-DD format (inclusive)" },
          endMMDD: { type: "string", description: "End date in MM-DD format (inclusive)" },
          cpmThresholdMultiplier: { type: "number", description: "CPM threshold multiplier (e.g. 1.2 = 20% increase expected)" },
          cpaThresholdMultiplier: { type: "number", description: "CPA threshold multiplier" },
          category: { type: "string", enum: ["retail", "cultural", "sports", "industry", "platform"], description: "Event category" },
          region: { type: "string", enum: ["global", "us", "uk", "eu", "apac", "latam", "mena"], description: "Event region" },
          verticals: { type: "array", description: "Applicable verticals (commerce, leadgen, brand, all)" },
          impact: { type: "string", description: "Description of the event's impact on ad performance" },
          recommendedActions: { type: "array", description: "List of recommended actions during this event" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    // ── LTV Optimization ──────────────────────────────────────────────
    {
      actionType: "digital-ads.ltv.project",
      name: "Project Customer LTV",
      description:
        "Project lifetime value for a customer cohort by fitting a curve (log, power, or linear) to revenue-over-time data. Returns projected 90-day and 365-day LTV, LTV:CAC ratio, payback period, confidence level, and curve parameters.",
      parametersSchema: {
        type: "object",
        required: ["cohort"],
        properties: {
          cohort: {
            type: "object",
            description: "Customer cohort data including acquisition cost, revenue timeline (day0 through day365), retention rates, and purchase metrics",
            required: ["cohortId", "acquisitionDate", "customerCount", "totalAcquisitionCost", "costPerAcquisition", "revenue", "retention", "avgOrderCount", "avgOrderValue"],
            properties: {
              cohortId: { type: "string", description: "Unique cohort identifier" },
              acquisitionCampaignId: { type: "string", description: "Acquisition source campaign ID" },
              acquisitionAdSetId: { type: "string", description: "Acquisition source ad set ID" },
              acquisitionDate: { type: "string", description: "Cohort acquisition date (YYYY-MM-DD)" },
              customerCount: { type: "number", description: "Number of customers in the cohort" },
              totalAcquisitionCost: { type: "number", description: "Total acquisition cost for the cohort" },
              costPerAcquisition: { type: "number", description: "Cost per acquisition (CPA)" },
              revenue: {
                type: "object",
                description: "Cumulative revenue at each time point",
                properties: {
                  day0: { type: "number" },
                  day7: { type: "number" },
                  day14: { type: "number" },
                  day30: { type: "number" },
                  day60: { type: "number" },
                  day90: { type: "number" },
                  day180: { type: "number" },
                  day365: { type: "number" },
                },
              },
              retention: {
                type: "object",
                description: "Retention rates at each time point (0-1)",
                properties: {
                  day7: { type: "number" },
                  day14: { type: "number" },
                  day30: { type: "number" },
                  day60: { type: "number" },
                  day90: { type: "number" },
                },
              },
              avgOrderCount: { type: "number", description: "Average number of orders per customer" },
              avgOrderValue: { type: "number", description: "Average order value" },
              segment: { type: "string", description: "Optional segment label for grouping" },
            },
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.ltv.optimize",
      name: "Optimize by Cohort LTV",
      description:
        "Analyze multiple customer cohorts and generate campaign-level LTV optimization recommendations. Projects LTV for each cohort, computes LTV:CAC ratios, and recommends scaling, maintaining, reducing, or pausing each campaign. Includes segment-level insights and LTV distribution.",
      parametersSchema: {
        type: "object",
        required: ["cohorts"],
        properties: {
          cohorts: {
            type: "array",
            description: "Array of customer cohort data objects",
            items: {
              type: "object",
              description: "CustomerCohort object with acquisition cost, revenue timeline, retention rates, and purchase metrics",
            },
          },
          targetLTVtoCACRatio: {
            type: "number",
            description: "Target LTV:CAC ratio benchmark (default: 3.0). Campaigns above this are healthy; below need attention.",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "digital-ads.ltv.allocate",
      name: "Allocate Budget by LTV",
      description:
        "Allocate campaign budgets proportionally to their LTV:CAC ratio. Maps campaigns to customer cohorts, projects LTV per campaign, and redistributes budget toward higher-LTV campaigns. Changes are capped at 30% per campaign with a $5 minimum budget.",
      parametersSchema: {
        type: "object",
        required: ["campaigns", "cohorts"],
        properties: {
          campaigns: {
            type: "array",
            description: "Campaign data with current budget and CPA",
            items: {
              type: "object",
              required: ["campaignId", "campaignName", "dailyBudget", "cpa"],
              properties: {
                campaignId: { type: "string", description: "Campaign ID (must match cohort acquisitionCampaignId)" },
                campaignName: { type: "string", description: "Campaign name" },
                dailyBudget: { type: "number", description: "Current daily budget" },
                cpa: { type: "number", description: "Current cost per acquisition" },
              },
            },
          },
          cohorts: {
            type: "array",
            description: "Customer cohort data (linked to campaigns via acquisitionCampaignId)",
            items: {
              type: "object",
              description: "CustomerCohort object",
            },
          },
          totalBudget: {
            type: "number",
            description: "Optional total budget constraint. If omitted, uses sum of current campaign budgets.",
          },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
  ],
};
