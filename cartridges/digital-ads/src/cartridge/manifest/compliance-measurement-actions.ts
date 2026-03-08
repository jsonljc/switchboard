// Compliance and measurement action definitions

import type { ActionDefinition } from "@switchboard/schemas";

export const complianceMeasurementActions: readonly ActionDefinition[] = [
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
    description:
      "Run a comprehensive compliance audit — ad review, special categories, pixel health, CAPI, and overall compliance score.",
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
        action: {
          type: "string",
          enum: ["list", "create"],
          description: "Action to perform (default: list)",
        },
        name: { type: "string", description: "Blocklist name (required for create)" },
        publishers: {
          type: "array",
          items: { type: "string" },
          description: "Publishers to block (required for create)",
        },
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
    description:
      "Compare conversions across attribution windows (1d click, 7d click, 1d view) to understand attribution sensitivity.",
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
    description:
      "Export daily-grain data formatted for Marketing Mix Modeling tools (Robyn, Meridian).",
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
        format: {
          type: "string",
          enum: ["csv", "json"],
          description: "Export format (default: json)",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
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
          description:
            "Array of touchpoint objects with channel info, position distribution, spend, and last-click conversions",
        },
        paths: {
          type: "array",
          description:
            "Array of conversion path objects with ordered touchpoint channel IDs, conversions, revenue, and avg days to convert",
        },
        model: {
          type: "string",
          enum: [
            "last_click",
            "first_click",
            "linear",
            "time_decay",
            "position_based",
            "data_driven",
          ],
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
          description:
            "Array of touchpoint objects with channel info, position distribution, spend, and last-click conversions",
        },
        paths: {
          type: "array",
          description:
            "Array of conversion path objects with ordered touchpoint channel IDs, conversions, revenue, and avg days to convert",
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
];
