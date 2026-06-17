import type { WorkflowHandler } from "@switchboard/core/platform";
import { RecommendationHandoffInput, CreativeConceptDraftInput } from "@switchboard/schemas";
import { shouldAbstainFromHandoff } from "@switchboard/ad-optimizer";

/**
 * resolvedBy sentinel for handoff-executed transitions. A distinct machine
 * identifier (never a human principal id, never the pause/reallocate values): the
 * approver approved the handoff, the platform created the draft. Distinct from the
 * pause/reallocate sentinels so the audit row records the right machine
 * provenance for a creative handoff act.
 */
export const HANDOFF_EXECUTION_RESOLVED_BY = "riley_handoff_self_execution";

export interface RecommendationHandoffDeps {
  /**
   * Transition the SOURCE recommendation to "acted" AFTER the handoff really
   * created a draft (a child draft with a jobId is the act). This is what lets
   * outcome attribution tell an acted-on recommendation from an ignored one, and
   * lets Riley measure handoff effectiveness. Called from the truthful success
   * leg ONLY: abstention, the no-draft skip leg (no jobId), and every failure leg
   * never call it (nothing was acted on). The implementation is conditional
   * first-writer-wins; benign lost races return transitioned:false with a reason,
   * infra errors throw and are caught at the call site. REQUIRED, not optional:
   * an optional dep would let a future bootstrap forget the wiring and silently
   * recreate the handoffs-invisible-to-attribution hole this closes
   * (feedback_safety_gate_needs_producer_population).
   */
  markRecommendationActed: (args: {
    organizationId: string;
    recommendationId: string;
    executableWorkUnitId: string;
    executedAt: Date;
  }) => Promise<
    { transitioned: true } | { transitioned: false; reason: "not_found" | "not_pending" }
  >;
  /** Injectable clock; executedAt anchors the outcome-attribution window. */
  now?: () => Date;
}

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
 *   4. On a real created draft (child with a jobId), transitions the SOURCE
 *      recommendation to "acted" so outcome attribution can measure handoff
 *      effectiveness (mirrors the Phase-C pause/reallocate executors). Bookkeeping
 *      only: a transition failure is recorded in outputs and logged, never a false
 *      "failed" claim about a draft that really was created.
 *
 * Riley gains no budget authority: the draft is a no-spend CreativeJob row a human
 * later funds. The handoff itself is what a human approved.
 */
export function buildRecommendationHandoffWorkflow(
  deps: RecommendationHandoffDeps,
): WorkflowHandler {
  const now = deps.now ?? (() => new Date());
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
      // at submit time). FAIL CLOSED on absence: a missing signal must NOT let a
      // learning-resetting action through, so default to "assume learning is
      // active" (the abstention then blocks any resetsLearning:"yes" action). Only
      // an explicit `false` opts out of the learning lockout.
      const rawLearningFlag = (workUnit.parameters as { learningPhaseActive?: unknown })
        .learningPhaseActive;
      const learningPhaseActive = rawLearningFlag === false ? false : true;

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
            // D6-3: thread Riley's diagnosis into the child draft as STRUCTURED data the creative
            // pipeline can route on (campaignId/actionType/evidence), not just the brief's free
            // text. Built from the validated RecommendationHandoffInput (all fields required), so
            // every handoff carries it; the schema (rileyDiagnosis) accepts it on the child.
            rileyDiagnosis: {
              campaignId: input.campaignId,
              actionType: input.actionType,
              evidence: input.evidence,
            },
          },
        },
      });

      // Fail closed on EITHER arm: an ingress-level failure (ok:false) OR a child
      // that executed-but-failed (ok:true with result.outcome:"failed", e.g. the
      // draft handler's DEPLOYMENT_NOT_FOUND). Only "completed"/"queued" is success;
      // a parked child ("pending_approval") is not a created draft either. Never
      // report a phantom success.
      if (!child.ok) {
        return {
          outcome: "failed",
          summary: "Creative draft child submit failed",
          outputs: { recommendationId: input.recommendationId },
          error: { code: "CHILD_DRAFT_FAILED", message: child.error.message },
        };
      }
      const childOutcome = child.result.outcome;
      if (childOutcome !== "completed" && childOutcome !== "queued") {
        return {
          outcome: "failed",
          summary: "Creative draft child did not complete",
          outputs: { recommendationId: input.recommendationId, childOutcome },
          error: {
            code: "CHILD_DRAFT_FAILED",
            message:
              child.result.error?.message ??
              `Child draft outcome was "${childOutcome}", not completed.`,
          },
        };
      }

      // A "completed" child is not necessarily a created draft: the draft workflow
      // returns completed + { skipped: true } (no jobId) when Mira is not enabled
      // for the org. Require the child jobId so an approved handoff never reports a
      // phantom draft that does not exist.
      const childOutputs = child.result.outputs as
        | { jobId?: unknown; reason?: unknown }
        | undefined;
      const childJobId = typeof childOutputs?.jobId === "string" ? childOutputs.jobId : null;
      if (!childJobId) {
        return {
          outcome: "completed",
          summary: "Handoff approved but no creative draft was created (child produced no job)",
          outputs: {
            recommendationId: input.recommendationId,
            skipped: true,
            reason:
              typeof childOutputs?.reason === "string" ? childOutputs.reason : "child_no_draft",
          },
        };
      }

      // A real draft was created: the recommendation was acted on. Transition the
      // SOURCE recommendation to "acted" so outcome attribution can measure handoff
      // effectiveness and tell acted-on from ignored. executableWorkUnitId is THIS
      // handoff unit (the executable that did the act), executedAt is the draft-
      // creation clock (the attribution window anchor). Bookkeeping never fails the
      // unit: the created draft is the execution truth, so a transition failure is
      // recorded in outputs and logged, never converted into a false "failed".
      const executedAt = now();
      let recommendationTransition: "acted" | "not_found" | "not_pending" | "error";
      try {
        const transition = await deps.markRecommendationActed({
          organizationId: workUnit.organizationId,
          recommendationId: input.recommendationId,
          executableWorkUnitId: workUnit.id,
          executedAt,
        });
        recommendationTransition = transition.transitioned ? "acted" : transition.reason;
        if (recommendationTransition === "not_found") {
          // not_pending is the benign first-writer-won race (operator acted/dismissed
          // concurrently, or lazy expiry won) and stays silent; not_found after a
          // SUCCESSFUL draft is suspicious (stale/deleted/cross-org/bad recommendation
          // id) and deserves a searchable signal without failing the work unit.
          console.warn(
            `[handoff] recommendation not found after successful draft org=${workUnit.organizationId} rec=${input.recommendationId} workUnit=${workUnit.id}`,
          );
        }
      } catch (err) {
        // LOUD: "draft created but attribution linkage failed" must be
        // discoverable/alertable, never just trace-archaeology.
        recommendationTransition = "error";
        console.error(
          `[handoff] failed to mark recommendation acted org=${workUnit.organizationId} rec=${input.recommendationId} workUnit=${workUnit.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return {
        outcome: "completed",
        summary: "Routed Riley recommendation to a Mira creative draft",
        outputs: {
          recommendationId: input.recommendationId,
          child: child.workUnit?.id,
          jobId: childJobId,
          recommendationTransition,
        },
      };
    },
  };
}
