import { randomUUID } from "node:crypto";
import type { PrismaDbClient } from "../prisma-db.js";
import { isRootPrismaClient } from "../prisma-db.js";
import type {
  Contact,
  ContactStage,
  AttributionChain,
  MessagingOptInSource,
} from "@switchboard/schemas";
import { StaleVersionError } from "@switchboard/core";

// ---------------------------------------------------------------------------
// Store Interface (structural match with @switchboard/core)
// ---------------------------------------------------------------------------

interface CreateContactInput {
  organizationId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  primaryChannel: "whatsapp" | "telegram" | "dashboard";
  firstTouchChannel?: string | null;
  source?: string | null;
  attribution?: Record<string, unknown> | null;
  roles?: string[];
  messagingOptIn?: boolean;
  messagingOptInSource?: MessagingOptInSource;
}

interface ContactFilters {
  stage?: ContactStage;
  source?: string;
  limit?: number;
  offset?: number;
}

interface ContactBrowseQuery {
  orgId: string;
  stage?: ContactStage;
  search?: string;
  sort: "lastActivityAt" | "firstContactAt";
  direction: "asc" | "desc";
  cursor?: { ts: Date; id: string };
  limit: number;
}

interface ContactBrowseResult {
  rows: Contact[];
  opportunityCounts: Map<string, number>;
  hasMore: boolean;
  nextKeyset: { ts: Date; id: string } | null;
}

interface ContactStore {
  create(input: CreateContactInput): Promise<Contact>;
  findById(orgId: string, id: string): Promise<Contact | null>;
  findByPhone(orgId: string, phone: string): Promise<Contact | null>;
  updateStage(orgId: string, id: string, stage: ContactStage): Promise<Contact>;
  updateLastActivity(orgId: string, id: string): Promise<void>;
  recordMessagingOptOut(orgId: string, id: string): Promise<void>;
  /**
   * Hard-delete a Contact and all PII-bearing child records in a single
   * transaction. Used by the Meta Data Deletion callback to comply with
   * App Review requirements. No FK cascades exist for Contact; every
   * dependent table is deleted manually here.
   */
  delete(orgId: string, id: string): Promise<void>;
  list(orgId: string, filters?: ContactFilters): Promise<Contact[]>;
  listByIds(orgId: string, ids: string[]): Promise<Map<string, Contact>>;
  listForPipeline(args: {
    orgId: string;
    activitySince: Date;
    limit: number;
  }): Promise<{ rows: Contact[]; totalCount: number }>;
  listForBrowse(query: ContactBrowseQuery): Promise<ContactBrowseResult>;
}

// ---------------------------------------------------------------------------
// Prisma Store Implementation
// ---------------------------------------------------------------------------

export class PrismaContactStore implements ContactStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateContactInput): Promise<Contact> {
    const id = randomUUID();
    const now = new Date();
    const messagingOptIn = input.messagingOptIn ?? false;

    const created = await this.prisma.contact.create({
      data: {
        id,
        organizationId: input.organizationId,
        name: input.name ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        primaryChannel: input.primaryChannel,
        firstTouchChannel: input.firstTouchChannel ?? null,
        source: input.source ?? null,
        attribution: input.attribution ? (input.attribution as object) : undefined,
        roles: input.roles ?? ["lead"],
        stage: "new",
        messagingOptIn,
        messagingOptInAt: messagingOptIn ? now : null,
        messagingOptInSource: input.messagingOptInSource ?? null,
        firstContactAt: now,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });

    return mapRowToContact(created);
  }

  async findById(orgId: string, id: string): Promise<Contact | null> {
    const row = await this.prisma.contact.findFirst({
      where: {
        id,
        organizationId: orgId,
      },
    });

    if (!row) return null;
    return mapRowToContact(row);
  }

  async findByPhone(orgId: string, phone: string): Promise<Contact | null> {
    const row = await this.prisma.contact.findFirst({
      where: {
        organizationId: orgId,
        phone,
      },
    });

    if (!row) return null;
    return mapRowToContact(row);
  }

