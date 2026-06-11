import { StaleVersionError } from "@switchboard/core";
import type { PrismaDbClient } from "../prisma-db.js";

interface CreateConnectionInput {
  deploymentId: string;
  type: string;
  slot?: string;
  credentials: string;
  metadata?: Record<string, unknown>;
  tokenHash?: string;
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
        tokenHash: input.tokenHash ?? undefined,
      },
    });
  }

  async listByDeployment(deploymentId: string) {
    return this.prisma.deploymentConnection.findMany({
      where: { deploymentId },
    });
  }

  async findByDeploymentAndType(deploymentId: string, type: string) {
    return this.prisma.deploymentConnection.findFirst({
      where: { deploymentId, type },
    });
  }

  /**
   * Org-scoped variant of findByDeploymentAndType: only returns the connection when the
   * deployment belongs to `organizationId`. Defense-in-depth so a credential read is tenant-safe
   * at the store layer even if a caller forgets the route-level org check, mirroring the
   * organizationId scoping already on updateStatus/updateCredentials/delete.
   */
  async findByDeploymentAndTypeForOrg(organizationId: string, deploymentId: string, type: string) {
    return this.prisma.deploymentConnection.findFirst({
      where: { deploymentId, type, deployment: { organizationId } },
    });
  }

  async updateStatus(organizationId: string, id: string, status: string): Promise<void> {
    const result = await this.prisma.deploymentConnection.updateMany({
      where: { id, deployment: { organizationId } },
      data: { status },
    });
    if (result.count === 0) {
      throw new StaleVersionError(id, -1, -1);
    }
  }

  async updateCredentials(
    organizationId: string,
    id: string,
    credentials: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.prisma.deploymentConnection.updateMany({
      where: { id, deployment: { organizationId } },
      data: {
        credentials,
        ...(metadata ? { metadata: metadata as object } : {}),
      },
    });
    if (result.count === 0) {
      throw new StaleVersionError(id, -1, -1);
    }
  }

  async delete(organizationId: string, id: string): Promise<void> {
    const result = await this.prisma.deploymentConnection.deleteMany({
      where: { id, deployment: { organizationId } },
    });
    if (result.count === 0) {
      throw new StaleVersionError(id, -1, -1);
    }
  }

  async findByTokenHash(tokenHash: string) {
    return this.prisma.deploymentConnection.findUnique({
      where: { tokenHash },
    });
  }
}
