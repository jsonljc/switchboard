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
  handleInvoiceCreate,
  handleInvoiceVoid,
  handleBatchInvoice,
  handleChargeCreate,
  handleRefundCreate,
  handleSubscriptionCancel,
  handleSubscriptionModify,
  handleLinkCreate,
  handleLinkDeactivate,
  handleCreditApply,
} from "./handlers/index.js";

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
        history.charges.length > 0 ? history.refunds.length / history.charges.length : 0;
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
      case "payments.invoice.create":
        return handleInvoiceCreate(provider, parameters, envelopeId, actionId, start);

      case "payments.charge.create":
        return handleChargeCreate(provider, parameters, envelopeId, actionId, start);

      case "payments.refund.create":
        return handleRefundCreate(provider, parameters, start);

      case "payments.subscription.cancel":
        return handleSubscriptionCancel(provider, parameters, start);

      case "payments.subscription.modify":
        return handleSubscriptionModify(provider, parameters, envelopeId, actionId, start);

      case "payments.link.create":
        return handleLinkCreate(provider, parameters, envelopeId, actionId, start);

      case "payments.credit.apply":
        return handleCreditApply(provider, parameters, envelopeId, actionId, start);

      case "payments.batch.invoice":
        return handleBatchInvoice(provider, parameters, start);

      case "payments.invoice.void":
        return handleInvoiceVoid(provider, parameters, start);

      case "payments.link.deactivate":
        return handleLinkDeactivate(provider, parameters, start);

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
      if (
        actionType === "payments.subscription.cancel" ||
        actionType === "payments.subscription.modify"
      ) {
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