  async updateStage(orgId: string, id: string, stage: ContactStage): Promise<Contact> {
    const result = await this.prisma.contact.updateMany({
      where: { id, organizationId: orgId },
      data: {
        stage,
        updatedAt: new Date(),
      },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);

    const row = await this.prisma.contact.findFirstOrThrow({
      where: { id, organizationId: orgId },
    });
    return mapRowToContact(row);
  }

  async updateLastActivity(orgId: string, id: string): Promise<void> {
    const result = await this.prisma.contact.updateMany({
      where: { id, organizationId: orgId },
      data: {
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
  }

  async delete(orgId: string, id: string): Promise<void> {
    const existing = await this.prisma.contact.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) {
      throw new Error(`Contact not found or does not belong to organization: ${id}`);
    }
    const phone = existing.phone;

    const cascade = async (tx: PrismaDbClient): Promise<void> => {
      // contactId-keyed children. None of these FKs cascade at the DB level,
      // so we delete every dependent row manually. These cascade children FK to
      // the parent contact, which is org-guarded at the top of delete() and by
      // the final org-scoped contact.deleteMany in the same transaction; not
      // independent tenant mutations.
      // route-governance: store-mutation-global
      await tx.conversationThread.deleteMany({ where: { contactId: id } });
      // route-governance: store-mutation-global
      await tx.lifecycleRevenueEvent.deleteMany({ where: { contactId: id } });
      // route-governance: store-mutation-global
      await tx.ownerTask.deleteMany({ where: { contactId: id } });
      // route-governance: store-mutation-global
      await tx.opportunity.deleteMany({ where: { contactId: id } });
      // route-governance: store-mutation-global
      await tx.contactLifecycle.deleteMany({ where: { contactId: id } });
      // route-governance: store-mutation-global
      await tx.conversationMessage.deleteMany({ where: { contactId: id } });
      // route-governance: store-mutation-global
      await tx.escalationRecord.deleteMany({ where: { contactId: id } });
      // route-governance: store-mutation-global
      await tx.handoff.deleteMany({ where: { leadId: id } });
      // route-governance: store-mutation-global
      await tx.interactionSummary.deleteMany({ where: { contactId: id } });
      // route-governance: store-mutation-global
      await tx.booking.deleteMany({ where: { contactId: id } });
      // route-governance: store-mutation-global
      await tx.conversionRecord.deleteMany({ where: { contactId: id } });
      // route-governance: store-mutation-global
      await tx.pendingLeadRetry.deleteMany({ where: { leadId: id } });

      // phone-keyed children — only if we have a phone to match on
      if (phone) {
        await tx.whatsAppMessageStatus.deleteMany({
          where: { recipientId: phone, organizationId: orgId },
        });
        await tx.conversationState.deleteMany({
          where: { principalId: phone, organizationId: orgId },
        });
      }

      const del = await tx.contact.deleteMany({ where: { id, organizationId: orgId } });
      if (del.count === 0) throw new StaleVersionError(id, -1, -1);
    };

    if (isRootPrismaClient(this.prisma)) {
      await this.prisma.$transaction(cascade);
    } else {
      // Already inside an outer transaction — run inline (Prisma forbids nesting).
      await cascade(this.prisma);
    }
  }

  async recordMessagingOptOut(orgId: string, id: string): Promise<void> {
    const now = new Date();
    const result = await this.prisma.contact.updateMany({
      where: { id, organizationId: orgId },
      data: {
        messagingOptIn: false,
        messagingOptOutAt: now,
        updatedAt: now,
      },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
  }

  async listByIds(orgId: string, ids: string[]): Promise<Map<string, Contact>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.contact.findMany({
      where: { organizationId: orgId, id: { in: ids } },
    });
    return new Map(rows.map((r) => [r.id, mapRowToContact(r)]));
  }

  async list(orgId: string, filters?: ContactFilters): Promise<Contact[]> {
    const where: Record<string, unknown> = {
      organizationId: orgId,
    };

    if (filters?.stage) {
      where.stage = filters.stage;
    }
    if (filters?.source) {
      where.source = filters.source;
    }

    const rows = await this.prisma.contact.findMany({
      where,
      take: filters?.limit,
      skip: filters?.offset,
      orderBy: { lastActivityAt: "desc" },
    });

    return rows.map(mapRowToContact);
  }

  async listForPipeline(args: {
    orgId: string;
    activitySince: Date;
    limit: number;
  }): Promise<{ rows: Contact[]; totalCount: number }> {
    const where = {
      organizationId: args.orgId,
      stage: { in: ["active", "new"] },
      lastActivityAt: { gte: args.activitySince },
    };
    const [rows, totalCount] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        orderBy: { lastActivityAt: "desc" },
        take: args.limit,
      }),
      this.prisma.contact.count({ where }),
    ]);
    return { rows: rows.map(mapRowToContact), totalCount };
  }

