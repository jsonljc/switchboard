// ---------------------------------------------------------------------------
// PrismaWeeklyDigestStore — Prisma-backed weekly digest persistence
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";

interface WeeklyDigestRecord {
  id: string;
  accountId: string;
  organizationId: string;
  weekStartDate: string;
  headline: string;
  summary: string;
  constraintHistory: string[];
  interventionOutcomes: Array<{
    interventionId: string;
    actionType: string;
    outcome: string;
  }>;
  createdAt: string;
}

export class PrismaWeeklyDigestStore {
  constructor(private prisma: PrismaClient) {}

  async save(digest: WeeklyDigestRecord): Promise<void> {
    // Resolve the RevenueAccount FK
    const revenueAccountId = await this.resolveRevenueAccountId(digest.accountId);

    await this.prisma.revGrowthWeeklyDigest.upsert({
      where: { id: digest.id },
      create: {
        id: digest.id,
        revenueAccountId,
        organizationId: digest.organizationId,
        weekStartDate: digest.weekStartDate,
        headline: digest.headline,
        summary: digest.summary,
        constraintHistory: digest.constraintHistory,
        interventionOutcomes: digest.interventionOutcomes as object[],
        createdAt: new Date(digest.createdAt),
      },
      update: {
        headline: digest.headline,
        summary: digest.summary,
        constraintHistory: digest.constraintHistory,
        interventionOutcomes: digest.interventionOutcomes as object[],
      },
    });
  }

  async getLatest(accountId: string): Promise<WeeklyDigestRecord | null> {
    const accounts = await this.prisma.revenueAccount.findMany({
      where: { accountId },
      select: { id: true },
    });
    if (accounts.length === 0) return null;

    const row = await this.prisma.revGrowthWeeklyDigest.findFirst({
      where: { revenueAccountId: { in: accounts.map((a) => a.id) } },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    return toDigestRecord(row, accountId);
  }

  async listByAccount(accountId: string, limit?: number): Promise<WeeklyDigestRecord[]> {
    const accounts = await this.prisma.revenueAccount.findMany({
      where: { accountId },
      select: { id: true },
    });
    if (accounts.length === 0) return [];

    const rows = await this.prisma.revGrowthWeeklyDigest.findMany({
      where: { revenueAccountId: { in: accounts.map((a) => a.id) } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((r) => toDigestRecord(r, accountId));
  }

  private async resolveRevenueAccountId(accountId: string): Promise<string> {
    const account = await this.prisma.revenueAccount.findFirst({
      where: { accountId },
      select: { id: true },
    });
    return account?.id ?? "unknown";
  }
}

function toDigestRecord(
  row: {
    id: string;
    organizationId: string;
    weekStartDate: string;
    headline: string;
    summary: string;
    constraintHistory: string[];
    interventionOutcomes: unknown;
    createdAt: Date;
  },
  accountId: string,
): WeeklyDigestRecord {
  return {
    id: row.id,
    accountId,
    organizationId: row.organizationId,
    weekStartDate: row.weekStartDate,
    headline: row.headline,
    summary: row.summary,
    constraintHistory: row.constraintHistory,
    interventionOutcomes: row.interventionOutcomes as WeeklyDigestRecord["interventionOutcomes"],
    createdAt: row.createdAt.toISOString(),
  };
}
