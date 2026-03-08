// ---------------------------------------------------------------------------
// Action: customer-engagement.lead.qualify
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ConversionBus } from "@switchboard/core";
import { computeLeadScore } from "../../core/scoring/lead-score.js";
import type { LeadScoreInput } from "../../core/types.js";

export async function executeQualifyLead(
  params: Record<string, unknown>,
  options?: { conversionBus?: ConversionBus; organizationId?: string },
): Promise<ExecuteResult> {
  const start = Date.now();
  const contactId = params.contactId as string;

  const scoreInput: LeadScoreInput = {
    serviceValue: Number(params.serviceValue ?? 0),
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
  const qualified = result.score >= 40;

  // Emit conversion event when lead qualifies
  if (qualified && options?.conversionBus && options.organizationId) {
    options.conversionBus.emit({
      type: "qualified",
      contactId,
      organizationId: options.organizationId,
      value: 5,
      sourceAdId: params.sourceAdId as string | undefined,
      sourceCampaignId: params.sourceCampaignId as string | undefined,
      timestamp: new Date(),
      metadata: { score: result.score, tier: result.tier },
    });
  }

  return {
    success: true,
    summary: `Lead ${contactId} ${qualified ? "qualified" : "not qualified"} (score: ${result.score}, tier: ${result.tier})`,
    externalRefs: { contactId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: { ...result, qualified },
  };
}
