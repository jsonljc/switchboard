// ---------------------------------------------------------------------------
// Outcome Tracker — Stores conversion data and computes outcome-based metrics
// ---------------------------------------------------------------------------

import type { ConversionBus, ConversionEvent, ConversionEventType } from "@switchboard/core";

/**
 * Outcome-based advertising metrics.
 * These bridge the gap between ad spend metrics (CPM, CPC) and
 * real business outcomes (cost per booking, revenue per ad dollar).
 */
export interface OutcomeMetrics {
  /** Total ad spend in the period */
  totalSpend: number;
  /** Number of inquiries from ads */
  inquiries: number;
  /** Number of qualified leads from ads */
  qualifiedLeads: number;
  /** Number of bookings from ads */
  bookings: number;
  /** Number of purchases from ads */
  purchases: number;
  /** Total conversion value (revenue) from ads */
  totalRevenue: number;
  /** Cost per inquiry (spend / inquiries) */
  costPerInquiry: number | null;
  /** Cost per qualified lead */
  costPerQualifiedLead: number | null;
  /** Cost per booking */
  costPerBooking: number | null;
  /** Cost per purchase */
  costPerPurchase: number | null;
  /** Revenue per ad dollar (return on ad spend) */
  roas: number | null;
  /** Breakdown by source campaign */
  byCampaign: CampaignOutcome[];
}

/**
 * Per-campaign outcome breakdown.
 */
export interface CampaignOutcome {
  campaignId: string;
  inquiries: number;
  qualifiedLeads: number;
  bookings: number;
  purchases: number;
  revenue: number;
}

/**
 * Stored conversion record for time-range queries.
 */
interface StoredConversion {
  type: ConversionEventType;
  contactId: string;
  organizationId: string;
  value: number;
  sourceAdId?: string;
  sourceCampaignId?: string;
  timestamp: Date;
}

/**
 * Tracks conversion events and computes outcome-based metrics.
 *
 * Subscribes to the ConversionBus and stores conversion records in memory.
 * For production, this would be backed by a database, but the interface
 * remains the same.
 */
export class OutcomeTracker {
  private conversions: StoredConversion[] = [];

  /**
   * Register this tracker as a subscriber on the conversion bus.
   */
  register(bus: ConversionBus): void {
    bus.subscribe("*", (event) => {
      this.record(event);
    });
  }

  /**
   * Record a conversion event.
   */
  record(event: ConversionEvent): void {
    this.conversions.push({
      type: event.type,
      contactId: event.contactId,
      organizationId: event.organizationId,
      value: event.value,
      sourceAdId: event.sourceAdId,
      sourceCampaignId: event.sourceCampaignId,
      timestamp: event.timestamp,
    });
  }

  /**
   * Compute outcome metrics for an organization within a date range.
   *
   * @param organizationId - Filter by organization
   * @param totalSpend - Total ad spend for the period (from ad platform insights)
   * @param since - Start of period (inclusive)
   * @param until - End of period (inclusive)
   */
  computeMetrics(
    organizationId: string,
    totalSpend: number,
    since: Date,
    until: Date,
  ): OutcomeMetrics {
    // Filter conversions for this org and time range, only from ads
    const relevant = this.conversions.filter(
      (c) =>
        c.organizationId === organizationId &&
        c.sourceAdId != null &&
        c.timestamp >= since &&
        c.timestamp <= until,
    );

    // Count by type
    const inquiries = relevant.filter((c) => c.type === "inquiry").length;
    const qualifiedLeads = relevant.filter((c) => c.type === "qualified").length;
    const bookings = relevant.filter((c) => c.type === "booked").length;
    const purchases = relevant.filter(
      (c) => c.type === "purchased" || c.type === "completed",
    ).length;
    const totalRevenue = relevant.reduce((sum, c) => sum + c.value, 0);

    // Per-campaign breakdown
    const campaignMap = new Map<string, CampaignOutcome>();
    for (const c of relevant) {
      const key = c.sourceCampaignId ?? "unknown";
      let entry = campaignMap.get(key);
      if (!entry) {
        entry = {
          campaignId: key,
          inquiries: 0,
          qualifiedLeads: 0,
          bookings: 0,
          purchases: 0,
          revenue: 0,
        };
        campaignMap.set(key, entry);
      }
      entry.revenue += c.value;
      switch (c.type) {
        case "inquiry":
          entry.inquiries++;
          break;
        case "qualified":
          entry.qualifiedLeads++;
          break;
        case "booked":
          entry.bookings++;
          break;
        case "purchased":
        case "completed":
          entry.purchases++;
          break;
      }
    }

    return {
      totalSpend,
      inquiries,
      qualifiedLeads,
      bookings,
      purchases,
      totalRevenue,
      costPerInquiry: inquiries > 0 ? totalSpend / inquiries : null,
      costPerQualifiedLead: qualifiedLeads > 0 ? totalSpend / qualifiedLeads : null,
      costPerBooking: bookings > 0 ? totalSpend / bookings : null,
      costPerPurchase: purchases > 0 ? totalSpend / purchases : null,
      roas: totalSpend > 0 ? totalRevenue / totalSpend : null,
      byCampaign: Array.from(campaignMap.values()),
    };
  }

  /**
   * Get the total number of tracked conversions (for diagnostics).
   */
  getConversionCount(organizationId?: string): number {
    if (organizationId) {
      return this.conversions.filter((c) => c.organizationId === organizationId).length;
    }
    return this.conversions.length;
  }
}
