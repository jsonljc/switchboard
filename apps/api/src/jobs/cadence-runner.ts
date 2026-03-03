// ---------------------------------------------------------------------------
// Cadence Cron Runner — Background job that evaluates and executes cadences
// ---------------------------------------------------------------------------

import type { StorageContext } from "@switchboard/core";
import type { CartridgeContext } from "@switchboard/cartridge-sdk";
import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";
import type { CadenceInstance, CadenceDefinition } from "@switchboard/patient-engagement";

export interface CadenceRunnerConfig {
  storageContext: StorageContext;
  /** Interval between cadence evaluation runs (default: 60s) */
  intervalMs?: number;
  logger?: Logger;
}

// In-memory cadence store for when Redis/DB is not available
const cadenceInstances = new Map<string, CadenceInstance>();
const cadenceDefinitions = new Map<string, CadenceDefinition>();

/**
 * Register a cadence definition so the runner knows about it.
 */
export function registerCadenceDefinition(definition: CadenceDefinition): void {
  cadenceDefinitions.set(definition.id, definition);
}

/**
 * Start a new cadence instance for a patient.
 */
export function startCadenceInstance(instance: CadenceInstance): void {
  cadenceInstances.set(instance.id, instance);
}

/**
 * Get all active cadence instances.
 */
export function getActiveCadenceInstances(): CadenceInstance[] {
  return [...cadenceInstances.values()].filter((i) => i.status === "active");
}

/**
 * Get a cadence instance by ID.
 */
export function getCadenceInstance(instanceId: string): CadenceInstance | null {
  return cadenceInstances.get(instanceId) ?? null;
}

/**
 * Start the cadence cron runner.
 * Periodically evaluates all active cadence instances and dispatches
 * due actions to the orchestrator for execution.
 *
 * Returns a cleanup function to stop the runner.
 */
export function startCadenceRunner(config: CadenceRunnerConfig): () => void {
  const { storageContext, intervalMs = 60_000, logger = createLogger("cadence-runner") } = config;

  let stopped = false;
  let inFlightPromise: Promise<void> | null = null;

  // Dynamic import to avoid circular deps at module load time
  let evaluatePendingCadences: typeof import("@switchboard/patient-engagement").evaluatePendingCadences;
  let applyCadenceEvaluation: typeof import("@switchboard/patient-engagement").applyCadenceEvaluation;
  let loaded = false;

  const loadDeps = async () => {
    if (loaded) return;
    try {
      const pe = await import("@switchboard/patient-engagement");
      evaluatePendingCadences = pe.evaluatePendingCadences;
      applyCadenceEvaluation = pe.applyCadenceEvaluation;
      loaded = true;
    } catch (err) {
      logger.error({ err }, "Failed to load cadence scheduler — runner disabled");
    }
  };

  const runCycle = async () => {
    if (stopped) return;
    await loadDeps();
    if (!loaded) return;

    try {
      const now = new Date();
      const instances = getActiveCadenceInstances();

      if (instances.length === 0) return;

      const results = evaluatePendingCadences(instances, cadenceDefinitions, now);

      let executed = 0;
      let skipped = 0;
      let completed = 0;

      for (const { instanceId, evaluation } of results) {
        if (stopped) break;

        const instance = cadenceInstances.get(instanceId);
        if (!instance) continue;

        // Apply evaluation to update instance state
        const updatedInstance = applyCadenceEvaluation(instance, evaluation);
        cadenceInstances.set(instanceId, updatedInstance);

        if (evaluation.completed) {
          completed++;
          logger.info({ instanceId, cadenceId: instance.cadenceDefinitionId }, "Cadence completed");
          continue;
        }

        if (evaluation.skipped) {
          skipped++;
          continue;
        }

        if (evaluation.shouldExecute && evaluation.actionType) {
          // Dispatch the action through the orchestrator
          const ctx: CartridgeContext = {
            principalId: "system:cadence-runner",
            organizationId: null,
            connectionCredentials: {},
          };
          try {
            await storageContext.cartridges
              .get("patient-engagement")
              ?.execute(evaluation.actionType, evaluation.parameters, ctx);
            executed++;
            logger.info(
              {
                instanceId,
                actionType: evaluation.actionType,
                patientId: instance.patientId,
              },
              "Cadence step executed",
            );
          } catch (err) {
            logger.error(
              {
                err,
                instanceId,
                actionType: evaluation.actionType,
              },
              "Failed to execute cadence step",
            );
          }
        }
      }

      if (executed > 0 || skipped > 0 || completed > 0) {
        logger.info(
          { executed, skipped, completed, total: instances.length },
          "Cadence run cycle complete",
        );
      }
    } catch (err) {
      logger.error({ err }, "Error in cadence runner cycle");
    }
  };

  // Run immediately on start, then on interval
  inFlightPromise = runCycle();

  const timer = setInterval(() => {
    inFlightPromise = runCycle();
  }, intervalMs);

  logger.info({ intervalMs }, "Cadence cron runner started");

  return () => {
    stopped = true;
    clearInterval(timer);
    if (inFlightPromise) {
      inFlightPromise.catch(() => {});
    }
    logger.info("Cadence cron runner stopped");
  };
}
