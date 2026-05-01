import type { OperatorChannelBindingRecord, OperatorChannelBindingStore } from "@switchboard/core";
import type { PrismaDbClient } from "../prisma-db.js";

export class PrismaOperatorChannelBindingStore implements OperatorChannelBindingStore {
  constructor(private prisma: PrismaDbClient) {}

  async findActiveBinding(args: {
    organizationId: string;
    channel: string;
    channelIdentifier: string;
  }): Promise<OperatorChannelBindingRecord | null> {
    const row = await this.prisma.operatorChannelBinding.findUnique({
      where: {
        organizationId_channel_channelIdentifier: {
          organizationId: args.organizationId,
          channel: args.channel,
          channelIdentifier: args.channelIdentifier,
        },
      },
    });
    if (!row || row.status !== "active") return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      channel: row.channel,
      channelIdentifier: row.channelIdentifier,
      principalId: row.principalId,
      status: "active",
      createdBy: row.createdBy,
      revokedBy: row.revokedBy,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
