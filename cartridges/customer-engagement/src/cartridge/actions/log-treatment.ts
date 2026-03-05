// ---------------------------------------------------------------------------
// Action: customer-engagement.treatment.log
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";

export async function executeLogTreatment(params: Record<string, unknown>): Promise<ExecuteResult> {
  const start = Date.now();
  const contactId = params.contactId as string;
  const serviceType = params.serviceType as string;
  const value = Number(params.value ?? 0);
  const providerId = (params.providerId as string) ?? "unknown";
  const treatmentId = `treatment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    success: true,
    summary: `Logged ${serviceType} treatment for contact ${contactId} ($${value.toFixed(2)})`,
    externalRefs: { contactId, treatmentId, providerId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: {
      treatmentId,
      contactId,
      serviceType,
      value,
      providerId,
      completedAt: new Date().toISOString(),
    },
  };
}
