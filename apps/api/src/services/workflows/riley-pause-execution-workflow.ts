import type { WorkflowHandler } from "@switchboard/core/platform";
import { RileyPauseExecutionInput } from "@switchboard/schemas";
import {
  PHASE_C_EXECUTION_SEAM,
  isPhaseCActionClassEligible,
  meetsRileyPauseExecutionFloor,
} from "@switchboard/ad-optimizer";

/**
 * Stale-approval cap: the executor refuses to act on evidence older than this,
 * measured from the work unit's requestedAt (submit time) to execution time.
 * Backstop BEHIND the platform's 24h lifecycle park expiry (createGatedLifecycle
 * in platform-ingress.ts; enforced at respond time by respondToParkedLifecycle);
 * pause-specific and enforced at the last mile regardless of which respond path
 * dispatched.
 */
export const RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS = 48;

/**
 * resolvedBy sentinel for machine-executed pauses (slice 4f). A distinct
 * machine identifier, never a human principal id: the approver approved, the
 * platform acted. Bare "system" would be ambiguous with the real seeded
 * system principal; workflow rows in the same table already use machine
 * values ("policy_engine", "auto"). Human-approval provenance lives on the
 * lifecycle (respondedBy), the WorkTrace, and the audit snapshot.
 */
export const RILEY_PAUSE_EXECUTION_RESOLVED_BY = "riley_self_execution";

/** Org-isolation-aware credential resolution result. */
export type RileyPauseCredsResult =
  | { kind: "ok"; credentials: { accessToken: string; accountId: string } }
  | { kind: "none" }
  | { kind: "org_mismatch" };

export interface RileyPauseExecutionDeps {
  /**
   * Resolve the org's meta-ads connection credentials by deployment id, WITH the
   * org-isolation check inside (the closure verifies the deployment row's
   * organizationId equals the caller's BEFORE decrypting; "org_mismatch" is a
   * loud security failure, never a quiet skip). Defense in depth: the top-level
   * resolver is org-scoped by construction, this guards future resolver changes
   * and hand-edited traces.
   */
  getDeploymentCredentials: (
    organizationId: string,
    deploymentId: string,
  ) => Promise<RileyPauseCredsResult>;
  /**
   * Client factory (MetaAdsClient in production; fakes in tests). Called TWICE
   * per execution on purpose: the client's in-instance 60s rate limiter would
   * otherwise hold the human's approval request open for a minute between the
   * status pre-read and the write. Two Graph calls per human approval is far
   * under any real limit.
   */
  createAdsClient: (creds: { accessToken: string; accountId: string }) => {
    updateCampaignStatus(campaignId: string, status: "PAUSED"): Promise<void>;
    getCampaignStatus(
      campaignId: string,
    ): Promise<{ status: string; effectiveStatus: string } | null>;
  };
  /**
   * Slice 4f: transition the source recommendation to "acted" after a REAL
   * Meta pause write. Called from the truthful success leg ONLY (write
   * accepted); skip/stale/failure legs never call it, and the already-paused
   * pre-read skip is deliberately excluded (no spend change from THIS work
   * unit; attributing a window would measure someone else's action). The
   * implementation is conditional first-writer-wins; benign lost races return
   * transitioned:false, infra errors throw and are caught at the call site.
   * REQUIRED, not optional: an optional dep would let a future bootstrap
   * forget the wiring and silently recreate the executed-pauses-invisible-
   * to-attribution hole this slice exists to close.
   */
  markRecommendationActed: (args: {
    organizationId: string;
    recommendationId: string;
    executableWorkUnitId: string;
    executedAt: Date;
  }) => Promise<
    { transitioned: true } | { transitioned: false; reason: "not_found" | "not_pending" }
  >;
  /** Injectable clock for the stale-approval cap. */
  now?: () => Date;
}

/**
 * PHASE-C executor for `adoptimizer.campaign.pause`. Runs ONLY after the seeded
 * require_approval(mandatory) policy parked the submit and a human approved it
 * (respondToParkedLifecycle -> runDispatch -> executeApproved -> WorkflowMode).
 *
 * Execution-truth hardening sequence (design rev 2):
 *   1. Zod parse (fail closed INVALID_PAUSE_INPUT).
 *   2. Class eligibility + raised execution floor (defense in depth; abstain =
 *      deliberate completed no-op, never a phantom pause).
 *   3. Stale-approval cap on requestedAt (48h backstop behind the platform's
 *      24h park expiry). requestedAt + ageHours always recorded.
 *   4. Org-isolation credential resolution (DEPLOYMENT_ORG_MISMATCH is loud).
 *   5. Campaign-status pre-read: already paused / deleted / archived abstains
 *      with the reason + previousStatus; a degraded read proceeds (the write is
 *      the honest test).
 *   6. The pause write via the EXISTING MetaAdsClient.updateCampaignStatus
 *      (which can never set ACTIVE: rollback stays human, recorded not executed).
 *      Failure -> outcome "failed" -> recovery_required + operator Retry card:
 *      approve always ends in dispatch-or-recovery.
 *   7. Outputs record execution truth (previousStatus/newStatus/
 *      metaWriteAccepted/ageHours) + the seam's rollback/success/guardrail
 *      declarations (recorded, not auto-monitored; the slice-3
 *      outcome-attribution cron is the monitoring loop).
 */
