// ---------------------------------------------------------------------------
// Action: patient-engagement.patient.score_ltv
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import { computeLTV } from "../../core/scoring/ltv-score.js";
import type { LTVScoreInput } from "../../core/types.js";

export async function executeScoreLTV(
  params: Record<string, unknown>,
): Promise<ExecuteResult> {
  const start = Date.now();
  const patientId = params.patientId as string;

  const input: LTVScoreInput = {
    averageTreatmentValue: Number(params.averageTreatmentValue ?? 0),
    visitFrequencyPerYear: Number(params.visitFrequency ?? 1),
    retentionYears: Number(params.retentionYears ?? 3),
    referralCount: Number(params.referralCount ?? 0),
    noShowCount: Number(params.noShowCount ?? 0),
    totalVisits: Number(params.totalVisits ?? 1),
  };

  const result = computeLTV(input);

  return {
    success: true,
    summary: `LTV for patient ${patientId}: $${result.estimatedLTV.toLocaleString()} (${result.tier})`,
    externalRefs: { patientId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: result,
  };
}