  async listForBrowse(q: ContactBrowseQuery): Promise<ContactBrowseResult> {
    const { orgId, stage, search, sort, direction, cursor, limit } = q;
    const tsField = sort; // "lastActivityAt" | "firstContactAt" — Prisma column names match.
    const cmp = direction === "desc" ? "lt" : "gt";

    // Search OR-clause (name | phone | email) — kept as a separate condition
    // so combining with the cursor keyset uses AND, not OR-concatenation.
    const searchClause: Record<string, unknown> | undefined = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined;

    // Cursor keyset: (tsField, id) <op> (cursor.ts, cursor.id), expanded as
    //   tsField <op> cursor.ts  OR  (tsField === cursor.ts AND id <op> cursor.id).
    const cursorClause: Record<string, unknown> | undefined = cursor
      ? {
          OR: [
            { [tsField]: { [cmp]: cursor.ts } },
            {
              AND: [{ [tsField]: cursor.ts }, { id: { [cmp]: cursor.id } }],
            },
          ],
        }
      : undefined;

    const where: Record<string, unknown> = { organizationId: orgId };
    if (stage) where.stage = stage;
    const ands: Record<string, unknown>[] = [];
    if (searchClause) ands.push(searchClause);
    if (cursorClause) ands.push(cursorClause);
    if (ands.length > 0) where.AND = ands;

    const orderBy = [{ [tsField]: direction }, { id: direction }];

    // Fetch limit+1 to detect hasMore without a separate COUNT(*) query.
    const rows = await this.prisma.contact.findMany({
      where,
      orderBy,
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;

    const opportunityCounts =
      trimmed.length === 0
        ? new Map<string, number>()
        : await this.fetchOpportunityCounts(trimmed.map((r) => r.id));

    const lastRow = trimmed.at(-1);
    const nextKeyset = hasMore && lastRow ? { ts: lastRow[tsField] as Date, id: lastRow.id } : null;

    return {
      rows: trimmed.map(mapRowToContact),
      opportunityCounts,
      hasMore,
      nextKeyset,
    };
  }

  /**
   * Non-terminal opportunity count per contact, capped at 99. Single
   * groupBy query, indexed on (organizationId, stage) and (contactId).
   */
  private async fetchOpportunityCounts(contactIds: string[]): Promise<Map<string, number>> {
    const grouped = await this.prisma.opportunity.groupBy({
      by: ["contactId"],
      where: { contactId: { in: contactIds }, stage: { notIn: ["won", "lost"] } },
      _count: { _all: true },
    });
    const map = new Map<string, number>();
    for (const g of grouped) {
      map.set(g.contactId, Math.min(g._count._all, 99));
    }
    return map;
  }
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapRowToContact(row: {
  id: string;
  organizationId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  primaryChannel: string;
  firstTouchChannel: string | null;
  stage: string;
  source: string | null;
  attribution: unknown;
  roles: string[];
  messagingOptIn?: boolean;
  messagingOptInAt?: Date | null;
  messagingOptInSource?: string | null;
  messagingOptOutAt?: Date | null;
  firstContactAt: Date;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): Contact {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    primaryChannel: row.primaryChannel as "whatsapp" | "telegram" | "dashboard",
    firstTouchChannel: row.firstTouchChannel,
    stage: row.stage as ContactStage,
    source: row.source,
    attribution: row.attribution as AttributionChain | null | undefined,
    roles: row.roles,
    messagingOptIn: row.messagingOptIn ?? false,
    messagingOptInAt: row.messagingOptInAt ?? null,
    messagingOptInSource: (row.messagingOptInSource ?? null) as MessagingOptInSource | null,
    messagingOptOutAt: row.messagingOptOutAt ?? null,
    firstContactAt: row.firstContactAt,
    lastActivityAt: row.lastActivityAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
