import { describe, it, expect, beforeEach } from "vitest";
import { QuantTradingCartridge } from "../index.js";
import type { CartridgeContext } from "@switchboard/cartridge-sdk";

describe("QuantTradingCartridge", () => {
  let cartridge: QuantTradingCartridge;
  const ctx: CartridgeContext = {
    principalId: "test_user",
    organizationId: null,
    connectionCredentials: {},
  };

  beforeEach(async () => {
    cartridge = new QuantTradingCartridge();
    await cartridge.initialize(ctx);
  });

  describe("manifest", () => {
    it("should have correct cartridge id", () => {
      expect(cartridge.manifest.id).toBe("quant-trading");
    });

    it("should define 8 actions", () => {
      expect(cartridge.manifest.actions).toHaveLength(8);
    });

    it("should have correct action types", () => {
      const types = cartridge.manifest.actions.map((a) => a.actionType);
      expect(types).toContain("trading.order.market_buy");
      expect(types).toContain("trading.order.market_sell");
      expect(types).toContain("trading.order.limit_buy");
      expect(types).toContain("trading.order.limit_sell");
      expect(types).toContain("trading.order.cancel");
      expect(types).toContain("trading.position.close");
      expect(types).toContain("trading.portfolio.rebalance");
      expect(types).toContain("trading.risk.set_stop_loss");
    });
  });

  describe("risk computation", () => {
    it("should compute critical risk for market buy with $50k exposure", async () => {
      const risk = await cartridge.getRiskInput(
        "trading.order.market_buy",
        { symbol: "AAPL", quantity: 285, portfolioId: "default" },
        {},
      );

      expect(risk.baseRisk).toBe("critical");
      // 285 * 175 = $49,875
      expect(risk.exposure.dollarsAtRisk).toBeGreaterThan(49_000);
      expect(risk.reversibility).toBe("none");
    });

    it("should compute medium risk for cancel order", async () => {
      const risk = await cartridge.getRiskInput(
        "trading.order.cancel",
        { orderId: "ord_1", portfolioId: "default" },
        {},
      );

      expect(risk.baseRisk).toBe("medium");
      expect(risk.exposure.dollarsAtRisk).toBe(0);
    });

    it("should compute full reversibility for limit orders", async () => {
      const risk = await cartridge.getRiskInput(
        "trading.order.limit_buy",
        { symbol: "AAPL", quantity: 10, limitPrice: 170, portfolioId: "default" },
        {},
      );

      expect(risk.baseRisk).toBe("high");
      expect(risk.reversibility).toBe("full");
      expect(risk.exposure.dollarsAtRisk).toBe(1700);
    });

    it("should compute critical risk for portfolio rebalance", async () => {
      const risk = await cartridge.getRiskInput(
        "trading.portfolio.rebalance",
        { portfolioId: "default", targetAllocations: {} },
        {},
      );

      expect(risk.baseRisk).toBe("critical");
      expect(risk.exposure.dollarsAtRisk).toBe(100_000);
      expect(risk.exposure.blastRadius).toBe(1);
    });
  });

  describe("execution", () => {
    it("should execute market buy order", async () => {
      const result = await cartridge.execute(
        "trading.order.market_buy",
        { symbol: "AAPL", quantity: 10, portfolioId: "default" },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.summary).toContain("BUY");
      expect(result.summary).toContain("AAPL");
      expect(result.externalRefs["orderId"]).toBeDefined();
      expect(result.rollbackAvailable).toBe(false);
      expect(result.undoRecipe).toBeNull();
    });

    it("should execute limit buy with undo recipe", async () => {
      const result = await cartridge.execute(
        "trading.order.limit_buy",
        { symbol: "GOOGL", quantity: 5, limitPrice: 155, portfolioId: "default" },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.summary).toContain("LIMIT BUY");
      expect(result.rollbackAvailable).toBe(true);
      expect(result.undoRecipe).not.toBeNull();
      expect(result.undoRecipe!.reverseActionType).toBe("trading.order.cancel");
    });

    it("should cancel an open order", async () => {
      // First place a limit order
      const order = await cartridge.execute(
        "trading.order.limit_buy",
        { symbol: "TSLA", quantity: 1, limitPrice: 240, portfolioId: "default" },
        ctx,
      );

      // Then cancel it
      const cancel = await cartridge.execute(
        "trading.order.cancel",
        { orderId: order.externalRefs["orderId"], portfolioId: "default" },
        ctx,
      );

      expect(cancel.success).toBe(true);
      expect(cancel.summary).toContain("cancelled");
    });

    it("should close a position", async () => {
      const result = await cartridge.execute(
        "trading.position.close",
        { symbol: "AAPL", portfolioId: "default" },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.summary).toContain("Position closed");
      expect(result.summary).toContain("AAPL");
    });

    it("should fail to close non-existent position", async () => {
      const result = await cartridge.execute(
        "trading.position.close",
        { symbol: "NONEXIST", portfolioId: "default" },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.summary).toContain("No position found");
    });

    it("should set stop loss with undo recipe", async () => {
      const result = await cartridge.execute(
        "trading.risk.set_stop_loss",
        { symbol: "AAPL", portfolioId: "default", stopPrice: 160 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.summary).toContain("Stop loss");
      expect(result.undoRecipe).not.toBeNull();
    });
  });

  describe("guardrails", () => {
    it("should return rate limits", () => {
      const guardrails = cartridge.getGuardrails();
      expect(guardrails.rateLimits.length).toBeGreaterThan(0);
      // Global rate limit: 10 orders per minute
      const globalLimit = guardrails.rateLimits.find((r) => r.scope === "global");
      expect(globalLimit?.maxActions).toBe(10);
      expect(globalLimit?.windowMs).toBe(60_000);
    });

    it("should have cooldowns for market orders", () => {
      const guardrails = cartridge.getGuardrails();
      const buyCooldown = guardrails.cooldowns.find((c) => c.actionType === "trading.order.market_buy");
      expect(buyCooldown?.cooldownMs).toBe(30_000);
    });
  });

  describe("health check", () => {
    it("should report connected status", async () => {
      const health = await cartridge.healthCheck();
      expect(health.status).toBe("connected");
      expect(health.capabilities.length).toBeGreaterThan(0);
    });
  });

  describe("enrichContext", () => {
    it("should enrich with market price and portfolio data", async () => {
      const enriched = await cartridge.enrichContext(
        "trading.order.market_buy",
        { symbol: "AAPL", portfolioId: "default" },
        ctx,
      );

      expect(enriched["currentPrice"]).toBe(175);
      expect(enriched["portfolioValue"]).toBe(100_000);
      expect(enriched["cashBalance"]).toBe(50_000);
    });
  });
});
