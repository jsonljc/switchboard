// Core diagnostic action definitions (connect, diagnose, snapshot, analyze, health)

import type { ActionDefinition } from "@switchboard/schemas";

export const coreActions: readonly ActionDefinition[] = [
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
          description: "Enable creative exhaustion and historical trend detection (default: false)",
        },
        targetROAS: {
          type: "number",
          description: "Target ROAS for efficiency comparison (e.g. 4.0 = $4 revenue per $1 spent)",
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
];
