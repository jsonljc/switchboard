import type { IntentRegistry } from "./intent-registry.js";
import type { IntentRegistration } from "./intent-registration.js";

export interface PipelineDefinition {
  id: string;
  intent: string;
  description: string;
  timeoutMs?: number;
}

const DEFAULT_PIPELINES: PipelineDefinition[] = [
  {
    id: "polished",
    intent: "creative.produce",
    description: "Produce polished video ad",
  },
  {
    id: "ugc",
    intent: "creative.ugc.produce",
    description: "Produce UGC-style video ad",
  },
];

export function registerPipelineIntents(
  registry: IntentRegistry,
  pipelines: PipelineDefinition[] = DEFAULT_PIPELINES,
): void {
  for (const pipeline of pipelines) {
    const registration: IntentRegistration = {
      intent: pipeline.intent,
      defaultMode: "pipeline",
      allowedModes: ["pipeline"],
      executor: { mode: "pipeline", pipelineId: pipeline.id },
      parameterSchema: {},
      mutationClass: "write",
      budgetClass: "expensive",
      approvalPolicy: "threshold",
      idempotent: false,
      allowedTriggers: ["api", "schedule", "event", "chat"],
      timeoutMs: pipeline.timeoutMs ?? 300_000,
      retryable: false,
    };

    registry.register(registration);
  }
}
