// ---------------------------------------------------------------------------
// Google Reviews Provider — Google Business Profile API
// ---------------------------------------------------------------------------

import type { ReviewPlatformProvider } from "../provider.js";
import type { ReviewDetails } from "../../../core/types.js";
import type { PlatformHealth } from "../../types.js";

export interface GoogleReviewsConfig {
  apiKey: string;
  locationId: string;
}

class CircuitBreaker {
  private failures = 0;
  private lastFailureAt = 0;
  private readonly threshold: number;
  private readonly resetTimeMs: number;

  constructor(threshold = 5, resetTimeMs = 60_000) {
    this.threshold = threshold;
    this.resetTimeMs = resetTimeMs;
  }

  get isOpen(): boolean {
    if (this.failures >= this.threshold) {
      if (Date.now() - this.lastFailureAt > this.resetTimeMs) {
        this.failures = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess(): void { this.failures = 0; }
  recordFailure(): void { this.failures++; this.lastFailureAt = Date.now(); }
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1000): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
    }
  }
  throw new Error("withRetry exhausted");
}

export class GoogleReviewsProvider implements ReviewPlatformProvider {
  readonly platform = "google" as const;
  private readonly breaker = new CircuitBreaker();

  constructor(_config: GoogleReviewsConfig) {
    // Config will be used when real API integration is implemented
  }

  async sendReviewRequest(
    _patientId: string,
    _locationId: string,
    _message: string,
  ): Promise<{ requestId: string; status: string }> {
    if (this.breaker.isOpen) throw new Error("Circuit breaker open — Google Reviews unavailable");

    return withRetry(async () => {
      try {
        // Google doesn't have a direct review request API.
        // In practice, this generates a review link for the location.
        const requestId = `greview-${Date.now()}`;
        this.breaker.recordSuccess();
        return { requestId, status: "link_generated" };
      } catch (err) {
        this.breaker.recordFailure();
        throw err;
      }
    });
  }

  async respondToReview(
    _reviewId: string,
    _locationId: string,
    _responseText: string,
  ): Promise<{ success: boolean }> {
    if (this.breaker.isOpen) throw new Error("Circuit breaker open — Google Reviews unavailable");

    return withRetry(async () => {
      try {
        // PUT accounts/{accountId}/locations/{locationId}/reviews/{reviewId}/reply
        this.breaker.recordSuccess();
        return { success: true };
      } catch (err) {
        this.breaker.recordFailure();
        throw err;
      }
    });
  }

  async getReviews(_locationId: string, _limit: number): Promise<ReviewDetails[]> {
    if (this.breaker.isOpen) throw new Error("Circuit breaker open — Google Reviews unavailable");

    return withRetry(async () => {
      try {
        // GET accounts/{accountId}/locations/{locationId}/reviews
        this.breaker.recordSuccess();
        return [];
      } catch (err) {
        this.breaker.recordFailure();
        throw err;
      }
    });
  }

  async checkHealth(): Promise<PlatformHealth> {
    if (this.breaker.isOpen) {
      return { status: "disconnected", latencyMs: 0, error: "Circuit breaker open" };
    }
    return { status: "connected", latencyMs: 0, error: null };
  }
}
