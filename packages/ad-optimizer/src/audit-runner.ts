// packages/ad-optimizer/src/audit-runner.ts
import type {
  AuditReportSchema as AuditReport,
  CampaignInsightSchema as CampaignInsight,
  InsightOutputSchema as InsightOutput,
  WatchOutputSchema as WatchOutput,
  RecommendationOutputSchema as RecommendationOutput,
  AccountSummarySchema as AccountSummary,
  MarginBasisSchema as MarginBasis,
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
import { LearningPhaseGuard, LearningPhaseGuardV2 } from "./learning-phase-guard.js";
import { detectFunnelShape } from "./funnel-detector.js";
import { detectTrends } from "./trend-engine.js";
import { analyzeBudgetDistribution } from "./budget-analyzer.js";
import { generateSignalHealthRecommendations } from "./recommendation-engine.js";
import {
  runRecommendationSink,
  type EmissionContext,
  type RecommendationEmitter,
} from "./recommendation-sink.js";
import { compareSources } from "./analyzers/source-comparator.js";
import { computeSpendBySource } from "./analyzers/spend-attributor.js";
import type { SourceFunnel } from "./crm-data-provider/real-provider.js";
import type { SignalHealthReportProvider, SignalHealthReport } from "./signal-health-checker.js";
import { resolveEconomicTarget } from "./analyzers/economic-target.js";
import { resetsLearningFor } from "./action-reset-classification.js";
import { decideForCampaign } from "./campaign-decision.js";

// ── Interfaces ──

export interface AdsClientInterface {
  getCampaignInsights(params: {
    dateRange: { since: string; until: string };
    fields: string[];
    timeIncrement?: number;
  }): Promise<CampaignInsight[]>;
  getAdSetInsights(params: {
    dateRange: { since: string; until: string };
    fields: string[];
    campaignId?: string;
  }): Promise<unknown[]>;
  getAccountSummary(): Promise<AccountSummary>;
  /** Optional: per-ad-set learning status from `learning_stage_info`. Used by
   * MetaCampaignInsightsProvider to derive campaign-level learning phase; absent → false. */
  getAdSetLearningInputs?(campaignId: string): Promise<AdSetLearningInput[]>;
}

export interface AuditConfig {
  accountId: string;
  orgId: string;
  targetCPA: number;
  targetROAS: number;
  /** PR2: cost-per-booked target (dollars). When set + booking volume sufficient,
   * audit uses economic tier "booked_cac"; otherwise falls back to "cpl" vs targetCPA. */
  targetCostPerBooked?: number;
  mediaBenchmarks: MediaBenchmarks;
  /** Optional Meta Pixel ID. When present + signalHealthChecker wired, pulls a
   * signal-health report and short-circuits per-campaign diagnostics on red score. */
  pixelId?: string;
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
  /**
   * Optional. Emits each generated RecommendationOutput through the v1 pipeline
   * (queue / shadow_action / dropped). Injected rather than importing a Store because
   * ad-optimizer is Layer 2; wire-up lives in apps/api or apps/inngest. When absent,
   * the runner is a pure analyzer — back-compatible with all current callers.
   */
  recommendationEmitter?: RecommendationEmitter;
  /**
   * Required when `recommendationEmitter` is provided. Stamps each emitted
   * recommendation with cron + deployment provenance for the WorkTrace mirror.
   * The runner asserts at `run()` time so misconfiguration surfaces loudly.
   */
  recommendationEmissionContext?: EmissionContext;
  /**
   * Optional. When provided alongside `config.pixelId`, the runner pulls a
   * Meta Pixel + CAPI signal-health report and emits `fix_signal_health`
   * recommendations for any breaches. Critical breaches short-circuit
   * downstream per-campaign diagnostics — there is no point recommending
   * creative changes when the conversion signal is broken.
   */
  signalHealthChecker?: SignalHealthReportProvider;
}

// ── Helpers ──

const INSIGHT_FIELDS = [
  "campaign_id",
  "campaign_name",
  "status",
  "impressions",
  "inline_link_clicks",
  "spend",
  "conversions",
  "revenue",
  "frequency",
  "cpm",
  "inline_link_click_ctr",
  "cost_per_inline_link_click",
];

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

function aggregateMetrics(insights: CampaignInsight[]): MetricSet {
  if (insights.length === 0) {
    return {
      cpm: 0,
      inlineLinkClickCtr: 0,
      costPerInlineLinkClick: 0,
      cpl: 0,
      cpa: 0,
      roas: 0,
      frequency: 0,
    };
  }

  let totalSpend = 0;
  let totalImpressions = 0;
  let totalInlineLinkClicks = 0;
  let totalConversions = 0;
  let totalRevenue = 0;
  let totalFrequency = 0;

  for (const insight of insights) {
    totalSpend += insight.spend;
    totalImpressions += insight.impressions;
    totalInlineLinkClicks += insight.inlineLinkClicks;
    totalConversions += insight.conversions;
    totalRevenue += insight.revenue;
    totalFrequency += insight.frequency;
  }

  return {
    cpm: safeDivide(totalSpend, totalImpressions) * 1000,
    inlineLinkClickCtr: safeDivide(totalInlineLinkClicks, totalImpressions) * 100,
    costPerInlineLinkClick: safeDivide(totalSpend, totalInlineLinkClicks),
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
  private readonly recommendationEmitter?: RecommendationEmitter;
  private readonly recommendationEmissionContext?: EmissionContext;
  private readonly signalHealthChecker?: SignalHealthReportProvider;

  constructor(deps: AuditDependencies) {
    this.adsClient = deps.adsClient;
    this.crmDataProvider = deps.crmDataProvider;
    this.insightsProvider = deps.insightsProvider;
    this.config = deps.config;
    this.learningGuard = new LearningPhaseGuard();
    this.learningGuardV2 = new LearningPhaseGuardV2();
    this.getAdSetInsightsFn = deps.getAdSetInsights;
    this.getTrendDataFn = deps.getTrendData;
    this.recommendationEmitter = deps.recommendationEmitter;
    this.recommendationEmissionContext = deps.recommendationEmissionContext;
    this.signalHealthChecker = deps.signalHealthChecker;

    if (deps.recommendationEmitter && !deps.recommendationEmissionContext) {
      throw new Error(
        "AuditRunner: recommendationEmissionContext is required when recommendationEmitter is provided " +
          "(otherwise mirrored WorkTrace rows would lack cron + deployment provenance)",
      );
    }
  }

  async run(params: {
    dateRange: { since: string; until: string };
    previousDateRange: { since: string; until: string };
  }): Promise<AuditReport> {
    const { dateRange, previousDateRange } = params;

    // Step 0: Signal-health pre-check. Surfaces fix_signal_health recs and
    // (when score=red) short-circuits the downstream per-campaign analysis.
    let signalHealthReport: SignalHealthReport | null = null;
    let signalHealthRecs: RecommendationOutput[] = [];
    if (this.signalHealthChecker && this.config.pixelId) {
      signalHealthReport = await this.signalHealthChecker.getSignalHealthReport(
        this.config.pixelId,
      );
      signalHealthRecs = generateSignalHealthRecommendations(signalHealthReport, {
        pixelId: this.config.pixelId,
        accountId: this.config.accountId,
      });
    }
    const signalHealthCritical = signalHealthReport?.score === "red";

    // Step 1: Pull current + previous period campaign insights + account summary (parallel)
    const [currentInsights, previousInsights, _accountSummary] = await Promise.all([
      this.adsClient.getCampaignInsights({ dateRange, fields: INSIGHT_FIELDS }),
      this.adsClient.getCampaignInsights({ dateRange: previousDateRange, fields: INSIGHT_FIELDS }),
      this.adsClient.getAccountSummary(),
    ]);

    if (signalHealthCritical) {
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
          campaignsInLearning: 0,
          adSetsInLearning: 0,
          adSetsLearningLimited: 0,
        },
        funnel: [],
        periodDeltas: [],
        insights: [],
        watches: [],
        recommendations: signalHealthRecs,
      };
    }

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

    // Step 4b: Resolve the account-level economic tier + booking-calibrated target
    // ONCE for this audit (calibrate-first invariant lives in resolveEconomicTarget).
    const accountConversions = currentInsights.reduce((sum, i) => sum + i.conversions, 0);
    const { economicTier, effectiveTarget } = resolveEconomicTarget({
      targetCostPerBooked: this.config.targetCostPerBooked,
      targetCPA: this.config.targetCPA,
      accountBookings: crmData.bookings ?? 0,
      accountConversions,
    });
    // PR2: no profit-margin / AOV source is plumbed into the audit, so margin
    // awareness is reported unavailable, never silently satisfied (spec §3.4).
    const marginBasis: MarginBasis = "unavailable";
    const nextCycleDate =
      new Date(new Date(dateRange.until).getTime() + 7 * 86_400_000).toISOString().split("T")[0] ??
      dateRange.until;

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

      // 5b–5g: Pure per-campaign decision. The provider call for target-breach
      // status is the only side effect; everything downstream is deterministic
      // and lives in decideForCampaign (the model-free eval seam).
      const prevInsight = previousMap.get(insight.campaignId) ?? null;
      const targetBreach = await this.insightsProvider.getTargetBreachStatus({
        orgId: this.config.orgId,
        accountId: this.config.accountId,
        campaignId: insight.campaignId,
        targetCPA: effectiveTarget,
        startDate: new Date(dateRange.since),
        endDate: new Date(dateRange.until),
      });
      const decision = decideForCampaign({
        campaignId: insight.campaignId,
        campaignName: insight.campaignName,
        currentInsight: insight,
        previousInsight: prevInsight,
        targetBreach,
        learningStatus,
        economicTier,
        effectiveTarget,
        marginBasis,
        targetROAS: this.config.targetROAS,
        nextCycleDate,
      });
      insights.push(...decision.insights);
      watches.push(...decision.watches);
      recommendations.push(...decision.recommendations);
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

        const destinationType = input.destinationType ?? "WEBSITE";
        const funnelShape = detectFunnelShape(destinationType);

        if (learningStatus.state === "learning_limited") {
          const diagnosis = this.learningGuardV2.diagnoseLearningLimited(learningStatus, input);
          const msg = `Ad set ${input.adSetId} is Learning Limited (${diagnosis.cause}). Recommended: ${diagnosis.recommendation}.`;
          recommendations.push({
            type: "recommendation",
            campaignId: input.campaignId,
            campaignName: input.adSetName,
            action: diagnosis.recommendation as RecommendationOutput["action"],
            confidence: 0.75,
            urgency: "this_week",
            estimatedImpact: msg,
            steps: [msg],
            learningPhaseImpact:
              diagnosis.recommendation === "expand_targeting" ? "will reset learning" : "no impact",
            resetsLearning: resetsLearningFor(
              diagnosis.recommendation as RecommendationOutput["action"],
            ),
          });
        }

        return {
          adSetId: input.adSetId,
          adSetName: input.adSetName,
          campaignId: input.campaignId,
          destinationType,
          funnelShape,
          frequency: input.frequency,
          learningStatus,
          hasFrequencyCap: input.hasFrequencyCap ?? false,
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

    // Step 8b: Cross-source comparison (CTWA vs Instant Form on equal footing).
    // Only computed when the CRM data provider returned a per-source funnel.
    let sourceComparison: { rows: ReturnType<typeof compareSources>["rows"] } | undefined;
    const bySource = (crmData as { bySource?: Record<string, SourceFunnel> }).bySource;
    if (bySource && Object.keys(bySource).length > 0) {
      const spendBySource = computeSpendBySource(currentInsights, bySource, adSetData);
      sourceComparison = compareSources({ bySource, spendBySource });
    }

    // Step 8c: Append signal-health recommendations (non-critical breaches —
    // critical case short-circuited above before per-campaign work began).
    if (signalHealthRecs.length > 0) {
      recommendations.push(...signalHealthRecs);
    }

    // Step 9: Emit recommendations to the v1 pipeline (queue / shadow / dropped).
    // Graceful degradation: skipped when no emitter is wired so existing
    // analysis-only callers keep working.
    if (this.recommendationEmitter) {
      const auditRunId = `audit:${this.config.accountId}:${dateRange.since}:${dateRange.until}`;
      // Constructor invariant: recommendationEmissionContext is always defined
      // when recommendationEmitter is. The non-null assertion is safe.
      const sinkResult = await runRecommendationSink({
        orgId: this.config.orgId,
        auditRunId,
        recommendations,
        emit: this.recommendationEmitter,
        emissionContext: this.recommendationEmissionContext!,
      });
      // v1: log the rollup. v1.5 will write a first-class activity-trail event
      // (deferred — AgentEvent requires deploymentId not yet in AuditConfig).
      console.warn(
        `[ad-optimizer] Riley reviewed ${recommendations.length} candidates -> ` +
          `queue=${sinkResult.routedQueue} shadow=${sinkResult.routedShadow} dropped=${sinkResult.dropped}`,
      );
    }

    // Step 10: Assemble report
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
      ...(sourceComparison ? { sourceComparison } : {}),
    };
  }
}
