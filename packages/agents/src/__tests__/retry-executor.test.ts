import { describe, it, expect, vi, beforeEach } from "vitest";
import { RetryExecutor } from "../retry-executor.js";
import { InMemoryDeliveryStore } from "../delivery-store.js";

describe("RetryExecutor", () => {
  let store: InMemoryDeliveryStore;
  let retryFn: ReturnType<typeof vi.fn>;
  let executor: RetryExecutor;

  beforeEach(() => {
    store = new InMemoryDeliveryStore();
    retryFn = vi.fn().mockResolvedValue({ success: true });
    executor = new RetryExecutor({ store, retryFn, maxRetries: 3 });
  });

  it("retries failed deliveries", async () => {
    await store.record({
      eventId: "evt-1",
      destinationId: "agent-1",
      status: "failed",
      attempts: 1,
      lastAttemptAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const results = await executor.processRetries();
    expect(results.retried).toBe(1);
    expect(retryFn).toHaveBeenCalledWith("evt-1", "agent-1");
  });

  it("skips deliveries within backoff window", async () => {
    await store.record({
      eventId: "evt-1",
      destinationId: "agent-1",
      status: "failed",
      attempts: 1,
      lastAttemptAt: new Date().toISOString(),
    });

    const results = await executor.processRetries();
    expect(results.retried).toBe(0);
    expect(results.skippedBackoff).toBe(1);
    expect(retryFn).not.toHaveBeenCalled();
  });

  it("skips deliveries that exceeded maxRetries", async () => {
    await store.record({
      eventId: "evt-1",
      destinationId: "agent-1",
      status: "failed",
      attempts: 3,
      lastAttemptAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const results = await executor.processRetries();
    expect(results.retried).toBe(0);
    expect(results.skippedMaxRetries).toBe(1);
  });

  it("computes exponential backoff correctly", () => {
    expect(RetryExecutor.backoffMs(1)).toBe(1000);
    expect(RetryExecutor.backoffMs(2)).toBe(2000);
    expect(RetryExecutor.backoffMs(3)).toBe(4000);
    expect(RetryExecutor.backoffMs(4)).toBe(8000);
    expect(RetryExecutor.backoffMs(5)).toBe(16000);
  });

  it("caps backoff at 5 minutes", () => {
    expect(RetryExecutor.backoffMs(20)).toBe(300_000);
  });

  it("updates delivery store on successful retry", async () => {
    await store.record({
      eventId: "evt-1",
      destinationId: "agent-1",
      status: "failed",
      attempts: 1,
      lastAttemptAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await executor.processRetries();

    const attempts = await store.getByEvent("evt-1");
    expect(attempts[0]!.status).toBe("succeeded");
  });

  it("increments attempt count on failed retry", async () => {
    retryFn.mockResolvedValue({ success: false });

    await store.record({
      eventId: "evt-1",
      destinationId: "agent-1",
      status: "failed",
      attempts: 1,
      lastAttemptAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await executor.processRetries();

    const attempts = await store.getByEvent("evt-1");
    expect(attempts[0]!.status).toBe("retrying");
    expect(attempts[0]!.attempts).toBe(2);
  });

  it("handles retryFn errors gracefully", async () => {
    retryFn.mockRejectedValue(new Error("dispatch boom"));

    await store.record({
      eventId: "evt-1",
      destinationId: "agent-1",
      status: "failed",
      attempts: 1,
      lastAttemptAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const results = await executor.processRetries();
    expect(results.errors).toBe(1);

    const attempts = await store.getByEvent("evt-1");
    expect(attempts[0]!.status).toBe("retrying");
    expect(attempts[0]!.attempts).toBe(2);
  });
});
