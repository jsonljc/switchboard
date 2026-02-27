import type { UndoRecipe } from "@switchboard/schemas";

export function buildLimitOrderUndoRecipe(
  orderId: string,
  envelopeId: string,
  actionId: string,
): UndoRecipe {
  return {
    originalEnvelopeId: envelopeId,
    originalActionId: actionId,
    reverseActionType: "trading.order.cancel",
    reverseParameters: { orderId },
    undoExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    undoRiskCategory: "low",
    undoApprovalRequired: "standard",
  };
}

export function buildStopLossUndoRecipe(
  orderId: string,
  envelopeId: string,
  actionId: string,
): UndoRecipe {
  return {
    originalEnvelopeId: envelopeId,
    originalActionId: actionId,
    reverseActionType: "trading.order.cancel",
    reverseParameters: { orderId },
    undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    undoRiskCategory: "low",
    undoApprovalRequired: "standard",
  };
}
