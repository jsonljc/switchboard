// packages/ad-optimizer/src/audit-runner.ts
/* eslint-disable max-lines -- orchestrator at the 600-line cap: concurrent additions
   (#854 riley->agent handoff + the per-source attribution wiring) tipped it over. It is
   already heavily extracted (audit-v2-sections, analyzers/source-reallocation,
   audit-report-builders, recommendation-handoff-dispatch); a further split of the run()
   pipeline is the right follow-up but is out of scope for this slice. */
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
import {
  handoffContextFromInsight,
  type HandoffCampaignContext,
  type RecommendationHandoffSubmitter,
} from "./recommendation-handoff-dispatch.js";
import type { RileyPauseSubmitter } from "./riley-pause-dispatch.js";
import type { RileyBudgetSubmitter } from "./riley-budget-dispatch.js";
import { computeAuditEconomicsSections } from "./analyzers/source-reallocation.js";
import { arbitrate } from "./analyzers/opportunity-arbitrator.js";
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
  assembleRevenueState,
  resolveBusinessContextFreshness,
  type RevenueState,
} from "./revenue-state.js";
import { deriveOwnershipAnnotations } from "./recommendation-ownership.js";
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
  /** Optional: ALL account ad sets (no campaign filter) with destination_type + learning
   * state + spend, for the weekly audit's per-source spend attribution. Read-only. */
  getAccountAdSetLearningInputs?(dateRange: {
    since: string;
    until: string;
  }): Promise<AdSetLearningInput[]>;
  /** Optional (Spec-1B): strict cents read of a campaign's daily budget, for the reallocate
   * sink's current-budget source. Absent on fakes -> reallocate abstains (no current budget). */
  getCampaign?(
    campaignId: string,
  ): Promise<{ campaignId: string; name: string; status: string; dailyBudgetCents: number | null }>;
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
  /** Default off. Gates surfacing of the ad-set learning-limited recommendations (the
   * unvalidated manual-cast V2 surface). Ad-set details + learning counts are always
   * computed from real data; only the recs are deferred until output validation + tests land. */
  surfaceAdSetLearning?: boolean;
  /**
   * D7-2 (the first learning wire): a bounded, abstaining per-action-kind confidence
   * modifier resolved per-org from the operator approve/reject aggregate (built in the
   * weekly audit from the injected `approvalRateProvider`). Forwarded verbatim into each
   * `decideForCampaign` call. Absent ⇒ no adjustment (back-compat). Typed `(string) =>
   * number` (the aggregate keys are arbitrary action strings); assignable to the engine's
   * narrower `(RecommendationOutput["action"]) => number` by parameter contravariance.
   */
  confidenceModifierByKind?: (action: string) => number;
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

/**
 * Slice-4c: latest operator operational-state confirmation (the 4a
 * substrate). Implementation is PrismaOperationalStateStore.getLatest in
 * @switchboard/db, injected at the app layer (ad-optimizer is Layer 2 and
 * cannot import db). Structural type: freshness needs only the anchor.
 */
export interface OperationalStateProvider {
  getLatest(organizationId: string): Promise<{ confirmedAt: Date } | null>;
}

