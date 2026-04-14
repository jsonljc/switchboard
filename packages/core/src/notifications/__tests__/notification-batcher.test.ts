import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotificationBatcher } from "../notification-batcher.js";
import type { NotificationEvent } from "../notification-classifier.js";

describe("NotificationBatcher", () => {
  let sendFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    sendFn = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes when batch reaches maxBatchSize", async () => {
    const batcher = new NotificationBatcher({
      onFlush: sendFn,
      flushIntervalMs: 20 * 60 * 1000,
      maxBatchSize: 3,
    });

    const event: NotificationEvent = { type: "fact_learned", deploymentId: "d1", metadata: {} };
    batcher.add(event);
    batcher.add(event);
    expect(sendFn).not.toHaveBeenCalled();

    batcher.add(event);
    // Should have flushed after 3rd event
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledWith("d1", expect.any(Array));
    expect(sendFn.mock.calls[0]![1]).toHaveLength(3);

    batcher.stop();
  });

  it("flushes on timer interval", async () => {
    const batcher = new NotificationBatcher({
      onFlush: sendFn,
      flushIntervalMs: 1000, // 1s for test speed
      maxBatchSize: 10,
    });

    const event: NotificationEvent = { type: "faq_drafted", deploymentId: "d1", metadata: {} };
    batcher.add(event);

    expect(sendFn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn.mock.calls[0]![1]).toHaveLength(1);

    batcher.stop();
  });

  it("batches per deployment", async () => {
    const batcher = new NotificationBatcher({
      onFlush: sendFn,
      flushIntervalMs: 20 * 60 * 1000,
      maxBatchSize: 2,
    });

    batcher.add({ type: "fact_learned", deploymentId: "d1", metadata: {} });
    batcher.add({ type: "fact_learned", deploymentId: "d2", metadata: {} });
    expect(sendFn).not.toHaveBeenCalled(); // Different deployments

    batcher.add({ type: "faq_drafted", deploymentId: "d1", metadata: {} });
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledWith("d1", expect.any(Array));

    batcher.stop();
  });

  it("does not flush when empty on timer tick", async () => {
    const batcher = new NotificationBatcher({
      onFlush: sendFn,
      flushIntervalMs: 1000,
      maxBatchSize: 10,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(sendFn).not.toHaveBeenCalled();

    batcher.stop();
  });

  it("stop() clears the interval timer", async () => {
    const batcher = new NotificationBatcher({
      onFlush: sendFn,
      flushIntervalMs: 1000,
      maxBatchSize: 10,
    });

    batcher.add({ type: "fact_learned", deploymentId: "d1", metadata: {} });
    batcher.stop();

    await vi.advanceTimersByTimeAsync(2000);
    expect(sendFn).not.toHaveBeenCalled();
  });
});
