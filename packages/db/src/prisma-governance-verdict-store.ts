import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type {
  GovernanceVerdictStore,
  SaveGovernanceVerdictInput,
  GovernanceVerdictRecord,
  GovernanceVerdictDetails,
} from "@switchboard/core";

type Row = {
  id: string;
  deploymentId: string;
  conversationId: string;
  action: string;
  reasonCode: string;
  jurisdiction: string;
  clinicType: string;
  sourceGuard: string;
  originalText: string | null;
  emittedText: string | null;
  auditLevel: string;
  decidedAt: Date;
  modelLatencyMs: number | null;
  details: unknown;
  createdAt: Date;
};

function toRecord(row: Row): GovernanceVerdictRecord {
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    conversationId: row.conversationId,
    action: row.action as GovernanceVerdictRecord["action"],
    reasonCode: row.reasonCode as GovernanceVerdictRecord["reasonCode"],
    jurisdiction: row.jurisdiction as GovernanceVerdictRecord["jurisdiction"],
    clinicType: row.clinicType as GovernanceVerdictRecord["clinicType"],
    sourceGuard: row.sourceGuard as GovernanceVerdictRecord["sourceGuard"],
    originalText: row.originalText ?? undefined,
    emittedText: row.emittedText ?? undefined,
    auditLevel: row.auditLevel as GovernanceVerdictRecord["auditLevel"],
    decidedAt: row.decidedAt.toISOString(),
    modelLatencyMs: row.modelLatencyMs ?? undefined,
    details: (row.details ?? null) as GovernanceVerdictDetails | null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface PrismaGovernanceVerdictStoreOptions {
  /**
   * Optional post-write callback. Fires AFTER a verdict row is successfully
   * persisted. Errors propagate to the caller — the row has already been
   * persisted, but the caller learns the side effect failed.
   *
   * SINGLE-CALLBACK SLOT, currently occupied: both app bootstraps pass
   * `recordGovernanceVerdictMetric` (the switchboard_governance_verdicts_total
   * counter). A future consumer (e.g. the deferred Phase 3a lifecycle
   * escalation, which today uses its own registrar in bootstrap/lifecycle.ts)
   * must COMPOSE with the metric callback, not replace it.
   */
  onWrite?: (record: GovernanceVerdictRecord) => Promise<void>;
}

export class PrismaGovernanceVerdictStore implements GovernanceVerdictStore {
  private readonly onWrite?: (record: GovernanceVerdictRecord) => Promise<void>;

  constructor(
    private readonly prisma: PrismaClient,
    options: PrismaGovernanceVerdictStoreOptions = {},
  ) {
    this.onWrite = options.onWrite;
  }

  async save(input: SaveGovernanceVerdictInput): Promise<GovernanceVerdictRecord> {
    const row = await this.prisma.governanceVerdict.create({
      data: {
        deploymentId: input.deploymentId,
        conversationId: input.conversationId,
        action: input.action,
        reasonCode: input.reasonCode,
        jurisdiction: input.jurisdiction,
        clinicType: input.clinicType,
        sourceGuard: input.sourceGuard,
        originalText: input.originalText ?? null,
        emittedText: input.emittedText ?? null,
        auditLevel: input.auditLevel,
        decidedAt: new Date(input.decidedAt),
        modelLatencyMs: input.modelLatencyMs ?? null,
        details: input.details ? (input.details as object) : Prisma.JsonNull,
      },
    });
    const record = toRecord(row as Row);
    if (this.onWrite) {
      await this.onWrite(record);
    }
    return record;
  }

  async listByConversation(conversationId: string): Promise<GovernanceVerdictRecord[]> {
    const rows = await this.prisma.governanceVerdict.findMany({
      where: { conversationId },
      orderBy: { decidedAt: "desc" },
    });
    return (rows as Row[]).map(toRecord);
  }

  async listByDeployment(
    deploymentId: string,
    options?: { since?: string; limit?: number },
  ): Promise<GovernanceVerdictRecord[]> {
    const rows = await this.prisma.governanceVerdict.findMany({
      where: {
        deploymentId,
        ...(options?.since ? { decidedAt: { gte: new Date(options.since) } } : {}),
      },
      orderBy: { decidedAt: "desc" },
      ...(options?.limit ? { take: options.limit } : {}),
    });
    return (rows as Row[]).map(toRecord);
  }

  async countByDeploymentAndClaim(input: {
    deploymentId: string;
    claimType: string;
    action?: string;
    from: Date;
    to: Date;
  }): Promise<number> {
    return this.prisma.governanceVerdict.count({
      where: {
        deploymentId: input.deploymentId,
        sourceGuard: input.claimType,
        ...(input.action ? { action: input.action } : {}),
        decidedAt: { gte: input.from, lt: input.to },
      },
    });
  }

  async summarizeByDeployment(
    deploymentId: string,
    options?: { since?: string },
  ): Promise<Array<{ sourceGuard: string; reasonCode: string; action: string; count: number }>> {
    const grouped = await this.prisma.governanceVerdict.groupBy({
      by: ["sourceGuard", "reasonCode", "action"],
      where: {
        deploymentId,
        ...(options?.since ? { decidedAt: { gte: new Date(options.since) } } : {}),
      },
      _count: { _all: true },
    });
    return grouped.map((g) => ({
      sourceGuard: g.sourceGuard,
      reasonCode: g.reasonCode,
      action: g.action,
      count: g._count._all,
    }));
  }
}
