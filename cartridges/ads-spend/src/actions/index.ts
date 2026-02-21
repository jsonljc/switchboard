import type { UndoRecipe } from "@switchboard/schemas";

export function buildPauseUndoRecipe(
  campaignId: string,
  envelopeId: string,
  actionId: string,
  previousStatus: string,
): UndoRecipe {
  return {
    originalActionId: actionId,
    originalEnvelopeId: envelopeId,
    reverseActionType: "ads.campaign.resume",
    reverseParameters: { campaignId, previousStatus },
    undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    undoRiskCategory: "medium",
    undoApprovalRequired: "none",
  };
}

export function buildResumeUndoRecipe(
  campaignId: string,
  envelopeId: string,
  actionId: string,
): UndoRecipe {
  return {
    originalActionId: actionId,
    originalEnvelopeId: envelopeId,
    reverseActionType: "ads.campaign.pause",
    reverseParameters: { campaignId },
    undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    undoRiskCategory: "medium",
    undoApprovalRequired: "none",
  };
}

export function buildBudgetUndoRecipe(
  campaignId: string,
  envelopeId: string,
  actionId: string,
  previousBudget: number,
): UndoRecipe {
  return {
    originalActionId: actionId,
    originalEnvelopeId: envelopeId,
    reverseActionType: "ads.budget.adjust",
    reverseParameters: { campaignId, newBudget: previousBudget },
    undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    undoRiskCategory: "high",
    undoApprovalRequired: "standard",
  };
}
