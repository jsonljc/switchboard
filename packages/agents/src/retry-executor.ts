// ---------------------------------------------------------------------------
// Retry Executor — exponential backoff retry for failed deliveries
// ---------------------------------------------------------------------------

import type { DeliveryStore } from "./delivery-store.js";
import { DEFAULT_MAX_RETRIES } from "./delivery-store.js";

export type RetryFn = (eventId: string, destinationId: string) => Promise<{ success: boolean }>;

export interface RetryExecutorConfig {
  store: DeliveryStore;
  retryFn: RetryFn;
  maxRetries?: number;
}

export interface RetryResult {
  retried: number;
  skippedBackoff: number;
  skippedMaxRetries: number;
  errors: number;
}

const MAX_BACKOFF_MS = 5 * 60 * 1000;

export class RetryExecutor {
  private readonly store: DeliveryStore;
  private readonly retryFn: RetryFn;
  private readonly maxRetries: number;

  constructor(config: RetryExecutorConfig) {
    this.store = config.store;
    this.retryFn = config.retryFn;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  static backoffMs(attempt: number): number {
    const ms = Math.pow(2, attempt - 1) * 1000;
    return Math.min(ms, MAX_BACKOFF_MS);
  }

  async processRetries(): Promise<RetryResult> {
    const result: RetryResult = {
      retried: 0,
      skippedBackoff: 0,
      skippedMaxRetries: 0,
      errors: 0,
    };

    const retryable = await this.store.listRetryable();

    for (const attempt of retryable) {
      if (attempt.attempts >= this.maxRetries) {
        result.skippedMaxRetries++;
        continue;
      }

      if (attempt.lastAttemptAt) {
        const elapsed = Date.now() - new Date(attempt.lastAttemptAt).getTime();
        const backoff = RetryExecutor.backoffMs(attempt.attempts);
        if (elapsed < backoff) {
          result.skippedBackoff++;
          continue;
        }
      }

      const newAttempts = attempt.attempts + 1;
      const now = new Date().toISOString();

      try {
        const retryResult = await this.retryFn(attempt.eventId, attempt.destinationId);
        if (retryResult.success) {
          await this.store.update(attempt.eventId, attempt.destinationId, {
            status: "succeeded",
            attempts: newAttempts,
            lastAttemptAt: now,
          });
        } else {
          await this.store.update(attempt.eventId, attempt.destinationId, {
            status: "retrying",
            attempts: newAttempts,
            lastAttemptAt: now,
          });
        }
        result.retried++;
      } catch (err: unknown) {
        await this.store.update(attempt.eventId, attempt.destinationId, {
          status: "retrying",
          attempts: newAttempts,
          lastAttemptAt: now,
          error: err instanceof Error ? err.message : String(err),
        });
        result.errors++;
      }
    }

    return result;
  }
}
