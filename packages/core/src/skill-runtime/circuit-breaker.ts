interface CircuitBreakerConfig {
  maxFailuresInWindow: number;
  windowMs: number;
}

interface TraceStoreForCircuitBreaker {
  countRecentFailures(deploymentId: string, windowMs: number): Promise<number>;
}

export class CircuitBreaker {
  constructor(
    private traceStore: TraceStoreForCircuitBreaker,
    private config: CircuitBreakerConfig = {
      maxFailuresInWindow: 5,
      windowMs: 3_600_000,
    },
  ) {}

  async check(deploymentId: string): Promise<{ allowed: boolean; reason?: string }> {
    const failureCount = await this.traceStore.countRecentFailures(
      deploymentId,
      this.config.windowMs,
    );

    if (failureCount >= this.config.maxFailuresInWindow) {
      return {
        allowed: false,
        reason: `Circuit breaker tripped: ${failureCount} failures in the last ${this.config.windowMs / 60_000} minutes. Routing to human escalation.`,
      };
    }

    return { allowed: true };
  }
}
