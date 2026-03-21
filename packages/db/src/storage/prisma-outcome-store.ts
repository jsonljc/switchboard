// ---------------------------------------------------------------------------
// Prisma Outcome Store — persists outcome events and response variant logs
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";
import type { OutcomeEvent, ResponseVariantLog } from "@switchboard/schemas";
import type { OutcomeStore } from "@switchboard/core";

export class PrismaOutcomeStore implements OutcomeStore {
  constructor(private prisma: PrismaClient) {}

  async saveEvent(event: OutcomeEvent): Promise<void> {
    await this.prisma.outcomeEvent.create({
      data: {
        id: event.id,
        sessionId: event.sessionId,
        organizationId: event.organizationId,
        leadId: event.leadId,
        outcomeType: event.outcomeType,
        metadata: event.metadata ? JSON.parse(JSON.stringify(event.metadata)) : undefined,
        timestamp: event.timestamp,
      },
    });
  }

  async saveVariantLog(log: ResponseVariantLog): Promise<void> {
    await this.prisma.responseVariantLog.create({
      data: {
        id: log.id,
        sessionId: log.sessionId,
        organizationId: log.organizationId,
        primaryMove: log.primaryMove,
        templateId: log.templateId,
        responseText: log.responseText,
        conversationState: log.conversationState,
        timestamp: log.timestamp,
      },
    });
  }

  async listEvents(filters: {
    organizationId: string;
    since?: Date;
    outcomeType?: string;
  }): Promise<OutcomeEvent[]> {
    const where: Record<string, unknown> = {
      organizationId: filters.organizationId,
    };
    if (filters.since) where["timestamp"] = { gte: filters.since };
    if (filters.outcomeType) where["outcomeType"] = filters.outcomeType;

    const records = await this.prisma.outcomeEvent.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: 1000,
    });

    return records.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      organizationId: r.organizationId,
      leadId: r.leadId ?? undefined,
      outcomeType: r.outcomeType as OutcomeEvent["outcomeType"],
      metadata: r.metadata as Record<string, unknown>,
      timestamp: r.timestamp,
    }));
  }

  async listVariantLogs(filters: {
    organizationId: string;
    primaryMove?: string;
    since?: Date;
  }): Promise<ResponseVariantLog[]> {
    const where: Record<string, unknown> = {
      organizationId: filters.organizationId,
    };
    if (filters.primaryMove) where["primaryMove"] = filters.primaryMove;
    if (filters.since) where["timestamp"] = { gte: filters.since };

    const records = await this.prisma.responseVariantLog.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: 1000,
    });

    return records.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      organizationId: r.organizationId,
      primaryMove: r.primaryMove,
      templateId: r.templateId ?? undefined,
      responseText: r.responseText,
      leadReplyReceived: r.leadReplyReceived,
      leadReplyPositive: r.leadReplyPositive,
      conversationState: r.conversationState ?? undefined,
      timestamp: r.timestamp,
    }));
  }

  async updateVariantReply(logId: string, received: boolean, positive: boolean): Promise<void> {
    await this.prisma.responseVariantLog.update({
      where: { id: logId },
      data: { leadReplyReceived: received, leadReplyPositive: positive },
    });
  }
}
