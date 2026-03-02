/**
 * AttributionReporter — aggregates attribution paths into business metrics.
 */

import type { AttributionPath } from "./tracker.js";

export interface AttributionReport {
  /** Total ROAS across all paths */
  overallROAS: number | null;
  /** Average time to revenue (days) */
  avgTimeToRevenueDays: number | null;
  /** Total revenue (USD) */
  totalRevenueUSD: number;
  /** Total cost (USD) */
  totalCostUSD: number;
  /** Number of attribution paths */
  totalPaths: number;
  /** Completed paths (have revenue) */
  completedPaths: number;
  /** Channel breakdown */
  byChannel: Record<string, ChannelMetrics>;
  /** Campaign breakdown */
  byCampaign: Record<string, CampaignMetrics>;
}

export interface ChannelMetrics {
  channel: string;
  paths: number;
  revenueUSD: number;
  costUSD: number;
  roas: number | null;
  avgTimeToRevenueDays: number | null;
}

export interface CampaignMetrics {
  campaignId: string;
  paths: number;
  revenueUSD: number;
  costUSD: number;
  roas: number | null;
}

export class AttributionReporter {
  /**
   * Generate an attribution report from a set of paths.
   */
  generateReport(paths: AttributionPath[]): AttributionReport {
    const totalRevenueUSD = paths.reduce((sum, p) => sum + p.totalRevenueCents / 100, 0);
    const totalCostUSD = paths.reduce((sum, p) => sum + p.totalCostCents / 100, 0);
    const completedPaths = paths.filter((p) => p.totalRevenueCents > 0);

    const timeToRevenueValues = paths
      .filter((p) => p.timeToRevenue !== null)
      .map((p) => p.timeToRevenue! / (1000 * 60 * 60 * 24)); // ms → days

    // Channel breakdown
    const byChannel: Record<string, ChannelMetrics> = {};
    for (const path of paths) {
      if (!byChannel[path.channel]) {
        byChannel[path.channel] = {
          channel: path.channel,
          paths: 0,
          revenueUSD: 0,
          costUSD: 0,
          roas: null,
          avgTimeToRevenueDays: null,
        };
      }
      const ch = byChannel[path.channel]!;
      ch.paths++;
      ch.revenueUSD += path.totalRevenueCents / 100;
      ch.costUSD += path.totalCostCents / 100;
    }

    // Compute channel ROAS
    for (const ch of Object.values(byChannel)) {
      if (ch.costUSD > 0) {
        ch.roas = ch.revenueUSD / ch.costUSD;
      }
    }

    // Campaign breakdown
    const byCampaign: Record<string, CampaignMetrics> = {};
    for (const path of paths) {
      if (!path.campaignId) continue;
      if (!byCampaign[path.campaignId]) {
        byCampaign[path.campaignId] = {
          campaignId: path.campaignId,
          paths: 0,
          revenueUSD: 0,
          costUSD: 0,
          roas: null,
        };
      }
      const cm = byCampaign[path.campaignId]!;
      cm.paths++;
      cm.revenueUSD += path.totalRevenueCents / 100;
      cm.costUSD += path.totalCostCents / 100;
    }

    for (const cm of Object.values(byCampaign)) {
      if (cm.costUSD > 0) {
        cm.roas = cm.revenueUSD / cm.costUSD;
      }
    }

    return {
      overallROAS: totalCostUSD > 0 ? totalRevenueUSD / totalCostUSD : null,
      avgTimeToRevenueDays:
        timeToRevenueValues.length > 0
          ? timeToRevenueValues.reduce((a, b) => a + b, 0) / timeToRevenueValues.length
          : null,
      totalRevenueUSD,
      totalCostUSD,
      totalPaths: paths.length,
      completedPaths: completedPaths.length,
      byChannel,
      byCampaign,
    };
  }
}
