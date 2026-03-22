import type { PrismaClient } from "@prisma/client";

export interface RoasSnapshotInput {
  orgId: string;
  entityType: string;
  entityId: string;
  platform: string;
  adAccountId?: string;
  roas: number;
  spend: number;
  revenue: number;
  currency?: string;
  campaignStatus?: string;
  attributionWindow?: string;
  dataFreshnessAt?: Date;
  snapshotDate: Date;
  optimizerRunId?: string;
}

export interface RoasSnapshotRow {
  roas: number;
  spend: number;
  revenue: number;
  snapshotDate: Date;
  platform: string;
  campaignStatus: string | null;
}

export class PrismaRoasStore {
  constructor(private prisma: PrismaClient) {}

  async saveSnapshot(input: RoasSnapshotInput): Promise<void> {
    await this.prisma.roasSnapshot.upsert({
      where: {
        orgId_entityType_entityId_snapshotDate: {
          orgId: input.orgId,
          entityType: input.entityType,
          entityId: input.entityId,
          snapshotDate: input.snapshotDate,
        },
      },
      create: {
        orgId: input.orgId,
        entityType: input.entityType,
        entityId: input.entityId,
        platform: input.platform,
        adAccountId: input.adAccountId ?? null,
        roas: input.roas,
        spend: input.spend,
        revenue: input.revenue,
        currency: input.currency ?? "USD",
        campaignStatus: input.campaignStatus ?? null,
        attributionWindow: input.attributionWindow ?? null,
        dataFreshnessAt: input.dataFreshnessAt ?? null,
        snapshotDate: input.snapshotDate,
        optimizerRunId: input.optimizerRunId ?? null,
      },
      update: {
        roas: input.roas,
        spend: input.spend,
        revenue: input.revenue,
        campaignStatus: input.campaignStatus ?? null,
        dataFreshnessAt: input.dataFreshnessAt ?? null,
        optimizerRunId: input.optimizerRunId ?? null,
      },
    });
  }

  async getWindow(
    orgId: string,
    entityType: string,
    entityId: string,
    lookbackDays: number,
  ): Promise<RoasSnapshotRow[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);

    const rows = await this.prisma.roasSnapshot.findMany({
      where: {
        orgId,
        entityType,
        entityId,
        snapshotDate: { gte: cutoff },
      },
      orderBy: { snapshotDate: "asc" },
    });

    return rows.map((r) => ({
      roas: r.roas,
      spend: r.spend,
      revenue: r.revenue,
      snapshotDate: r.snapshotDate,
      platform: r.platform,
      campaignStatus: r.campaignStatus,
    }));
  }
}
