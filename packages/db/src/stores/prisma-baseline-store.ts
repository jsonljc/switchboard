import type { PrismaDbClient } from "../prisma-db.js";
import type { BaselineStore, BaselineRow, BaselineDimension } from "@switchboard/core/reports";

export class PrismaBaselineStore implements BaselineStore {
  constructor(private prisma: PrismaDbClient) {}

  async listByDimension(orgId: string, dimension: BaselineDimension): Promise<BaselineRow[]> {
    const rows = await this.prisma.preSwitchboardBaseline.findMany({
      where: { organizationId: orgId, dimension },
      orderBy: { periodStart: "asc" },
    });
    return rows.map((r) => ({
      organizationId: r.organizationId,
      dimension: r.dimension as BaselineDimension,
      metric: r.metric,
      value: r.value,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      capturedAt: r.capturedAt,
    }));
  }

  async insertMany(rows: ReadonlyArray<BaselineRow>): Promise<void> {
    if (rows.length === 0) return;
    await this.prisma.preSwitchboardBaseline.createMany({
      data: rows.map((r) => ({
        organizationId: r.organizationId,
        dimension: r.dimension,
        metric: r.metric,
        value: r.value,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        capturedAt: r.capturedAt,
      })),
      skipDuplicates: true,
    });
  }
}
