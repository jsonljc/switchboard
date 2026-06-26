import type { PrismaClient } from "@prisma/client";
import {
  GovernanceConfigSchema,
  setMarketInConfig,
  type Jurisdiction,
  type ClinicType,
} from "@switchboard/schemas";
import {
  DeploymentNotFoundError,
  GovernanceConfigInvalidError,
} from "./prisma-governance-gate-mode-writer.js";

export interface SetMarketInput {
  organizationId: string;
  deploymentId: string;
  jurisdiction: Jurisdiction;
  clinicType: ClinicType;
}

/**
 * Writes an AgentDeployment's market (`jurisdiction` + `clinicType`) onto its
 * governanceConfig, org-scoped and lost-update-safe under concurrent writes.
 *
 * Mirrors {@link PrismaGovernanceGateModeWriter}: the read-modify-write runs in a
 * transaction whose read takes a row-level lock (`SELECT ... FOR UPDATE`), so a market
 * update and a concurrent gate flip on the same deployment serialize instead of one
 * silently reverting the other. The stored config is schema-validated before the merge
 * (a corrupt config is rejected, never overwritten blind), and the merge
 * (setMarketInConfig) preserves every gate sub-block.
 *
 * Unlike the gate-mode flip, a market write has NO readiness gate: market is the org's
 * declaration of its clinic + jurisdiction, not a producer-gated capability.
 *
 * NOTE: the FOR UPDATE lock is exercised only against Postgres; CI runs db tests with a
 * mocked Prisma, so the unit tests cover the merge + org-scope + error paths, and the
 * lock correctness is the reviewed raw SQL (identical shape to the gate-mode writer).
 */
export class PrismaGovernanceMarketWriter {
  constructor(private readonly prisma: PrismaClient) {}

  async setMarket(input: SetMarketInput): Promise<{ id: string; governanceConfig: unknown }> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ governanceConfig: unknown }>>`
        SELECT "governanceConfig" FROM "AgentDeployment"
        WHERE "id" = ${input.deploymentId} AND "organizationId" = ${input.organizationId}
        FOR UPDATE`;
      const [row] = rows;
      if (!row) throw new DeploymentNotFoundError(input.deploymentId);

      const parsed = GovernanceConfigSchema.safeParse(row.governanceConfig);
      if (!parsed.success) throw new GovernanceConfigInvalidError(input.deploymentId);

      const next = setMarketInConfig(parsed.data, {
        jurisdiction: input.jurisdiction,
        clinicType: input.clinicType,
      });

      const updated = await tx.agentDeployment.updateMany({
        where: { id: input.deploymentId, organizationId: input.organizationId },
        data: { governanceConfig: next as object },
      });
      if (updated.count === 0) throw new DeploymentNotFoundError(input.deploymentId);

      return { id: input.deploymentId, governanceConfig: next };
    });
  }
}
