import { z } from "zod";

export const GovernanceProfileNameSchema = z.enum(["observe", "guarded", "strict", "locked"]);
export type GovernanceProfileName = z.infer<typeof GovernanceProfileNameSchema>;

export const SkinToolsSchema = z.object({
  /** Glob patterns for action types to include (e.g. "customer-engagement.*"). */
  include: z.array(z.string()).min(1),
  /** Glob patterns for action types to exclude. */
  exclude: z.array(z.string()).optional(),
  /** Alias map: alias name → canonical actionType. */
  aliases: z.record(z.string(), z.string()).optional(),
});
export type SkinTools = z.infer<typeof SkinToolsSchema>;

export const SkinSpendLimitsSchema = z.object({
  dailyUsd: z.number().nonnegative().optional(),
  weeklyUsd: z.number().nonnegative().optional(),
  monthlyUsd: z.number().nonnegative().optional(),
});
export type SkinSpendLimits = z.infer<typeof SkinSpendLimitsSchema>;

export const SkinApprovalRoutingSchema = z.object({
  defaultApprovers: z.array(z.string()).optional(),
  channelPreference: z.enum(["whatsapp", "telegram", "slack", "email"]).optional(),
});
export type SkinApprovalRouting = z.infer<typeof SkinApprovalRoutingSchema>;

export const SkinGovernanceSchema = z.object({
  /** Base governance profile for the skin. */
  profile: GovernanceProfileNameSchema,
  /** Skin-default policy rules (injected at priority 9000+). */
  policyOverrides: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        rule: z.record(z.string(), z.unknown()),
        effect: z.enum(["allow", "deny", "modify", "require_approval"]),
        effectParams: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
  spendLimits: SkinSpendLimitsSchema.optional(),
  approvalRouting: SkinApprovalRoutingSchema.optional(),
});
export type SkinGovernance = z.infer<typeof SkinGovernanceSchema>;

export const SkinLanguageSchema = z.object({
  locale: z.string(),
  /** System prompt override for LLM interpreter. */
  interpreterSystemPrompt: z.string().optional(),
  /** Keyed by template ID. */
  replyTemplates: z.record(z.string(), z.string()).optional(),
  /** Terminology substitutions (e.g. "campaign" → "treatment plan"). */
  terminology: z.record(z.string(), z.string()).optional(),
  /** Welcome message sent on first contact. Supports {{businessName}} substitution. */
  welcomeMessage: z.string().optional(),
});
export type SkinLanguage = z.infer<typeof SkinLanguageSchema>;

export const SkinPlaybookStepSchema = z.object({
  actionType: z.string(),
  parameterDefaults: z.record(z.string(), z.unknown()).optional(),
});
export type SkinPlaybookStep = z.infer<typeof SkinPlaybookStepSchema>;

export const SkinPlaybookSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Natural language trigger pattern. */
  trigger: z.string(),
  steps: z.array(SkinPlaybookStepSchema).min(1).max(10),
});
export type SkinPlaybook = z.infer<typeof SkinPlaybookSchema>;

export const SkinChannelsSchema = z.object({
  primary: z.enum(["whatsapp", "telegram", "slack"]).optional(),
  enabled: z.array(z.string()).optional(),
});
export type SkinChannels = z.infer<typeof SkinChannelsSchema>;

export const SkinCampaignTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  service: z.string(),
  objective: z.enum(["awareness", "traffic", "leads", "conversions", "engagement"]),
  suggestedDailyBudget: z.number().nonnegative().optional(),
  targetingHints: z.array(z.string()).optional(),
  creativeAngles: z.array(z.string()).optional(),
});
export type SkinCampaignTemplate = z.infer<typeof SkinCampaignTemplateSchema>;

export const SkinManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string(),
  description: z.string(),

  tools: SkinToolsSchema,
  governance: SkinGovernanceSchema,
  language: SkinLanguageSchema,

  /** Funnel mode: determines ad optimization strategy. */
  funnelMode: z.enum(["lead_gen", "conversions", "awareness"]).optional(),
  /** Hint for auto-detecting funnel mode during onboarding. */
  funnelModeHint: z.string().optional(),
  /** Channel for lead responses (null = no speed-to-lead). */
  leadChannel: z.enum(["telegram", "whatsapp", "slack"]).nullable().optional(),

  playbooks: z.array(SkinPlaybookSchema).optional(),
  requiredCartridges: z.array(z.string()).min(1),
  channels: SkinChannelsSchema.optional(),

  /** Pre-built campaign templates for common services. */
  campaignTemplates: z.array(SkinCampaignTemplateSchema).optional(),
  /** Conversion event → dollar value mapping ("dynamic" for ROAS-based). */
  conversionValueMap: z.record(z.string(), z.union([z.number(), z.string()])).optional(),

  /** Vertical-specific stage definitions (keys are opportunity stage names). */
  stageDefinitions: z
    .record(
      z.string(),
      z.object({
        label: z.string(),
        criteria: z.string(),
        typicalDuration: z.string().optional(),
      }),
    )
    .optional(),
  /** Days of inactivity before marking contact dormant. */
  dormancyThresholdDays: z.number().int().positive().optional(),
  /** Days within which a dormant contact can be re-opened. */
  reopenWindowDays: z.number().int().positive().optional(),
  /** Fallback SLA rules (keys are task priority levels). */
  fallbackSLA: z
    .record(
      z.string(),
      z.object({
        dueDurationHours: z.number().positive(),
      }),
    )
    .optional(),

  /** Arbitrary skin-specific configuration (e.g. bannedPhrases, bookingUrl). */
  config: z.record(z.string(), z.unknown()).optional(),
});
export type SkinManifest = z.infer<typeof SkinManifestSchema>;
