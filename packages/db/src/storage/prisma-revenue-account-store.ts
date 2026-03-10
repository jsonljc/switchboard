// ---------------------------------------------------------------------------
// PrismaRevenueAccountStore — Prisma-backed revenue account persistence
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";

interface RevenueAccountRecord {
  organizationId: string;
  accountId: string;
  active: boolean;
  cadenceMinutes: number;
  nextCycleAt: string;
  lastCycleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export class PrismaRevenueAccountStore {
  constructor(private prisma: PrismaClient) {}

  async upsert(account: RevenueAccountRecord): Promise<void> {
    await this.prisma.revenueAccount.upsert({
      where: {
        organizationId_accountId: {
          organizationId: account.organizationId,
          accountId: account.accountId,
        },
      },
      create: {
        organizationId: account.organizationId,
        accountId: account.accountId,
        active: account.active,
        nextCycleAt: new Date(account.nextCycleAt),
        createdAt: new Date(account.createdAt),
        updatedAt: new Date(account.updatedAt),
      },
      update: {
        active: account.active,
        nextCycleAt: new Date(account.nextCycleAt),
        updatedAt: new Date(account.updatedAt),
      },
    });
  }

  async getByAccountId(orgId: string, accountId: string): Promise<RevenueAccountRecord | null> {
    const row = await this.prisma.revenueAccount.findUnique({
      where: {
        organizationId_accountId: {
          organizationId: orgId,
          accountId,
        },
      },
    });
    if (!row) return null;
    return toAccountRecord(row);
  }

  async listDue(): Promise<RevenueAccountRecord[]> {
    const rows = await this.prisma.revenueAccount.findMany({
      where: {
        active: true,
        nextCycleAt: { lte: new Date() },
      },
      orderBy: { nextCycleAt: "asc" },
    });
    return rows.map(toAccountRecord);
  }
}

function toAccountRecord(row: {
  organizationId: string;
  accountId: string;
  active: boolean;
  nextCycleAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): RevenueAccountRecord {
  return {
    organizationId: row.organizationId,
    accountId: row.accountId,
    active: row.active,
    cadenceMinutes: 60, // Default; Prisma model doesn't store this directly
    nextCycleAt: row.nextCycleAt?.toISOString() ?? new Date().toISOString(),
    lastCycleId: null, // Prisma model uses lastCycleAt instead
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
