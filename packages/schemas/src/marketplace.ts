import { z } from "zod";

// ── Enums ──

export const AgentType = z.enum(["open_source", "third_party", "switchboard_native"]);
export type AgentType = z.infer<typeof AgentType>;

export const AgentFamily = z.enum([
  "sales_pipeline",
  "paid_media",
  "organic_growth",
  "customer_experience",
]);
export type AgentFamily = z.infer<typeof AgentFamily>;

export const AgentListingStatus = z.enum(["pending_review", "listed", "suspended", "deprecated"]);
export type AgentListingStatus = z.infer<typeof AgentListingStatus>;

export const AutonomyLevel = z.enum(["supervised", "guided", "autonomous"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

export const PriceTier = z.enum(["free", "basic", "pro", "elite"]);
export type PriceTier = z.infer<typeof PriceTier>;

export const AgentTaskStatus = z.enum([
  "pending",
  "running",
  "completed",
  "awaiting_review",
  "approved",
  "rejected",
  "failed",
  "cancelled",
]);
export type AgentTaskStatus = z.infer<typeof AgentTaskStatus>;

export const DeploymentStatus = z.enum(["provisioning", "active", "paused", "deactivated"]);
export type DeploymentStatus = z.infer<typeof DeploymentStatus>;

// ── Agent Listing (global marketplace catalog) ──

export const AgentListingSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  type: AgentType,
  status: AgentListingStatus,
  taskCategories: z.array(z.string()),
  trustScore: z.number().min(0).max(100).default(0),
  autonomyLevel: AutonomyLevel.default("supervised"),
  priceTier: PriceTier.default("free"),
  priceMonthly: z.number().nonnegative().default(0),
  webhookUrl: z.string().url().nullable().optional(),
  webhookSecret: z.string().nullable().optional(),
  vettingNotes: z.string().nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AgentListing = z.infer<typeof AgentListingSchema>;

// ── Agent Deployment (founder's instance of a listing) ──

export const AgentDeploymentSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  listingId: z.string(),
  status: DeploymentStatus.default("provisioning"),
  inputConfig: z.record(z.unknown()).default({}),
  governanceSettings: z.record(z.unknown()).default({}),
  outputDestination: z.record(z.unknown()).nullable().optional(),
  connectionIds: z.array(z.string()).default([]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AgentDeployment = z.infer<typeof AgentDeploymentSchema>;

// ── Agent Task (unit of work) ──

export const AgentTaskSchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  organizationId: z.string(),
  listingId: z.string(),
  category: z.string(),
  status: AgentTaskStatus.default("pending"),
  input: z.record(z.unknown()).default({}),
  output: z.record(z.unknown()).nullable().optional(),
  acceptanceCriteria: z.string().nullable().optional(),
  reviewResult: z.string().nullable().optional(),
  reviewedBy: z.string().nullable().optional(),
  reviewedAt: z.coerce.date().nullable().optional(),
  completedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AgentTask = z.infer<typeof AgentTaskSchema>;

// ── Trust Score Record (per-listing per-category) ──

export const TrustScoreRecordSchema = z.object({
  id: z.string(),
  listingId: z.string(),
  taskCategory: z.string(),
  score: z.number().min(0).max(100),
  totalApprovals: z.number().int().nonnegative().default(0),
  totalRejections: z.number().int().nonnegative().default(0),
  consecutiveApprovals: z.number().int().nonnegative().default(0),
  lastActivityAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type TrustScoreRecord = z.infer<typeof TrustScoreRecordSchema>;

// --- Agent Action Request ---

export const AgentActionType = z.enum([
  "send_message",
  "browse_url",
  "read_file",
  "write_file",
  "api_call",
]);
export type AgentActionType = z.infer<typeof AgentActionType>;

export const AgentActionStatus = z.enum(["pending", "approved", "rejected", "executed", "blocked"]);
export type AgentActionStatus = z.infer<typeof AgentActionStatus>;

export const AgentActionRequestSchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  type: AgentActionType,
  surface: z.string(),
  payload: z.record(z.unknown()),
  status: AgentActionStatus.default("pending"),
  governanceResult: z.record(z.unknown()).nullable().optional(),
  reviewedBy: z.string().nullable().optional(),
  reviewedAt: z.coerce.date().nullable().optional(),
  executedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
});
export type AgentActionRequest = z.infer<typeof AgentActionRequestSchema>;

// --- Deployment State ---

export const DeploymentStateSchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  key: z.string(),
  value: z.unknown(),
  updatedAt: z.coerce.date(),
});
export type DeploymentState = z.infer<typeof DeploymentStateSchema>;

// --- Deployment Connection ---

export const ConnectionStatus = z.enum(["active", "expired", "revoked"]);
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;

export const DeploymentConnectionSchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  type: z.string(),
  slot: z.string().default("default"),
  status: ConnectionStatus,
  credentials: z.string(),
  metadata: z.record(z.unknown()).nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type DeploymentConnection = z.infer<typeof DeploymentConnectionSchema>;

// ── Website Scanner ──

export const ScannedBusinessProfileSchema = z.object({
  businessName: z.string(),
  description: z.string(),
  products: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      price: z.string().optional(),
    }),
  ),
  services: z.array(z.string()),
  location: z
    .object({
      address: z.string(),
      city: z.string(),
      state: z.string(),
    })
    .optional(),
  hours: z.record(z.string()).optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  faqs: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
    }),
  ),
  brandLanguage: z.array(z.string()),
  platformDetected: z.enum(["shopify", "wordpress", "wix", "squarespace", "custom"]).optional(),
});

