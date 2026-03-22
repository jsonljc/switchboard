import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const SessionStatusSchema = z.enum([
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const RunTriggerTypeSchema = z.enum([
  "initial",
  "resume_approval",
  "resume_manual",
  "resume_retry",
]);
export type RunTriggerType = z.infer<typeof RunTriggerTypeSchema>;

export const RunOutcomeSchema = z.enum([
  "completed",
  "paused_for_approval",
  "failed",
  "cancelled",
  "timeout",
]);
export type RunOutcome = z.infer<typeof RunOutcomeSchema>;

export const ResumeStatusSchema = z.enum(["pending", "consumed", "expired", "cancelled"]);
export type ResumeStatus = z.infer<typeof ResumeStatusSchema>;

// ---------------------------------------------------------------------------
// Safety Envelope — persisted cross-run budget
// ---------------------------------------------------------------------------

export const SafetyEnvelopeSchema = z.object({
  maxToolCalls: z.number().int().positive(),
  maxMutations: z.number().int().positive(),
  maxDollarsAtRisk: z.number().positive(),
  sessionTimeoutMs: z.number().int().positive(),
});
export type SafetyEnvelope = z.infer<typeof SafetyEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Checkpoint — opaque to Switchboard, validated structurally only
// ---------------------------------------------------------------------------

export const AgentCheckpointSchema = z.object({
  /** Opaque agent state — Switchboard never interprets this */
  agentState: z.record(z.unknown()),
  /** Last tool call result, for resume context */
  lastToolResult: z.record(z.unknown()).optional(),
  /** Pending approval that caused the pause */
  pendingApprovalId: z.string().optional(),
  /** Role-specific extensions validated by checkpoint schema */
  extensions: z.record(z.unknown()).optional(),
});
export type AgentCheckpoint = z.infer<typeof AgentCheckpointSchema>;

// ---------------------------------------------------------------------------
// Tool Event — individual tool call record
// ---------------------------------------------------------------------------

export const ToolEventSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  runId: z.string().uuid(),
  stepIndex: z.number().int().nonnegative(),
  toolName: z.string().min(1),
  parameters: z.record(z.unknown()),
  result: z.record(z.unknown()).nullable(),
  isMutation: z.boolean(),
  dollarsAtRisk: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  envelopeId: z.string().uuid().nullable(),
  timestamp: z.coerce.date(),
  /** Stable id from gateway for dedupe on worker retry (optional for legacy rows) */
  gatewayIdempotencyKey: z.string().min(1).optional(),
});
export type ToolEvent = z.infer<typeof ToolEventSchema>;

// ---------------------------------------------------------------------------
// Agent Run — one invocation of the agent within a session
// ---------------------------------------------------------------------------

export const AgentRunSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  runIndex: z.number().int().nonnegative(),
  triggerType: RunTriggerTypeSchema,
  resumeContext: z.record(z.unknown()).nullable(),
  outcome: RunOutcomeSchema.nullable(),
  stepRange: z
    .object({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    })
    .nullable(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

// ---------------------------------------------------------------------------
// Agent Pause — approval-gated pause record
// ---------------------------------------------------------------------------

export const AgentPauseSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  runId: z.string().uuid(),
  pauseIndex: z.number().int().nonnegative(),
  approvalId: z.string().uuid(),
  resumeStatus: ResumeStatusSchema,
  resumeToken: z.string().min(1),
  checkpoint: AgentCheckpointSchema,
  approvalOutcome: z.record(z.unknown()).nullable(),
  createdAt: z.coerce.date(),
  resumedAt: z.coerce.date().nullable(),
});
export type AgentPause = z.infer<typeof AgentPauseSchema>;

// ---------------------------------------------------------------------------
// Agent Session — top-level session record
// ---------------------------------------------------------------------------

