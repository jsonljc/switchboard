// ---------------------------------------------------------------------------
// Campaign Mutation Handlers
// ---------------------------------------------------------------------------
// Execute handlers for campaign pause, resume, and budget adjustment.
// ---------------------------------------------------------------------------

import type { ExecuteResult, MetaAdsWriteProvider } from "../types.js";
import {
  buildPauseUndoRecipe,
  buildResumeUndoRecipe,
  buildBudgetUndoRecipe,
} from "./undo-recipes.js";

export async function executeCampaignPause(
  params: Record<string, unknown>,
  provider: MetaAdsWriteProvider,
): Promise<ExecuteResult> {
  const campaignId = params.campaignId as string;
  const start = Date.now();

  const result = await provider.pauseCampaign(campaignId);

  return {
    success: result.success,
    summary: `Paused campaign ${campaignId} (was ${result.previousStatus})`,
    externalRefs: { campaignId, previousStatus: result.previousStatus },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildPauseUndoRecipe(campaignId),
  };
}

export async function executeCampaignResume(
  params: Record<string, unknown>,
  provider: MetaAdsWriteProvider,
): Promise<ExecuteResult> {
  const campaignId = params.campaignId as string;
  const start = Date.now();

  const result = await provider.resumeCampaign(campaignId);

  return {
    success: result.success,
    summary: `Resumed campaign ${campaignId} (was ${result.previousStatus})`,
    externalRefs: { campaignId, previousStatus: result.previousStatus },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildResumeUndoRecipe(campaignId),
  };
}

export async function executeCampaignAdjustBudget(
  params: Record<string, unknown>,
  provider: MetaAdsWriteProvider,
): Promise<ExecuteResult> {
  const campaignId = params.campaignId as string;
  const start = Date.now();

  let newBudgetDollars: number;
  if (typeof params.newBudget === "number") {
    newBudgetDollars = params.newBudget;
  } else if (typeof params.budgetChange === "number") {
    const current = await provider.getCampaign(campaignId);
    const currentDollars = current.dailyBudget / 100;
    newBudgetDollars = currentDollars + (params.budgetChange as number);
  } else {
    return {
      success: false,
      summary: "Missing newBudget or budgetChange parameter",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [{ step: "validate", error: "Missing budget parameter" }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  const newBudgetCents = Math.round(newBudgetDollars * 100);
  const result = await provider.updateBudget(campaignId, newBudgetCents);
  const previousBudgetDollars = result.previousBudget / 100;

  return {
    success: result.success,
    summary: `Budget for campaign ${campaignId} changed from $${previousBudgetDollars.toFixed(2)} to $${newBudgetDollars.toFixed(2)}`,
    externalRefs: {
      campaignId,
      previousBudget: String(previousBudgetDollars),
      newBudget: String(newBudgetDollars),
    },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildBudgetUndoRecipe(
      "digital-ads.campaign.adjust_budget",
      campaignId,
      "campaignId",
      previousBudgetDollars,
    ),
  };
}
