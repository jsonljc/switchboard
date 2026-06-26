import { describe, it, expect, vi } from "vitest";
import {
  executeRobinRecoveryRetryDispatch,
  createRobinRecoveryRetryDispatchCron,
} from "../robin-recovery-retry-dispatch.js";
import type {
  RobinRecoveryRetryDispatchDeps,
  StepTools,
} from "../robin-recovery-retry-dispatch.js";
import type { AsyncFailureContext } from "@switchboard/core";
import {
  ROBIN_RECOVERY_ORPHAN_MAX_AGE_MS,
  ROBIN_RECOVERY_ORPHAN_REAP_LIMIT,
} from "@switchboard/core";

const { createFunctionSpy } = vi.hoisted(() => ({
  createFunctionSpy: vi.fn().mockReturnValue({}),
}));
vi.mock("inngest", () => ({
  Inngest: vi.fn().mockImplementation(() => ({ createFunction: createFunctionSpy })),
}));

function makeStep(): StepTools {
  return { run: async <T>(_n: string, fn: () => T | Promise<T>): Promise<T> => fn() };
}

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

function makeDueRow(over: Record<string, unknown> = {}) {
  return {
    id: "rrs_1",
    organizationId: "org_1",
    contactId: "ct_1",
    bookingId: "bk_1",
    campaignKind: "no_show",
    attempts: 0,
    ...over,
  };
}

function deps(over: Partial<RobinRecoveryRetryDispatchDeps> = {}): RobinRecoveryRetryDispatchDeps {
  return {
    failure: makeFailureContext(),
    findDueRetries: vi.fn().mockResolvedValue([makeDueRow()]),
    submitRecoveryRetry: vi.fn().mockResolvedValue({
      ok: true,
      result: { outputs: { outcome: "sent" } },
      workUnit: {},
    }),
    // P2-13 orphan reaper deps (default: nothing orphaned).
    findOrphanedClaims: vi.fn().mockResolvedValue([]),
    reapOrphanedClaim: vi.fn().mockResolvedValue({ count: 1 }),
    now: () => new Date("2026-06-21T15:00:00.000Z"),
    ...over,
  };
}

function makeOrphanRow(over: Record<string, unknown> = {}) {
  return {
    id: "orphan_1",
    organizationId: "org_1",
    contactId: "ct_9",
    bookingId: "bk_9",
    updatedAt: new Date("2026-06-21T14:00:00.000Z"), // 1h before the cron `now`: stale
    ...over,
  };
}

