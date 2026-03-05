// ---------------------------------------------------------------------------
// Cadence Engine — Types
// ---------------------------------------------------------------------------

export type CadenceStatus = "active" | "paused" | "completed" | "stopped";

export interface CadenceStep {
  /** Step index */
  index: number;
  /** Action to execute */
  actionType: string;
  /** Action parameters (supports {{variable}} interpolation) */
  parameters: Record<string, unknown>;
  /** Delay before this step (from previous step or cadence start) */
  delayMs: number;
  /** Condition to evaluate before executing (skip if false) */
  condition?: CadenceCondition;
  /** Template message for SMS/notification steps */
  messageTemplate?: string;
}

export interface CadenceCondition {
  /** Variable to check */
  variable: string;
  /** Operator */
  operator: "eq" | "neq" | "gt" | "lt" | "exists" | "not_exists";
  /** Value to compare against */
  value?: unknown;
}

export interface CadenceTrigger {
  /** Event that starts the cadence */
  event: string;
  /** Journey stage that triggers this cadence */
  stage?: string;
}

export interface CadenceDefinition {
  id: string;
  name: string;
  description: string;
  trigger: CadenceTrigger;
  steps: CadenceStep[];
  /** Max contacts that can be in this cadence concurrently per org */
  maxConcurrent?: number;
}

export interface CadenceInstance {
  id: string;
  cadenceDefinitionId: string;
  contactId: string;
  organizationId: string;
  status: CadenceStatus;
  currentStepIndex: number;
  startedAt: Date;
  nextExecutionAt: Date | null;
  variables: Record<string, unknown>;
  completedSteps: number[];
  skippedSteps: number[];
}
