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
  FunnelAnalysisSchema as FunnelAnalysis,
} from "@switchboard/schemas";
import { analyzeFunnel } from "./funnel-analyzer.js";
import { comparePeriods, type MetricSet } from "./period-comparator.js";
import { LearningPhaseGuard, LearningPhaseGuardV2 } from "./learning-phase-guard.js";
import { analyzeV2Sections } from "./audit-v2-sections.js";
import { generateSignalHealthRecommendations } from "./recommendation-engine.js";
import {
  runRecommendationSink,
  type EmissionContext,
  type RecommendationEmitter,
} from "./recommendation-sink.js";
import { computeAuditEconomicsSections } from "./analyzers/source-reallocation.js";
import type {
  CampaignFunnel,
  CrmFunnelDataWithSources,
} from "./crm-data-provider/real-provider.js";
import type { SignalHealthReportProvider, SignalHealthReport } from "./signal-health-checker.js";
import {
  resolveEconomicTarget,
  resolveEconomicTargetForCampaign,
} from "./analyzers/economic-target.js";
import { decideForCampaign, deriveLearningPhaseActive } from "./campaign-decision.js";
import {
  isCoverageSufficient,
  MIN_COVERAGE_PCT,
  type CoverageReport,
} from "./onboarding/coverage-validator.js";
import {
  buildCoverageAbstentionReport,
  buildSignalHealthCriticalReport,
  evaluateDenominatorStepChange,
} from "./audit-report-builders.js";

// ── Interfaces ──

