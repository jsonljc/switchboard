// packages/core/src/ad-optimizer/audit-runner.ts
import type {
  AuditReportSchema as AuditReport,
  CampaignInsightSchema as CampaignInsight,
  InsightOutputSchema as InsightOutput,
  WatchOutputSchema as WatchOutput,
  RecommendationOutputSchema as RecommendationOutput,
  AccountSummarySchema as AccountSummary,
  CrmDataProvider,
  MediaBenchmarks,
  CampaignInsightsProvider,
  AdSetLearningInput,
  MetricSnapshotSchema as MetricSnapshot,
  AdSetDetailSchema as AdSetDetail,
  FunnelAnalysisSchema as FunnelAnalysis,
  TrendAnalysisSchema as TrendAnalysis,
  BudgetAnalysisSchema as BudgetAnalysis,
  CampaignBudgetEntrySchema as CampaignBudgetEntry,
} from "@switchboard/schemas";
import { analyzeFunnel } from "./funnel-analyzer.js";
import { comparePeriods, type MetricSet } from "./period-comparator.js";
import { LearningPhaseGuard } from "./learning-phase-guard.js";
import { LearningPhaseGuardV2 } from "./learning-phase-guard.js";
import { detectFunnelShape } from "./funnel-detector.js";
import { detectTrends } from "./trend-engine.js";
import { analyzeBudgetDistribution } from "./budget-analyzer.js";
import { diagnose } from "./metric-diagnostician.js";
import { generateRecommendations } from "./recommendation-engine.js";

// ── Interfaces ──

export interface AdsClientInterface {
  getCampaignInsights(params: {
    dateRange: { since: string; until: string };
    fields: string[];
  }): Promise<CampaignInsight[]>;
  getAdSetInsights(params: {
    dateRange: { since: string; until: string };
    fields: string[];
  }): Promise<unknown[]>;
  getAccountSummary(): Promise<AccountSummary>;
}

export interface AuditConfig {
  accountId: string;
  orgId: string;
  targetCPA: number;
  targetROAS: number;
  mediaBenchmarks: MediaBenchmarks;
}

export interface AuditDependencies {
  adsClient: AdsClientInterface;
  crmDataProvider: CrmDataProvider;
  insightsProvider: CampaignInsightsProvider;
  config: AuditConfig;
  getAdSetInsights?(params: {
    dateRange: { since: string; until: string };
    fields: string[];
  }): Promise<AdSetLearningInput[]>;
  getTrendData?(params: { accountId: string }): Promise<{
    day30: MetricSnapshot;
    day60: MetricSnapshot;
    day90: MetricSnapshot;
    weekly: MetricSnapshot[];
  } | null>;
}

// ── Helpers ──

const INSIGHT_FIELDS = [
  "campaign_id",
  "campaign_name",
  "status",
  "impressions",
  "clicks",
  "spend",
  "conversions",
  "revenue",
  "frequency",
  "cpm",
  "ctr",
  "cpc",
];

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

function insightToMetrics(insight: CampaignInsight): MetricSet {
  const { spend, impressions, clicks, conversions, revenue, frequency } = insight;
  return {
    cpm: safeDivide(spend, impressions) * 1000,
    ctr: safeDivide(clicks, impressions) * 100,
    cpc: safeDivide(spend, clicks),
    cpl: safeDivide(spend, conversions),
    cpa: safeDivide(spend, conversions),
    roas: safeDivide(revenue, spend),
    frequency,
  };
}

function aggregateMetrics(insights: CampaignInsight[]): MetricSet {
  if (insights.length === 0) {
    return { cpm: 0, ctr: 0, cpc: 0, cpl: 0, cpa: 0, roas: 0, frequency: 0 };
  }

  let totalSpend = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalConversions = 0;
  let totalRevenue = 0;
  let totalFrequency = 0;

  for (const insight of insights) {
    totalSpend += insight.spend;
    totalImpressions += insight.impressions;
    totalClicks += insight.clicks;
    totalConversions += insight.conversions;
    totalRevenue += insight.revenue;
    totalFrequency += insight.frequency;
  }

  return {
    cpm: safeDivide(totalSpend, totalImpressions) * 1000,
    ctr: safeDivide(totalClicks, totalImpressions) * 100,
    cpc: safeDivide(totalSpend, totalClicks),
    cpl: safeDivide(totalSpend, totalConversions),
    cpa: safeDivide(totalSpend, totalConversions),
    roas: safeDivide(totalRevenue, totalSpend),
    frequency: safeDivide(totalFrequency, insights.length),
  };
}

// ── AuditRunner ──

export class AuditRunner {
  private readonly adsClient: AdsClientInterface;
  private readonly crmDataProvider: CrmDataProvider;
  private readonly insightsProvider: CampaignInsightsProvider;
  private readonly config: AuditConfig;
  private readonly learningGuard: LearningPhaseGuard;
  private readonly learningGuardV2: LearningPhaseGuardV2;
  private readonly getAdSetInsightsFn?: AuditDependencies["getAdSetInsights"];
  private readonly getTrendDataFn?: AuditDependencies["getTrendData"];

