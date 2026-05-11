import type { PrismaClient } from "@prisma/client";
import type {
  ApprovedComplianceClaimQuery,
  ApprovedComplianceClaimRecord,
  ApprovedComplianceClaimStore,
} from "@switchboard/core";
import type { ClaimType } from "@switchboard/schemas";

interface PrismaApprovedComplianceClaimRow {
  id: string;
  deploymentId: string;
  jurisdiction: string;
  claimType: string;
  claimText: string;
  reviewedBy: string;
  reviewedAt: Date;
  validUntil: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: PrismaApprovedComplianceClaimRow): ApprovedComplianceClaimRecord {
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    jurisdiction: row.jurisdiction as "SG" | "MY",
    claimType: row.claimType as ClaimType,
    claimText: row.claimText,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt.toISOString(),
    validUntil: row.validUntil?.toISOString() ?? null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPrismaApprovedComplianceClaimStore(
  prisma: PrismaClient,
): ApprovedComplianceClaimStore {
  return {
    async list(query: ApprovedComplianceClaimQuery): Promise<ApprovedComplianceClaimRecord[]> {
      const rows = await prisma.approvedComplianceClaim.findMany({
        where: {
          deploymentId: query.deploymentId,
          jurisdiction: query.jurisdiction,
          claimType: query.claimType,
        },
        orderBy: [{ reviewedAt: "desc" }],
      });

      return rows.map((row) => toRecord(row as PrismaApprovedComplianceClaimRow));
    },
  };
}
