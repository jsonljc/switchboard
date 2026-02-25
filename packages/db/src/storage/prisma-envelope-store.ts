import type { PrismaClient } from "@prisma/client";
import type { ActionEnvelope } from "@switchboard/schemas";
import type { EnvelopeStore } from "@switchboard/core";

export class PrismaEnvelopeStore implements EnvelopeStore {
  constructor(private prisma: PrismaClient) {}

  private extractOrganizationId(envelope: ActionEnvelope): string | null {
    for (const proposal of envelope.proposals) {
      const orgId = proposal.parameters["_organizationId"];
      if (typeof orgId === "string") return orgId;
    }
    return null;
  }

  async save(envelope: ActionEnvelope): Promise<void> {
    const organizationId = this.extractOrganizationId(envelope);
    await this.prisma.actionEnvelope.upsert({
      where: { id: envelope.id },
      create: {
        id: envelope.id,
        version: envelope.version,
        incomingMessage: envelope.incomingMessage as object ?? undefined,
        conversationId: envelope.conversationId,
        organizationId,
        proposals: envelope.proposals as object[],
        resolvedEntities: envelope.resolvedEntities as object[],
        plan: envelope.plan as object ?? undefined,
        decisions: envelope.decisions as object[],
        approvalRequests: envelope.approvalRequests as object[],
        executionResults: envelope.executionResults as object[],
        auditEntryIds: envelope.auditEntryIds,
        status: envelope.status,
        parentEnvelopeId: envelope.parentEnvelopeId,
        traceId: envelope.traceId,
        createdAt: envelope.createdAt,
        updatedAt: envelope.updatedAt,
      },
      update: {
        version: envelope.version,
        incomingMessage: envelope.incomingMessage as object ?? undefined,
        conversationId: envelope.conversationId,
        organizationId,
        proposals: envelope.proposals as object[],
        resolvedEntities: envelope.resolvedEntities as object[],
        plan: envelope.plan as object ?? undefined,
        decisions: envelope.decisions as object[],
        approvalRequests: envelope.approvalRequests as object[],
        executionResults: envelope.executionResults as object[],
        auditEntryIds: envelope.auditEntryIds,
        status: envelope.status,
        parentEnvelopeId: envelope.parentEnvelopeId,
        traceId: envelope.traceId,
        updatedAt: envelope.updatedAt,
      },
    });
  }

  async getById(id: string): Promise<ActionEnvelope | null> {
    const row = await this.prisma.actionEnvelope.findUnique({ where: { id } });
    if (!row) return null;
    return toEnvelope(row);
  }

  async update(id: string, updates: Partial<ActionEnvelope>): Promise<void> {
    const data: Record<string, unknown> = { updatedAt: new Date() };

    if (updates.version !== undefined) data["version"] = updates.version;
    if (updates.incomingMessage !== undefined) data["incomingMessage"] = updates.incomingMessage as object;
    if (updates.conversationId !== undefined) data["conversationId"] = updates.conversationId;
    if (updates.proposals !== undefined) data["proposals"] = updates.proposals as object[];
    if (updates.resolvedEntities !== undefined) data["resolvedEntities"] = updates.resolvedEntities as object[];
    if (updates.plan !== undefined) data["plan"] = updates.plan as object;
    if (updates.decisions !== undefined) data["decisions"] = updates.decisions as object[];
    if (updates.approvalRequests !== undefined) data["approvalRequests"] = updates.approvalRequests as object[];
    if (updates.executionResults !== undefined) data["executionResults"] = updates.executionResults as object[];
    if (updates.auditEntryIds !== undefined) data["auditEntryIds"] = updates.auditEntryIds;
    if (updates.status !== undefined) data["status"] = updates.status;
    if (updates.parentEnvelopeId !== undefined) data["parentEnvelopeId"] = updates.parentEnvelopeId;

    await this.prisma.actionEnvelope.update({ where: { id }, data });
  }

  async list(filter?: {
    principalId?: string;
    organizationId?: string;
    status?: string;
    limit?: number;
  }): Promise<ActionEnvelope[]> {
    const where: Record<string, unknown> = {};
    if (filter?.status) where["status"] = filter.status;
    if (filter?.organizationId) where["organizationId"] = filter.organizationId;

    const rows = await this.prisma.actionEnvelope.findMany({
      where,
      take: filter?.limit,
      orderBy: { createdAt: "desc" },
    });

    let results = rows.map(toEnvelope);

    // principalId still requires post-query filtering (embedded in JSON proposals)
    if (filter?.principalId) {
      const pid = filter.principalId;
      results = results.filter((e: ActionEnvelope) =>
        e.proposals.some((p: ActionEnvelope["proposals"][number]) => p.parameters["_principalId"] === pid),
      );
    }

    return results;
  }
}

function toEnvelope(row: {
  id: string;
  version: number;
  incomingMessage: unknown;
  conversationId: string | null;
  proposals: unknown;
  resolvedEntities: unknown;
  plan: unknown;
  decisions: unknown;
  approvalRequests: unknown;
  executionResults: unknown;
  auditEntryIds: string[];
  status: string;
  parentEnvelopeId: string | null;
  traceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ActionEnvelope {
  return {
    id: row.id,
    version: row.version,
    incomingMessage: row.incomingMessage ?? null,
    conversationId: row.conversationId,
    proposals: row.proposals as ActionEnvelope["proposals"],
    resolvedEntities: row.resolvedEntities as ActionEnvelope["resolvedEntities"],
    plan: (row.plan as ActionEnvelope["plan"]) ?? null,
    decisions: row.decisions as ActionEnvelope["decisions"],
    approvalRequests: row.approvalRequests as ActionEnvelope["approvalRequests"],
    executionResults: row.executionResults as ActionEnvelope["executionResults"],
    auditEntryIds: row.auditEntryIds,
    status: row.status as ActionEnvelope["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    parentEnvelopeId: row.parentEnvelopeId,
    traceId: row.traceId,
  };
}
