import type { PrismaDbClient } from "../prisma-db.js";

export interface CreateInteractionSummaryInput {
  organizationId: string;
  deploymentId: string;
  channelType: string;
  contactId?: string;
  summary: string;
  outcome: string;
  extractedFacts: unknown[];
  questionsAsked: string[];
  duration: number;
  messageCount: number;
}

export class PrismaInteractionSummaryStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateInteractionSummaryInput) {
    return this.prisma.interactionSummary.create({
      data: {
        organizationId: input.organizationId,
        deploymentId: input.deploymentId,
        channelType: input.channelType,
        contactId: input.contactId ?? null,
        summary: input.summary,
        outcome: input.outcome,
        extractedFacts: input.extractedFacts as object[],
        questionsAsked: input.questionsAsked,
        duration: input.duration,
        messageCount: input.messageCount,
      },
    });
  }

  async listByDeployment(
    organizationId: string,
    deploymentId: string,
    options: { limit?: number; contactId?: string } = {},
  ) {
    return this.prisma.interactionSummary.findMany({
      where: {
        organizationId,
        deploymentId,
        ...(options.contactId ? { contactId: options.contactId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: options.limit ?? 20,
    });
  }

  async countByDeployment(organizationId: string, deploymentId: string): Promise<number> {
    return this.prisma.interactionSummary.count({
      where: { organizationId, deploymentId },
    });
  }
}
