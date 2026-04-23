import type {
  EffectCategory,
  GovernanceOutcome,
  TrustLevel,
  GovernanceDecision,
  GovernanceLogEntry,
} from "./governance.js";
import type { ContextRequirement } from "@switchboard/schemas";
import type { ModelSlot } from "../model-router.js";
import type { ToolResult } from "./tool-result.js";

// ---------------------------------------------------------------------------
// Model Routing (SP6 Phase 1)
// ---------------------------------------------------------------------------

/** Concrete model selection resolved by ModelRouter — skills never see this directly. */
export interface ResolvedModelProfile {
  /** Concrete model ID from ModelConfig.modelId */
  model: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}

// ---------------------------------------------------------------------------
// Skill Definition (output of loader)
// ---------------------------------------------------------------------------

export interface SkillDefinition {
  name: string;
  slug: string;
  version: string;
  description: string;
  author: string;
  parameters: ParameterDeclaration[];
  tools: string[];
  body: string;
  output?: { fields: OutputFieldDeclaration[] };
  context: ContextRequirement[];
  minimumModelTier?: ModelSlot;
  intent?: string;
}

export type ParameterType = "string" | "number" | "boolean" | "enum" | "object";

export interface ParameterDeclaration {
  name: string;
  type: ParameterType;
  required: boolean;
  description?: string;
  values?: string[];
  schema?: Record<string, unknown>;
}

export interface OutputFieldDeclaration {
  name: string;
  type: "string" | "number" | "boolean" | "enum" | "array";
  required: boolean;
  description?: string;
  values?: string[];
  items?: { type: string };
}

// ---------------------------------------------------------------------------
// Skill Execution (input/output of executor)
// ---------------------------------------------------------------------------

export interface SkillExecutionParams {
  skill: SkillDefinition;
  parameters: Record<string, unknown>;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  deploymentId: string;
  orgId: string;
  trustScore: number;
  trustLevel: "supervised" | "guided" | "autonomous";
}

export interface SkillExecutionResult {
  response: string;
  toolCalls: ToolCallRecord[];
  tokenUsage: { input: number; output: number };
  trace: SkillExecutionTraceData;
}

export interface ToolCallRecord {
  toolId: string;
  operation: string;
  params: unknown;
  result: ToolResult;
  durationMs: number;
  governanceDecision: GovernanceOutcome;
}

// ---------------------------------------------------------------------------
// Execution Trace (SP3)
// ---------------------------------------------------------------------------

export interface SkillExecutionTraceData {
  durationMs: number;
  turnCount: number;
  status: "success" | "error" | "budget_exceeded" | "denied";
  error?: string;
  responseSummary: string;
  writeCount: number;
  governanceDecisions: GovernanceLogEntry[];
}

