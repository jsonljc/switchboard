// ---------------------------------------------------------------------------
// PrismaHandoffStore — Prisma-backed handoff persistence
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";
import type {
  Handoff,
  HandoffStatus,
  HandoffStore,
  HandoffReason,
  LeadSnapshot,
  QualificationSnapshot,
  HandoffConversationSummary,
} from "@switchboard/core";

export class PrismaHandoffStore implements HandoffStore {
  constructor(private prisma: PrismaClient) {}

  async save(pkg: Handoff): Promise<void> {
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

  async getById(organizationId: string, id: string): Promise<Handoff | null> {
    const row = await this.prisma.handoff.findFirst({ where: { id, organizationId } });
    if (!row) return null;
    return toHandoffPackage(row);
  }

  async getBySessionId(organizationId: string, sessionId: string): Promise<Handoff | null> {
    const row = await this.prisma.handoff.findFirst({
      where: { sessionId, organizationId },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    return toHandoffPackage(row);
  }

  async updateStatus(
    organizationId: string,
    id: string,
    status: HandoffStatus,
    acknowledgedAt?: Date,
  ): Promise<void> {
    const data = acknowledgedAt ? { status, acknowledgedAt } : { status };
    // Org-scoped mutation: updateMany so a wrong-org id matches no row. updateMany
    // drops Prisma's P2025 not-found throw and returns { count: 0 }, so guard it
    // explicitly to fail loudly on a missing or cross-tenant target.
    const result = await this.prisma.handoff.updateMany({
      where: { id, organizationId },
      data,
    });
    if (result.count === 0) {
      throw new Error(`Handoff not found or does not belong to organization: ${id}`);
    }
  }

  async listPending(organizationId: string): Promise<Handoff[]> {
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

function toHandoffPackage(row: HandoffRow): Handoff {
  return {
    id: row.id,
    sessionId: row.sessionId,
    organizationId: row.organizationId,
    reason: row.reason as HandoffReason,
    status: row.status as HandoffStatus,
    leadSnapshot: row.leadSnapshot as LeadSnapshot,
    qualificationSnapshot: row.qualificationSnapshot as QualificationSnapshot,
    conversationSummary: row.conversationSummary as HandoffConversationSummary,
    slaDeadlineAt: row.slaDeadlineAt,
    createdAt: row.createdAt,
    acknowledgedAt: row.acknowledgedAt ?? undefined,
  };
}
