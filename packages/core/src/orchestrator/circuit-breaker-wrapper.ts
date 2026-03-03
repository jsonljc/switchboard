import { CircuitBreaker, type CircuitBreakerConfig } from "../utils/circuit-breaker.js";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxAttempts: 1,
};

/**
 * Wraps cartridge.execute() calls with per-cartridge circuit breakers.
 * When a cartridge fails too many times, the breaker opens and fast-fails
 * without reaching the cartridge.
 */
export class CartridgeCircuitBreakerWrapper {
  private breakers = new Map<string, CircuitBreaker>();
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  /**
   * Execute an action through the circuit breaker for the given cartridge.
   * Throws CircuitOpenError if the circuit is open.
   */
  async execute(cartridgeId: string, fn: () => Promise<ExecuteResult>): Promise<ExecuteResult> {
    const breaker = this.getBreaker(cartridgeId);
    return breaker.execute(fn);
  }

  /**
   * Get the current state of the circuit breaker for a cartridge.
   */
  getState(cartridgeId: string): "closed" | "open" | "half-open" {
    const breaker = this.breakers.get(cartridgeId);
    if (!breaker) return "closed";
    return breaker.getState();
  }

  /**
   * Reset the circuit breaker for a cartridge (e.g. after manual recovery).
   */
  reset(cartridgeId: string): void {
    this.breakers.delete(cartridgeId);
  }

  private getBreaker(cartridgeId: string): CircuitBreaker {
    let breaker = this.breakers.get(cartridgeId);
    if (!breaker) {
      breaker = new CircuitBreaker(this.config);
      this.breakers.set(cartridgeId, breaker);
    }
    return breaker;
  }
}
