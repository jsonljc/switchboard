import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startTtlCleanupJob } from "../jobs/ttl-cleanup.js";

describe("TTL Cleanup Job", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes expired records from all three tables", async () => {
    const prisma = {
      idempotencyRecord: {
        deleteMany: vi.fn().mockResolvedValue({ count: 5 }),
      },
      processedMessage: {
        deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
      },
      failedMessage: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startTtlCleanupJob({
      prisma: prisma as unknown as never,
      logger,
      intervalMs: 10_000,
    });

    // Advance past the initial 5s delay
    await vi.advanceTimersByTimeAsync(5_000);

    expect(prisma.idempotencyRecord.deleteMany).toHaveBeenCalled();
    expect(prisma.processedMessage.deleteMany).toHaveBeenCalled();
    expect(prisma.failedMessage.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "resolved" }),
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ idempotency: 5, processed: 3, failed: 2 }),
      expect.stringContaining("10"),
    );

    cleanup();
  });

  it("does not log when zero records are deleted", async () => {
    const prisma = {
      idempotencyRecord: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      processedMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      failedMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startTtlCleanupJob({
      prisma: prisma as unknown as never,
      logger,
      intervalMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(logger.info).not.toHaveBeenCalled();

    cleanup();
  });

  it("handles errors gracefully", async () => {
    const prisma = {
      idempotencyRecord: {
        deleteMany: vi.fn().mockRejectedValue(new Error("DB error")),
      },
      processedMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      failedMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startTtlCleanupJob({
      prisma: prisma as unknown as never,
      logger,
      intervalMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("cleanup failed"),
    );

    cleanup();
  });

  it("runs on interval after initial delay", async () => {
    const prisma = {
      idempotencyRecord: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      processedMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      failedMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startTtlCleanupJob({
      prisma: prisma as unknown as never,
      logger,
      intervalMs: 10_000,
    });

    // Initial delay run
    await vi.advanceTimersByTimeAsync(5_000);
    expect(prisma.idempotencyRecord.deleteMany).toHaveBeenCalledTimes(1);

    // Interval run
    await vi.advanceTimersByTimeAsync(10_000);
    expect(prisma.idempotencyRecord.deleteMany).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it("cleanup stops the interval", async () => {
    const prisma = {
      idempotencyRecord: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      processedMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      failedMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startTtlCleanupJob({
      prisma: prisma as unknown as never,
      logger,
      intervalMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(prisma.idempotencyRecord.deleteMany).toHaveBeenCalledTimes(1);

    cleanup();

    await vi.advanceTimersByTimeAsync(20_000);
    // Stopped after initial run — no more calls
    expect(prisma.idempotencyRecord.deleteMany).toHaveBeenCalledTimes(1);
  });
});
