interface BlastRadiusConfig {
  maxWritesPerWindow: number;
  windowMs: number;
}

interface TraceStoreForBlastRadius {
  countWritesInWindow(deploymentId: string, windowMs: number): Promise<number>;
}

export class BlastRadiusLimiter {
  constructor(
    private traceStore: TraceStoreForBlastRadius,
    private config: BlastRadiusConfig = {
      maxWritesPerWindow: 50,
      windowMs: 3_600_000,
    },
  ) {}

  async check(deploymentId: string): Promise<{ allowed: boolean; reason?: string }> {
    const writeCount = await this.traceStore.countWritesInWindow(
      deploymentId,
      this.config.windowMs,
    );

    if (writeCount >= this.config.maxWritesPerWindow) {
      return {
        allowed: false,
        reason: `Blast radius limit: ${writeCount} writes in the last ${this.config.windowMs / 60_000} minutes (max ${this.config.maxWritesPerWindow}).`,
      };
    }

    return { allowed: true };
  }
}
