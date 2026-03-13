import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { StripeProvider } from "../providers/stripe.js";
import { buildCreditUndoRecipe } from "../actions/index.js";

export async function handleCreditApply(
  provider: StripeProvider,
  parameters: Record<string, unknown>,
  envelopeId: string,
  actionId: string,
  start: number,
): Promise<ExecuteResult> {
  const entityId = parameters["entityId"] as string;
  const amount = parameters["amount"] as number;
  const description = (parameters["description"] as string) ?? "Credit applied";
  if (!entityId || typeof amount !== "number" || isNaN(amount) || amount === 0) {
    return {
      success: false,
      summary: "Missing or invalid parameters: entityId, amount (non-zero number required)",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [
        { step: "validate", error: "entityId and a non-zero numeric amount are required" },
      ],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }
  const txn = await provider.applyCredit(entityId, Math.round(amount * 100), description);
  const isDebit = amount < 0;
  const absAmount = Math.abs(amount);
  return {
    success: true,
    summary: isDebit
      ? `Debit of $${absAmount} applied to customer ${entityId} (txn ${txn.id})`
      : `Credit of $${absAmount} applied to customer ${entityId} (txn ${txn.id})`,
    externalRefs: { transactionId: txn.id, customerId: entityId },
    rollbackAvailable: !isDebit,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: isDebit ? null : buildCreditUndoRecipe(entityId, amount, envelopeId, actionId),
  };
}