  constructor(deps: AuditDependencies) {
    this.adsClient = deps.adsClient;
    this.crmDataProvider = deps.crmDataProvider;
    this.insightsProvider = deps.insightsProvider;
    this.config = deps.config;
    this.learningGuard = new LearningPhaseGuard();
    this.learningGuardV2 = new LearningPhaseGuardV2();
    this.getAdSetInsightsFn = deps.getAdSetInsights;
    this.getTrendDataFn = deps.getTrendData;
  }

  async run(params: {
    dateRange: { since: string; until: string };
    previousDateRange: { since: string; until: string };
  }): Promise<AuditReport> {
    const { dateRange, previousDateRange } = params;

    // Step 1: Pull current + previous period campaign insights + account summary (parallel)
    const [currentInsights, previousInsights, _accountSummary] = await Promise.all([
      this.adsClient.getCampaignInsights({ dateRange, fields: INSIGHT_FIELDS }),
      this.adsClient.getCampaignInsights({ dateRange: previousDateRange, fields: INSIGHT_FIELDS }),
      this.adsClient.getAccountSummary(),
    ]);

    // Step 2: Pull CRM funnel data + benchmarks (parallel)
    const campaignIds = currentInsights.map((i) => i.campaignId);
    const [crmData, crmBenchmarks] = await Promise.all([
      this.crmDataProvider.getFunnelData({
        orgId: this.config.orgId,
        accountId: this.config.accountId,
        campaignIds,
        startDate: new Date(dateRange.since),
        endDate: new Date(dateRange.until),
      }),
      this.crmDataProvider.getBenchmarks({
        orgId: this.config.orgId,
        accountId: this.config.accountId,
      }),
    ]);

    // Step 2b: Pull V2 data (ad set insights + trend data) if available
    const [adSetData, trendRawData] = await Promise.all([
      this.getAdSetInsightsFn
        ? this.getAdSetInsightsFn({ dateRange, fields: INSIGHT_FIELDS })
        : Promise.resolve(null),
      this.getTrendDataFn
        ? this.getTrendDataFn({ accountId: this.config.accountId })
        : Promise.resolve(null),
    ]);

    // Step 3: Compute funnel analysis — wrap in array with funnelShape
    const baseFunnel = analyzeFunnel({
      insights: currentInsights,
      crmData,
      crmBenchmarks,
      mediaBenchmarks: this.config.mediaBenchmarks,
    });
    const funnel: FunnelAnalysis[] = [{ ...baseFunnel, funnelShape: "website" }];

    // Step 4: Aggregate metrics and compute period deltas
    const currentMetrics = aggregateMetrics(currentInsights);
    const previousMetrics = aggregateMetrics(previousInsights);
    const periodDeltas = comparePeriods(currentMetrics, previousMetrics);

    // Step 5: Per-campaign loop
    const insights: InsightOutput[] = [];
    const watches: WatchOutput[] = [];
    const recommendations: RecommendationOutput[] = [];
    let campaignsInLearning = 0;

    // Build a lookup map for previous insights by campaignId
    const previousMap = new Map<string, CampaignInsight>();
    for (const prev of previousInsights) {
      previousMap.set(prev.campaignId, prev);
    }

    for (const insight of currentInsights) {
      // 5a: Check learning phase
      const learningInput = await this.insightsProvider.getCampaignLearningData({
        orgId: this.config.orgId,
        accountId: this.config.accountId,
        campaignId: insight.campaignId,
      });
      const learningStatus = this.learningGuard.check(insight.campaignId, learningInput);
      if (learningStatus.state === "learning" || learningStatus.state === "learning_limited") {
        campaignsInLearning++;
      }

      // 5b: Compute per-campaign deltas
      const prevInsight = previousMap.get(insight.campaignId);
      const campaignCurrentMetrics = insightToMetrics(insight);
      const campaignPreviousMetrics = prevInsight
        ? insightToMetrics(prevInsight)
        : { cpm: 0, ctr: 0, cpc: 0, cpl: 0, cpa: 0, roas: 0, frequency: 0 };
      const campaignDeltas = comparePeriods(campaignCurrentMetrics, campaignPreviousMetrics);

      // 5c: Diagnose
      const diagnoses = diagnose(campaignDeltas);

      // 5d: Check if performing well — if yes AND no diagnoses, skip with insight
      const performanceMetrics = {
        cpa: campaignCurrentMetrics.cpa,
        roas: campaignCurrentMetrics.roas,
      };
      const performanceTargets = {
        targetCPA: this.config.targetCPA,
        targetROAS: this.config.targetROAS,
      };

      if (
        this.learningGuard.isPerformingWell(performanceMetrics, performanceTargets) &&
        diagnoses.length === 0
      ) {
        const roasFormatted = campaignCurrentMetrics.roas.toFixed(1);
        insights.push({
          type: "insight",
          campaignId: insight.campaignId,
          campaignName: insight.campaignName,
          message: `Campaign has maintained ${roasFormatted}x ROAS. No changes recommended.`,
          category: "stable_performance",
        });
        continue;
      }

      // 5e: Get target breach status
      const targetBreach = await this.insightsProvider.getTargetBreachStatus({
        orgId: this.config.orgId,
        accountId: this.config.accountId,
        campaignId: insight.campaignId,
        targetCPA: this.config.targetCPA,
        startDate: new Date(dateRange.since),
        endDate: new Date(dateRange.until),
      });

      // 5f: Generate recommendations
      const campaignRecs = generateRecommendations({
        campaignId: insight.campaignId,
        campaignName: insight.campaignName,
        diagnoses,
        deltas: campaignDeltas,
        targetCPA: this.config.targetCPA,
        targetROAS: this.config.targetROAS,
        currentSpend: insight.spend,
        targetBreach,
      });

      // 5g: Gate recommendations through learning phase
      for (const rec of campaignRecs) {
        const gated = this.learningGuard.gate(rec, learningStatus);
        if (gated.type === "watch") {
          watches.push(gated);
        } else {
          recommendations.push(gated);
        }
      }
    }

    // Step 6: V2 — Ad set level learning + details
    let adSetsInLearning = 0;
    let adSetsLearningLimited = 0;
    let adSetDetails: AdSetDetail[] | undefined;

    if (adSetData) {
      adSetDetails = adSetData.map((input) => {
        const learningStatus = this.learningGuardV2.classifyState(input);

        if (learningStatus.state === "learning") {
          adSetsInLearning++;
        } else if (learningStatus.state === "learning_limited") {
          adSetsLearningLimited++;
        }

        const destinationType = (input as unknown as Record<string, unknown>).destinationType as
          | string
          | undefined;
        const funnelShape = detectFunnelShape(destinationType ?? "WEBSITE");

        return {
          adSetId: input.adSetId,
          adSetName: input.adSetName,
          campaignId: input.campaignId,
          destinationType: destinationType ?? "WEBSITE",
          funnelShape,
          frequency: input.frequency,
          learningStatus,
          hasFrequencyCap: false,
        };
      });
    }

    // Step 7: V2 — Trends
    let trends: TrendAnalysis | undefined;
    if (trendRawData) {
      const weeklyTrends = detectTrends(trendRawData.weekly);
      trends = {
        rollingAverages: {
          day30: trendRawData.day30,
          day60: trendRawData.day60,
          day90: trendRawData.day90,
        },
        weeklySnapshots: trendRawData.weekly.map((w, i) => ({
          weekStart: `week-${i}`,
          weekEnd: `week-${i}`,
          metrics: w,
        })),
        trends: weeklyTrends,
      };
    }

    // Step 8: V2 — Budget distribution
    let budgetDistribution: BudgetAnalysis | undefined;
    if (currentInsights.length >= 2) {
      const totalSpendAll = currentInsights.reduce((sum, i) => sum + i.spend, 0);
      const budgetEntries: CampaignBudgetEntry[] = currentInsights.map((insight) => ({
        campaignId: insight.campaignId,
        campaignName: insight.campaignName,
        spendShare: safeDivide(insight.spend, totalSpendAll),
        spend: insight.spend,
        cpa: safeDivide(insight.spend, insight.conversions),
        roas: safeDivide(insight.revenue, insight.spend),
        isCbo: false,
        dailyBudget: null,
        lifetimeBudget: null,
        spendCap: null,
        objective: "CONVERSIONS",
      }));
      budgetDistribution = analyzeBudgetDistribution(budgetEntries, this.config.targetCPA, null);
    }

    // Step 9: Assemble report
    const totalSpend = currentInsights.reduce((sum, i) => sum + i.spend, 0);
    const totalLeads = currentInsights.reduce((sum, i) => sum + i.conversions, 0);
    const totalRevenue = currentInsights.reduce((sum, i) => sum + i.revenue, 0);

    return {
      accountId: this.config.accountId,
      dateRange,
      summary: {
        totalSpend,
        totalLeads,
        totalRevenue,
        overallROAS: safeDivide(totalRevenue, totalSpend),
        activeCampaigns: currentInsights.length,
        campaignsInLearning,
        adSetsInLearning,
        adSetsLearningLimited,
      },
      funnel,
      periodDeltas,
      insights,
      watches,
      recommendations,
      ...(trends ? { trends } : {}),
      ...(budgetDistribution ? { budgetDistribution } : {}),
      ...(adSetDetails ? { adSetDetails } : {}),
    };
  }
}
