// ---------------------------------------------------------------------------
// Digital Ads Cartridge Manifest
// ---------------------------------------------------------------------------
// Declares 13 actions: 6 read (diagnostics) + 7 write (campaign management).
// ---------------------------------------------------------------------------

import type { CartridgeManifest } from "./types.js";

export const DIGITAL_ADS_MANIFEST: CartridgeManifest = {
  id: "digital-ads",
  name: "Digital Ads",
  version: "1.0.0",
  description:
    "Multi-platform ad performance diagnostics and campaign management. Analyzes funnel metrics across Meta, Google, and TikTok, and manages campaigns, ad sets, budgets, and targeting.",
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
            description:
              'The ad account or entity ID (e.g. "act_123456789")',
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
            description:
              "Number of days per comparison period (default: 7 = WoW)",
          },
          referenceDate: {
            type: "string",
            description:
              'Reference date for current period end (default: yesterday). Format: "YYYY-MM-DD"',
          },
          enableStructuralAnalysis: {
            type: "boolean",
            description:
              "Enable ad set fragmentation and structure analysis (default: false)",
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
                description: 'Start date (YYYY-MM-DD)',
              },
              until: {
                type: "string",
                description: 'End date (YYYY-MM-DD)',
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
      description: "Modify targeting parameters for a Meta ad set. Irreversible — triggers learning phase reset.",
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
  ],
};