export const AgentSessionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().min(1),
  roleId: z.string().min(1),
  principalId: z.string().min(1),
  status: SessionStatusSchema,
  safetyEnvelope: SafetyEnvelopeSchema,
  /** Effective tool pack at session creation (merged manifest + org override) */
  allowedToolPack: z.array(z.string()),
  /** Effective governance profile at session creation */
  governanceProfile: z.string().min(1),
  /** Denormalized cumulative counters for fast safetyEnvelope checks */
  toolCallCount: z.number().int().nonnegative(),
  mutationCount: z.number().int().nonnegative(),
  dollarsAtRisk: z.number().nonnegative(),
  currentStep: z.number().int().nonnegative(),
  /** Denormalized tool history for resume payload building */
  toolHistory: z.array(ToolEventSchema),
  checkpoint: AgentCheckpointSchema.nullable(),
  traceId: z.string().min(1),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
  /** Set when status becomes failed */
  errorMessage: z.string().nullable(),
  errorCode: z.string().optional(),
});
export type AgentSession = z.infer<typeof AgentSessionSchema>;

// ---------------------------------------------------------------------------
// Agent Role Override — org-level narrowing of role manifest defaults
// ---------------------------------------------------------------------------

export const AgentRoleOverrideSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().min(1),
  roleId: z.string().min(1),
  /** Narrow the allowed tool list (subset of manifest.toolPack) */
  allowedTools: z.array(z.string()).optional(),
  /** Override safety envelope limits (can only tighten, not loosen) */
  safetyEnvelopeOverride: SafetyEnvelopeSchema.partial().optional(),
  /** Override governance profile */
  governanceProfileOverride: z.string().optional(),
  /** Additional guardrail rules */
  additionalGuardrails: z.record(z.unknown()).optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AgentRoleOverride = z.infer<typeof AgentRoleOverrideSchema>;

// ---------------------------------------------------------------------------
// Resume Payload — sent to Gateway on resume
// ---------------------------------------------------------------------------

export const ResumePayloadSchema = z.object({
  sessionId: z.string().uuid(),
  runId: z.string().uuid(),
  roleId: z.string().min(1),
  checkpoint: AgentCheckpointSchema,
  approvalOutcome: z.record(z.unknown()),
  toolHistory: z.array(ToolEventSchema),
  instruction: z.string().min(1),
  safetyBudgetRemaining: z.object({
    toolCalls: z.number().int().nonnegative(),
    mutations: z.number().int().nonnegative(),
    dollarsAtRisk: z.number().nonnegative(),
    timeRemainingMs: z.number().int(),
  }),
});
export type ResumePayload = z.infer<typeof ResumePayloadSchema>;

// ---------------------------------------------------------------------------
// Gateway Interface Contract
// ---------------------------------------------------------------------------

const GatewayInvokeRequestSharedSchema = z.object({
  sessionId: z.string().uuid(),
  runId: z.string().uuid(),
  roleId: z.string().min(1),
  sessionToken: z.string().min(1),
  traceId: z.string().min(1),
  /** Stable per worker invocation for gateway/tool idempotency */
  idempotencyKey: z.string().min(1),
});

export const GatewayInitialInvokeRequestSchema = GatewayInvokeRequestSharedSchema.extend({
  kind: z.literal("initial"),
  instruction: z.string().min(1),
  allowedToolPack: z.array(z.string()),
  governanceProfile: z.string().min(1),
  safetyLimits: SafetyEnvelopeSchema,
});
export type GatewayInitialInvokeRequest = z.infer<typeof GatewayInitialInvokeRequestSchema>;

export const GatewayResumeInvokeRequestSchema = GatewayInvokeRequestSharedSchema.extend({
  kind: z.literal("resume"),
  resumePayload: ResumePayloadSchema,
});
export type GatewayResumeInvokeRequest = z.infer<typeof GatewayResumeInvokeRequestSchema>;

