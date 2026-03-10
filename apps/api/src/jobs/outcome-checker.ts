// ---------------------------------------------------------------------------
// Outcome Checker — Background job that evaluates intervention outcomes
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";

export interface OutcomeCheckerConfig {
  prisma: import("@switchboard/db").PrismaClient;
  intervalMs?: number;
  logger?: Logger;
}

export async function runOutcomeCheckOnce(config: OutcomeCheckerConfig): Promise<void> {
  const { prisma, logger = createLogger("outcome-checker") } = config;

  try {
    const {
      PrismaInterventionStore,
      PrismaDiagnosticCycleStore,
      PrismaRevenueAccountStore,
      PrismaWeeklyDigestStore,
    } = await import("@switchboard/db");

    const { checkOutcomes } = await import("@switchboard/revenue-growth");
    type RevGrowthDeps = import("@switchboard/revenue-growth").RevGrowthDeps;

    // Prisma stores return loosely-typed JSON columns; cast to match the
    // cartridge's Zod-narrowed interface via structural typing bridge.
    const deps = {
      connectors: [],
      interventionStore: new PrismaInterventionStore(prisma),
      cycleStore: new PrismaDiagnosticCycleStore(prisma),
      accountStore: new PrismaRevenueAccountStore(prisma),
      digestStore: new PrismaWeeklyDigestStore(prisma),
    } as unknown as RevGrowthDeps;

    // Check outcomes — uses a default account context since outcome checking
    // iterates over all pending interventions regardless of account
    const results = await checkOutcomes(deps, "system", "system");

    if (results.length > 0) {
      logger.info(
        {
          count: results.length,
          outcomes: results.map(
            (r: { constraintType: string; outcome: string }) => `${r.constraintType}=${r.outcome}`,
          ),
        },
        "Outcome check complete",
      );
    }
  } catch (err) {
    logger.error({ err }, "Outcome check failed");
  }
}

export function startOutcomeChecker(config: OutcomeCheckerConfig): () => void {
  const { intervalMs = 6 * 60 * 60 * 1000, logger = createLogger("outcome-checker") } = config;

  let stopped = false;

  const run = async () => {
    if (stopped) return;
    await runOutcomeCheckOnce(config);
  };

  run().catch((err) => logger.error({ err }, "Initial outcome check failed"));
  const timer = setInterval(() => {
    run().catch((err) => logger.error({ err }, "Outcome check failed"));
  }, intervalMs);

  logger.info({ intervalMs }, "Outcome checker started");

  return () => {
    stopped = true;
    clearInterval(timer);
    logger.info("Outcome checker stopped");
  };
}
