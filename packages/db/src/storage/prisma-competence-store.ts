import type { PrismaClient } from "@prisma/client";
import type { CompetenceRecord, CompetencePolicy, CompetenceEvent, CompetenceThresholds } from "@switchboard/schemas";
import type { CompetenceStore } from "@switchboard/core";
import { matchActionTypePattern } from "@switchboard/core";

export class PrismaCompetenceStore implements CompetenceStore {
  constructor(private prisma: PrismaClient) {}

  async getRecord(principalId: string, actionType: string): Promise<CompetenceRecord | null> {
    const row = await this.prisma.competenceRecord.findUnique({
      where: { principalId_actionType: { principalId, actionType } },
    });
    if (!row) return null;
    return toCompetenceRecord(row);
  }

  async saveRecord(record: CompetenceRecord): Promise<void> {
    await this.prisma.competenceRecord.upsert({
      where: { principalId_actionType: { principalId: record.principalId, actionType: record.actionType } },
      create: {
        id: record.id,
        principalId: record.principalId,
        actionType: record.actionType,
        successCount: record.successCount,
        failureCount: record.failureCount,
        rollbackCount: record.rollbackCount,
        consecutiveSuccesses: record.consecutiveSuccesses,
        score: record.score,
        lastActivityAt: record.lastActivityAt,
        lastDecayAppliedAt: record.lastDecayAppliedAt,
        history: record.history as unknown as object,
        createdAt: record.createdAt,
      },
      update: {
        successCount: record.successCount,
        failureCount: record.failureCount,
        rollbackCount: record.rollbackCount,
        consecutiveSuccesses: record.consecutiveSuccesses,
        score: record.score,
        lastActivityAt: record.lastActivityAt,
        lastDecayAppliedAt: record.lastDecayAppliedAt,
        history: record.history as unknown as object,
      },
    });
  }

  async listRecords(principalId: string): Promise<CompetenceRecord[]> {
    const rows = await this.prisma.competenceRecord.findMany({
      where: { principalId },
    });
    return rows.map(toCompetenceRecord);
  }

  async getPolicy(actionType: string): Promise<CompetencePolicy | null> {
    // First try exact match
    const exact = await this.prisma.competencePolicy.findFirst({
      where: { actionTypePattern: actionType, enabled: true },
    });
    if (exact) return toCompetencePolicy(exact);

    // Then try glob match among all enabled policies with patterns
    const allPolicies = await this.prisma.competencePolicy.findMany({
      where: { enabled: true, actionTypePattern: { not: null } },
    });
    for (const policy of allPolicies) {
      if (
        policy.actionTypePattern !== null &&
        matchActionTypePattern(policy.actionTypePattern, actionType)
      ) {
        return toCompetencePolicy(policy);
      }
    }

    return null;
  }

  async getDefaultPolicy(): Promise<CompetencePolicy | null> {
    const row = await this.prisma.competencePolicy.findFirst({
      where: { actionTypePattern: null, enabled: true },
    });
    if (!row) return null;
    return toCompetencePolicy(row);
  }

  async savePolicy(policy: CompetencePolicy): Promise<void> {
    await this.prisma.competencePolicy.upsert({
      where: { id: policy.id },
      create: {
        id: policy.id,
        name: policy.name,
        description: policy.description,
        actionTypePattern: policy.actionTypePattern,
        thresholds: policy.thresholds as object,
        enabled: policy.enabled,
        createdAt: policy.createdAt,
      },
      update: {
        name: policy.name,
        description: policy.description,
        actionTypePattern: policy.actionTypePattern,
        thresholds: policy.thresholds as object,
        enabled: policy.enabled,
      },
    });
  }

  async listPolicies(): Promise<CompetencePolicy[]> {
    const rows = await this.prisma.competencePolicy.findMany();
    return rows.map(toCompetencePolicy);
  }
}

function toCompetenceRecord(row: {
  id: string;
  principalId: string;
  actionType: string;
  successCount: number;
  failureCount: number;
  rollbackCount: number;
  consecutiveSuccesses: number;
  score: number;
  lastActivityAt: Date;
  lastDecayAppliedAt: Date;
  history: unknown;
  createdAt: Date;
  updatedAt: Date;
}): CompetenceRecord {
  return {
    id: row.id,
    principalId: row.principalId,
    actionType: row.actionType,
    successCount: row.successCount,
    failureCount: row.failureCount,
    rollbackCount: row.rollbackCount,
    consecutiveSuccesses: row.consecutiveSuccesses,
    score: row.score,
    lastActivityAt: row.lastActivityAt,
    lastDecayAppliedAt: row.lastDecayAppliedAt,
    history: (row.history as CompetenceEvent[]) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCompetencePolicy(row: {
  id: string;
  name: string;
  description: string;
  actionTypePattern: string | null;
  thresholds: unknown;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CompetencePolicy {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    actionTypePattern: row.actionTypePattern,
    thresholds: row.thresholds as CompetenceThresholds,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
