import type { WorkflowHandler } from "@switchboard/core/platform";
import { RileyResetBudgetExecutionInput, ExecutionReceiptSchema } from "@switchboard/schemas";

// No resolvedBy sentinel here (unlike the forward reallocate executor): a reset stamps no source
// recommendation (a rollback is not a recommendation action), so there is nothing to attribute.

/** Org-isolation-aware credential resolution result (mirrors the reallocate executor). */
export type RileyResetBudgetCredsResult =
  | { kind: "ok"; credentials: { accessToken: string; accountId: string } }
  | { kind: "none" }
  | { kind: "org_mismatch" };

export interface RileyResetBudgetExecutionDeps {
  /**
   * Resolve the org's meta-ads credentials by deployment id WITH the org-isolation check inside (the
   * deployment row's organizationId must equal the caller's before any decrypt). Called with the
   * FROZEN deploymentId from the parameters, NOT the work unit's deployment context (the reset
   * resolves into a platform-direct context with no usable deployment).
   */
  getDeploymentCredentials: (
    organizationId: string,
    deploymentId: string,
  ) => Promise<RileyResetBudgetCredsResult>;
  /**
   * Read the forward reallocation's at-most-once marker by its execution work-unit id
   * (`rollbackOfWorkUnitId`). The executor verifies `targetCents` equals the persisted
   * `observedPriorCents` (the captured prior) BEFORE any Meta write, so the reset can only ever
   * restore the value the forward move captured, never an arbitrary budget. REQUIRED, not optional:
   * this is the structural bound that makes auto-execution safe against a future in-process caller
   * (the HTTP edges are already blocked by the service-only guard). Org-scoped: a row whose
   * organizationId differs reads as absent (never trust another tenant's capture).
   */
  getCapturedPrior: (args: {
    organizationId: string;
    rollbackOfWorkUnitId: string;
  }) => Promise<{ observedPriorCents: number } | null>;
  /** Client factory (MetaAdsClient in prod; fakes in tests). A fresh client per Graph call (the
   *  reset makes at most three: pre-read, write, post-read), mirroring the reallocate executor. */
  createAdsClient: (creds: { accessToken: string; accountId: string }) => {
    getCampaign(campaignId: string): Promise<{
      campaignId: string;
      name: string;
      status: string;
      dailyBudgetCents: number | null;
    }>;
    updateCampaignBudget(campaignId: string, dailyBudgetCents: number): Promise<void>;
  };
  /** Injectable clock. */
  now?: () => Date;
}

/**
 * PHASE-C executor for `adoptimizer.campaign.reset_prior_budget`: the automated guardrail rollback.
 * Restores a campaign's daily budget to the prior the forward reallocate executor captured
 * (`targetCents`). Runs AUTO (allow-only governance, no human, no park) because it is a safety
 * reversal to a human-approved prior. Set-to-absolute: it can ONLY write `targetCents`, never an
 * arbitrary value, so it cannot be abused as a general budget-mover.
 *
 * Read-modify-re-read:
 *   1 parse frozen params (fail closed INVALID_RESET_INPUT).
 *   2 verify the captured prior: targetCents MUST equal the forward marker's observedPriorCents
 *     (RESET_NO_CAPTURED_PRIOR if the marker is absent, RESET_TARGET_NOT_CAPTURED_PRIOR on a
 *     mismatch). This is the structural bound: the reset can only restore the value the forward move
 *     captured, never an arbitrary budget, even if a future in-process caller passes a wrong target.
 *   3 credentials by the FROZEN deploymentId + org-isolation (DEPLOYMENT_ORG_MISMATCH / NO_META_CONNECTION).
 *   4 frozen-account lock (ACCOUNT_MISMATCH).
 *   5 live read (CAMPAIGN_BUDGET_UNREADABLE / UNSUPPORTED_BUDGET_TOPOLOGY).
 *   6 idempotent no-op when live already equals the target (no Meta write).
 *   7 the absolute-set Meta write (META_RESET_WRITE_ERROR).
 *   8 post-write re-read, must equal the target (RESET_POST_WRITE_MISMATCH).
 *   9 build + validate the campaign_budget_reset receipt (RESET_RECEIPT_INVALID).
 *
 * Deliberately NO blast-radius cap and NO drift check, unlike the forward executor:
 *  - the move is bounded-by-construction (it restores the captured prior, whose forward delta was
 *    already within the cap, so the reverse delta has equal magnitude);
 *  - drift is EXPECTED here (the forward move is exactly what drifted the budget up), so a drift
 *    check would refuse every legitimate rollback.
 * No durable lease marker: the reset relies on ingress idempotency (key reset:<forwardWorkUnitId>)
 * plus the idempotent absolute-set, so a retried dispatch re-sets the same value rather than
 * double-moving. That also keeps reset rows out of the forward monitor's queue (no recursion).
 */
