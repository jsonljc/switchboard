// ---------------------------------------------------------------------------
// Ad Set Mutation Handlers
// ---------------------------------------------------------------------------
// Execute handlers for ad set pause, resume, budget, and targeting.
// ---------------------------------------------------------------------------

import type { ExecuteResult, MetaAdsWriteProvider } from "../types.js";
import {
  buildAdSetPauseUndoRecipe,
  buildAdSetResumeUndoRecipe,
  buildBudgetUndoRecipe,
} from "./undo-recipes.js";

export async function executeAdSetPause(
  params: Record<string, unknown>,
  provider: MetaAdsWriteProvider,
): Promise<ExecuteResult> {
  const adSetId = params.adSetId as string;
  const start = Date.now();

  const result = await provider.pauseAdSet(adSetId);

  return {
    success: result.success,
    summary: `Paused ad set ${adSetId} (was ${result.previousStatus})`,
    externalRefs: { adSetId, previousStatus: result.previousStatus },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildAdSetPauseUndoRecipe(adSetId),
  };
}

export async function executeAdSetResume(
  params: Record<string, unknown>,
  provider: MetaAdsWriteProvider,
): Promise<ExecuteResult> {
  const adSetId = params.adSetId as string;
  const start = Date.now();

  const result = await provider.resumeAdSet(adSetId);

  return {
    success: result.success,
    summary: `Resumed ad set ${adSetId} (was ${result.previousStatus})`,
    externalRefs: { adSetId, previousStatus: result.previousStatus },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildAdSetResumeUndoRecipe(adSetId),
  };
}

export async function executeAdSetAdjustBudget(
  params: Record<string, unknown>,
  provider: MetaAdsWriteProvider,
): Promise<ExecuteResult> {
  const adSetId = params.adSetId as string;
  const start = Date.now();

  let newBudgetDollars: number;
  if (typeof params.newBudget === "number") {
    newBudgetDollars = params.newBudget;
  } else if (typeof params.budgetChange === "number") {
    const current = await provider.getAdSet(adSetId);
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
  const result = await provider.updateAdSetBudget(adSetId, newBudgetCents);
  const previousBudgetDollars = result.previousBudget / 100;

  return {
    success: result.success,
    summary: `Budget for ad set ${adSetId} changed from $${previousBudgetDollars.toFixed(2)} to $${newBudgetDollars.toFixed(2)}`,
    externalRefs: {
      adSetId,
      previousBudget: String(previousBudgetDollars),
      newBudget: String(newBudgetDollars),
    },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildBudgetUndoRecipe(
      "digital-ads.adset.adjust_budget",
      adSetId,
      "adSetId",
      previousBudgetDollars,
    ),
  };
}

export async function executeTargetingModify(
  params: Record<string, unknown>,
  provider: MetaAdsWriteProvider,
): Promise<ExecuteResult> {
  const adSetId = params.adSetId as string;
  const targeting = params.targeting as Record<string, unknown>;
  const start = Date.now();

  const result = await provider.updateTargeting(adSetId, targeting);

  return {
    success: result.success,
    summary: `Updated targeting for ad set ${adSetId}`,
    externalRefs: { adSetId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
  };
}
