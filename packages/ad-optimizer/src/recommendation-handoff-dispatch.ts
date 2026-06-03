import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  RecommendationSurface,
} from "@switchboard/schemas";
import type { Evidence } from "./evidence-floor.js";
import { shouldAbstainFromHandoff } from "./recommendation-handoff-abstention.js";

/**
 * Per-campaign context the weekly audit captured during its per-campaign loop
 * (evidence over the window + the campaign's learning-phase state). Needed so the
 * Riley -> agent handoff can re-run the SAME abstention the recommendation engine
 * applied, and so the handler's defense-in-depth check sees the same inputs.
 */
export interface HandoffCampaignContext {
  evidence: Evidence;
  /** True when the campaign is in Meta's learning phase (a learning-reset would hurt). */
  learningPhaseActive: boolean;
}

/**
 * Build a per-campaign handoff context from the campaign's window insight. Maps the
 * insight's link clicks + conversions (over `windowDays`) into the Evidence the
 * abstention re-checks. Pure; the single home for the insight -> evidence field map.
 */
export function handoffContextFromInsight(
  insight: { inlineLinkClicks: number; conversions: number },
  windowDays: number,
  learningPhaseActive: boolean,
): HandoffCampaignContext {
  return {
    evidence: {
      clicks: insight.inlineLinkClicks,
      conversions: insight.conversions,
      days: windowDays,
    },
    learningPhaseActive,
  };
}

/**
 * A ready-to-route Riley -> agent handoff, MINUS the brief and the resolved
 * deployment slug. The bootstrap layer (apps/api) resolves a creative brief and
 * builds the canonical submit request from this; ad-optimizer (Layer 2) never
 * imports PlatformIngress, so the actual submit is the injected callback below.
 */
export interface RecommendationHandoffCandidate {
  organizationId: string;
  /** The org's active ad-optimizer (Riley) deployment id — the submit's targetHint. */
  deploymentId: string;
  recommendationId: string;
  actionType: AdRecommendationAction;
  campaignId: string;
  rationale: string;
  evidence: Evidence;
  learningPhaseActive: boolean;
}

/**
 * The bootstrap-injected submit sink. In production it resolves a brief + the
 * deployment, builds the canonical request, and submits through PlatformIngress
 * (parking for mandatory human approval). Best-effort: the cron is retryable and a
 * handoff failure must never break the weekly audit, so the implementation never
 * throws.
 */
export type RecommendationHandoffSubmitter = (
  candidate: RecommendationHandoffCandidate,
) => Promise<void>;

/** The minimal projection of an emitted recommendation the dispatch reads. */
export interface HandoffEmittedRecommendation {
  recommendationId: string;
  actionType: AdRecommendationAction;
  campaignId: string;
  rationale: string;
  surface: RecommendationSurface;
}

/**
 * Decide whether ONE emitted recommendation becomes a handoff candidate. Returns
 * null (do NOT hand off) when the recommendation was dropped by the router (Riley
 * did not surface it), has no captured per-campaign context, or Riley should
 * abstain (non-creative/unroutable action, below the evidence floor, or
 * learning-locked). Pure + deterministic so it mirrors the request builder's
 * defense-in-depth abstention from the same inputs.
 */
export function buildHandoffCandidate(args: {
  emitted: HandoffEmittedRecommendation;
  context: HandoffCampaignContext | undefined;
  organizationId: string;
  deploymentId: string;
}): RecommendationHandoffCandidate | null {
  const { emitted, context, organizationId, deploymentId } = args;
  // A dropped recommendation is one Riley judged not worth surfacing — never a
  // governed approval task.
  if (emitted.surface === "dropped") return null;
  if (!context) return null;
  const abstention = shouldAbstainFromHandoff({
    actionType: emitted.actionType,
    evidence: context.evidence,
    learningPhaseActive: context.learningPhaseActive,
  });
  if (abstention.abstain) return null;
  return {
    organizationId,
    deploymentId,
    recommendationId: emitted.recommendationId,
    actionType: emitted.actionType,
    campaignId: emitted.campaignId,
    rationale: emitted.rationale,
    evidence: context.evidence,
    learningPhaseActive: context.learningPhaseActive,
  };
}
