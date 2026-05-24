import type { PrismaDbClient } from "../prisma-db.js";

export class PrismaDeploymentStateStore {
  constructor(private prisma: PrismaDbClient) {}

  async get(deploymentId: string, key: string): Promise<unknown | null> {
    const record = await this.prisma.deploymentState.findUnique({
      where: { deploymentId_key: { deploymentId, key } },
    });
    return record?.value ?? null;
  }

  async set(deploymentId: string, key: string, value: unknown): Promise<void> {
    await this.prisma.deploymentState.upsert({
      where: { deploymentId_key: { deploymentId, key } },
      create: { deploymentId, key, value: value as object },
      update: { value: value as object },
    });
  }

  async list(
    deploymentId: string,
    prefix: string,
  ): Promise<Array<{ key: string; value: unknown }>> {
    const records = await this.prisma.deploymentState.findMany({
      where: { deploymentId, key: { startsWith: prefix } },
    });
    return records.map((r) => ({ key: r.key, value: r.value }));
  }

  async delete(deploymentId: string, key: string): Promise<void> {
    // route-governance: store-mutation-deferred — unscoped Prisma mutation surfaced by AST advisory; outside issue #601 scope, tracked for Round-3 tenant-isolation sweep in #643.
    await this.prisma.deploymentState.delete({
      where: { deploymentId_key: { deploymentId, key } },
    });
  }
}
