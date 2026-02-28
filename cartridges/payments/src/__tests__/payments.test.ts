import { describe, it, expect, beforeEach } from "vitest";
import { PaymentsCartridge } from "../index.js";
import { CartridgeTestHarness } from "@switchboard/cartridge-sdk";
import type { CartridgeContext } from "@switchboard/cartridge-sdk";

describe("PaymentsCartridge", () => {
  let cartridge: PaymentsCartridge;
  const ctx: CartridgeContext = {
    principalId: "test_user",
    organizationId: null,
    connectionCredentials: { secretKey: "mock-key" },
  };

  beforeEach(async () => {
    cartridge = new PaymentsCartridge();
    await cartridge.initialize(ctx);
  });

  describe("manifest", () => {
    it("should have correct cartridge id", () => {
      expect(cartridge.manifest.id).toBe("payments");
    });

    it("should define 10 actions", () => {
      expect(cartridge.manifest.actions).toHaveLength(10);
    });

    it("should have correct action types", () => {
      const types = cartridge.manifest.actions.map((a) => a.actionType);
      expect(types).toContain("payments.invoice.create");
      expect(types).toContain("payments.invoice.void");
      expect(types).toContain("payments.charge.create");
      expect(types).toContain("payments.refund.create");
      expect(types).toContain("payments.subscription.cancel");
      expect(types).toContain("payments.subscription.modify");
      expect(types).toContain("payments.link.create");
      expect(types).toContain("payments.link.deactivate");
      expect(types).toContain("payments.credit.apply");
      expect(types).toContain("payments.batch.invoice");
    });

    it("should mark refunds as irreversible", () => {
      const refund = cartridge.manifest.actions.find(
        (a) => a.actionType === "payments.refund.create",
      );
      expect(refund?.reversible).toBe(false);
      expect(refund?.baseRiskCategory).toBe("critical");
    });

    it("should mark subscription cancel as irreversible", () => {
      const cancel = cartridge.manifest.actions.find(
        (a) => a.actionType === "payments.subscription.cancel",
      );
      expect(cancel?.reversible).toBe(false);
    });

    it("should include undo action types in manifest", () => {
      const voidAction = cartridge.manifest.actions.find(
        (a) => a.actionType === "payments.invoice.void",
      );
      expect(voidAction).toBeDefined();
      expect(voidAction?.baseRiskCategory).toBe("low");

      const deactivate = cartridge.manifest.actions.find(
        (a) => a.actionType === "payments.link.deactivate",
      );
      expect(deactivate).toBeDefined();
      expect(deactivate?.baseRiskCategory).toBe("low");
    });
  });

  describe("risk computation", () => {
    it("should compute critical risk for refunds", async () => {
      const risk = await cartridge.getRiskInput(
        "payments.refund.create",
        { chargeId: "ch_1", amount: 500 },
        {},
      );
      expect(risk.baseRisk).toBe("critical");
      expect(risk.exposure.dollarsAtRisk).toBe(500);
      expect(risk.reversibility).toBe("none");
    });

    it("should compute high risk for charges", async () => {
      const risk = await cartridge.getRiskInput(
        "payments.charge.create",
        { entityId: "cus_good_customer", amount: 200 },
        {},
      );
      expect(risk.baseRisk).toBe("high");
      expect(risk.exposure.dollarsAtRisk).toBe(200);
      expect(risk.reversibility).toBe("partial");
    });

    it("should compute critical risk for charges over $1000", async () => {
      const risk = await cartridge.getRiskInput(
        "payments.charge.create",
        { entityId: "cus_good_customer", amount: 1500 },
        {},
      );
      expect(risk.baseRisk).toBe("critical");
      expect(risk.exposure.dollarsAtRisk).toBe(1500);
    });

    it("should compute low risk for invoices", async () => {
      const risk = await cartridge.getRiskInput(
        "payments.invoice.create",
        { entityId: "cus_good_customer", amount: 100 },
        {},
      );
      expect(risk.baseRisk).toBe("low");
      expect(risk.exposure.dollarsAtRisk).toBe(100);
      expect(risk.reversibility).toBe("full");
    });

    it("should compute subscription cancel risk with 12mo projection", async () => {
      const risk = await cartridge.getRiskInput(
        "payments.subscription.cancel",
        { subscriptionId: "sub_1" },
        {},
      );
      expect(risk.baseRisk).toBe("high");
      // sub_1 has $49/month → 12 * 49 = $588
      expect(risk.exposure.dollarsAtRisk).toBe(588);
      expect(risk.reversibility).toBe("partial");
    });

    it("should compute batch invoice risk with total and blast radius", async () => {
      const risk = await cartridge.getRiskInput(
        "payments.batch.invoice",
        {
          invoices: [
            { entityId: "cus_1", amount: 100 },
            { entityId: "cus_2", amount: 200 },
            { entityId: "cus_3", amount: 300 },
          ],
        },
        {},
      );
      expect(risk.baseRisk).toBe("high");
      expect(risk.exposure.dollarsAtRisk).toBe(600);
      expect(risk.exposure.blastRadius).toBe(3);
    });

    it("should compute medium risk for credits with non-negative dollarsAtRisk", async () => {
      const risk = await cartridge.getRiskInput(
        "payments.credit.apply",
        { entityId: "cus_good_customer", amount: 50 },
        {},
      );
      expect(risk.baseRisk).toBe("medium");
      expect(risk.exposure.dollarsAtRisk).toBe(50);
      expect(risk.reversibility).toBe("full");
    });

    it("should produce non-negative dollarsAtRisk for negative credit amounts (debit)", async () => {
      const risk = await cartridge.getRiskInput(
        "payments.credit.apply",
        { entityId: "cus_good_customer", amount: -25 },
        {},
      );
      expect(risk.exposure.dollarsAtRisk).toBe(25);
    });

    it("should compute low risk for payment links", async () => {
      const risk = await cartridge.getRiskInput(
        "payments.link.create",
        { amount: 75 },
        {},
      );
      expect(risk.baseRisk).toBe("low");
      expect(risk.exposure.dollarsAtRisk).toBe(75);
    });
  });

  describe("execution", () => {
    it("should create an invoice with undo recipe", async () => {
      const result = await cartridge.execute(
        "payments.invoice.create",
        { entityId: "cus_good_customer", amount: 250 },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("Invoice");
      expect(result.summary).toContain("$250");
      expect(result.externalRefs["invoiceId"]).toBeDefined();
      expect(result.rollbackAvailable).toBe(true);
      expect(result.undoRecipe).not.toBeNull();
      expect(result.undoRecipe!.reverseActionType).toBe("payments.invoice.void");
    });

    it("should void an invoice (undo of create)", async () => {
      // First create an invoice
      const created = await cartridge.execute(
        "payments.invoice.create",
        { entityId: "cus_good_customer", amount: 100 },
        ctx,
      );
      const invoiceId = created.externalRefs["invoiceId"]!;

      // Then void it
      const result = await cartridge.execute(
        "payments.invoice.void",
        { invoiceId },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("voided");
      expect(result.externalRefs["invoiceId"]).toBe(invoiceId);
      expect(result.rollbackAvailable).toBe(false);
      expect(result.undoRecipe).toBeNull();
    });

    it("should create a charge with undo recipe", async () => {
      const result = await cartridge.execute(
        "payments.charge.create",
        { entityId: "cus_good_customer", amount: 500, currency: "usd" },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("$500");
      expect(result.externalRefs["chargeId"]).toBeDefined();
      expect(result.rollbackAvailable).toBe(true);
      expect(result.undoRecipe).not.toBeNull();
      expect(result.undoRecipe!.reverseActionType).toBe("payments.refund.create");
      expect(result.undoRecipe!.undoApprovalRequired).toBe("mandatory");
    });

    it("should create a refund with no undo recipe", async () => {
      const result = await cartridge.execute(
        "payments.refund.create",
        { chargeId: "ch_1", amount: 100 },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("Refund");
      expect(result.summary).toContain("$100");
      expect(result.externalRefs["refundId"]).toBeDefined();
      expect(result.rollbackAvailable).toBe(false);
      expect(result.undoRecipe).toBeNull();
    });

    it("should cancel a subscription with no undo", async () => {
      const result = await cartridge.execute(
        "payments.subscription.cancel",
        { subscriptionId: "sub_1", cancelAtPeriodEnd: true },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("sub_1");
      expect(result.summary).toContain("period end");
      expect(result.rollbackAvailable).toBe(false);
      expect(result.undoRecipe).toBeNull();
    });

    it("should modify a subscription with undo recipe", async () => {
      const result = await cartridge.execute(
        "payments.subscription.modify",
        { subscriptionId: "sub_1", changes: { quantity: 5 } },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("modified");
      expect(result.rollbackAvailable).toBe(true);
      expect(result.undoRecipe).not.toBeNull();
      expect(result.undoRecipe!.reverseActionType).toBe("payments.subscription.modify");
      expect(result.undoRecipe!.undoApprovalRequired).toBe("standard");
    });

    it("should create a payment link with undo recipe", async () => {
      const result = await cartridge.execute(
        "payments.link.create",
        { amount: 100 },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("Payment link");
      expect(result.externalRefs["linkId"]).toBeDefined();
      expect(result.externalRefs["url"]).toBeDefined();
      expect(result.rollbackAvailable).toBe(true);
      expect(result.undoRecipe!.reverseActionType).toBe("payments.link.deactivate");
    });

    it("should deactivate a payment link (undo of create)", async () => {
      // First create a link
      const created = await cartridge.execute(
        "payments.link.create",
        { amount: 50 },
        ctx,
      );
      const linkId = created.externalRefs["linkId"]!;

      // Then deactivate it
      const result = await cartridge.execute(
        "payments.link.deactivate",
        { linkId },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("deactivated");
      expect(result.externalRefs["linkId"]).toBe(linkId);
      expect(result.rollbackAvailable).toBe(false);
    });

    it("should apply credit with undo recipe", async () => {
      const result = await cartridge.execute(
        "payments.credit.apply",
        { entityId: "cus_good_customer", amount: 25, description: "Loyalty bonus" },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("Credit");
      expect(result.summary).toContain("$25");
      expect(result.rollbackAvailable).toBe(true);
      expect(result.undoRecipe!.reverseActionType).toBe("payments.credit.apply");
    });

    it("should execute credit undo (debit) correctly without double-negation", async () => {
      // Apply credit
      const credit = await cartridge.execute(
        "payments.credit.apply",
        { entityId: "cus_good_customer", amount: 25, description: "Loyalty bonus" },
        ctx,
      );
      expect(credit.undoRecipe).not.toBeNull();
      const undoParams = credit.undoRecipe!.reverseParameters;
      expect(undoParams["amount"]).toBe(-25); // negative = debit

      // Execute the undo (debit)
      const debit = await cartridge.execute(
        "payments.credit.apply",
        undoParams,
        ctx,
      );
      expect(debit.success).toBe(true);
      expect(debit.summary).toContain("Debit");
      expect(debit.summary).toContain("$25");
      expect(debit.rollbackAvailable).toBe(false); // debits have no undo
      expect(debit.undoRecipe).toBeNull();
    });

    it("should execute batch invoicing with partial failure tracking", async () => {
      const result = await cartridge.execute(
        "payments.batch.invoice",
        {
          invoices: [
            { entityId: "cus_good_customer", amount: 100 },
            { entityId: "cus_frequent_refunder", amount: 200 },
          ],
        },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("2/2");
      expect(result.rollbackAvailable).toBe(false);
      expect(result.undoRecipe).toBeNull();
    });

    it("should fail for unknown action type", async () => {
      const result = await cartridge.execute("payments.unknown.action", {}, ctx);
      expect(result.success).toBe(false);
      expect(result.summary).toContain("Unknown action type");
    });

    it("should fail when required parameters are missing", async () => {
      const result = await cartridge.execute("payments.charge.create", {}, ctx);
      expect(result.success).toBe(false);
      expect(result.partialFailures.length).toBeGreaterThan(0);
    });
  });

  describe("amount validation", () => {
    it("should reject zero amount", async () => {
      const result = await cartridge.execute(
        "payments.charge.create",
        { entityId: "cus_good_customer", amount: 0 },
        ctx,
      );
      expect(result.success).toBe(false);
      expect(result.summary).toContain("positive");
    });

    it("should reject negative amount on charges", async () => {
      const result = await cartridge.execute(
        "payments.charge.create",
        { entityId: "cus_good_customer", amount: -100 },
        ctx,
      );
      expect(result.success).toBe(false);
      expect(result.summary).toContain("positive");
    });

    it("should reject NaN amount", async () => {
      const result = await cartridge.execute(
        "payments.invoice.create",
        { entityId: "cus_good_customer", amount: NaN },
        ctx,
      );
      expect(result.success).toBe(false);
      expect(result.summary).toContain("number");
    });

    it("should reject string amount", async () => {
      const result = await cartridge.execute(
        "payments.refund.create",
        { chargeId: "ch_1", amount: "500" },
        ctx,
      );
      expect(result.success).toBe(false);
      expect(result.summary).toContain("number");
    });

    it("should reject amount exceeding maximum", async () => {
      const result = await cartridge.execute(
        "payments.charge.create",
        { entityId: "cus_good_customer", amount: 1_000_000 },
        ctx,
      );
      expect(result.success).toBe(false);
      expect(result.summary).toContain("exceeds maximum");
    });

    it("should reject batch exceeding max size", async () => {
      const invoices = Array.from({ length: 51 }, (_, i) => ({
        entityId: `cus_${i}`,
        amount: 10,
      }));
      const result = await cartridge.execute(
        "payments.batch.invoice",
        { invoices },
        ctx,
      );
      expect(result.success).toBe(false);
      expect(result.summary).toContain("exceeds maximum");
    });

    it("should reject batch with invalid individual amounts", async () => {
      const result = await cartridge.execute(
        "payments.batch.invoice",
        {
          invoices: [
            { entityId: "cus_1", amount: 100 },
            { entityId: "cus_2", amount: -50 },
          ],
        },
        ctx,
      );
      expect(result.success).toBe(false);
      expect(result.summary).toContain("invoices[1]");
    });

    it("should allow negative amount for credit.apply (debit)", async () => {
      const result = await cartridge.execute(
        "payments.credit.apply",
        { entityId: "cus_good_customer", amount: -10, description: "Reversal" },
        ctx,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain("Debit");
    });
  });

  describe("guardrails", () => {
    it("should define rate limits for refunds, charges, batch, and global", () => {
      const guardrails = cartridge.getGuardrails();
      expect(guardrails.rateLimits.length).toBe(4);

      const refundLimit = guardrails.rateLimits.find((r) => r.scope === "payments.refund.create");
      expect(refundLimit?.maxActions).toBe(5);

      const chargeLimit = guardrails.rateLimits.find((r) => r.scope === "payments.charge.create");
      expect(chargeLimit?.maxActions).toBe(20);

      const batchLimit = guardrails.rateLimits.find((r) => r.scope === "payments.batch.invoice");
      expect(batchLimit?.maxActions).toBe(3);

      const globalLimit = guardrails.rateLimits.find((r) => r.scope === "global");
      expect(globalLimit?.maxActions).toBe(100);
    });

    it("should define cooldowns with customer scope for correct entityId resolution", () => {
      const guardrails = cartridge.getGuardrails();
      expect(guardrails.cooldowns.length).toBe(4);

      const chargeCooldown = guardrails.cooldowns.find((c) => c.actionType === "payments.charge.create");
      expect(chargeCooldown?.cooldownMs).toBe(30 * 60 * 1000);
      expect(chargeCooldown?.scope).toBe("customer");

      const refundCooldown = guardrails.cooldowns.find((c) => c.actionType === "payments.refund.create");
      expect(refundCooldown?.cooldownMs).toBe(4 * 60 * 60 * 1000);
      expect(refundCooldown?.scope).toBe("customer");

      // subscription.modify uses customer scope (core engine resolves entityId)
      const subCooldown = guardrails.cooldowns.find((c) => c.actionType === "payments.subscription.modify");
      expect(subCooldown?.cooldownMs).toBe(24 * 60 * 60 * 1000);
      expect(subCooldown?.scope).toBe("customer");

      const creditCooldown = guardrails.cooldowns.find((c) => c.actionType === "payments.credit.apply");
      expect(creditCooldown?.cooldownMs).toBe(60 * 60 * 1000);
      expect(creditCooldown?.scope).toBe("customer");
    });
  });

  describe("default policies", () => {
    it("should have 7 default policies", async () => {
      const { DEFAULT_PAYMENTS_POLICIES } = await import("../defaults/policies.js");
      expect(DEFAULT_PAYMENTS_POLICIES).toHaveLength(7);
    });

    it("should have mandatory approval for refunds", async () => {
      const { DEFAULT_PAYMENTS_POLICIES } = await import("../defaults/policies.js");
      const refundPolicy = DEFAULT_PAYMENTS_POLICIES.find(
        (p) => p.id === "payments-refund-mandatory-approval",
      );
      expect(refundPolicy?.effect).toBe("require_approval");
      expect(refundPolicy?.approvalRequirement).toBe("mandatory");
      expect(refundPolicy?.priority).toBe(1);
    });

    it("should have mandatory approval for subscription cancellation", async () => {
      const { DEFAULT_PAYMENTS_POLICIES } = await import("../defaults/policies.js");
      const cancelPolicy = DEFAULT_PAYMENTS_POLICIES.find(
        (p) => p.id === "payments-subscription-cancel-mandatory-approval",
      );
      expect(cancelPolicy?.effect).toBe("require_approval");
      expect(cancelPolicy?.approvalRequirement).toBe("mandatory");
    });

    it("should deny charges to disputed customers", async () => {
      const { DEFAULT_PAYMENTS_POLICIES } = await import("../defaults/policies.js");
      const denyPolicy = DEFAULT_PAYMENTS_POLICIES.find(
        (p) => p.id === "payments-deny-disputed-customer",
      );
      expect(denyPolicy?.effect).toBe("deny");
      const condition = denyPolicy?.rule.conditions?.find(
        (c: { field: string; value: unknown }) => c.field === "metadata.hasOpenDispute",
      );
      expect(condition?.value).toBe(true);
    });

    it("should escalate high-refund customers", async () => {
      const { DEFAULT_PAYMENTS_POLICIES } = await import("../defaults/policies.js");
      const escalatePolicy = DEFAULT_PAYMENTS_POLICIES.find(
        (p) => p.id === "payments-high-refund-customer-escalation",
      );
      expect(escalatePolicy?.effect).toBe("require_approval");
      expect(escalatePolicy?.approvalRequirement).toBe("elevated");
      const condition = escalatePolicy?.rule.conditions?.find(
        (c: { field: string; operator: string; value: unknown }) => c.field === "metadata.previousRefundCount",
      );
      expect(condition?.operator).toBe("gt");
      expect(condition?.value).toBe(3);
    });
  });

  describe("enrichContext", () => {
    it("should enrich with customer payment history data", async () => {
      const enriched = await cartridge.enrichContext(
        "payments.charge.create",
        { entityId: "cus_good_customer" },
        ctx,
      );
      expect(enriched["hasOpenDispute"]).toBe(false);
      expect(enriched["previousRefundCount"]).toBe(0);
      expect(typeof enriched["totalLifetimeSpend"]).toBe("number");
      expect(enriched["totalLifetimeSpend"]).toBeGreaterThan(0);
      expect(typeof enriched["daysSinceLastPayment"]).toBe("number");
      expect(typeof enriched["refundRate"]).toBe("number");
      expect(typeof enriched["disputeCount"]).toBe("number");
    });

    it("should detect open disputes on disputed customer", async () => {
      const enriched = await cartridge.enrichContext(
        "payments.charge.create",
        { entityId: "cus_disputed" },
        ctx,
      );
      expect(enriched["hasOpenDispute"]).toBe(true);
      expect(enriched["disputeCount"]).toBe(1);
    });

    it("should count refunds for frequent refunder", async () => {
      const enriched = await cartridge.enrichContext(
        "payments.charge.create",
        { entityId: "cus_frequent_refunder" },
        ctx,
      );
      expect(enriched["previousRefundCount"]).toBe(4);
    });

    it("should return empty object when no entityId", async () => {
      const enriched = await cartridge.enrichContext(
        "payments.link.create",
        { amount: 100 },
        ctx,
      );
      expect(Object.keys(enriched)).toHaveLength(0);
    });

    it("should include subscription tenure for subscription actions", async () => {
      const enriched = await cartridge.enrichContext(
        "payments.subscription.cancel",
        { entityId: "cus_good_customer", subscriptionId: "sub_1" },
        ctx,
      );
      expect(typeof enriched["subscriptionTenureMonths"]).toBe("number");
      expect(enriched["subscriptionTenureMonths"]).toBeGreaterThan(0);
    });

    it("should fail-closed with worst-case defaults when provider throws", async () => {
      // Create a cartridge with a provider that will fail on getPaymentHistory
      const failCartridge = new PaymentsCartridge();
      await failCartridge.initialize(ctx);
      const provider = failCartridge.getProvider();
      // Sabotage the provider to simulate Stripe API failure
      provider.getPaymentHistory = () => { throw new Error("Stripe API unreachable"); };

      const enriched = await failCartridge.enrichContext(
        "payments.charge.create",
        { entityId: "cus_good_customer" },
        ctx,
      );

      // Fail-closed: assume dispute exists, assume high refund count
      expect(enriched["hasOpenDispute"]).toBe(true);
      expect(enriched["previousRefundCount"]).toBe(Infinity);
      expect(enriched["_enrichmentFailed"]).toBe(true);
    });
  });

  describe("captureSnapshot", () => {
    it("should capture customer state for charge actions", async () => {
      const snapshot = await cartridge.captureSnapshot!(
        "payments.charge.create",
        { entityId: "cus_good_customer", amount: 100 },
        ctx,
      );
      expect(snapshot["capturedAt"]).toBeDefined();
      expect(snapshot["actionType"]).toBe("payments.charge.create");
      const customer = snapshot["customer"] as Record<string, unknown>;
      expect(customer["id"]).toBe("cus_good_customer");
      expect(customer["name"]).toBe("Alice Johnson");
    });

    it("should capture charge state before refund", async () => {
      const snapshot = await cartridge.captureSnapshot!(
        "payments.refund.create",
        { entityId: "cus_good_customer", chargeId: "ch_1", amount: 100 },
        ctx,
      );
      const charge = snapshot["charge"] as Record<string, unknown>;
      expect(charge["id"]).toBe("ch_1");
      expect(charge["amount"]).toBe(500); // $500 in dollars (50000 cents / 100)
      expect(charge["disputed"]).toBe(false);
    });

    it("should capture subscription state before cancel", async () => {
      const snapshot = await cartridge.captureSnapshot!(
        "payments.subscription.cancel",
        { entityId: "cus_good_customer", subscriptionId: "sub_1" },
        ctx,
      );
      const sub = snapshot["subscription"] as Record<string, unknown>;
      expect(sub["id"]).toBe("sub_1");
      expect(sub["status"]).toBe("active");
      expect(sub["cancelAtPeriodEnd"]).toBe(false);
    });

    it("should capture subscription state before modify", async () => {
      const snapshot = await cartridge.captureSnapshot!(
        "payments.subscription.modify",
        { entityId: "cus_good_customer", subscriptionId: "sub_1", changes: { quantity: 5 } },
        ctx,
      );
      const sub = snapshot["subscription"] as Record<string, unknown>;
      expect(sub["id"]).toBe("sub_1");
      const items = sub["items"] as Array<Record<string, unknown>>;
      expect(items[0]!["quantity"]).toBe(1); // pre-modification quantity
    });

    it("should return minimal snapshot when no entityId", async () => {
      const snapshot = await cartridge.captureSnapshot!(
        "payments.link.create",
        { amount: 100 },
        ctx,
      );
      expect(snapshot["capturedAt"]).toBeDefined();
      expect(snapshot["customer"]).toBeUndefined();
    });
  });

  describe("health check", () => {
    it("should report connected status", async () => {
      const health = await cartridge.healthCheck();
      expect(health.status).toBe("connected");
      expect(health.capabilities.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe("CartridgeTestHarness", () => {
    it("should pass all harness steps", async () => {
      const harness = new CartridgeTestHarness(cartridge, {
        context: ctx,
        actionType: "payments.invoice.create",
        parameters: { entityId: "cus_good_customer", amount: 100 },
      });
      const report = await harness.run();
      expect(report.passed).toBe(true);
      expect(report.cartridgeId).toBe("payments");
      for (const step of report.steps) {
        expect(step.passed).toBe(true);
      }
    });
  });
});
