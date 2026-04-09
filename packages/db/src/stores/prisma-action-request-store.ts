import type { PrismaDbClient } from "../prisma-db.js";

interface CreateActionRequestInput {
  deploymentId: string;
  type: string;
  surface: string;
  payload: Record<string, unknown>;
}

export class PrismaActionRequestStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateActionRequestInput) {
    return this.prisma.actionRequest.create({
      data: {
        deploymentId: input.deploymentId,
        type: input.type,
        surface: input.surface,
        payload: input.payload as object,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.actionRequest.findUnique({
      where: { id },
    });
  }

  async listByDeployment(deploymentId: string, status?: string) {
    return this.prisma.actionRequest.findMany({
      where: { deploymentId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "asc" },
    });
  }

  async updateStatus(id: string, status: string, review?: { reviewedBy: string }) {
    return this.prisma.actionRequest.update({
      where: { id },
      data: {
        status,
        ...(review ? { reviewedBy: review.reviewedBy, reviewedAt: new Date() } : {}),
        ...(status === "executed" ? { executedAt: new Date() } : {}),
      },
    });
  }

  async countPending(deploymentId: string): Promise<number> {
    return this.prisma.actionRequest.count({
      where: { deploymentId, status: "pending" },
    });
  }
}
