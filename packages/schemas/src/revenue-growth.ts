// ---------------------------------------------------------------------------
// Revenue Growth Cartridge — Shared Zod Schemas
// ---------------------------------------------------------------------------

import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const DataConfidenceTierSchema = z.enum(["FULL", "PARTIAL", "SPARSE"]);
export type DataConfidenceTier = z.infer<typeof DataConfidenceTierSchema>;

export const ConstraintTypeSchema = z.enum([
  "SIGNAL",
  "CREATIVE",
  "FUNNEL",
  "SALES",
  "SATURATION",
  "OFFER",
  "CAPACITY",
]);
export type ConstraintType = z.infer<typeof ConstraintTypeSchema>;

export const ConfidenceLevelSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

export const ActionTypeSchema = z.enum([
  "FIX_TRACKING",
  "REFRESH_CREATIVE",
  "OPTIMIZE_FUNNEL",
  "IMPROVE_SALES_PROCESS",
  "EXPAND_AUDIENCE",
  "REVISE_OFFER",
  "SCALE_CAPACITY",
]);
export type RevGrowthActionType = z.infer<typeof ActionTypeSchema>;

export const ImpactTierSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type ImpactTier = z.infer<typeof ImpactTierSchema>;

export const GovernanceStatusSchema = z.enum([
  "PROPOSED",
  "APPROVED",
  "EXECUTING",
  "EXECUTED",
  "DEFERRED",
  "REJECTED",
]);
export type GovernanceStatus = z.infer<typeof GovernanceStatusSchema>;

export const OutcomeStatusSchema = z.enum([
  "PENDING",
  "MEASURING",
  "IMPROVED",
  "NO_CHANGE",
  "REGRESSED",
  "INCONCLUSIVE",
]);
export type OutcomeStatus = z.infer<typeof OutcomeStatusSchema>;

// ---------------------------------------------------------------------------
// Scorer Output — Shared interface for all 5 scorers
// ---------------------------------------------------------------------------

export const ScorerIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["critical", "warning", "info"]),
  message: z.string(),
  metric: z.string().optional(),
  currentValue: z.number().optional(),
  threshold: z.number().optional(),
});
export type ScorerIssue = z.infer<typeof ScorerIssueSchema>;

export const ScorerOutputSchema = z.object({
  scorerName: z.string(),
  score: z.number().min(0).max(100),
  confidence: ConfidenceLevelSchema,
  issues: z.array(ScorerIssueSchema),
  breakdown: z.record(z.string(), z.number()).optional(),
  computedAt: z.string().datetime(),
});
export type ScorerOutput = z.infer<typeof ScorerOutputSchema>;

// ---------------------------------------------------------------------------
// Constraint — Output of the constraint engine
// ---------------------------------------------------------------------------

export const ConstraintSchema = z.object({
  type: ConstraintTypeSchema,
  score: z.number().min(0).max(100),
  confidence: ConfidenceLevelSchema,
  isPrimary: z.boolean(),
  scorerOutput: ScorerOutputSchema,
  reason: z.string(),
});
export type Constraint = z.infer<typeof ConstraintSchema>;

// ---------------------------------------------------------------------------
// Action Artifact — LLM-generated deliverable for an intervention
// ---------------------------------------------------------------------------

export const ActionArtifactSchema = z.object({
  type: z.enum(["brief", "checklist", "template", "report"]),
  title: z.string(),
  content: z.string(),
  generatedAt: z.string().datetime(),
});
export type ActionArtifact = z.infer<typeof ActionArtifactSchema>;

// ---------------------------------------------------------------------------
// Intervention — A proposed action tied to a constraint
// ---------------------------------------------------------------------------

