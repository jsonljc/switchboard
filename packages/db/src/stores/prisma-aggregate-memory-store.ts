import type { PrismaDbClient } from "../prisma-db.js";
import type {
  AggregateScopedMemoryAccess,
  DeploymentMemoryEntry,
  InteractionSummaryEntry,
  ActivityLogEntry,
} from "@switchboard/core";

export class PrismaAggregateMemoryStore implements AggregateScopedMemoryAccess {
  constructor(private prisma: PrismaDbClient) {}

  async upsertFact(entry: Omit<DeploymentMemoryEntry, "id">): Promise<DeploymentMemoryEntry> {
    const now = new Date();
    const result = await this.prisma.deploymentMemory.upsert({
      where: {
        organizationId_deploymentId_category_content: {
          organizationId: entry.organizationId,
          deploymentId: entry.deploymentId,
          category: entry.category,
          content: entry.content,
        },
      },
      update: {
        sourceCount: { increment: 1 },
        confidence: entry.confidence,
        lastSeenAt: now,
      },
      create: {
        organizationId: entry.organizationId,
        deploymentId: entry.deploymentId,
        category: entry.category,
        content: entry.content,
        confidence: entry.confidence,
        sourceCount: entry.sourceCount,
        lastSeenAt: now,
      },
    });
    return {
      id: result.id,
      organizationId: result.organizationId,
      deploymentId: result.deploymentId,
      category: result.category,
      content: result.content,
      confidence: result.confidence,
      sourceCount: result.sourceCount,
    };
  }

  async writeSummary(
    entry: Omit<InteractionSummaryEntry, "id"> & {
      organizationId: string;
      deploymentId: string;
      channelType: string;
      contactId?: string;
      extractedFacts: unknown[];
      questionsAsked: string[];
      duration: number;
      messageCount: number;
    },
  ): Promise<void> {
    await this.prisma.interactionSummary.create({
      data: {
        organizationId: entry.organizationId,
        deploymentId: entry.deploymentId,
        channelType: entry.channelType,
        contactId: entry.contactId ?? null,
        summary: entry.summary,
        outcome: entry.outcome,
        extractedFacts: entry.extractedFacts as object[],
        questionsAsked: entry.questionsAsked,
        duration: entry.duration,
        messageCount: entry.messageCount,
      },
    });
  }

  async writeActivityLog(entry: Omit<ActivityLogEntry, "id" | "createdAt">): Promise<void> {
    await this.prisma.activityLog.create({
      data: {
        organizationId: entry.organizationId,
        deploymentId: entry.deploymentId,
        eventType: entry.eventType,
        description: entry.description,
        metadata: entry.metadata,
      },
    });
  }

  async findFactsByCategory(
    orgId: string,
    deploymentId: string,
    category: string,
  ): Promise<DeploymentMemoryEntry[]> {
    const rows = await this.prisma.deploymentMemory.findMany({
      where: { organizationId: orgId, deploymentId, category },
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

  async promoteDraftFAQs(olderThan: Date): Promise<number> {
    const result = await this.prisma.knowledgeChunk.updateMany({
      where: {
        draftStatus: "pending",
        draftExpiresAt: { lt: olderThan },
      },
      data: { draftStatus: "approved" },
    });
    return result.count;
  }

  async decayStale(cutoffDate: Date, decayAmount: number): Promise<number> {
    const result = await this.prisma.deploymentMemory.updateMany({
      where: {
        lastSeenAt: { lt: cutoffDate },
        confidence: { gt: 0 },
      },
      data: { confidence: { decrement: decayAmount } },
    });
    return result.count;
  }
}
