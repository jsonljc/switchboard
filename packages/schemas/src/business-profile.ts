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

export const FAQRecordSchema = z.object({
  /** Canonical question text */
  question: z.string().min(1),
  /** Alternative phrasings to match against */
  variants: z.array(z.string()).optional(),
  /** Approved answer text */
  answer: z.string().min(1),
  /** Topic domain (e.g. "pricing", "procedure", "aftercare") */
  topic: z.string().optional(),
  /** Whether this FAQ contains sensitive content requiring careful handling */
  sensitive: z.boolean().optional(),
});
export type FAQRecord = z.infer<typeof FAQRecordSchema>;

// ---------------------------------------------------------------------------
// Localisation & Conversation Config Sub-schemas
// ---------------------------------------------------------------------------

export const EmojiPolicySchema = z.object({
  allowed: z.boolean(),
  maxPerMessage: z.number().nonnegative().optional(),
  preferredSet: z.array(z.string()).optional(),
});
export type EmojiPolicy = z.infer<typeof EmojiPolicySchema>;

export const LocalisationConfigSchema = z.object({
  market: z.enum(["SG", "MY", "US", "UK", "AU", "generic"]),
  languages: z.array(z.string()).min(1),
  naturalness: z.enum(["formal", "semi_formal", "casual"]).optional(),
  tone: z.string().optional(),
  emoji: EmojiPolicySchema.optional(),
});
export type LocalisationConfig = z.infer<typeof LocalisationConfigSchema>;

export const OfferRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  validUntil: z.string().optional(),
  serviceIds: z.array(z.string()).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  discountAmount: z.number().nonnegative().optional(),
  conditions: z.string().optional(),
});
export type OfferRecord = z.infer<typeof OfferRecordSchema>;

export const BookingConfigSchema = z.object({
  bookingUrl: z.string().optional(),
  bookingPhone: z.string().optional(),
  requireDeposit: z.boolean().optional(),
  depositAmount: z.number().nonnegative().optional(),
  cancellationWindowHours: z.number().nonnegative().optional(),
  maxAdvanceBookingDays: z.number().positive().optional(),
});
export type BookingConfig = z.infer<typeof BookingConfigSchema>;

export const EscalationContactSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  channel: z.string().min(1),
  channelId: z.string().min(1),
  priority: z.number().optional(),
});
export type EscalationContact = z.infer<typeof EscalationContactSchema>;

export const EscalationConfigSchema = z.object({
  contacts: z.array(EscalationContactSchema).min(1),
  slaMinutes: z.number().positive().optional(),
  holdingMessage: z.string().optional(),
  autoEscalateAfterTurns: z.number().positive().optional(),
});
export type EscalationConfig = z.infer<typeof EscalationConfigSchema>;

export const LearningConfigSchema = z.object({
  enableAutoOptimisation: z.boolean().optional(),
  optimisationFrequency: z.enum(["daily", "weekly"]).optional(),
  autoApplyTimingChanges: z.boolean().optional(),
  requireOwnerApprovalForContent: z.boolean().optional(),
  minSampleSize: z.number().positive().optional(),
});
export type LearningConfig = z.infer<typeof LearningConfigSchema>;

export const QualificationSignalSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  question: z.string().optional(),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  mappedField: z.string().optional(),
});
export type QualificationSignal = z.infer<typeof QualificationSignalSchema>;

export const ConversationConfigSchema = z.object({
  flowMode: z.enum(["qualification", "booking", "faq_only", "hybrid"]).optional(),
  qualificationSignals: z.array(QualificationSignalSchema).optional(),
  maxTurnsBeforeEscalation: z.number().positive().optional(),
  silenceTimeoutMinutes: z.number().positive().optional(),
  reactivationWindowHours: z.number().positive().optional(),
});
export type ConversationConfig = z.infer<typeof ConversationConfigSchema>;

export const AgentPersonaSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  personality: z.string().optional(),
  greetingTemplate: z.string().optional(),
  signoffTemplate: z.string().optional(),
});
export type AgentPersona = z.infer<typeof AgentPersonaSchema>;

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
  faqs: z.array(FAQRecordSchema).optional(),
  llmContext: LLMContextSchema.optional(),

  // --- New fields for AI Agent System ---
  localisation: LocalisationConfigSchema.optional(),
  offers: z.array(OfferRecordSchema).optional(),
  booking: BookingConfigSchema.optional(),
  escalationConfig: EscalationConfigSchema.optional(),
  learningPreferences: LearningConfigSchema.optional(),
  conversationConfig: ConversationConfigSchema.optional(),
  persona: AgentPersonaSchema.optional(),
});
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;
