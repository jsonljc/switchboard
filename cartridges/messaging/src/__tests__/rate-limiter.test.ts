import { describe, it, expect, vi, beforeEach } from "vitest";
import { WhatsAppRateLimiter } from "../rate-limiter.js";

describe("WhatsAppRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("allows messages under the rate limit", async () => {
    const limiter = new WhatsAppRateLimiter({ messagesPerSecond: 80 });
    const result = await limiter.enqueue({ contactId: "c1", message: "hello" });
    expect(result.accepted).toBe(true);
  });

  it("tracks queue depth", async () => {
    const limiter = new WhatsAppRateLimiter({ messagesPerSecond: 1 });
    await limiter.enqueue({ contactId: "c1", message: "m1" });
    await limiter.enqueue({ contactId: "c2", message: "m2" });
    expect(limiter.queueDepth).toBe(2);
  });

  it("warns when queue exceeds threshold", async () => {
    const onQueueWarning = vi.fn();
    const limiter = new WhatsAppRateLimiter({
      messagesPerSecond: 80,
      queueWarningThreshold: 2,
      onQueueWarning,
    });

    await limiter.enqueue({ contactId: "c1", message: "m1" });
    await limiter.enqueue({ contactId: "c2", message: "m2" });
    await limiter.enqueue({ contactId: "c3", message: "m3" });

    expect(onQueueWarning).toHaveBeenCalledWith(3);
  });

  it("drains queue at configured rate", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const limiter = new WhatsAppRateLimiter({
      messagesPerSecond: 2,
      dispatch,
    });

    await limiter.enqueue({ contactId: "c1", message: "m1" });
    await limiter.enqueue({ contactId: "c2", message: "m2" });
    await limiter.enqueue({ contactId: "c3", message: "m3" });

    await limiter.drain();

    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it("tracks template messages separately", async () => {
    const limiter = new WhatsAppRateLimiter({
      messagesPerSecond: 80,
      dailyTemplateLimit: 2,
    });

    const r1 = await limiter.enqueue({ contactId: "c1", message: "t1", isTemplate: true });
    const r2 = await limiter.enqueue({ contactId: "c2", message: "t2", isTemplate: true });
    const r3 = await limiter.enqueue({ contactId: "c3", message: "t3", isTemplate: true });

    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(true);
    expect(r3.accepted).toBe(false);
    expect(r3.reason).toBe("daily_template_limit_exceeded");
  });
});
