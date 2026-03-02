// ---------------------------------------------------------------------------
// Conversation Flow Engine — Types
// ---------------------------------------------------------------------------

export type FlowStepType =
  | "message"
  | "question"
  | "branch"
  | "wait"
  | "action"
  | "escalate"
  | "score"
  | "objection";

export interface FlowStep {
  id: string;
  type: FlowStepType;
  /** Template with {{variable}} interpolation */
  template?: string;
  /** Options for question steps */
  options?: string[];
  /** Conditions for branch steps */
  branches?: BranchCondition[];
  /** Action to trigger */
  actionType?: string;
  actionParameters?: Record<string, unknown>;
  /** Wait duration in ms */
  waitMs?: number;
  /** Next step ID (default: sequential) */
  nextStepId?: string;
  /** Allow LLM personalization of the template */
  llmPersonalization?: boolean;
  /** Escalation reason */
  escalationReason?: string;
}

export interface BranchCondition {
  /** Variable to evaluate */
  variable: string;
  /** Operator for comparison */
  operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
  /** Value to compare against */
  value: unknown;
  /** Step ID to jump to if condition is true */
  targetStepId: string;
}

export interface ConversationFlowDefinition {
  id: string;
  name: string;
  description: string;
  steps: FlowStep[];
  /** Variables available for interpolation */
  variables: string[];
}

export interface ConversationState {
  flowId: string;
  currentStepIndex: number;
  variables: Record<string, unknown>;
  completed: boolean;
  escalated: boolean;
  history: Array<{
    stepId: string;
    output: string;
    timestamp: Date;
  }>;
}
