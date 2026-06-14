import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  RecommendationSurface,
} from "@switchboard/schemas";
import type { HandoffCampaignContext } from "./recommendation-handoff-dispatch.js";
import { buildRileyBudgetCandidate, type RileyBudgetSubmitter } from "./riley-budget-dispatch.js";
import { proposeCampaignReallocationCents } from "./budget-reallocation-plan.js";

/**
 * SPEC-1B 1B-1.6: the weekly-audit sink's reallocate dispatch. Extracted from recommendation-sink.ts
 * (which is at the arch line cap) so the propose-and-submit step is single-responsibility and unit
 * testable. Mirrors the pause dispatch block: a `scale` recommendation, with a known current daily
 * budget, becomes a proposed (x REALLOCATE_SCALE_FACTOR) reallocation candidate and is submitted
 * through the bootstrap-injected submitter (which parks it for mandatory approval). Pure decision +
 * best-effort submit: a submit throw never breaks the audit. Abstains silently (the candidate
 * builder owns the first-line abstention) when not a scale rec, when the current budget is unknown
 * (null -- e.g. an unreadable getCampaign at audit time), or on a zero-magnitude move.
 *
 * The caller gates on `rileyBudgetSubmitter && adAccountId && recommendationId` so that flag-off
 * (no submitter) makes this entirely inert -- no proposal, no Meta read upstream.
 */
export async function dispatchRileyBudgetReallocation(params: {
  rileyBudgetSubmitter: RileyBudgetSubmitter;
  recommendationId: string;
  actionType: AdRecommendationAction;
  campaignId: string;
  rationale: string;
  surface: RecommendationSurface;
  /** The live current daily budget read at audit time; null when unread/unreadable -> abstain. */
  currentDailyBudgetCents: number | null;
  context: HandoffCampaignContext | undefined;
  organizationId: string;
  deploymentId: string;
  adAccountId: string;
}): Promise<void> {
  const proposedDailyBudgetCents =
    params.currentDailyBudgetCents === null
      ? null
      : proposeCampaignReallocationCents(params.currentDailyBudgetCents);
  const candidate = buildRileyBudgetCandidate({
    emitted: {
      recommendationId: params.recommendationId,
      actionType: params.actionType,
      campaignId: params.campaignId,
      rationale: params.rationale,
      surface: params.surface,
    },
    currentDailyBudgetCents: params.currentDailyBudgetCents,
    proposedDailyBudgetCents,
    context: params.context,
    organizationId: params.organizationId,
    deploymentId: params.deploymentId,
    adAccountId: params.adAccountId,
  });
  if (!candidate) return;
  try {
    await params.rileyBudgetSubmitter(candidate);
  } catch (err) {
    console.warn(
      `[ad-optimizer] Riley reallocate submit threw for rec=${candidate.recommendationId}: ${String(err)}`,
    );
  }
}
