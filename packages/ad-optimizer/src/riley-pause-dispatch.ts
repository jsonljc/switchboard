import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  RecommendationSurface,
} from "@switchboard/schemas";
import type { Evidence } from "./evidence-floor.js";
import type { HandoffCampaignContext } from "./recommendation-handoff-dispatch.js";
import { isPhaseCActionClassEligible } from "./action-contract.js";
import { meetsRileyPauseExecutionFloor } from "./riley-pause-execution-floor.js";

/**
 * PHASE-C pause dispatch (the initiator's Layer-2 half). Mirrors
 * recommendation-handoff-dispatch.ts: pure candidate decision here, injected
 * submitter callback wired by apps/api (this package never imports
 * PlatformIngress).
 *
 * PRIMARY-ONLY is structural: a candidate exists only at the arbitration
 * primary's index (parent spec section 3: self-execution honors the single
 * mutating primary; non-primary mutating candidates never self-submit).
 */
export interface RileyPauseCandidate {
  organizationId: string;
  /** Riley's own active per-org ad-optimizer deployment id (targetHint provenance). */
  deploymentId: string;
  recommendationId: string;
  campaignId: string;
  rationale: string;
  evidence: Evidence;
}

/**
 * Bootstrap-injected submit sink (apps/api). Returns PARK TRUTH: parked=true
 * only when the submit actually parked for approval (the approvalRequired
 * branch). Strict-truth riley_self ownership reads this; never report Riley
 * ownership of work that did not park. Best-effort: implementations never
 * throw into the audit.
 */
export type RileyPauseSubmitter = (candidate: RileyPauseCandidate) => Promise<{ parked: boolean }>;

export function buildRileyPauseCandidate(args: {
  emitted: {
    recommendationId: string;
    actionType: AdRecommendationAction;
    campaignId: string;
    rationale: string;
    surface: RecommendationSurface;
  };
  /** This recommendation's index in the final candidate set (entry identity). */
  index: number;
  /** The arbitration primary's index IF the primary is a pause; undefined otherwise. */
  primaryPauseIndex: number | undefined;
  context: HandoffCampaignContext | undefined;
  organizationId: string;
  deploymentId: string;
}): RileyPauseCandidate | null {
  const { emitted, index, primaryPauseIndex, context, organizationId, deploymentId } = args;
  if (emitted.actionType !== "pause") return null;
  if (primaryPauseIndex === undefined || index !== primaryPauseIndex) return null;
  if (emitted.surface === "dropped") return null;
  if (!context) return null;
  if (!deploymentId) return null;
  // Class eligibility consumed VERBATIM (never re-derived) + the raised floor.
  if (!isPhaseCActionClassEligible("pause")) return null;
  if (!meetsRileyPauseExecutionFloor(context.evidence)) return null;
  return {
    organizationId,
    deploymentId,
    recommendationId: emitted.recommendationId,
    campaignId: emitted.campaignId,
    rationale: emitted.rationale,
    evidence: context.evidence,
  };
}
