import type { PrismaDbClient } from "../prisma-db.js";
import type {
  CustomerScopedMemoryAccess,
  CustomerFact,
  KnowledgeChunkEntry,
  InteractionSummaryEntry,
} from "@switchboard/core";

export class PrismaCustomerMemoryStore implements CustomerScopedMemoryAccess {
  constructor(private prisma: PrismaDbClient) {}

  async getBusinessKnowledge(
    orgId: string,
    deploymentId: string,
    _query: string,
  ): Promise<KnowledgeChunkEntry[]> {
    const rows = await this.prisma.knowledgeChunk.findMany({
      where: {
        organizationId: orgId,
        OR: [{ deploymentId }, { deploymentId: null }],
        AND: [{ OR: [{ draftStatus: "approved" }, { draftStatus: null }] }],
      },
      select: { id: true, content: true, sourceType: true, metadata: true },
      take: 10,
    });
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      sourceType: r.sourceType,
      metadata: r.metadata as Record<string, unknown>,
    }));
  }

  async getHighConfidenceFacts(orgId: string, deploymentId: string): Promise<CustomerFact[]> {
    const rows = await this.prisma.deploymentMemory.findMany({
      where: {
        organizationId: orgId,
        deploymentId,
        confidence: { gte: 0.7 },
        sourceCount: { gte: 3 },
      },
      orderBy: { confidence: "desc" },
    });
    // Strip confidence/sourceCount — customer agent sees the fact, not the metadata
    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      content: r.content,
    }));
  }

  async getContactSummaries(
    orgId: string,
    deploymentId: string,
    contactId: string,
  ): Promise<InteractionSummaryEntry[]> {
    const rows = await this.prisma.interactionSummary.findMany({
      where: { organizationId: orgId, deploymentId, contactId },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    return rows.map((r) => ({
      id: r.id,
      summary: r.summary,
      outcome: r.outcome,
      createdAt: r.createdAt,
    }));
  }
}
