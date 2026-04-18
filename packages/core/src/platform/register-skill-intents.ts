import type { IntentRegistry } from "./intent-registry.js";
import type { SkillDefinition } from "../skill-runtime/types.js";

export function registerSkillIntents(
  registry: IntentRegistry,
  skills: Map<string, SkillDefinition>,
): void {
  for (const [slug] of skills) {
    const intent = `${slug}.respond`;
    registry.register({
      intent,
      defaultMode: "skill",
      allowedModes: ["skill"],
      executor: { mode: "skill", skillSlug: slug },
      parameterSchema: {},
      mutationClass: "write",
      budgetClass: "standard",
      approvalPolicy: "threshold",
      idempotent: false,
      allowedTriggers: ["chat", "api", "schedule"],
      timeoutMs: 30_000,
      retryable: false,
    });
  }
}
