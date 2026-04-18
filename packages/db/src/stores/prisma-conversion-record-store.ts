import type { PrismaDbClient } from "../prisma-db.js";

interface DateRange {
  from: Date;
  to: Date;
}

interface FunnelCounts {
  inquiry: number;
  qualified: number;
  booked: number;
  purchased: number;
  completed: number;
  totalRevenue: number;
  period: DateRange;
}

interface CampaignFunnel extends FunnelCounts {
  campaignId: string;
}

interface ChannelFunnel extends FunnelCounts {
  channel: string;
}

interface AgentFunnel extends FunnelCounts {
  deploymentId: string;
  deploymentName: string;
}

interface RecordInput {
  eventId: string;
  type: string;
  contactId: string;
  organizationId: string;
  value: number;
  sourceAdId?: string;
  sourceCampaignId?: string;
  sourceChannel?: string;
  agentDeploymentId?: string;
  occurredAt: Date;
  source: string;
  metadata: Record<string, unknown>;
}

export class PrismaConversionRecordStore {
  constructor(private prisma: PrismaDbClient) {}

  async record(event: RecordInput): Promise<void> {
    await this.prisma.conversionRecord.upsert({
      where: { eventId: event.eventId },
      create: {
        eventId: event.eventId,
        organizationId: event.organizationId,
        contactId: event.contactId,
        type: event.type,
        value: event.value,
        sourceAdId: event.sourceAdId ?? null,
        sourceCampaignId: event.sourceCampaignId ?? null,
        sourceChannel: event.sourceChannel ?? null,
        agentDeploymentId: event.agentDeploymentId ?? null,
        metadata: event.metadata as Record<string, string | number | boolean | null>,
        occurredAt: event.occurredAt,
      },
      update: {},
    });
  }

  async funnelByOrg(orgId: string, dateRange: DateRange): Promise<FunnelCounts> {
    const rows = await this.prisma.conversionRecord.groupBy({
      by: ["type"],
      where: {
        organizationId: orgId,
        occurredAt: { gte: dateRange.from, lte: dateRange.to },
      },
      _count: { _all: true },
      _sum: { value: true },
    });

    return buildFunnelCounts(rows, dateRange);
  }

  async funnelByCampaign(orgId: string, dateRange: DateRange): Promise<CampaignFunnel[]> {
    const rows = await this.prisma.conversionRecord.groupBy({
      by: ["sourceCampaignId", "type"],
      where: {
        organizationId: orgId,
        occurredAt: { gte: dateRange.from, lte: dateRange.to },
        sourceCampaignId: { not: null },
      },
      _count: { _all: true },
      _sum: { value: true },
    });

    return groupByDimension(
      rows,
      "sourceCampaignId",
      "campaignId",
      dateRange,
    ) as unknown as CampaignFunnel[];
  }

  async funnelByChannel(orgId: string, dateRange: DateRange): Promise<ChannelFunnel[]> {
    const rows = await this.prisma.conversionRecord.groupBy({
      by: ["sourceChannel", "type"],
      where: {
        organizationId: orgId,
        occurredAt: { gte: dateRange.from, lte: dateRange.to },
        sourceChannel: { not: null },
      },
      _count: { _all: true },
      _sum: { value: true },
    });

    return groupByDimension(
      rows,
      "sourceChannel",
      "channel",
      dateRange,
    ) as unknown as ChannelFunnel[];
  }

  async funnelByAgent(orgId: string, dateRange: DateRange): Promise<AgentFunnel[]> {
    const rows = await this.prisma.conversionRecord.groupBy({
      by: ["agentDeploymentId", "type"],
      where: {
        organizationId: orgId,
        occurredAt: { gte: dateRange.from, lte: dateRange.to },
        agentDeploymentId: { not: null },
      },
      _count: { _all: true },
      _sum: { value: true },
    });

    return groupByDimension(rows, "agentDeploymentId", "deploymentId", dateRange).map((r) => ({
      ...r,
      deploymentName: r.deploymentId ?? "Unknown",
    })) as AgentFunnel[];
  }

  async countByType(orgId: string, type: string, from: Date, to: Date): Promise<number> {
    return this.prisma.conversionRecord.count({
      where: {
        organizationId: orgId,
        type,
        occurredAt: { gte: from, lte: to },
      },
    });
  }
}

function emptyFunnel(dateRange: DateRange): FunnelCounts {
  return {
    inquiry: 0,
    qualified: 0,
    booked: 0,
    purchased: 0,
    completed: 0,
    totalRevenue: 0,
    period: dateRange,
  };
}

function buildFunnelCounts(
  rows: Array<{ type: string; _count: { _all: number }; _sum: { value: number | null } }>,
  dateRange: DateRange,
): FunnelCounts {
  const funnel = emptyFunnel(dateRange);
  const stageKeys = new Set(["inquiry", "qualified", "booked", "purchased", "completed"]);
  for (const row of rows) {
    if (stageKeys.has(row.type)) {
      (funnel as unknown as Record<string, number>)[row.type] = row._count._all;
    }
    funnel.totalRevenue += row._sum.value ?? 0;
  }
  return funnel;
}

function groupByDimension(
  rows: Array<Record<string, unknown>>,
  sourceField: string,
  targetField: string,
  dateRange: DateRange,
): Array<Record<string, unknown>> {
  const stageKeys = new Set(["inquiry", "qualified", "booked", "purchased", "completed"]);
  const grouped = new Map<string, Record<string, unknown> & FunnelCounts>();

  for (const row of rows) {
    const key = (row[sourceField] as string) ?? "unknown";
    if (!grouped.has(key)) {
      grouped.set(key, { ...emptyFunnel(dateRange), [targetField]: key });
    }
    const funnel = grouped.get(key)!;
    const stage = row.type as string;
    if (stageKeys.has(stage)) {
      const countObj = row._count as { _all: number };
      const sumObj = row._sum as { value: number | null };
      (funnel as unknown as Record<string, number>)[stage] = countObj._all;
      funnel.totalRevenue += sumObj.value ?? 0;
    }
  }

  return [...grouped.values()];
}