export type ScannedBusinessProfile = z.infer<typeof ScannedBusinessProfileSchema>;

// ── Onboarding / Setup Schema ──

export const OnboardingConfigSchema = z.object({
  websiteScan: z.boolean().default(true),
  publicChannels: z.boolean().default(false),
  privateChannel: z.boolean().default(false),
  integrations: z.array(z.string()).default([]),
});

export type OnboardingConfig = z.infer<typeof OnboardingConfigSchema>;

export const SetupFieldSchema = z.object({
  key: z.string(),
  type: z.enum(["text", "textarea", "select", "url", "toggle"]),
  label: z.string(),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  default: z.string().optional(),
  prefillFrom: z.string().optional(),
});

export type SetupField = z.infer<typeof SetupFieldSchema>;

export const SetupStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  fields: z.array(SetupFieldSchema),
});

export type SetupStep = z.infer<typeof SetupStepSchema>;

export const SetupSchema = z.object({
  onboarding: OnboardingConfigSchema,
  steps: z.array(SetupStepSchema),
});

export type SetupSchemaType = z.infer<typeof SetupSchema>;

// ── Business Facts (Operator-Approved Structured Knowledge) ──

export const BusinessFactsSchema = z.object({
  businessName: z.string().min(1),
  timezone: z.string().default("Asia/Singapore"),
  locations: z
    .array(
      z.object({
        name: z.string().min(1),
        address: z.string().min(1),
        parkingNotes: z.string().optional(),
        accessNotes: z.string().optional(),
      }),
    )
    .min(1),
  openingHours: z.record(
    z.string(),
    z.object({
      open: z.string(),
      close: z.string(),
      closed: z.boolean().default(false),
    }),
  ),
  services: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        durationMinutes: z.number().int().positive().optional(),
        price: z.string().optional(),
        currency: z.string().default("SGD"),
      }),
    )
    .min(1),
  bookingPolicies: z
    .object({
      cancellationPolicy: z.string().optional(),
      reschedulePolicy: z.string().optional(),
      noShowPolicy: z.string().optional(),
      advanceBookingDays: z.number().int().positive().optional(),
      prepInstructions: z.string().optional(),
    })
    .optional(),
  escalationContact: z.object({
    name: z.string().min(1),
    channel: z.enum(["whatsapp", "telegram", "email", "sms"]),
    address: z.string().min(1),
  }),
  additionalFaqs: z
    .array(
      z.object({
        question: z.string().min(1),
        answer: z.string().min(1),
      }),
    )
    .default([]),
});

export type BusinessFacts = z.infer<typeof BusinessFactsSchema>;
