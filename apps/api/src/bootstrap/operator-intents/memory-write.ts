// apps/api/src/bootstrap/operator-intents/memory-write.ts
// memory.write handler (S8b). The governed, non-conversation path for writing a learned
// DeploymentMemory through PlatformIngress: operator_mutation + system_auto_approved +
// non-financial (no outbound spend, no second approver), fully audited via the WorkTrace
// PlatformIngress writes around the handler. S8b REGISTERS this path; S8c reroutes the
// conversation-compounding + decay writers to submit through it.
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { MemoryWriteParametersSchema, type DeploymentMemorySource } from "@switchboard/schemas";
import { MEMORY_WRITE_INTENT } from "./shared.js";

export { MEMORY_WRITE_INTENT };

/**
 * Minimal store surface the handler writes through; PrismaDeploymentMemoryStore satisfies it
 * structurally (its create() already accepts source -- S8a). organizationId is the AUTHENTICATED
 * actor's org from the work unit, never a body field.
 */
export interface MemoryWriteStore {
  create(input: {
    organizationId: string;
    deploymentId: string;
    category: string;
    content: string;
    confidence?: number;
    canonicalKey?: string | null;
    source?: DeploymentMemorySource | null;
  }): Promise<{ id: string }>;
}

export function buildMemoryWriteHandler(store: MemoryWriteStore): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = MemoryWriteParametersSchema.parse(workUnit.parameters);
      const entry = await store.create({
        organizationId: workUnit.organizationId,
        deploymentId: params.deploymentId,
        category: params.category,
        content: params.content,
        confidence: params.confidence,
        canonicalKey: params.canonicalKey ?? null,
        source: params.source,
      });
      return {
        outcome: "completed" as const,
        summary: `Wrote ${params.category} memory for deployment ${params.deploymentId}`,
        outputs: { id: entry.id, source: params.source },
      };
    },
  };
}
