// ---------------------------------------------------------------------------
// Business Profile Schema — per-business knowledge for profile-driven agents
// ---------------------------------------------------------------------------

import { z } from "zod";

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

export const BusinessInfoSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  tagline: z.string().optional(),
  website: z.string().url().optional(),
  phone: z.string().optional(),
  timezone: z.string().optional(),
});
export type BusinessInfo = z.infer<typeof BusinessInfoSchema>;

export const ServiceCatalogItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  typicalValue: z.number().nonnegative().optional(),
  durationMinutes: z.number().nonnegative().optional(),
});
export type ServiceCatalogItem = z.infer<typeof ServiceCatalogItemSchema>;

export const ServicesSchema = z.object({
  catalog: z.array(ServiceCatalogItemSchema).min(1),
  /** Service-to-service affinity matrix: serviceId -> serviceId -> affinity (0-1). */
  affinityMatrix: z.record(z.string(), z.record(z.string(), z.number())).optional(),
});
export type Services = z.infer<typeof ServicesSchema>;

export const TeamMemberSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  specialties: z.array(z.string()).optional(),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

export const JourneyStageDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  metric: z.string().min(1),
  terminal: z.boolean(),
});
export type JourneyStageDef = z.infer<typeof JourneyStageDefSchema>;

export const JourneyDefSchema = z.object({
  stages: z.array(JourneyStageDefSchema).min(1),
  primaryKPI: z.string().min(1),
});
export type JourneyDef = z.infer<typeof JourneyDefSchema>;

export const ScoringConfigSchema = z.object({
  referralValue: z.number().nonnegative().optional(),
  noShowCost: z.number().nonnegative().optional(),
  retentionDecayRate: z.number().min(0).max(1).optional(),
  projectionYears: z.number().positive().optional(),
  leadScoreWeights: z
    .object({
      serviceValue: z.number().optional(),
      urgency: z.number().optional(),
      eventDriven: z.number().optional(),
      budget: z.number().optional(),
      engagement: z.number().optional(),
      responseSpeed: z.number().optional(),
      source: z.number().optional(),
      returning: z.number().optional(),
    })
    .optional(),
});
export type ScoringConfig = z.infer<typeof ScoringConfigSchema>;

export const ObjectionTreeEntrySchema = z.object({
  category: z.string().min(1),
  keywords: z.array(z.string()).min(1),
  response: z.string().min(1),
  followUp: z.string().min(1),
});
export type ObjectionTreeEntry = z.infer<typeof ObjectionTreeEntrySchema>;

export const CadenceStepDefSchema = z.object({
  actionType: z.string().min(1),
  delayMs: z.number(),
  messageTemplate: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  condition: z
    .object({
      variable: z.string(),
      operator: z.enum(["eq", "neq", "gt", "lt", "gte", "lte"]),
      value: z.unknown(),
    })
    .optional(),
});
export type CadenceStepDef = z.infer<typeof CadenceStepDefSchema>;

export const CadenceTemplateDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  trigger: z.string().min(1),
  steps: z.array(CadenceStepDefSchema).min(1),
});
export type CadenceTemplateDef = z.infer<typeof CadenceTemplateDefSchema>;

export const ComplianceConfigSchema = z.object({
  enableHipaaRedactor: z.boolean().optional(),
  enableMedicalClaimFilter: z.boolean().optional(),
  enableConsentGate: z.boolean().optional(),
});
export type ComplianceConfig = z.infer<typeof ComplianceConfigSchema>;

export const HoursEntrySchema = z.object({
  open: z.string(),
  close: z.string(),
});
export type HoursEntry = z.infer<typeof HoursEntrySchema>;

export const PolicyEntrySchema = z.object({
  topic: z.string().min(1),
  content: z.string().min(1),
});
export type PolicyEntry = z.infer<typeof PolicyEntrySchema>;

export const LLMContextSchema = z.object({
  systemPromptExtension: z.string().optional(),
  persona: z.string().optional(),
  tone: z.string().optional(),
  bannedTopics: z.array(z.string()).optional(),
});
export type LLMContext = z.infer<typeof LLMContextSchema>;

// ---------------------------------------------------------------------------
// Root Schema
// ---------------------------------------------------------------------------

export const BusinessProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string(),

  business: BusinessInfoSchema,
  services: ServicesSchema,
  team: z.array(TeamMemberSchema).optional(),

  journey: JourneyDefSchema,

  scoring: ScoringConfigSchema.optional(),
  objectionTrees: z.array(ObjectionTreeEntrySchema).optional(),
  cadenceTemplates: z.array(CadenceTemplateDefSchema).optional(),
  compliance: ComplianceConfigSchema.optional(),
  reviewPlatforms: z.array(z.string()).optional(),
  hours: z.record(z.string(), HoursEntrySchema).optional(),
  policies: z.array(PolicyEntrySchema).optional(),
  llmContext: LLMContextSchema.optional(),
});
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;
