import type {
  CartridgeManifest,
  ConnectionHealth,
  GuardrailConfig,
  RiskInput,
} from "@switchboard/schemas";
import type { Cartridge, CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";
import { QUANT_TRADING_MANIFEST } from "./manifest.js";
import type { TradingProvider } from "./providers/trading.js";
import { MockTradingProvider } from "./providers/trading.js";
import { DEFAULT_TRADING_GUARDRAILS } from "./defaults/guardrails.js";
import {
  computeMarketOrderRisk,
  computeLimitOrderRisk,
  computeCancelOrderRisk,
  computeClosePositionRisk,
  computeRebalanceRisk,
  computeStopLossRisk,
} from "./risk/categories.js";
import {
  buildLimitOrderUndoRecipe,
  buildStopLossUndoRecipe,
} from "./actions/index.js";

export class QuantTradingCartridge implements Cartridge {
  readonly manifest: CartridgeManifest = QUANT_TRADING_MANIFEST;
  private provider: TradingProvider | null = null;

  private validateRequired(
    parameters: Record<string, unknown>,
    fields: Array<{ name: string; type: "string" | "number" }>,
  ): { valid: true } | { valid: false; result: ExecuteResult } {
    for (const field of fields) {
      const value = parameters[field.name];
      if (value === undefined || value === null) {
        return {
          valid: false,
          result: {
            success: false,
            summary: `Missing required parameter: ${field.name}`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [{ step: "validation", error: `Missing required parameter: ${field.name}` }],
            durationMs: 0,
            undoRecipe: null,
          },
        };
      }
      if (field.type === "number" && (typeof value !== "number" || isNaN(value))) {
        return {
          valid: false,
          result: {
            success: false,
            summary: `Parameter ${field.name} must be a valid number`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [{ step: "validation", error: `Parameter ${field.name} must be a valid number` }],
            durationMs: 0,
            undoRecipe: null,
          },
        };
      }
      if (field.type === "string" && typeof value !== "string") {
        return {
          valid: false,
          result: {
            success: false,
            summary: `Parameter ${field.name} must be a string`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [{ step: "validation", error: `Parameter ${field.name} must be a string` }],
            durationMs: 0,
            undoRecipe: null,
          },
        };
      }
    }
    return { valid: true };
  }

  async initialize(_context: CartridgeContext): Promise<void> {
    // In production, this would create a broker API client from credentials.
    // For now, use mock provider.
    this.provider = new MockTradingProvider();
  }

  /** @internal Package-only access to the trading provider. */
  getProvider(): TradingProvider {
    if (!this.provider) throw new Error("Cartridge not initialized");
    return this.provider;
  }

  async enrichContext(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    const provider = this.getProvider();
    const symbol = parameters["symbol"] as string | undefined;
    const portfolioId = parameters["portfolioId"] as string | undefined ?? "default";

    const enriched: Record<string, unknown> = {};

    if (symbol) {
      try {
        const price = await provider.getMarketPrice(symbol);
        enriched["currentPrice"] = price.price;
        enriched["bid"] = price.bid;
        enriched["ask"] = price.ask;
        enriched["volume"] = price.volume;
      } catch {
        // Non-critical enrichment failure
      }
    }

    try {
      const portfolio = await provider.getPortfolio(portfolioId);
      enriched["portfolioValue"] = portfolio.totalValue;
      enriched["cashBalance"] = portfolio.cashBalance;
    } catch {
      // Non-critical enrichment failure
    }

    // Compute dollarsAtRisk for policy evaluation
    const quantity = typeof parameters["quantity"] === "number" ? parameters["quantity"] : 0;
    const limitPrice = typeof parameters["limitPrice"] === "number" ? parameters["limitPrice"] : 0;
    const currentPrice = typeof enriched["currentPrice"] === "number" ? enriched["currentPrice"] : 0;

    if (limitPrice > 0 && quantity > 0) {
      enriched["dollarsAtRisk"] = quantity * limitPrice;
    } else if (currentPrice > 0 && quantity > 0) {
      enriched["dollarsAtRisk"] = quantity * currentPrice;
    }

    return enriched;
  }

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<ExecuteResult> {
    const provider = this.getProvider();
    const start = Date.now();

    switch (actionType) {
      case "trading.order.market_buy":
      case "trading.order.market_sell": {
        const validation = this.validateRequired(parameters, [
          { name: "symbol", type: "string" },
          { name: "quantity", type: "number" },
        ]);
        if (!validation.valid) return validation.result;

        const symbol = parameters["symbol"] as string;
        const quantity = parameters["quantity"] as number;
        const portfolioId = parameters["portfolioId"] as string ?? "default";
        const side = actionType === "trading.order.market_buy" ? "buy" : "sell";

        const result = await provider.placeOrder({
          symbol, side, type: "market", quantity, portfolioId,
        });

        return {
          success: result.status === "filled",
          summary: `${side.toUpperCase()} ${quantity} ${symbol} @ $${result.filledPrice.toFixed(2)} (${result.status})`,
          externalRefs: { orderId: result.orderId, symbol },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
        };
      }

      case "trading.order.limit_buy":
      case "trading.order.limit_sell": {
        const validation = this.validateRequired(parameters, [
          { name: "symbol", type: "string" },
          { name: "quantity", type: "number" },
          { name: "limitPrice", type: "number" },
        ]);
        if (!validation.valid) return validation.result;

        const symbol = parameters["symbol"] as string;
        const quantity = parameters["quantity"] as number;
        const limitPrice = parameters["limitPrice"] as number;
        const portfolioId = parameters["portfolioId"] as string ?? "default";
        const side = actionType === "trading.order.limit_buy" ? "buy" : "sell";

        const result = await provider.placeOrder({
          symbol, side, type: "limit", quantity, limitPrice, portfolioId,
        });

        return {
          success: true,
          summary: `LIMIT ${side.toUpperCase()} ${quantity} ${symbol} @ $${limitPrice.toFixed(2)} (${result.status})`,
          externalRefs: { orderId: result.orderId, symbol },
          rollbackAvailable: true,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: buildLimitOrderUndoRecipe(
            result.orderId,
            parameters["_envelopeId"] as string ?? "unknown",
            parameters["_actionId"] as string ?? "unknown",
          ),
        };
      }

      case "trading.order.cancel": {
        const validation = this.validateRequired(parameters, [
          { name: "orderId", type: "string" },
        ]);
        if (!validation.valid) return validation.result;

        const orderId = parameters["orderId"] as string;
        const result = await provider.cancelOrder(orderId);

        return {
          success: result.success,
          summary: result.success
            ? `Order ${orderId} cancelled`
            : `Failed to cancel order ${orderId}`,
          externalRefs: { orderId },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
        };
      }

      case "trading.position.close": {
        const validation = this.validateRequired(parameters, [
          { name: "symbol", type: "string" },
        ]);
        if (!validation.valid) return validation.result;

        const symbol = parameters["symbol"] as string;
        const portfolioId = parameters["portfolioId"] as string ?? "default";
        const positions = await provider.getPositions(portfolioId);
        const position = positions.find((p) => p.symbol === symbol);

        if (!position) {
          return {
            success: false,
            summary: `No position found for ${symbol}`,
            externalRefs: { symbol },
            rollbackAvailable: false,
            partialFailures: [{ step: "lookup", error: "Position not found" }],
            durationMs: Date.now() - start,
            undoRecipe: null,
          };
        }

        const result = await provider.placeOrder({
          symbol, side: "sell", type: "market",
          quantity: position.quantity, portfolioId,
        });

        return {
          success: result.status === "filled",
          summary: `Position closed: SELL ${position.quantity} ${symbol} @ $${result.filledPrice.toFixed(2)}`,
          externalRefs: { orderId: result.orderId, symbol },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
        };
      }

      case "trading.portfolio.rebalance": {
        const portfolioId = parameters["portfolioId"] as string ?? "default";
        const portfolio = await provider.getPortfolio(portfolioId);

        return {
          success: true,
          summary: `Portfolio ${portfolioId} rebalance initiated (value: $${portfolio.totalValue.toFixed(2)})`,
          externalRefs: { portfolioId },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
        };
      }

      case "trading.risk.set_stop_loss": {
        const validation = this.validateRequired(parameters, [
          { name: "symbol", type: "string" },
          { name: "stopPrice", type: "number" },
        ]);
        if (!validation.valid) return validation.result;

        const symbol = parameters["symbol"] as string;
        const stopPrice = parameters["stopPrice"] as number;
        const portfolioId = parameters["portfolioId"] as string ?? "default";

        const result = await provider.setStopLoss({ symbol, portfolioId, stopPrice });

        return {
          success: result.success,
          summary: `Stop loss set for ${symbol} at $${stopPrice.toFixed(2)}`,
          externalRefs: { orderId: result.orderId, symbol },
          rollbackAvailable: true,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: buildStopLossUndoRecipe(
            result.orderId,
            parameters["_envelopeId"] as string ?? "unknown",
            parameters["_actionId"] as string ?? "unknown",
          ),
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
    const provider = this.getProvider();

    switch (actionType) {
      case "trading.order.market_buy":
      case "trading.order.market_sell":
        return computeMarketOrderRisk(
          {
            symbol: parameters["symbol"] as string,
            quantity: parameters["quantity"] as number,
            portfolioId: parameters["portfolioId"] as string ?? "default",
          },
          provider,
        );

      case "trading.order.limit_buy":
      case "trading.order.limit_sell":
        return computeLimitOrderRisk(
          {
            symbol: parameters["symbol"] as string,
            quantity: parameters["quantity"] as number,
            limitPrice: parameters["limitPrice"] as number,
            portfolioId: parameters["portfolioId"] as string ?? "default",
          },
          provider,
        );

      case "trading.order.cancel":
        return computeCancelOrderRisk();

      case "trading.position.close":
        return computeClosePositionRisk(
          {
            symbol: parameters["symbol"] as string,
            portfolioId: parameters["portfolioId"] as string ?? "default",
          },
          provider,
        );

      case "trading.portfolio.rebalance":
        return computeRebalanceRisk(
          { portfolioId: parameters["portfolioId"] as string ?? "default" },
          provider,
        );

      case "trading.risk.set_stop_loss":
        return computeStopLossRisk();

      default:
        return {
          baseRisk: "medium",
          exposure: { dollarsAtRisk: 0, blastRadius: 0 },
          reversibility: "none",
          sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
        };
    }
  }

  getGuardrails(): GuardrailConfig {
    return DEFAULT_TRADING_GUARDRAILS;
  }

  async healthCheck(): Promise<ConnectionHealth> {
    const provider = this.getProvider();
    const result = await provider.healthCheck();
    return {
      status: result.status,
      latencyMs: result.latencyMs,
      error: null,
      capabilities: [
        "placeOrder", "cancelOrder", "getPositions",
        "getPortfolio", "getMarketPrice", "setStopLoss",
      ],
    };
  }
}

export { QUANT_TRADING_MANIFEST } from "./manifest.js";
export { DEFAULT_TRADING_GUARDRAILS } from "./defaults/guardrails.js";
export { DEFAULT_TRADING_POLICIES } from "./defaults/policies.js";
export type { TradingProvider, OrderResult, Position, Portfolio, MarketPrice } from "./providers/trading.js";
export { MockTradingProvider } from "./providers/trading.js";
export { bootstrapQuantTradingCartridge } from "./bootstrap.js";
export type { BootstrapQuantTradingResult } from "./bootstrap.js";
