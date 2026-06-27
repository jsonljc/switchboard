import { describe, it, expect, vi } from "vitest";
import { sweepExpiredLifecycles } from "../lifecycle-expiry.js";
import type { ApprovalLifecycleService } from "../lifecycle-service.js";
import type { ApprovalLifecycleStore, LifecycleRecord } from "../lifecycle-types.js";

function makeLifecycle(overrides: Partial<LifecycleRecord> = {}): LifecycleRecord {
  return {
    id: "lc-1",
    actionEnvelopeId: "env-1",
    organizationId: "org-1",
    status: "pending",
    currentRevisionId: "rev-1",
    currentExecutableWorkUnitId: null,
    expiresAt: new Date(Date.now() - 1000),
    pausedSessionId: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("sweepExpiredLifecycles", () => {
  it("expires all pending lifecycles past their expiresAt", async () => {
    const expired1 = makeLifecycle({ id: "lc-1" });
    const expired2 = makeLifecycle({ id: "lc-2" });

    const store = {
      listExpiredPendingLifecycles: vi.fn().mockResolvedValue([expired1, expired2]),
    } as unknown as ApprovalLifecycleStore;

    const service = {
      expireLifecycle: vi.fn().mockResolvedValue(makeLifecycle({ status: "expired" })),
    } as unknown as ApprovalLifecycleService;

    const result = await sweepExpiredLifecycles(store, service);

    expect(result.expired).toBe(2);
    expect(result.failed).toBe(0);
    expect(service.expireLifecycle).toHaveBeenCalledTimes(2);
  });

  it("continues expiring remaining lifecycles if one fails", async () => {
    const expired1 = makeLifecycle({ id: "lc-1" });
    const expired2 = makeLifecycle({ id: "lc-2" });

    const store = {
      listExpiredPendingLifecycles: vi.fn().mockResolvedValue([expired1, expired2]),
    } as unknown as ApprovalLifecycleStore;

    const service = {
      expireLifecycle: vi
        .fn()
        .mockRejectedValueOnce(new Error("db error"))
        .mockResolvedValueOnce(makeLifecycle({ status: "expired" })),
    } as unknown as ApprovalLifecycleService;

    const result = await sweepExpiredLifecycles(store, service);

    expect(result.expired).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("returns zeros when no expired lifecycles found", async () => {
    const store = {
      listExpiredPendingLifecycles: vi.fn().mockResolvedValue([]),
    } as unknown as ApprovalLifecycleStore;

    const service = {
      expireLifecycle: vi.fn(),
    } as unknown as ApprovalLifecycleService;

    const result = await sweepExpiredLifecycles(store, service);

    expect(result.expired).toBe(0);
    expect(result.failed).toBe(0);
    expect(service.expireLifecycle).not.toHaveBeenCalled();
  });

  it("threads a bounded limit into the store list query (default 1000, overridable)", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const store = {
      listExpiredPendingLifecycles: list,
    } as unknown as ApprovalLifecycleStore;
    const service = { expireLifecycle: vi.fn() } as unknown as ApprovalLifecycleService;
    const now = new Date("2026-06-27T00:00:00Z");

    await sweepExpiredLifecycles(store, service, now);
    expect(list).toHaveBeenCalledWith(now, 1000);

    await sweepExpiredLifecycles(store, service, now, 50);
    expect(list).toHaveBeenLastCalledWith(now, 50);
  });
});
