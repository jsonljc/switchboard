// ---------------------------------------------------------------------------
// Cadence Worker — Polls pending cadences and dispatches follow-up messages
// ---------------------------------------------------------------------------

import type { AgentNotifier } from "@switchboard/core";
import type { CadenceInstance, CadenceDefinition } from "@switchboard/customer-engagement";
import type { CadenceStore, CadenceInstanceRecord } from "@switchboard/db";
import { isWithinWhatsAppWindow } from "../adapters/whatsapp.js";
import { getThread } from "../conversation/threads.js";

export interface CadenceWorkerConfig {
  /** ProactiveSender for dispatching messages across channels. */
  notifier: AgentNotifier;
  /** Optional DB-backed cadence store. Falls back to in-memory. */
  cadenceStore?: CadenceStore;
  /** Evaluation interval in ms (default: 5 minutes). */
  intervalMs?: number;
  /** Callback for sending WhatsApp template messages when outside 24h window. */
  sendWhatsAppTemplate?: (
    chatId: string,
    templateName: string,
    languageCode: string,
  ) => Promise<void>;
}

// In-memory cadence state fallback
const cadenceInstances = new Map<string, CadenceInstance>();
const cadenceDefinitions = new Map<string, CadenceDefinition>();

export function registerCadenceDefinition(definition: CadenceDefinition): void {
  cadenceDefinitions.set(definition.id, definition);
}

export function startCadenceForContact(
  instance: CadenceInstance,
  cadenceStore?: CadenceStore,
): void {
  if (cadenceStore) {
    cadenceStore.save(toCadenceRecord(instance)).catch((err) => {
      console.error("[CadenceWorker] Failed to persist cadence instance:", err);
    });
  } else {
    cadenceInstances.set(instance.id, instance);
  }
}

/**
 * Start the cadence worker loop.
 * Returns a cleanup function to stop the worker.
 */
export function startCadenceWorker(config: CadenceWorkerConfig): () => void {
  const { notifier, cadenceStore, intervalMs = 5 * 60 * 1000, sendWhatsAppTemplate } = config;

  let stopped = false;

  // Lazy-load cadence scheduler to avoid circular deps
  let evaluatePendingCadences: typeof import("@switchboard/customer-engagement").evaluatePendingCadences;
  let applyCadenceEvaluation: typeof import("@switchboard/customer-engagement").applyCadenceEvaluation;
  let loaded = false;

  const loadDeps = async () => {
    if (loaded) return;
    const ce = await import("@switchboard/customer-engagement");
    evaluatePendingCadences = ce.evaluatePendingCadences;
    applyCadenceEvaluation = ce.applyCadenceEvaluation;
    loaded = true;
  };

  const getActiveInstances = async (): Promise<CadenceInstance[]> => {
    if (cadenceStore) {
      const records = await cadenceStore.getActive();
      return records.map(fromCadenceRecord);
    }
    return [...cadenceInstances.values()].filter((i) => i.status === "active");
  };

  const saveInstance = async (instance: CadenceInstance): Promise<void> => {
    if (cadenceStore) {
      await cadenceStore.save(toCadenceRecord(instance));
    } else {
      cadenceInstances.set(instance.id, instance);
    }
  };

  const runCycle = async () => {
    if (stopped) return;
    await loadDeps();
    if (!loaded) return;

    try {
      const instances = await getActiveInstances();
      if (instances.length === 0) return;

      const results = evaluatePendingCadences(instances, cadenceDefinitions, new Date());

      for (const { instanceId, evaluation } of results) {
        if (stopped) break;

        const instance =
          (cadenceStore
            ? fromCadenceRecord((await cadenceStore.getById(instanceId))!)
            : cadenceInstances.get(instanceId)) ?? null;
        if (!instance) continue;

        const updated = applyCadenceEvaluation(instance, evaluation);
        await saveInstance(updated);

        if (evaluation.completed || evaluation.skipped || !evaluation.shouldExecute) {
          continue;
        }

        // Resolve the conversation channel for this contact
        const channelId = instance.contactId;
        const conversation = await getThread(channelId);
        const channelType = conversation?.channel ?? "whatsapp";

        // WhatsApp 24h window check: use template message if outside window
        if (channelType === "whatsapp") {
          const lastInbound = conversation?.lastInboundAt ?? null;
          if (!isWithinWhatsAppWindow(lastInbound)) {
            if (sendWhatsAppTemplate) {
              try {
                await sendWhatsAppTemplate(channelId, "follow_up_notification", "en");
                console.warn(
                  `[CadenceWorker] WhatsApp 24h window expired for ${channelId}, ` +
                    `sent template message instead`,
                );
              } catch (templateErr) {
                console.error(
                  `[CadenceWorker] Failed to send WhatsApp template for ${channelId}:`,
                  templateErr,
                );
              }
            } else {
              console.warn(
                `[CadenceWorker] WhatsApp 24h window expired for ${channelId}, ` +
                  `no template sender configured — skipping`,
              );
            }
            continue;
          }
        }

        // Dispatch the follow-up message via ProactiveSender
        const messageText =
          (evaluation.parameters?.["message"] as string) ??
          (evaluation.parameters?.["body"] as string) ??
          "Just checking in — how can I help?";

        try {
          await notifier.sendProactive(channelId, channelType, messageText);
          console.warn(
            `[CadenceWorker] Sent cadence step to ${channelId} ` +
              `(cadence=${instance.cadenceDefinitionId}, step=${instance.currentStepIndex})`,
          );
        } catch (err) {
          console.error(`[CadenceWorker] Failed to send cadence step for ${instanceId}:`, err);
        }
      }
    } catch (err) {
      console.error("[CadenceWorker] Error in evaluation cycle:", err);
    }
  };

  // Run immediately, then on interval
  const firstRun = runCycle();
  firstRun.catch((err) => console.error("[CadenceWorker] First cycle error:", err));

  const timer = setInterval(() => {
    runCycle().catch((err) => console.error("[CadenceWorker] Cycle error:", err));
  }, intervalMs);

  console.warn(`[CadenceWorker] Started (interval=${intervalMs}ms)`);

  return () => {
    stopped = true;
    clearInterval(timer);
    console.warn("[CadenceWorker] Stopped");
  };
}

function toCadenceRecord(instance: CadenceInstance): CadenceInstanceRecord {
  return {
    id: instance.id,
    cadenceDefinitionId: instance.cadenceDefinitionId,
    patientId: instance.contactId,
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

function fromCadenceRecord(record: CadenceInstanceRecord): CadenceInstance {
  const stepStates = (record.stepStates ?? {}) as {
    completedSteps?: number[];
    skippedSteps?: number[];
    variables?: Record<string, unknown>;
  };
  return {
    id: record.id,
    cadenceDefinitionId: record.cadenceDefinitionId,
    contactId: record.patientId,
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