export interface AuditDependencies {
  adsClient: AdsClientInterface;
  crmDataProvider: CrmDataProvider;
  insightsProvider: CampaignInsightsProvider;
  config: AuditConfig;
  getAdSetInsights?(params: {
    dateRange: { since: string; until: string };
    fields: string[];
  }): Promise<AdSetLearningInput[] | null>;
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
  /** Optional bootstrap callback: routes each emitted creative rec (post-abstention) to a governed Mira draft. */
  recommendationHandoffSubmitter?: RecommendationHandoffSubmitter;
  /** Optional (Phase-C). Routes the arbitration-PRIMARY pause to the governed
   * pause intent (parking for mandatory approval). Capability = permission: the
   * cron passes it ONLY for deployments whose
   * governanceSettings.pauseSelfExecutionEnabled is true (both default OFF). */
  rileyPauseSubmitter?: RileyPauseSubmitter;
  /** Optional (Spec-1B 1B-1.6). When present, a `scale` rec is proposed as a campaign budget
   * reallocation (parking for mandatory approval). Capability = permission: the cron passes it
   * ONLY when RILEY_REALLOCATE_SELF_EXECUTION_ENABLED is on (default OFF). */
  rileyBudgetSubmitter?: RileyBudgetSubmitter;
  /** Optional (slice 4c). Feeds RevenueState.businessContextFreshness; read
   * POST-ABORT only. Absent ⇒ freshness stays "unknown" (back-compat: the
   * eval harness and analysis-only callers are unaffected). */
  operationalStateProvider?: OperationalStateProvider;
}

// ── Helpers ──

