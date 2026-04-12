// packages/core/src/context-budget.ts

export type Effort = "low" | "medium" | "high";

export interface ContextMemory {
  /** Brand voice, guidelines — top-K retrieved from KnowledgeStore */
  brand?: string;
  /**
   * Learned patterns relevant to this task — top-K retrieved from SkillStore.
   * Populated once SkillStore is implemented (AI Workforce Platform spec).
   */
  skills?: string[];
  /** Recent approval patterns — summarised, not raw history */
  performance?: string;
}

export interface ContextTask {
  goal: string;
  scope: string[];
  constraints: string[];
  expectedOutput: string;
}

export interface ContextBudget {
  /** L1: stable doctrine — employee system prompt + core policies */
  doctrine: string;
  /** L2: retrieved memory — only what is relevant to this task */
  memory: ContextMemory;
  /** L3: task capsule */
  task: ContextTask;
  /**
   * Routing hint — derived from taskType via TASK_TYPE_EFFORT_MAP.
   * Set explicitly only to override the default mapping.
   */
  effort: Effort;
  /** Used for routing and logging. Not injected into the assembled prompt. */
  orgId: string;
  taskType: string;
}

/** Per-layer character limits for ContextAssembler. Configurable per employee. */
export interface ContextBudgetLimits {
  /** Max characters for L1 doctrine block. Default: 2000 */
  doctrineBudget: number;
  /** Max characters for L2 memory block (brand + skills + performance combined). Default: 1000 */
  memoryBudget: number;
  /** Max characters for L3 task capsule block. Default: 500 */
  taskBudget: number;
}

export const DEFAULT_CONTEXT_BUDGET_LIMITS: ContextBudgetLimits = {
  doctrineBudget: 2000,
  memoryBudget: 1000,
  taskBudget: 500,
};
