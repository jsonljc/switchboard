export interface DateRange {
  from: Date;
  to: Date;
}

export interface Check {
  name: string;
  status: string;
  expected: number;
  actual: number;
  driftPercent: number;
}

export interface ReconciliationReport {
  organizationId: string;
  dateRangeFrom: Date;
  dateRangeTo: Date;
  overallStatus: string;
  checks: Check[];
}

export interface ReconciliationDeps {
  bookingStore: {
    countConfirmedInWindow(orgId: string, from: Date, to: Date): Promise<number>;
  };
  conversionRecordStore: {
    countByType(orgId: string, type: string, from: Date, to: Date): Promise<number>;
  };
  opportunityStore: {
    countCurrentlyAtStageUpdatedInWindow(input: {
      orgId: string;
      stage: string;
      from: Date;
      to: Date;
    }): Promise<number>;
  };
  reconciliationStore: { save(input: ReconciliationReport): Promise<unknown> };
}

export class ReconciliationRunner {
  constructor(private deps: ReconciliationDeps) {}

  async run(orgId: string, dateRange: DateRange): Promise<ReconciliationReport> {
    const checks: Check[] = [];

    // All three counts must cover the SAME window or every check drifts by construction.
    // The booked-conversion count is windowed on occurredAt (= the booking-confirm time, set
    // "now" at confirm, never the future slot), so the confirmed-booking and booked-opportunity
    // counts are windowed on the matching dateRange too (P2-20). A previous version compared an
    // ALL-TIME confirmed-booking / booked-opportunity count against this 7-day booked count,
    // persisting "failing" every run for any org older than the window.
    const confirmedBookings = await this.deps.bookingStore.countConfirmedInWindow(
      orgId,
      dateRange.from,
      dateRange.to,
    );
    const bookedRecords = await this.deps.conversionRecordStore.countByType(
      orgId,
      "booked",
      dateRange.from,
      dateRange.to,
    );
    checks.push(this.check("booking-linkage", confirmedBookings, bookedRecords));

    // Opportunities currently at the "booked" stage whose stage last changed within the window
    // (updatedAt is the stage-change axis; there is no per-stage-change column). The half-open
    // [from, to) boundary differs from the booked-conversion count's closed [from, to] by a
    // single instant, which is immaterial against the 1%/5% drift floors over a multi-day window.
    const bookedOpps = await this.deps.opportunityStore.countCurrentlyAtStageUpdatedInWindow({
      orgId,
      stage: "booked",
      from: dateRange.from,
      to: dateRange.to,
    });
    checks.push(this.check("crm-sync", bookedRecords, bookedOpps));

    const overallStatus = this.deriveStatus(checks);

    const report: ReconciliationReport = {
      organizationId: orgId,
      dateRangeFrom: dateRange.from,
      dateRangeTo: dateRange.to,
      overallStatus,
      checks,
    };

    await this.deps.reconciliationStore.save(report);
    return report;
  }

  private check(name: string, expected: number, actual: number): Check {
    // Relative drift needs a non-zero denominator. When expected is 0, a positive actual is a
    // full discrepancy (a phantom on the actual side), not a pass. Windowing makes expected===0
    // common (a quiet week), so this branch must flag it. expected===actual===0 is honest
    // agreement (drift 0). Without this, a zero-expected check would silently report "pass".
    const drift = expected === 0 ? (actual === 0 ? 0 : 1) : Math.abs(expected - actual) / expected;
    let status = "pass";
    if (drift > 0.05) status = "fail";
    else if (drift > 0.01) status = "warn";
    return {
      name,
      status,
      expected,
      actual,
      driftPercent: Math.round(drift * 100),
    };
  }

  private deriveStatus(checks: Check[]): string {
    if (checks.some((c) => c.status === "fail")) return "failing";
    if (checks.some((c) => c.status === "warn")) return "degraded";
    return "healthy";
  }
}
