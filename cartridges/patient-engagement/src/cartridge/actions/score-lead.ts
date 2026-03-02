// ---------------------------------------------------------------------------
// Action: patient-engagement.lead.score
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import { computeLeadScore } from "../../core/scoring/lead-score.js";
import type { LeadScoreInput } from "../../core/types.js";

export async function executeScoreLead(
  params: Record<string, unknown>,
): Promise<ExecuteResult> {
  const start = Date.now();
  const patientId = params.patientId as string;

  const scoreInput: LeadScoreInput = {
    treatmentValue: Number(params.treatmentValue ?? 0),
    urgencyLevel: Number(params.urgencyLevel ?? 5),
    hasInsurance: Boolean(params.hasInsurance),
    isReturning: Boolean(params.isReturning),
    source: (params.source as LeadScoreInput["source"]) ?? "other",
    engagementScore: Number(params.engagementScore ?? 5),
    responseSpeedMs: params.responseSpeedMs != null ? Number(params.responseSpeedMs) : null,
    hasMedicalHistory: Boolean(params.hasMedicalHistory),
    budgetIndicator: Number(params.budgetIndicator ?? 5),
    eventDriven: Boolean(params.eventDriven),
  };

  const result = computeLeadScore(scoreInput);

  return {
    success: true,
    summary: `Lead score for ${patientId}: ${result.score} (${result.tier})`,
    externalRefs: { patientId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: result,
  };
}
