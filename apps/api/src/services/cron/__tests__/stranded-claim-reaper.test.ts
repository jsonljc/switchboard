import { describe, it, expect, vi } from "vitest";
import {
  executeStrandedClaimReaper,
  type StrandedClaimReaperCronDeps,
} from "../stranded-claim-reaper.js";

// A fake Inngest step that just runs each step body inline.
const step = {
  run: async <T>(_name: string, fn: () => T | Promise<T>): Promise<T> => fn(),
};

function makeDeps(over: Partial<StrandedClaimReaperCronDeps> = {}): StrandedClaimReaperCronDeps {
  return {
    failure: {} as never,
    store: {
      findStuckRunning: vi.fn(async () => [
        {
          workUnitId: "wu-a",
          organizationId: "org-1",
          idempotencyKey: "k",
          intent: "revenue.record",
          traceId: "t",
          executionStartedAt: "2026-06-25T11:00:00.000Z",
        },
      ]),
      update: vi.fn(async () => ({ ok: true as const, trace: {} as never })),
    },
    alerter: { alert: vi.fn(async () => {}) },
    counter: { inc: vi.fn() },
    now: () => new Date("2026-06-25T12:00:00.000Z"),
    ...over,
  };
}

describe("executeStrandedClaimReaper", () => {
  it("runs the reaper inside a step and returns its counts (incrementing the counter)", async () => {
    const deps = makeDeps();
    const res = await executeStrandedClaimReaper(step, deps);
    expect(res).toMatchObject({ scanned: 1, reaped: 1, failed: 0 });
    expect(deps.counter.inc).toHaveBeenCalledWith({ intent: "revenue.record" });
  });

  it("no store wired -> no-op (skipped, never touches the alerter)", async () => {
    const alerter = { alert: vi.fn(async () => {}) };
    const res = await executeStrandedClaimReaper(step, makeDeps({ store: null, alerter }));
    expect(res).toMatchObject({ scanned: 0, reaped: 0, failed: 0, skipped: true });
    expect(alerter.alert).not.toHaveBeenCalled();
  });
});
