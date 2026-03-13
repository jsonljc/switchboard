import { describe, it, expect } from "vitest";
import {
  computeInvoiceRiskInput,
  computeChargeRiskInput,
  computeRefundRiskInput,
  computeSubscriptionCancelRiskInput,
  computeSubscriptionModifyRiskInput,
  computePaymentLinkRiskInput,
  computeCreditRiskInput,
  computeBatchInvoiceRiskInput,
} from "../categories.js";

describe("risk category functions", () => {
  describe("computeInvoiceRiskInput", () => {
    it("should return low base risk with full reversibility", () => {
      const risk = computeInvoiceRiskInput(500);
      expect(risk.baseRisk).toBe("low");
      expect(risk.exposure.dollarsAtRisk).toBe(500);
      expect(risk.exposure.blastRadius).toBe(1);
      expect(risk.reversibility).toBe("full");
    });
  });

  describe("computeChargeRiskInput", () => {
    it("should return high risk for amounts <= 1000", () => {
      const risk = computeChargeRiskInput(999);
      expect(risk.baseRisk).toBe("high");
      expect(risk.reversibility).toBe("partial");
    });

    it("should return high risk for exactly 1000", () => {
      const risk = computeChargeRiskInput(1000);
      expect(risk.baseRisk).toBe("high");
    });

    it("should return critical risk for amounts > 1000", () => {
      const risk = computeChargeRiskInput(1001);
      expect(risk.baseRisk).toBe("critical");
      expect(risk.exposure.dollarsAtRisk).toBe(1001);
    });
  });

  describe("computeRefundRiskInput", () => {
    it("should always return critical risk with no reversibility", () => {
      const risk = computeRefundRiskInput(100);
      expect(risk.baseRisk).toBe("critical");
      expect(risk.reversibility).toBe("none");
      expect(risk.exposure.dollarsAtRisk).toBe(100);
    });
  });

  describe("computeSubscriptionCancelRiskInput", () => {
    it("should project 12-month MRR loss", () => {
      const risk = computeSubscriptionCancelRiskInput(49);
      expect(risk.baseRisk).toBe("high");
      expect(risk.exposure.dollarsAtRisk).toBe(49 * 12);
      expect(risk.reversibility).toBe("partial");
    });
  });

  describe("computeSubscriptionModifyRiskInput", () => {
    it("should use absolute value of delta", () => {
      const risk = computeSubscriptionModifyRiskInput(-200);
      expect(risk.baseRisk).toBe("medium");
      expect(risk.exposure.dollarsAtRisk).toBe(200);
      expect(risk.reversibility).toBe("full");
    });

    it("should handle positive delta", () => {
      const risk = computeSubscriptionModifyRiskInput(300);
      expect(risk.exposure.dollarsAtRisk).toBe(300);
    });
  });

  describe("computePaymentLinkRiskInput", () => {
    it("should return low risk with full reversibility", () => {
      const risk = computePaymentLinkRiskInput(250);
      expect(risk.baseRisk).toBe("low");
      expect(risk.exposure.dollarsAtRisk).toBe(250);
      expect(risk.reversibility).toBe("full");
    });
  });

  describe("computeCreditRiskInput", () => {
    it("should return medium risk with absolute dollar amount", () => {
      const risk = computeCreditRiskInput(-50);
      expect(risk.baseRisk).toBe("medium");
      expect(risk.exposure.dollarsAtRisk).toBe(50);
      expect(risk.reversibility).toBe("full");
    });
  });

  describe("computeBatchInvoiceRiskInput", () => {
    it("should set blast radius to invoice count", () => {
      const risk = computeBatchInvoiceRiskInput(5000, 10);
      expect(risk.baseRisk).toBe("high");
      expect(risk.exposure.dollarsAtRisk).toBe(5000);
      expect(risk.exposure.blastRadius).toBe(10);
      expect(risk.reversibility).toBe("full");
    });
  });

  describe("common sensitivity fields", () => {
    it("all risk functions should set sensitivity flags to false", () => {
      const fns = [
        () => computeInvoiceRiskInput(100),
        () => computeChargeRiskInput(100),
        () => computeRefundRiskInput(100),
        () => computeSubscriptionCancelRiskInput(100),
        () => computeSubscriptionModifyRiskInput(100),
        () => computePaymentLinkRiskInput(100),
        () => computeCreditRiskInput(100),
        () => computeBatchInvoiceRiskInput(100, 1),
      ];
      for (const fn of fns) {
        const risk = fn();
        expect(risk.sensitivity).toEqual({
          entityVolatile: false,
          learningPhase: false,
          recentlyModified: false,
        });
      }
    });
  });
});
