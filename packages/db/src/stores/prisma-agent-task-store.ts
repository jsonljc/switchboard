import type { PrismaDbClient } from "../prisma-db.js";
import type { AgentTask, AgentTaskStatus } from "@switchboard/schemas";

interface CreateTaskInput {
  deploymentId: string;
  organizationId: string;
  listingId: string;
  category: string;
  input?: Record<string, unknown>;
  acceptanceCriteria?: string | null;
}

interface TaskFilters {
  status?: AgentTaskStatus;
  category?: string;
  deploymentId?: string;
  listingId?: string;
  limit?: number;
  offset?: number;
}

export class PrismaAgentTaskStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateTaskInput): Promise<AgentTask> {
    return this.prisma.agentTask.create({
      data: {
        deploymentId: input.deploymentId,
        organizationId: input.organizationId,
        listingId: input.listingId,
        category: input.category,
        input: input.input ? (input.input as object) : undefined,
        acceptanceCriteria: input.acceptanceCriteria ?? null,
      },
    }) as unknown as AgentTask;
  }

  async findById(id: string): Promise<AgentTask | null> {
    return this.prisma.agentTask.findUnique({ where: { id } }) as unknown as AgentTask | null;
  }

  async listByDeployment(deploymentId: string, filters?: TaskFilters): Promise<AgentTask[]> {
    return this.prisma.agentTask.findMany({
      where: {
        deploymentId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.category ? { category: filters.category } : {}),
      },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
      orderBy: { createdAt: "desc" },
    }) as unknown as AgentTask[];
  }

  async listByOrg(organizationId: string, filters?: TaskFilters): Promise<AgentTask[]> {
    return this.prisma.agentTask.findMany({
      where: {
        organizationId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.deploymentId ? { deploymentId: filters.deploymentId } : {}),
        ...(filters?.listingId ? { listingId: filters.listingId } : {}),
      },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
      orderBy: { createdAt: "desc" },
    }) as unknown as AgentTask[];
  }

  async updateStatus(id: string, status: AgentTaskStatus): Promise<AgentTask> {
    return this.prisma.agentTask.update({
      where: { id },
      data: { status },
    }) as unknown as AgentTask;
  }

  async submitOutput(id: string, output: Record<string, unknown>): Promise<AgentTask> {
    return this.prisma.agentTask.update({
      where: { id },
      data: { output: output as object, status: "awaiting_review", completedAt: new Date() },
    }) as unknown as AgentTask;
  }

  async review(
    id: string,
    result: "approved" | "rejected",
    reviewedBy: string,
    reviewResult?: string,
  ): Promise<AgentTask> {
    return this.prisma.agentTask.update({
      where: { id },
      data: {
        status: result,
        reviewedBy,
        reviewedAt: new Date(),
        reviewResult: reviewResult ?? null,
      },
    }) as unknown as AgentTask;
  }
}
