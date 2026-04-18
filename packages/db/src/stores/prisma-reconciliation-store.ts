import type { PrismaDbClient } from "../prisma-db.js";

interface ReconciliationReportInput {
  organizationId: string;
  dateRangeFrom: Date;
  dateRangeTo: Date;
  overallStatus: string;
  checks: unknown;
}

export class PrismaReconciliationStore {
  constructor(private prisma: PrismaDbClient) {}

  async save(input: ReconciliationReportInput) {
    return this.prisma.reconciliationReport.create({
      data: {
        organizationId: input.organizationId,
        dateRangeFrom: input.dateRangeFrom,
        dateRangeTo: input.dateRangeTo,
        overallStatus: input.overallStatus,
        checks: input.checks as never,
      },
    });
  }

  async latest(orgId: string) {
    return this.prisma.reconciliationReport.findFirst({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    });
  }
}
