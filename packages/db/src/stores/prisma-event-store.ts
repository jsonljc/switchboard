import type { PrismaDbClient } from "../prisma-db.js";

export interface EmitEventInput {
  organizationId: string;
  deploymentId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export class PrismaEventStore {
  constructor(private prisma: PrismaDbClient) {}

  async emit(input: EmitEventInput): Promise<void> {
    await this.prisma.agentEvent.create({
      data: {
        organizationId: input.organizationId,
        deploymentId: input.deploymentId,
        eventType: input.eventType,
        payload: input.payload as object,
        status: "pending",
        retryCount: 0,
      },
    });
  }

  async pollPending(limit: number) {
    return this.prisma.agentEvent.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }

  async markProcessing(id: string): Promise<void> {
    await this.prisma.agentEvent.update({
      where: { id },
      data: { status: "processing" },
    });
  }

  async markDone(id: string): Promise<void> {
    await this.prisma.agentEvent.update({
      where: { id },
      data: { status: "done", processedAt: new Date() },
    });
  }

  async markFailed(id: string): Promise<void> {
    await this.prisma.agentEvent.update({
      where: { id },
      data: { status: "failed", retryCount: { increment: 1 } },
    });
  }

  async markDeadLetters(maxRetries: number): Promise<number> {
    const result = await this.prisma.agentEvent.updateMany({
      where: { status: "failed", retryCount: { gte: maxRetries } },
      data: { status: "dead_letter" },
    });
    return result.count;
  }

  async cleanupDone(olderThan: Date): Promise<number> {
    const result = await this.prisma.agentEvent.deleteMany({
      where: { status: "done", createdAt: { lt: olderThan } },
    });
    return result.count;
  }

  async resetStaleProcessing(olderThan: Date): Promise<number> {
    const result = await this.prisma.agentEvent.updateMany({
      where: { status: "processing", createdAt: { lt: olderThan } },
      data: { status: "failed", retryCount: { increment: 1 } },
    });
    return result.count;
  }
}
