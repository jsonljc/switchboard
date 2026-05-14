import type { PrismaDbClient } from "../prisma-db.js";

export interface RecordEvidenceInput {
  deploymentMemoryId: string;
  organizationId: string;
  bookingId: string | null;
  conversionRecordId: string | null;
  workTraceId: string | null;
  attributionTier: "strong" | "fallback";
}

export class PrismaDeploymentMemoryEvidenceStore {
  constructor(private prisma: PrismaDbClient) {}

  async recordEvidence(input: RecordEvidenceInput): Promise<void> {
    // bookingId is the structural anchor for the @@unique constraint.
    // Without it, every fallback-without-booking write would land as a new
    // row and the multi-booking surfacing rule would double-count.
    if (!input.bookingId) return;

    await this.prisma.deploymentMemoryEvidence.upsert({
      where: {
        deploymentMemoryId_bookingId: {
          deploymentMemoryId: input.deploymentMemoryId,
          bookingId: input.bookingId,
        },
      },
      create: {
        deploymentMemoryId: input.deploymentMemoryId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        conversionRecordId: input.conversionRecordId,
        workTraceId: input.workTraceId,
        attributionTier: input.attributionTier,
      },
      update: {},
    });
  }

  async countDistinctBookingIds(deploymentMemoryId: string): Promise<number> {
    const rows = await this.prisma.deploymentMemoryEvidence.findMany({
      where: { deploymentMemoryId, bookingId: { not: null } },
      select: { bookingId: true },
      distinct: ["bookingId"],
    });
    return rows.length;
  }
}
