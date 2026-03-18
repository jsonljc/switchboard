// ---------------------------------------------------------------------------
// PrismaHandoffStore — Prisma-backed handoff persistence
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";
import type {
  HandoffPackage,
  HandoffStatus,
  HandoffStore,
  HandoffReason,
  LeadSnapshot,
  QualificationSnapshot,
  ConversationSummary,
} from "@switchboard/core";

export class PrismaHandoffStore implements HandoffStore {
  constructor(private prisma: PrismaClient) {}

  async save(pkg: HandoffPackage): Promise<void> {
    await this.prisma.handoff.upsert({
      where: { id: pkg.id },
      create: {
        id: pkg.id,
        sessionId: pkg.sessionId,
        organizationId: pkg.organizationId,
        status: pkg.status,
        reason: pkg.reason,
        leadSnapshot: pkg.leadSnapshot as object,
        qualificationSnapshot: pkg.qualificationSnapshot as object,
        conversationSummary: pkg.conversationSummary as object,
        slaDeadlineAt: pkg.slaDeadlineAt,
        acknowledgedAt: pkg.acknowledgedAt ?? null,
        createdAt: pkg.createdAt,
      },
      update: {
        status: pkg.status,
        leadSnapshot: pkg.leadSnapshot as object,
        qualificationSnapshot: pkg.qualificationSnapshot as object,
        conversationSummary: pkg.conversationSummary as object,
        slaDeadlineAt: pkg.slaDeadlineAt,
        acknowledgedAt: pkg.acknowledgedAt ?? null,
      },
    });
  }

  async getById(id: string): Promise<HandoffPackage | null> {
    const row = await this.prisma.handoff.findUnique({ where: { id } });
    if (!row) return null;
    return toHandoffPackage(row);
  }

  async getBySessionId(sessionId: string): Promise<HandoffPackage | null> {
    const row = await this.prisma.handoff.findFirst({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    return toHandoffPackage(row);
  }

  async updateStatus(id: string, status: HandoffStatus, acknowledgedAt?: Date): Promise<void> {
    const data: Record<string, unknown> = { status };
    if (acknowledgedAt) {
      data["acknowledgedAt"] = acknowledgedAt;
    }
    await this.prisma.handoff.update({ where: { id }, data });
  }

  async listPending(organizationId: string): Promise<HandoffPackage[]> {
    const rows = await this.prisma.handoff.findMany({
      where: {
        organizationId,
        status: { in: ["pending", "assigned", "active"] },
      },
      orderBy: { slaDeadlineAt: "asc" },
    });
    return rows.map(toHandoffPackage);
  }
}

// ---------------------------------------------------------------------------
// Row → domain mapping
// ---------------------------------------------------------------------------

interface HandoffRow {
  id: string;
  sessionId: string;
  organizationId: string;
  status: string;
  reason: string;
  leadSnapshot: unknown;
  qualificationSnapshot: unknown;
  conversationSummary: unknown;
  slaDeadlineAt: Date;
  acknowledgedAt: Date | null;
  createdAt: Date;
}

function toHandoffPackage(row: HandoffRow): HandoffPackage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    organizationId: row.organizationId,
    reason: row.reason as HandoffReason,
    status: row.status as HandoffStatus,
    leadSnapshot: row.leadSnapshot as LeadSnapshot,
    qualificationSnapshot: row.qualificationSnapshot as QualificationSnapshot,
    conversationSummary: row.conversationSummary as ConversationSummary,
    slaDeadlineAt: row.slaDeadlineAt,
    createdAt: row.createdAt,
    acknowledgedAt: row.acknowledgedAt ?? undefined,
  };
}
