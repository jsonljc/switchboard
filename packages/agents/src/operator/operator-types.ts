import type { OperatorChannel } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Intent → Agent Mapping
// ---------------------------------------------------------------------------

export const INTENT_AGENT_MAP: Record<string, string> = {
  follow_up_leads: "lead-responder",
  pause_campaigns: "ad-optimizer",
  resume_campaigns: "ad-optimizer",
  draft_campaign: "ad-optimizer",
  show_pipeline: "revenue-tracker",
  reassign_leads: "lead-responder",
  query_lead_history: "lead-responder",
  show_status: "revenue-tracker",
};

// ---------------------------------------------------------------------------
// Read-only intents (do not spawn workflows, just query + format)
// ---------------------------------------------------------------------------

export const READ_ONLY_INTENTS = new Set(["show_pipeline", "query_lead_history", "show_status"]);

// ---------------------------------------------------------------------------
// Interpreter Result (output of NL parsing)
// ---------------------------------------------------------------------------

export interface InterpretResult {
  intent: string;
  entities: { type: string; id?: string; filter?: Record<string, unknown> }[];
  parameters: Record<string, unknown>;
  confidence: number;
  ambiguityFlags: string[];
}

// ---------------------------------------------------------------------------
// Router Result (what happened after dispatching)
// ---------------------------------------------------------------------------

export interface CommandRouterResult {
  success: boolean;
  workflowIds: string[];
  resultSummary: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// LLM adapter interface for the interpreter
// ---------------------------------------------------------------------------

export interface CommandLLM {
  parseCommand(
    rawInput: string,
    context: { organizationId: string; channel: OperatorChannel },
  ): Promise<InterpretResult>;
}
