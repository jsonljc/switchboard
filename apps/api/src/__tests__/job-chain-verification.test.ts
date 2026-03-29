import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startChainVerificationJob } from "../jobs/chain-verification.js";

describe("Chain Verification Job", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs verification on startup", async () => {
    const entries = [{ id: "1" }, { id: "2" }];
    const ledger = {
      query: vi.fn().mockResolvedValue(entries),
      deepVerify: vi.fn().mockResolvedValue({ valid: true, entriesChecked: 2 }),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startChainVerificationJob({
      ledger: ledger as unknown as never,
      logger,
      intervalMs: 60_000,
    });

    // Flush the startup run
    await vi.advanceTimersByTimeAsync(0);

    expect(ledger.query).toHaveBeenCalledWith({});
    expect(ledger.deepVerify).toHaveBeenCalledWith(entries);
    expect(logger.info).toHaveBeenCalledWith(
      { entriesChecked: 2 },
      "Audit chain verification passed",
    );

    cleanup();
  });

  it("calls onBrokenChain when chain is invalid", async () => {
    const brokenResult = {
      valid: false,
      chainBrokenAt: 5,
      hashMismatches: [{ index: 5 }],
      entriesChecked: 10,
    };
    const ledger = {
      query: vi.fn().mockResolvedValue([]),
      deepVerify: vi.fn().mockResolvedValue(brokenResult),
    };
    const onBrokenChain = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startChainVerificationJob({
      ledger: ledger as unknown as never,
      logger,
      onBrokenChain,
      intervalMs: 60_000,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(onBrokenChain).toHaveBeenCalledWith(brokenResult);
    expect(logger.error).toHaveBeenCalled();

    cleanup();
  });

  it("handles errors gracefully", async () => {
    const ledger = {
      query: vi.fn().mockRejectedValue(new Error("DB down")),
      deepVerify: vi.fn(),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startChainVerificationJob({
      ledger: ledger as unknown as never,
      logger,
      intervalMs: 60_000,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Error running chain verification",
    );

    cleanup();
  });

  it("runs on interval", async () => {
    const ledger = {
      query: vi.fn().mockResolvedValue([]),
      deepVerify: vi.fn().mockResolvedValue({ valid: true, entriesChecked: 0 }),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startChainVerificationJob({
      ledger: ledger as unknown as never,
      logger,
      intervalMs: 10_000,
    });

    // Startup run
    await vi.advanceTimersByTimeAsync(0);
    expect(ledger.query).toHaveBeenCalledTimes(1);

    // Interval run
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ledger.query).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it("cleanup stops the interval", async () => {
    const ledger = {
      query: vi.fn().mockResolvedValue([]),
      deepVerify: vi.fn().mockResolvedValue({ valid: true, entriesChecked: 0 }),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startChainVerificationJob({
      ledger: ledger as unknown as never,
      logger,
      intervalMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(ledger.query).toHaveBeenCalledTimes(1);

    cleanup();

    await vi.advanceTimersByTimeAsync(20_000);
    // Should still be 1 — no more runs after cleanup
    expect(ledger.query).toHaveBeenCalledTimes(1);
  });
});
