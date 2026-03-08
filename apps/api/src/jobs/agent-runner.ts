// ---------------------------------------------------------------------------
// Agent Runner — Background cron job that ticks registered agents
// ---------------------------------------------------------------------------
// Follows the CadenceRunner pattern: setInterval + cleanup function.
// Evaluates AdsOperatorConfig schedules and dispatches agent ticks.
// ---------------------------------------------------------------------------

import { OptimizerAgent, ReporterAgent } from "@switchboard/core";
import type { AgentNotifier, AgentContext, AdsAgent } from "@switchboard/core";
import type { AdsOperatorConfig } from "@switchboard/schemas";
import type { StorageContext, RuntimeOrchestrator } from "@switchboard/core";
import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";

export interface AgentRunnerConfig {
  storageContext: StorageContext;
  orchestrator: RuntimeOrchestrator;
  notifier: AgentNotifier;
  /** In-memory operator configs for dev; DB-backed in production. */
  operatorConfigs?: AdsOperatorConfig[];
  /** Interval between schedule checks (default: 60s) */
  intervalMs?: number;
  logger?: Logger;
}

interface AgentLastRun {
  agentId: string;
  configId: string;
  lastRunAt: Date;
}

/**
 * Start the agent runner background job.
 * Periodically checks all active AdsOperatorConfig records and ticks
 * agents that are due to run based on their configured schedules.
 *
 * Returns a cleanup function to stop the runner.
 */
export function startAgentRunner(config: AgentRunnerConfig): () => void {
  const {
    storageContext,
    orchestrator,
    notifier,
    operatorConfigs = [],
    intervalMs = 60_000,
    logger = createLogger("agent-runner"),
  } = config;

  let stopped = false;
  let inFlightPromise: Promise<void> | null = null;

  // Track last-run timestamps to prevent double-execution
  const lastRuns = new Map<string, AgentLastRun>();

  // Registered agent types
  const agents: AdsAgent[] = [new OptimizerAgent(), new ReporterAgent()];

  function getConfigs(): AdsOperatorConfig[] {
    return operatorConfigs.filter((c) => c.active);
  }

  function isDue(agentId: string, configId: string, cronHour: number): boolean {
    const key = `${agentId}:${configId}`;
    const now = new Date();
    const currentHour = now.getHours();

    if (currentHour !== cronHour) return false;

    const lastRun = lastRuns.get(key);
    if (!lastRun) return true;

    // Don't run again if already run this hour
    const hoursSince = (now.getTime() - lastRun.lastRunAt.getTime()) / (1000 * 60 * 60);
    return hoursSince >= 1;
  }

  function markRun(agentId: string, configId: string): void {
    const key = `${agentId}:${configId}`;
    lastRuns.set(key, { agentId, configId, lastRunAt: new Date() });
  }

  async function runCycle(): Promise<void> {
    if (stopped) return;

    try {
      const configs = getConfigs();
      if (configs.length === 0) return;

      for (const opConfig of configs) {
        if (stopped) break;

        for (const agent of agents) {
          if (stopped) break;

          // Determine cron hour based on agent type
          const cronHour =
            agent.id === "reporter"
              ? opConfig.schedule.reportCronHour
              : opConfig.schedule.optimizerCronHour;

          if (!isDue(agent.id, opConfig.id, cronHour)) continue;

          const ctx: AgentContext = {
            config: opConfig,
            orchestrator: orchestrator as AgentContext["orchestrator"],
            storage: storageContext,
            notifier,
          };

          try {
            logger.info(
              { agentId: agent.id, configId: opConfig.id },
              `Ticking agent ${agent.name}`,
            );

            const result = await agent.tick(ctx);
            markRun(agent.id, opConfig.id);

            logger.info(
              {
                agentId: agent.id,
                configId: opConfig.id,
                actions: result.actions.length,
                summary: result.summary,
              },
              `Agent ${agent.name} tick complete`,
            );
          } catch (err) {
            logger.error(
              { err, agentId: agent.id, configId: opConfig.id },
              `Agent ${agent.name} tick failed`,
            );
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Error in agent runner cycle");
    }
  }

  // Run immediately on start, then on interval
  inFlightPromise = runCycle();

  const timer = setInterval(() => {
    inFlightPromise = runCycle();
  }, intervalMs);

  logger.info({ intervalMs }, "Agent runner started");

  return () => {
    stopped = true;
    clearInterval(timer);
    if (inFlightPromise) {
      inFlightPromise.catch(() => {});
    }
    logger.info("Agent runner stopped");
  };
}
