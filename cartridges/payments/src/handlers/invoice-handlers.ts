import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { StripeProvider } from "../providers/stripe.js";
import { buildInvoiceUndoRecipe } from "../actions/index.js";
import { validateAmount, amountError, missingParamResult, MAX_BATCH_SIZE } from "./validation.js";

export async function handleInvoiceCreate(
  provider: StripeProvider,
  parameters: Record<string, unknown>,
  envelopeId: string,
  actionId: string,
  start: number,
): Promise<ExecuteResult> {
  const entityId = parameters["entityId"] as string;
  const amount = parameters["amount"];
  const description = (parameters["description"] as string) ?? "Invoice";
  const currency = (parameters["currency"] as string) ?? "usd";
  if (!entityId) return missingParamResult(start, "entityId");
  const amountErr = validateAmount(amount);
  if (amountErr) return amountError(start, amountErr);
  const amountNum = amount as number;
  const invoice = await provider.createInvoice(entityId, Math.round(amountNum * 100), description);
  void currency;
  return {
    success: true,
    summary: `Invoice ${invoice.id} created for $${amountNum} to customer ${entityId}`,
    externalRefs: { invoiceId: invoice.id, customerId: entityId },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: buildInvoiceUndoRecipe(invoice.id, envelopeId, actionId),
  };
}

export async function handleInvoiceVoid(
  provider: StripeProvider,
  parameters: Record<string, unknown>,
  start: number,
): Promise<ExecuteResult> {
  const invoiceId = parameters["invoiceId"] as string;
  if (!invoiceId) return missingParamResult(start, "invoiceId");
  const voided = await provider.voidInvoice(invoiceId);
  return {
    success: true,
    summary: `Invoice ${invoiceId} voided`,
    externalRefs: { invoiceId, customerId: voided.customerId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
  };
}

export async function handleBatchInvoice(
  provider: StripeProvider,
  parameters: Record<string, unknown>,
  start: number,
): Promise<ExecuteResult> {
  const invoices = parameters["invoices"] as Array<{
    entityId: string;
    amount: number;
    description?: string;
  }>;
  if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
    return amountError(start, "invoices array is required and must not be empty");
  }
  if (invoices.length > MAX_BATCH_SIZE) {
    return amountError(start, `Batch size ${invoices.length} exceeds maximum of ${MAX_BATCH_SIZE}`);
  }
  // Validate each invoice entry
  for (let i = 0; i < invoices.length; i++) {
    const inv = invoices[i]!;
    if (!inv.entityId) return amountError(start, `invoices[${i}]: missing entityId`);
    const invAmountErr = validateAmount(inv.amount);
    if (invAmountErr) return amountError(start, `invoices[${i}]: ${invAmountErr}`);
  }
  const results: string[] = [];
  const partialFailures: Array<{ step: string; error: string }> = [];
  let successCount = 0;

  for (const inv of invoices) {
    try {
      const invoice = await provider.createInvoice(
        inv.entityId,
        Math.round(inv.amount * 100),
        inv.description ?? "Batch invoice",
      );
      results.push(invoice.id);
      successCount++;
    } catch (err) {
      partialFailures.push({
        step: `invoice:${inv.entityId}`,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return {
    success: successCount > 0,
    summary: `Batch invoicing: ${successCount}/${invoices.length} invoices created`,
    externalRefs: { invoiceIds: results.join(",") },
    rollbackAvailable: false, // no single undo for batch
    partialFailures,
    durationMs: Date.now() - start,
    undoRecipe: null,
  };
}
