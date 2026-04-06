import type { PrismaDbClient } from "../prisma-db.js";

interface CreateConnectionInput {
  deploymentId: string;
  type: string;
  slot?: string;
  credentials: string;
  metadata?: Record<string, unknown>;
}

export class PrismaDeploymentConnectionStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateConnectionInput) {
    return this.prisma.deploymentConnection.create({
      data: {
        deploymentId: input.deploymentId,
        type: input.type,
        slot: input.slot ?? "default",
        credentials: input.credentials,
        metadata: (input.metadata as object) ?? undefined,
      },
    });
  }

  async listByDeployment(deploymentId: string) {
    return this.prisma.deploymentConnection.findMany({
      where: { deploymentId },
    });
  }

  async updateStatus(id: string, status: string) {
    return this.prisma.deploymentConnection.update({
      where: { id },
      data: { status },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.deploymentConnection.delete({ where: { id } });
  }
}
