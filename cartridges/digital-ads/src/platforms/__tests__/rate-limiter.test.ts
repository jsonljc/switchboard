import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenBucketRateLimiter } from "../rate-limiter.js";

describe("TokenBucketRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows burst up to maxTokens", async () => {
    const limiter = new TokenBucketRateLimiter(3);

    // Should acquire 3 tokens immediately
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    // All should resolve without delay
  });

  it("waits for refill when tokens are exhausted", async () => {
    const limiter = new TokenBucketRateLimiter(1);

    // Use the single token
    await limiter.acquire();

    // Next acquire should wait
    let resolved = false;
    const promise = limiter.acquire().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    // Advance past the refill window
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(resolved).toBe(true);
  });

  it("refills tokens after 1 second", async () => {
    const limiter = new TokenBucketRateLimiter(2);

    // Exhaust both tokens
    await limiter.acquire();
    await limiter.acquire();

    // Advance 1 second — tokens should refill
    await vi.advanceTimersByTimeAsync(1000);

    // Should succeed immediately now
    await limiter.acquire();
    await limiter.acquire();
  });
});
