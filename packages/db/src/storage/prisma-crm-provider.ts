import type { PrismaClient } from "@prisma/client";
import type {
  CrmProvider,
  CrmContact,
  CrmDeal,
  CrmActivity,
  CrmPipelineStage,
  ConnectionHealth,
} from "@switchboard/schemas";

export class PrismaCrmProvider implements CrmProvider {
  constructor(
    private prisma: PrismaClient,
    private organizationId?: string,
  ) {}

  private orgFilter() {
    return this.organizationId ? { organizationId: this.organizationId } : {};
  }

  async searchContacts(query: string, limit = 20): Promise<CrmContact[]> {
    const rows = await this.prisma.crmContact.findMany({
      where: {
        ...this.orgFilter(),
        status: "active",
        OR: [
          { firstName: { contains: query, mode: "insensitive" } },
          { lastName: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
          { company: { contains: query, mode: "insensitive" } },
        ],
      },
      take: limit,
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(toContact);
  }

  async getContact(contactId: string): Promise<CrmContact | null> {
    const row = await this.prisma.crmContact.findUnique({
      where: { id: contactId },
    });
    if (!row) return null;
    return toContact(row);
  }

  async findByExternalId(externalId: string, channel?: string): Promise<CrmContact | null> {
    const where: Record<string, unknown> = { ...this.orgFilter(), externalId };
    if (channel) where["channel"] = channel;
    const row = await this.prisma.crmContact.findFirst({ where });
    return row ? toContact(row) : null;
  }

  async listDeals(filters?: {
    contactId?: string;
    pipeline?: string;
    stage?: string;
  }): Promise<CrmDeal[]> {
    const where: Record<string, unknown> = { ...this.orgFilter() };
    if (filters?.contactId) where["contactId"] = filters.contactId;
    if (filters?.pipeline) where["pipeline"] = filters.pipeline;
    if (filters?.stage) where["stage"] = filters.stage;

    const rows = await this.prisma.crmDeal.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(toDeal);
  }

  async listActivities(filters?: {
    contactId?: string;
    dealId?: string;
    type?: string;
  }): Promise<CrmActivity[]> {
    const where: Record<string, unknown> = { ...this.orgFilter() };
    if (filters?.contactId) where["contactId"] = filters.contactId;
    if (filters?.dealId) where["dealId"] = filters.dealId;
    if (filters?.type) where["type"] = filters.type;

    const rows = await this.prisma.crmActivity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map(toActivity);
  }

  async getPipelineStatus(pipelineId?: string): Promise<CrmPipelineStage[]> {
    const pipeline = pipelineId ?? "default";
    const where: Record<string, unknown> = {
      ...this.orgFilter(),
      pipeline,
    };

    const groups = await this.prisma.crmDeal.groupBy({
      by: ["stage"],
      where,
      _count: { id: true },
      _sum: { amount: true },
    });

    const stageOrder = [
      "lead",
      "qualified",
      "proposal",
      "negotiation",
      "closed_won",
      "closed_lost",
    ];
    return groups
      .map((g: (typeof groups)[number], i: number) => ({
        id: g.stage,
        label: g.stage.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
        displayOrder: stageOrder.indexOf(g.stage) >= 0 ? stageOrder.indexOf(g.stage) : 100 + i,
        dealCount: g._count.id,
        totalValue: g._sum.amount ?? 0,
      }))
      .sort(
        (a: { displayOrder: number }, b: { displayOrder: number }) =>
          a.displayOrder - b.displayOrder,
      );
  }

  async createContact(data: {
    externalId?: string;
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    phone?: string;
    channel?: string;
    assignedStaffId?: string;
    sourceAdId?: string;
    utmSource?: string;
    properties?: Record<string, unknown>;
  }): Promise<CrmContact> {
    const row = await this.prisma.crmContact.create({
      data: {
        externalId: data.externalId ?? null,
        email: data.email,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        company: data.company ?? null,
        phone: data.phone ?? null,
        channel: data.channel ?? null,
        assignedStaffId: data.assignedStaffId ?? null,
        sourceAdId: data.sourceAdId ?? null,
        utmSource: data.utmSource ?? null,
        organizationId: this.organizationId ?? null,
        properties: (data.properties as object) ?? {},
        status: "active",
        tags: [],
      },
    });
    return toContact(row);
  }

  async updateContact(contactId: string, data: Record<string, unknown>): Promise<CrmContact> {
    const updateData: Record<string, unknown> = {};
    if (data["email"] !== undefined) updateData["email"] = data["email"];
    if (data["firstName"] !== undefined) updateData["firstName"] = data["firstName"];
    if (data["lastName"] !== undefined) updateData["lastName"] = data["lastName"];
    if (data["company"] !== undefined) updateData["company"] = data["company"];
    if (data["phone"] !== undefined) updateData["phone"] = data["phone"];
    if (data["tags"] !== undefined) updateData["tags"] = data["tags"];
    if (data["status"] !== undefined) updateData["status"] = data["status"];
    if (data["assignedStaffId"] !== undefined)
      updateData["assignedStaffId"] = data["assignedStaffId"];
    if (data["sourceAdId"] !== undefined) updateData["sourceAdId"] = data["sourceAdId"];
    if (data["utmSource"] !== undefined) updateData["utmSource"] = data["utmSource"];
    if (data["properties"] !== undefined) updateData["properties"] = data["properties"] as object;

    const row = await this.prisma.crmContact.update({
      where: { id: contactId },
      data: updateData,
    });
    return toContact(row);
  }

  async archiveContact(contactId: string): Promise<void> {
    await this.prisma.crmContact.update({
      where: { id: contactId },
      data: { status: "archived" },
    });
  }

  async createDeal(data: {
    name: string;
    pipeline?: string;
    stage?: string;
    amount?: number;
    contactIds?: string[];
    assignedStaffId?: string;
  }): Promise<CrmDeal> {
    const row = await this.prisma.crmDeal.create({
      data: {
        name: data.name,
        pipeline: data.pipeline ?? "default",
        stage: data.stage ?? "lead",
        amount: data.amount ?? null,
        contactId: data.contactIds?.[0] ?? null,
        assignedStaffId: data.assignedStaffId ?? null,
        organizationId: this.organizationId ?? null,
        properties: {},
      },
    });
    return toDeal(row);
  }

  async archiveDeal(dealId: string): Promise<void> {
    await this.prisma.crmDeal.update({
      where: { id: dealId },
      data: { stage: "closed_lost" },
    });
  }

  async logActivity(data: {
    type: CrmActivity["type"];
    subject?: string;
    body?: string;
    contactIds?: string[];
    dealIds?: string[];
  }): Promise<CrmActivity> {
    const row = await this.prisma.crmActivity.create({
      data: {
        type: data.type,
        subject: data.subject ?? null,
        body: data.body ?? null,
        contactId: data.contactIds?.[0] ?? null,
        dealId: data.dealIds?.[0] ?? null,
        organizationId: this.organizationId ?? null,
      },
    });
    return toActivity(row);
  }

  async healthCheck(): Promise<ConnectionHealth> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "connected", latencyMs: 0, error: null, capabilities: [] };
    } catch (err) {
      return {
        status: "disconnected",
        latencyMs: 0,
        error: err instanceof Error ? err.message : "Unknown error",
        capabilities: [],
      };
    }
  }
}

