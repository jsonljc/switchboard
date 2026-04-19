// packages/core/src/context-assembler.ts
import type { ContextBudget, ContextBudgetLimits } from "./context-budget.js";

const TRUNCATION_NOTICE = "[truncated — see full context in memory store]";

function truncate(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const cutoff = budget - TRUNCATION_NOTICE.length;
  if (cutoff <= 0) return TRUNCATION_NOTICE.slice(0, budget);
  return text.slice(0, cutoff) + TRUNCATION_NOTICE;
}

export class ContextAssembler {
  assemble(budget: ContextBudget, limits: ContextBudgetLimits): string {
    const parts: string[] = [];

    // L1: Doctrine
    parts.push(truncate(budget.doctrine, limits.doctrineBudget));

    // L2: Memory
    const memoryParts: string[] = [];
    if (budget.memory.brand) memoryParts.push(`Brand context:\n${budget.memory.brand}`);
    if (budget.memory.skills?.length) {
      memoryParts.push(`Learned patterns:\n${budget.memory.skills.join("\n")}`);
    }
    if (budget.memory.performance) {
      memoryParts.push(`Performance context:\n${budget.memory.performance}`);
    }

    if (memoryParts.length > 0) {
      const memoryBlock = truncate(memoryParts.join("\n\n"), limits.memoryBudget);
      parts.push(memoryBlock);
    }

    // L3: Task capsule
    const taskBlock = [
      `Goal: ${budget.task.goal}`,
      budget.task.scope.length > 0 ? `Scope: ${budget.task.scope.join(", ")}` : null,
      budget.task.constraints.length > 0
        ? `Constraints: ${budget.task.constraints.join("; ")}`
        : null,
      `Expected output: ${budget.task.expectedOutput}`,
    ]
      .filter(Boolean)
      .join("\n");

    parts.push(truncate(taskBlock, limits.taskBudget));

    return parts.join("\n\n---\n\n");
  }
}
