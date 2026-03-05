// ---------------------------------------------------------------------------
// Action: customer-engagement.contact.score_ltv
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import { computeLTV } from "../../core/scoring/ltv-score.js";
import type { LTVScoringConfig } from "../../core/scoring/ltv-score.js";
import type { LTVScoreInput } from "../../core/types.js";

export async function executeScoreLTV(
  params: Record<string, unknown>,
  config?: LTVScoringConfig,
): Promise<ExecuteResult> {
  const start = Date.now();
  const contactId = params.contactId as string;

  const input: LTVScoreInput = {
    averageServiceValue: Number(params.averageServiceValue ?? 0),
    visitFrequencyPerYear: Number(params.visitFrequency ?? 1),
    retentionYears: Number(params.retentionYears ?? 3),
    referralCount: Number(params.referralCount ?? 0),
    noShowCount: Number(params.noShowCount ?? 0),
    totalVisits: Number(params.totalVisits ?? 1),
  };

  const result = computeLTV(input, config);

  return {
    success: true,
    summary: `LTV for contact ${contactId}: $${result.estimatedLTV.toLocaleString()} (${result.tier})`,
    externalRefs: { contactId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: result,
  };
}
