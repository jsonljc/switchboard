import type {
  GovernanceTier,
  GovernanceOutcome,
  TrustLevel,
  GovernanceDecision,
} from "./governance.js";

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
