import type { UndoRecipe } from "@switchboard/schemas";

export function buildLimitOrderUndoRecipe(
  orderId: string,
  envelopeId: string,
  actionId: string,
): UndoRecipe {
  return {
    type: "single",
    undoActionType: "trading.order.cancel",
    undoParameters: { orderId },
    originalEnvelopeId: envelopeId,
    originalActionId: actionId,
    undoExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
  };
}

export function buildStopLossUndoRecipe(
  orderId: string,
  envelopeId: string,
  actionId: string,
): UndoRecipe {
  return {
    type: "single",
    undoActionType: "trading.order.cancel",
    undoParameters: { orderId },
    originalEnvelopeId: envelopeId,
    originalActionId: actionId,
    undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
  };
}
