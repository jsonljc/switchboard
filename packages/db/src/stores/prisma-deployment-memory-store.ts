import { StaleVersionError } from "@switchboard/core";
import type { PrismaDbClient } from "../prisma-db.js";

export interface CreateDeploymentMemoryInput {
  organizationId: string;
  deploymentId: string;
  category: string;
  content: string;
  confidence?: number;
  canonicalKey?: string | null;
}

export class PrismaDeploymentMemoryStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateDeploymentMemoryInput) {
    const now = new Date();
    return this.prisma.deploymentMemory.create({
      data: {
        organizationId: input.organizationId,
        deploymentId: input.deploymentId,
        category: input.category,
        content: input.content,
        canonicalKey: input.canonicalKey ?? null,
        confidence: input.confidence ?? 0.5,
        sourceCount: 1,
        lastSeenAt: now,
      },
    });
  }

  async incrementConfidence(organizationId: string, id: string, newConfidence: number) {
    const result = await this.prisma.deploymentMemory.updateMany({
      where: { id, organizationId },
      data: {
        sourceCount: { increment: 1 },
        confidence: newConfidence,
        lastSeenAt: new Date(),
      },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    return this.prisma.deploymentMemory.findFirst({ where: { id, organizationId } }) as Promise<{
      id: string;
      sourceCount: number;
    }>;
  }

  async listByDeployment(organizationId: string, deploymentId: string) {
    return this.prisma.deploymentMemory.findMany({
      where: { organizationId, deploymentId },
      orderBy: { confidence: "desc" },
    });
  }

  async listHighConfidence(
    organizationId: string,
    deploymentId: string,
    minConfidence: number,
    minSourceCount: number,
  ) {
    return this.prisma.deploymentMemory.findMany({
      where: {
        organizationId,
        deploymentId,
        confidence: { gte: minConfidence },
        sourceCount: { gte: minSourceCount },
      },
      orderBy: { confidence: "desc" },
    });
  }

  async findByCategory(organizationId: string, deploymentId: string, category: string) {
    return this.prisma.deploymentMemory.findMany({
      where: { organizationId, deploymentId, category },
    });
  }

  async findByCategoryAndCanonicalKey(
    organizationId: string,
    deploymentId: string,
    category: string,
    canonicalKey: string,
  ) {
    return this.prisma.deploymentMemory.findMany({
      where: { organizationId, deploymentId, category, canonicalKey },
    });
  }

  async delete(organizationId: string, id: string): Promise<void> {
    const result = await this.prisma.deploymentMemory.deleteMany({
      where: { id, organizationId },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
  }

  async countByDeployment(organizationId: string, deploymentId: string): Promise<number> {
    return this.prisma.deploymentMemory.count({
      where: { organizationId, deploymentId },
    });
  }

  async decayStale(input: {
    cutoffDate: Date;
    decayAmount: number;
    floor: number;
    startOfDay: Date;
  }): Promise<number> {
    const result = await this.prisma.deploymentMemory.updateMany({
      where: {
        lastSeenAt: { lt: input.cutoffDate },
        confidence: { gt: input.floor },
        OR: [{ lastDecayedAt: null }, { lastDecayedAt: { lt: input.startOfDay } }],
      },
      data: {
        confidence: { decrement: input.decayAmount },
        lastDecayedAt: new Date(),
      },
    });
    return result.count;
  }
}
