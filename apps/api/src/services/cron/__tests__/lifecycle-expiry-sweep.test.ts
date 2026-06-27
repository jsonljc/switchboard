import { describe, expect, it, vi } from "vitest";
import {
  createLifecycleExpirySweepCron,
  type LifecycleExpirySweepDeps,
} from "../lifecycle-expiry-sweep.js";
import type {
  AsyncFailureContext,
  ApprovalLifecycleStore,
  ApprovalLifecycleService,
} from "@switchboard/core";

// Hoist the spy so it's available when vi.mock factory runs.
const { createFunctionSpy } = vi.hoisted(() => ({
  createFunctionSpy: vi.fn().mockReturnValue({}),
}));

vi.mock("@switchboard/creative-pipeline", () => ({
  inngestClient: {
    createFunction: createFunctionSpy,
  },
}));

function makeFailureContext(): AsyncFailureContext {
  return {
    auditLedger: {
      record: vi.fn().mockResolvedValue({}),
    } as unknown as AsyncFailureContext["auditLedger"],
    operatorAlerter: {
      alert: vi.fn().mockResolvedValue(undefined),
    } as unknown as AsyncFailureContext["operatorAlerter"],
    inngest: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

// A pass-through step.run so the cron body executes the real sweep inline.
const fakeStep = { run: <T>(_id: string, fn: () => Promise<T>) => fn() };

function makeDeps(over: Partial<LifecycleExpirySweepDeps> = {}): LifecycleExpirySweepDeps {
  return {
    failure: makeFailureContext(),
    store: {
      listExpiredPendingLifecycles: vi.fn().mockResolvedValue([]),
    } as unknown as ApprovalLifecycleStore,
    service: { expireLifecycle: vi.fn() } as unknown as ApprovalLifecycleService,
    ...over,
  };
}

describe("createLifecycleExpirySweepCron", () => {
  it("registers an hourly cron with a low-risk onFailure handler", () => {
    createFunctionSpy.mockClear();
    createLifecycleExpirySweepCron(makeDeps());

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config?.["id"]).toBe("approval-lifecycle-expiry-sweep-hourly");
    expect(config?.["triggers"]).toEqual([{ cron: "0 * * * *" }]);
    expect(typeof config?.["onFailure"]).toBe("function");
  });

  it("runs the bounded sweep and returns its result", async () => {
    createFunctionSpy.mockClear();
    const store = {
      listExpiredPendingLifecycles: vi.fn().mockResolvedValue([{ id: "lc-1" }, { id: "lc-2" }]),
    } as unknown as ApprovalLifecycleStore;
    const service = {
      expireLifecycle: vi.fn().mockResolvedValue({ id: "lc-1", status: "expired" }),
    } as unknown as ApprovalLifecycleService;

    createLifecycleExpirySweepCron(makeDeps({ store, service }));
    const handler = createFunctionSpy.mock.calls[0]?.[1] as (arg: {
      step: typeof fakeStep;
    }) => Promise<{ expired: number; failed: number }>;

    const result = await handler({ step: fakeStep });

    // The bounded default (1000) is threaded end-to-end into the store query.
    expect(store.listExpiredPendingLifecycles).toHaveBeenCalledWith(expect.any(Date), 1000);
    expect(service.expireLifecycle).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ expired: 2, failed: 0 });
  });

  it("warns when a lifecycle fails to expire", async () => {
    createFunctionSpy.mockClear();
    const store = {
      listExpiredPendingLifecycles: vi.fn().mockResolvedValue([{ id: "lc-1" }]),
    } as unknown as ApprovalLifecycleStore;
    const service = {
      expireLifecycle: vi.fn().mockRejectedValue(new Error("db down")),
    } as unknown as ApprovalLifecycleService;
    const warn = vi.fn();

    createLifecycleExpirySweepCron(makeDeps({ store, service, logger: { warn } }));
    const handler = createFunctionSpy.mock.calls[0]?.[1] as (arg: {
      step: typeof fakeStep;
    }) => Promise<unknown>;

    await handler({ step: fakeStep });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("failed to expire");
  });
});