export function buildRileyPauseExecutionWorkflow(deps: RileyPauseExecutionDeps): WorkflowHandler {
  const now = deps.now ?? (() => new Date());
  return {
    async execute(workUnit) {
      const parsed = RileyPauseExecutionInput.safeParse(workUnit.parameters);
      if (!parsed.success) {
        return {
          outcome: "failed",
          summary: "Riley pause payload is invalid",
          error: { code: "INVALID_PAUSE_INPUT", message: parsed.error.message },
        };
      }
      const input = parsed.data;

      if (!isPhaseCActionClassEligible("pause")) {
        return {
          outcome: "completed",
          summary: "Abstained from pause (action class is not Phase-C eligible)",
          outputs: { paused: false, skipped: true, reason: "class_ineligible" },
        };
      }
      if (!meetsRileyPauseExecutionFloor(input.evidence)) {
        return {
          outcome: "completed",
          summary: "Abstained from pause (below the execution evidence floor)",
          outputs: { paused: false, skipped: true, reason: "below_execution_floor" },
        };
      }

      const requestedAt = workUnit.requestedAt;
      const rawAgeHours = (now().getTime() - new Date(requestedAt).getTime()) / (60 * 60 * 1000);
      const ageHours = Math.round(rawAgeHours * 100) / 100;
      if (rawAgeHours > RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS) {
        return {
          outcome: "completed",
          summary: `Abstained from pause (approval is stale: ${Math.round(rawAgeHours)}h old, cap ${RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS}h)`,
          outputs: {
            paused: false,
            skipped: true,
            reason: "stale_approval",
            requestedAt,
            ageHours,
          },
        };
      }

      const deploymentId = workUnit.deployment.deploymentId;
      const credsResult = await deps.getDeploymentCredentials(
        workUnit.organizationId,
        deploymentId,
      );
      if (credsResult.kind === "org_mismatch") {
        return {
          outcome: "failed",
          summary: "Deployment does not belong to the work unit's organization",
          error: {
            code: "DEPLOYMENT_ORG_MISMATCH",
            message: `Deployment ${deploymentId} is not owned by organization ${workUnit.organizationId}; refusing to use its credentials.`,
          },
        };
      }
      if (credsResult.kind === "none") {
        return {
          outcome: "failed",
          summary: "No usable meta-ads connection for the Riley deployment",
          error: {
            code: "NO_META_CONNECTION",
            message: `Deployment ${deploymentId} has no decryptable meta-ads connection.`,
          },
        };
      }
      const creds = credsResult.credentials;

      // Pre-read on a FRESH client (see createAdsClient doc comment).
      const statusRead = await deps.createAdsClient(creds).getCampaignStatus(input.campaignId);
      const previousStatus = statusRead?.status ?? "unknown";
      if (statusRead?.status === "PAUSED") {
        return {
          outcome: "completed",
          summary: `Campaign ${input.campaignId} is already paused; nothing to do`,
          outputs: {
            paused: false,
            skipped: true,
            reason: "campaign_already_paused",
            previousStatus,
            requestedAt,
            ageHours,
          },
        };
      }
      if (statusRead && (statusRead.status === "DELETED" || statusRead.status === "ARCHIVED")) {
        return {
          outcome: "completed",
          summary: `Campaign ${input.campaignId} is ${statusRead.status.toLowerCase()}; not pausable`,
          outputs: {
            paused: false,
            skipped: true,
            reason: "campaign_not_pausable",
            previousStatus,
            requestedAt,
            ageHours,
          },
        };
      }

      try {
        await deps.createAdsClient(creds).updateCampaignStatus(input.campaignId, "PAUSED");
      } catch (err) {
        return {
          outcome: "failed",
          summary: `Meta pause failed for campaign ${input.campaignId}`,
          error: {
            code: "META_PAUSE_FAILED",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }

      // Slice 4f: the pause REALLY happened (request accepted). Record that
      // truth on the source recommendation so outcome attribution can see it;
      // resolvedAt = execution time (the attribution windows anchor on it).
      // Bookkeeping never fails the work unit: the Meta write is the execution
      // truth the operator was promised, so a transition failure is recorded
      // in outputs (the WorkTrace is canonical) and error-logged, never
      // converted into a false "failed" claim about a pause that succeeded.
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
      } catch (err) {
        // LOUD: "Meta paused but attribution linkage failed" must be
        // discoverable/alertable, never just trace-archaeology. The benign
        // not_pending/not_found legs above are expected product behavior
        // (first writer won) and are deliberately not error-logged.
        recommendationTransition = "error";
        console.error(
          `[riley-pause] failed to mark recommendation acted org=${workUnit.organizationId} rec=${input.recommendationId} workUnit=${workUnit.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Non-null is safe: isPhaseCActionClassEligible("pause") above requires the
      // seam entry to exist (its first leg is `seam !== undefined`).
      const seam = PHASE_C_EXECUTION_SEAM.pause!;
      return {
        outcome: "completed",
        summary: `Paused campaign ${input.campaignId} on Meta (Riley self-execution, human-approved)`,
        outputs: {
          paused: true,
          campaignId: input.campaignId,
          recommendationId: input.recommendationId,
          previousStatus,
          newStatus: "PAUSED",
          metaWriteAccepted: true,
          requestedAt,
          ageHours,
          recommendationTransition,
          executedAt: executedAt.toISOString(),
          rollbackPlan: seam.rollbackPlan,
          successMetric: seam.successMetric,
          guardrailMetrics: seam.guardrailMetrics,
        },
      };
    },
  };
}