function toContact(row: {
  id: string;
  externalId: string | null;
  channel: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  phone: string | null;
  tags: string[];
  status: string;
  assignedStaffId: string | null;
  sourceAdId: string | null;
  utmSource: string | null;
  properties: unknown;
  createdAt: Date;
  updatedAt: Date;
}): CrmContact {
  return {
    id: row.id,
    externalId: row.externalId,
    channel: row.channel,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    company: row.company,
    phone: row.phone,
    tags: row.tags,
    status: row.status as "active" | "archived",
    assignedStaffId: row.assignedStaffId,
    sourceAdId: row.sourceAdId,
    utmSource: row.utmSource,
    properties: (row.properties as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDeal(row: {
  id: string;
  name: string;
  stage: string;
  pipeline: string;
  amount: number | null;
  closeDate: Date | null;
  contactId: string | null;
  assignedStaffId: string | null;
  properties: unknown;
  createdAt: Date;
  updatedAt: Date;
}): CrmDeal {
  return {
    id: row.id,
    name: row.name,
    stage: row.stage,
    pipeline: row.pipeline,
    amount: row.amount,
    closeDate: row.closeDate?.toISOString() ?? null,
    contactIds: row.contactId ? [row.contactId] : [],
    assignedStaffId: row.assignedStaffId,
    properties: (row.properties as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toActivity(row: {
  id: string;
  type: string;
  subject: string | null;
  body: string | null;
  contactId: string | null;
  dealId: string | null;
  createdAt: Date;
}): CrmActivity {
  return {
    id: row.id,
    type: row.type as CrmActivity["type"],
    subject: row.subject,
    body: row.body,
    contactIds: row.contactId ? [row.contactId] : [],
    dealIds: row.dealId ? [row.dealId] : [],
    createdAt: row.createdAt.toISOString(),
  };
}
