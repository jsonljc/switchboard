import type { StepType } from "@switchboard/schemas";

/**
 * PlanStepTemplate — a single step in a plan template.
 */
export interface PlanStepTemplate {
  /** Semantic step type */
  stepType: StepType;
  /** Action type pattern (resolved to real action at build time) */
  actionPattern: string;
  /** Parameter template with binding expressions */
  parameterTemplate: Record<string, unknown>;
  /** Optional condition expression */
  condition?: string;
  /** Description for debugging */
  description: string;
}

/**
 * PlanTemplate — a reusable multi-step plan pattern.
 */
export interface PlanTemplate {
  /** Template identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Which goal types this template serves */
  goalTypes: string[];
  /** Strategy for execution */
  strategy: "sequential" | "atomic" | "best_effort";
  /** How to handle approvals */
  approvalMode: "per_action" | "single_approval";
  /** Ordered step templates */
  steps: PlanStepTemplate[];
}

/**
 * PlanningContext — runtime context for plan building.
 */
export interface PlanningContext {
  /** Principal requesting the plan */
  principalId: string;
  /** Organization ID */
  organizationId?: string;
  /** Cartridge ID to use for actions */
  cartridgeId: string;
  /** Ad account ID (for digital-ads) */
  adAccountId?: string;
  /** Trace ID for correlation */
  traceId?: string;
}
