import { describe, it, expect, vi } from "vitest";
import {
  reapStrandedClaims,
  STRANDED_CLAIM_MAX_AGE_MS,
  STRANDED_CLAIM_REAP_LIMIT,
  type StrandedClaimReaperStore,
} from "../stranded-claim-reaper.js";
import type { StrandedRunningClaim } from "../work-trace-recorder.js";
import type { WorkTrace } from "../work-trace.js";
import type { WorkTraceUpdateResult } from "../work-trace-recorder.js";
import type { Counter } from "../../telemetry/metrics.js";
import type {
  InfrastructureFailureAlert,
  OperatorAlerter,
} from "../../observability/operator-alerter.js";

const NOW = new Date("2026-06-25T12:00:00.000Z");

function makeClaim(over: Partial<StrandedRunningClaim> = {}): StrandedRunningClaim {
  return {
    workUnitId: "wu-1",
    organizationId: "org-1",
    idempotencyKey: "k-1",
    intent: "revenue.record",
    traceId: "t-1",
    executionStartedAt: "2026-06-25T11:00:00.000Z",
    ...over,
  };
}

function makeCounter(): Counter & { calls: Array<Record<string, string> | undefined> } {
  const calls: Array<Record<string, string> | undefined> = [];
  return { calls, inc: (labels) => calls.push(labels) };
}

function makeAlerter(): OperatorAlerter & { alerts: InfrastructureFailureAlert[] } {
  const alerts: InfrastructureFailureAlert[] = [];
  return {
    alerts,
    alert: async (p) => {
      alerts.push(p);
    },
  };
}

function makeStore(opts: {
  stuck: StrandedRunningClaim[];
  update?: (id: string) => Promise<WorkTraceUpdateResult>;
}): StrandedClaimReaperStore & {
  findStuckRunning: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} {
  return {
    findStuckRunning: vi.fn(async () => opts.stuck),
    update: vi.fn(async (id: string) =>
      opts.update
        ? opts.update(id)
        : ({ ok: true, trace: {} as WorkTrace } as WorkTraceUpdateResult),
    ),
  };
}

const config = { olderThanMs: STRANDED_CLAIM_MAX_AGE_MS, limit: STRANDED_CLAIM_REAP_LIMIT };

describe("reapStrandedClaims", () => {
  it("ages each stale running claim to needs_reconciliation (sealed, org-scoped) + counter per row + one alert", async () => {
    const store = makeStore({
      stuck: [
        makeClaim({ workUnitId: "wu-a", intent: "revenue.record", organizationId: "org-1" }),
        makeClaim({ workUnitId: "wu-b", intent: "budget.reallocate", organizationId: "org-2" }),
      ],
    });
    const counter = makeCounter();
    const alerter = makeAlerter();

    const result = await reapStrandedClaims({ store, counter, alerter, now: () => NOW }, config);

    expect(result).toEqual({ scanned: 2, reaped: 2, failed: 0 });

    // Each row aged to the terminal sink, org-scoped (tenant tripwire) + caller tagged.
    expect(store.update).toHaveBeenCalledTimes(2);
    const [firstId, firstFields, firstOpts] = store.update.mock.calls[0]!;
    expect(firstId).toBe("wu-a");
    expect(firstFields.outcome).toBe("needs_reconciliation");
    expect(firstFields.completedAt).toBe(NOW.toISOString());
    expect(firstFields.error?.code).toBe("STRANDED_CLAIM_REAPED");
    expect(firstOpts).toEqual({ caller: "stranded_claim_reaper", organizationId: "org-1" });
    expect(store.update.mock.calls[1]![2]).toEqual({
      caller: "stranded_claim_reaper",
      organizationId: "org-2",
    });

    // Counter incremented once per reaped row, labeled by intent.
    expect(counter.calls).toEqual([{ intent: "revenue.record" }, { intent: "budget.reallocate" }]);

    // Exactly ONE summary operator alert (not one-per-row) — no alert storm.
    expect(alerter.alerts).toHaveLength(1);
    expect(alerter.alerts[0]!.errorType).toBe("stranded_claim_reaped");
    expect(alerter.alerts[0]!.severity).toBe("warning");
    expect(alerter.alerts[0]!.retryable).toBe(false);
    expect(alerter.alerts[0]!.errorMessage).toContain("2");
  });

  it("derives olderThan = now - olderThanMs and forwards the bounded limit to findStuckRunning", async () => {
    const store = makeStore({ stuck: [] });
    await reapStrandedClaims(
      { store, counter: makeCounter(), alerter: makeAlerter(), now: () => NOW },
      { olderThanMs: 30 * 60 * 1000, limit: 250 },
    );
    expect(store.findStuckRunning).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 30 * 60 * 1000),
      250,
    );
  });

  it("empty scan: no update, no counter, NO alert (silent when nothing is stranded)", async () => {
    const store = makeStore({ stuck: [] });
    const counter = makeCounter();
    const alerter = makeAlerter();

    const result = await reapStrandedClaims({ store, counter, alerter, now: () => NOW }, config);

    expect(result).toEqual({ scanned: 0, reaped: 0, failed: 0 });
    expect(store.update).not.toHaveBeenCalled();
    expect(counter.calls).toHaveLength(0);
    expect(alerter.alerts).toHaveLength(0);
  });

  it("a locked update-rejection counts as failed (no counter for it) but still alerts; severity escalates to critical", async () => {
    const store = makeStore({
      stuck: [makeClaim({ workUnitId: "wu-a" }), makeClaim({ workUnitId: "wu-b" })],
      update: async (id) =>
        id === "wu-a"
          ? { ok: false, code: "WORK_TRACE_LOCKED", traceUnchanged: true, reason: "locked" }
          : { ok: true, trace: {} as WorkTrace },
    });
    const counter = makeCounter();
    const alerter = makeAlerter();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await reapStrandedClaims({ store, counter, alerter, now: () => NOW }, config);

    expect(result).toEqual({ scanned: 2, reaped: 1, failed: 1 });
    expect(counter.calls).toEqual([{ intent: "revenue.record" }]); // only the reaped row
    expect(alerter.alerts).toHaveLength(1);
    expect(alerter.alerts[0]!.severity).toBe("critical"); // a reap-write failure is the alarm case
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("an update that THROWS counts as failed and does NOT abort the batch", async () => {
    const store = makeStore({
      stuck: [makeClaim({ workUnitId: "wu-a" }), makeClaim({ workUnitId: "wu-b" })],
      update: async (id) => {
        if (id === "wu-a") throw new Error("db down");
        return { ok: true, trace: {} as WorkTrace };
      },
    });
    const counter = makeCounter();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await reapStrandedClaims(
      { store, counter, alerter: makeAlerter(), now: () => NOW },
      config,
    );

    expect(result).toEqual({ scanned: 2, reaped: 1, failed: 1 });
    expect(store.update).toHaveBeenCalledTimes(2); // the throw did not abort the second row
    errSpy.mockRestore();
  });
});