export const GatewayInvokeRequestSchema = z.discriminatedUnion("kind", [
  GatewayInitialInvokeRequestSchema,
  GatewayResumeInvokeRequestSchema,
]);
export type GatewayInvokeRequest = z.infer<typeof GatewayInvokeRequestSchema>;

/** Tool call from gateway before Switchboard assigns id, sessionId, runId, stepIndex, timestamp */
export const GatewayToolCallInputSchema = z.object({
  idempotencyKey: z.string().min(1),
  toolName: z.string().min(1),
  parameters: z.record(z.unknown()),
  result: z.record(z.unknown()).nullable(),
  isMutation: z.boolean(),
  dollarsAtRisk: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  envelopeId: z.string().uuid().nullable(),
});
export type GatewayToolCallInput = z.infer<typeof GatewayToolCallInputSchema>;

/** Populated by HttpGatewayClient from response headers; optional in JSON body from gateway */
export const GatewayCorrelationMetaSchema = z.object({
  gatewayRequestId: z.string().optional(),
  runtimeCorrelationId: z.string().optional(),
});
export type GatewayCorrelationMeta = z.infer<typeof GatewayCorrelationMetaSchema>;

export const GatewayInvokeResponseSchema = z.object({
  status: z.enum(["completed", "paused", "failed"]),
  /** Checkpoint state when paused */
  checkpoint: AgentCheckpointSchema.optional(),
  /** Tool calls made during this invocation */
  toolCalls: z.array(GatewayToolCallInputSchema).optional(),
  /** Final result when completed */
  result: z.record(z.unknown()).optional(),
  /** Error details when failed */
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
  /** Transport may merge header-derived ids (see docs/openclaw-gateway-contract.md) */
  correlation: GatewayCorrelationMetaSchema.optional(),
});
export type GatewayInvokeResponse = z.infer<typeof GatewayInvokeResponseSchema>;

export const GatewayHealthResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string().optional(),
});
export type GatewayHealthResponse = z.infer<typeof GatewayHealthResponseSchema>;

// ---------------------------------------------------------------------------
// Session callback (gateway → Switchboard terminal outcomes)
// ---------------------------------------------------------------------------

export const SessionRunCallbackBodySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    toolCalls: z.array(GatewayToolCallInputSchema).optional(),
    result: z.record(z.unknown()).optional(),
  }),
  z.object({
    status: z.literal("paused"),
    checkpoint: AgentCheckpointSchema,
    toolCalls: z.array(GatewayToolCallInputSchema).optional(),
  }),
  z.object({
    status: z.literal("failed"),
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
    toolCalls: z.array(GatewayToolCallInputSchema).optional(),
  }),
]);
export type SessionRunCallbackBody = z.infer<typeof SessionRunCallbackBodySchema>;

// ---------------------------------------------------------------------------
// API Request/Response schemas
// ---------------------------------------------------------------------------

export const CreateSessionRequestSchema = z.object({
  organizationId: z.string().min(1),
  roleId: z.string().min(1),
  principalId: z.string().min(1),
  /** Override safety envelope (tightening only, validated against role manifest) */
  safetyEnvelopeOverride: SafetyEnvelopeSchema.partial().optional(),
  /** Initial context/instruction for the agent */
  initialContext: z.record(z.unknown()).optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

// ---------------------------------------------------------------------------
// Role Manifest — type lives in schemas so all layers can import it cleanly
// ---------------------------------------------------------------------------

export const AgentRoleManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  version: z.string(),
  toolPack: z.array(z.string()),
  governanceProfile: z.string(),
  safetyEnvelope: SafetyEnvelopeSchema,
  /** Relative path to instruction template from manifest directory */
  instructionPath: z.string(),
  /** Relative path to checkpoint schema from manifest directory */
  checkpointSchemaPath: z.string(),
  /** Maximum concurrent sessions per org for this role */
  maxConcurrentSessions: z.number().int().positive(),
});
export type AgentRoleManifest = z.infer<typeof AgentRoleManifestSchema>;
