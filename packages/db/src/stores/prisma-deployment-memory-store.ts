import type { PrismaDbClient } from "../prisma-db.js";

export interface CreateDeploymentMemoryInput {
  organizationId: string;
  deploymentId: string;
  category: string;
  content: string;
  confidence?: number;
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
        confidence: input.confidence ?? 0.5,
        sourceCount: 1,
        lastSeenAt: now,
      },
    });
  }

  async incrementConfidence(id: string, newConfidence: number) {
    return this.prisma.deploymentMemory.update({
      where: { id },
      data: {
        sourceCount: { increment: 1 },
        confidence: newConfidence,
        lastSeenAt: new Date(),
      },
    });
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

  async findByContent(organizationId: string, deploymentId: string, category: string) {
    return this.prisma.deploymentMemory.findMany({
      where: { organizationId, deploymentId, category },
    });
  }

  async delete(id: string) {
    return this.prisma.deploymentMemory.delete({ where: { id } });
  }

  async countByDeployment(organizationId: string, deploymentId: string): Promise<number> {
    return this.prisma.deploymentMemory.count({
      where: { organizationId, deploymentId },
    });
  }
}
