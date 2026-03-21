// Reporting and signal health action definitions

import type { ActionDefinition } from "@switchboard/schemas";

export const reportingSignalActions: readonly ActionDefinition[] = [
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
    description:
      "Generate a creative performance report with per-ad metrics and creative metadata.",
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
  {
    actionType: "digital-ads.signal.pixel.diagnose",
    name: "Diagnose Pixel",
    description:
      "Validate pixel events, check firing status, and identify missing standard events.",
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
  {
    actionType: "digital-ads.auction.insights",
    name: "Auction Insights",
    description:
      "Fetch competitive auction insights showing impression share, overlap rate, outbid rate, and position data against competitors.",
    parametersSchema: {
      type: "object",
      required: ["entityId"],
      properties: {
        entityId: { type: "string", description: "Campaign, ad set, or account ID" },
        entityLevel: {
          type: "string",
          enum: ["campaign", "adset", "account"],
          description: "Entity level (default: campaign)",
        },
        datePreset: { type: "string", description: "Date preset (e.g. last_7d, last_30d)" },
        since: { type: "string", description: "Start date (YYYY-MM-DD)" },
        until: { type: "string", description: "End date (YYYY-MM-DD)" },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.capi.dispatch",
    name: "Send Meta CAPI Conversion",
    description: "Send an offline conversion event to Meta Conversions API for optimization.",
    parametersSchema: {
      type: "object",
      required: ["eventName", "eventTime"],
      properties: {
        eventName: {
          type: "string",
          enum: ["Purchase", "Lead", "CompleteRegistration"],
        },
        eventTime: { type: "string", description: "ISO 8601 timestamp" },
        userData: {
          type: "object",
          description: "Hashed user data (email, phone, fbclid)",
        },
        customData: {
          type: "object",
          description: "Event value, currency, content IDs",
        },
      },
    },
    baseRiskCategory: "medium",
    reversible: false,
  },
  {
    actionType: "digital-ads.google.offline_conversion",
    name: "Send Google Offline Conversion",
    description: "Upload an offline conversion to Google Ads for optimization.",
    parametersSchema: {
      type: "object",
      required: ["conversionAction", "gclid", "conversionDateTime"],
      properties: {
        conversionAction: { type: "string" },
        gclid: { type: "string" },
        conversionDateTime: { type: "string" },
        conversionValue: { type: "number" },
        currencyCode: { type: "string" },
      },
    },
    baseRiskCategory: "medium",
    reversible: false,
  },
  {
    actionType: "digital-ads.tiktok.offline_conversion",
    name: "Send TikTok Offline Conversion",
    description: "Send an offline conversion event to TikTok Events API.",
    parametersSchema: {
      type: "object",
      required: ["eventName", "ttclid", "timestamp"],
      properties: {
        eventName: {
          type: "string",
          enum: ["CompletePayment", "SubmitForm"],
        },
        ttclid: { type: "string" },
        timestamp: { type: "string" },
        eventProperties: {
          type: "object",
          description: "Event value and currency",
        },
      },
    },
    baseRiskCategory: "medium",
    reversible: false,
  },
];
