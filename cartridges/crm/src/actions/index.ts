import type { UndoRecipe } from "@switchboard/schemas";

export function buildContactCreateUndoRecipe(
  contactId: string,
  envelopeId: string,
  actionId: string,
): UndoRecipe {
  return {
    originalActionId: actionId,
    originalEnvelopeId: envelopeId,
    reverseActionType: "crm.contact.update",
    reverseParameters: { contactId, data: { status: "archived" } },
    undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    undoRiskCategory: "low",
    undoApprovalRequired: "none",
  };
}

export function buildContactUpdateUndoRecipe(
  contactId: string,
  previousData: Record<string, unknown>,
  envelopeId: string,
  actionId: string,
): UndoRecipe {
  return {
    originalActionId: actionId,
    originalEnvelopeId: envelopeId,
    reverseActionType: "crm.contact.update",
    reverseParameters: { contactId, data: previousData },
    undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    undoRiskCategory: "medium",
    undoApprovalRequired: "standard",
  };
}

export function buildDealCreateUndoRecipe(
  dealId: string,
  envelopeId: string,
  actionId: string,
): UndoRecipe {
  return {
    originalActionId: actionId,
    originalEnvelopeId: envelopeId,
    reverseActionType: "crm.deal.create",
    reverseParameters: { _archiveDealId: dealId },
    undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    undoRiskCategory: "low",
    undoApprovalRequired: "none",
  };
}