export const InterventionSchema = z.object({
  id: z.string(),
  cycleId: z.string(),
  constraintType: ConstraintTypeSchema,
  actionType: ActionTypeSchema,
  status: GovernanceStatusSchema,
  priority: z.number().int().min(1),
  estimatedImpact: ImpactTierSchema,
  reasoning: z.string(),
  artifacts: z.array(ActionArtifactSchema),
  outcomeStatus: OutcomeStatusSchema,
  measurementWindowDays: z.number().int().positive().optional(),
  measurementStartedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Intervention = z.infer<typeof InterventionSchema>;

// ---------------------------------------------------------------------------
// Diagnostic Cycle — One full run of the constraint engine
// ---------------------------------------------------------------------------

export const DiagnosticCycleSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  organizationId: z.string(),
  dataTier: DataConfidenceTierSchema,
  scorerOutputs: z.array(ScorerOutputSchema),
  constraints: z.array(ConstraintSchema),
  primaryConstraint: ConstraintTypeSchema.nullable(),
  previousPrimaryConstraint: ConstraintTypeSchema.nullable(),
  constraintTransition: z.boolean(),
  interventions: z.array(InterventionSchema),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type DiagnosticCycle = z.infer<typeof DiagnosticCycleSchema>;

// ---------------------------------------------------------------------------
// Normalized Data — Unified schema for ad + CRM + signal data
// ---------------------------------------------------------------------------

export const AdMetricsSchema = z.object({
  impressions: z.number().nonnegative(),
  clicks: z.number().nonnegative(),
  spend: z.number().nonnegative(),
  conversions: z.number().nonnegative(),
  revenue: z.number().nonnegative().nullable(),
  ctr: z.number().nonnegative(),
  cpc: z.number().nonnegative().nullable(),
  cpa: z.number().nonnegative().nullable(),
  roas: z.number().nullable(),
  frequency: z.number().nonnegative().nullable(),
});
export type AdMetrics = z.infer<typeof AdMetricsSchema>;

export const FunnelEventSchema = z.object({
  stageName: z.string(),
  count: z.number().nonnegative(),
  previousCount: z.number().nonnegative().nullable(),
  conversionRate: z.number().min(0).max(1).nullable(),
});
export type FunnelEvent = z.infer<typeof FunnelEventSchema>;

export const CreativeAssetSummarySchema = z.object({
  totalAssets: z.number().nonnegative(),
  activeAssets: z.number().nonnegative(),
  averageScore: z.number().min(0).max(100).nullable(),
  fatigueRate: z.number().min(0).max(1).nullable(),
  topPerformerCount: z.number().nonnegative(),
  bottomPerformerCount: z.number().nonnegative(),
  diversityScore: z.number().min(0).max(100).nullable(),
});
export type CreativeAssetSummary = z.infer<typeof CreativeAssetSummarySchema>;

export const CrmSummarySchema = z.object({
  totalLeads: z.number().nonnegative(),
  matchedLeads: z.number().nonnegative(),
  matchRate: z.number().min(0).max(1),
  openDeals: z.number().nonnegative(),
  averageDealValue: z.number().nonnegative().nullable(),
  averageTimeToFirstContact: z.number().nonnegative().nullable(),
  leadToCloseRate: z.number().min(0).max(1).nullable(),
  /** Stage conversion rates (e.g., lead→qualified, qualified→proposal, proposal→closed) */
  stageConversionRates: z.record(z.string(), z.number().min(0).max(1)).nullable(),
  /** Average days to close a deal */
  averageDaysToClose: z.number().nonnegative().nullable(),
  /** Number of leads attributed to ads (via sourceAdId) */
  adAttributedLeads: z.number().nonnegative().nullable(),
  /** Percentage of deals with follow-up within 24h */
  followUpWithin24hRate: z.number().min(0).max(1).nullable(),
});
export type CrmSummary = z.infer<typeof CrmSummarySchema>;

export const SignalHealthSummarySchema = z.object({
  pixelActive: z.boolean(),
  capiConfigured: z.boolean(),
  eventMatchQuality: z.number().min(0).max(10).nullable(),
  eventCompleteness: z.number().min(0).max(1),
  deduplicationRate: z.number().min(0).max(1).nullable(),
  conversionLagHours: z.number().nonnegative().nullable(),
});
export type SignalHealthSummary = z.infer<typeof SignalHealthSummarySchema>;

export const HeadroomSummarySchema = z.object({
  currentDailySpend: z.number().nonnegative(),
  recommendedDailySpend: z.number().nonnegative(),
  headroomPercent: z.number(),
  confidence: ConfidenceLevelSchema,
  rSquared: z.number().min(0).max(1),
  caveats: z.array(z.string()),
});
export type HeadroomSummary = z.infer<typeof HeadroomSummarySchema>;

export const NormalizedDataSchema = z.object({
  accountId: z.string(),
  organizationId: z.string(),
  collectedAt: z.string().datetime(),
  dataTier: DataConfidenceTierSchema,
  adMetrics: AdMetricsSchema.nullable(),
  funnelEvents: z.array(FunnelEventSchema),
  creativeAssets: CreativeAssetSummarySchema.nullable(),
  crmSummary: CrmSummarySchema.nullable(),
  signalHealth: SignalHealthSummarySchema.nullable(),
  headroom: HeadroomSummarySchema.nullable(),
});
export type NormalizedData = z.infer<typeof NormalizedDataSchema>;

// ---------------------------------------------------------------------------
// Connector Health — Status of data source connections
// ---------------------------------------------------------------------------

export const ConnectorStatusSchema = z.enum(["connected", "degraded", "disconnected"]);
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;

export const ConnectorHealthSchema = z.object({
  connectorId: z.string(),
  name: z.string(),
  status: ConnectorStatusSchema,
  lastSyncAt: z.string().datetime().nullable(),
  matchRate: z.number().min(0).max(1).nullable(),
  errorMessage: z.string().nullable(),
});
export type ConnectorHealth = z.infer<typeof ConnectorHealthSchema>;

// ---------------------------------------------------------------------------
// Diagnostic Run Input/Output — API-level request/response
// ---------------------------------------------------------------------------

export const DiagnosticRunInputSchema = z.object({
  accountId: z.string(),
  organizationId: z.string(),
  principalId: z.string(),
  /** Optional: force a specific set of scorers to run */
  scorers: z.array(z.string()).optional(),
});
export type DiagnosticRunInput = z.infer<typeof DiagnosticRunInputSchema>;

export const DiagnosticRunOutputSchema = z.object({
  cycleId: z.string(),
  accountId: z.string(),
  dataTier: DataConfidenceTierSchema,
  scorerOutputs: z.array(ScorerOutputSchema),
  primaryConstraint: ConstraintSchema.nullable(),
  secondaryConstraints: z.array(ConstraintSchema),
  interventions: z.array(InterventionSchema),
  constraintTransition: z.boolean(),
  completedAt: z.string().datetime(),
});
export type DiagnosticRunOutput = z.infer<typeof DiagnosticRunOutputSchema>;

// ---------------------------------------------------------------------------
// Weekly Digest — LLM-backed summary of diagnostic history
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Escalation — Escalation level for constraint-based interventions
// ---------------------------------------------------------------------------

export const EscalationLevelSchema = z.enum(["INFO", "WARN", "ESCALATE", "CRITICAL"]);
export type EscalationLevel = z.infer<typeof EscalationLevelSchema>;

export const EscalationResultSchema = z.object({
  level: EscalationLevelSchema,
  constraintType: ConstraintTypeSchema,
  cycleCount: z.number().int().nonnegative(),
  score: z.number().min(0).max(100),
  reason: z.string(),
});
export type EscalationResult = z.infer<typeof EscalationResultSchema>;

// ---------------------------------------------------------------------------
// Account Learning Profile — Per-account learning state
// ---------------------------------------------------------------------------

export const CreativePatternSchema = z.object({
  format: z.string(),
  hookType: z.string().optional(),
  performanceScore: z.number().min(0).max(100),
  sampleSize: z.number().int().nonnegative(),
});
export type CreativePattern = z.infer<typeof CreativePatternSchema>;

export const ConstraintHistoryEntrySchema = z.object({
  constraintType: ConstraintTypeSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  cycleCount: z.number().int().positive(),
});
export type ConstraintHistoryEntry = z.infer<typeof ConstraintHistoryEntrySchema>;

export const AccountLearningProfileSchema = z.object({
  accountId: z.string(),
  organizationId: z.string(),
  creativePatterns: z.array(CreativePatternSchema),
  constraintHistory: z.array(ConstraintHistoryEntrySchema),
  calibration: z.record(
    z.string(),
    z.object({
      successRate: z.number().min(0).max(1),
      avgImprovement: z.number().nonnegative(),
      totalCount: z.number().int().nonnegative(),
    }),
  ),
  updatedAt: z.string().datetime(),
});
export type AccountLearningProfile = z.infer<typeof AccountLearningProfileSchema>;

// ---------------------------------------------------------------------------
// Monitor Checkpoint — Post-change monitoring state
// ---------------------------------------------------------------------------

export const MonitorCheckpointSchema = z.object({
  id: z.string(),
  interventionId: z.string(),
  accountId: z.string(),
  checkpointHours: z.number(),
  checkedAt: z.string().datetime(),
  metricName: z.string(),
  metricValue: z.number(),
  baselineValue: z.number(),
  deltaPercent: z.number(),
  anomalyDetected: z.boolean(),
  recommendation: z.string().nullable(),
});
export type MonitorCheckpoint = z.infer<typeof MonitorCheckpointSchema>;

// ---------------------------------------------------------------------------
// Creative Gap Analysis — Creative portfolio gap scoring
// ---------------------------------------------------------------------------

export const CreativeGapCriterionSchema = z.object({
  name: z.string(),
  score: z.number().min(0).max(100),
  weight: z.number().min(0).max(1),
  weightedScore: z.number().min(0).max(100),
  findings: z.array(z.string()),
});
export type CreativeGapCriterion = z.infer<typeof CreativeGapCriterionSchema>;

export const CreativeGapResultSchema = z.object({
  overallScore: z.number().min(0).max(100),
  criteria: z.array(CreativeGapCriterionSchema),
  significantGaps: z.array(z.string()),
  hasSignificantGaps: z.boolean(),
  analyzedAt: z.string().datetime(),
});
export type CreativeGapResult = z.infer<typeof CreativeGapResultSchema>;

// ---------------------------------------------------------------------------
// Test Campaign — Creative testing campaign lifecycle
// ---------------------------------------------------------------------------

export const TestCampaignStatusSchema = z.enum([
  "DRAFT",
  "READY",
  "DEPLOYING",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "FAILED",
]);
export type TestCampaignStatus = z.infer<typeof TestCampaignStatusSchema>;

export const TestCampaignSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  organizationId: z.string(),
  constraintType: ConstraintTypeSchema,
  status: TestCampaignStatusSchema,
  creativeAssetIds: z.array(z.string()),
  budget: z.number().nonnegative(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TestCampaign = z.infer<typeof TestCampaignSchema>;

// ---------------------------------------------------------------------------
// Weekly Digest — LLM-backed summary of diagnostic history
// ---------------------------------------------------------------------------

export const WeeklyDigestSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  organizationId: z.string(),
  weekStartDate: z.string(),
  headline: z.string(),
  summary: z.string(),
  constraintHistory: z.array(ConstraintTypeSchema),
  interventionOutcomes: z.array(
    z.object({
      interventionId: z.string(),
      actionType: ActionTypeSchema,
      outcome: OutcomeStatusSchema,
    }),
  ),
  createdAt: z.string().datetime(),
});
export type WeeklyDigest = z.infer<typeof WeeklyDigestSchema>;
