import type {
  GovernanceTier,
  GovernanceOutcome,
  TrustLevel,
  GovernanceDecision,
  GovernanceLogEntry,
} from "./governance.js";
import type { ContextRequirement } from "@switchboard/schemas";

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
  result: unknown;
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
  governanceTier: GovernanceTier;
  governanceOverride?: Partial<Record<TrustLevel, GovernanceDecision>>;
  idempotent?: boolean;
  execute(params: unknown): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Executor Interface
// ---------------------------------------------------------------------------

export interface SkillExecutor {
  execute(params: SkillExecutionParams): Promise<SkillExecutionResult>;
}

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
