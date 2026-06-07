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
  value?: number;
  sourceAdId?: string;
  sourceCampaignId?: string;
  sourceChannel?: string;
  agentDeploymentId?: string;
  occurredAt: Date;
  source: string;
  metadata: Record<string, unknown>;
  origin?: "live" | "seed" | "demo";
}

export class PrismaConversionRecordStore {
  constructor(private prisma: PrismaDbClient) {}

  async record(event: RecordInput): Promise<void> {
    const bookingId =
      typeof event.metadata.bookingId === "string" ? event.metadata.bookingId : null;

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
        bookingId,
        metadata: event.metadata as Record<string, string | number | boolean | null>,
        occurredAt: event.occurredAt,
        origin: event.origin ?? "live",
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

  async activePipelineCounts(orgId: string): Promise<{
    inquiry: number;
    qualified: number;
    booked: number;
    purchased: number;
    completed: number;
  }> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const terminalStages = ["completed", "lost"];

    const groups = await this.prisma.conversionRecord.groupBy({
      by: ["type"],
      where: {
        organizationId: orgId,
        OR: [
          { type: { notIn: terminalStages } },
          { type: { in: terminalStages }, occurredAt: { gte: thirtyDaysAgo } },
        ],
      },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    for (const g of groups) {
      counts[g.type] = g._count._all;
    }

    return {
      inquiry: counts["inquiry"] ?? 0,
      qualified: counts["qualified"] ?? 0,
      booked: counts["booked"] ?? 0,
      purchased: counts["purchased"] ?? 0,
      completed: counts["completed"] ?? 0,
    };
  }

  async leadsBySource(input: { orgId: string; from: Date; to: Date }): Promise<
    Array<{
      sourceAdId: string | null;
      sourceCampaignId: string | null;
      sourceChannel: string | null;
    }>
  > {
    return this.prisma.conversionRecord.findMany({
      where: {
        organizationId: input.orgId,
        type: "lead",
        occurredAt: { gte: input.from, lt: input.to },
      },
      select: {
        sourceAdId: true,
        sourceCampaignId: true,
        sourceChannel: true,
      },
    });
  }

  /**
   * Per-campaign sum of booked-conversion value for the window, in MINOR units
   * (cents) — consistent with ConversionEvent.value; the caller normalizes to
   * major units only at the trueROAS boundary, never here.
   *
   * Only valued records count: `type:"booked"` AND `value > 0` AND a present
   * `sourceCampaignId`. A campaign with no valued booked record is ABSENT from
   * the map (the caller reads absence as "no attributed booked value" →
   * trueRoas null), never a fabricated 0.
   */
  async queryBookedValueCentsByCampaign(query: {
    orgId: string;
    from: Date;
    to: Date;
    campaignIds?: string[];
  }): Promise<Map<string, number>> {
    const rows = await this.prisma.conversionRecord.groupBy({
      by: ["sourceCampaignId"],
      where: {
        organizationId: query.orgId,
        type: "booked",
        origin: "live",
        value: { gt: 0 },
        occurredAt: { gte: query.from, lte: query.to },
        sourceCampaignId: query.campaignIds ? { in: query.campaignIds } : { not: null },
      },
      _sum: { value: true },
    });

    const result = new Map<string, number>();
    for (const row of rows as Array<{
      sourceCampaignId: string | null;
      _sum: { value: number | null };
    }>) {
      const sum = row._sum.value ?? 0;
      if (row.sourceCampaignId && sum > 0) result.set(row.sourceCampaignId, sum);
    }
    return result;
  }

  /**
   * Sibling of queryBookedValueCentsByCampaign returning BOTH the cents sum
   * and the record count per campaign, aggregated over the SAME predicate
   * (`type:"booked"` AND `value > 0` AND present `sourceCampaignId`), so the
   * count can never be satisfied by zero-value bookings the sum excludes.
   * Campaigns with no qualifying record are ABSENT from the map (the caller
   * reads absence as "no attributed bookings" → trueRoas null, never 0).
   */
  async queryBookedStatsByCampaign(query: {
    orgId: string;
    from: Date;
    to: Date;
    campaignIds?: string[];
  }): Promise<Map<string, { valueCents: number; count: number }>> {
    const rows = await this.prisma.conversionRecord.groupBy({
      by: ["sourceCampaignId"],
      where: {
        organizationId: query.orgId,
        type: "booked",
        origin: "live",
        value: { gt: 0 },
        occurredAt: { gte: query.from, lte: query.to },
        sourceCampaignId: query.campaignIds ? { in: query.campaignIds } : { not: null },
      },
      _sum: { value: true },
      _count: { _all: true },
    });

    const result = new Map<string, { valueCents: number; count: number }>();
    for (const row of rows as Array<{
      sourceCampaignId: string | null;
      _sum: { value: number | null };
      _count: { _all: number };
    }>) {
      if (!row.sourceCampaignId) continue;
      result.set(row.sourceCampaignId, {
        valueCents: row._sum.value ?? 0,
        count: row._count._all,
      });
    }
    return result;
  }

  /**
   * Org-level windowed booked stats for the outcome ledger's corroboration
   * predicate (Riley v3 slice 4d). Sum and count aggregate over the SAME
   * predicate (`type:"booked"` AND `value > 0`), org-wide: campaign
   * attribution is deliberately NOT required, because the CRM-side second
   * estimate must be independent of Meta attribution and
   * partially-attributed orgs still book real revenue.
   *
   * The window is HALF-OPEN [startInclusive, endExclusive), mirroring the
   * attribution engine's Meta window queries so an instant-of-anchor booking
   * lands in exactly one sub-window (deliberate divergence from
   * queryBookedValueCentsByCampaign's inclusive `lte`).
   *
   * Values stay in CENTS (ConversionRecord.value); zeros are honest absence
   * (they fail the corroboration floors upstream), never an error.
   * Structurally satisfies @switchboard/core's OrgBookedStatsReader.
   */
  async getBookedStatsForOrgWindow(args: {
    organizationId: string;
    startInclusive: Date;
    endExclusive: Date;
  }): Promise<{ bookedValueCents: number; bookedCount: number }> {
    const result = await this.prisma.conversionRecord.aggregate({
      where: {
        organizationId: args.organizationId,
        type: "booked",
        value: { gt: 0 },
        occurredAt: { gte: args.startInclusive, lt: args.endExclusive },
      },
      _sum: { value: true },
      _count: { _all: true },
    });
    return {
      bookedValueCents: result._sum.value ?? 0,
      bookedCount: result._count._all,
    };
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
