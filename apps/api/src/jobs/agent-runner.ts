// ---------------------------------------------------------------------------
// Agent Runner — Background cron job that ticks registered agents
// ---------------------------------------------------------------------------
// Follows the CadenceRunner pattern: setInterval + cleanup function.
// Evaluates AdsOperatorConfig schedules and dispatches agent ticks.
// ---------------------------------------------------------------------------

import {
  OptimizerAgent,
  ReporterAgent,
  MonitorAgent,
  GuardrailAgent,
  StrategistAgent,
  ProgressiveAutonomyController,
  automationLevelToProfile,
} from "@switchboard/core";
import type { AgentNotifier, AgentContext, AdsAgent, CompetenceSnapshot } from "@switchboard/core";
import type { AdsOperatorConfig } from "@switchboard/schemas";
import type {
  StorageContext,
  RuntimeOrchestrator,
  ResolvedProfile,
  ResolvedSkin,
} from "@switchboard/core";
import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";

export interface AgentRunnerConfig {
  storageContext: StorageContext;
  orchestrator: RuntimeOrchestrator;
  notifier: AgentNotifier;
  /** In-memory operator configs for dev; DB-backed in production. */
  operatorConfigs?: AdsOperatorConfig[];
  /** Async config loader — re-fetches active configs from DB each cycle. */
  configLoader?: () => Promise<AdsOperatorConfig[]>;
  /** Resolved business profile for StrategistAgent context (optional). */
  resolvedProfile?: ResolvedProfile | null;
  /** Resolved skin for StrategistAgent context (optional). */
  resolvedSkin?: ResolvedSkin | null;
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
    configLoader,
    resolvedProfile = null,
    resolvedSkin = null,
    intervalMs = 60_000,
    logger = createLogger("agent-runner"),
  } = config;

  let stopped = false;
  let inFlightPromise: Promise<void> | null = null;

  // Track last-run timestamps to prevent double-execution
  const lastRuns = new Map<string, AgentLastRun>();

  // Registered agent types
  const agents: AdsAgent[] = [
    new OptimizerAgent(),
    new ReporterAgent(),
    new MonitorAgent(),
    new GuardrailAgent(),
    new StrategistAgent(),
  ];

  async function getConfigs(): Promise<AdsOperatorConfig[]> {
    if (configLoader) return configLoader();
    return operatorConfigs.filter((c) => c.active);
  }

  function isDue(agentId: string, configId: string, cronHour: number, cronDay?: number): boolean {
    const key = `${agentId}:${configId}`;
    const now = new Date();
    const currentHour = now.getHours();

    if (currentHour !== cronHour) return false;

    // Weekly agents (e.g. strategist) only run on the specified day
    if (cronDay !== undefined && now.getDay() !== cronDay) return false;

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

  // Progressive autonomy controller — assesses governance promotions after agent ticks
  const autonomyController = new ProgressiveAutonomyController();
  // Track last autonomy assessment per config to avoid spamming
  const lastAutonomyAssessments = new Map<string, Date>();

  async function runCycle(): Promise<void> {
    if (stopped) return;

    try {
      const configs = await getConfigs();
      if (configs.length === 0) return;

      for (const opConfig of configs) {
        if (stopped) break;

        let anyAgentTicked = false;

        for (const agent of agents) {
          if (stopped) break;

          // Determine schedule based on agent type
          let cronHour: number;
          let cronDay: number | undefined;

          if (agent.id === "reporter" || agent.id === "monitor") {
            cronHour = opConfig.schedule.reportCronHour;
          } else if (agent.id === "strategist") {
            cronHour = opConfig.schedule.reportCronHour;
            cronDay = opConfig.schedule.strategistCronDay ?? 1; // default Monday
          } else {
            cronHour = opConfig.schedule.optimizerCronHour;
          }

          if (!isDue(agent.id, opConfig.id, cronHour, cronDay)) continue;

          const ctx: AgentContext = {
            config: opConfig,
            orchestrator: orchestrator as AgentContext["orchestrator"],
            storage: storageContext,
            notifier,
            profile: resolvedProfile ?? undefined,
            skin: resolvedSkin ?? undefined,
          };

          try {
            logger.info(
              { agentId: agent.id, configId: opConfig.id },
              `Ticking agent ${agent.name}`,
            );

            const result = await agent.tick(ctx);
            markRun(agent.id, opConfig.id);
            anyAgentTicked = true;

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

        // Assess autonomy progression after agents tick for this config
        if (anyAgentTicked) {
          await assessAutonomy(opConfig);
        }
      }
    } catch (err) {
      logger.error({ err }, "Error in agent runner cycle");
    }
  }

  async function assessAutonomy(opConfig: AdsOperatorConfig): Promise<void> {
    // Only assess once per day per config
    const lastAssessment = lastAutonomyAssessments.get(opConfig.id);
    if (lastAssessment) {
      const hoursSince = (Date.now() - lastAssessment.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 24) return;
    }

    try {
      const records = await storageContext.competence.listRecords(opConfig.principalId);
      if (records.length === 0) return;

      // Aggregate competence across all action types
      const snapshot: CompetenceSnapshot = {
        score: 0,
        successCount: 0,
        failureCount: 0,
        rollbackCount: 0,
      };

      for (const r of records) {
        snapshot.successCount += r.successCount;
        snapshot.failureCount += r.failureCount;
        snapshot.rollbackCount += r.rollbackCount;
        snapshot.score += r.score;
      }
      // Average score across action types
      snapshot.score = snapshot.score / records.length;

      const currentProfile = automationLevelToProfile(opConfig.automationLevel);
      const assessment = autonomyController.assess(currentProfile, snapshot);

      if (assessment.recommendedProfile !== assessment.currentProfile) {
        const message = autonomyController.formatAssessment(assessment);
        await notifier.sendProactive(
          opConfig.notificationChannel.chatId,
          opConfig.notificationChannel.type,
          message,
        );
        logger.info(
          {
            configId: opConfig.id,
            current: assessment.currentProfile,
            recommended: assessment.recommendedProfile,
          },
          "Autonomy promotion available",
        );
      } else if (assessment.autonomousEligible) {
        const message = autonomyController.formatAssessment(assessment);
        await notifier.sendProactive(
          opConfig.notificationChannel.chatId,
          opConfig.notificationChannel.type,
          message,
        );
      }

      lastAutonomyAssessments.set(opConfig.id, new Date());
    } catch (err) {
      logger.error({ err, configId: opConfig.id }, "Autonomy assessment failed");
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
