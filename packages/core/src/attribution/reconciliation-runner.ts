interface DateRange {
  from: Date;
  to: Date;
}

interface Check {
  name: string;
  status: string;
  expected: number;
  actual: number;
  driftPercent: number;
}

interface ReconciliationReport {
  organizationId: string;
  dateRangeFrom: Date;
  dateRangeTo: Date;
  overallStatus: string;
  checks: Check[];
}

interface ReconciliationDeps {
  bookingStore: { countConfirmed(orgId: string): Promise<number> };
  conversionRecordStore: {
    countByType(orgId: string, type: string, from: Date, to: Date): Promise<number>;
  };
  opportunityStore: { countByStage(orgId: string, stage: string): Promise<number> };
  reconciliationStore: { save(input: ReconciliationReport): Promise<unknown> };
}

export class ReconciliationRunner {
  constructor(private deps: ReconciliationDeps) {}

  async run(orgId: string, dateRange: DateRange): Promise<ReconciliationReport> {
    const checks: Check[] = [];

    const confirmedBookings = await this.deps.bookingStore.countConfirmed(orgId);
    const bookedRecords = await this.deps.conversionRecordStore.countByType(
      orgId,
      "booked",
      dateRange.from,
      dateRange.to,
    );
    checks.push(this.check("booking-linkage", confirmedBookings, bookedRecords));

    const bookedOpps = await this.deps.opportunityStore.countByStage(orgId, "booked");
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
    const drift = expected === 0 ? 0 : Math.abs(expected - actual) / expected;
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
