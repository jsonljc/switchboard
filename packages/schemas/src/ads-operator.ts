import { z } from "zod";

// ---------------------------------------------------------------------------
// Ads Operator Config — per-business agent configuration
// ---------------------------------------------------------------------------
// Controls which ad accounts are managed, what level of autonomy the agents
// have, performance targets, scheduling, and notification delivery.
// ---------------------------------------------------------------------------

export const AutomationLevelSchema = z.enum(["copilot", "supervised", "autonomous"]);
export type AutomationLevel = z.infer<typeof AutomationLevelSchema>;

export const AdsOperatorTargetsSchema = z.object({
  cpa: z.number().positive().optional(),
  roas: z.number().positive().optional(),
  dailyBudgetCap: z.number().nonnegative().optional(),
});
export type AdsOperatorTargets = z.infer<typeof AdsOperatorTargetsSchema>;

export const AdsOperatorScheduleSchema = z.object({
  optimizerCronHour: z.number().int().min(0).max(23),
  reportCronHour: z.number().int().min(0).max(23),
  /** Day of week for Strategist Agent (0=Sunday, 1=Monday, ..., 6=Saturday). Defaults to 1 (Monday). */
  strategistCronDay: z.number().int().min(0).max(6).optional(),
  timezone: z.string(),
});
export type AdsOperatorSchedule = z.infer<typeof AdsOperatorScheduleSchema>;

export const NotificationChannelSchema = z.object({
  type: z.enum(["telegram", "slack", "whatsapp"]),
  chatId: z.string().min(1),
});
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const PlatformTypeSchema = z.enum(["meta", "google", "tiktok"]);
export type PlatformType = z.infer<typeof PlatformTypeSchema>;

export const AdsOperatorConfigSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  adAccountIds: z.array(z.string().min(1)).min(1),
  platforms: z.array(PlatformTypeSchema).min(1),
  automationLevel: AutomationLevelSchema,
  targets: AdsOperatorTargetsSchema,
  schedule: AdsOperatorScheduleSchema,
  notificationChannel: NotificationChannelSchema,
  principalId: z.string().min(1),
  active: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type AdsOperatorConfig = z.infer<typeof AdsOperatorConfigSchema>;