export function buildRileyResetBudgetExecutionWorkflow(
  deps: RileyResetBudgetExecutionDeps,
): WorkflowHandler {
  const now = deps.now ?? (() => new Date());
  return {
    async execute(workUnit) {
      const parsed = RileyResetBudgetExecutionInput.safeParse(workUnit.parameters);
      if (!parsed.success) {
        return {
          outcome: "failed",
          summary: "Riley reset payload is invalid",
          error: { code: "INVALID_RESET_INPUT", message: parsed.error.message },
        };
      }
      const input = parsed.data;
      const organizationId = workUnit.organizationId;

      // 2. Structural bound: targetCents must be the prior the forward move captured. The HTTP edges
      // cannot reach this intent (the service-only guard), so this enforces the "only restores a
      // captured prior" invariant against a future in-process caller passing a wrong target.
      const captured = await deps.getCapturedPrior({
        organizationId,
        rollbackOfWorkUnitId: input.rollbackOfWorkUnitId,
      });
      if (!captured) {
        return {
          outcome: "failed",
          summary: "No captured prior for the reset's forward work unit; refusing to restore",
          error: {
            code: "RESET_NO_CAPTURED_PRIOR",
            message: `No reallocation marker for rollbackOfWorkUnitId ${input.rollbackOfWorkUnitId} in org ${organizationId}; cannot verify the restore target.`,
          },
        };
      }
      if (captured.observedPriorCents !== input.targetCents) {
        return {
          outcome: "failed",
          summary: "Reset target does not match the captured prior; refusing to restore",
          error: {
            code: "RESET_TARGET_NOT_CAPTURED_PRIOR",
            message: `targetCents ${input.targetCents} != captured observedPriorCents ${captured.observedPriorCents} for ${input.rollbackOfWorkUnitId}; the reset may only restore the captured prior.`,
          },
        };
      }

      // 3. Credentials by the FROZEN deploymentId (the work unit's context is platform-direct).
      const credsResult = await deps.getDeploymentCredentials(organizationId, input.deploymentId);
      if (credsResult.kind === "org_mismatch") {
        return {
          outcome: "failed",
          summary: "Deployment does not belong to the work unit's organization",
          error: {
            code: "DEPLOYMENT_ORG_MISMATCH",
            message: `Deployment ${input.deploymentId} is not owned by organization ${organizationId}; refusing to use its credentials.`,
          },
        };
      }
      if (credsResult.kind === "none") {
        return {
          outcome: "failed",
          summary: "No usable meta-ads connection for the Riley deployment",
          error: {
            code: "NO_META_CONNECTION",
            message: `Deployment ${input.deploymentId} has no decryptable meta-ads connection.`,
          },
        };
      }
      const creds = credsResult.credentials;
      if (creds.accountId !== input.adAccountId) {
        return {
          outcome: "failed",
          summary: "Frozen ad account does not match the deployment's connected account",
          error: {
            code: "ACCOUNT_MISMATCH",
            message: `Frozen adAccountId ${input.adAccountId} does not match the connection account ${creds.accountId}; refusing the reset.`,
          },
        };
      }

      // 4. Live read.
      let live: number | null;
      try {
        const campaign = await deps.createAdsClient(creds).getCampaign(input.campaignId);
        live = campaign.dailyBudgetCents;
      } catch (err) {
        return {
          outcome: "failed",
          summary: `Campaign budget unreadable for ${input.campaignId}`,
          error: {
            code: "CAMPAIGN_BUDGET_UNREADABLE",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
      if (live === null) {
        return {
          outcome: "failed",
          summary: `Campaign ${input.campaignId} has no daily budget to reset`,
          error: {
            code: "UNSUPPORTED_BUDGET_TOPOLOGY",
            message: `Campaign ${input.campaignId} returned a null daily budget (campaign-level reset unsupported for this topology).`,
          },
        };
      }

      // 5. Idempotent no-op: the budget already sits at the captured prior, nothing to undo.
      if (live === input.targetCents) {
        return {
          outcome: "completed",
          summary: `Campaign ${input.campaignId} already at the prior budget ${input.targetCents}; no reset needed`,
          outputs: { restored: false, reason: "already_at_prior" },
        };
      }

      // 6. The absolute-set Meta write. No marker: ingress idempotency + absolute-set make a retry safe.
      try {
        await deps.createAdsClient(creds).updateCampaignBudget(input.campaignId, input.targetCents);
      } catch (err) {
        return {
          outcome: "failed",
          summary: `Meta budget reset failed for campaign ${input.campaignId}`,
          error: {
            code: "META_RESET_WRITE_ERROR",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }

      // 7. Post-write re-read: confirm the applied budget equals the target.
      let appliedCents: number | null;
      try {
        const reread = await deps.createAdsClient(creds).getCampaign(input.campaignId);
        appliedCents = reread.dailyBudgetCents;
      } catch (err) {
        return {
          outcome: "failed",
          summary: `Post-reset re-read failed for campaign ${input.campaignId}`,
          error: {
            code: "RESET_POST_WRITE_MISMATCH",
            message: `Could not confirm the reset budget: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
      }
      if (appliedCents !== input.targetCents) {
        return {
          outcome: "failed",
          summary: `Reset budget ${appliedCents ?? "null"} does not match the target ${input.targetCents}`,
          error: {
            code: "RESET_POST_WRITE_MISMATCH",
            message: `Re-read budget ${appliedCents ?? "null"} != target ${input.targetCents} for campaign ${input.campaignId}.`,
          },
        };
      }

      // 8. Build + validate the reset receipt.
      const executedAt = now();
      const receiptParsed = ExecutionReceiptSchema.safeParse({
        kind: "campaign_budget_reset",
        organizationId,
        deploymentId: input.deploymentId,
        adAccountId: input.adAccountId,
        campaignId: input.campaignId,
        executionWorkUnitId: workUnit.id,
        rollbackOfWorkUnitId: input.rollbackOfWorkUnitId,
        breachMetric: input.breachMetric,
        breachReason: input.breachReason,
        targetCents: input.targetCents,
        observedLiveCents: live,
        appliedCents,
        deltaCentsSigned: appliedCents - live,
        executedAt: executedAt.toISOString(),
      });
      if (!receiptParsed.success) {
        return {
          outcome: "failed",
          summary: `Reset applied but the receipt is invalid for campaign ${input.campaignId}`,
          error: {
            code: "RESET_RECEIPT_INVALID",
            message: `ExecutionReceipt validation failed after a successful reset: ${receiptParsed.error.message}`,
          },
        };
      }

      return {
        outcome: "completed",
        summary: `Reset campaign ${input.campaignId} daily budget ${live} -> ${appliedCents} cents on Meta (automated guardrail rollback)`,
        outputs: { receipt: receiptParsed.data, restored: true },
      };
    },
  };
}
