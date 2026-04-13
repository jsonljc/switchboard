import type { PrismaDbClient } from "../prisma-db.js";
import type {
  OwnerMemoryAccess,
  DeploymentMemoryEntry,
  DraftFAQ,
  ActivityLogEntry,
  InteractionSummaryEntry,
} from "@switchboard/core";

export class PrismaOwnerMemoryStore implements OwnerMemoryAccess {
  constructor(private prisma: PrismaDbClient) {}

  async listAllMemories(orgId: string, deploymentId: string): Promise<DeploymentMemoryEntry[]> {
    const rows = await this.prisma.deploymentMemory.findMany({
      where: { organizationId: orgId, deploymentId },
      orderBy: { confidence: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      deploymentId: r.deploymentId,
      category: r.category,
      content: r.content,
      confidence: r.confidence,
      sourceCount: r.sourceCount,
    }));
  }

  async correctMemory(id: string, content: string): Promise<void> {
    await this.prisma.deploymentMemory.update({
      where: { id },
      data: { content },
    });
  }

  async deleteMemory(id: string): Promise<void> {
    await this.prisma.deploymentMemory.delete({ where: { id } });
  }

  async listDraftFAQs(orgId: string, deploymentId: string): Promise<DraftFAQ[]> {
    const rows = await this.prisma.knowledgeChunk.findMany({
      where: { organizationId: orgId, deploymentId, draftStatus: "pending" },
      select: {
        id: true,
        content: true,
        sourceType: true,
        draftStatus: true,
        draftExpiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      sourceType: r.sourceType,
      draftStatus: r.draftStatus,
      draftExpiresAt: r.draftExpiresAt,
      createdAt: r.createdAt,
    }));
  }

  async approveDraftFAQ(id: string): Promise<void> {
    await this.prisma.knowledgeChunk.update({
      where: { id },
      data: { draftStatus: "approved" },
    });
  }

  async rejectDraftFAQ(id: string): Promise<void> {
    await this.prisma.knowledgeChunk.delete({ where: { id } });
  }

  async listActivityLog(
    orgId: string,
    deploymentId: string,
    opts: { limit?: number } = {},
  ): Promise<ActivityLogEntry[]> {
    const rows = await this.prisma.activityLog.findMany({
      where: { organizationId: orgId, deploymentId },
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
    });
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      deploymentId: r.deploymentId,
      eventType: r.eventType,
      description: r.description,
      metadata: r.metadata as Record<string, unknown>,
      createdAt: r.createdAt,
    }));
  }

  async listAllSummaries(
    orgId: string,
    deploymentId: string,
    opts: { limit?: number } = {},
  ): Promise<InteractionSummaryEntry[]> {
    const rows = await this.prisma.interactionSummary.findMany({
      where: { organizationId: orgId, deploymentId },
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
    });
    return rows.map((r) => ({
      id: r.id,
      summary: r.summary,
      outcome: r.outcome,
      createdAt: r.createdAt,
    }));
  }
}
