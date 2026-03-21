import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { StripeProvider } from "../providers/stripe.js";
import { validateAmount, amountError, missingParamResult } from "./validation.js";

export async function handleRefundCreate(
  provider: StripeProvider,
  parameters: Record<string, unknown>,
  start: number,
): Promise<ExecuteResult> {
  const chargeId = parameters["chargeId"] as string;
  const amount = parameters["amount"];
  const reason = (parameters["reason"] as string) ?? "requested_by_customer";
  if (!chargeId) return missingParamResult(start, "chargeId");
  const refundAmountErr = validateAmount(amount);
  if (refundAmountErr) return amountError(start, refundAmountErr);
  const refundAmount = amount as number;
  const refund = await provider.createRefund(chargeId, Math.round(refundAmount * 100), reason);
  return {
    success: true,
    summary: `Refund ${refund.id} of $${refundAmount} issued for charge ${chargeId}`,
    externalRefs: { refundId: refund.id, chargeId },
    rollbackAvailable: false, // irreversible
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null, // no undo for refunds
  };
}
