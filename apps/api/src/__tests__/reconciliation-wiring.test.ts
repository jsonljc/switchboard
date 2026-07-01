import { describe, it, expect, vi } from "vitest";
import { buildRunReconciliation } from "../services/cron/reconciliation.js";

describe("buildRunReconciliation", () => {
  it("produces a real store-backed report (not the stub)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const run = buildRunReconciliation({
      bookingStore: { countConfirmedInWindow: vi.fn().mockResolvedValue(10) },
      conversionRecordStore: { countByType: vi.fn().mockResolvedValue(8) },
      opportunityStore: { countCurrentlyAtStageUpdatedInWindow: vi.fn().mockResolvedValue(9) },
      reconciliationStore: { save },
    });

    const report = await run("org_1", {
      from: new Date("2026-06-01T00:00:00Z"),
      to: new Date("2026-06-02T00:00:00Z"),
    });

    // booking-linkage: expected=10 (confirmed bookings) vs actual=8 (booked records)
    const linkage = report.checks.find((c) => c.name === "booking-linkage");
    expect(linkage).toMatchObject({ expected: 10, actual: 8 });
    expect(linkage?.status).toBe("fail"); // 20% drift > 5%
    // crm-sync: expected=8 (booked records) vs actual=9 (booked opps)
    const crmSync = report.checks.find((c) => c.name === "crm-sync");
    expect(crmSync).toMatchObject({ expected: 8, actual: 9 });
    expect(report.overallStatus).toBe("failing");
    expect(report.checks).not.toHaveLength(0); // proves the stub is gone
    expect(save).toHaveBeenCalledTimes(1);
  });
});
