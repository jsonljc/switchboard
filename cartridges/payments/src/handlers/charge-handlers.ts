import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { StripeProvider } from "../providers/stripe.js";
import { buildChargeUndoRecipe } from "../actions/index.js";
import { validateAmount, amountError, missingParamResult } from "./validation.js";

export async function handleChargeCreate(
  provider: StripeProvider,
  parameters: Record<string, unknown>,
  envelopeId: string,
  actionId: string,
  start: number,
): Promise<ExecuteResult> {
  const entityId = parameters["entityId"] as string;
  const amount = parameters["amount"];
  const currency = (parameters["currency"] as string) ?? "usd";
  const description = (parameters["description"] as string) ?? "Charge";
  if (!entityId) return missingParamResult(start, "entityId");
  const chargeAmountErr = validateAmount(amount);
  if (chargeAmountErr) return amountError(start, chargeAmountErr);
  const chargeAmount = amount as number;
  const charge = await provider.createCharge(
    entityId,
    Math.round(chargeAmount * 100),
    currency,
    description,
  );
  return {
    success: true,
    summary: `Charge ${charge.id} of $${chargeAmount} ${currency.toUpperCase()} to customer ${entityId}`,
    externalRefs: { chargeId: charge.id, customerId: entityId },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildChargeUndoRecipe(charge.id, chargeAmount, envelopeId, actionId),
  };
}
