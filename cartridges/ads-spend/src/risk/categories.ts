import type { RiskInput } from "@switchboard/schemas";
import type { CampaignInfo } from "../providers/meta-ads.js";

export function computeAdsBudgetRiskInput(
  params: { campaignId: string; newBudget: number },
  campaign: CampaignInfo,
): RiskInput {
  const currentBudget = campaign.dailyBudget / 100; // cents to dollars
  const newBudget = params.newBudget;
  const budgetChange = Math.abs(newBudget - currentBudget);

  // Estimate remaining days (default 30 if no end date)
  const remainingDays = campaign.endTime
    ? Math.max(1, (new Date(campaign.endTime).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 30;

  const dollarsAtRisk = budgetChange * remainingDays;

  return {
    baseRisk: "high",
    exposure: {
      dollarsAtRisk,
      blastRadius: 1,
    },
    reversibility: "full",
    sensitivity: {
      entityVolatile: campaign.deliveryStatus !== "ACTIVE",
      learningPhase: campaign.deliveryStatus === "LEARNING",
      recentlyModified: false, // would check actual modification history
    },
  };
}

export function computeAdsPauseRiskInput(campaign: CampaignInfo): RiskInput {
  const dailyBudgetDollars = campaign.dailyBudget / 100;

  return {
    baseRisk: "medium",
    exposure: {
      dollarsAtRisk: dailyBudgetDollars,
      blastRadius: 1,
    },
    reversibility: "full",
    sensitivity: {
      entityVolatile: false,
      learningPhase: campaign.deliveryStatus === "LEARNING",
      recentlyModified: false,
    },
  };
}

export function computeAdsTargetingRiskInput(
  campaign: CampaignInfo,
  estimatedAudienceSize: number,
): RiskInput {
  const dailyBudgetDollars = campaign.dailyBudget / 100;
  const remainingDays = campaign.endTime
    ? Math.max(1, (new Date(campaign.endTime).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 30;

  return {
    baseRisk: "high",
    exposure: {
      dollarsAtRisk: dailyBudgetDollars * remainingDays,
      blastRadius: estimatedAudienceSize / 1000,
    },
    reversibility: "partial",
    sensitivity: {
      entityVolatile: false,
      learningPhase: true, // targeting change always triggers learning
      recentlyModified: false,
    },
  };
}
