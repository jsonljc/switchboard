// ---------------------------------------------------------------------------
// Action: patient-engagement.conversation.escalate
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";

export async function executeEscalate(params: Record<string, unknown>): Promise<ExecuteResult> {
  const start = Date.now();
  const patientId = params.patientId as string;
  const reason = (params.reason as string) ?? "unspecified";

  return {
    success: true,
    summary: `Escalated conversation for patient ${patientId}. Reason: ${reason}`,
    externalRefs: { patientId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: {
      patientId,
      reason,
      escalatedAt: new Date().toISOString(),
      status: "pending_human_review",
    },
  };
}
