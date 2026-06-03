import type { WorkflowHandler } from "@switchboard/core/platform";
import { RecommendationHandoffInput, CreativeConceptDraftInput } from "@switchboard/schemas";
import { shouldAbstainFromHandoff } from "@switchboard/ad-optimizer";

/**
 * Contract 3 (Riley -> agent advisory->action handoff). This handler runs AFTER
 * the handoff intent has parked for and received mandatory human approval (the
 * seeded require_approval policy gates it). On execution it:
 *
 *   1. Validates the RecommendationHandoffInput (fail closed: INVALID_HANDOFF).
 *   2. Re-checks abstention as DEFENSE IN DEPTH (the cron initiator already
 *      abstains before submitting; the handler abstains again so a hand-built or
 *      replayed submit can never create a draft it should not). Abstention is a
 *      deliberate no-op (outcome:"completed", abstained:true), NOT a failure.
 *   3. Maps the recommendation to a creative.concept.draft brief and submits it as
 *      a draft-only child through the one front door (services.submitChildWork) -
 *      the child re-runs governance and is draft-only (no spend, no pipeline).
 *
 * Riley gains no budget authority: the draft is a no-spend CreativeJob row a human
 * later funds. The handoff itself is what a human approved.
 */
export function buildRecommendationHandoffWorkflow(): WorkflowHandler {
  return {
    async execute(workUnit, services) {
      const parsed = RecommendationHandoffInput.safeParse(workUnit.parameters);
      if (!parsed.success) {
        return {
          outcome: "failed",
          summary: "Recommendation handoff payload is invalid",
          error: { code: "INVALID_HANDOFF", message: parsed.error.message },
        };
      }
      const input = parsed.data;

      // learningPhaseActive rides on the parameters (the cron stamps what it knew
      // at submit time). Default false when absent.
      const learningPhaseActive = Boolean(
        (workUnit.parameters as { learningPhaseActive?: boolean }).learningPhaseActive,
      );

      const abstention = shouldAbstainFromHandoff({
        actionType: input.actionType,
        evidence: input.evidence,
        learningPhaseActive,
      });
      if (abstention.abstain) {
        return {
          outcome: "completed",
          summary: `Abstained from handoff (${abstention.reason})`,
          outputs: { abstained: true, reason: abstention.reason },
        };
      }

      // Map the recommendation to a draft brief. The brief fields come from the
      // submit (the cron resolves a product/audience from the campaign); parse with
      // the centralized Seam-1 type so a bad brief fails closed here.
      const briefParsed = CreativeConceptDraftInput.safeParse(
        (workUnit.parameters as { brief?: unknown }).brief,
      );
      if (!briefParsed.success) {
        return {
          outcome: "failed",
          summary: "Handoff brief is invalid",
          error: { code: "INVALID_HANDOFF", message: briefParsed.error.message },
        };
      }

      const child = await services.submitChildWork({
        intent: "creative.concept.draft",
        organizationId: workUnit.organizationId,
        actor: workUnit.actor,
        parentWorkUnitId: workUnit.id,
        // Deterministic: one draft per recommendation+action. PlatformIngress's
        // claim-first guard dedups a replayed handoff.
        idempotencyKey: `handoff-draft:${input.recommendationId}:${input.actionType}`,
        parameters: {
          brief: {
            productDescription: briefParsed.data.productDescription,
            targetAudience: briefParsed.data.targetAudience,
            ...(briefParsed.data.valueContext
              ? { valueContext: briefParsed.data.valueContext }
              : {}),
          },
        },
      });

      if (!child.ok) {
        return {
          outcome: "failed",
          summary: "Creative draft child submit failed",
          outputs: { recommendationId: input.recommendationId },
          error: { code: "CHILD_DRAFT_FAILED", message: child.error.message },
        };
      }

      return {
        outcome: "completed",
        summary: "Routed Riley recommendation to a Mira creative draft",
        outputs: { recommendationId: input.recommendationId, child: child.workUnit?.id },
      };
    },
  };
}
