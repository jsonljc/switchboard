import { GovernanceConfigSchema, type GovernanceConfig } from "@switchboard/schemas";

export type GovernanceConfigResolution =
  | { status: "resolved"; config: GovernanceConfig }
  | { status: "missing" }
  | { status: "error"; error: Error };

export type GovernanceConfigResolver = (
  deploymentId: string,
) => Promise<GovernanceConfigResolution>;

/**
 * Minimal subset of AgentDeploymentStore used by the resolver.
 * The real store (PrismaDeploymentStore) satisfies this interface via structural
 * typing once the bootstrap wires it in. Task 14 handles that injection.
 */
interface DeploymentReader {
  findById(deploymentId: string): Promise<{ governanceConfig?: unknown } | null>;
}

/**
 * Creates a GovernanceConfigResolver that reads the per-deployment governance
 * configuration from the store and returns a discriminated-union result:
 *
 *   { status: "resolved"; config: GovernanceConfig }  — valid config found
 *   { status: "missing" }                             — no config row / null value
 *   { status: "error"; error: Error }                 — store threw or Zod rejected
 *
 * Gates MUST treat "missing" as "governance is off" and "error" as a signal
 * to apply a safe fallback (e.g., cache-driven fail-safe rule).
 */
export function createAgentDeploymentGovernanceResolver(
  store: DeploymentReader,
): GovernanceConfigResolver {
  return async (deploymentId) => {
    let row: { governanceConfig?: unknown } | null;
    try {
      row = await store.findById(deploymentId);
    } catch (e) {
      return {
        status: "error",
        error: e instanceof Error ? e : new Error(String(e)),
      };
    }

    if (!row || row.governanceConfig === null || row.governanceConfig === undefined) {
      return { status: "missing" };
    }

    const parsed = GovernanceConfigSchema.safeParse(row.governanceConfig);
    if (!parsed.success) {
      return {
        status: "error",
        error: new Error(
          `Invalid governanceConfig for deployment ${deploymentId}: ${parsed.error.message}`,
        ),
      };
    }

    return { status: "resolved", config: parsed.data };
  };
}
