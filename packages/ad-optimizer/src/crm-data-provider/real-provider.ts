import type { CrmDataProvider, CrmFunnelData, FunnelBenchmarks } from "@switchboard/schemas";

/**
 * Raw funnel-count row returned by {@link CrmFunnelStore.queryFunnelCounts}.
 *
 * Stage values are `lead | qualified | booked | showed | paid` (matching the
 * ad-optimizer per-source funnel taxonomy). Per-source revenue is optional and
 * only populated when the store has revenue data attributed to a source.
 */
export interface CrmFunnelCountRow {
  sourceType: string;
  sourceCampaignId: string;
  stage: string;
  revenue?: number;
  count: number;
}

/**
 * Store interface that yields raw funnel counts grouped by
 * (sourceType, sourceCampaignId, stage). Implementations live in `@switchboard/db`.
 */
export interface CrmFunnelStore {
  queryFunnelCounts(query: {
    orgId: string;
    campaignIds: string[];
    startDate: string;
    endDate: string;
  }): Promise<CrmFunnelCountRow[]>;

  queryHistoricalMeans(query: { orgId: string }): Promise<{
    leadToQualified: number | null;
    qualifiedToBooked: number | null;
    bookedToPaid: number | null;
  }>;
}

/**
 * Per-source funnel projection.
 *
 * `received` is the count of new leads (i.e. the `lead` stage); the remaining
 * fields mirror the canonical funnel stages.
 */
export interface SourceFunnel {
  received: number;
  qualified: number;
  booked: number;
  /**
   * v1: always 0 — schema does not yet model show events. Consumers should treat
   * a 0 here as "missing data" rather than "zero shows" (e.g., skip computing
   * rates that involve `showed`, like bookedToShowed).
   */
  showed: number;
  paid: number;
  revenue: number;
}

const EMPTY: SourceFunnel = {
  received: 0,
  qualified: 0,
  booked: 0,
  showed: 0,
  paid: 0,
  revenue: 0,
};

/**
 * Funnel data shape produced by {@link RealCrmDataProvider}.
 *
 * Extends the existing {@link CrmFunnelData} contract (so the existing
 * AuditRunner consumes it unchanged) with a `bySource` breakdown for downstream
 * source-comparator consumers (Task 13).
 */
export type CrmFunnelDataWithSources = CrmFunnelData & {
  bySource: Record<string, SourceFunnel>;
};

function safeRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * Real CRM data provider backed by a {@link CrmFunnelStore}.
 *
 * Aggregates raw stage counts into a per-source funnel projection AND the
 * legacy aggregate fields ({@link CrmFunnelData}) so existing consumers keep
 * working without modification. Per-source revenue currently only flows
 * through when the underlying store reports it; otherwise the aggregate
 * `revenue` field is the source of truth.
 */
export class RealCrmDataProvider implements CrmDataProvider {
  constructor(private readonly store: CrmFunnelStore) {}

  async getFunnelData(input: {
    orgId: string;
    accountId: string;
    campaignIds: string[];
    startDate: Date | string;
    endDate: Date | string;
  }): Promise<CrmFunnelDataWithSources> {
    const startDate =
      input.startDate instanceof Date
        ? (input.startDate.toISOString().split("T")[0] ?? "")
        : input.startDate;
    const endDate =
      input.endDate instanceof Date
        ? (input.endDate.toISOString().split("T")[0] ?? "")
        : input.endDate;

    const rows = await this.store.queryFunnelCounts({
      orgId: input.orgId,
      campaignIds: input.campaignIds,
      startDate,
      endDate,
    });

    const bySource: Record<string, SourceFunnel> = {
      ctwa: { ...EMPTY },
      instant_form: { ...EMPTY },
    };

    for (const row of rows) {
      const bucket = bySource[row.sourceType];
      if (!bucket) continue;
      const stageKey = row.stage === "lead" ? "received" : row.stage;
      if (stageKey in bucket) {
        const indexable = bucket as unknown as Record<string, number>;
        const current = indexable[stageKey] ?? 0;
        indexable[stageKey] = current + row.count;
      }
      if (row.revenue) {
        bucket.revenue += row.revenue;
      }
    }

    const leads = bySource.ctwa!.received + bySource.instant_form!.received;
    const qualified = bySource.ctwa!.qualified + bySource.instant_form!.qualified;
    const bookings = bySource.ctwa!.booked + bySource.instant_form!.booked;
    const closed = bySource.ctwa!.paid + bySource.instant_form!.paid;
    const revenue = bySource.ctwa!.revenue + bySource.instant_form!.revenue;

    return {
      campaignIds: input.campaignIds,
      leads,
      qualified,
      // Per-source store does not yet model "opportunities" separately from
      // "qualified"; treat the qualified count as the opportunity floor for
      // backward compatibility.
      opportunities: qualified,
      bookings,
      closed,
      revenue,
      rates: {
        leadToQualified: safeRate(qualified, leads),
        qualifiedToBooking: safeRate(bookings, qualified),
        bookingToClosed: safeRate(closed, bookings),
        leadToClosed: safeRate(closed, leads),
      },
      coverage: {
        // Per-source store reports stage *counts*, not per-contact coverage.
        // Surface the aggregate lead count so the audit runner has a non-zero
        // attributedContacts denominator; finer-grained coverage requires a
        // schema extension and is tracked as a follow-up.
        attributedContacts: leads,
        contactsWithEmailOrPhone: 0,
        contactsWithOpportunity: qualified,
        contactsWithBooking: bookings,
        contactsWithRevenueEvent: closed,
      },
      bySource,
    };
  }

  async getBenchmarks(input: { orgId: string; accountId: string; vertical?: string }): Promise<
    FunnelBenchmarks & {
      leadToQualified: number | null;
      qualifiedToBooked: number | null;
      bookedToPaid: number | null;
    }
  > {
    const means = await this.store.queryHistoricalMeans({ orgId: input.orgId });
    // Composite leadToClosed is only well-defined when every link in the chain
    // has data; if any leg is null the composite is null too.
    const leadToClosed =
      means.leadToQualified !== null &&
      means.qualifiedToBooked !== null &&
      means.bookedToPaid !== null
        ? means.leadToQualified * means.qualifiedToBooked * means.bookedToPaid
        : null;
    return {
      // Spec-flavoured field names (consumed by the per-source comparator).
      leadToQualified: means.leadToQualified,
      qualifiedToBooked: means.qualifiedToBooked,
      bookedToPaid: means.bookedToPaid,
      // CrmDataProvider contract field names (consumed by the existing audit
      // runner). The mapping treats `bookedToPaid` as both the booking→closed
      // and (multiplicatively) the lead→closed terminal rate.
      leadToQualifiedRate: means.leadToQualified,
      qualifiedToBookingRate: means.qualifiedToBooked,
      bookingToClosedRate: means.bookedToPaid,
      leadToClosedRate: leadToClosed,
    };
  }
}
