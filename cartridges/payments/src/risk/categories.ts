import type { RiskInput } from "@switchboard/schemas";

export function computeInvoiceRiskInput(amountDollars: number): RiskInput {
  return {
    baseRisk: "low",
    exposure: {
      dollarsAtRisk: amountDollars,
      blastRadius: 1,
    },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

export function computeChargeRiskInput(amountDollars: number): RiskInput {
  const baseRisk = amountDollars > 1000 ? "critical" as const : "high" as const;
  return {
    baseRisk,
    exposure: {
      dollarsAtRisk: amountDollars,
      blastRadius: 1,
    },
    reversibility: "partial", // refund loses fees
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

export function computeRefundRiskInput(amountDollars: number): RiskInput {
  return {
    baseRisk: "critical",
    exposure: {
      dollarsAtRisk: amountDollars,
      blastRadius: 1,
    },
    reversibility: "none",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

export function computeSubscriptionCancelRiskInput(
  monthlyAmountDollars: number,
): RiskInput {
  // dollarsAtRisk = 12 months projected MRR loss
  const projectedLoss = monthlyAmountDollars * 12;
  return {
    baseRisk: "high",
    exposure: {
      dollarsAtRisk: projectedLoss,
      blastRadius: 1,
    },
    reversibility: "partial", // pricing may change on re-subscribe
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

export function computeSubscriptionModifyRiskInput(
  annualizedDelta: number,
): RiskInput {
  return {
    baseRisk: "medium",
    exposure: {
      dollarsAtRisk: Math.abs(annualizedDelta),
      blastRadius: 1,
    },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

export function computePaymentLinkRiskInput(amountDollars: number): RiskInput {
  return {
    baseRisk: "low",
    exposure: {
      dollarsAtRisk: amountDollars,
      blastRadius: 1,
    },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

export function computeCreditRiskInput(amountDollars: number): RiskInput {
  return {
    baseRisk: "medium",
    exposure: {
      dollarsAtRisk: Math.abs(amountDollars),
      blastRadius: 1,
    },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

export function computeBatchInvoiceRiskInput(
  totalAmountDollars: number,
  invoiceCount: number,
): RiskInput {
  return {
    baseRisk: "high",
    exposure: {
      dollarsAtRisk: totalAmountDollars,
      blastRadius: invoiceCount,
    },
    reversibility: "full", // each invoice can be voided
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}
