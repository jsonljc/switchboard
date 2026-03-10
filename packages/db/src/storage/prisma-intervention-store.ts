// ---------------------------------------------------------------------------
// PrismaInterventionStore — Prisma-backed intervention persistence
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";

type GovernanceStatus =
  | "PROPOSED"
  | "APPROVED"
  | "EXECUTING"
  | "EXECUTED"
  | "DEFERRED"
  | "REJECTED";
type OutcomeStatus =
  | "PENDING"
  | "MEASURING"
  | "IMPROVED"
  | "NO_CHANGE"
  | "REGRESSED"
  | "INCONCLUSIVE";
type ConstraintType =
  | "SIGNAL"
  | "CREATIVE"
  | "FUNNEL"
  | "SALES"
  | "SATURATION"
  | "OFFER"
  | "CAPACITY";
type RevGrowthActionType =
  | "FIX_TRACKING"
  | "REFRESH_CREATIVE"
  | "OPTIMIZE_FUNNEL"
  | "IMPROVE_SALES_PROCESS"
  | "EXPAND_AUDIENCE"
  | "REVISE_OFFER"
  | "SCALE_CAPACITY";
type ImpactTier = "HIGH" | "MEDIUM" | "LOW";

type ArtifactType = "brief" | "checklist" | "template" | "report";

interface Intervention {
  id: string;
  cycleId: string;
  constraintType: ConstraintType;
  actionType: RevGrowthActionType;
  status: GovernanceStatus;
  priority: number;
  estimatedImpact: ImpactTier;
  reasoning: string;
  artifacts: Array<{
    type: ArtifactType;
    title: string;
    content: string;
    generatedAt: string;
  }>;
  outcomeStatus: OutcomeStatus;
  measurementWindowDays?: number;
  measurementStartedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export class PrismaInterventionStore {
  constructor(private prisma: PrismaClient) {}

  async save(intervention: Intervention): Promise<void> {
    // Look up the RevenueAccount to get its internal id for the FK
    const revenueAccountId = await this.resolveRevenueAccountId(intervention.cycleId);

    await this.prisma.revGrowthIntervention.upsert({
      where: { id: intervention.id },
      create: {
        id: intervention.id,
        cycleId: intervention.cycleId,
        revenueAccountId,
        constraintType: intervention.constraintType,
        actionType: intervention.actionType,
        status: intervention.status,
        priority: intervention.priority,
        estimatedImpact: intervention.estimatedImpact,
        reasoning: intervention.reasoning,
        artifacts: intervention.artifacts as object[],
        outcomeStatus: intervention.outcomeStatus,
        measurementWindowDays: intervention.measurementWindowDays ?? null,
        measurementStartedAt: intervention.measurementStartedAt
          ? new Date(intervention.measurementStartedAt)
          : null,
        createdAt: new Date(intervention.createdAt),
        updatedAt: new Date(intervention.updatedAt),
      },
      update: {
        status: intervention.status,
        outcomeStatus: intervention.outcomeStatus,
        measurementStartedAt: intervention.measurementStartedAt
          ? new Date(intervention.measurementStartedAt)
          : null,
        updatedAt: new Date(intervention.updatedAt),
        artifacts: intervention.artifacts as object[],
      },
    });
  }

  async getById(id: string): Promise<Intervention | null> {
    const row = await this.prisma.revGrowthIntervention.findUnique({ where: { id } });
    if (!row) return null;
    return toIntervention(row);
  }

  async listByCycle(cycleId: string): Promise<Intervention[]> {
    const rows = await this.prisma.revGrowthIntervention.findMany({
      where: { cycleId },
      orderBy: { priority: "asc" },
    });
    return rows.map(toIntervention);
  }

  async listByAccount(
    _accountId: string,
    opts?: { status?: string; limit?: number },
  ): Promise<Intervention[]> {
    const rows = await this.prisma.revGrowthIntervention.findMany({
      where: opts?.status ? { status: opts.status } : undefined,
      orderBy: { createdAt: "desc" },
      take: opts?.limit,
    });
    return rows.map(toIntervention);
  }

  async listPendingOutcomes(): Promise<Intervention[]> {
    const rows = await this.prisma.revGrowthIntervention.findMany({
      where: {
        outcomeStatus: "PENDING",
        measurementStartedAt: { not: null },
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toIntervention);
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.prisma.revGrowthIntervention.update({
      where: { id },
      data: { status, updatedAt: new Date() },
    });
  }

  async updateOutcome(id: string, outcomeStatus: string): Promise<void> {
    await this.prisma.revGrowthIntervention.update({
      where: { id },
      data: { outcomeStatus, updatedAt: new Date() },
    });
  }

  private async resolveRevenueAccountId(cycleId: string): Promise<string> {
    const cycle = await this.prisma.revGrowthDiagnosticCycle.findUnique({
      where: { id: cycleId },
      select: { revenueAccountId: true },
    });
    return cycle?.revenueAccountId ?? "unknown";
  }
}

function toIntervention(row: {
  id: string;
  cycleId: string;
  constraintType: string;
  actionType: string;
  status: string;
  priority: number;
  estimatedImpact: string;
  reasoning: string;
  artifacts: unknown;
  outcomeStatus: string;
  measurementWindowDays: number | null;
  measurementStartedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Intervention {
  return {
    id: row.id,
    cycleId: row.cycleId,
    constraintType: row.constraintType as ConstraintType,
    actionType: row.actionType as RevGrowthActionType,
    status: row.status as GovernanceStatus,
    priority: row.priority,
    estimatedImpact: row.estimatedImpact as ImpactTier,
    reasoning: row.reasoning,
    artifacts: row.artifacts as Intervention["artifacts"],
    outcomeStatus: row.outcomeStatus as OutcomeStatus,
    measurementWindowDays: row.measurementWindowDays ?? undefined,
    measurementStartedAt: row.measurementStartedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
