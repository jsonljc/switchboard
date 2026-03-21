// ---------------------------------------------------------------------------
// Optimisation Runner — nightly auto-optimisation job
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@switchboard/db";
import { runOptimisationCycle } from "@switchboard/core";
import { PrismaOutcomeStore } from "@switchboard/db";

interface OptimisationRunnerConfig {
  prisma: PrismaClient;
  intervalMs?: number;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export function startOptimisationRunner(config: OptimisationRunnerConfig): () => void {
  const intervalMs = config.intervalMs ?? 24 * 60 * 60 * 1000; // daily
  const store = new PrismaOutcomeStore(config.prisma);

  const timer = setInterval(async () => {
    try {
      // Find all orgs with learning enabled
      const orgs = await config.prisma.organizationConfig.findMany({
        select: { id: true },
      });

      for (const org of orgs) {
        try {
          const result = await runOptimisationCycle(org.id, store);

          if (result.proposals.length > 0) {
            config.logger.info(
              `[Optimisation] ${org.id}: ${result.proposals.length} proposals generated`,
            );

            // Persist proposals
            for (const proposal of result.proposals) {
              await config.prisma.optimisationProposal.create({
                data: {
                  id: proposal.id,
                  organizationId: proposal.organizationId,
                  type: proposal.type,
                  description: proposal.description,
                  currentValue: proposal.currentValue,
                  proposedValue: proposal.proposedValue,
                  confidence: proposal.confidence,
                  sampleSize: proposal.sampleSize,
                  status: proposal.status,
                },
              });
            }
          }
        } catch (err) {
          config.logger.error(`[Optimisation] Error for org ${org.id}:`, err);
        }
      }
    } catch (err) {
      config.logger.error("[Optimisation] Runner error:", err);
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
