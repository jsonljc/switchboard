import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { StripeProvider } from "../providers/stripe.js";
import { buildSubscriptionModifyUndoRecipe } from "../actions/index.js";
import { missingParamResult } from "./validation.js";

export async function handleSubscriptionCancel(
  provider: StripeProvider,
  parameters: Record<string, unknown>,
  start: number,
): Promise<ExecuteResult> {
  const subscriptionId = parameters["subscriptionId"] as string;
  const cancelAtPeriodEnd = (parameters["cancelAtPeriodEnd"] as boolean) ?? true;
  if (!subscriptionId) return missingParamResult(start, "subscriptionId");
  const sub = await provider.cancelSubscription(subscriptionId, cancelAtPeriodEnd);
  return {
    success: true,
    summary: `Subscription ${subscriptionId} ${cancelAtPeriodEnd ? "scheduled for cancellation at period end" : "cancelled immediately"}`,
    externalRefs: { subscriptionId, customerId: sub.customerId },
    rollbackAvailable: false, // irreversible
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
  };
}

export async function handleSubscriptionModify(
  provider: StripeProvider,
  parameters: Record<string, unknown>,
  envelopeId: string,
  actionId: string,
  start: number,
): Promise<ExecuteResult> {
  const subscriptionId = parameters["subscriptionId"] as string;
  const changes = (parameters["changes"] as Record<string, unknown>) ?? {};
  if (!subscriptionId) return missingParamResult(start, "subscriptionId");
  // Capture previous state for undo
  const before = await provider.getSubscription(subscriptionId);
  const previousChanges: Record<string, unknown> = {};
  if (changes["quantity"] !== undefined && before.items[0]) {
    previousChanges["quantity"] = before.items[0].quantity;
  }
  if (changes["priceId"] !== undefined && before.items[0]) {
    previousChanges["priceId"] = before.items[0].priceId;
  }

  const sub = await provider.modifySubscription(subscriptionId, changes);
  return {
    success: true,
    summary: `Subscription ${subscriptionId} modified: ${Object.keys(changes).join(", ")}`,
    externalRefs: { subscriptionId, customerId: sub.customerId },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildSubscriptionModifyUndoRecipe(
      subscriptionId,
      previousChanges,
      envelopeId,
      actionId,
    ),
  };
}
