/**
 * Shared retry utility with exponential backoff and jitter.
 */

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Base delay in milliseconds before the first retry. Default: 500 */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds. Default: 10_000 */
  maxDelayMs?: number;
  /**
   * Predicate to decide whether to retry a given error.
   * Return true to retry, false to throw immediately.
   * Default: retry on all errors.
   */
  shouldRetry?: (error: unknown) => boolean;
  /**
   * Optional hook called before each retry sleep.
   * Can return a custom delay override in milliseconds (e.g. from a Retry-After header).
   * If it returns undefined, the default exponential backoff is used.
   */
  onRetry?: (error: unknown, attempt: number) => number | undefined | void;
}

/**
 * Execute `fn` with automatic retries using exponential backoff and ±25% jitter.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration
 * @returns The resolved value of `fn`
 * @throws The last error if all attempts are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 10_000,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      // Compute exponential delay: baseDelayMs * 2^(attempt-1)
      const exponentialDelay = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1),
        maxDelayMs,
      );

      // Check if onRetry provides a custom delay (e.g. Retry-After)
      const overrideDelay = onRetry?.(error, attempt);
      const rawDelay = overrideDelay ?? exponentialDelay;

      // Apply ±25% jitter
      const jitter = rawDelay * 0.25 * (2 * Math.random() - 1);
      const delay = Math.max(0, Math.min(rawDelay + jitter, maxDelayMs));

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError;
}
