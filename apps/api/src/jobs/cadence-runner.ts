// ---------------------------------------------------------------------------
// Cadence Cron Runner — Background job that evaluates and executes cadences
// ---------------------------------------------------------------------------

import type { StorageContext } from "@switchboard/core";
import type { CartridgeContext } from "@switchboard/cartridge-sdk";
import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";
import type { CadenceInstance, CadenceDefinition } from "@switchboard/patient-engagement";
import type { CadenceStore, CadenceInstanceRecord } from "@switchboard/db";

export interface CadenceRunnerConfig {
  storageContext: StorageContext;
  /** Optional DB-backed cadence store. When provided, cadence state is persisted. */
  cadenceStore?: CadenceStore;
  /** Interval between cadence evaluation runs (default: 60s) */
  intervalMs?: number;
  logger?: Logger;
}

// In-memory cadence store fallback for when no DB store is provided
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
export function startCadenceInstance(instance: CadenceInstance, cadenceStore?: CadenceStore): void {
  if (cadenceStore) {
    cadenceStore.save(toCadenceRecord(instance)).catch(() => {});
  } else {
    cadenceInstances.set(instance.id, instance);
  }
}

/**
 * Get all active cadence instances.
 */
export async function getActiveCadenceInstances(
  cadenceStore?: CadenceStore,
): Promise<CadenceInstance[]> {
  if (cadenceStore) {
    const records = await cadenceStore.getActive();
    return records.map(fromCadenceRecord);
  }
  return [...cadenceInstances.values()].filter((i) => i.status === "active");
}

/**
 * Get a cadence instance by ID.
 */
export async function getCadenceInstance(
  instanceId: string,
  cadenceStore?: CadenceStore,
): Promise<CadenceInstance | null> {
  if (cadenceStore) {
    const record = await cadenceStore.getById(instanceId);
    return record ? fromCadenceRecord(record) : null;
  }
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
  const {
    storageContext,
    cadenceStore,
    intervalMs = 60_000,
    logger = createLogger("cadence-runner"),
  } = config;

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

  const saveCadenceInstance = async (instance: CadenceInstance): Promise<void> => {
    if (cadenceStore) {
      await cadenceStore.save(toCadenceRecord(instance));
    } else {
      cadenceInstances.set(instance.id, instance);
    }
  };

  const loadCadenceInstance = async (instanceId: string): Promise<CadenceInstance | null> => {
    if (cadenceStore) {
      const record = await cadenceStore.getById(instanceId);
      return record ? fromCadenceRecord(record) : null;
    }
    return cadenceInstances.get(instanceId) ?? null;
  };

  const runCycle = async () => {
    if (stopped) return;
    await loadDeps();
    if (!loaded) return;

    try {
      const now = new Date();
      const instances = await getActiveCadenceInstances(cadenceStore);

      if (instances.length === 0) return;

      const results = evaluatePendingCadences(instances, cadenceDefinitions, now);

      let executed = 0;
      let skipped = 0;
      let completed = 0;

      for (const { instanceId, evaluation } of results) {
        if (stopped) break;

        const instance = await loadCadenceInstance(instanceId);
        if (!instance) continue;

        // Apply evaluation to update instance state
        const updatedInstance = applyCadenceEvaluation(instance, evaluation);
        await saveCadenceInstance(updatedInstance);

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

/** Convert a CadenceInstance to a DB record */
function toCadenceRecord(instance: CadenceInstance): CadenceInstanceRecord {
  return {
    id: instance.id,
    cadenceDefinitionId: instance.cadenceDefinitionId,
    patientId: instance.patientId,
    organizationId: instance.organizationId,
    status: instance.status,
    currentStepIndex: instance.currentStepIndex,
    stepStates: {
      completedSteps: instance.completedSteps,
      skippedSteps: instance.skippedSteps,
      variables: instance.variables,
    },
    startedAt: instance.startedAt,
    lastEvaluatedAt: new Date(),
    nextEvaluationAt: instance.nextExecutionAt,
    completedAt: instance.status === "completed" ? new Date() : null,
    createdAt: instance.startedAt,
    updatedAt: new Date(),
  };
}

/** Convert a DB record back to a CadenceInstance */
function fromCadenceRecord(record: CadenceInstanceRecord): CadenceInstance {
  const stepStates = (record.stepStates ?? {}) as {
    completedSteps?: number[];
    skippedSteps?: number[];
    variables?: Record<string, unknown>;
  };
  return {
    id: record.id,
    cadenceDefinitionId: record.cadenceDefinitionId,
    patientId: record.patientId,
    organizationId: record.organizationId ?? "",
    status: record.status as CadenceInstance["status"],
    currentStepIndex: record.currentStepIndex,
    startedAt: record.startedAt,
    nextExecutionAt: record.nextEvaluationAt,
    variables: stepStates.variables ?? {},
    completedSteps: stepStates.completedSteps ?? [],
    skippedSteps: stepStates.skippedSteps ?? [],
  };
}
