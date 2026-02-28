import type {
  CartridgeManifest,
  ConnectionHealth,
  GuardrailConfig,
  RiskInput,
} from "@switchboard/schemas";
import type { Cartridge, CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";
import { PAYMENTS_MANIFEST } from "./manifest.js";
import type { StripeProvider, StripeConfig } from "./providers/stripe.js";
import { createStripeProvider } from "./providers/factory.js";
import { DEFAULT_PAYMENTS_GUARDRAILS } from "./defaults/guardrails.js";
import {
  computeInvoiceRiskInput,
  computeChargeRiskInput,
  computeRefundRiskInput,
  computeSubscriptionCancelRiskInput,
  computeSubscriptionModifyRiskInput,
  computePaymentLinkRiskInput,
  computeCreditRiskInput,
  computeBatchInvoiceRiskInput,
} from "./risk/categories.js";
import {
  buildInvoiceUndoRecipe,
  buildChargeUndoRecipe,
  buildSubscriptionModifyUndoRecipe,
  buildPaymentLinkUndoRecipe,
  buildCreditUndoRecipe,
} from "./actions/index.js";

const MAX_BATCH_SIZE = 50;
const MAX_AMOUNT_DOLLARS = 999_999;

function validateAmount(
  value: unknown,
  { allowNegative = false }: { allowNegative?: boolean } = {},
): string | null {
  if (typeof value !== "number" || isNaN(value)) return "amount must be a number";
  if (!allowNegative && value <= 0) return "amount must be positive";
  if (value === 0) return "amount must be non-zero";
  if (Math.abs(value) > MAX_AMOUNT_DOLLARS) return `amount exceeds maximum of $${MAX_AMOUNT_DOLLARS}`;
  return null;
}

function amountError(start: number, msg: string): ExecuteResult {
  return {
    success: false,
    summary: msg,
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [{ step: "validate", error: msg }],
    durationMs: Date.now() - start,
    undoRecipe: null,
  };
}

export class PaymentsCartridge implements Cartridge {
  readonly manifest: CartridgeManifest = PAYMENTS_MANIFEST;
  private provider: StripeProvider | null = null;

  async initialize(context: CartridgeContext): Promise<void> {
    const config: StripeConfig = {
      secretKey: (context.connectionCredentials["secretKey"] as string) ?? "",
    };
    this.provider = createStripeProvider(config);
  }

  /**
   * @internal Not part of the public Cartridge API. Used only by bootstrap
   * within the payments package. Accessing this method from outside the
   * package bypasses governance controls.
   */
  getProvider(): StripeProvider {
    if (!this.provider) throw new Error("Cartridge not initialized");
    return this.provider;
  }

  async enrichContext(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    const provider = this.getProvider();
    const entityId = parameters["entityId"] as string | undefined;
    if (!entityId) return {};

    try {
      const history = await provider.getPaymentHistory(entityId);
      const customer = await provider.getCustomer(entityId);

      const openDisputes = history.disputes.filter(
        (d) => d.status === "needs_response" || d.status === "under_review",
      );
      const totalCharges = history.charges.reduce((sum, c) => sum + c.amount, 0);
      const lastCharge = history.charges.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];
      const daysSinceLastPayment = lastCharge
        ? Math.floor((Date.now() - new Date(lastCharge.createdAt).getTime()) / 86400000)
        : null;
      const refundRate =
        history.charges.length > 0
          ? history.refunds.length / history.charges.length
          : 0;
      const customerCreatedMs = customer.created * 1000;

      // For subscription-related actions, look up subscription tenure
      let subscriptionTenureMonths: number | null = null;
      if (actionType.startsWith("payments.subscription.")) {
        const subId = parameters["subscriptionId"] as string | undefined;
        if (subId) {
          try {
            const sub = await provider.getSubscription(subId);
            const startMs = new Date(sub.startDate).getTime();
            subscriptionTenureMonths = Math.floor((Date.now() - startMs) / (30 * 86400000));
          } catch {
            // Non-critical enrichment — ignore
          }
        }
      }

      return {
        hasOpenDispute: openDisputes.length > 0,
        previousRefundCount: history.refunds.length,
        totalLifetimeSpend: totalCharges / 100, // cents to dollars
        daysSinceLastPayment,
        refundRate,
        subscriptionTenureMonths,
        disputeCount: history.disputes.length,
        customerSinceDays: Math.floor((Date.now() - customerCreatedMs) / 86400000),
      };
    } catch {
      // Fail-closed: when enrichment fails, assume the worst for safety-critical
      // fields. This ensures deny/escalation policies remain effective even if
      // the Stripe API is unreachable.
      return {
        hasOpenDispute: true,
        previousRefundCount: Infinity,
        totalLifetimeSpend: 0,
        daysSinceLastPayment: null,
        refundRate: 1,
        subscriptionTenureMonths: null,
        disputeCount: 0,
        customerSinceDays: 0,
        _enrichmentFailed: true,
      };
    }
  }

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<ExecuteResult> {
    const provider = this.getProvider();
    const start = Date.now();
    const envelopeId = (parameters["_envelopeId"] as string) ?? "unknown";
    const actionId = (parameters["_actionId"] as string) ?? "unknown";

    switch (actionType) {
      case "payments.invoice.create": {
        const entityId = parameters["entityId"] as string;
        const amount = parameters["amount"];
        const description = (parameters["description"] as string) ?? "Invoice";
        const currency = (parameters["currency"] as string) ?? "usd";
        if (!entityId) return amountError(start, "Missing required parameter: entityId");
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

      case "payments.charge.create": {
        const entityId = parameters["entityId"] as string;
        const amount = parameters["amount"];
        const currency = (parameters["currency"] as string) ?? "usd";
        const description = (parameters["description"] as string) ?? "Charge";
        if (!entityId) return amountError(start, "Missing required parameter: entityId");
        const chargeAmountErr = validateAmount(amount);
        if (chargeAmountErr) return amountError(start, chargeAmountErr);
        const chargeAmount = amount as number;
        const charge = await provider.createCharge(entityId, Math.round(chargeAmount * 100), currency, description);
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

      case "payments.refund.create": {
        const chargeId = parameters["chargeId"] as string;
        const amount = parameters["amount"];
        const reason = (parameters["reason"] as string) ?? "requested_by_customer";
        if (!chargeId) return amountError(start, "Missing required parameter: chargeId");
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

      case "payments.subscription.cancel": {
        const subscriptionId = parameters["subscriptionId"] as string;
        const cancelAtPeriodEnd = (parameters["cancelAtPeriodEnd"] as boolean) ?? true;
        if (!subscriptionId) {
          return {
            success: false,
            summary: "Missing required parameter: subscriptionId",
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [{ step: "validate", error: "subscriptionId is required" }],
            durationMs: Date.now() - start,
            undoRecipe: null,
          };
        }
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

      case "payments.subscription.modify": {
        const subscriptionId = parameters["subscriptionId"] as string;
        const changes = (parameters["changes"] as Record<string, unknown>) ?? {};
        if (!subscriptionId) {
          return {
            success: false,
            summary: "Missing required parameter: subscriptionId",
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [{ step: "validate", error: "subscriptionId is required" }],
            durationMs: Date.now() - start,
            undoRecipe: null,
          };
        }
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
          undoRecipe: buildSubscriptionModifyUndoRecipe(subscriptionId, previousChanges, envelopeId, actionId),
        };
      }

      case "payments.link.create": {
        const amount = parameters["amount"];
        const currency = (parameters["currency"] as string) ?? "usd";
        const description = (parameters["description"] as string) ?? "Payment";
        const linkAmountErr = validateAmount(amount);
        if (linkAmountErr) return amountError(start, linkAmountErr);
        const linkAmount = amount as number;
        const link = await provider.createPaymentLink(Math.round(linkAmount * 100), currency, description);
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

      case "payments.credit.apply": {
        const entityId = parameters["entityId"] as string;
        const amount = parameters["amount"] as number;
        const description = (parameters["description"] as string) ?? "Credit applied";
        if (!entityId || typeof amount !== "number" || isNaN(amount) || amount === 0) {
          return {
            success: false,
            summary: "Missing or invalid parameters: entityId, amount (non-zero number required)",
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [{ step: "validate", error: "entityId and a non-zero numeric amount are required" }],
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

      case "payments.batch.invoice": {
        const invoices = parameters["invoices"] as Array<{ entityId: string; amount: number; description?: string }>;
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

      case "payments.invoice.void": {
        const invoiceId = parameters["invoiceId"] as string;
        if (!invoiceId) {
          return {
            success: false,
            summary: "Missing required parameter: invoiceId",
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [{ step: "validate", error: "invoiceId is required" }],
            durationMs: Date.now() - start,
            undoRecipe: null,
          };
        }
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

      case "payments.link.deactivate": {
        const linkId = parameters["linkId"] as string;
        if (!linkId) {
          return {
            success: false,
            summary: "Missing required parameter: linkId",
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [{ step: "validate", error: "linkId is required" }],
            durationMs: Date.now() - start,
            undoRecipe: null,
          };
        }
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

      default:
        return {
          success: false,
          summary: `Unknown action type: ${actionType}`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [{ step: "execute", error: `Unknown action type: ${actionType}` }],
          durationMs: Date.now() - start,
          undoRecipe: null,
        };
    }
  }

  async getRiskInput(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: Record<string, unknown>,
  ): Promise<RiskInput> {
    const amount = (parameters["amount"] as number) ?? 0;

    switch (actionType) {
      case "payments.invoice.create":
      case "payments.invoice.void":
        return computeInvoiceRiskInput(amount);

      case "payments.charge.create":
        return computeChargeRiskInput(amount);

      case "payments.refund.create":
        return computeRefundRiskInput(amount);

      case "payments.subscription.cancel": {
        // Estimate monthly revenue from subscription
        const subId = parameters["subscriptionId"] as string | undefined;
        if (subId) {
          try {
            const provider = this.getProvider();
            const sub = await provider.getSubscription(subId);
            const monthlyTotal = sub.items.reduce((sum, item) => {
              const monthly =
                item.interval === "year"
                  ? (item.unitAmount * item.quantity) / 12
                  : item.unitAmount * item.quantity;
              return sum + monthly;
            }, 0);
            return computeSubscriptionCancelRiskInput(monthlyTotal / 100);
          } catch {
            // Fall through to default
          }
        }
        return computeSubscriptionCancelRiskInput(amount);
      }

      case "payments.subscription.modify": {
        // annualized delta — use amount parameter as proxy
        return computeSubscriptionModifyRiskInput(amount);
      }

      case "payments.link.create":
      case "payments.link.deactivate":
        return computePaymentLinkRiskInput(amount);

      case "payments.credit.apply":
        return computeCreditRiskInput(amount);

      case "payments.batch.invoice": {
        const invoices = parameters["invoices"] as Array<{ amount: number }> | undefined;
        if (invoices && Array.isArray(invoices)) {
          const total = invoices.reduce((sum, inv) => sum + (inv.amount ?? 0), 0);
          return computeBatchInvoiceRiskInput(total, invoices.length);
        }
        return computeBatchInvoiceRiskInput(amount, 1);
      }

      default:
        return {
          baseRisk: "medium",
          exposure: { dollarsAtRisk: 0, blastRadius: 1 },
          reversibility: "full",
          sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
        };
    }
  }

  getGuardrails(): GuardrailConfig {
    return DEFAULT_PAYMENTS_GUARDRAILS;
  }

  async healthCheck(): Promise<ConnectionHealth> {
    return this.getProvider().healthCheck();
  }

  async captureSnapshot(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    const provider = this.getProvider();
    const snapshot: Record<string, unknown> = {
      capturedAt: new Date().toISOString(),
      actionType,
    };

    try {
      // Capture customer state if entityId is present
      const entityId = parameters["entityId"] as string | undefined;
      if (entityId) {
        const customer = await provider.getCustomer(entityId);
        snapshot["customer"] = {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          balance: customer.balance / 100, // cents to dollars
        };
      }

      // Capture charge state before refund
      if (actionType === "payments.refund.create") {
        const chargeId = parameters["chargeId"] as string | undefined;
        if (chargeId) {
          const history = await provider.getPaymentHistory(entityId ?? "");
          const charge = history.charges.find((c) => c.id === chargeId);
          if (charge) {
            snapshot["charge"] = {
              id: charge.id,
              amount: charge.amount / 100,
              currency: charge.currency,
              status: charge.status,
              disputed: charge.disputed,
              refunded: charge.refunded,
            };
          }
        }
      }

      // Capture subscription state before cancel/modify
      if (actionType === "payments.subscription.cancel" || actionType === "payments.subscription.modify") {
        const subscriptionId = parameters["subscriptionId"] as string | undefined;
        if (subscriptionId) {
          const sub = await provider.getSubscription(subscriptionId);
          snapshot["subscription"] = {
            id: sub.id,
            customerId: sub.customerId,
            status: sub.status,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            currentPeriodEnd: sub.currentPeriodEnd,
            items: sub.items.map((item) => ({
              priceId: item.priceId,
              quantity: item.quantity,
              unitAmount: item.unitAmount / 100,
              interval: item.interval,
            })),
            startDate: sub.startDate,
          };
        }
      }
    } catch {
      snapshot["_snapshotError"] = "Failed to capture pre-mutation state";
    }

    return snapshot;
  }
}

export { PAYMENTS_MANIFEST } from "./manifest.js";
export { DEFAULT_PAYMENTS_GUARDRAILS } from "./defaults/guardrails.js";
export { DEFAULT_PAYMENTS_POLICIES } from "./defaults/policies.js";
export { bootstrapPaymentsCartridge } from "./bootstrap.js";
export type { BootstrapPaymentsConfig, BootstrapPaymentsResult } from "./bootstrap.js";
export type { StripeProvider, StripeConfig } from "./providers/stripe.js";
export { MockStripeProvider } from "./providers/stripe.js";
