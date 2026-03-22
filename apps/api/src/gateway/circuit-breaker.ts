import { GatewayCircuitOpenError } from "./gateway-errors.js";

/**
 * Counts consecutive transport-class failures on invoke/cancel; opens to fail fast.
 * Successful invoke/cancel or a successful health check closes the circuit.
 */
export class GatewayCircuitBreaker {
  private consecutiveFailures = 0;
  private state: "closed" | "open" | "half_open" = "closed";
  private openedAt = 0;

  constructor(
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  assertAllowRequest(): void {
    const t = this.now();
    if (this.state === "open") {
      if (t - this.openedAt >= this.cooldownMs) {
        this.state = "half_open";
      } else {
        throw new GatewayCircuitOpenError();
      }
    }
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "closed";
  }

  recordInvokeFailure(): void {
    if (this.state === "half_open") {
      this.state = "open";
      this.openedAt = this.now();
      return;
    }
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = this.now();
    }
  }

  /** Exposed for tests / metrics */
  getStateForTests(): { state: "closed" | "open" | "half_open"; consecutiveFailures: number } {
    return { state: this.state, consecutiveFailures: this.consecutiveFailures };
  }
}
