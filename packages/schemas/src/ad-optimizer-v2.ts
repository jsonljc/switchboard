// packages/schemas/src/ad-optimizer-v2.ts
import { z } from "zod";
import { FunnelShapeSchema, LearningPhaseStatusSchema } from "./ad-optimizer.js";

// ── Metric Snapshot ──

export const MetricSnapshotSchema = z.object({
  cpm: z.number(),
  ctr: z.number(),
  cpc: z.number(),
  cpl: z.number(),
  cpa: z.number(),
  roas: z.number(),
});
export type MetricSnapshotSchema = z.infer<typeof MetricSnapshotSchema>;

// ── Trend Tier ──

export const TrendTierSchema = z.enum(["alert", "confirmed", "stable"]);
export type TrendTierSchema = z.infer<typeof TrendTierSchema>;

// ── Weekly Snapshot ──

export const WeeklySnapshotSchema = z.object({
  weekStart: z.string(),
  weekEnd: z.string(),
  metrics: MetricSnapshotSchema,
});
export type WeeklySnapshotSchema = z.infer<typeof WeeklySnapshotSchema>;

// ── Metric Trend ──

export const MetricTrendSchema = z.object({
  metric: z.string(),
  direction: z.enum(["rising", "falling", "stable"]),
  consecutiveWeeks: z.number(),
  tier: TrendTierSchema,
  projectedBreachWeeks: z.number().nullable(),
});
export type MetricTrendSchema = z.infer<typeof MetricTrendSchema>;

// ── Trend Analysis ──

export const TrendAnalysisSchema = z.object({
  rollingAverages: z.object({
    day30: MetricSnapshotSchema,
    day60: MetricSnapshotSchema,
    day90: MetricSnapshotSchema,
  }),
  weeklySnapshots: z.array(WeeklySnapshotSchema),
  trends: z.array(MetricTrendSchema),
});
export type TrendAnalysisSchema = z.infer<typeof TrendAnalysisSchema>;

// ── Campaign Budget Entry ──

export const CampaignBudgetEntrySchema = z.object({
  campaignId: z.string(),
  campaignName: z.string(),
  spendShare: z.number(),
  spend: z.number(),
  cpa: z.number(),
  roas: z.number(),
  isCbo: z.boolean(),
  dailyBudget: z.number().nullable(),
  lifetimeBudget: z.number().nullable(),
  spendCap: z.number().nullable(),
  objective: z.string(),
});
export type CampaignBudgetEntrySchema = z.infer<typeof CampaignBudgetEntrySchema>;

// ── Budget Imbalance ──

export const BudgetImbalanceSchema = z.object({
  type: z.enum(["overspending_underperformer", "underspending_winner"]),
  campaignId: z.string(),
  campaignName: z.string(),
  spendShare: z.number(),
  metric: z.string(),
  value: z.number(),
  message: z.string(),
});
export type BudgetImbalanceSchema = z.infer<typeof BudgetImbalanceSchema>;

// ── Budget Analysis ──

export const BudgetAnalysisSchema = z.object({
  entries: z.array(CampaignBudgetEntrySchema),
  imbalances: z.array(BudgetImbalanceSchema),
  accountSpendCap: z.number().nullable(),
  currency: z.string(),
});
export type BudgetAnalysisSchema = z.infer<typeof BudgetAnalysisSchema>;

// ── Creative Entry ──

export const CreativeEntrySchema = z.object({
  creativeKey: z.string(),
  keyType: z.enum(["image_hash", "video_id"]),
  adIds: z.array(z.string()),
  spend: z.number(),
  spendShare: z.number(),
  impressions: z.number(),
  clicks: z.number(),
  ctr: z.number(),
  cpc: z.number(),
  cpa: z.number(),
  roas: z.number(),
  conversions: z.number(),
  thumbStopRatio: z.number().nullable(),
  qualityRanking: z.string().nullable(),
  engagementRateRanking: z.string().nullable(),
  conversionRateRanking: z.string().nullable(),
});
export type CreativeEntrySchema = z.infer<typeof CreativeEntrySchema>;

// ── Creative Diagnosis ──

export const CreativeDiagnosisSchema = z.object({
  creativeKey: z.string(),
  pattern: z.enum([
    "creative_fatigue",
    "creative_limited",
    "spend_concentration",
    "underperforming_outlier",
  ]),
  severity: z.enum(["warning", "error"]),
  message: z.string(),
});
export type CreativeDiagnosisSchema = z.infer<typeof CreativeDiagnosisSchema>;

// ── Creative Analysis ──

export const CreativeAnalysisSchema = z.object({
  campaignId: z.string(),
  entries: z.array(CreativeEntrySchema),
  diagnoses: z.array(CreativeDiagnosisSchema),
});
export type CreativeAnalysisSchema = z.infer<typeof CreativeAnalysisSchema>;

// ── Ad Set Detail ──

export const AdSetDetailSchema = z.object({
  adSetId: z.string(),
  adSetName: z.string(),
  campaignId: z.string(),
  destinationType: z.string(),
  funnelShape: FunnelShapeSchema,
  frequency: z.number(),
  learningStatus: LearningPhaseStatusSchema,
  hasFrequencyCap: z.boolean(),
});
export type AdSetDetailSchema = z.infer<typeof AdSetDetailSchema>;

// ── Saturation Signal ──

export const SaturationSignalSchema = z.object({
  adSetId: z.string(),
  pattern: z.enum(["audience_saturation", "creative_fatigue", "campaign_decay"]),
  confidence: z.enum(["high", "medium", "low"]),
  signals: z.array(z.string()),
  audienceReachedRatio: z.number().nullable(),
  conversionRateDecline: z.number().nullable(),
});
export type SaturationSignalSchema = z.infer<typeof SaturationSignalSchema>;
