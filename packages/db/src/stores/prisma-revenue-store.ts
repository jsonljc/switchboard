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
  bookingId?: string | null;
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
  record(input: RecordRevenueInput, tx?: PrismaDbClient): Promise<LifecycleRevenueEvent>;
  findByOpportunity(orgId: string, opportunityId: string): Promise<LifecycleRevenueEvent[]>;
  findByContact(orgId: string, contactId: string): Promise<LifecycleRevenueEvent[]>;
  sumByOrg(orgId: string, dateRange?: DateRange): Promise<RevenueSummary>;
  sumByCampaign(orgId: string, dateRange?: DateRange): Promise<CampaignRevenueSummary[]>;
  revenueByCampaign(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<Array<{ sourceCampaignId: string; totalAmount: number }>>;
}

// ---------------------------------------------------------------------------
// Prisma Store Implementation
// ---------------------------------------------------------------------------

export class PrismaRevenueStore implements RevenueStore {
  constructor(private prisma: PrismaDbClient) {}

  async record(input: RecordRevenueInput, tx?: PrismaDbClient): Promise<LifecycleRevenueEvent> {
    const client = tx ?? this.prisma;
    // Idempotency: axis MUST match the DB partial-unique (organizationId, externalReference).
    // externalReference is the globally-unique PSP charge id, so org-scoping is correct and
    // broader than the old opp-scoping — it catches replays even when opportunityId drifts.
    if (input.externalReference) {
      const existing = await client.lifecycleRevenueEvent.findFirst({
        where: {
          organizationId: input.organizationId,
          externalReference: input.externalReference,
        },
      });
      if (existing) return mapRowToRevenueEvent(existing);
    }

    const id = randomUUID();
    const now = new Date();

    const created = await client.lifecycleRevenueEvent.create({
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
        bookingId: input.bookingId ?? null,
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

  async findByContact(orgId: string, contactId: string): Promise<LifecycleRevenueEvent[]> {
    const rows = await this.prisma.lifecycleRevenueEvent.findMany({
      where: { organizationId: orgId, contactId },
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
      origin: "live",
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

  async revenueByCampaign(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<Array<{ sourceCampaignId: string; totalAmount: number }>> {
    const results = await this.sumByCampaign(input.orgId, {
      from: input.from,
      to: input.to,
    });
    return results.map((r) => ({
      sourceCampaignId: r.sourceCampaignId,
      totalAmount: r.totalAmount,
    }));
  }

  /**
   * One row per individually-verified PAID visit, joined to its campaign via
   * bookingId. Returns amount in CENTS (the caller converts to major units
   * exactly once). Per spec R1: in production, only origin="live" rows backed by
   * a non-Noop T1 payment receipt count — a Noop/degraded payment can exercise
   * the write path but must never surface here as a real paid visit.
   */
  async paidVisitsByCampaign(input: {
    orgId: string;
    from: Date;
    to: Date;
    isProduction: boolean;
  }): Promise<
    Array<{
      bookingId: string;
      amountCents: number;
      currency: string;
      sourceCampaignId: string | null;
      attributionBasis: "ctwa_captured" | "campaign_missing";
      paidAt: Date;
    }>
  > {
    const where: Record<string, unknown> = {
      organizationId: input.orgId,
      verified: true,
      bookingId: { not: null },
      recordedAt: { gte: input.from, lt: input.to },
    };
    // Anti-fixture: in production only live-origin revenue is countable.
    if (input.isProduction) where.origin = "live";

    const events = await this.prisma.lifecycleRevenueEvent.findMany({
      where,
      select: { bookingId: true, amount: true, currency: true, recordedAt: true, origin: true },
      orderBy: { recordedAt: "desc" },
    });
    if (events.length === 0) return [];

    const bookingIds = [
      ...new Set(events.map((e) => e.bookingId).filter((b): b is string => b !== null)),
    ];

    // Campaign attribution comes from the booked ConversionRecord (org-scoped). bookingId is NOT
    // unique there, so a booking can carry >1 record with differing sourceCampaignId; the
    // earliest-touch record wins deterministically (see firstTouchCampaignByBooking) — P3-7.
    const conversions = await this.prisma.conversionRecord.findMany({
      where: { organizationId: input.orgId, bookingId: { in: bookingIds } },
      select: { bookingId: true, sourceCampaignId: true, createdAt: true, id: true },
    });
    const campaignByBooking = firstTouchCampaignByBooking(conversions);

    // Payment-receipt provenance (org-scoped) drives the Noop/degraded exclusion: a booking counts
    // iff it has at least one real T1 fetch-back receipt (see countablePaidBookingIds) — P3-7.
    const receipts = await this.prisma.receipt.findMany({
      where: { organizationId: input.orgId, kind: "payment", bookingId: { in: bookingIds } },
      select: { bookingId: true, provider: true, tier: true },
    });
    const countableBookingIds = countablePaidBookingIds(receipts);

    const rows: Array<{
      bookingId: string;
      amountCents: number;
      currency: string;
      sourceCampaignId: string | null;
      attributionBasis: "ctwa_captured" | "campaign_missing";
      paidAt: Date;
    }> = [];
    for (const e of events) {
      const bookingId = e.bookingId;
      if (!bookingId) continue;
      if (input.isProduction) {
        // Defensive post-join guard: origin must be "live" (the WHERE already
        // constrains this in DB; this guard ensures correctness in tests/mocks).
        if (e.origin !== "live") continue;
        // Production-countable paid visit requires a real T1 fetch-back receipt from a non-Noop
        // provider (existential over the booking's receipts; see countableBookingIds above).
        if (!countableBookingIds.has(bookingId)) continue;
      }
      const campaign = campaignByBooking.get(bookingId) ?? null;
      rows.push({
        bookingId,
        amountCents: e.amount,
        currency: e.currency,
        sourceCampaignId: campaign,
        attributionBasis: campaign ? "ctwa_captured" : "campaign_missing",
        paidAt: e.recordedAt,
      });
    }
    return rows;
  }

  async revenueWithFirstTouch(input: { orgId: string; from: Date; to: Date }): Promise<
    Array<{
      amount: number;
      firstTouchSourceAdId: string | null;
      firstTouchSourceCampaignId: string | null;
      firstTouchSourceChannel: string | null;
    }>
  > {
    const events = await this.prisma.lifecycleRevenueEvent.findMany({
      where: {
        organizationId: input.orgId,
        status: "confirmed",
        recordedAt: { gte: input.from, lt: input.to },
      },
      select: {
        amount: true,
        contactId: true,
      },
    });

    if (events.length === 0) return [];

    const contactIds = [...new Set(events.map((e) => e.contactId))];

    const firstTouches = await this.prisma.conversionRecord.findMany({
      where: {
        contactId: { in: contactIds },
        organizationId: input.orgId,
      },
      orderBy: { createdAt: "asc" },
      select: {
        contactId: true,
        sourceAdId: true,
        sourceCampaignId: true,
        sourceChannel: true,
      },
    });

    const firstByContact = new Map<
      string,
      { sourceAdId: string | null; sourceCampaignId: string | null; sourceChannel: string | null }
    >();
    for (const cr of firstTouches) {
      if (!firstByContact.has(cr.contactId)) {
        firstByContact.set(cr.contactId, {
          sourceAdId: cr.sourceAdId,
          sourceCampaignId: cr.sourceCampaignId,
          sourceChannel: cr.sourceChannel,
        });
      }
    }

    return events.map((e) => {
      const ft = firstByContact.get(e.contactId);
      return {
        amount: e.amount,
        firstTouchSourceAdId: ft?.sourceAdId ?? null,
        firstTouchSourceCampaignId: ft?.sourceCampaignId ?? null,
        firstTouchSourceChannel: ft?.sourceChannel ?? null,
      };
    });
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
  bookingId: string | null;
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
    bookingId: row.bookingId,
    verified: row.verified,
    sourceCampaignId: row.sourceCampaignId,
    sourceAdId: row.sourceAdId,
    recordedAt: row.recordedAt,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// paidVisitsByCampaign attribution helpers (deterministic — P3-7)
// ---------------------------------------------------------------------------

/**
 * Deterministic first-touch campaign per booking. ConversionRecord.bookingId is NOT unique, so a
 * booking can carry more than one record with differing sourceCampaignId. Rows are totally ordered
 * by (createdAt asc, then id asc) and the earliest-touch record wins, so the same input always
 * yields the same attribution — the previous "first row of an unordered findMany wins" did not.
 */
function firstTouchCampaignByBooking(
  conversions: Array<{
    bookingId: string | null;
    sourceCampaignId: string | null;
    createdAt: Date;
    id: string;
  }>,
): Map<string, string | null> {
  const ordered = [...conversions].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const byBooking = new Map<string, string | null>();
  for (const c of ordered) {
    if (c.bookingId && !byBooking.has(c.bookingId)) byBooking.set(c.bookingId, c.sourceCampaignId);
  }
  return byBooking;
}

/**
 * Bookings with AT LEAST ONE non-Noop T1 fetch-back payment receipt. This applies THIS read path's
 * existing countable predicate (provider != "noop", tier "T1_FETCH_BACK") EXISTENTIALLY across a
 * booking's receipts, so a co-present degraded/Noop receipt can no longer mask and
 * non-deterministically drop a booking that also has a real T1 receipt — the previous
 * first-receipt-of-an-unordered-findMany pick could. It mirrors the existential SHAPE of the sibling
 * computeBookingPaidValue (any qualifying receipt -> paid), but — like the prior code here, and
 * unchanged by this determinism fix — it does NOT additionally gate on receipt.status the way
 * isPaidVisit does; tightening that would change which visits count as paid and is a separate concern.
 */
function countablePaidBookingIds(
  receipts: Array<{ bookingId: string | null; provider: string | null; tier: string }>,
): Set<string> {
  const ids = new Set<string>();
  for (const r of receipts) {
    if (r.bookingId && r.provider !== "noop" && r.tier === "T1_FETCH_BACK") ids.add(r.bookingId);
  }
  return ids;
}
