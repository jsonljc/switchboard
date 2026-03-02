/**
 * Circuit breaker pattern for protecting external API calls.
 * Three states: closed (normal), open (failing), half-open (testing recovery).
 */

import { EventEmitter } from "node:events";

export type CircuitBreakerState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Time in ms to wait before transitioning from open to half-open. Default: 30_000 */
  resetTimeoutMs?: number;
  /** Max attempts allowed in half-open state before deciding. Default: 3 */
  halfOpenMaxAttempts?: number;
}

export class CircuitBreakerOpenError extends Error {
  constructor(message = "Circuit breaker is open") {
    super(message);
    this.name = "CircuitBreakerOpenError";
  }
}

export class CircuitBreaker extends EventEmitter {
  private state: CircuitBreakerState = "closed";
  private failureCount = 0;
  private halfOpenAttempts = 0;
  private halfOpenSuccesses = 0;
  private nextAttemptAt = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMaxAttempts: number;

  constructor(config: CircuitBreakerConfig = {}) {
    super();
    this.failureThreshold = config.failureThreshold ?? 5;
    this.resetTimeoutMs = config.resetTimeoutMs ?? 30_000;
    this.halfOpenMaxAttempts = config.halfOpenMaxAttempts ?? 3;
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  private transition(newState: CircuitBreakerState): void {
    if (this.state === newState) return;
    const prev = this.state;
    this.state = newState;
    this.emit("state-change", { from: prev, to: newState });
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() >= this.nextAttemptAt) {
        this.transition("half-open");
        this.halfOpenAttempts = 0;
        this.halfOpenSuccesses = 0;
      } else {
        throw new CircuitBreakerOpenError();
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      this.halfOpenSuccesses++;
      this.halfOpenAttempts++;
      if (this.halfOpenSuccesses >= this.halfOpenMaxAttempts) {
        this.failureCount = 0;
        this.transition("closed");
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    if (this.state === "half-open") {
      this.halfOpenAttempts++;
      this.failureCount = this.failureThreshold;
      this.nextAttemptAt = Date.now() + this.resetTimeoutMs;
      this.transition("open");
    } else {
      this.failureCount++;
      if (this.failureCount >= this.failureThreshold) {
        this.nextAttemptAt = Date.now() + this.resetTimeoutMs;
        this.transition("open");
      }
    }
  }

  /** Reset the circuit breaker to closed state. */
  reset(): void {
    this.failureCount = 0;
    this.halfOpenAttempts = 0;
    this.halfOpenSuccesses = 0;
    this.nextAttemptAt = 0;
    this.transition("closed");
  }
}
