// packages/creative-pipeline/src/creative-memory.ts

/**
 * Taste-context seam (slice-2 spec 3.8): the interface is owned by
 * creative-pipeline (L2), implemented in apps/api over DeploymentMemory, and
 * injected from bootstrap/inngest.ts into the job runner — the exact layering
 * precedent of AssetStorageClient (durable-asset PR).
 *
 * Returns RENDERED, clearly-subjective lines, e.g.
 * "consistently keeps question hooks in polished mode (4 keeps)". An empty
 * array or an absent provider renders nothing (degrade-gracefully, dev
 * parity); the prompt builders own the subjective heading.
 */
export interface CreativeMemoryProvider {
  getTasteContext(organizationId: string, deploymentId: string): Promise<string[]>;
}
