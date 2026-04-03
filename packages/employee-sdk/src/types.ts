// ---------------------------------------------------------------------------
// Employee SDK Types — what the developer writes and what the runtime consumes
// ---------------------------------------------------------------------------

import type {
  AgentPort,
  AgentContext,
  ActionRequest,
  ThreadUpdate,
  Cartridge,
  ExecuteResult,
  RoutedEventEnvelope,
} from "@switchboard/schemas";
import type { z } from "zod";

// ---------------------------------------------------------------------------
// AgentHandler / AgentResponse — defined here so employee-sdk (Layer 2)
// doesn't depend on packages/agents. Structurally identical to the agents
// version. Apps wire them together at Layer 6.
// ---------------------------------------------------------------------------

export interface AgentHandler {
  handle(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse>;
}

export interface AgentResponse {
  events: RoutedEventEnvelope[];
  actions: ActionRequest[];
  state?: Record<string, unknown>;
  threadUpdate?: ThreadUpdate;
}

// ---------------------------------------------------------------------------
// Employee definition types (what the developer writes)
// ---------------------------------------------------------------------------

export interface PersonalityConfig {
  role: string;
  tone: string;
  traits: string[];
}

export interface EmployeeActionDef {
  type: string;
  description: string;
  riskCategory: "low" | "medium" | "high" | "critical";
  reversible: boolean;
  parameters: z.ZodType;
}

export interface EmployeeConnectionDef {
  service: string;
  purpose: string;
  required: boolean;
}

export interface EmployeePolicyDef {
  action: string;
  effect: "allow" | "deny" | "require_approval";
}

export interface EmployeeGuardrailDef {
  rateLimits?: Array<{ actionPattern: string; maxPerHour: number }>;
  cooldowns?: Array<{ actionPattern: string; seconds: number }>;
}

export interface EmployeeHandlerResult {
  actions: Array<{ type: string; params: Record<string, unknown> }>;
  events: Array<{ type: string; payload: Record<string, unknown> }>;
}

// ---------------------------------------------------------------------------
// Employee context (what the handler receives at runtime)
// ---------------------------------------------------------------------------

export interface EmployeeMemoryContext {
  brand: {
    search: (
      query: string,
      topK?: number,
    ) => Promise<Array<{ content: string; similarity: number }>>;
  };
  skills: {
    getRelevant: (
      taskType: string,
      format?: string,
      topK?: number,
    ) => Promise<Array<{ pattern: string; score: number }>>;
  };
  performance: {
    getTop: (
      channel: string,
      limit: number,
    ) => Promise<Array<{ contentId: string; metrics: Record<string, number> }>>;
  };
}

export interface EmployeeContext {
  organizationId: string;
  contactData?: Record<string, unknown>;
  knowledge: {
    search: (
      query: string,
      topK?: number,
    ) => Promise<Array<{ content: string; similarity: number }>>;
  };
  memory: EmployeeMemoryContext;
  llm: {
    generate: (input: {
      system?: string;
      context?: unknown[];
      prompt: string;
      schema?: z.ZodType;
    }) => Promise<{ text: string; parsed?: unknown }>;
  };
  actions: {
    propose: (type: string, params: Record<string, unknown>) => Promise<ExecuteResult>;
  };
  emit: (type: string, payload: Record<string, unknown>) => void;
  learn: (skill: {
    type: string;
    pattern?: string;
    input?: string;
    feedback?: string;
    evidence?: string[];
    channel?: string;
  }) => Promise<void>;
  personality: { toPrompt: () => string };
}

// ---------------------------------------------------------------------------
// Employee config (input to defineEmployee)
// ---------------------------------------------------------------------------

export interface EmployeeConfig {
  id: string;
  name: string;
  version: string;
  description: string;
  personality: PersonalityConfig;
  inboundEvents: string[];
  outboundEvents: string[];
  actions: EmployeeActionDef[];
  handle: (event: RoutedEventEnvelope, context: EmployeeContext) => Promise<EmployeeHandlerResult>;
  execute: (
    actionType: string,
    params: Record<string, unknown>,
    context: EmployeeContext,
  ) => Promise<ExecuteResult>;
  connections?: EmployeeConnectionDef[];
  guardrails?: EmployeeGuardrailDef;
  policies?: EmployeePolicyDef[];
}

// ---------------------------------------------------------------------------
// Compiled output (what the runtime consumes)
// ---------------------------------------------------------------------------

export interface CompiledEmployee {
  port: AgentPort;
  handler: AgentHandler;
  cartridge: Cartridge;
  defaults: {
    policies: EmployeePolicyDef[];
    guardrails: EmployeeGuardrailDef;
  };
  connections: EmployeeConnectionDef[];
}
