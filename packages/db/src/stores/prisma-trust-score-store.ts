import type { PrismaDbClient } from "../prisma-db.js";
import type { TrustScoreRecord } from "@switchboard/schemas";

export class PrismaTrustScoreStore {
  constructor(private prisma: PrismaDbClient) {}

  async getOrCreate(listingId: string, taskCategory: string): Promise<TrustScoreRecord> {
    const existing = await this.prisma.trustScoreRecord.findUnique({
      where: { listingId_taskCategory: { listingId, taskCategory } },
    });
    if (existing) return existing as unknown as TrustScoreRecord;

    return this.prisma.trustScoreRecord.create({
      data: { listingId, taskCategory, score: 50 },
    }) as unknown as TrustScoreRecord;
  }

  async update(
    id: string,
    data: Partial<
      Pick<
        TrustScoreRecord,
        "score" | "totalApprovals" | "totalRejections" | "consecutiveApprovals" | "lastActivityAt"
      >
    >,
  ): Promise<TrustScoreRecord> {
    return this.prisma.trustScoreRecord.update({
      where: { id },
      data: data as never,
    }) as unknown as TrustScoreRecord;
  }

  async listByListing(listingId: string): Promise<TrustScoreRecord[]> {
    return this.prisma.trustScoreRecord.findMany({
      where: { listingId },
      orderBy: { score: "desc" },
    }) as unknown as TrustScoreRecord[];
  }

  async getAggregateScore(listingId: string): Promise<number> {
    const result = await this.prisma.trustScoreRecord.aggregate({
      where: { listingId },
      _avg: { score: true },
    });
    return result._avg.score ?? 50;
  }
}
