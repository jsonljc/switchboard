import { randomUUID } from "node:crypto";
import type { PrismaDbClient } from "../prisma-db.js";
import type { Opportunity, OpportunityStage, ObjectionRecord } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Store Interface (structural match with @switchboard/core)
// ---------------------------------------------------------------------------

interface CreateOpportunityInput {
  organizationId: string;
  contactId: string;
  serviceId: string;
  serviceName: string;
  estimatedValue?: number | null;
  assignedAgent?: string | null;
}

interface OpportunityStore {
  create(input: CreateOpportunityInput): Promise<Opportunity>;
  findById(orgId: string, id: string): Promise<Opportunity | null>;
  findByContact(orgId: string, contactId: string): Promise<Opportunity[]>;
  findActiveByContact(orgId: string, contactId: string): Promise<Opportunity[]>;
  updateStage(
    orgId: string,
    id: string,
    stage: OpportunityStage,
    closedAt?: Date | null,
  ): Promise<Opportunity>;
  updateRevenueTotal(orgId: string, id: string): Promise<void>;
  countByStage(
    orgId: string,
  ): Promise<Array<{ stage: OpportunityStage; count: number; totalValue: number }>>;
}

// ---------------------------------------------------------------------------
// Prisma Store Implementation
// ---------------------------------------------------------------------------

export class PrismaOpportunityStore implements OpportunityStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateOpportunityInput): Promise<Opportunity> {
    const id = randomUUID();
    const now = new Date();

    const created = await this.prisma.opportunity.create({
      data: {
        id,
        organizationId: input.organizationId,
        contactId: input.contactId,
        serviceId: input.serviceId,
        serviceName: input.serviceName,
        stage: "interested",
        estimatedValue: input.estimatedValue ?? null,
        assignedAgent: input.assignedAgent ?? null,
        objections: [],
        qualificationComplete: false,
        revenueTotal: 0,
        openedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });

    return mapRowToOpportunity(created);
  }

  async findById(orgId: string, id: string): Promise<Opportunity | null> {
    const row = await this.prisma.opportunity.findFirst({
      where: {
        id,
        organizationId: orgId,
      },
    });

    if (!row) return null;
    return mapRowToOpportunity(row);
  }

  async findByContact(orgId: string, contactId: string): Promise<Opportunity[]> {
    const rows = await this.prisma.opportunity.findMany({
      where: {
        organizationId: orgId,
        contactId,
      },
      orderBy: { createdAt: "desc" },
    });

    return rows.map(mapRowToOpportunity);
  }

  async findActiveByContact(orgId: string, contactId: string): Promise<Opportunity[]> {
    const rows = await this.prisma.opportunity.findMany({
      where: {
        organizationId: orgId,
        contactId,
        stage: {
          notIn: ["won", "lost"],
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return rows.map(mapRowToOpportunity);
  }

  async updateStage(
    orgId: string,
    id: string,
    stage: OpportunityStage,
    closedAt?: Date | null,
  ): Promise<Opportunity> {
    const existing = await this.prisma.opportunity.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) {
      throw new Error(`Opportunity not found or does not belong to organization: ${id}`);
    }

    const updated = await this.prisma.opportunity.update({
      where: { id },
      data: {
        stage,
        closedAt: closedAt === undefined ? undefined : closedAt,
        updatedAt: new Date(),
      },
    });

    return mapRowToOpportunity(updated);
  }

  async updateRevenueTotal(_orgId: string, id: string): Promise<void> {
    // Aggregate SUM(amount) from LifecycleRevenueEvent WHERE opportunityId matches, status = "confirmed"
    const result = await this.prisma.lifecycleRevenueEvent.aggregate({
      where: {
        opportunityId: id,
        status: "confirmed",
      },
      _sum: {
        amount: true,
      },
    });

    const totalRevenue = result._sum.amount ?? 0;

    await this.prisma.opportunity.update({
      where: { id },
      data: {
        revenueTotal: totalRevenue,
        updatedAt: new Date(),
      },
    });
  }

  async countByStage(
    orgId: string,
    stage?: string,
  ): Promise<number | Array<{ stage: OpportunityStage; count: number; totalValue: number }>> {
    // Single-stage count (for ReconciliationRunner)
    if (stage !== undefined) {
      return this.prisma.opportunity.count({
        where: { organizationId: orgId, stage },
      });
    }

    // All stages with aggregates (legacy API)
    const results = await this.prisma.opportunity.groupBy({
      by: ["stage"],
      where: {
        organizationId: orgId,
      },
      _count: {
        id: true,
      },
      _sum: {
        estimatedValue: true,
      },
    });

    return results.map((r) => ({
      stage: r.stage as OpportunityStage,
      count: r._count.id,
      totalValue: r._sum.estimatedValue ?? 0,
    }));
  }
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapRowToOpportunity(row: {
  id: string;
  organizationId: string;
  contactId: string;
  serviceId: string;
  serviceName: string;
  stage: string;
  timeline: string | null;
  priceReadiness: string | null;
  objections: unknown;
  qualificationComplete: boolean;
  estimatedValue: number | null;
  revenueTotal: number;
  assignedAgent: string | null;
  assignedStaff: string | null;
  lostReason: string | null;
  notes: string | null;
  openedAt: Date;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Opportunity {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactId: row.contactId,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    stage: row.stage as OpportunityStage,
    timeline: row.timeline as "immediate" | "soon" | "exploring" | "unknown" | undefined,
    priceReadiness: row.priceReadiness as
      | "ready"
      | "flexible"
      | "price_sensitive"
      | "unknown"
      | undefined,
    objections: (row.objections as ObjectionRecord[]) ?? [],
    qualificationComplete: row.qualificationComplete,
    estimatedValue: row.estimatedValue,
    revenueTotal: row.revenueTotal,
    assignedAgent: row.assignedAgent,
    assignedStaff: row.assignedStaff,
    lostReason: row.lostReason,
    notes: row.notes,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
