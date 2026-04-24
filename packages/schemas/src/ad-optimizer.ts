// packages/schemas/src/ad-optimizer.ts
import { z } from "zod";

// ── Enums ──

export const OutputTypeSchema = z.enum(["insight", "watch", "recommendation"]);
export type OutputTypeSchema = z.infer<typeof OutputTypeSchema>;

export const RecommendationActionSchema = z.enum([
  "scale",
  "kill",
  "refresh_creative",
  "restructure",
  "hold",
  "test",
  "review_budget",
]);
export type RecommendationActionSchema = z.infer<typeof RecommendationActionSchema>;

export const UrgencySchema = z.enum(["immediate", "this_week", "next_cycle"]);
export type UrgencySchema = z.infer<typeof UrgencySchema>;

export const MetricDirectionSchema = z.enum(["up", "down", "stable"]);
export type MetricDirectionSchema = z.infer<typeof MetricDirectionSchema>;

// ── Campaign & Ad Set Insights ──

export const CampaignInsightSchema = z.object({
  campaignId: z.string(),
  campaignName: z.string(),
  status: z.string(),
  effectiveStatus: z.string(),
  impressions: z.number(),
  clicks: z.number(),
  spend: z.number(),
  conversions: z.number(),
  revenue: z.number(),
  frequency: z.number(),
  cpm: z.number(),
  ctr: z.number(),
  cpc: z.number(),
  dateStart: z.string(),
  dateStop: z.string(),
});
export type CampaignInsightSchema = z.infer<typeof CampaignInsightSchema>;

export const AdSetInsightSchema = z.object({
  adSetId: z.string(),
  adSetName: z.string(),
  campaignId: z.string(),
  impressions: z.number(),
  clicks: z.number(),
  spend: z.number(),
  conversions: z.number(),
  frequency: z.number(),
  cpm: z.number(),
  ctr: z.number(),
  cpc: z.number(),
  dateStart: z.string(),
  dateStop: z.string(),
});
export type AdSetInsightSchema = z.infer<typeof AdSetInsightSchema>;

// ── Account Summary ──

export const AccountSummarySchema = z.object({
  accountId: z.string(),
  accountName: z.string(),
  currency: z.string(),
  totalSpend: z.number(),
  totalImpressions: z.number(),
  totalClicks: z.number(),
  activeCampaigns: z.number(),
});
export type AccountSummarySchema = z.infer<typeof AccountSummarySchema>;

// ── Funnel Analysis ──

export const FunnelStageSchema = z.object({
  name: z.string(),
  count: z.number(),
  rate: z.number(),
  benchmark: z.number(),
  delta: z.number(),
});
export type FunnelStageSchema = z.infer<typeof FunnelStageSchema>;

export const FunnelAnalysisSchema = z.object({
  stages: z.array(FunnelStageSchema),
  leakagePoint: z.string(),
  leakageMagnitude: z.number(),
});
export type FunnelAnalysisSchema = z.infer<typeof FunnelAnalysisSchema>;

// ── Metric Delta ──

export const MetricDeltaSchema = z.object({
  metric: z.string(),
  current: z.number(),
  previous: z.number(),
  deltaPercent: z.number(),
  direction: MetricDirectionSchema,
  significant: z.boolean(),
});
export type MetricDeltaSchema = z.infer<typeof MetricDeltaSchema>;

// ── Learning Phase Status ──

export const LearningPhaseStatusSchema = z.object({
  campaignId: z.string(),
  inLearning: z.boolean(),
  daysSinceChange: z.number(),
  eventsAccumulated: z.number(),
  eventsRequired: z.number(),
  estimatedExitDate: z.coerce.date().nullable(),
});
export type LearningPhaseStatusSchema = z.infer<typeof LearningPhaseStatusSchema>;

// ── CAPI Event ──

export const CAPIEventSchema = z.object({
  eventName: z.enum(["Lead", "Purchase"]),
  eventTime: z.number(),
  userData: z.object({
    fbclid: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
  }),
  customData: z
    .object({
      value: z.number().optional(),
      currency: z.string().optional(),
    })
    .optional(),
});
export type CAPIEventSchema = z.infer<typeof CAPIEventSchema>;

// ── Output Types ──

export const InsightOutputSchema = z.object({
  type: z.literal("insight"),
  campaignId: z.string(),
  campaignName: z.string(),
  message: z.string(),
  category: z.string(),
});
export type InsightOutputSchema = z.infer<typeof InsightOutputSchema>;

export const WatchOutputSchema = z.object({
  type: z.literal("watch"),
  campaignId: z.string(),
  campaignName: z.string(),
  pattern: z.string(),
  message: z.string(),
  checkBackDate: z.string(),
});
export type WatchOutputSchema = z.infer<typeof WatchOutputSchema>;

export const RecommendationOutputSchema = z.object({
  type: z.literal("recommendation"),
  action: RecommendationActionSchema,
  campaignId: z.string(),
  campaignName: z.string(),
  confidence: z.number().min(0).max(1),
  urgency: UrgencySchema,
  estimatedImpact: z.string(),
  steps: z.array(z.string()),
  learningPhaseImpact: z.string(),
  draftId: z.string().nullable().optional(),
});
export type RecommendationOutputSchema = z.infer<typeof RecommendationOutputSchema>;

// ── Audit Report ──

export const AuditReportSchema = z.object({
  accountId: z.string(),
  dateRange: z.object({
    since: z.string(),
    until: z.string(),
  }),
  summary: z.object({
    totalSpend: z.number(),
    totalLeads: z.number(),
    totalRevenue: z.number(),
    overallROAS: z.number(),
    activeCampaigns: z.number(),
    campaignsInLearning: z.number(),
  }),
  funnel: FunnelAnalysisSchema,
  periodDeltas: z.array(MetricDeltaSchema),
  insights: z.array(InsightOutputSchema),
  watches: z.array(WatchOutputSchema),
  recommendations: z.array(RecommendationOutputSchema),
});
export type AuditReportSchema = z.infer<typeof AuditReportSchema>;
