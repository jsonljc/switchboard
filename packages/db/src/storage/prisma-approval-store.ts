import type { PrismaClient } from "@prisma/client";
import type { ApprovalRequest } from "@switchboard/schemas";
import type { ApprovalState, ApprovalStore } from "@switchboard/core";
import { StaleVersionError } from "@switchboard/core";

type ApprovalRecord = {
  request: ApprovalRequest;
  state: ApprovalState;
  envelopeId: string;
  organizationId?: string | null;
};

export class PrismaApprovalStore implements ApprovalStore {
  constructor(private prisma: PrismaClient) {}

  async save(approval: ApprovalRecord): Promise<void> {
    await this.prisma.approvalRecord.create({
      data: {
        id: approval.request.id,
        envelopeId: approval.envelopeId,
        organizationId: approval.organizationId ?? null,
        request: approval.request as object,
        status: approval.state.status,
        respondedBy: approval.state.respondedBy,
        respondedAt: approval.state.respondedAt,
        patchValue: approval.state.patchValue as object ?? undefined,
        expiresAt: approval.state.expiresAt,
        version: approval.state.version ?? 1,
      },
    });
  }

  async getById(id: string): Promise<ApprovalRecord | null> {
    const row = await this.prisma.approvalRecord.findUnique({ where: { id } });
    if (!row) return null;
    return toApprovalRecord(row);
  }

  async updateState(id: string, state: ApprovalState, expectedVersion?: number): Promise<void> {
    if (expectedVersion !== undefined) {
      // Optimistic concurrency: only update if version matches
      const result = await this.prisma.approvalRecord.updateMany({
        where: { id, version: expectedVersion },
        data: {
          status: state.status,
          respondedBy: state.respondedBy,
          respondedAt: state.respondedAt,
          patchValue: state.patchValue as object ?? undefined,
          expiresAt: state.expiresAt,
          version: state.version,
        },
      });
      if (result.count === 0) {
        throw new StaleVersionError(id, expectedVersion, -1);
      }
    } else {
      await this.prisma.approvalRecord.update({
        where: { id },
        data: {
          status: state.status,
          respondedBy: state.respondedBy,
          respondedAt: state.respondedAt,
          patchValue: state.patchValue as object ?? undefined,
          expiresAt: state.expiresAt,
          version: state.version,
        },
      });
    }
  }

  async listPending(organizationId?: string): Promise<ApprovalRecord[]> {
    const rows = await this.prisma.approvalRecord.findMany({
      where: {
        status: "pending",
        ...(organizationId ? { organizationId } : {}),
      },
    });
    return rows.map(toApprovalRecord);
  }
}

function toApprovalRecord(row: {
  id: string;
  envelopeId: string;
  organizationId: string | null;
  request: unknown;
  status: string;
  respondedBy: string | null;
  respondedAt: Date | null;
  patchValue: unknown;
  expiresAt: Date;
  version: number;
}): ApprovalRecord {
  const request = row.request as ApprovalRequest;
  const state: ApprovalState = {
    status: row.status as ApprovalState["status"],
    respondedBy: row.respondedBy,
    respondedAt: row.respondedAt,
    patchValue: (row.patchValue as Record<string, unknown>) ?? null,
    expiresAt: row.expiresAt,
    quorum: (request.quorum as ApprovalState["quorum"]) ?? null,
    version: row.version ?? 1,
  };
  return { request, state, envelopeId: row.envelopeId, organizationId: row.organizationId };
}
