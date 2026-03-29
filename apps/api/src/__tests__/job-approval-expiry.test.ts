import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@switchboard/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    isExpired: vi.fn(),
    transitionApproval: vi.fn(),
    StaleVersionError: class StaleVersionError extends Error {
      constructor(id?: string, expected?: number, actual?: number) {
        super(`Stale version for approval ${id}: expected ${expected}, got ${actual}`);
        this.name = "StaleVersionError";
      }
    },
  };
});

import { startApprovalExpiryJob } from "../jobs/approval-expiry.js";
import { isExpired, transitionApproval, StaleVersionError } from "@switchboard/core";

describe("Approval Expiry Job", () => {
  const mockIsExpired = vi.mocked(isExpired);
  const mockTransition = vi.mocked(transitionApproval);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when no pending approvals exist", async () => {
    const storage = {
      approvals: { listPending: vi.fn().mockResolvedValue([]) },
      envelopes: { getById: vi.fn() },
    };
    const ledger = { record: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startApprovalExpiryJob({
      storage: storage as unknown as never,
      ledger: ledger as unknown as never,
      logger,
      intervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(storage.approvals.listPending).toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();

    cleanup();
  });

  it("skips non-expired approvals", async () => {
    const record = {
      state: { version: 1, status: "pending" },
      request: { id: "req_1", actionId: "action.test", riskCategory: "low" },
      envelopeId: "env_1",
    };
    const storage = {
      approvals: {
        listPending: vi.fn().mockResolvedValue([record]),
        updateState: vi.fn(),
      },
      envelopes: { getById: vi.fn() },
    };
    const ledger = { record: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    mockIsExpired.mockReturnValue(false);

    const cleanup = startApprovalExpiryJob({
      storage: storage as unknown as never,
      ledger: ledger as unknown as never,
      logger,
      intervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(storage.approvals.updateState).not.toHaveBeenCalled();

    cleanup();
  });

  it("expires approval, updates envelope, and records audit", async () => {
    const record = {
      state: { version: 1, status: "pending", expiresAt: "2024-01-01" },
      request: {
        id: "req_1",
        actionId: "action.test",
        riskCategory: "high",
        expiredBehavior: "block",
      },
      envelopeId: "env_1",
    };
    const expiredState = { version: 2, status: "expired" };
    const envelope = { id: "env_1", status: "pending_approval" };

    const storage = {
      approvals: {
        listPending: vi.fn().mockResolvedValue([record]),
        updateState: vi.fn().mockResolvedValue(undefined),
      },
      envelopes: {
        getById: vi.fn().mockResolvedValue(envelope),
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    const ledger = { record: vi.fn().mockResolvedValue(undefined) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    mockIsExpired.mockReturnValue(true);
    mockTransition.mockReturnValue(expiredState as unknown as never);

    const cleanup = startApprovalExpiryJob({
      storage: storage as unknown as never,
      ledger: ledger as unknown as never,
      logger,
      intervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(storage.approvals.updateState).toHaveBeenCalledWith("req_1", expiredState, 1);
    expect(storage.envelopes.update).toHaveBeenCalledWith("env_1", { status: "expired" });
    expect(ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "action.approval_expired",
        entityId: "req_1",
      }),
    );
    expect(logger.info).toHaveBeenCalled();

    cleanup();
  });

  it("handles StaleVersionError by skipping", async () => {
    const record = {
      state: { version: 1, status: "pending" },
      request: { id: "req_1", actionId: "action.test", riskCategory: "low" },
      envelopeId: "env_1",
    };
    const storage = {
      approvals: {
        listPending: vi.fn().mockResolvedValue([record]),
        updateState: vi.fn().mockRejectedValue(new StaleVersionError("req_1", 1, 2)),
      },
      envelopes: { getById: vi.fn(), update: vi.fn() },
    };
    const ledger = { record: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    mockIsExpired.mockReturnValue(true);
    mockTransition.mockReturnValue({ version: 2, status: "expired" } as unknown as never);

    const cleanup = startApprovalExpiryJob({
      storage: storage as unknown as never,
      ledger: ledger as unknown as never,
      logger,
      intervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);

    // StaleVersionError is caught and skipped — no audit recorded
    expect(ledger.record).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();

    cleanup();
  });

  it("handles general errors gracefully", async () => {
    const storage = {
      approvals: {
        listPending: vi.fn().mockRejectedValue(new Error("DB failure")),
      },
      envelopes: { getById: vi.fn() },
    };
    const ledger = { record: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startApprovalExpiryJob({
      storage: storage as unknown as never,
      ledger: ledger as unknown as never,
      logger,
      intervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Error scanning approvals",
    );

    cleanup();
  });

  it("cleanup stops the interval", async () => {
    const storage = {
      approvals: { listPending: vi.fn().mockResolvedValue([]) },
      envelopes: { getById: vi.fn() },
    };
    const ledger = { record: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startApprovalExpiryJob({
      storage: storage as unknown as never,
      ledger: ledger as unknown as never,
      logger,
      intervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.approvals.listPending).toHaveBeenCalledTimes(1);

    cleanup();

    await vi.advanceTimersByTimeAsync(5000);
    expect(storage.approvals.listPending).toHaveBeenCalledTimes(1);
  });
});
