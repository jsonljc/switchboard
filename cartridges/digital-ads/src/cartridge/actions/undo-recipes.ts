// ---------------------------------------------------------------------------
// Undo Recipe Builders
// ---------------------------------------------------------------------------
// Builds UndoRecipe objects for write actions. Uses the Switchboard 7-field
// format from @switchboard/schemas.
//
// Note: originalActionId and originalEnvelopeId are set to empty strings here
// because they are envelope-level concerns filled in by the orchestrator after
// the cartridge returns the recipe.
// ---------------------------------------------------------------------------

import type { UndoRecipe } from "@switchboard/schemas";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function buildPauseUndoRecipe(campaignId: string): UndoRecipe {
  return {
    originalActionId: "",
    originalEnvelopeId: "",
    reverseActionType: "digital-ads.campaign.resume",
    reverseParameters: { campaignId },
    undoExpiresAt: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
    undoRiskCategory: "medium",
    undoApprovalRequired: "none",
  };
}

export function buildResumeUndoRecipe(campaignId: string): UndoRecipe {
  return {
    originalActionId: "",
    originalEnvelopeId: "",
    reverseActionType: "digital-ads.campaign.pause",
    reverseParameters: { campaignId },
    undoExpiresAt: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
    undoRiskCategory: "medium",
    undoApprovalRequired: "none",
  };
}

export function buildBudgetUndoRecipe(
  reverseActionType: string,
  entityId: string,
  entityIdField: string,
  previousBudgetDollars: number,
): UndoRecipe {
  return {
    originalActionId: "",
    originalEnvelopeId: "",
    reverseActionType,
    reverseParameters: { [entityIdField]: entityId, newBudget: previousBudgetDollars },
    undoExpiresAt: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
    undoRiskCategory: "high",
    undoApprovalRequired: "standard",
  };
}

export function buildAdSetPauseUndoRecipe(adSetId: string): UndoRecipe {
  return {
    originalActionId: "",
    originalEnvelopeId: "",
    reverseActionType: "digital-ads.adset.resume",
    reverseParameters: { adSetId },
    undoExpiresAt: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
    undoRiskCategory: "medium",
    undoApprovalRequired: "none",
  };
}

export function buildAdSetResumeUndoRecipe(adSetId: string): UndoRecipe {
  return {
    originalActionId: "",
    originalEnvelopeId: "",
    reverseActionType: "digital-ads.adset.pause",
    reverseParameters: { adSetId },
    undoExpiresAt: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
    undoRiskCategory: "medium",
    undoApprovalRequired: "none",
  };
}

export function buildCreateCampaignUndoRecipe(campaignId: string): UndoRecipe {
  return {
    originalActionId: "",
    originalEnvelopeId: "",
    reverseActionType: "digital-ads.campaign.pause",
    reverseParameters: { campaignId },
    undoExpiresAt: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
    undoRiskCategory: "high",
    undoApprovalRequired: "standard",
  };
}

export function buildCreateAdSetUndoRecipe(adSetId: string): UndoRecipe {
  return {
    originalActionId: "",
    originalEnvelopeId: "",
    reverseActionType: "digital-ads.adset.pause",
    reverseParameters: { adSetId },
    undoExpiresAt: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
    undoRiskCategory: "high",
    undoApprovalRequired: "standard",
  };
}

export function buildCreateAdUndoRecipe(adId: string): UndoRecipe {
  return {
    originalActionId: "",
    originalEnvelopeId: "",
    reverseActionType: "digital-ads.campaign.pause",
    reverseParameters: { campaignId: adId },
    undoExpiresAt: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
    undoRiskCategory: "high",
    undoApprovalRequired: "standard",
  };
}
