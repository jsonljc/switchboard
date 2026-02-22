import type { PrismaClient } from "@prisma/client";
import type { ApprovalRequest } from "@switchboard/schemas";
import type { ApprovalState, ApprovalStore } from "@switchboard/core";

type ApprovalRecord = {
  request: ApprovalRequest;
  state: ApprovalState;
  envelopeId: string;
};

export class PrismaApprovalStore implements ApprovalStore {
  constructor(private prisma: PrismaClient) {}

  async save(approval: ApprovalRecord): Promise<void> {
    await this.prisma.approvalRecord.create({
      data: {
        id: approval.request.id,
        envelopeId: approval.envelopeId,
        request: approval.request as object,
        status: approval.state.status,
        respondedBy: approval.state.respondedBy,
        respondedAt: approval.state.respondedAt,
        patchValue: approval.state.patchValue as object ?? undefined,
        expiresAt: approval.state.expiresAt,
      },
    });
  }

  async getById(id: string): Promise<ApprovalRecord | null> {
    const row = await this.prisma.approvalRecord.findUnique({ where: { id } });
    if (!row) return null;
    return toApprovalRecord(row);
  }

  async updateState(id: string, state: ApprovalState): Promise<void> {
    await this.prisma.approvalRecord.update({
      where: { id },
      data: {
        status: state.status,
        respondedBy: state.respondedBy,
        respondedAt: state.respondedAt,
        patchValue: state.patchValue as object ?? undefined,
        expiresAt: state.expiresAt,
      },
    });
  }

  async listPending(): Promise<ApprovalRecord[]> {
    const rows = await this.prisma.approvalRecord.findMany({
      where: { status: "pending" },
    });
    return rows.map(toApprovalRecord);
  }
}

function toApprovalRecord(row: {
  id: string;
  envelopeId: string;
  request: unknown;
  status: string;
  respondedBy: string | null;
  respondedAt: Date | null;
  patchValue: unknown;
  expiresAt: Date;
}): ApprovalRecord {
  const request = row.request as ApprovalRequest;
  const state: ApprovalState = {
    status: row.status as ApprovalState["status"],
    respondedBy: row.respondedBy,
    respondedAt: row.respondedAt,
    patchValue: (row.patchValue as Record<string, unknown>) ?? null,
    expiresAt: row.expiresAt,
  };
  return { request, state, envelopeId: row.envelopeId };
}
