// ---------------------------------------------------------------------------
// MetaGraphClient — shared HTTP base for all Meta Graph API calls
// ---------------------------------------------------------------------------
// Provides Bearer auth, circuit breaker, retry with backoff, token-bucket
// rate limiting, and x-business-use-case-usage header parsing.
// ---------------------------------------------------------------------------

import { withRetry, CircuitBreaker, CircuitBreakerOpenError } from "@switchboard/core";
import type { CircuitBreakerState } from "@switchboard/core";
import { TokenBucketRateLimiter } from "../rate-limiter.js";
import { MetaApiError, MetaRateLimitError, MetaAuthError } from "./errors.js";

const DEFAULT_API_VERSION = "v22.0";
const DEFAULT_MAX_RPS = 4;
const DEFAULT_MAX_RETRIES = 3;
const BASE_URL = "https://graph.facebook.com";
const USAGE_WARNING_THRESHOLD = 75;

export interface MetaGraphClientConfig {
  accessToken: string;
  apiVersion?: string;
  maxRequestsPerSecond?: number;
  maxRetries?: number;
}

export { CircuitBreakerOpenError };

export class MetaGraphClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly maxRetries: number;

  constructor(config: MetaGraphClientConfig) {
    const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
    this.baseUrl = `${BASE_URL}/${apiVersion}`;
    this.accessToken = config.accessToken;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.rateLimiter = new TokenBucketRateLimiter(config.maxRequestsPerSecond ?? DEFAULT_MAX_RPS);
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
    });
  }

  /** Get the circuit breaker state (for health checks). */
  getCircuitState(): CircuitBreakerState {
    return this.circuitBreaker.getState();
  }

  /**
   * Core request method — handles auth, rate limiting, circuit breaker,
   * retry, and rate-limit header parsing.
   */
  async request<T = Record<string, unknown>>(
    path: string,
    init?: RequestInit & { params?: Record<string, string> },
  ): Promise<T> {
    const { params, ...fetchInit } = init ?? {};

    let url = `${this.baseUrl}/${path}`;
    if (params && Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    // Set Authorization header (Bearer token, not query param)
    const headers = new Headers(fetchInit.headers);
    headers.set("Authorization", `Bearer ${this.accessToken}`);
    fetchInit.headers = headers;

    return this.circuitBreaker.execute(() => this.executeWithRetry<T>(url, fetchInit));
  }

  /**
   * Paginated GET — follows cursor-based `paging.next` links.
   * Returns all items concatenated from the `data` arrays.
   */
  async requestPaginated<T = Record<string, unknown>>(
    path: string,
    params?: Record<string, string>,
  ): Promise<T[]> {
    const allItems: T[] = [];

    // First request goes through the normal path
    const firstResponse = await this.request<{
      data: T[];
      paging?: { next?: string };
    }>(path, { params });

    allItems.push(...firstResponse.data);
    let nextUrl = firstResponse.paging?.next ?? null;

    // Follow pagination links directly (they include the full URL)
    while (nextUrl) {
      const response = await this.requestRaw<{
        data: T[];
        paging?: { next?: string };
      }>(nextUrl);

      allItems.push(...response.data);
      nextUrl = response.paging?.next ?? null;
    }

    return allItems;
  }

  /**
   * Raw request to a full URL (used for pagination `next` links).
   * Still applies Bearer auth, rate limiting, circuit breaker, and retry.
   */
  private async requestRaw<T>(url: string): Promise<T> {
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${this.accessToken}`);

    return this.circuitBreaker.execute(() => this.executeWithRetry<T>(url, { headers }));
  }

  private async executeWithRetry<T>(url: string, init: RequestInit): Promise<T> {
    return withRetry(
      async () => {
        await this.rateLimiter.acquire();
        const response = await fetch(url, init);

        // Parse rate-limit usage header
        this.checkUsageHeader(response);

        if (response.ok) {
          return (await response.json()) as T;
        }

        // Parse error body
        const body = (await response.json()) as Record<string, unknown>;
        const error = body.error as Record<string, unknown> | undefined;
        const code = (error?.code as number) ?? response.status;
        const subcode = (error?.error_subcode as number) ?? 0;
        const message = (error?.message as string) ?? `HTTP ${response.status}`;
        const type = (error?.type as string) ?? "unknown";
        const fbtraceId = error?.fbtrace_id as string | undefined;

        // Auth error — never retry
        if (code === 190) {
          throw new MetaAuthError(message, code, subcode, fbtraceId);
        }

        // Rate limit error (code 17) — retryable
        if (code === 17) {
          throw new MetaRateLimitError(message, subcode, fbtraceId);
        }

        // Throw a generic MetaApiError (some codes are retryable, see shouldRetry)
        throw new MetaApiError(message, code, subcode, type, fbtraceId);
      },
      {
        maxAttempts: this.maxRetries + 1, // withRetry counts total attempts
        baseDelayMs: 1000,
        maxDelayMs: 10_000,
        shouldRetry: (error: unknown) => {
          // Never retry auth errors
          if (error instanceof MetaAuthError) return false;
          // Retry rate limit errors
          if (error instanceof MetaRateLimitError) return true;
          // Retry transient Meta errors (code 2, 32)
          if (error instanceof MetaApiError) {
            return error.code === 2 || error.code === 32 || error.code >= 500;
          }
          // Retry network errors
          return true;
        },
      },
    );
  }

  /** Parse x-business-use-case-usage header and log a warning at >75% usage. */
  private checkUsageHeader(response: Response): void {
    const usageHeader = response.headers.get("x-business-use-case-usage");
    if (!usageHeader) return;

    try {
      const usage = JSON.parse(usageHeader) as Record<
        string,
        Array<{ call_count: number; total_cputime: number; total_time: number }>
      >;

      for (const [accountId, entries] of Object.entries(usage)) {
        for (const entry of entries) {
          const maxUsage = Math.max(
            entry.call_count ?? 0,
            entry.total_cputime ?? 0,
            entry.total_time ?? 0,
          );
          if (maxUsage > USAGE_WARNING_THRESHOLD) {
            console.warn(
              `[MetaGraphClient] High API usage for ${accountId}: ` +
                `call_count=${entry.call_count}%, ` +
                `total_cputime=${entry.total_cputime}%, ` +
                `total_time=${entry.total_time}%`,
            );
          }
        }
      }
    } catch {
      // Ignore malformed header
    }
  }
}
