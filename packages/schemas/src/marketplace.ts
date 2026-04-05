import { z } from "zod";

// ── Enums ──

export const AgentType = z.enum(["open_source", "third_party", "switchboard_native"]);
export type AgentType = z.infer<typeof AgentType>;

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
  trustScore: z.number().min(0).max(100).default(50),
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
