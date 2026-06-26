import { describe, it, expect, vi } from "vitest";
import {
  reapStalledBookings,
  STALLED_BOOKING_MAX_AGE_MS,
  STALLED_BOOKING_REAP_LIMIT,
  type StalledBookingReaperStore,
  type StalledPendingBooking,
} from "../stalled-booking-reaper.js";
import type { Counter } from "../../telemetry/metrics.js";
import type {
  InfrastructureFailureAlert,
  OperatorAlerter,
} from "../../observability/operator-alerter.js";

const NOW = new Date("2026-06-26T12:00:00.000Z");

function makeBooking(over: Partial<StalledPendingBooking> = {}): StalledPendingBooking {
  return {
    id: "bk-1",
    organizationId: "org-1",
    createdAt: new Date("2026-06-26T11:00:00.000Z"),
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
  stuck: StalledPendingBooking[];
  reap?: (id: string) => Promise<{ count: number }>;
}): StalledBookingReaperStore & {
  findStalledPending: ReturnType<typeof vi.fn>;
  reapStalledPending: ReturnType<typeof vi.fn>;
} {
  return {
    findStalledPending: vi.fn(async () => opts.stuck),
    reapStalledPending: vi.fn(async (_org: string, id: string) =>
      opts.reap ? opts.reap(id) : { count: 1 },
    ),
  };
}

const config = { olderThanMs: STALLED_BOOKING_MAX_AGE_MS, limit: STALLED_BOOKING_REAP_LIMIT };

describe("reapStalledBookings", () => {
  it("ages each stale pending booking to failed: counter per row, org-scoped, one warning alert", async () => {
    const store = makeStore({
      stuck: [
        makeBooking({ id: "bk-a", organizationId: "org-1" }),
        makeBooking({ id: "bk-b", organizationId: "org-2" }),
      ],
    });
    const counter = makeCounter();
    const alerter = makeAlerter();

    const result = await reapStalledBookings({ store, counter, alerter, now: () => NOW }, config);

    expect(result).toEqual({ scanned: 2, reaped: 2, raced: 0, failed: 0 });
    expect(store.reapStalledPending).toHaveBeenCalledWith("org-1", "bk-a");
    expect(store.reapStalledPending).toHaveBeenCalledWith("org-2", "bk-b");
    expect(counter.calls).toEqual([{ orgId: "org-1" }, { orgId: "org-2" }]);
    expect(alerter.alerts).toHaveLength(1);
    expect(alerter.alerts[0]!.severity).toBe("warning");
    expect(alerter.alerts[0]!.errorType).toBe("stalled_booking_reaped");
  });

  it("passes now - olderThanMs as the cutoff and the configured limit to the scan", async () => {
    const store = makeStore({ stuck: [] });
    await reapStalledBookings(
      { store, counter: makeCounter(), alerter: makeAlerter(), now: () => NOW },
      config,
    );
    const [cutoff, limit] = store.findStalledPending.mock.calls[0]!;
    expect(cutoff).toEqual(new Date(NOW.getTime() - STALLED_BOOKING_MAX_AGE_MS));
    expect(limit).toBe(STALLED_BOOKING_REAP_LIMIT);
  });

  it("counts a count:0 row as raced and keeps the alert at warning (benign concurrent confirm/fail)", async () => {
    const store = makeStore({ stuck: [makeBooking()], reap: async () => ({ count: 0 }) });
    const counter = makeCounter();
    const alerter = makeAlerter();

    const result = await reapStalledBookings({ store, counter, alerter, now: () => NOW }, config);

    expect(result).toEqual({ scanned: 1, reaped: 0, raced: 1, failed: 0 });
    expect(counter.calls).toEqual([]);
    expect(alerter.alerts[0]!.severity).toBe("warning");
  });

  it("counts a thrown reap as failed and escalates the alert to critical", async () => {
    const store = makeStore({
      stuck: [makeBooking()],
      reap: async () => {
        throw new Error("db down");
      },
    });
    const alerter = makeAlerter();

    const result = await reapStalledBookings(
      { store, counter: makeCounter(), alerter, now: () => NOW },
      config,
    );

    expect(result).toEqual({ scanned: 1, reaped: 0, raced: 0, failed: 1 });
    expect(alerter.alerts[0]!.severity).toBe("critical");
  });

  it("emits the CAPPED note when the scan hits the limit", async () => {
    const stuck = Array.from({ length: 3 }, (_, i) => makeBooking({ id: `bk-${i}` }));
    const store = makeStore({ stuck });
    const alerter = makeAlerter();

    await reapStalledBookings(
      { store, counter: makeCounter(), alerter, now: () => NOW },
      { olderThanMs: STALLED_BOOKING_MAX_AGE_MS, limit: 3 },
    );

    expect(alerter.alerts[0]!.errorMessage).toContain("CAPPED");
  });

  it("does nothing and raises no alert when no stale bookings are found", async () => {
    const store = makeStore({ stuck: [] });
    const counter = makeCounter();
    const alerter = makeAlerter();

    const result = await reapStalledBookings({ store, counter, alerter, now: () => NOW }, config);

    expect(result).toEqual({ scanned: 0, reaped: 0, raced: 0, failed: 0 });
    expect(alerter.alerts).toHaveLength(0);
    expect(counter.calls).toEqual([]);
  });
});
