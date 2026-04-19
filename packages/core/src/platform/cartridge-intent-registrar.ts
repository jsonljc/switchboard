import type { IntentRegistry } from "./intent-registry.js";
import type { IntentRegistration } from "./intent-registration.js";
import type { MutationClass, ApprovalPolicy } from "./types.js";

export interface CartridgeManifestForRegistration {
  id: string;
  actions: Array<{ name: string; description?: string; riskCategory?: string }>;
}

function deriveMutationClass(riskCategory?: string): MutationClass {
  if (!riskCategory) return "read";
  const lower = riskCategory.toLowerCase();
  if (lower === "high" || lower === "critical") return "destructive";
  if (lower === "medium") return "write";
  return "read";
}

/**
 * Registers IntentRegistrations for each action in the provided cartridge manifests.
 * Called at boot time to populate the IntentRegistry with cartridge-based intents.
 */
export function registerCartridgeIntents(
  registry: IntentRegistry,
  manifests: CartridgeManifestForRegistration[],
): void {
  for (const manifest of manifests) {
    for (const action of manifest.actions) {
      if (!action.name) continue;

      const intent = `${manifest.id}.${action.name}`;
      const mutationClass: MutationClass = deriveMutationClass(action.riskCategory);
      const approvalPolicy: ApprovalPolicy =
        mutationClass === "write" || mutationClass === "destructive" ? "threshold" : "none";

      const registration: IntentRegistration = {
        intent,
        defaultMode: "cartridge",
        allowedModes: ["cartridge"],
        executor: { mode: "cartridge", actionId: intent },
        parameterSchema: { type: "object" },
        mutationClass,
        budgetClass: "cheap",
        approvalPolicy,
        idempotent: false,
        allowedTriggers: ["chat", "api", "schedule", "internal"],
        timeoutMs: 10_000,
        retryable: mutationClass === "read",
      };

      registry.register(registration);
    }
  }
}
