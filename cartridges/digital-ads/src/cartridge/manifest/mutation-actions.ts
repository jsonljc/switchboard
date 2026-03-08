// Campaign, ad set, and ad mutation action definitions

import type { ActionDefinition } from "@switchboard/schemas";

export const mutationActions: readonly ActionDefinition[] = [
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
  {
    actionType: "digital-ads.campaign.setup_guided",
    name: "Guided Campaign Setup",
    description:
      "Multi-step guided campaign creation — campaign + ad set + ad with best practices.",
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
];
