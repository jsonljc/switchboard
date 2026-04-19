import type { ContextMemory, ContextTask, ContextBudgetLimits } from "./context-budget.js";

export interface ContextLoaderInput {
  orgId: string;
  employeeId: string;
  taskType: string;
  task: ContextTask;
  limits: ContextBudgetLimits;
}

export interface ContextLoader {
  load(input: ContextLoaderInput): Promise<ContextMemory>;
}

/** No-op loader for tests. Returns empty memory. */
export class NullContextLoader implements ContextLoader {
  async load(_input: ContextLoaderInput): Promise<ContextMemory> {
    return {};
  }
}
