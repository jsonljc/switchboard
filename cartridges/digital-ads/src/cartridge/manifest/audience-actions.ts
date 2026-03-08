// Audience management action definitions

import type { ActionDefinition } from "@switchboard/schemas";

export const audienceActions: readonly ActionDefinition[] = [
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
        source: {
          type: "string",
          enum: ["website", "customer_list", "engagement", "app", "offline"],
        },
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
];
