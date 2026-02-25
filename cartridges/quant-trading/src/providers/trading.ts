export interface OrderResult {
  orderId: string;
  status: "filled" | "pending" | "cancelled" | "rejected";
  filledQuantity: number;
  filledPrice: number;
  timestamp: Date;
}

export interface Position {
  symbol: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  unrealizedPnl: number;
  marketValue: number;
}

export interface Portfolio {
  id: string;
  totalValue: number;
  cashBalance: number;
  positions: Position[];
}

export interface MarketPrice {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: Date;
}

export interface OrderStatus {
  orderId: string;
  status: "open" | "filled" | "cancelled" | "rejected" | "partial";
  filledQuantity: number;
  remainingQuantity: number;
  averagePrice: number;
}

export interface TradingProvider {
  placeOrder(params: {
    symbol: string;
    side: "buy" | "sell";
    type: "market" | "limit";
    quantity: number;
    limitPrice?: number;
    timeInForce?: string;
    portfolioId: string;
  }): Promise<OrderResult>;

  cancelOrder(orderId: string): Promise<{ success: boolean; orderId: string }>;

  getPositions(portfolioId: string): Promise<Position[]>;

  getPortfolio(portfolioId: string): Promise<Portfolio>;

  getOrderStatus(orderId: string): Promise<OrderStatus>;

  getMarketPrice(symbol: string): Promise<MarketPrice>;

  setStopLoss(params: {
    symbol: string;
    portfolioId: string;
    stopPrice: number;
  }): Promise<{ success: boolean; orderId: string }>;

  healthCheck(): Promise<{ status: "connected" | "degraded" | "disconnected"; latencyMs: number }>;
}

/**
 * Mock trading provider for testing and development.
 */
export class MockTradingProvider implements TradingProvider {
  private orders = new Map<string, OrderStatus>();
  private positions = new Map<string, Position[]>();
  private portfolios = new Map<string, Portfolio>();
  private prices = new Map<string, MarketPrice>();
  private orderCounter = 0;

  constructor() {
    // Seed some default data
    const defaultPortfolio: Portfolio = {
      id: "default",
      totalValue: 100_000,
      cashBalance: 50_000,
      positions: [
        {
          symbol: "AAPL",
          quantity: 100,
          averageCost: 150,
          currentPrice: 175,
          unrealizedPnl: 2500,
          marketValue: 17500,
        },
        {
          symbol: "GOOGL",
          quantity: 50,
          averageCost: 140,
          currentPrice: 160,
          unrealizedPnl: 1000,
          marketValue: 8000,
        },
      ],
    };
    this.portfolios.set("default", defaultPortfolio);
    this.positions.set("default", defaultPortfolio.positions);

    this.prices.set("AAPL", {
      symbol: "AAPL", price: 175, bid: 174.95, ask: 175.05,
      volume: 50_000_000, timestamp: new Date(),
    });
    this.prices.set("GOOGL", {
      symbol: "GOOGL", price: 160, bid: 159.90, ask: 160.10,
      volume: 30_000_000, timestamp: new Date(),
    });
    this.prices.set("TSLA", {
      symbol: "TSLA", price: 250, bid: 249.80, ask: 250.20,
      volume: 80_000_000, timestamp: new Date(),
    });
  }

  async placeOrder(params: {
    symbol: string;
    side: "buy" | "sell";
    type: "market" | "limit";
    quantity: number;
    limitPrice?: number;
    portfolioId: string;
  }): Promise<OrderResult> {
    this.orderCounter++;
    const orderId = `ord_${this.orderCounter}`;
    const price = params.type === "market"
      ? (this.prices.get(params.symbol)?.price ?? 100)
      : (params.limitPrice ?? 100);

    const status: OrderStatus = {
      orderId,
      status: params.type === "market" ? "filled" : "open",
      filledQuantity: params.type === "market" ? params.quantity : 0,
      remainingQuantity: params.type === "market" ? 0 : params.quantity,
      averagePrice: price,
    };
    this.orders.set(orderId, status);

    return {
      orderId,
      status: params.type === "market" ? "filled" : "pending",
      filledQuantity: status.filledQuantity,
      filledPrice: price,
      timestamp: new Date(),
    };
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean; orderId: string }> {
    const order = this.orders.get(orderId);
    if (!order || order.status !== "open") {
      return { success: false, orderId };
    }
    order.status = "cancelled";
    return { success: true, orderId };
  }

  async getPositions(portfolioId: string): Promise<Position[]> {
    return this.positions.get(portfolioId) ?? [];
  }

  async getPortfolio(portfolioId: string): Promise<Portfolio> {
    return this.portfolios.get(portfolioId) ?? {
      id: portfolioId, totalValue: 0, cashBalance: 0, positions: [],
    };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Order not found: ${orderId}`);
    return order;
  }

  async getMarketPrice(symbol: string): Promise<MarketPrice> {
    const price = this.prices.get(symbol);
    if (!price) {
      return {
        symbol, price: 100, bid: 99.95, ask: 100.05,
        volume: 10_000_000, timestamp: new Date(),
      };
    }
    return price;
  }

  async setStopLoss(params: {
    symbol: string;
    portfolioId: string;
    stopPrice: number;
  }): Promise<{ success: boolean; orderId: string }> {
    this.orderCounter++;
    const orderId = `sl_${this.orderCounter}`;
    this.orders.set(orderId, {
      orderId,
      status: "open",
      filledQuantity: 0,
      remainingQuantity: 0,
      averagePrice: params.stopPrice,
    });
    return { success: true, orderId };
  }

  async healthCheck(): Promise<{ status: "connected" | "degraded" | "disconnected"; latencyMs: number }> {
    return { status: "connected", latencyMs: 5 };
  }

  /** Test helper: set a custom price for a symbol. */
  setPrice(symbol: string, price: number): void {
    this.prices.set(symbol, {
      symbol, price, bid: price - 0.05, ask: price + 0.05,
      volume: 10_000_000, timestamp: new Date(),
    });
  }
}
