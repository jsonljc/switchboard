import type { RiskInput } from "@switchboard/schemas";
import type { TradingProvider } from "../providers/trading.js";

export async function computeMarketOrderRisk(
  params: { symbol: string; quantity: number; portfolioId: string },
  provider: TradingProvider,
): Promise<RiskInput> {
  const [price, portfolio] = await Promise.all([
    provider.getMarketPrice(params.symbol),
    provider.getPortfolio(params.portfolioId),
  ]);

  const dollarsAtRisk = params.quantity * price.price;
  const blastRadius = portfolio.totalValue > 0
    ? dollarsAtRisk / portfolio.totalValue
    : 1;

  return {
    baseRisk: "critical",
    exposure: { dollarsAtRisk, blastRadius },
    reversibility: "none",
    sensitivity: {
      entityVolatile: price.volume > 100_000_000,
      learningPhase: false,
      recentlyModified: false,
    },
  };
}

export async function computeLimitOrderRisk(
  params: { symbol: string; quantity: number; limitPrice: number; portfolioId: string },
  provider: TradingProvider,
): Promise<RiskInput> {
  const portfolio = await provider.getPortfolio(params.portfolioId);

  const dollarsAtRisk = params.quantity * params.limitPrice;
  const blastRadius = portfolio.totalValue > 0
    ? dollarsAtRisk / portfolio.totalValue
    : 1;

  return {
    baseRisk: "high",
    exposure: { dollarsAtRisk, blastRadius },
    reversibility: "full",
    sensitivity: {
      entityVolatile: false,
      learningPhase: false,
      recentlyModified: false,
    },
  };
}

export function computeCancelOrderRisk(): RiskInput {
  return {
    baseRisk: "medium",
    exposure: { dollarsAtRisk: 0, blastRadius: 0 },
    reversibility: "none",
    sensitivity: {
      entityVolatile: false,
      learningPhase: false,
      recentlyModified: false,
    },
  };
}

export async function computeClosePositionRisk(
  params: { symbol: string; portfolioId: string },
  provider: TradingProvider,
): Promise<RiskInput> {
  const [positions, portfolio] = await Promise.all([
    provider.getPositions(params.portfolioId),
    provider.getPortfolio(params.portfolioId),
  ]);

  const position = positions.find((p) => p.symbol === params.symbol);
  const dollarsAtRisk = position ? position.marketValue : 0;
  const blastRadius = portfolio.totalValue > 0
    ? dollarsAtRisk / portfolio.totalValue
    : 1;

  return {
    baseRisk: "critical",
    exposure: { dollarsAtRisk, blastRadius },
    reversibility: "none",
    sensitivity: {
      entityVolatile: false,
      learningPhase: false,
      recentlyModified: false,
    },
  };
}

export async function computeRebalanceRisk(
  params: { portfolioId: string },
  provider: TradingProvider,
): Promise<RiskInput> {
  const portfolio = await provider.getPortfolio(params.portfolioId);

  return {
    baseRisk: "critical",
    exposure: {
      dollarsAtRisk: portfolio.totalValue,
      blastRadius: 1,
    },
    reversibility: "none",
    sensitivity: {
      entityVolatile: false,
      learningPhase: false,
      recentlyModified: false,
    },
  };
}

export function computeStopLossRisk(): RiskInput {
  return {
    baseRisk: "medium",
    exposure: { dollarsAtRisk: 0, blastRadius: 0 },
    reversibility: "full",
    sensitivity: {
      entityVolatile: false,
      learningPhase: false,
      recentlyModified: false,
    },
  };
}
