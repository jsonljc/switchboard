import type { PrismaDbClient } from "../prisma-db.js";

export interface WriteActivityLogInput {
  organizationId: string;
  deploymentId: string;
  eventType: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export class PrismaActivityLogStore {
  constructor(private prisma: PrismaDbClient) {}

  async write(input: WriteActivityLogInput): Promise<void> {
    await this.prisma.activityLog.create({
      data: {
        organizationId: input.organizationId,
        deploymentId: input.deploymentId,
        eventType: input.eventType,
        description: input.description,
        metadata: (input.metadata ?? {}) as object,
      },
    });
  }

  async listByDeployment(
    organizationId: string,
    deploymentId: string,
    opts: { limit?: number } = {},
  ) {
    return this.prisma.activityLog.findMany({
      where: { organizationId, deploymentId },
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
    });
  }

  async cleanup(olderThan: Date): Promise<number> {
    const result = await this.prisma.activityLog.deleteMany({
      where: { createdAt: { lt: olderThan } },
    });
    return result.count;
  }
}
