import { z } from "zod";

export const ContentDraftParamsSchema = z.object({
  content: z.string(),
  channel: z.enum(["linkedin", "twitter", "instagram", "facebook", "email", "blog"]),
  format: z.enum(["post", "newsletter", "article", "ad_copy", "presentation_outline"]),
  topic: z.string().optional(),
  brief: z.string().optional(),
});
export type ContentDraftParams = z.infer<typeof ContentDraftParamsSchema>;

export const ContentReviseParamsSchema = z.object({
  content: z.string(),
  originalDraftId: z.string(),
  feedback: z.string().optional(),
});
export type ContentReviseParams = z.infer<typeof ContentReviseParamsSchema>;

export const ContentPublishParamsSchema = z.object({
  draftId: z.string(),
  channel: z.string(),
  scheduledFor: z.string().datetime().optional(),
});
export type ContentPublishParams = z.infer<typeof ContentPublishParamsSchema>;

export const CalendarPlanParamsSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  channels: z.array(z.string()),
  postsPerWeek: z.number().int().min(1).max(30).optional(),
});
export type CalendarPlanParams = z.infer<typeof CalendarPlanParamsSchema>;

export const CalendarScheduleParamsSchema = z.object({
  channel: z.string(),
  topic: z.string(),
  scheduledFor: z.string().datetime(),
  draftId: z.string().optional(),
});
export type CalendarScheduleParams = z.infer<typeof CalendarScheduleParamsSchema>;

export const CompetitorAnalyzeParamsSchema = z.object({
  competitorUrl: z.string().url().optional(),
  competitorName: z.string().optional(),
  channel: z.string().optional(),
  topic: z.string().optional(),
});
export type CompetitorAnalyzeParams = z.infer<typeof CompetitorAnalyzeParamsSchema>;

export const PerformanceReportParamsSchema = z.object({
  period: z.enum(["week", "month", "quarter"]),
  channels: z.array(z.string()).optional(),
});
export type PerformanceReportParams = z.infer<typeof PerformanceReportParamsSchema>;