// The AdsInsights `/insights` edge does NOT return `status`/`effective_status`/
// `revenue` (those live on the campaign-object edge); requesting them yields a Graph
// error or silent zeros. Money is sourced from `action_values` (summed in the mapper
// into `insight.revenue`); `status` is "" off this edge and is not consumed by the
// audit logic. See docs/runbooks/riley-meta-insights-live-verify.md.
const INSIGHT_FIELDS = [
  "campaign_id",
  "campaign_name",
  "impressions",
  "inline_link_clicks",
  "spend",
  "conversions",
  "frequency",
  "cpm",
  "inline_link_click_ctr",
  "cost_per_inline_link_click",
  "action_values", // money source on the insights edge (NOT `revenue`)
];
export { INSIGHT_FIELDS }; // pinned by the recorded-fixture test

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
  private readonly recommendationHandoffSubmitter?: RecommendationHandoffSubmitter;
  private readonly rileyPauseSubmitter?: RileyPauseSubmitter;
  private readonly rileyBudgetSubmitter?: RileyBudgetSubmitter;
  private readonly operationalStateProvider?: OperationalStateProvider;

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
    this.recommendationHandoffSubmitter = deps.recommendationHandoffSubmitter;
    this.rileyPauseSubmitter = deps.rileyPauseSubmitter;
    this.rileyBudgetSubmitter = deps.rileyBudgetSubmitter;
    this.operationalStateProvider = deps.operationalStateProvider;

    if (deps.recommendationEmitter && !deps.recommendationEmissionContext) {
      throw new Error(
        "AuditRunner: recommendationEmissionContext is required when recommendationEmitter is provided " +
          "(otherwise mirrored WorkTrace rows would lack cron + deployment provenance)",
      );
    }
  }

  /**
   * D2-7 batching: when the provider supports it, fetch the account-level daily breach window and
   * 7-day learning window ONCE and index the daily rows by campaignId, so the per-campaign loop
   * reads its slice instead of re-fetching the whole account 2N times. Returns undefined when the
   * provider lacks the capability (eval / analysis-only fakes) ⇒ caller keeps the per-campaign
   * fetch path unchanged.
   */
  private async prefetchAndIndexAccountRows(dateRange: {
    since: string;
    until: string;
  }): Promise<
    { learning: CampaignInsight[]; dailyByCampaign: Map<string, CampaignInsight[]> } | undefined
  > {
    if (!this.insightsProvider.prefetchAccountRows) return undefined;
    const rows = await this.insightsProvider.prefetchAccountRows({
      endDate: new Date(dateRange.until),
      ...(this.config.conversionActionType
        ? { conversionActionType: this.config.conversionActionType }
        : {}),
      ...(this.config.attributionWindows
        ? { attributionWindows: this.config.attributionWindows }
        : {}),
    });
    const dailyByCampaign = new Map<string, CampaignInsight[]>();
    for (const row of rows.daily) {
      const existing = dailyByCampaign.get(row.campaignId);
      if (existing) existing.push(row);
      else dailyByCampaign.set(row.campaignId, [row]);
    }
    return { learning: rows.learning, dailyByCampaign };
  }

  async run(params: {
    dateRange: { since: string; until: string };
    previousDateRange: { since: string; until: string };
  }): Promise<AuditReport> {
    const { dateRange, previousDateRange } = params;
    // Inclusive window length (weekly window since = until - 6 ⇒ 7 days) for handoff evidence.
    const windowDays =
      Math.round((Date.parse(dateRange.until) - Date.parse(dateRange.since)) / 86_400_000) + 1;
    // Per-campaign evidence + learning-phase context (the handoff-gate shape),
    // captured for EVERY run since Riley v3 ownership reads it (Step 8e). It now
    // feeds the handoff abstention AND the Phase-C pause dispatch, hence the
    // neutral name. The sink still receives it only alongside a submitter (see
    // Step 9), so analysis-only callers are byte-identical to before.
    const campaignEvidenceByCampaign = new Map<string, HandoffCampaignContext>();

    // Gate 0 (Phase-A): data-sufficiency abstention. When a coverage validator is
    // injected and tracked-source coverage is below the sufficiency floor, Riley
    // holds all recommendations rather than analyze on blind spots, returning an
    // abstention report with one account-level explanatory insight. Opt-in: absent
    // validator ⇒ no gate (existing callers unaffected).
    let coverageReport: CoverageReport | undefined;
    if (this.coverageValidator) {
      coverageReport = await this.coverageValidator.validate({
        orgId: this.config.orgId,
        accountId: this.config.accountId,
      });
      if (!isCoverageSufficient(coverageReport)) {
        const pct = Math.round(coverageReport.coveragePct * 100);
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

    // Riley v3 slice 1: consolidate the six account-level pre-flight producers into one typed
    // RevenueState. Assembled HERE, on the post-abort happy path: Gate-0 coverage was validated
    // sufficient (or absent) and signal-health is non-red (or absent), and measurementTrusted /
    // economicTier / effectiveTarget / marginBasis are now resolved. The late per-source
    // spendAttributionCoverageBySource is completed inside computeAuditEconomicsSections. Do NOT
    // hoist this above the two early returns; that would call late producers past an abort.
    // Riley v3 slice 4c: freshness of the operator operational-state source,
    // read POST-ABORT only (the Gate-0 and signal-red abort paths never touch
    // it; pinned by the abort-guard test). Advisory CARRY: nothing gates on
    // it in this slice; a read failure degrades to "unknown" inside the
    // resolver rather than sinking the weekly audit.
    const businessContextFreshness = await resolveBusinessContextFreshness(
      this.operationalStateProvider,
      this.config.orgId,
      new Date(),
    );
    const revenueState: RevenueState = assembleRevenueState({
      measurementTrusted,
      economicTier,
      effectiveTarget,
      marginBasis,
      businessContextFreshness,
      ...(coverageReport
        ? { coverage: { coveragePct: coverageReport.coveragePct, sufficient: true } }
        : {}),
      ...(signalHealthReport ? { signalHealthScore: signalHealthReport.score } : {}),
    });

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

    // D2-7 batching: when the provider exposes the prefetch capability, pull the account-level
    // daily breach window AND the 7-day learning window ONCE for the whole account, indexed by
    // campaignId, then feed the per-campaign slices into the loop's provider calls below. This
    // collapses the previous 2N per-campaign account re-fetches to 2. Absent (eval / analysis-only
    // fake providers) ⇒ undefined ⇒ each provider call fetches per-campaign as before (back-compat).
    const prefetched = await this.prefetchAndIndexAccountRows(dateRange);

    for (const insight of currentInsights) {
      // 5a: Check learning phase
      const learningInput = await this.insightsProvider.getCampaignLearningData({
        orgId: this.config.orgId,
        accountId: this.config.accountId,
        campaignId: insight.campaignId,
        ...(prefetched ? { prefetchedLearningRows: prefetched.learning } : {}),
      });
      const learningStatus = this.learningGuard.check(insight.campaignId, learningInput);
      // Task 8 Step 4: derived from the already-fetched `learningStatus` — no extra Graph call.
      const learningPhaseActive = deriveLearningPhaseActive(learningStatus.state);
      if (learningPhaseActive) campaignsInLearning++;
      campaignEvidenceByCampaign.set(
        insight.campaignId,
        handoffContextFromInsight(insight, windowDays, learningPhaseActive),
      );

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
        ...(prefetched
          ? { prefetchedDailyRows: prefetched.dailyByCampaign.get(insight.campaignId) ?? [] }
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
        revenueState,
        targetROAS: this.config.targetROAS,
        nextCycleDate,
        learningPhaseActive,
        targetSource: campaignTarget.targetSource,
        // D7-2: forward the per-org learned confidence modifier into the per-campaign decision
        // (absent ⇒ no adjustment). v1 SCOPE: only recs from generateRecommendations are modified;
        // the learning-limited, reallocation, and signal-health recs assembled later in this run
        // keep their base confidence (a deliberate v1 boundary, not every kind is learned on yet).
        ...(this.config.confidenceModifierByKind
          ? { confidenceModifierByKind: this.config.confidenceModifierByKind }
          : {}),
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
      surfaceAdSetLearning: this.config.surfaceAdSetLearning ?? false,
    });
    const { adSetDetails, trends, budgetDistribution } = v2Sections;
    const adSetsInLearning = v2Sections.adSetsInLearning;
    const adSetsLearningLimited = v2Sections.adSetsLearningLimited;
    recommendations.push(...v2Sections.learningLimitedRecs);

    // Step 8b: per-source + per-campaign economics and the account-level reallocation
    // advisory, computed in a focused module to keep this file under the 600-line cap.
    // The per-source economics (previously computed-then-discarded) now drive one
    // advisory shift_budget_to_source rec; campaignEconomics is unchanged.
    const {
      sourceComparison,
      campaignEconomics,
      reallocation,
      revenueState: economicsRevenueState,
      spendBySource,
    } = await computeAuditEconomicsSections({
      bySource: (crmData as CrmFunnelDataWithSources).bySource,
      byCampaign,
      currentInsights,
      adSetData,
      revenueState,
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

    // Step 8d (Riley v3 slice 2): cross-campaign arbitration, ADDITIVE ranking
    // metadata over the final candidate set. Pure annotation: Step 9 emission and
    // the handoff consume `recommendations` unchanged; only the report carries the
    // ranking. Reads the economics-enriched RevenueState (producer 6 present when
    // per-source data existed).
    const arbitration =
      recommendations.length > 0
        ? arbitrate({
            candidates: recommendations,
            revenueState: economicsRevenueState,
            currentInsights,
            ...(spendBySource ? { spendBySource } : {}),
          })
        : undefined;

    // Phase-C: the arbitration primary's index WHEN that primary is a pause.
    // The sink dispatches the pause submitter only at this index (primary-only
    // self-submission is structural, parent spec section 3).
    const pausePrimaryIndex =
      arbitration?.primary && arbitration.primary.action === "pause"
        ? arbitration.primary.index
        : undefined;

    // Step 9: Emit recommendations to the v1 pipeline (queue / shadow / dropped).
    // Graceful degradation: skipped when no emitter is wired so existing
    // analysis-only callers keep working.
    let pauseParkedIndex: number | undefined;
    if (this.recommendationEmitter) {
      const auditRunId = `audit:${this.config.accountId}:${dateRange.since}:${dateRange.until}`;

      // Spec-1B 1B-1.6: when reallocate self-submission is wired (flag-on), pre-read each scale-rec
      // campaign's live current daily budget so the sink can propose current x factor. Flag-off ->
      // no submitter -> ZERO extra Meta calls. A per-campaign read failure degrades to null (the
      // candidate abstains), never aborting the audit (no first-failure fleet halt).
      let currentDailyBudgetCentsByCampaign: Map<string, number | null> | undefined;
      const getCampaignFn = this.adsClient.getCampaign?.bind(this.adsClient);
      if (this.rileyBudgetSubmitter && getCampaignFn) {
        const scaleCampaignIds = [
          ...new Set(recommendations.filter((r) => r.action === "scale").map((r) => r.campaignId)),
        ];
        if (scaleCampaignIds.length > 0) {
          currentDailyBudgetCentsByCampaign = new Map();
          for (const campaignId of scaleCampaignIds) {
            try {
              const campaign = await getCampaignFn(campaignId);
              currentDailyBudgetCentsByCampaign.set(campaignId, campaign.dailyBudgetCents);
            } catch (err) {
              currentDailyBudgetCentsByCampaign.set(campaignId, null);
              console.warn(
                `[ad-optimizer] reallocate current-budget pre-read failed campaign=${campaignId}: ${String(err)}`,
              );
            }
          }
        }
      }

      // Constructor invariant: recommendationEmissionContext is always defined
      // when recommendationEmitter is. The non-null assertion is safe.
      const sinkResult = await runRecommendationSink({
        orgId: this.config.orgId,
        auditRunId,
        recommendations,
        emit: this.recommendationEmitter,
        emissionContext: this.recommendationEmissionContext!,
        recommendationHandoffSubmitter: this.recommendationHandoffSubmitter,
        rileyPauseSubmitter: this.rileyPauseSubmitter,
        pausePrimaryIndex,
        rileyBudgetSubmitter: this.rileyBudgetSubmitter,
        adAccountId: this.config.accountId,
        ...(currentDailyBudgetCentsByCampaign ? { currentDailyBudgetCentsByCampaign } : {}),
        campaignEvidenceByCampaign:
          this.recommendationHandoffSubmitter ||
          this.rileyPauseSubmitter ||
          this.rileyBudgetSubmitter
            ? campaignEvidenceByCampaign
            : undefined,
        // PR2 Gate-4: per-campaign economics (built above) so each rec's approval
        // card surfaces its own CPL / cost-per-booked / true ROAS. Omitted when the
        // provider returned no per-campaign funnel (graceful — no economics line).
        ...(campaignEconomics ? { campaignEconomics } : {}),
      });
      pauseParkedIndex = sinkResult.pauseParkedIndex;
      // v1: log the rollup. v1.5 will write a first-class activity-trail event
      // (deferred — AgentEvent requires deploymentId not yet in AuditConfig).
      console.warn(
        `[ad-optimizer] Riley reviewed ${recommendations.length} candidates -> ` +
          `queue=${sinkResult.routedQueue} shadow=${sinkResult.routedShadow} dropped=${sinkResult.dropped}` +
          (this.rileyPauseSubmitter ? ` pauseParked=${sinkResult.pauseParkedIndex ?? "none"}` : ""),
      );
    }

    // Step 9b (Riley v3, spec 2.2 net-new item 1; moved below the sink for the
    // Phase-C STRICT-TRUTH widening): per-recommendation ownership annotation,
    // ADDITIVE; it never filters emission or handoff. Reads the always-built
    // per-campaign evidence context PLUS the sink's park fact, so riley_self is
    // emitted only for a pause that ACTUALLY parked this run. The report at
    // Step 10 is the only consumer, so the move is observation-equivalent for
    // every other field.
    const ownership =
      recommendations.length > 0
        ? deriveOwnershipAnnotations({
            recommendations,
            handoffContextByCampaign: campaignEvidenceByCampaign,
            pauseParkedIndex,
          })
        : undefined;

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
      ...(arbitration ? { arbitration } : {}),
      ...(ownership ? { ownership } : {}),
    };
  }
}
