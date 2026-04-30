import type { WorkTraceStore } from "@switchboard/core/platform";
import { WorkTraceLockedError } from "@switchboard/core/platform";

export interface FinalizePatch {
  deliveryAttempted: boolean;
  deliveryResult: string;
  executionStartedAt: Date;
  completedAt: Date;
  caller: string;
}

// Atomically (per-row) finalize an operator-mutation WorkTrace after the route
// attempts channel delivery: merge the deliveryAttempted/deliveryResult fields
// into parameters.message and transition the trace from "running" to
// "completed" — the validator stamps lockedAt automatically on that
// transition (§4.7.1). Mid-flight seal by another writer is rare and not
// worth failing the operator's HTTP request, so we log + continue.
export async function finalizeOperatorTrace(
  store: WorkTraceStore,
  workUnitId: string,
  patch: FinalizePatch,
): Promise<void> {
  const existing = await store.getByWorkUnitId(workUnitId);
  if (!existing) {
    console.warn(`[${patch.caller}] WorkTrace ${workUnitId} missing on finalize`);
    return;
  }

  const params = (existing.trace.parameters ?? {}) as Record<string, unknown>;
  const existingMessage = (params["message"] ?? {}) as Record<string, unknown>;
  const nextParameters: Record<string, unknown> = {
    ...params,
    message: {
      ...existingMessage,
      deliveryAttempted: patch.deliveryAttempted,
      deliveryResult: patch.deliveryResult,
    },
  };

  const durationMs = Math.max(0, patch.completedAt.getTime() - patch.executionStartedAt.getTime());

  try {
    const result = await store.update(
      workUnitId,
      {
        parameters: nextParameters,
        outcome: "completed",
        executionStartedAt: patch.executionStartedAt.toISOString(),
        completedAt: patch.completedAt.toISOString(),
        durationMs,
      },
      { caller: patch.caller },
    );
    if (!result.ok) {
      console.warn(`[${patch.caller}] WorkTrace ${workUnitId} finalize rejected: ${result.reason}`);
    }
  } catch (err) {
    if (err instanceof WorkTraceLockedError) {
      console.warn(
        `[${patch.caller}] WorkTrace ${workUnitId} sealed mid-flight: ${err.diagnostic.reason}`,
      );
      return;
    }
    throw err;
  }
}