describe("executeRobinRecoveryRetryDispatch", () => {
  it("calls submitRecoveryRetry for each due row with the row fields", async () => {
    const d = deps({
      findDueRetries: vi
        .fn()
        .mockResolvedValue([
          makeDueRow({ id: "rrs_1", contactId: "ct_1", attempts: 1 }),
          makeDueRow({ id: "rrs_2", contactId: "ct_2", attempts: 2 }),
        ]),
    });
    const r = await executeRobinRecoveryRetryDispatch(makeStep(), d);
    expect(d.submitRecoveryRetry).toHaveBeenCalledTimes(2);
    expect(d.submitRecoveryRetry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        organizationId: "org_1",
        rowId: "rrs_1",
        contactId: "ct_1",
        bookingId: "bk_1",
        campaignKind: "no_show",
        attempts: 1,
      }),
    );
    expect(d.submitRecoveryRetry).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        rowId: "rrs_2",
        contactId: "ct_2",
        attempts: 2,
      }),
    );
    expect(r.processed).toBe(2);
  });

  it("outcome=sent increments sent counter", async () => {
    const d = deps({
      submitRecoveryRetry: vi.fn().mockResolvedValue({
        ok: true,
        result: { outputs: { outcome: "sent" } },
        workUnit: {},
      }),
    });
    const r = await executeRobinRecoveryRetryDispatch(makeStep(), d);
    expect(r).toMatchObject({ processed: 1, sent: 1, skipped: 0, failed: 0, deadLettered: 0 });
  });

  it("outcome=failed + deadLettered=true increments both failed and deadLettered counters", async () => {
    const d = deps({
      submitRecoveryRetry: vi.fn().mockResolvedValue({
        ok: true,
        result: { outputs: { outcome: "failed", deadLettered: true } },
        workUnit: {},
      }),
    });
    const r = await executeRobinRecoveryRetryDispatch(makeStep(), d);
    expect(r).toMatchObject({ processed: 1, sent: 0, skipped: 0, failed: 1, deadLettered: 1 });
  });

  it("outcome=skipped increments skipped counter", async () => {
    const d = deps({
      submitRecoveryRetry: vi.fn().mockResolvedValue({
        ok: true,
        result: { outputs: { outcome: "skipped" } },
        workUnit: {},
      }),
    });
    const r = await executeRobinRecoveryRetryDispatch(makeStep(), d);
    expect(r).toMatchObject({ processed: 1, sent: 0, skipped: 1, failed: 0, deadLettered: 0 });
  });

  it("HIGH dead-letter ratio (3 due, 2 dead-lettered) fires alert with correct fields", async () => {
    const failure = makeFailureContext();
    const d = deps({
      failure,
      findDueRetries: vi
        .fn()
        .mockResolvedValue([
          makeDueRow({ id: "rrs_1" }),
          makeDueRow({ id: "rrs_2" }),
          makeDueRow({ id: "rrs_3" }),
        ]),
      submitRecoveryRetry: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          result: { outputs: { outcome: "sent" } },
          workUnit: {},
        })
        .mockResolvedValueOnce({
          ok: true,
          result: { outputs: { outcome: "failed", deadLettered: true } },
          workUnit: {},
        })
        .mockResolvedValueOnce({
          ok: true,
          result: { outputs: { outcome: "failed", deadLettered: true } },
          workUnit: {},
        }),
    });
    const r = await executeRobinRecoveryRetryDispatch(makeStep(), d);
    expect(r).toMatchObject({ processed: 3, sent: 1, failed: 2, deadLettered: 2 });
    expect(failure.operatorAlerter.alert).toHaveBeenCalledTimes(1);
    expect(failure.operatorAlerter.alert).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: "async_job_retry_exhausted",
        severity: "warning",
        retryable: false,
        source: "inngest_function",
      }),
    );
    // message must mention the ratio
    const call = (failure.operatorAlerter.alert as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      errorMessage: string;
    };
    expect(call.errorMessage).toMatch(/2\/3/);
  });

  it("LOW dead-letter ratio (1 due, 1 dead-lettered, below MIN=3) does NOT fire alert", async () => {
    const failure = makeFailureContext();
    const d = deps({
      failure,
      findDueRetries: vi.fn().mockResolvedValue([makeDueRow({ id: "rrs_1" })]),
      submitRecoveryRetry: vi.fn().mockResolvedValue({
        ok: true,
        result: { outputs: { outcome: "failed", deadLettered: true } },
        workUnit: {},
      }),
    });
    const r = await executeRobinRecoveryRetryDispatch(makeStep(), d);
    expect(r).toMatchObject({ processed: 1, deadLettered: 1 });
    expect(failure.operatorAlerter.alert).not.toHaveBeenCalled();
  });

  it("idempotency_in_flight error is counted as skipped, not failed", async () => {
    const d = deps({
      submitRecoveryRetry: vi.fn().mockResolvedValue({
        ok: false,
        error: { type: "idempotency_in_flight" },
      }),
    });
    const r = await executeRobinRecoveryRetryDispatch(makeStep(), d);
    expect(r).toMatchObject({ processed: 1, sent: 0, skipped: 1, failed: 0, deadLettered: 0 });
  });

  it("DEFENSIVE: approvalRequired=true is counted as skipped, not sent (park is never a phantom success)", async () => {
    const d = deps({
      submitRecoveryRetry: vi.fn().mockResolvedValue({
        ok: true,
        approvalRequired: true,
        result: { outputs: { outcome: "pending_approval" } },
        workUnit: {},
      }),
    });
    const r = await executeRobinRecoveryRetryDispatch(makeStep(), d);
    expect(r).toMatchObject({ processed: 1, sent: 0, skipped: 1, failed: 0 });
  });

  it("returns zeros when no rows are due", async () => {
    const d = deps({ findDueRetries: vi.fn().mockResolvedValue([]) });
    const r = await executeRobinRecoveryRetryDispatch(makeStep(), d);
    expect(r).toMatchObject({ processed: 0, sent: 0, skipped: 0, failed: 0, deadLettered: 0 });
  });

  describe("P2-13 crash-orphaned claim sweep", () => {
    it("sweeps orphaned claims with the 30-min staleness floor + bounded cap and reports them", async () => {
      const d = deps({
        findDueRetries: vi.fn().mockResolvedValue([]),
        findOrphanedClaims: vi.fn().mockResolvedValue([makeOrphanRow()]),
        reapOrphanedClaim: vi.fn().mockResolvedValue({ count: 1 }),
      });
      const r = await executeRobinRecoveryRetryDispatch(makeStep(), d);
      // Staleness floor = now - ORPHAN_MAX_AGE_MS; cap = ORPHAN_REAP_LIMIT (both code constants).
      const expectedOlderThan = new Date(
        new Date("2026-06-21T15:00:00.000Z").getTime() - ROBIN_RECOVERY_ORPHAN_MAX_AGE_MS,
      );
      expect(d.findOrphanedClaims).toHaveBeenCalledWith(
        expectedOlderThan,
        ROBIN_RECOVERY_ORPHAN_REAP_LIMIT,
      );
      expect(r.orphans).toEqual({ scanned: 1, reaped: 1, raced: 0, failed: 0 });
    });

    it("dead-letters via the CAS and NEVER submits a recovery send for an orphan (no double-send)", async () => {
      const submit = vi.fn();
      const d = deps({
        findDueRetries: vi.fn().mockResolvedValue([]),
        submitRecoveryRetry: submit,
        findOrphanedClaims: vi.fn().mockResolvedValue([makeOrphanRow()]),
        reapOrphanedClaim: vi.fn().mockResolvedValue({ count: 1 }),
      });
      const r = await executeRobinRecoveryRetryDispatch(makeStep(), d);
      expect(d.reapOrphanedClaim).toHaveBeenCalledWith("orphan_1", "org_1", expect.any(Date));
      expect(submit).not.toHaveBeenCalled();
      expect(r.orphans.reaped).toBe(1);
    });

    it("CAS count===0 (a concurrent live sender or reaper won the row) is counted raced, never re-sent", async () => {
      const submit = vi.fn();
      const d = deps({
        findDueRetries: vi.fn().mockResolvedValue([]),
        submitRecoveryRetry: submit,
        findOrphanedClaims: vi.fn().mockResolvedValue([makeOrphanRow()]),
        reapOrphanedClaim: vi.fn().mockResolvedValue({ count: 0 }),
      });
      const r = await executeRobinRecoveryRetryDispatch(makeStep(), d);
      expect(r.orphans).toEqual({ scanned: 1, reaped: 0, raced: 1, failed: 0 });
      expect(submit).not.toHaveBeenCalled();
    });

    it("runs the orphan sweep even when due retries were also processed (disjoint sets)", async () => {
      const d = deps({
        findDueRetries: vi.fn().mockResolvedValue([makeDueRow()]),
        findOrphanedClaims: vi.fn().mockResolvedValue([makeOrphanRow()]),
      });
      const r = await executeRobinRecoveryRetryDispatch(makeStep(), d);
      expect(r).toMatchObject({ processed: 1, sent: 1 });
      expect(r.orphans).toEqual({ scanned: 1, reaped: 1, raced: 0, failed: 0 });
    });
  });
});

describe("createRobinRecoveryRetryDispatchCron — onFailure wiring", () => {
  it("passes a function onFailure into createFunction config", () => {
    createFunctionSpy.mockClear();
    createRobinRecoveryRetryDispatchCron(deps());
    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof config?.["onFailure"]).toBe("function");
  });

  it("registers a */15 cron trigger", () => {
    createFunctionSpy.mockClear();
    createRobinRecoveryRetryDispatchCron(deps());
    const config = createFunctionSpy.mock.calls[0]?.[0] as {
      triggers?: Array<{ cron?: string }>;
    };
    expect(config?.triggers).toEqual(expect.arrayContaining([{ cron: "*/15 * * * *" }]));
  });
});
