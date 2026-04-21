import type { PrismaDbClient } from "../prisma-db.js";

export interface ManagedChannelRow {
  id: string;
  organizationId: string;
  channel: string;
  connectionId: string;
  botUsername: string | null;
  webhookPath: string;
  webhookRegistered: boolean;
  status: string;
  statusDetail: string | null;
  lastHealthCheck: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PrismaManagedChannelStore {
  constructor(private prisma: PrismaDbClient) {}

  async listByOrg(organizationId: string): Promise<ManagedChannelRow[]> {
    return this.prisma.managedChannel.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    }) as unknown as ManagedChannelRow[];
  }

  async create(data: {
    organizationId: string;
    channel: string;
    connectionId: string;
    botUsername?: string;
    webhookPath: string;
  }): Promise<ManagedChannelRow> {
    return this.prisma.managedChannel.create({
      data,
    }) as unknown as ManagedChannelRow;
  }

  async delete(id: string, organizationId: string): Promise<void> {
    const existing = await this.prisma.managedChannel.findUnique({
      where: { id },
    });
    if (!existing || existing.organizationId !== organizationId) {
      throw new Error("Channel not found");
    }
    await this.prisma.managedChannel.delete({ where: { id } });
  }
}
