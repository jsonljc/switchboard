// apps/api/src/bootstrap/governance-resolver-adapter.ts
// ---------------------------------------------------------------------------
// Factory for the { resolve(orgId) } adapter used by LifecycleConfigResolver.
//
// GovernanceConfigResolver is a plain function (deploymentId) => Promise<Resolution>;
// LifecycleConfigResolver expects an object with { resolve(orgId): Promise<unknown> }.
// This module hoists the adapter that was previously inlined in skill-mode.ts so
// that both bootstrap paths (skill-mode + disqualifications in app.ts) share the
// same implementation and cannot drift.
// ---------------------------------------------------------------------------
import { createAgentDeploymentGovernanceResolver, PrismaDeploymentStore } from "@switchboard/db";
import type { PrismaClient } from "@switchboard/db";

/**
 * Creates a { resolve(orgId): Promise<unknown> } adapter backed by the real
 * Prisma deployment-based governance config store.
 *
 * Returns null when no resolved config exists (e.g. org has no deployment or
 * the deployment has no governance config). LifecycleConfigResolver treats null
 * as "no capabilities configured" and returns an empty set, which is the
 * correct production default.
 */
export function createLifecycleGovernanceConfigResolver(prisma: PrismaClient): {
  resolve(orgId: string): Promise<unknown>;
} {
  const deploymentStore = new PrismaDeploymentStore(prisma);
  const governanceConfigResolver = createAgentDeploymentGovernanceResolver(deploymentStore);
  return {
    resolve: async (orgId: string): Promise<unknown> => {
      const resolution = await governanceConfigResolver(orgId);
      if (resolution.status === "resolved") return resolution.config;
      return null;
    },
  };
}
