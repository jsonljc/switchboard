import { randomUUID } from "node:crypto";
import type { PrismaDbClient } from "../prisma-db.js";
import { isRootPrismaClient } from "../prisma-db.js";
import type { Opportunity, OpportunityStage, ObjectionRecord } from "@switchboard/schemas";
import type {
  OpportunityBoardRow,
  TransitionStageInput,
  TransitionStageResult,
} from "@switchboard/core";
import { OpportunityNotFoundError, StaleVersionError } from "@switchboard/core";

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
  countByStage(orgId: string, stage: string): Promise<number>;
  findOrgBoard(orgId: string): Promise<OpportunityBoardRow[]>;
  transitionStage(input: TransitionStageInput): Promise<TransitionStageResult>;
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
    const result = await this.prisma.opportunity.updateMany({
      where: { id, organizationId: orgId },
      data: {
        stage,
        closedAt: closedAt === undefined ? undefined : closedAt,
        updatedAt: new Date(),
      },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);

    const row = await this.prisma.opportunity.findFirstOrThrow({
      where: { id, organizationId: orgId },
    });
    return mapRowToOpportunity(row);
  }

  async updateRevenueTotal(orgId: string, id: string): Promise<void> {
    // Aggregate SUM(amount) from LifecycleRevenueEvent WHERE opportunityId matches, status = "confirmed"
    const agg = await this.prisma.lifecycleRevenueEvent.aggregate({
      where: {
        opportunityId: id,
        status: "confirmed",
      },
      _sum: {
        amount: true,
      },
    });

    const totalRevenue = agg._sum.amount ?? 0;

    const result = await this.prisma.opportunity.updateMany({
      where: { id, organizationId: orgId },
      data: {
        revenueTotal: totalRevenue,
        updatedAt: new Date(),
      },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
  }

  async countByStage(
    orgId: string,
  ): Promise<Array<{ stage: OpportunityStage; count: number; totalValue: number }>>;
  async countByStage(orgId: string, stage: string): Promise<number>;
  async countByStage(
    orgId: string,
    stage?: string,
  ): Promise<number | Array<{ stage: OpportunityStage; count: number; totalValue: number }>> {
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

  async countClosedWon(input: { orgId: string; from: Date; to: Date }): Promise<number> {
    return this.prisma.opportunity.count({
      where: {
        organizationId: input.orgId,
        closedAt: { not: null, gte: input.from, lt: input.to },
        lostReason: null,
      },
    });
  }

  async countCurrentlyAtStageUpdatedInWindow(input: {
    orgId: string;
    stage: string;
    from: Date;
    to: Date;
  }): Promise<number> {
    return this.prisma.opportunity.count({
      where: {
        organizationId: input.orgId,
        stage: input.stage,
        updatedAt: { gte: input.from, lt: input.to },
      },
    });
  }

  async latestOpportunityStageUpdatedAt(input: {
    orgId: string;
    stage: string;
  }): Promise<Date | null> {
    const row = await this.prisma.opportunity.findFirst({
      where: { organizationId: input.orgId, stage: input.stage },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    return row?.updatedAt ?? null;
  }

  // -------------------------------------------------------------------------
  // Pipeline board methods — production implementation ships in PR-C2 db task.
  // Stubs satisfy the OpportunityStore interface until then.
  // -------------------------------------------------------------------------

  async findOrgBoard(orgId: string): Promise<OpportunityBoardRow[]> {
    const rows = await this.prisma.opportunity.findMany({
      where: { organizationId: orgId },
      include: { contact: { select: { id: true, name: true, primaryChannel: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(mapRowToBoardRow);
  }

  async transitionStage(input: TransitionStageInput): Promise<TransitionStageResult> {
    // WorkTrace persistence is owned by PlatformIngress.persistTrace upstream
    // (Wave 2 Phase 1b.1 cleanup). The store mutates only the opportunity row
    // — one operator stage transition = one WorkTrace (the ingress one).
    const { orgId, id, stage } = input;

    if (!isRootPrismaClient(this.prisma)) {
      throw new Error(
        "PrismaOpportunityStore.transitionStage must be called with a root Prisma client, not a transaction client",
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.opportunity.findFirst({
        where: { id, organizationId: orgId },
        include: { contact: { select: { id: true, name: true, primaryChannel: true } } },
      });
      if (!existing) {
        throw new OpportunityNotFoundError(`Opportunity not found: ${id} (org: ${orgId})`);
      }

      const isTerminal = stage === "won" || stage === "lost";
      const requestedAt = new Date();
      // #643: scope the mutating WHERE by organizationId (the pre-fetch above already validated tenancy; store-layer defense-in-depth).
      const result = await tx.opportunity.updateMany({
        where: { id, organizationId: orgId },
        data: {
          stage,
          closedAt: isTerminal ? (existing.closedAt ?? requestedAt) : null,
          updatedAt: requestedAt,
        },
      });
      if (result.count === 0) {
        throw new OpportunityNotFoundError(`Opportunity not found: ${id} (org: ${orgId})`);
      }

      const updated = {
        ...existing,
        stage,
        closedAt: isTerminal ? (existing.closedAt ?? requestedAt) : null,
        updatedAt: requestedAt,
      };
      return updated;
    });

    return {
      opportunity: mapRowToBoardRow(updated as Parameters<typeof mapRowToBoardRow>[0]),
    };
  }
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapRowToBoardRow(row: {
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
  updatedAt: Date;
  contact: { id: string; name: string | null; primaryChannel: string };
}): OpportunityBoardRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactId: row.contactId,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    stage: row.stage as OpportunityStage,
    timeline: (row.timeline as OpportunityBoardRow["timeline"]) ?? null,
    priceReadiness: (row.priceReadiness as OpportunityBoardRow["priceReadiness"]) ?? null,
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
    updatedAt: row.updatedAt,
    contact: {
      id: row.contact.id,
      name: row.contact.name ?? "",
      primaryChannel: row.contact.primaryChannel as "whatsapp" | "telegram" | "dashboard",
    },
  };
}

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
