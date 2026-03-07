// ---------------------------------------------------------------------------
// Creation Mutation Handlers
// ---------------------------------------------------------------------------
// Execute handlers for campaign, ad set, and ad creation via Meta Graph API.
// ---------------------------------------------------------------------------

import type {
  ExecuteResult,
  MetaAdsWriteProvider,
  CreateCampaignParams,
  CreateAdSetParams,
  CreateAdParams,
} from "../types.js";
import {
  buildCreateCampaignUndoRecipe,
  buildCreateAdSetUndoRecipe,
  buildCreateAdUndoRecipe,
} from "./undo-recipes.js";

export async function executeCampaignCreate(
  params: Record<string, unknown>,
  provider: MetaAdsWriteProvider,
): Promise<ExecuteResult> {
  const start = Date.now();

  const name = params.name as string;
  if (!name) {
    return {
      success: false,
      summary: "Missing required parameter: name",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [{ step: "validate", error: "Missing name parameter" }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  const objective = params.objective as string;
  if (!objective) {
    return {
      success: false,
      summary: "Missing required parameter: objective",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [{ step: "validate", error: "Missing objective parameter" }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  const dailyBudget = params.dailyBudget as number;
  if (typeof dailyBudget !== "number" || dailyBudget <= 0) {
    return {
      success: false,
      summary: "dailyBudget must be a positive number (in dollars)",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [{ step: "validate", error: "Invalid dailyBudget" }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  const createParams: CreateCampaignParams = {
    name,
    objective,
    dailyBudget,
    status: (params.status as string) ?? "PAUSED",
    specialAdCategories: (params.specialAdCategories as string[]) ?? [],
  };

  const result = await provider.createCampaign(createParams);

  return {
    success: result.success,
    summary: `Created campaign "${name}" (ID: ${result.id}) with $${dailyBudget.toFixed(2)}/day budget, objective: ${objective}`,
    externalRefs: {
      campaignId: result.id,
      name,
      objective,
      dailyBudget: String(dailyBudget),
    },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildCreateCampaignUndoRecipe(result.id),
    data: { campaignId: result.id, name, objective, dailyBudget },
  };
}

export async function executeAdSetCreate(
  params: Record<string, unknown>,
  provider: MetaAdsWriteProvider,
): Promise<ExecuteResult> {
  const start = Date.now();

  const campaignId = params.campaignId as string;
  if (!campaignId) {
    return {
      success: false,
      summary: "Missing required parameter: campaignId",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [{ step: "validate", error: "Missing campaignId parameter" }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  const name = params.name as string;
  if (!name) {
    return {
      success: false,
      summary: "Missing required parameter: name",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [{ step: "validate", error: "Missing name parameter" }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  const dailyBudget = params.dailyBudget as number;
  if (typeof dailyBudget !== "number" || dailyBudget <= 0) {
    return {
      success: false,
      summary: "dailyBudget must be a positive number (in dollars)",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [{ step: "validate", error: "Invalid dailyBudget" }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  const targeting = params.targeting as Record<string, unknown>;
  if (!targeting || typeof targeting !== "object") {
    return {
      success: false,
      summary: "Missing required parameter: targeting",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [{ step: "validate", error: "Missing targeting parameter" }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  const createParams: CreateAdSetParams = {
    campaignId,
    name,
    dailyBudget,
    targeting,
    optimizationGoal: (params.optimizationGoal as string) ?? undefined,
    billingEvent: (params.billingEvent as string) ?? undefined,
    status: (params.status as string) ?? "PAUSED",
  };

  const result = await provider.createAdSet(createParams);

  return {
    success: result.success,
    summary: `Created ad set "${name}" (ID: ${result.id}) in campaign ${campaignId} with $${dailyBudget.toFixed(2)}/day budget`,
    externalRefs: {
      adSetId: result.id,
      campaignId,
      name,
      dailyBudget: String(dailyBudget),
    },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildCreateAdSetUndoRecipe(result.id),
    data: { adSetId: result.id, campaignId, name, dailyBudget },
  };
}

export async function executeAdCreate(
  params: Record<string, unknown>,
  provider: MetaAdsWriteProvider,
): Promise<ExecuteResult> {
  const start = Date.now();

  const adSetId = params.adSetId as string;
  if (!adSetId) {
    return {
      success: false,
      summary: "Missing required parameter: adSetId",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [{ step: "validate", error: "Missing adSetId parameter" }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  const name = params.name as string;
  if (!name) {
    return {
      success: false,
      summary: "Missing required parameter: name",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [{ step: "validate", error: "Missing name parameter" }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  const creative = params.creative as Record<string, unknown>;
  if (!creative || typeof creative !== "object") {
    return {
      success: false,
      summary: "Missing required parameter: creative",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [{ step: "validate", error: "Missing creative parameter" }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }

  const createParams: CreateAdParams = {
    adSetId,
    name,
    creative,
    status: (params.status as string) ?? "PAUSED",
  };

  const result = await provider.createAd(createParams);

  return {
    success: result.success,
    summary: `Created ad "${name}" (ID: ${result.id}) in ad set ${adSetId}`,
    externalRefs: {
      adId: result.id,
      adSetId,
      name,
    },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildCreateAdUndoRecipe(result.id),
    data: { adId: result.id, adSetId, name },
  };
}
