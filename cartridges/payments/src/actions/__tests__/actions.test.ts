import { describe, it, expect } from "vitest";
import {
  buildInvoiceUndoRecipe,
  buildChargeUndoRecipe,
  buildSubscriptionModifyUndoRecipe,
  buildPaymentLinkUndoRecipe,
  buildCreditUndoRecipe,
} from "../index.js";

describe("undo recipe builders", () => {
  const envelopeId = "env_123";
  const actionId = "act_456";

  describe("buildInvoiceUndoRecipe", () => {
    it("should create a void-invoice undo recipe", () => {
      const recipe = buildInvoiceUndoRecipe("inv_1", envelopeId, actionId);

      expect(recipe.originalActionId).toBe(actionId);
      expect(recipe.originalEnvelopeId).toBe(envelopeId);
      expect(recipe.reverseActionType).toBe("payments.invoice.void");
      expect(recipe.reverseParameters).toEqual({ invoiceId: "inv_1" });
      expect(recipe.undoRiskCategory).toBe("low");
      expect(recipe.undoApprovalRequired).toBe("none");
    });

    it("should set expiry 24 hours in the future", () => {
      const before = Date.now();
      const recipe = buildInvoiceUndoRecipe("inv_1", envelopeId, actionId);
      const after = Date.now();

      const expiryMs = recipe.undoExpiresAt.getTime();
      const oneDayMs = 24 * 60 * 60 * 1000;
      expect(expiryMs).toBeGreaterThanOrEqual(before + oneDayMs);
      expect(expiryMs).toBeLessThanOrEqual(after + oneDayMs);
    });
  });

  describe("buildChargeUndoRecipe", () => {
    it("should create a refund undo recipe with critical risk", () => {
      const recipe = buildChargeUndoRecipe("ch_1", 500, envelopeId, actionId);

      expect(recipe.reverseActionType).toBe("payments.refund.create");
      expect(recipe.reverseParameters).toEqual({ chargeId: "ch_1", amount: 500 });
      expect(recipe.undoRiskCategory).toBe("critical");
      expect(recipe.undoApprovalRequired).toBe("mandatory");
    });
  });

  describe("buildSubscriptionModifyUndoRecipe", () => {
    it("should create a modify undo recipe with previous changes", () => {
      const prev = { priceId: "price_old", quantity: 2 };
      const recipe = buildSubscriptionModifyUndoRecipe("sub_1", prev, envelopeId, actionId);

      expect(recipe.reverseActionType).toBe("payments.subscription.modify");
      expect(recipe.reverseParameters).toEqual({ subscriptionId: "sub_1", changes: prev });
      expect(recipe.undoRiskCategory).toBe("medium");
      expect(recipe.undoApprovalRequired).toBe("standard");
    });
  });

  describe("buildPaymentLinkUndoRecipe", () => {
    it("should create a deactivate-link undo recipe", () => {
      const recipe = buildPaymentLinkUndoRecipe("plink_1", envelopeId, actionId);

      expect(recipe.reverseActionType).toBe("payments.link.deactivate");
      expect(recipe.reverseParameters).toEqual({ linkId: "plink_1" });
      expect(recipe.undoRiskCategory).toBe("low");
      expect(recipe.undoApprovalRequired).toBe("none");
    });
  });

  describe("buildCreditUndoRecipe", () => {
    it("should create a reverse-credit undo recipe", () => {
      const recipe = buildCreditUndoRecipe("cus_1", 100, envelopeId, actionId);

      expect(recipe.reverseActionType).toBe("payments.credit.apply");
      expect(recipe.reverseParameters).toEqual({
        entityId: "cus_1",
        amount: -100,
        description: "Reversal of credit",
      });
      expect(recipe.undoRiskCategory).toBe("medium");
      expect(recipe.undoApprovalRequired).toBe("standard");
    });
  });
});
