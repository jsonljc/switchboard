// Budget, bid, and optimization rule action definitions

import type { ActionDefinition } from "@switchboard/schemas";

export const budgetOptimizationActions: readonly ActionDefinition[] = [
  {
    actionType: "digital-ads.bid.update_strategy",
    name: "Update Bid Strategy",
    description: "Update the bid strategy and/or bid amount for an ad set.",
    parametersSchema: {
      type: "object",
      required: ["adSetId", "bidStrategy"],
      properties: {
        adSetId: { type: "string" },
        bidStrategy: {
          type: "string",
          enum: ["LOWEST_COST_WITHOUT_CAP", "LOWEST_COST_WITH_BID_CAP", "COST_CAP", "MINIMUM_ROAS"],
        },
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
        maxShiftPercent: {
          type: "number",
          description: "Max % shift per campaign (default: 30)",
        },
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
    actionType: "digital-ads.budget.increase",
    name: "Increase Campaign Budget",
    description: "Increase the daily budget of a campaign by a specified amount or percentage.",
    parametersSchema: {
      type: "object",
      required: ["campaignId", "platform"],
      properties: {
        campaignId: { type: "string" },
        platform: { type: "string", enum: ["meta", "google", "tiktok"] },
        increaseAmount: { type: "number", description: "Dollar amount to increase" },
        increasePercent: { type: "number", description: "Percentage to increase (alternative)" },
        reason: { type: "string" },
      },
    },
    baseRiskCategory: "high",
    reversible: true,
  },
  {
    actionType: "digital-ads.budget.decrease",
    name: "Decrease Campaign Budget",
    description: "Decrease the daily budget of a campaign by a specified amount or percentage.",
    parametersSchema: {
      type: "object",
      required: ["campaignId", "platform"],
      properties: {
        campaignId: { type: "string" },
        platform: { type: "string", enum: ["meta", "google", "tiktok"] },
        decreaseAmount: { type: "number", description: "Dollar amount to decrease" },
        decreasePercent: { type: "number", description: "Percentage to decrease (alternative)" },
        reason: { type: "string" },
      },
    },
    baseRiskCategory: "high",
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
];
