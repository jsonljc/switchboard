import { describe, it, expect, vi } from "vitest";
import { ReconciliationRunner } from "./reconciliation-runner.js";

describe("ReconciliationRunner", () => {
  it("produces a healthy report when all checks pass", async () => {
    const deps = {
      bookingStore: { countConfirmed: vi.fn().mockResolvedValue(10) },
      conversionRecordStore: { countByType: vi.fn().mockResolvedValue(10) },
      opportunityStore: { countByStage: vi.fn().mockResolvedValue(10) },
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
      bookingStore: { countConfirmed: vi.fn().mockResolvedValue(100) },
      conversionRecordStore: { countByType: vi.fn().mockResolvedValue(90) },
      opportunityStore: { countByStage: vi.fn().mockResolvedValue(90) },
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
      bookingStore: { countConfirmed: vi.fn().mockResolvedValue(100) },
      conversionRecordStore: { countByType: vi.fn().mockResolvedValue(97) },
      opportunityStore: { countByStage: vi.fn().mockResolvedValue(97) },
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
      bookingStore: { countConfirmed: vi.fn().mockResolvedValue(5) },
      conversionRecordStore: { countByType: vi.fn().mockResolvedValue(5) },
      opportunityStore: { countByStage: vi.fn().mockResolvedValue(5) },
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
});
