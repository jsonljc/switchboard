// ---------------------------------------------------------------------------
// PrismaDiagnosticCycleStore — Prisma-backed diagnostic cycle persistence
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";

interface DiagnosticCycleRecord {
  id: string;
  accountId: string;
  organizationId: string;
  dataTier: string;
  scorerOutputs: unknown[];
  constraints: unknown[];
  primaryConstraint: string | null;
  previousPrimaryConstraint: string | null;
  constraintTransition: boolean;
  interventions: Array<{ id: string }>;
  startedAt: string;
  completedAt: string | null;
}

export class PrismaDiagnosticCycleStore {
  constructor(private prisma: PrismaClient) {}

  async save(cycle: DiagnosticCycleRecord): Promise<void> {
    // Resolve the RevenueAccount FK from org+account
    const revenueAccountId = await this.resolveRevenueAccountId(
      cycle.organizationId,
      cycle.accountId,
    );

    await this.prisma.revGrowthDiagnosticCycle.upsert({
      where: { id: cycle.id },
      create: {
        id: cycle.id,
        revenueAccountId,
        organizationId: cycle.organizationId,
        dataTier: cycle.dataTier,
        scorerOutputs: cycle.scorerOutputs as object[],
        constraints: cycle.constraints as object[],
        primaryConstraint: cycle.primaryConstraint,
        previousPrimaryConstraint: cycle.previousPrimaryConstraint,
        constraintTransition: cycle.constraintTransition,
        startedAt: new Date(cycle.startedAt),
        completedAt: cycle.completedAt ? new Date(cycle.completedAt) : null,
      },
      update: {
        completedAt: cycle.completedAt ? new Date(cycle.completedAt) : null,
        scorerOutputs: cycle.scorerOutputs as object[],
        constraints: cycle.constraints as object[],
      },
    });
  }

  async getLatest(accountId: string): Promise<DiagnosticCycleRecord | null> {
    // Find RevenueAccount(s) matching this external accountId
    const accounts = await this.prisma.revenueAccount.findMany({
      where: { accountId },
      select: { id: true },
    });
    if (accounts.length === 0) return null;

    const row = await this.prisma.revGrowthDiagnosticCycle.findFirst({
      where: { revenueAccountId: { in: accounts.map((a) => a.id) } },
      orderBy: { completedAt: "desc" },
      include: { revenueAccount: { select: { accountId: true } } },
    });
    if (!row) return null;
    return toCycleRecord(row, row.revenueAccount.accountId);
  }

  async listByAccount(accountId: string, limit?: number): Promise<DiagnosticCycleRecord[]> {
    const accounts = await this.prisma.revenueAccount.findMany({
      where: { accountId },
      select: { id: true },
    });
    if (accounts.length === 0) return [];

    const rows = await this.prisma.revGrowthDiagnosticCycle.findMany({
      where: { revenueAccountId: { in: accounts.map((a) => a.id) } },
      orderBy: { completedAt: "desc" },
      take: limit,
      include: { revenueAccount: { select: { accountId: true } } },
    });
    return rows.map((r) => toCycleRecord(r, r.revenueAccount.accountId));
  }

  private async resolveRevenueAccountId(
    organizationId: string,
    accountId: string,
  ): Promise<string> {
    const account = await this.prisma.revenueAccount.findUnique({
      where: { organizationId_accountId: { organizationId, accountId } },
      select: { id: true },
    });
    return account?.id ?? "unknown";
  }
}

function toCycleRecord(
  row: {
    id: string;
    organizationId: string;
    dataTier: string;
    scorerOutputs: unknown;
    constraints: unknown;
    primaryConstraint: string | null;
    previousPrimaryConstraint: string | null;
    constraintTransition: boolean;
    startedAt: Date;
    completedAt: Date | null;
  },
  accountId: string,
): DiagnosticCycleRecord {
  return {
    id: row.id,
    accountId,
    organizationId: row.organizationId,
    dataTier: row.dataTier,
    scorerOutputs: row.scorerOutputs as unknown[],
    constraints: row.constraints as unknown[],
    primaryConstraint: row.primaryConstraint,
    previousPrimaryConstraint: row.previousPrimaryConstraint,
    constraintTransition: row.constraintTransition,
    interventions: [], // Interventions are stored separately
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
