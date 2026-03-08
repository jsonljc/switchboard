// Experiment and strategy action definitions

import type { ActionDefinition } from "@switchboard/schemas";

export const experimentStrategyActions: readonly ActionDefinition[] = [
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
];
