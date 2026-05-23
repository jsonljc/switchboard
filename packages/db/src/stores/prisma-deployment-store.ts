import { StaleVersionError } from "@switchboard/core";
import type { PrismaDbClient } from "../prisma-db.js";
import type { AgentDeployment, DeploymentStatus } from "@switchboard/schemas";

interface CreateDeploymentInput {
  organizationId: string;
  listingId: string;
  slug?: string;
  inputConfig?: Record<string, unknown>;
  governanceSettings?: Record<string, unknown>;
  outputDestination?: Record<string, unknown> | null;
  connectionIds?: string[];
}

export class PrismaDeploymentStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateDeploymentInput): Promise<AgentDeployment> {
    return this.prisma.agentDeployment.create({
      data: {
        organizationId: input.organizationId,
        listingId: input.listingId,
        slug: input.slug ?? undefined,
        inputConfig: input.inputConfig ? (input.inputConfig as object) : undefined,
        governanceSettings: input.governanceSettings
          ? (input.governanceSettings as object)
          : undefined,
        outputDestination: input.outputDestination
          ? (input.outputDestination as object)
          : undefined,
        connectionIds: input.connectionIds ?? [],
      },
    }) as unknown as AgentDeployment;
  }

  async findById(id: string): Promise<AgentDeployment | null> {
    return this.prisma.agentDeployment.findUnique({
      where: { id },
    }) as unknown as AgentDeployment | null;
  }

  async listByOrg(organizationId: string, status?: DeploymentStatus): Promise<AgentDeployment[]> {
    return this.prisma.agentDeployment.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
    }) as unknown as AgentDeployment[];
  }

  async listByListing(listingId: string, status?: string): Promise<AgentDeployment[]> {
    return this.prisma.agentDeployment.findMany({
      where: {
        listingId,
        ...(status ? { status } : {}),
      },
    }) as unknown as AgentDeployment[];
  }

  async updateStatus(
    organizationId: string,
    id: string,
    status: DeploymentStatus,
  ): Promise<AgentDeployment> {
    const result = await this.prisma.agentDeployment.updateMany({
      where: { id, organizationId },
      data: { status },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    return this.prisma.agentDeployment.findFirstOrThrow({
      where: { id, organizationId },
    }) as unknown as AgentDeployment;
  }

  async update(
    organizationId: string,
    id: string,
    data: { inputConfig?: Record<string, unknown> },
  ): Promise<AgentDeployment | null> {
    const existing = await this.prisma.agentDeployment.findUnique({
      where: { id },
    });
    if (!existing || existing.organizationId !== organizationId) return null;

    const mergedConfig = data.inputConfig
      ? { ...((existing.inputConfig as Record<string, unknown>) ?? {}), ...data.inputConfig }
      : undefined;

    const result = await this.prisma.agentDeployment.updateMany({
      where: { id, organizationId },
      data: {
        ...(mergedConfig !== undefined ? { inputConfig: mergedConfig as object } : {}),
      },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    return this.prisma.agentDeployment.findFirstOrThrow({
      where: { id, organizationId },
    }) as unknown as AgentDeployment;
  }

  async delete(organizationId: string, id: string): Promise<void> {
    const result = await this.prisma.agentDeployment.deleteMany({
      where: { id, organizationId },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
  }
}
