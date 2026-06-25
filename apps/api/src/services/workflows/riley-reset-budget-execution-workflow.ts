import type { WorkflowHandler } from "@switchboard/core/platform";
import { RileyResetBudgetExecutionInput, ExecutionReceiptSchema } from "@switchboard/schemas";

/**
 * resolvedBy sentinel for the machine-executed reset rollback. Distinct from the forward reallocate
 * sentinel: the monitor (not the approver) drove this, and it is a different action class.
 */
export const RILEY_RESET_EXECUTION_RESOLVED_BY = "riley_reset_self_execution";

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
 *   2 credentials by the FROZEN deploymentId + org-isolation (DEPLOYMENT_ORG_MISMATCH / NO_META_CONNECTION).
 *   3 frozen-account lock (ACCOUNT_MISMATCH).
 *   4 live read (CAMPAIGN_BUDGET_UNREADABLE / UNSUPPORTED_BUDGET_TOPOLOGY).
 *   5 idempotent no-op when live already equals the target (no Meta write).
 *   6 the absolute-set Meta write (META_RESET_WRITE_ERROR).
 *   7 post-write re-read, must equal the target (RESET_POST_WRITE_MISMATCH).
 *   8 build + validate the campaign_budget_reset receipt (RESET_RECEIPT_INVALID).
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

      // 2. Credentials by the FROZEN deploymentId (the work unit's context is platform-direct).
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
