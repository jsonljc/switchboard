import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { StripeProvider } from "../providers/stripe.js";
import { buildPaymentLinkUndoRecipe } from "../actions/index.js";
import { validateAmount, amountError, missingParamResult } from "./validation.js";

export async function handleLinkCreate(
  provider: StripeProvider,
  parameters: Record<string, unknown>,
  envelopeId: string,
  actionId: string,
  start: number,
): Promise<ExecuteResult> {
  const amount = parameters["amount"];
  const currency = (parameters["currency"] as string) ?? "usd";
  const description = (parameters["description"] as string) ?? "Payment";
  const linkAmountErr = validateAmount(amount);
  if (linkAmountErr) return amountError(start, linkAmountErr);
  const linkAmount = amount as number;
  const link = await provider.createPaymentLink(
    Math.round(linkAmount * 100),
    currency,
    description,
  );
  return {
    success: true,
    summary: `Payment link ${link.id} created for $${linkAmount}: ${link.url}`,
    externalRefs: { linkId: link.id, url: link.url },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildPaymentLinkUndoRecipe(link.id, envelopeId, actionId),
  };
}

export async function handleLinkDeactivate(
  provider: StripeProvider,
  parameters: Record<string, unknown>,
  start: number,
): Promise<ExecuteResult> {
  const linkId = parameters["linkId"] as string;
  if (!linkId) return missingParamResult(start, "linkId");
  await provider.deactivatePaymentLink(linkId);
  return {
    success: true,
    summary: `Payment link ${linkId} deactivated`,
    externalRefs: { linkId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
  };
}
