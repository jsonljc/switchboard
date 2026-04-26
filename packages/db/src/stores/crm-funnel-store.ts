import type { PrismaDbClient } from "../prisma-db.js";

/**
 * Stages produced by {@link PrismaCrmFunnelStore.queryFunnelCounts}. Stays in
 * sync with the per-source funnel taxonomy consumed by the ad-optimizer
 * `RealCrmDataProvider`.
 */
export type FunnelStage = "lead" | "qualified" | "booked" | "showed" | "paid";

export interface CrmFunnelCountRow {
  sourceType: string;
  sourceCampaignId: string;
  stage: FunnelStage;
  revenue?: number;
  count: number;
}

const QUALIFIED_OR_LATER = ["qualified", "booked", "won", "closed", "completed"];
const SUPPORTED_SOURCE_TYPES = ["ctwa", "instant_form"];
const HISTORICAL_WINDOW_DAYS = 28;

interface ContactSourceKey {
  id: string;
  sourceType: string;
  sourceCampaignId: string;
}

function extractCampaignId(attribution: unknown): string | null {
  if (!attribution || typeof attribution !== "object") return null;
  const value = (attribution as Record<string, unknown>)["sourceCampaignId"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function bumpCount(
  acc: Map<string, CrmFunnelCountRow>,
  key: ContactSourceKey,
  stage: FunnelStage,
  delta: number,
  revenue?: number,
): void {
  if (delta <= 0 && !revenue) return;
  const k = `${key.sourceType}::${key.sourceCampaignId}::${stage}`;
  const existing = acc.get(k);
  if (existing) {
    existing.count += delta;
    if (revenue) existing.revenue = (existing.revenue ?? 0) + revenue;
    return;
  }
  acc.set(k, {
    sourceType: key.sourceType,
    sourceCampaignId: key.sourceCampaignId,
    stage,
    count: delta,
    ...(revenue ? { revenue } : {}),
  });
}

/**
 * Prisma-backed implementation of `CrmFunnelStore` for the ad-optimizer
 * `RealCrmDataProvider`.
 *
 * Strategy:
 *  - Resolve the set of attributed contacts in the date window once
 *    (`Contact` filtered by `organizationId`, `sourceType IN (ctwa, instant_form)`,
 *    `createdAt` in range, and `attribution->>sourceCampaignId IN campaignIds`).
 *  - For each downstream stage, count rows that join back to that contact set.
 *  - The `showed` stage is not currently modelled in the schema; it is omitted
 *    (callers see a zero count and treat it as missing data).
 *
 * Performance: this runs from the weekly audit cron, not per-request. The
 * heaviest step is the contact lookup (indexed on
 * `(organizationId, sourceType, createdAt)`); per-stage queries are scoped to
 * that contact id set.
 *
 * Indexing follow-ups (deferred):
 *  - A composite index on `Booking(organizationId, contactId, startsAt)` would
 *    speed the `booked` aggregation.
 *  - `LifecycleRevenueEvent` already has `(organizationId, recordedAt)` — fine.
 */
export class PrismaCrmFunnelStore {
  constructor(private readonly prisma: PrismaDbClient) {}

  async queryFunnelCounts(query: {
    orgId: string;
    campaignIds: string[];
    startDate: string;
    endDate: string;
  }): Promise<CrmFunnelCountRow[]> {
    if (query.campaignIds.length === 0) return [];
    const startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);

    const contacts = await this.prisma.contact.findMany({
      where: {
        organizationId: query.orgId,
        sourceType: { in: SUPPORTED_SOURCE_TYPES },
        createdAt: { gte: startDate, lte: endDate },
      },
      select: { id: true, sourceType: true, attribution: true },
    });

    const attributed: ContactSourceKey[] = [];
    const contactKey = new Map<string, ContactSourceKey>();
    for (const c of contacts) {
      const campaignId = extractCampaignId(c.attribution);
      if (!campaignId || !query.campaignIds.includes(campaignId)) continue;
      if (!c.sourceType) continue;
      const key: ContactSourceKey = {
        id: c.id,
        sourceType: c.sourceType,
        sourceCampaignId: campaignId,
      };
      attributed.push(key);
      contactKey.set(c.id, key);
    }

    const acc = new Map<string, CrmFunnelCountRow>();
    for (const k of attributed) {
      bumpCount(acc, k, "lead", 1);
    }
    if (attributed.length === 0) return Array.from(acc.values());

    const contactIds = attributed.map((k) => k.id);

    // qualified: any opportunity in a qualified-or-later stage attached to one
    // of the attributed contacts. We count contacts (not opportunities) so the
    // funnel respects the "one qualified per lead" semantic.
    const qualifiedOpps = await this.prisma.opportunity.findMany({
      where: {
        contactId: { in: contactIds },
        stage: { in: QUALIFIED_OR_LATER },
      },
      select: { contactId: true },
    });
    const qualifiedContacts = new Set<string>();
    for (const o of qualifiedOpps) qualifiedContacts.add(o.contactId);
    for (const cid of qualifiedContacts) {
      const k = contactKey.get(cid);
      if (k) bumpCount(acc, k, "qualified", 1);
    }

    // booked: bookings created in the window for an attributed contact.
    const bookings = await this.prisma.booking.findMany({
      where: {
        organizationId: query.orgId,
        contactId: { in: contactIds },
        createdAt: { gte: startDate, lte: endDate },
      },
      select: { contactId: true },
    });
    const bookedContacts = new Set<string>();
    for (const b of bookings) bookedContacts.add(b.contactId);
    for (const cid of bookedContacts) {
      const k = contactKey.get(cid);
      if (k) bumpCount(acc, k, "booked", 1);
    }

    // paid: confirmed revenue events in the window for an attributed contact.
    // Per-event revenue is summed into the source bucket.
    const revenueEvents = await this.prisma.lifecycleRevenueEvent.findMany({
      where: {
        organizationId: query.orgId,
        contactId: { in: contactIds },
        status: "confirmed",
        recordedAt: { gte: startDate, lte: endDate },
      },
      select: { contactId: true, amount: true },
    });
    const paidByContact = new Map<string, number>();
    for (const r of revenueEvents) {
      paidByContact.set(r.contactId, (paidByContact.get(r.contactId) ?? 0) + r.amount);
    }
    for (const [cid, revenue] of paidByContact) {
      const k = contactKey.get(cid);
      if (k) bumpCount(acc, k, "paid", 1, revenue);
    }

    return Array.from(acc.values());
  }

  /**
   * Computes 28-day rolling conversion means across all sources for the org.
   *
   * For v1 we compute simple ratios from cumulative counts in the historical
   * window; if the denominator is zero we return conservative defaults so the
   * audit doesn't divide-by-zero downstream.
   */
  async queryHistoricalMeans(query: { orgId: string }): Promise<{
    leadToQualified: number;
    qualifiedToBooked: number;
    bookedToPaid: number;
  }> {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - HISTORICAL_WINDOW_DAYS);

    const contacts = await this.prisma.contact.findMany({
      where: {
        organizationId: query.orgId,
        sourceType: { in: SUPPORTED_SOURCE_TYPES },
        createdAt: { gte: start, lte: end },
      },
      select: { id: true },
    });
    const leadCount = contacts.length;
    if (leadCount === 0) {
      return { leadToQualified: 0.3, qualifiedToBooked: 0.4, bookedToPaid: 0.5 };
    }

    const contactIds = contacts.map((c) => c.id);

    const qualifiedOppCount = await this.prisma.opportunity.count({
      where: {
        contactId: { in: contactIds },
        stage: { in: QUALIFIED_OR_LATER },
      },
    });

    const bookingCount = await this.prisma.booking.count({
      where: {
        organizationId: query.orgId,
        contactId: { in: contactIds },
        createdAt: { gte: start, lte: end },
      },
    });

    const paidCount = await this.prisma.lifecycleRevenueEvent.count({
      where: {
        organizationId: query.orgId,
        contactId: { in: contactIds },
        status: "confirmed",
        recordedAt: { gte: start, lte: end },
      },
    });

    const leadToQualified = qualifiedOppCount / leadCount;
    const qualifiedToBooked = qualifiedOppCount > 0 ? bookingCount / qualifiedOppCount : 0;
    const bookedToPaid = bookingCount > 0 ? paidCount / bookingCount : 0;

    return { leadToQualified, qualifiedToBooked, bookedToPaid };
  }
}
