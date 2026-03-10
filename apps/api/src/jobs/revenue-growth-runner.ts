// ---------------------------------------------------------------------------
// Revenue Growth Runner — Background job that ticks the RevenueGrowthAgent
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";

export interface RevGrowthRunnerConfig {
  prisma: import("@switchboard/db").PrismaClient;
  intervalMs?: number;
  logger?: Logger;
}

export async function runRevGrowthCycleOnce(config: RevGrowthRunnerConfig): Promise<void> {
  const { prisma, logger = createLogger("revenue-growth-runner") } = config;

  try {
    const {
      PrismaInterventionStore,
      PrismaDiagnosticCycleStore,
      PrismaRevenueAccountStore,
      PrismaWeeklyDigestStore,
    } = await import("@switchboard/db");

    const { RevenueGrowthAgent } = await import("@switchboard/revenue-growth");
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

    const agent = new RevenueGrowthAgent(deps);

    // Agent tick handles due accounts internally
    const result = await agent.tick({
      config: {} as never,
      orchestrator: {} as never,
      storage: {} as never,
      notifier: { sendProactive: async () => {} },
    });

    logger.info(
      { actions: result.actions.length, summary: result.summary },
      "Revenue growth cycle complete",
    );
  } catch (err) {
    logger.error({ err }, "Revenue growth cycle failed");
  }
}

export function startRevGrowthRunner(config: RevGrowthRunnerConfig): () => void {
  const { intervalMs = 60 * 60 * 1000, logger = createLogger("revenue-growth-runner") } = config;

  let stopped = false;

  const run = async () => {
    if (stopped) return;
    await runRevGrowthCycleOnce(config);
  };

  // Run immediately then on interval
  run().catch((err) => logger.error({ err }, "Initial revenue growth cycle failed"));
  const timer = setInterval(() => {
    run().catch((err) => logger.error({ err }, "Revenue growth cycle failed"));
  }, intervalMs);

  logger.info({ intervalMs }, "Revenue growth runner started");

  return () => {
    stopped = true;
    clearInterval(timer);
    logger.info("Revenue growth runner stopped");
  };
}
