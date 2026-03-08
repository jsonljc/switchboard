// ---------------------------------------------------------------------------
// Auction Insights — competitive intelligence from Meta auction data
// ---------------------------------------------------------------------------
// Fetches auction_insights from the Meta Graph API for a given entity
// (campaign, ad set, or account) and structures competitive intelligence
// with actionable recommendations.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuctionInsightEntry {
  auctionCompetitor: string; // "You" or competitor name/domain
  impressionShare: number; // percentage
  overlapRate: number; // percentage
  positionAboveRate: number; // percentage
  outbidRate: number; // percentage
  costShareRatio: number; // relative cost efficiency
}

export interface AuctionInsightsResult {
  entityId: string;
  entityLevel: "campaign" | "adset" | "account";
  dateRange: { since: string; until: string };
  competitors: AuctionInsightEntry[];
  yourPosition: {
    impressionShare: number;
    avgPosition: number;
    competitivePressure: "low" | "medium" | "high";
  };
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

export class AuctionInsightsChecker {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async analyze(params: {
    entityId: string;
    entityLevel?: "campaign" | "adset" | "account";
    datePreset?: string;
    since?: string;
    until?: string;
  }): Promise<AuctionInsightsResult> {
    const entityLevel = params.entityLevel ?? "campaign";
    const entityId = this.normalizeEntityId(params.entityId, entityLevel);
    const timeParams = this.buildTimeParams(params.datePreset, params.since, params.until);

    const url =
      `${this.baseUrl}/${entityId}/insights?fields=auction_insights` +
      `${timeParams}&access_token=${this.accessToken}`;

    const data = await this.fetchJson(url);
    const insightsData = (data.data ?? []) as Array<Record<string, unknown>>;

    // The auction_insights field is nested inside the first insights row
    const firstRow = insightsData[0] ?? {};
    const rawEntries = (firstRow.auction_insights ?? []) as Array<Record<string, unknown>>;

    const competitors = rawEntries.map((entry) => this.parseEntry(entry));

    // Find "You" entry for position analysis
    const yourEntry = competitors.find((c) => c.auctionCompetitor.toLowerCase() === "you");
    const impressionShare = yourEntry?.impressionShare ?? 0;
    const avgPosition = this.computeAvgPosition(rawEntries);
    const competitivePressure = this.assessPressure(impressionShare);

    const dateRange = this.resolveDateRange(params.datePreset, params.since, params.until);
    const recommendations = this.generateRecommendations(
      competitors,
      impressionShare,
      avgPosition,
      competitivePressure,
    );

    return {
      entityId: params.entityId,
      entityLevel,
      dateRange,
      competitors,
      yourPosition: {
        impressionShare,
        avgPosition,
        competitivePressure,
      },
      recommendations,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private normalizeEntityId(id: string, level: "campaign" | "adset" | "account"): string {
    if (level === "account") {
      return id.startsWith("act_") ? id : `act_${id}`;
    }
    return id;
  }

  private buildTimeParams(datePreset?: string, since?: string, until?: string): string {
    if (since && until) {
      const timeRange = JSON.stringify({ since, until });
      return `&time_range=${encodeURIComponent(timeRange)}`;
    }
    if (datePreset) {
      return `&date_preset=${datePreset}`;
    }
    return "&date_preset=last_30d";
  }

  private resolveDateRange(
    datePreset?: string,
    since?: string,
    until?: string,
  ): { since: string; until: string } {
    if (since && until) {
      return { since, until };
    }
    const now = new Date();
    const daysBack = datePreset === "last_7d" ? 7 : datePreset === "last_14d" ? 14 : 30;
    const sinceDate = new Date(now);
    sinceDate.setDate(sinceDate.getDate() - daysBack);
    return {
      since: sinceDate.toISOString().split("T")[0]!,
      until: now.toISOString().split("T")[0]!,
    };
  }

  private parseEntry(raw: Record<string, unknown>): AuctionInsightEntry {
    const impressionShare = this.parsePercent(raw.auction_impression_share);
    const overlapRate = this.parsePercent(raw.auction_overlap_rate);
    const positionAboveRate = this.parsePercent(raw.auction_position_above_rate);
    const outbidRate = this.parsePercent(raw.auction_outbid_rate);

    // Compute cost share ratio: impression share relative to the median
    // A value > 1 means you're paying relatively more per impression share point
    const medianPosition = Number(raw.auction_median_position ?? 0);
    const costShareRatio =
      impressionShare > 0 && medianPosition > 0 ? medianPosition / impressionShare : 0;

    return {
      auctionCompetitor: String(raw.auction_competitor ?? "Unknown"),
      impressionShare,
      overlapRate,
      positionAboveRate,
      outbidRate,
      costShareRatio: Math.round(costShareRatio * 100) / 100,
    };
  }

  private parsePercent(value: unknown): number {
    if (typeof value === "string") {
      // Meta returns percentages as strings like "12.34%"
      return parseFloat(value.replace("%", "")) || 0;
    }
    return Number(value ?? 0);
  }

  private computeAvgPosition(rawEntries: Array<Record<string, unknown>>): number {
    // Find "You" entry and use its median position
    const yourEntry = rawEntries.find(
      (e) => String(e.auction_competitor ?? "").toLowerCase() === "you",
    );
    return Number(yourEntry?.auction_median_position ?? 0);
  }

  private assessPressure(impressionShare: number): "low" | "medium" | "high" {
    if (impressionShare < 20) return "high";
    if (impressionShare <= 40) return "medium";
    return "low";
  }

  private generateRecommendations(
    competitors: AuctionInsightEntry[],
    _impressionShare: number,
    avgPosition: number,
    competitivePressure: "low" | "medium" | "high",
  ): string[] {
    const recommendations: string[] = [];

    // Impression share recommendations
    if (competitivePressure === "high") {
      recommendations.push(
        "Your impression share is below 20% — consider increasing bids or budget to improve visibility",
      );
    } else if (competitivePressure === "medium") {
      recommendations.push(
        "Your impression share is moderate (20-40%) — there is room to capture more auction volume",
      );
    }

    // Position recommendations
    if (avgPosition > 2) {
      recommendations.push(
        `Your average auction position is ${avgPosition.toFixed(1)} — improve ad relevance or bid to move up`,
      );
    }

    // Outbid analysis
    const otherCompetitors = competitors.filter((c) => c.auctionCompetitor.toLowerCase() !== "you");
    const highOutbidCompetitors = otherCompetitors.filter((c) => c.outbidRate > 50);
    if (highOutbidCompetitors.length > 0) {
      const names = highOutbidCompetitors.map((c) => c.auctionCompetitor).join(", ");
      recommendations.push(
        `You are being outbid more than 50% of the time by: ${names} — review bid strategy`,
      );
    }

    // Overlap analysis
    const highOverlap = otherCompetitors.filter((c) => c.overlapRate > 70);
    if (highOverlap.length > 0) {
      const names = highOverlap.map((c) => c.auctionCompetitor).join(", ");
      recommendations.push(
        `High overlap rate (>70%) with: ${names} — consider differentiating targeting or creative`,
      );
    }

    // Position-above analysis
    const dominatingCompetitors = otherCompetitors.filter((c) => c.positionAboveRate > 60);
    if (dominatingCompetitors.length > 0) {
      const names = dominatingCompetitors.map((c) => c.auctionCompetitor).join(", ");
      recommendations.push(
        `Competitors consistently ranking above you: ${names} — evaluate ad quality score and relevance`,
      );
    }

    // General recommendation if none were generated
    if (recommendations.length === 0 && competitivePressure === "low") {
      recommendations.push(
        "Strong competitive position — maintain current strategy and monitor for changes",
      );
    }

    return recommendations;
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const response = await fetch(url);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = body.error as Record<string, unknown> | undefined;
      throw new Error(`Meta API error: ${(error?.message as string) ?? `HTTP ${response.status}`}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