export interface AdsClientInterface {
  getCampaignInsights(params: {
    dateRange: { since: string; until: string };
    fields: string[];
    timeIncrement?: number;
    /** Pins Meta `action_attribution_windows` for the `actions` breakdown. */
    actionAttributionWindows?: string[];
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
  /**
   * Phase-A Gate 1: the Meta `actions` action_type (e.g. "lead"/"purchase") to use
   * as the per-day conversions denominator in the target-breach detector. When set,
   * the detector reads that action's value under a pinned attribution window instead
   * of Meta's unfiltered aggregate `conversions`. Unset ⇒ aggregate (back-compat).
   */
  conversionActionType?: string;
  /** Attribution windows pinned for `conversionActionType`. Default ["7d_click"]. */
  attributionWindows?: string[];
  mediaBenchmarks: MediaBenchmarks;
  /** Optional Meta Pixel ID. When present + signalHealthChecker wired, pulls a
   * signal-health report and short-circuits per-campaign diagnostics on red score. */
  pixelId?: string;
}

/**
 * PR2 Gate-4: per-campaign booked-VALUE provider (the trueROAS numerator).
 * Injected because the implementation (PrismaConversionRecordStore
 * .queryBookedValueCentsByCampaign) lives in @switchboard/db (Layer 4) and
 * ad-optimizer (Layer 2) must not import it. Values are CENTS, keyed by
 * campaignId; an absent campaign means "no attributed booked value" (→ trueROAS
 * null), never 0.
 */
export interface BookedValueByCampaignProvider {
  queryBookedValueCentsByCampaign(query: {
    orgId: string;
    from: Date;
    to: Date;
    campaignIds?: string[];
  }): Promise<Map<string, number>>;
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
  /** Optional Gate 0. When injected, the audit abstains (no recommendations, one
   * explanatory insight) if tracked-source coverage is below the sufficiency floor.
   * Back-compat: absent → no coverage gate (existing callers unaffected). */
  coverageValidator?: {
    validate(query: { orgId: string; accountId: string }): Promise<CoverageReport>;
  };
  /** Optional. Supplies per-campaign booked-VALUE (cents) for trueROAS reporting
   * in `campaignEconomics`. Absent → trueROAS reported null (graceful). Does NOT
   * affect the Gate-4 breach basis, which uses booking COUNTS from byCampaign. */
  bookedValueByCampaignProvider?: BookedValueByCampaignProvider;
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
  private readonly coverageValidator?: AuditDependencies["coverageValidator"];
  private readonly bookedValueByCampaignProvider?: BookedValueByCampaignProvider;

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
    this.coverageValidator = deps.coverageValidator;
    this.bookedValueByCampaignProvider = deps.bookedValueByCampaignProvider;

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

    // Gate 0 (Phase-A): data-sufficiency abstention. When a coverage validator is
    // injected and tracked-source coverage is below the sufficiency floor, Riley
    // holds all recommendations rather than analyze on blind spots, returning an
    // abstention report with one account-level explanatory insight. Opt-in: absent
    // validator ⇒ no gate (existing callers unaffected).
    if (this.coverageValidator) {
      const coverage = await this.coverageValidator.validate({
        orgId: this.config.orgId,
        accountId: this.config.accountId,
      });
      if (!isCoverageSufficient(coverage)) {
        const pct = Math.round(coverage.coveragePct * 100);
        return buildCoverageAbstentionReport({
          accountId: this.config.accountId,
          dateRange,
          coverageInsight: {
            type: "insight",
            campaignId: "account",
            campaignName: "Account-wide signal",
            message: `Tracked-source coverage is ${pct}% (below the ${Math.round(
              MIN_COVERAGE_PCT * 100,
            )}% floor). Riley is holding recommendations until conversion tracking is verified across sources.`,
            category: "coverage_insufficient",
          },
        });
      }
    }

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
      return buildSignalHealthCriticalReport({
        accountId: this.config.accountId,
        dateRange,
        totals: {
          totalSpend: currentInsights.reduce((sum, i) => sum + i.spend, 0),
          totalLeads: currentInsights.reduce((sum, i) => sum + i.conversions, 0),
          totalRevenue: currentInsights.reduce((sum, i) => sum + i.revenue, 0),
          activeCampaigns: currentInsights.length,
        },
        signalHealthRecs,
      });
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

    const nextCycleDate =
      new Date(new Date(dateRange.until).getTime() + 7 * 86_400_000).toISOString().split("T")[0] ??
      dateRange.until;

    // Step 4a (Phase-A Gate 1): account-wide conversion-DENOMINATOR step-change.
    // measurementTrusted=false ⇒ each per-campaign decision abstains on cost-driven
    // and learning-resetting actions; accountWatch (when present) is the single
    // account-level signal watch to surface. fix_signal_health recs (appended
    // later) are not gated by this — the user is still pointed at the fix.
    const { measurementTrusted, accountWatch } = evaluateDenominatorStepChange({
      currentInsights,
      previousInsights,
      nextCycleDate,
    });

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

    // PR2 Gate-4: per-campaign booking funnel (CRM real-provider only). Absent
    // for non-real providers → every campaign falls back to the account target.
    const byCampaign = (crmData as { byCampaign?: Record<string, CampaignFunnel> }).byCampaign;

    // Step 5: Per-campaign loop
    const insights: InsightOutput[] = [];
    const watches: WatchOutput[] = [];
    const recommendations: RecommendationOutput[] = [];
    let campaignsInLearning = 0;

    if (accountWatch) {
      watches.push(accountWatch);
    }

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
      // Task 8 Step 4: derived from the already-fetched `learningStatus` — no extra Graph call.
      const learningPhaseActive = deriveLearningPhaseActive(learningStatus.state);
      if (learningPhaseActive) campaignsInLearning++;

      // 5a-bis (PR2 Gate-4): judge THIS campaign against its own booking-
      // calibrated CAC (Tier-1) when it clears the booking floor; otherwise the
      // account-level target (Tier-2). The account {economicTier, effectiveTarget}
      // resolved once above is the Tier-2 fallback. byCampaign absent → bookings 0
      // → account fallback (graceful degradation).
      const campaignTarget = resolveEconomicTargetForCampaign({
        campaignBookings: byCampaign?.[insight.campaignId]?.booked ?? 0,
        campaignConversions: insight.conversions,
        ...(this.config.targetCostPerBooked !== undefined
          ? { targetCostPerBooked: this.config.targetCostPerBooked }
          : {}),
        accountTarget: { economicTier, effectiveTarget },
      });

      // 5b–5g: Pure per-campaign decision. The provider call for target-breach
      // status is the only side effect; everything downstream is deterministic
      // and lives in decideForCampaign (the model-free eval seam).
      const prevInsight = previousMap.get(insight.campaignId) ?? null;
      const targetBreach = await this.insightsProvider.getTargetBreachStatus({
        orgId: this.config.orgId,
        accountId: this.config.accountId,
        campaignId: insight.campaignId,
        targetCPA: campaignTarget.effectiveTarget,
        startDate: new Date(dateRange.since),
        endDate: new Date(dateRange.until),
        ...(this.config.conversionActionType
          ? { conversionActionType: this.config.conversionActionType }
          : {}),
        ...(this.config.attributionWindows
          ? { attributionWindows: this.config.attributionWindows }
          : {}),
      });
      const decision = decideForCampaign({
        campaignId: insight.campaignId,
        campaignName: insight.campaignName,
        currentInsight: insight,
        previousInsight: prevInsight,
        targetBreach,
        learningStatus,
        economicTier: campaignTarget.economicTier,
        effectiveTarget: campaignTarget.effectiveTarget,
        marginBasis,
        targetROAS: this.config.targetROAS,
        nextCycleDate,
        measurementTrusted,
        learningPhaseActive,
        targetSource: campaignTarget.targetSource,
      });
      insights.push(...decision.insights);
      watches.push(...decision.watches);
      recommendations.push(...decision.recommendations);
    }

    // Steps 6-8: V2 — ad-set learning/details, trends, budget distribution.
    // Extracted to audit-v2-sections.ts for file headroom; the cross-source
    // comparison (Step 8b) stays below since it pairs with campaignEconomics.
    const v2Sections = analyzeV2Sections({
      adSetData,
      trendRawData,
      currentInsights,
      learningGuardV2: this.learningGuardV2,
      targetCPA: this.config.targetCPA,
    });
    const { adSetDetails, trends, budgetDistribution } = v2Sections;
    const adSetsInLearning = v2Sections.adSetsInLearning;
    const adSetsLearningLimited = v2Sections.adSetsLearningLimited;
    recommendations.push(...v2Sections.learningLimitedRecs);

    // Step 8b: per-source + per-campaign economics and the account-level reallocation
    // advisory, computed in a focused module to keep this file under the 600-line cap.
    // The per-source economics (previously computed-then-discarded) now drive one
    // advisory shift_budget_to_source rec; campaignEconomics is unchanged.
    const { sourceComparison, campaignEconomics, reallocation } =
      await computeAuditEconomicsSections({
        bySource: (crmData as CrmFunnelDataWithSources).bySource,
        byCampaign,
        currentInsights,
        adSetData,
        measurementTrusted,
        nextCycleDate,
        orgId: this.config.orgId,
        dateRange,
        bookedValueProvider: this.bookedValueByCampaignProvider,
      });
    if (reallocation?.type === "recommendation") recommendations.push(reallocation);
    else if (reallocation?.type === "watch") watches.push(reallocation);

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
        // PR2 Gate-4: per-campaign economics (built above) so each rec's approval
        // card surfaces its own CPL / cost-per-booked / true ROAS. Omitted when the
        // provider returned no per-campaign funnel (graceful — no economics line).
        ...(campaignEconomics ? { campaignEconomics } : {}),
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
      ...(campaignEconomics ? { campaignEconomics } : {}),
    };
  }
}
