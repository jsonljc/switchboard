import type { TriggerStore } from "@switchboard/core";

export function createTriggerCleanupJob(store: TriggerStore): () => Promise<number> {
  return async () => {
    return store.deleteExpired(new Date());
  };
}

export interface TriggerCleanupConfig {
  store: TriggerStore;
  /** How often to run cleanup (default: 1 hour). */
  intervalMs?: number;
  logger?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
}

/**
 * Periodically purges expired triggers (status = expired, past expiresAt).
 * Returns a cleanup function that stops the interval.
 */
export function startTriggerCleanupJob(config: TriggerCleanupConfig): () => void {
  const { store, intervalMs = 3_600_000, logger } = config;
  const cleanup = createTriggerCleanupJob(store);

  let stopped = false;

  const run = async () => {
    if (stopped) return;
    try {
      const deleted = await cleanup();
      if (deleted > 0) {
        logger?.info(`Trigger cleanup: purged ${deleted} expired triggers`);
      }
    } catch (err) {
      logger?.warn({ err }, "Trigger cleanup failed (will retry next cycle)");
    }
  };

  const timer = setInterval(() => {
    void run();
  }, intervalMs);

  // Run once on startup after a short delay
  setTimeout(() => {
    if (!stopped) void run();
  }, 10_000);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
