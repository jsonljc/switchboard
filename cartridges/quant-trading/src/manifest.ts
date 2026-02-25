import type { CartridgeManifest } from "@switchboard/schemas";

export const QUANT_TRADING_MANIFEST: CartridgeManifest = {
  id: "quant-trading",
  name: "Quant Trading",
  version: "1.0.0",
  description: "Quantitative trading order management with full governance controls",
  actions: [
    {
      actionType: "trading.order.market_buy",
      name: "Market Buy Order",
      description: "Place a market buy order — executes immediately at best available price",
      parametersSchema: {
        symbol: { type: "string" },
        quantity: { type: "number" },
        portfolioId: { type: "string" },
      },
      baseRiskCategory: "critical",
      reversible: false,
    },
    {
      actionType: "trading.order.market_sell",
      name: "Market Sell Order",
      description: "Place a market sell order — executes immediately at best available price",
      parametersSchema: {
        symbol: { type: "string" },
        quantity: { type: "number" },
        portfolioId: { type: "string" },
      },
      baseRiskCategory: "critical",
      reversible: false,
    },
    {
      actionType: "trading.order.limit_buy",
      name: "Limit Buy Order",
      description: "Place a limit buy order — cancellable before fill",
      parametersSchema: {
        symbol: { type: "string" },
        quantity: { type: "number" },
        limitPrice: { type: "number" },
        portfolioId: { type: "string" },
        timeInForce: { type: "string" },
      },
      baseRiskCategory: "high",
      reversible: true,
    },
    {
      actionType: "trading.order.limit_sell",
      name: "Limit Sell Order",
      description: "Place a limit sell order — cancellable before fill",
      parametersSchema: {
        symbol: { type: "string" },
        quantity: { type: "number" },
        limitPrice: { type: "number" },
        portfolioId: { type: "string" },
        timeInForce: { type: "string" },
      },
      baseRiskCategory: "high",
      reversible: true,
    },
    {
      actionType: "trading.order.cancel",
      name: "Cancel Order",
      description: "Cancel an open order",
      parametersSchema: {
        orderId: { type: "string" },
        portfolioId: { type: "string" },
      },
      baseRiskCategory: "medium",
      reversible: false,
    },
    {
      actionType: "trading.position.close",
      name: "Close Position",
      description: "Close an entire position in a symbol",
      parametersSchema: {
        symbol: { type: "string" },
        portfolioId: { type: "string" },
      },
      baseRiskCategory: "critical",
      reversible: false,
    },
    {
      actionType: "trading.portfolio.rebalance",
      name: "Rebalance Portfolio",
      description: "Rebalance portfolio to target allocations — may generate multiple orders",
      parametersSchema: {
        portfolioId: { type: "string" },
        targetAllocations: { type: "object" },
      },
      baseRiskCategory: "critical",
      reversible: false,
    },
    {
      actionType: "trading.risk.set_stop_loss",
      name: "Set Stop Loss",
      description: "Set or update stop-loss on a position",
      parametersSchema: {
        symbol: { type: "string" },
        portfolioId: { type: "string" },
        stopPrice: { type: "number" },
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
  ],
  requiredConnections: ["broker-api"],
  defaultPolicies: ["quant-trading-default"],
};
