import type { UndoRecipe } from "@switchboard/schemas";

export function buildInvoiceUndoRecipe(
  invoiceId: string,
  envelopeId: string,
  actionId: string,
): UndoRecipe {
  return {
    originalActionId: actionId,
    originalEnvelopeId: envelopeId,
    reverseActionType: "payments.invoice.void",
    reverseParameters: { invoiceId },
    undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    undoRiskCategory: "low",
    undoApprovalRequired: "none",
  };
}

export function buildChargeUndoRecipe(
  chargeId: string,
  amountDollars: number,
  envelopeId: string,
  actionId: string,
): UndoRecipe {
  return {
    originalActionId: actionId,
    originalEnvelopeId: envelopeId,
    reverseActionType: "payments.refund.create",
    reverseParameters: { chargeId, amount: amountDollars },
    undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    undoRiskCategory: "critical",
    undoApprovalRequired: "mandatory", // refund still requires mandatory approval
  };
}

export function buildSubscriptionModifyUndoRecipe(
  subscriptionId: string,
  previousChanges: Record<string, unknown>,
  envelopeId: string,
  actionId: string,
): UndoRecipe {
  return {
    originalActionId: actionId,
    originalEnvelopeId: envelopeId,
    reverseActionType: "payments.subscription.modify",
    reverseParameters: { subscriptionId, changes: previousChanges },
    undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    undoRiskCategory: "medium",
    undoApprovalRequired: "standard",
  };
}

export function buildPaymentLinkUndoRecipe(
  linkId: string,
  envelopeId: string,
  actionId: string,
): UndoRecipe {
  return {
    originalActionId: actionId,
    originalEnvelopeId: envelopeId,
    reverseActionType: "payments.link.deactivate",
    reverseParameters: { linkId },
    undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    undoRiskCategory: "low",
    undoApprovalRequired: "none",
  };
}

export function buildCreditUndoRecipe(
  entityId: string,
  amountDollars: number,
  envelopeId: string,
  actionId: string,
): UndoRecipe {
  return {
    originalActionId: actionId,
    originalEnvelopeId: envelopeId,
    reverseActionType: "payments.credit.apply",
    reverseParameters: { entityId, amount: -amountDollars, description: "Reversal of credit" },
    undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    undoRiskCategory: "medium",
    undoApprovalRequired: "standard",
  };
}
