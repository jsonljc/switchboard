import { randomUUID } from "node:crypto";
import type { PrismaDbClient } from "../prisma-db.js";
import type { LifecycleRevenueEvent } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Store Interface (structural match with @switchboard/core)
// ---------------------------------------------------------------------------

interface RecordRevenueInput {
  organizationId: string;
  contactId: string;
  opportunityId: string;
  amount: number;
  currency?: string;
  type: "payment" | "deposit" | "invoice" | "refund";
  status?: "pending" | "confirmed" | "refunded" | "failed";
  recordedBy: "owner" | "staff" | "stripe" | "integration";
  externalReference?: string | null;
  verified?: boolean;
  sourceCampaignId?: string | null;
  sourceAdId?: string | null;
}

interface DateRange {
  from: Date;
  to: Date;
}

interface RevenueSummary {
  totalAmount: number;
  count: number;
}

interface CampaignRevenueSummary {
  sourceCampaignId: string;
  totalAmount: number;
  count: number;
}

interface RevenueStore {
  record(input: RecordRevenueInput): Promise<LifecycleRevenueEvent>;
  findByOpportunity(orgId: string, opportunityId: string): Promise<LifecycleRevenueEvent[]>;
  sumByOrg(orgId: string, dateRange?: DateRange): Promise<RevenueSummary>;
  sumByCampaign(orgId: string, dateRange?: DateRange): Promise<CampaignRevenueSummary[]>;
}

// ---------------------------------------------------------------------------
// Prisma Store Implementation
// ---------------------------------------------------------------------------

export class PrismaRevenueStore implements RevenueStore {
  constructor(private prisma: PrismaDbClient) {}

  async record(input: RecordRevenueInput): Promise<LifecycleRevenueEvent> {
    const id = randomUUID();
    const now = new Date();

    const created = await this.prisma.lifecycleRevenueEvent.create({
      data: {
        id,
        organizationId: input.organizationId,
        contactId: input.contactId,
        opportunityId: input.opportunityId,
        amount: input.amount,
        currency: input.currency ?? "SGD",
        type: input.type,
        status: input.status ?? "confirmed",
        recordedBy: input.recordedBy,
        externalReference: input.externalReference ?? null,
        verified: input.verified ?? false,
        sourceCampaignId: input.sourceCampaignId ?? null,
        sourceAdId: input.sourceAdId ?? null,
        recordedAt: now,
        createdAt: now,
      },
    });

    return mapRowToRevenueEvent(created);
  }

  async findByOpportunity(orgId: string, opportunityId: string): Promise<LifecycleRevenueEvent[]> {
    const rows = await this.prisma.lifecycleRevenueEvent.findMany({
      where: {
        organizationId: orgId,
        opportunityId,
      },
      orderBy: { recordedAt: "desc" },
    });

    return rows.map(mapRowToRevenueEvent);
  }

  async sumByOrg(orgId: string, dateRange?: DateRange): Promise<RevenueSummary> {
    const where: Record<string, unknown> = {
      organizationId: orgId,
      status: "confirmed",
    };

    if (dateRange) {
      where.recordedAt = {
        gte: dateRange.from,
        lte: dateRange.to,
      };
    }

    const result = await this.prisma.lifecycleRevenueEvent.aggregate({
      where,
      _sum: {
        amount: true,
      },
      _count: {
        id: true,
      },
    });

    return {
      totalAmount: result._sum.amount ?? 0,
      count: result._count.id,
    };
  }

  async sumByCampaign(orgId: string, dateRange?: DateRange): Promise<CampaignRevenueSummary[]> {
    const where: Record<string, unknown> = {
      organizationId: orgId,
      status: "confirmed",
      sourceCampaignId: {
        not: null,
      },
    };

    if (dateRange) {
      where.recordedAt = {
        gte: dateRange.from,
        lte: dateRange.to,
      };
    }

    const results = await this.prisma.lifecycleRevenueEvent.groupBy({
      by: ["sourceCampaignId"],
      where,
      _sum: {
        amount: true,
      },
      _count: {
        id: true,
      },
    });

    return results
      .filter((r) => r.sourceCampaignId !== null)
      .map((r) => ({
        sourceCampaignId: r.sourceCampaignId!,
        totalAmount: r._sum.amount ?? 0,
        count: r._count.id,
      }));
  }
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapRowToRevenueEvent(row: {
  id: string;
  organizationId: string;
  contactId: string;
  opportunityId: string;
  amount: number;
  currency: string;
  type: string;
  status: string;
  recordedBy: string;
  externalReference: string | null;
  verified: boolean;
  sourceCampaignId: string | null;
  sourceAdId: string | null;
  recordedAt: Date;
  createdAt: Date;
}): LifecycleRevenueEvent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactId: row.contactId,
    opportunityId: row.opportunityId,
    amount: row.amount,
    currency: row.currency,
    type: row.type as "payment" | "deposit" | "invoice" | "refund",
    status: row.status as "pending" | "confirmed" | "refunded" | "failed",
    recordedBy: row.recordedBy as "owner" | "staff" | "stripe" | "integration",
    externalReference: row.externalReference,
    verified: row.verified,
    sourceCampaignId: row.sourceCampaignId,
    sourceAdId: row.sourceAdId,
    recordedAt: row.recordedAt,
    createdAt: row.createdAt,
  };
}