export interface SkillExecutionTrace {
  id: string;
  deploymentId: string;
  organizationId: string;
  skillSlug: string;
  skillVersion: string;
  trigger: "chat_message" | "batch_job";
  sessionId: string;
  inputParametersHash: string;
  toolCalls: ToolCallRecord[];
  governanceDecisions: GovernanceLogEntry[];
  tokenUsage: { input: number; output: number };
  durationMs: number;
  turnCount: number;
  status: "success" | "error" | "budget_exceeded" | "denied";
  error?: string;
  responseSummary: string;
  linkedOutcomeId?: string;
  linkedOutcomeType?: "opportunity" | "task" | "campaign";
  linkedOutcomeResult?: string;
  writeCount: number;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Tool Interface
// ---------------------------------------------------------------------------

export interface SkillTool {
  id: string;
  operations: Record<string, SkillToolOperation>;
}

export interface SkillToolOperation {
  description: string;
  inputSchema: Record<string, unknown>;
  effectCategory: EffectCategory;
  governanceOverride?: Partial<Record<TrustLevel, GovernanceDecision>>;
  idempotent?: boolean;
  resultClass?: import("./reinjection-filter.js").ResultClass;
  summarizeForModel?: boolean;
  retrieval?: boolean;
  execute(params: unknown): Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Executor Interface
// ---------------------------------------------------------------------------

export interface SkillExecutor {
  execute(params: SkillExecutionParams): Promise<SkillExecutionResult>;
}

// ---------------------------------------------------------------------------
// Skill Hooks (SP6 Phase 2)
// ---------------------------------------------------------------------------

export interface SkillHookContext {
  deploymentId: string;
  orgId: string;
  skillSlug: string;
  skillVersion: string;
  sessionId: string;
  trustLevel: "supervised" | "guided" | "autonomous";
  trustScore: number;
}

export interface LlmCallContext {
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  elapsedMs: number;
  profile?: ResolvedModelProfile;
}

export interface LlmResponse {
  content: unknown[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage: { inputTokens: number; outputTokens: number };
}

export interface ToolCallContext {
  toolId: string;
  operation: string;
  params: unknown;
  effectCategory: EffectCategory;
  trustLevel: "supervised" | "guided" | "autonomous";
}

export interface HookResult {
  proceed: boolean;
  reason?: string;
  /** When a hook blocks a tool call, this distinguishes deny from pending_approval. */
  decision?: "denied" | "pending_approval";
}

export interface LlmHookResult extends HookResult {
  ctx?: LlmCallContext;
}

export interface SkillHook {
  name: string;
  beforeSkill?(ctx: SkillHookContext): Promise<HookResult>;
  afterSkill?(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void>;
  beforeLlmCall?(ctx: LlmCallContext): Promise<LlmHookResult>;
  afterLlmCall?(ctx: LlmCallContext, response: LlmResponse): Promise<void>;
  beforeToolCall?(ctx: ToolCallContext): Promise<HookResult>;
  afterToolCall?(ctx: ToolCallContext, result: unknown): Promise<void>;
  onError?(ctx: SkillHookContext, error: Error): Promise<void>;
}

// ---------------------------------------------------------------------------
// Runtime Policy (SP6 Phase 3)
// ---------------------------------------------------------------------------

export interface SkillRuntimePolicy {
  allowedModelTiers: ModelSlot[];
  minimumModelTier?: ModelSlot;
  maxToolCalls: number;
  maxLlmTurns: number;
  maxTotalTokens: number;
  maxRuntimeMs: number;
  maxWritesPerExecution: number;
  maxWritesPerHour: number;
  trustLevel: "supervised" | "guided" | "autonomous";
  writeApprovalRequired: boolean;
  circuitBreakerThreshold: number;
  maxConcurrentExecutions: number;
}

export const DEFAULT_SKILL_RUNTIME_POLICY: SkillRuntimePolicy = {
  allowedModelTiers: ["default", "premium", "critical"],
  maxToolCalls: 5,
  maxLlmTurns: 6,
  maxTotalTokens: 64_000,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 5,
  maxWritesPerHour: 20,
  trustLevel: "guided",
  writeApprovalRequired: false,
  circuitBreakerThreshold: 5,
  maxConcurrentExecutions: 3,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SkillParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillParseError";
  }
}

export class SkillValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = "SkillValidationError";
  }
}

export class SkillParameterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillParameterError";
  }
}

export class SkillExecutionBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillExecutionBudgetError";
  }
}

export class ContextResolutionError extends Error {
  constructor(
    public readonly kind: string,
    public readonly scope: string,
  ) {
    super(`Required knowledge not found: kind=${kind}, scope=${scope}`);
    this.name = "ContextResolutionError";
  }
}

// ---------------------------------------------------------------------------
// Request Context (per-request identity, never shared across requests)
// ---------------------------------------------------------------------------

export interface SkillRequestContext {
  sessionId: string;
  orgId: string;
  deploymentId: string;
  actorId?: string;
  traceId?: string;
  surface?: "chat" | "simulation" | "api" | "system";
}
