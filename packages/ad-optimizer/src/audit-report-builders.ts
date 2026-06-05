// packages/ad-optimizer/src/audit-report-builders.ts
//
// Short-circuit report builders for AuditRunner.run(). These assemble the two
// early-return AuditReport literals (signal-health-critical + Gate-0 coverage
// abstention) so the runner body stays under the arch-check line cap and the
// "minimal report" shape is defined in exactly one place.
import type {
  AuditReportSchema as AuditReport,
  CampaignInsightSchema as CampaignInsight,
  InsightOutputSchema as InsightOutput,
  WatchOutputSchema as WatchOutput,
  RecommendationOutputSchema as RecommendationOutput,
} from "@switchboard/schemas";
import { detectDenominatorStepChange } from "./denominator-step-change.js";

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

interface MinimalReportInput {
  accountId: string;
  dateRange: { since: string; until: string };
  summary: AuditReport["summary"];
  insights?: InsightOutput[];
  watches?: WatchOutput[];
  recommendations?: RecommendationOutput[];
}

/**
 * Assembles a minimal AuditReport (empty funnel/periodDeltas + the V2 fields
 * omitted) from the supplied summary and optional list fields. Both short-circuit
 * report builders below funnel through this so the empty-skeleton shape is
 * defined once.
 */
function buildMinimalReport(i: MinimalReportInput): AuditReport {
  return {
    accountId: i.accountId,
    dateRange: i.dateRange,
    summary: i.summary,
    funnel: [],
    periodDeltas: [],
    insights: i.insights ?? [],
    watches: i.watches ?? [],
    recommendations: i.recommendations ?? [],
  };
}

/**
 * Phase-A Gate 1: account-wide conversion-DENOMINATOR step-change evaluation.
 * If the conversion rate (conv/clicks) collapsed while clicks/spend stayed flat,
 * the cost signal is untrustworthy this cycle (a suspected attribution-window/
 * action-type reporting shift, not a real drop). Returns `measurementTrusted`
 * (false ⇒ per-campaign decisions abstain on cost-driven + learning-resetting
 * actions) plus, when suspected, the single account-level signal watch to surface.
 */
export function evaluateDenominatorStepChange(args: {
  currentInsights: CampaignInsight[];
  previousInsights: CampaignInsight[];
  nextCycleDate: string;
}): { measurementTrusted: boolean; accountWatch?: WatchOutput } {
  const sumTotals = (rows: CampaignInsight[]) => ({
    clicks: rows.reduce((s, r) => s + r.inlineLinkClicks, 0),
    conversions: rows.reduce((s, r) => s + r.conversions, 0),
    spend: rows.reduce((s, r) => s + r.spend, 0),
  });
  const stepChange = detectDenominatorStepChange({
    current: sumTotals(args.currentInsights),
    previous: sumTotals(args.previousInsights),
  });
  if (!stepChange.suspected) {
    return { measurementTrusted: true };
  }
  return {
    measurementTrusted: false,
    accountWatch: {
      type: "watch",
      campaignId: "account",
      campaignName: "Account-wide signal",
      pattern: "conversion_denominator_step_change",
      message: `Suspected account-wide conversion-reporting shift: ${stepChange.reason}. Budget actions are held this cycle; verify the pixel/attribution window.`,
      checkBackDate: args.nextCycleDate,
    },
  };
}

/** Signal-health-critical short-circuit report (summary from current-period totals). */
export function buildSignalHealthCriticalReport(args: {
  accountId: string;
  dateRange: { since: string; until: string };
  totals: {
    totalSpend: number;
    totalLeads: number;
    totalRevenue: number;
    activeCampaigns: number;
  };
  signalHealthRecs: RecommendationOutput[];
}): AuditReport {
  const { totalSpend, totalLeads, totalRevenue, activeCampaigns } = args.totals;
  return buildMinimalReport({
    accountId: args.accountId,
    dateRange: args.dateRange,
    summary: {
      totalSpend,
      totalLeads,
      totalRevenue,
      overallROAS: safeDivide(totalRevenue, totalSpend),
      activeCampaigns,
      campaignsInLearning: 0,
      adSetsInLearning: 0,
      adSetsLearningLimited: 0,
    },
    recommendations: args.signalHealthRecs,
  });
}

/** Gate-0 coverage-insufficient abstention report (fully-zeroed summary + one insight). */
export function buildCoverageAbstentionReport(args: {
  accountId: string;
  dateRange: { since: string; until: string };
  coverageInsight: InsightOutput;
}): AuditReport {
  return buildMinimalReport({
    accountId: args.accountId,
    dateRange: args.dateRange,
    summary: {
      totalSpend: 0,
      totalLeads: 0,
      totalRevenue: 0,
      overallROAS: 0,
      activeCampaigns: 0,
      campaignsInLearning: 0,
      adSetsInLearning: 0,
      adSetsLearningLimited: 0,
    },
    insights: [args.coverageInsight],
  });
}
