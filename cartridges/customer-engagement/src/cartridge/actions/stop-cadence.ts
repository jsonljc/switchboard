// ---------------------------------------------------------------------------
// Action: customer-engagement.cadence.stop
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";

export async function executeStopCadence(params: Record<string, unknown>): Promise<ExecuteResult> {
  const start = Date.now();
  const cadenceInstanceId = params.cadenceInstanceId as string;
  const reason = (params.reason as string) ?? "manual";

  return {
    success: true,
    summary: `Stopped cadence ${cadenceInstanceId}. Reason: ${reason}`,
    externalRefs: { cadenceInstanceId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: { cadenceInstanceId, status: "stopped", reason },
  };
}
