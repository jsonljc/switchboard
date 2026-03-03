// ---------------------------------------------------------------------------
// Action: patient-engagement.treatment.log
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";

export async function executeLogTreatment(params: Record<string, unknown>): Promise<ExecuteResult> {
  const start = Date.now();
  const patientId = params.patientId as string;
  const treatmentType = params.treatmentType as string;
  const value = Number(params.value ?? 0);
  const providerId = (params.providerId as string) ?? "unknown";
  const treatmentId = `treatment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    success: true,
    summary: `Logged ${treatmentType} treatment for patient ${patientId} ($${value.toFixed(2)})`,
    externalRefs: { patientId, treatmentId, providerId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: {
      treatmentId,
      patientId,
      treatmentType,
      value,
      providerId,
      completedAt: new Date().toISOString(),
    },
  };
}
