// ---------------------------------------------------------------------------
// Creative Analyzer — Creative performance decomposition
// ---------------------------------------------------------------------------

export interface CreativePerformanceEntry {
  adId: string;
  adName: string;
  creativeId: string;
  format: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpa: number | null;
  roas: number | null;
  frequency: number;
  fatigueScore: number;
}

export interface CreativeAnalysisResult {
  topPerformers: CreativePerformanceEntry[];
  underperformers: CreativePerformanceEntry[];
  fatigued: CreativePerformanceEntry[];
  formatMix: Array<{
    format: string;
    count: number;
    avgCPA: number | null;
    totalSpend: number;
  }>;
  recommendations: string[];
}

export class CreativeAnalyzer {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async analyze(
    adAccountId: string,
    datePreset = "last_7d",
  ): Promise<CreativeAnalysisResult> {
    const accountId = adAccountId.startsWith("act_")
      ? adAccountId
      : `act_${adAccountId}`;

    const url =
      `${this.baseUrl}/${accountId}/ads?fields=` +
      "id,name,creative{id,object_type}," +
      `insights.date_preset(${datePreset}).fields(spend,impressions,clicks,actions,ctr,cpc,frequency)` +
      `&effective_status=["ACTIVE","PAUSED"]` +
      `&limit=100&access_token=${this.accessToken}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Failed to fetch creative data");
    }
    const data = (await response.json()) as Record<string, unknown>;
    const ads = (data.data ?? []) as Record<string, unknown>[];

    const entries: CreativePerformanceEntry[] = ads.map((ad) => {
      const creative = ad.creative as Record<string, unknown> | undefined;
      const insights = ad.insights as
        | { data?: Record<string, unknown>[] }
        | undefined;
      const row = insights?.data?.[0] ?? {};
      const actions = (row.actions ?? []) as Array<{
        action_type: string;
        value: string;
      }>;
      const conversions = actions
        .filter((a) =>
          ["purchase", "lead", "complete_registration"].includes(a.action_type),
        )
        .reduce((sum, a) => sum + Number(a.value), 0);
      const spend = Number(row.spend ?? 0);
      const frequency = Number(row.frequency ?? 1);

      return {
        adId: String(ad.id),
        adName: String(ad.name ?? ""),
        creativeId: creative ? String(creative.id) : "",
        format: creative ? (creative.object_type as string | null) : null,
        spend,
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        conversions,
        ctr: Number(row.ctr ?? 0),
        cpc: Number(row.cpc ?? 0),
        cpa: conversions > 0 ? spend / conversions : null,
        roas: null,
        frequency,
        fatigueScore: this.computeFatigueScore(frequency, Number(row.ctr ?? 0)),
      };
    });

    const withConversions = entries.filter((e) => e.conversions > 0);
    const sorted = [...withConversions].sort(
      (a, b) => (a.cpa ?? Infinity) - (b.cpa ?? Infinity),
    );

    const topPerformers = sorted.slice(0, 5);
    const underperformers = sorted.slice(-5).reverse();
    const fatigued = entries
      .filter((e) => e.fatigueScore > 0.7)
      .sort((a, b) => b.fatigueScore - a.fatigueScore);

    // Format mix
    const formatMap = new Map<
      string,
      { count: number; totalCPA: number; validCPA: number; totalSpend: number }
    >();
    for (const entry of entries) {
      const fmt = entry.format ?? "unknown";
      const existing = formatMap.get(fmt) ?? {
        count: 0,
        totalCPA: 0,
        validCPA: 0,
        totalSpend: 0,
      };
      existing.count++;
      existing.totalSpend += entry.spend;
      if (entry.cpa !== null) {
        existing.totalCPA += entry.cpa;
        existing.validCPA++;
      }
      formatMap.set(fmt, existing);
    }
    const formatMix = Array.from(formatMap.entries()).map(
      ([format, fmtData]) => ({
        format,
        count: fmtData.count,
        avgCPA:
          fmtData.validCPA > 0 ? fmtData.totalCPA / fmtData.validCPA : null,
        totalSpend: fmtData.totalSpend,
      }),
    );

    const recommendations: string[] = [];
    if (fatigued.length > 0) {
      recommendations.push(
        `${fatigued.length} creative(s) showing fatigue — consider refreshing or pausing`,
      );
    }
    if (formatMix.length === 1) {
      recommendations.push(
        "Only one creative format in use — diversify with video, carousel, or collection ads",
      );
    }
    if (entries.length < 3) {
      recommendations.push(
        "Fewer than 3 active creatives — add more for better optimization",
      );
    }

    return { topPerformers, underperformers, fatigued, formatMix, recommendations };
  }

  private computeFatigueScore(frequency: number, ctr: number): number {
    const freqFactor = Math.min(frequency / 5, 1);
    const ctrPenalty = ctr < 1 ? 0.3 : ctr < 2 ? 0.1 : 0;
    return Math.min(freqFactor + ctrPenalty, 1);
  }
}
