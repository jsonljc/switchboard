import { describe, it, expect, vi } from "vitest";
import { ReconciliationRunner } from "./reconciliation-runner.js";

describe("ReconciliationRunner", () => {
  it("produces a healthy report when all checks pass", async () => {
    const deps = {
      bookingStore: { countConfirmedInWindow: vi.fn().mockResolvedValue(10) },
      conversionRecordStore: { countByType: vi.fn().mockResolvedValue(10) },
      opportunityStore: { countCurrentlyAtStageUpdatedInWindow: vi.fn().mockResolvedValue(10) },
      reconciliationStore: { save: vi.fn().mockResolvedValue({}) },
    };

    const runner = new ReconciliationRunner(deps as never);
    const report = await runner.run("org_1", {
      from: new Date("2026-04-01"),
      to: new Date("2026-04-30"),
    });

    expect(report.overallStatus).toBe("healthy");
    expect(deps.reconciliationStore.save).toHaveBeenCalled();
  });

  it("produces a failing report when drift exceeds 5%", async () => {
    const deps = {
      bookingStore: { countConfirmedInWindow: vi.fn().mockResolvedValue(100) },
      conversionRecordStore: { countByType: vi.fn().mockResolvedValue(90) },
      opportunityStore: { countCurrentlyAtStageUpdatedInWindow: vi.fn().mockResolvedValue(90) },
      reconciliationStore: { save: vi.fn().mockResolvedValue({}) },
    };

    const runner = new ReconciliationRunner(deps as never);
    const report = await runner.run("org_1", {
      from: new Date("2026-04-01"),
      to: new Date("2026-04-30"),
    });

    expect(report.overallStatus).toBe("failing");
  });

  it("produces degraded when drift is between 1% and 5%", async () => {
    const deps = {
      bookingStore: { countConfirmedInWindow: vi.fn().mockResolvedValue(100) },
      conversionRecordStore: { countByType: vi.fn().mockResolvedValue(97) },
      opportunityStore: { countCurrentlyAtStageUpdatedInWindow: vi.fn().mockResolvedValue(97) },
      reconciliationStore: { save: vi.fn().mockResolvedValue({}) },
    };

    const runner = new ReconciliationRunner(deps as never);
    const report = await runner.run("org_1", {
      from: new Date("2026-04-01"),
      to: new Date("2026-04-30"),
    });

    expect(report.overallStatus).toBe("degraded");
  });

  it("persists the report via reconciliationStore.save", async () => {
    const deps = {
      bookingStore: { countConfirmedInWindow: vi.fn().mockResolvedValue(5) },
      conversionRecordStore: { countByType: vi.fn().mockResolvedValue(5) },
      opportunityStore: { countCurrentlyAtStageUpdatedInWindow: vi.fn().mockResolvedValue(5) },
      reconciliationStore: { save: vi.fn().mockResolvedValue({}) },
    };

    const runner = new ReconciliationRunner(deps as never);
    await runner.run("org_1", { from: new Date("2026-04-01"), to: new Date("2026-04-30") });

    expect(deps.reconciliationStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        overallStatus: "healthy",
        checks: expect.any(Array),
      }),
    );
  });

  // P2-20: the checks must compare LIKE-FOR-LIKE windows. The conversion side is already
  // windowed (countByType), so confirmed-bookings and booked-opportunities must be windowed
  // on the same dateRange too. This mock carries BOTH the legacy all-time readers (large) and
  // the windowed readers (small + matching the booked-conversion window); a windowed runner
  // must read the windowed values and reconcile HEALTHY even though the all-time counts diverge.
  it("windows confirmed bookings and booked opps so an org older than the window reconciles healthy", async () => {
    const from = new Date("2026-06-19T00:00:00Z");
    const to = new Date("2026-06-26T00:00:00Z");
    const deps = {
      bookingStore: {
        countConfirmed: vi.fn().mockResolvedValue(100), // all-time (must NOT be used)
        countConfirmedInWindow: vi.fn().mockResolvedValue(5), // last 7d
      },
      conversionRecordStore: { countByType: vi.fn().mockResolvedValue(5) }, // booked, last 7d
      opportunityStore: {
        countByStage: vi.fn().mockResolvedValue(100), // all-time (must NOT be used)
        countCurrentlyAtStageUpdatedInWindow: vi.fn().mockResolvedValue(5), // last 7d
      },
      reconciliationStore: { save: vi.fn().mockResolvedValue({}) },
    };

    const runner = new ReconciliationRunner(deps as never);
    const report = await runner.run("org_1", { from, to });

    expect(report.overallStatus).toBe("healthy");
    expect(deps.bookingStore.countConfirmedInWindow).toHaveBeenCalledWith("org_1", from, to);
    expect(deps.opportunityStore.countCurrentlyAtStageUpdatedInWindow).toHaveBeenCalledWith({
      orgId: "org_1",
      stage: "booked",
      from,
      to,
    });
    expect(deps.bookingStore.countConfirmed).not.toHaveBeenCalled();
    expect(deps.opportunityStore.countByStage).not.toHaveBeenCalled();
  });

  it("still flags failing on a genuine in-window discrepancy", async () => {
    const from = new Date("2026-06-19T00:00:00Z");
    const to = new Date("2026-06-26T00:00:00Z");
    const deps = {
      bookingStore: { countConfirmedInWindow: vi.fn().mockResolvedValue(10) },
      conversionRecordStore: { countByType: vi.fn().mockResolvedValue(5) }, // 50% drift > 5%
      opportunityStore: { countCurrentlyAtStageUpdatedInWindow: vi.fn().mockResolvedValue(5) },
      reconciliationStore: { save: vi.fn().mockResolvedValue({}) },
    };

    const runner = new ReconciliationRunner(deps as never);
    const report = await runner.run("org_1", { from, to });

    expect(report.overallStatus).toBe("failing");
  });

  // Windowing makes a zero count common (a quiet week). A zero EXPECTED count with a positive
  // ACTUAL is still a real discrepancy (relative drift is undefined), so it must flag, not pass.
  it("flags failing when an expected count is zero but its counterpart has records", async () => {
    const from = new Date("2026-06-19T00:00:00Z");
    const to = new Date("2026-06-26T00:00:00Z");
    const deps = {
      bookingStore: { countConfirmedInWindow: vi.fn().mockResolvedValue(0) }, // 0 confirmed
      conversionRecordStore: { countByType: vi.fn().mockResolvedValue(5) }, // but 5 booked records
      opportunityStore: { countCurrentlyAtStageUpdatedInWindow: vi.fn().mockResolvedValue(5) },
      reconciliationStore: { save: vi.fn().mockResolvedValue({}) },
    };

    const runner = new ReconciliationRunner(deps as never);
    const report = await runner.run("org_1", { from, to });

    expect(report.overallStatus).toBe("failing");
  });

  // The counterpart guard: a genuinely quiet window (all sides zero) is honest agreement, not a
  // discrepancy. It must stay healthy, or the fix would re-introduce a P2-20-style false alarm.
  it("stays healthy for a genuinely quiet window where every count is zero", async () => {
    const from = new Date("2026-06-19T00:00:00Z");
    const to = new Date("2026-06-26T00:00:00Z");
    const deps = {
      bookingStore: { countConfirmedInWindow: vi.fn().mockResolvedValue(0) },
      conversionRecordStore: { countByType: vi.fn().mockResolvedValue(0) },
      opportunityStore: { countCurrentlyAtStageUpdatedInWindow: vi.fn().mockResolvedValue(0) },
      reconciliationStore: { save: vi.fn().mockResolvedValue({}) },
    };

    const runner = new ReconciliationRunner(deps as never);
    const report = await runner.run("org_1", { from, to });

    expect(report.overallStatus).toBe("healthy");
  });
});
