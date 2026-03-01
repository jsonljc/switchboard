import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../../core/types.js";
import type { FindingAdvisor } from "../../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Google Channel Allocation Advisor
// ---------------------------------------------------------------------------
// Google Ads runs across multiple campaign types (Search, Display, Video,
// Performance Max, Shopping, Discovery). Each channel has very different
// CPA characteristics:
//
// - Search: Intent-driven, typically lowest CPA
// - Shopping: High intent for e-commerce, competitive
// - Performance Max: Algorithm-driven, variable CPA
// - Display: Awareness-oriented, typically highest CPA
// - Video: Engagement-oriented, brand + performance
//
// This advisor compares CPA across campaign types and flags channels
// with CPA >2x the best-performing channel, suggesting budget reallocation.
//
// Data: SubEntityBreakdown[] with optional campaignType metadata
// stored in the topLevel snapshot as channel breakdowns.
// ---------------------------------------------------------------------------

/** Google campaign channel types */
export type GoogleChannelType =
  | "search"
  | "shopping"
  | "display"
  | "video"
  | "performance_max"
  | "discovery"
  | "other";

/** Channel performance summary */
interface ChannelPerformance {
  channel: GoogleChannelType;
  spend: number;
  conversions: number;
  cpa: number;
  spendShare: number;
}

/**
 * Parse channel breakdowns from the DiagnosticContext.
 * Channels are stored as subEntities with entityId prefixed by channel type
 * or as a channelBreakdowns field on the context.
 */
function extractChannelBreakdowns(
  context: DiagnosticContext
): ChannelPerformance[] | null {
  if (!context.subEntities || context.subEntities.length < 2) return null;

  // Attempt to read channel-level breakdowns from sub-entities
  // Google client should populate entityId with campaign IDs that
  // can be mapped to campaign types. For now, we look for the
  // topLevel channel aggregates that the Google client may provide.
  return null;
}

/**
 * Parse channel performance from topLevel snapshot fields.
 * Google client stores channel-level aggregates as:
 * channel_spend_search, channel_conversions_search, etc.
 */
function extractChannelsFromTopLevel(
  snapshot: MetricSnapshot
): ChannelPerformance[] {
  const channels: GoogleChannelType[] = [
    "search",
    "shopping",
    "display",
    "video",
    "performance_max",
    "discovery",
  ];

  const performances: ChannelPerformance[] = [];
  let totalSpend = 0;

  for (const channel of channels) {
    const spend = snapshot.topLevel[`channel_spend_${channel}`];
    const conversions = snapshot.topLevel[`channel_conversions_${channel}`];

    if (spend !== undefined && spend > 0) {
      totalSpend += spend;
      performances.push({
        channel,
        spend,
        conversions: conversions ?? 0,
        cpa: conversions && conversions > 0 ? spend / conversions : Infinity,
        spendShare: 0, // Computed below
      });
    }
  }

  // Compute spend shares
  if (totalSpend > 0) {
    for (const perf of performances) {
      perf.spendShare = perf.spend / totalSpend;
    }
  }

  return performances;
}

export const googleChannelAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  current: MetricSnapshot,
  _previous: MetricSnapshot,
  context?: DiagnosticContext
): Finding[] => {
  const findings: Finding[] = [];

  // Try to extract channel data from context or topLevel
  let channels = context ? extractChannelBreakdowns(context) : null;
  if (!channels) {
    channels = extractChannelsFromTopLevel(current);
  }

  if (channels.length < 2) return findings;

  // Find best-performing channel (lowest CPA among channels with conversions)
  const convertingChannels = channels.filter(
    (c) => c.conversions > 0 && c.cpa !== Infinity
  );
  if (convertingChannels.length < 2) return findings;

  convertingChannels.sort((a, b) => a.cpa - b.cpa);
  const bestChannel = convertingChannels[0];
  const totalSpend = channels.reduce((sum, c) => sum + c.spend, 0);

  // Flag channels with CPA >2x the best
  const inefficientChannels: ChannelPerformance[] = [];
  let inefficientSpend = 0;

  for (const channel of convertingChannels) {
    if (channel.channel === bestChannel!.channel) continue;
    if (channel.cpa > bestChannel!.cpa * 2) {
      inefficientChannels.push(channel);
      inefficientSpend += channel.spend;
    }
  }

  // Flag zero-conversion channels with significant spend
  const zeroConvChannels = channels.filter(
    (c) => c.conversions === 0 && c.spendShare > 0.05
  );

  if (inefficientChannels.length > 0) {
    const channelList = inefficientChannels
      .map(
        (c) =>
          `${formatChannelName(c.channel)} (CPA $${c.cpa.toFixed(2)}, ${(c.spendShare * 100).toFixed(1)}% of spend)`
      )
      .join("; ");

    findings.push({
      severity: inefficientSpend / totalSpend > 0.3 ? "critical" : "warning",
      stage: "channel_allocation",
      message: `Channel CPA disparity: ${formatChannelName(bestChannel!.channel)} leads at $${bestChannel!.cpa.toFixed(2)} CPA, while ${inefficientChannels.length} channel(s) have >2x CPA: ${channelList}.`,
      recommendation:
        `Consider shifting budget from high-CPA channels to ${formatChannelName(bestChannel!.channel)}. Start with a 10-20% budget shift and monitor for 1-2 weeks. Note that different channels serve different funnel roles — Display/Video drive awareness while Search captures intent. Evaluate holistically before cutting channels entirely.`,
    });
  }

  if (zeroConvChannels.length > 0) {
    const channelList = zeroConvChannels
      .map(
        (c) =>
          `${formatChannelName(c.channel)} ($${c.spend.toFixed(2)}, ${(c.spendShare * 100).toFixed(1)}% of spend)`
      )
      .join("; ");

    findings.push({
      severity: "warning",
      stage: "channel_allocation",
      message: `Zero-conversion channels consuming budget: ${channelList}. These channels are not generating direct conversions.`,
      recommendation:
        "Evaluate whether zero-conversion channels serve an awareness/consideration role. If running brand campaigns on Display/Video, conversions may show up as view-through or assisted conversions. Check Google Analytics for assisted conversion data before pausing.",
    });
  }

  // Healthy summary when all channels perform within 1.5x of best
  if (
    inefficientChannels.length === 0 &&
    zeroConvChannels.length === 0 &&
    convertingChannels.length >= 2
  ) {
    findings.push({
      severity: "healthy",
      stage: "channel_allocation",
      message: `Channel allocation is balanced: all ${convertingChannels.length} converting channels have CPA within 2x of the best channel (${formatChannelName(bestChannel!.channel)} at $${bestChannel!.cpa.toFixed(2)}).`,
      recommendation: null,
    });
  }

  return findings;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatChannelName(channel: GoogleChannelType): string {
  switch (channel) {
    case "search":
      return "Search";
    case "shopping":
      return "Shopping";
    case "display":
      return "Display";
    case "video":
      return "Video";
    case "performance_max":
      return "Performance Max";
    case "discovery":
      return "Discovery";
    default:
      return "Other";
  }
}
