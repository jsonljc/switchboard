import type { PrismaClient } from "@prisma/client";
import {
  GovernanceConfigSchema,
  setGateModeInConfig,
  type GovernanceGateUnit,
  type GovernanceMode,
} from "@switchboard/schemas";

/** The deployment does not exist for the requesting org (or was deleted mid-flip). */
export class DeploymentNotFoundError extends Error {
  constructor(deploymentId: string) {
    super(`Deployment not found: ${deploymentId}`);
    this.name = "DeploymentNotFoundError";
  }
}

/** The stored governanceConfig failed schema validation — refuse to blind-overwrite it. */
export class GovernanceConfigInvalidError extends Error {
  constructor(deploymentId: string) {
    super(`Invalid stored governanceConfig for deployment: ${deploymentId}`);
    this.name = "GovernanceConfigInvalidError";
  }
}

export interface SetGateModeInput {
  organizationId: string;
  deploymentId: string;
  unit: GovernanceGateUnit;
  mode: GovernanceMode;
}

/**
 * Writes a single governance gate's mode onto an AgentDeployment's governanceConfig,
 * org-scoped and lost-update-safe under concurrent per-gate flips.
 *
 * The read-modify-write runs inside a transaction whose read takes a row-level lock
 * (`SELECT ... FOR UPDATE`), so two operators flipping different gates on the same
 * deployment serialize instead of one silently reverting the other. The stored config
 * is schema-validated before the merge: a corrupt config is rejected, never overwritten
 * blind. The merge (setGateModeInConfig) preserves all sibling sub-blocks.
 *
 * NOTE: the FOR UPDATE lock is exercised only against Postgres; CI runs db tests with a
 * mocked Prisma, so the unit tests cover the merge + org-scope + error paths, and the
 * lock correctness is the reviewed raw SQL.
 */
export class PrismaGovernanceGateModeWriter {
  constructor(private readonly prisma: PrismaClient) {}

  async setGateMode(input: SetGateModeInput): Promise<{ id: string; governanceConfig: unknown }> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ governanceConfig: unknown }>>`
        SELECT "governanceConfig" FROM "AgentDeployment"
        WHERE "id" = ${input.deploymentId} AND "organizationId" = ${input.organizationId}
        FOR UPDATE`;
      const [row] = rows;
      if (!row) throw new DeploymentNotFoundError(input.deploymentId);

      const parsed = GovernanceConfigSchema.safeParse(row.governanceConfig);
      if (!parsed.success) throw new GovernanceConfigInvalidError(input.deploymentId);

      const next = setGateModeInConfig(parsed.data, input.unit, input.mode);

      const updated = await tx.agentDeployment.updateMany({
        where: { id: input.deploymentId, organizationId: input.organizationId },
        data: { governanceConfig: next as object },
      });
      if (updated.count === 0) throw new DeploymentNotFoundError(input.deploymentId);

      return { id: input.deploymentId, governanceConfig: next };
    });
  }
}
