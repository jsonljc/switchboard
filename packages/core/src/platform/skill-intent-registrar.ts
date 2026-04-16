import type { IntentRegistry } from "./intent-registry.js";
import type { IntentRegistration } from "./intent-registration.js";
import type { SkillDefinition } from "../skill-runtime/types.js";
import type { MutationClass, BudgetClass, ApprovalPolicy } from "./types.js";

function deriveMutationClass(tools: string[]): MutationClass {
  const hasWriteTool = tools.some(
    (t) => t.toLowerCase().includes("write") || t.toLowerCase().includes("delete"),
  );
  return hasWriteTool ? "write" : "read";
}

function deriveBudgetClass(minimumModelTier?: string): BudgetClass {
  if (minimumModelTier === "critical") return "expensive";
  if (minimumModelTier === "premium") return "standard";
  return "cheap";
}

/**
 * Registers an IntentRegistration for each skill that declares an `intent` field.
 * Called at boot time to populate the IntentRegistry with skill-based intents.
 */
export function registerSkillIntents(registry: IntentRegistry, skills: SkillDefinition[]): void {
  for (const skill of skills) {
    if (!skill.intent) continue;

    const mutationClass: MutationClass = deriveMutationClass(skill.tools);
    const budgetClass: BudgetClass = deriveBudgetClass(skill.minimumModelTier);
    const approvalPolicy: ApprovalPolicy = mutationClass === "write" ? "threshold" : "none";

    const registration: IntentRegistration = {
      intent: skill.intent,
      defaultMode: "skill",
      allowedModes: ["skill"],
      executor: { mode: "skill", skillSlug: skill.slug },
      parameterSchema: { type: "object" },
      mutationClass,
      budgetClass,
      approvalPolicy,
      idempotent: false,
      allowedTriggers: ["chat", "api", "schedule", "internal"],
      timeoutMs: 30_000,
      retryable: false,
    };

    registry.register(registration);
  }
}
