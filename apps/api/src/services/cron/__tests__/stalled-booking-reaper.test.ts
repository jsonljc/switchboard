import { describe, it, expect, vi } from "vitest";
import {
  executeStalledBookingReaper,
  type StalledBookingReaperCronDeps,
  type StepTools,
} from "../stalled-booking-reaper.js";

// A fake Inngest step that runs each step body inline, recording the step names it was asked to
// run. A generic arrow (not vi.fn) preserves the StepTools `<T>` signature so it stays assignable.
function makeStep(): StepTools & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    run: async <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
      calls.push(name);
      return fn();
    },
  };
}

const baseDeps = {
  failure: { operatorAlerter: undefined } as unknown as StalledBookingReaperCronDeps["failure"],
  alerter: { alert: vi.fn(async () => {}) },
  counter: { inc: vi.fn() },
};

describe("executeStalledBookingReaper", () => {
  it("no-ops (skipped) when no store is wired and never enters step.run", async () => {
    const step = makeStep();
    const result = await executeStalledBookingReaper(step, { ...baseDeps, store: null });
    expect(result).toEqual({ scanned: 0, reaped: 0, raced: 0, failed: 0, skipped: true });
    expect(step.calls).toEqual([]);
  });

  it("runs the orchestrator under step.run when a store is wired", async () => {
    const store = {
      findStalledPending: vi.fn(async () => []),
      reapStalledPending: vi.fn(),
    };
    const step = makeStep();
    const result = await executeStalledBookingReaper(step, { ...baseDeps, store });
    expect(result).toEqual({ scanned: 0, reaped: 0, raced: 0, failed: 0 });
    expect(step.calls).toEqual(["reap-stalled-bookings"]);
    expect(store.findStalledPending).toHaveBeenCalledTimes(1);
  });
});
