import { randomUUID } from "node:crypto";
import type { PrismaDbClient } from "../prisma-db.js";
import { isRootPrismaClient } from "../prisma-db.js";
import type {
  Contact,
  ContactStage,
  AttributionChain,
  MessagingOptInSource,
} from "@switchboard/schemas";
import { normalizeToE164 } from "@switchboard/schemas";
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
    const phoneE164 = normalizeToE164(input.phone ?? null);

    const created = await this.prisma.contact.create({
      data: {
        id,
        organizationId: input.organizationId,
        name: input.name ?? null,
        phone: input.phone ?? null,
        phoneE164,
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
    const e164 = normalizeToE164(phone);
    const row = await this.prisma.contact.findFirst({
      where: e164 ? { organizationId: orgId, phoneE164: e164 } : { organizationId: orgId, phone },
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
    const phoneE164 = existing.phoneE164;

    const cascade = async (tx: PrismaDbClient): Promise<void> => {
      // PII-bearing children keyed by a PARENT id (booking/opportunity/revenue), not
      // by contactId. Collect those ids BEFORE the parents are deleted below, so the
      // receipts/proofs (transactional PII: evidence, externalRef, exceptions, amounts)
      // are purged like the sibling revenue tables (conversionRecord/lifecycleRevenueEvent).
      const bookingIds = (
        await tx.booking.findMany({ where: { contactId: id }, select: { id: true } })
      ).map((b) => b.id);
      const opportunityIds = (
        await tx.opportunity.findMany({ where: { contactId: id }, select: { id: true } })
      ).map((o) => o.id);
      const revenueEventIds = (
        await tx.lifecycleRevenueEvent.findMany({ where: { contactId: id }, select: { id: true } })
      ).map((r) => r.id);
      const receiptOr: Array<Record<string, unknown>> = [];
      if (bookingIds.length > 0) receiptOr.push({ bookingId: { in: bookingIds } });
      if (opportunityIds.length > 0) receiptOr.push({ opportunityId: { in: opportunityIds } });
      if (revenueEventIds.length > 0) receiptOr.push({ revenueEventId: { in: revenueEventIds } });
      if (receiptOr.length > 0) {
        await tx.receipt.deleteMany({ where: { organizationId: orgId, OR: receiptOr } });
      }
      if (bookingIds.length > 0) {
        await tx.receiptedBooking.deleteMany({
          where: { bookingId: { in: bookingIds }, organizationId: orgId },
        });
      }

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

      // F5 (PDPA right-to-erasure): WorkTrace is the canonical audit log and
      // carries contactId plus booking details inside parameters/executionOutputs.
      // It is a loose lineage column (not FK-linked to Contact), so it survived
      // the cascade and left the patient in the audit log. Org-scoped so the
      // [organizationId, contactId] composite index is used (and tenant-safe).
      await tx.workTrace.deleteMany({ where: { contactId: id, organizationId: orgId } });

      // PDPA erasure completeness (2026-06-26): contactId-keyed tables the original
      // F5 cascade omitted. None FK-cascade from Contact, so each is deleted here.
      // Org-scoped like workTrace above (every one carries organizationId).
      await tx.conversationLifecycleSnapshot.deleteMany({
        where: { contactId: id, organizationId: orgId },
      });
      await tx.conversationLifecycleTransition.deleteMany({
        where: { contactId: id, organizationId: orgId },
      });
      await tx.scheduledFollowUp.deleteMany({ where: { contactId: id, organizationId: orgId } });
      await tx.scheduledReminder.deleteMany({ where: { contactId: id, organizationId: orgId } });
      await tx.robinRecoverySend.deleteMany({ where: { contactId: id, organizationId: orgId } });

      // phone-keyed children. Identity is canonical on phoneE164, but channel tables
      // store whatever shape the channel delivered: WhatsApp recipient_id/wa_id is
      // digits-only (no +), while principalId/toNumber may carry +E.164. Match every
      // stored shape (exact `in`, org-scoped) so none escape on a shape mismatch.
      const phoneCandidates = buildPhoneMatchCandidates(phone, phoneE164);
      if (phoneCandidates.length > 0) {
        await tx.whatsAppMessageStatus.deleteMany({
          where: { recipientId: { in: phoneCandidates }, organizationId: orgId },
        });
        await tx.conversationState.deleteMany({
          where: { principalId: { in: phoneCandidates }, organizationId: orgId },
        });
        await tx.whatsAppTestSend.deleteMany({
          where: { toNumber: { in: phoneCandidates }, organizationId: orgId },
        });

        // F5 (PDPA right-to-erasure): the dead-letter queue stores the entire
        // inbound webhook in rawPayload (message text + sender phone) keyed only
        // by organizationId — there is no phone/contactId column to filter on, so
        // it was never reached. Load this org's candidates and purge the rows
        // whose payload carries this contact's phone (the WhatsApp sender key,
        // messages[].from / contacts[].wa_id). payloadMentionsPhone digit-normalizes
        // both sides, so any stored shape matches. No take cap: erasure must be
        // complete, and a SQL take-before-JS-filter would silently starve matches.
        // The candidate set stays small in practice (DLQ holds only failed
        // webhooks); its growth is bounded separately by the F6 retention purge.
        const scanPhone = phone ?? phoneE164;
        if (scanPhone) {
          const dlqCandidates = await tx.failedMessage.findMany({
            where: { organizationId: orgId },
            select: { id: true, rawPayload: true },
          });
          const dlqMatchedIds = dlqCandidates
            .filter((row) => payloadMentionsPhone(row.rawPayload, scanPhone))
            .map((row) => row.id);
          if (dlqMatchedIds.length > 0) {
            await tx.failedMessage.deleteMany({
              where: { id: { in: dlqMatchedIds }, organizationId: orgId },
            });
          }
        }
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

  async countConsentCompleteness(input: { orgId: string }): Promise<{
    bookable: number;
    validConsent: number;
  }> {
    const bookableWhere = { organizationId: input.orgId, pdpaJurisdiction: { not: null } };
    const [bookable, validConsent] = await Promise.all([
      this.prisma.contact.count({ where: bookableWhere }),
      this.prisma.contact.count({
        where: { ...bookableWhere, consentGrantedAt: { not: null }, consentRevokedAt: null },
      }),
    ]);
    return { bookable, validConsent };
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
  phoneE164?: string | null;
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
  duplicateContactRisk?: boolean | null;
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
    phoneE164: row.phoneE164 ?? null,
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
    duplicateContactRisk: row.duplicateContactRisk ?? false,
    firstContactAt: row.firstContactAt,
    lastActivityAt: row.lastActivityAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// PDPA erasure helpers (F5)
// ---------------------------------------------------------------------------

/** Minimum digit count for a value to be treated as a matchable phone number.
 *  Guards against matching short numeric fields (ids, counts, timestamps in a
 *  different shape) against a junk or partial phone. Real E.164 numbers are
 *  8–15 digits. */
const MIN_PHONE_DIGITS = 7;

function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

/**
 * The distinct non-empty phone shapes a contact's number may be stored under in
 * channel tables, for an exact-match (`in`) erasure delete. Identity is canonical
 * on phoneE164, but WhatsApp recipient_id/wa_id is digits-only (no +) while other
 * rows carry +E.164, so match raw phone, phoneE164, AND the digits-only form. Digit
 * forms shorter than MIN_PHONE_DIGITS are dropped (junk-collision guard); the raw
 * value is always kept. Exact equality only (never substring) — no over-deletion.
 */
export function buildPhoneMatchCandidates(
  phone: string | null | undefined,
  phoneE164: string | null | undefined,
): string[] {
  const out = new Set<string>();
  for (const value of [phone, phoneE164]) {
    if (value && value.length > 0) {
      out.add(value);
      const digits = digitsOnly(value);
      if (digits.length >= MIN_PHONE_DIGITS) out.add(digits);
    }
  }
  return [...out];
}

/**
 * True when any leaf of `payload` (a parsed-JSON value) is a string or number
 * whose digit-normalization exactly equals `phone`'s digits.
 *
 * The dead-letter queue (`FailedMessage`) stores the raw inbound webhook with no
 * phone column to filter on; the sender phone lives inside it (for WhatsApp, at
 * `messages[].from` / `contacts[].wa_id`, digits-only). This scan is
 * channel-agnostic, so it keeps working if the webhook shape drifts. Matching is
 * EXACT per leaf (never substring): a sender field "6591234567" matches a stored
 * "+6591234567", but a longer numeric id that merely contains those digits does
 * not — so there are no false positives and no cross-patient over-deletion.
 */
export function payloadMentionsPhone(payload: unknown, phone: string): boolean {
  const phoneDigits = digitsOnly(phone);
  if (phoneDigits.length < MIN_PHONE_DIGITS) return false;
  return leafMatchesPhone(payload, phoneDigits);
}

function leafMatchesPhone(value: unknown, phoneDigits: string): boolean {
  if (value == null) return false;
  if (typeof value === "string" || typeof value === "number") {
    return digitsOnly(String(value)) === phoneDigits;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => leafMatchesPhone(entry, phoneDigits));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      leafMatchesPhone(entry, phoneDigits),
    );
  }
  return false;
}
