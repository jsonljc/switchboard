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
import type {
  AgentNotifier,
  AgentContext,
  AdsAgent,
  CompetenceSnapshot,
  AuditLedger,
} from "@switchboard/core";
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
  /** Audit ledger for recording agent tick results (optional). */
  ledger?: AuditLedger | null;
  /** Interval between schedule checks (default: 60s) */
  intervalMs?: number;
  logger?: Logger;
}

interface AgentLastRun {
  agentId: string;
  configId: string;
  lastRunAt: Date;
}

export interface AgentRunGate {
  tryAcquire(slotKey: string, ttlSeconds: number): Promise<boolean>;
}

export function createInMemoryAgentRunGate(): AgentRunGate {
  const slots = new Map<string, number>();
  return {
    async tryAcquire(slotKey: string, ttlSeconds: number): Promise<boolean> {
      const now = Date.now();
      const expiresAt = slots.get(slotKey);
      if (expiresAt && expiresAt > now) {
        return false;
      }
      slots.set(slotKey, now + ttlSeconds * 1000);
      return true;
    },
  };
}

export function createRedisAgentRunGate(redis: {
  set: (
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
    condition: "NX",
  ) => Promise<unknown>;
}): AgentRunGate {
  return {
    async tryAcquire(slotKey: string, ttlSeconds: number): Promise<boolean> {
      const result = await redis.set(`agent-run:${slotKey}`, "1", "EX", ttlSeconds, "NX");
      return result === "OK";
    },
  };
}

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

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
    ledger = null,
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

  function getScheduleClock(timezone: string): { hour: number; day: number } {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
      weekday: "short",
    }).formatToParts(new Date());

    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
    return {
      hour,
      day: WEEKDAY_TO_INDEX[weekday] ?? 0,
    };
  }

  function isDue(
    agentId: string,
    configId: string,
    timezone: string,
    cronHour: number,
    cronDay?: number,
  ): boolean {
    const key = `${agentId}:${configId}`;
    const now = new Date();
    const clock = getScheduleClock(timezone);

    if (clock.hour !== cronHour) return false;

    // Weekly agents (e.g. strategist) only run on the specified day
    if (cronDay !== undefined && clock.day !== cronDay) return false;

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

          if (!isDue(agent.id, opConfig.id, opConfig.schedule.timezone, cronHour, cronDay))
            continue;

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

            // Record agent tick to audit ledger so dashboard can show agent activity
            if (ledger) {
              try {
                for (const action of result.actions) {
                  await ledger.record({
                    eventType: "action.executed",
                    actorType: "agent",
                    actorId: agent.id,
                    entityType: "ads_operator_config",
                    entityId: opConfig.id,
                    riskCategory: "low",
                    summary: `[${agent.name}] ${action.actionType}: ${action.outcome}`,
                    snapshot: {
                      agentId: agent.id,
                      configId: opConfig.id,
                      actionType: action.actionType,
                      outcome: action.outcome,
                      tickSummary: result.summary,
                    },
                    organizationId: opConfig.organizationId,
                    visibilityLevel: "org",
                  });
                }
              } catch (auditErr) {
                logger.error(
                  { err: auditErr, agentId: agent.id, configId: opConfig.id },
                  "Failed to record agent tick to audit ledger",
                );
              }
            }
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

export async function runAgentRunnerCycle(
  config: AgentRunnerConfig & { runGate?: AgentRunGate },
): Promise<void> {
  const {
    storageContext,
    orchestrator,
    notifier,
    runGate = createInMemoryAgentRunGate(),
    operatorConfigs = [],
    configLoader,
    resolvedProfile = null,
    resolvedSkin = null,
    ledger = null,
    logger = createLogger("agent-runner"),
  } = config;

  const agents: AdsAgent[] = [
    new OptimizerAgent(),
    new ReporterAgent(),
    new MonitorAgent(),
    new GuardrailAgent(),
    new StrategistAgent(),
  ];
  const autonomyController = new ProgressiveAutonomyController();

  const getConfigs = async (): Promise<AdsOperatorConfig[]> => {
    if (configLoader) return configLoader();
    return operatorConfigs.filter((entry) => entry.active);
  };

  const getScheduleClock = (timezone: string): { hour: number; day: number } => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
      weekday: "short",
    }).formatToParts(new Date());

    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
    return {
      hour,
      day: WEEKDAY_TO_INDEX[weekday] ?? 0,
    };
  };

  const buildRunSlotKey = (
    agentId: string,
    configId: string,
    timezone: string,
    cronHour: number,
    cronDay?: number,
  ): string | null => {
    const clock = getScheduleClock(timezone);
    if (clock.hour !== cronHour) return null;
    if (cronDay !== undefined && clock.day !== cronDay) return null;
    const now = new Date();
    const dateKey = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}-${cronHour}`;
    return `${agentId}:${configId}:${dateKey}`;
  };

  const assessAutonomy = async (opConfig: AdsOperatorConfig): Promise<void> => {
    const canAssess = await runGate.tryAcquire(`autonomy:${opConfig.id}`, 24 * 60 * 60);
    if (!canAssess) {
      return;
    }

    try {
      const records = await storageContext.competence.listRecords(opConfig.principalId);
      if (records.length === 0) return;

      const snapshot: CompetenceSnapshot = {
        score: 0,
        successCount: 0,
        failureCount: 0,
        rollbackCount: 0,
      };

      for (const record of records) {
        snapshot.successCount += record.successCount;
        snapshot.failureCount += record.failureCount;
        snapshot.rollbackCount += record.rollbackCount;
        snapshot.score += record.score;
      }
      snapshot.score = snapshot.score / records.length;

      const currentProfile = automationLevelToProfile(opConfig.automationLevel);
      const assessment = autonomyController.assess(currentProfile, snapshot);
      if (
        assessment.recommendedProfile !== assessment.currentProfile ||
        assessment.autonomousEligible
      ) {
        await notifier.sendProactive(
          opConfig.notificationChannel.chatId,
          opConfig.notificationChannel.type,
          autonomyController.formatAssessment(assessment),
        );
      }
    } catch (err) {
      logger.error({ err, configId: opConfig.id }, "Autonomy assessment failed");
    }
  };

  try {
    const configs = await getConfigs();
    if (configs.length === 0) return;

    for (const opConfig of configs) {
      let anyAgentTicked = false;

      for (const agent of agents) {
        let cronHour: number;
        let cronDay: number | undefined;
        if (agent.id === "reporter" || agent.id === "monitor") {
          cronHour = opConfig.schedule.reportCronHour;
        } else if (agent.id === "strategist") {
          cronHour = opConfig.schedule.reportCronHour;
          cronDay = opConfig.schedule.strategistCronDay ?? 1;
        } else {
          cronHour = opConfig.schedule.optimizerCronHour;
        }

        const runSlotKey = buildRunSlotKey(
          agent.id,
          opConfig.id,
          opConfig.schedule.timezone,
          cronHour,
          cronDay,
        );
        if (!runSlotKey) continue;

        const acquired = await runGate.tryAcquire(runSlotKey, 60 * 60 + 300);
        if (!acquired) continue;

        const ctx: AgentContext = {
          config: opConfig,
          orchestrator: orchestrator as AgentContext["orchestrator"],
          storage: storageContext,
          notifier,
          profile: resolvedProfile ?? undefined,
          skin: resolvedSkin ?? undefined,
        };

        try {
          const result = await agent.tick(ctx);
          anyAgentTicked = true;

          if (ledger) {
            for (const action of result.actions) {
              await ledger.record({
                eventType: "action.executed",
                actorType: "agent",
                actorId: agent.id,
                entityType: "ads_operator_config",
                entityId: opConfig.id,
                riskCategory: "low",
                summary: `[${agent.name}] ${action.actionType}: ${action.outcome}`,
                snapshot: {
                  agentId: agent.id,
                  configId: opConfig.id,
                  actionType: action.actionType,
                  outcome: action.outcome,
                  tickSummary: result.summary,
                },
                organizationId: opConfig.organizationId,
                visibilityLevel: "org",
              });
            }
          }
        } catch (err) {
          logger.error(
            { err, agentId: agent.id, configId: opConfig.id },
            `Agent ${agent.name} tick failed`,
          );
        }
      }

      if (anyAgentTicked) {
        await assessAutonomy(opConfig);
      }
    }
  } catch (err) {
    logger.error({ err }, "Error in agent runner cycle");
  }
}
