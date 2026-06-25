import type { WorkflowHandler, WorkTrace } from "@switchboard/core/platform";
import { getMetrics } from "@switchboard/core";
import {
  RileyBudgetExecutionInput,
  ExecutionReceiptSchema,
  type ExecutionReceipt,
} from "@switchboard/schemas";
import {
  assertWithinBlastRadius,
  assessBudgetDrift,
  type BlastRadiusContract,
} from "@switchboard/ad-optimizer";

/**
 * resolvedBy sentinel for machine-executed reallocations. A distinct machine identifier, never a
 * human principal id and never the pause sentinel: the approver approved, the platform acted.
 * Human-approval provenance lives on the lifecycle (respondedBy), the WorkTrace, and the receipt.
 */
export const RILEY_REALLOCATE_EXECUTION_RESOLVED_BY = "riley_reallocate_self_execution";

/** Org-isolation-aware credential resolution result (mirrors the pause executor). */
export type RileyBudgetCredsResult =
  | { kind: "ok"; credentials: { accessToken: string; accountId: string } }
  | { kind: "none" }
  | { kind: "org_mismatch" };

/**
 * Approval outcomes that authorize the Meta budget write. "patched" is an operator-edited-then-
 * approved lifecycle (still a human approval). An absent outcome means the unit reached the
 * executor without ever being approved (the deleted/mis-seeded-policy case): fail closed.
 */
const APPROVED_OUTCOMES: ReadonlySet<string> = new Set(["approved", "patched"]);

export interface RileyBudgetExecutionDeps {
  /**
   * Last-mile approval + binding reader (D5-2a). Reads the canonical WorkTrace for THIS work unit
   * and reports its durable approval outcome PLUS the receipt's content-binding inputs
   * (approvedLifecycleId <- trace.approvalId, bindingHash <- trace.contentHash, workTraceId <-
   * trace.traceId). ORG-SCOPED: a trace whose organizationId differs (or an absent trace) reads as
   * no approval, so the executor fails closed rather than trusting another tenant's trace. REQUIRED,
   * never optional: an optional dep would let a future bootstrap forget the wiring and recreate the
   * hole this exists to close.
   */
  getApprovalContext: (args: { organizationId: string; workUnitId: string }) => Promise<{
    approvalOutcome?: WorkTrace["approvalOutcome"];
    approvedLifecycleId?: string;
    bindingHash?: string;
    workTraceId?: string;
  }>;
  /**
   * In-flight kill-switch (runbook §3): a runtime, per-deployment stop the executor checks at the
   * last mile (after replay-first, before credentials + the Meta write). True halts THIS execution
   * with a clean abort (no marker), so it is re-runnable once cleared. Distinct from the canary
   * enable flag (which gates the SUBMITTER, so an already-approved-and-dispatched unit would still
   * execute): this is the EXECUTOR-side stop that halts in-flight + future runs at runtime (a DB flip,
   * no redeploy). REQUIRED, never optional: an optional dep would let a future bootstrap silently drop
   * the stop and recreate the hole this closes.
   */
  isReallocateKilled: (args: { organizationId: string; deploymentId: string }) => Promise<boolean>;
  /** Resolve the org's meta-ads credentials by deployment id WITH the org-isolation check inside. */
  getDeploymentCredentials: (
    organizationId: string,
    deploymentId: string,
  ) => Promise<RileyBudgetCredsResult>;
  /**
   * Client factory (MetaAdsClient in prod; fakes in tests). Called once PER Graph call on purpose:
   * the client's in-instance 60s rate limiter would otherwise hold the human's approval request
   * open between calls. The reallocate path makes at most four Graph calls (pre-read, account
   * spend, write, post-read), far under any real limit.
   */
  createAdsClient: (creds: { accessToken: string; accountId: string }) => {
    getCampaign(campaignId: string): Promise<{
      campaignId: string;
      name: string;
      status: string;
      dailyBudgetCents: number | null;
    }>;
    updateCampaignBudget(campaignId: string, dailyBudgetCents: number): Promise<void>;
    getAccountDailySpendCents(): Promise<number | null>;
  };
  /**
   * The durable at-most-once marker store (1B-1.5a). The lease is the committed `pending` row +
   * its TTL, NEVER an open transaction spanning the Meta HTTP call.
   */
  attemptStore: {
    findByExecutionWorkUnitId(
      executionWorkUnitId: string,
    ): Promise<{ status: string } | null | undefined>;
    claimLeaseAndMark(input: {
      organizationId: string;
      adAccountId: string;
      campaignId: string;
      executionWorkUnitId: string;
      observedPriorCents: number;
      requestedToCents: number;
      workTraceId?: string;
      deploymentId?: string;
      now: Date;
    }): Promise<{ claimed: true } | { claimed: false }>;
    markApplied(args: {
      executionWorkUnitId: string;
      organizationId: string;
    }): Promise<{ transitioned: boolean }>;
    markRecoveryRequired(args: {
      executionWorkUnitId: string;
      organizationId: string;
    }): Promise<{ transitioned: boolean }>;
  };
  /** Read a prior success receipt from WorkTrace.executionOutputs for the replay no-op. */
  getExistingReceipt: (workUnitId: string) => Promise<ExecutionReceipt | undefined>;
  /**
   * Stamp the SOURCE recommendation (PendingActionRecord, intent recommendation.*) as acted so the
   * outcome ledger sees the executed move. Bookkeeping only: never fails the unit. The id MUST be
   * the source recommendation id, not the reallocate submit's own id, or the stamp no-ops not_found.
   */
  markRecommendationActed: (args: {
    organizationId: string;
    recommendationId: string;
    executableWorkUnitId: string;
    executedAt: Date;
  }) => Promise<
    { transitioned: true } | { transitioned: false; reason: "not_found" | "not_pending" }
  >;
  /** The enforced blast-radius contract (DEFAULT_BLAST_RADIUS_CONTRACT in prod). */
  contract: BlastRadiusContract;
  /** Injectable clock. */
  now?: () => Date;
}

/**
 * PHASE-C executor for `adoptimizer.campaign.reallocate` (Spec-1B act leg). Runs ONLY after the
 * seeded require_approval(mandatory) policy parked the submit and a human approved it. The
 * read-modify-re-read order (locked design, ledger 1B-1.5b):
 *
 *   0 parse frozen params (fail closed INVALID_REALLOCATE_INPUT).
 *   1 approval + content-binding (REALLOCATE_NOT_APPROVED; fail closed BEFORE any Meta call/decrypt).
 *   2 replay-first: applied+receipt -> replay no-op (0 Meta); any other marker -> MUTATION_RECOVERY_REQUIRED (0 Meta).
 *   2.5 in-flight kill-switch: a runtime per-deployment stop (RILEY_REALLOCATE_KILLED, no marker, 0 Meta).
 *   3 credentials + frozen-account lock (DEPLOYMENT_ORG_MISMATCH / NO_META_CONNECTION / ACCOUNT_MISMATCH).
 *   4 live campaign read (CAMPAIGN_BUDGET_UNREADABLE / UNSUPPORTED_BUDGET_TOPOLOGY).
 *   5 drift vs the approved baseline (BUDGET_DRIFTED).
 *   6 account spend + signed-delta blast-radius cap (DELTA_CAP / SHARE_CAP; null spend fails closed). NO marker yet.
 *   7 claim lease + commit the pending marker (LEASE_CONTENDED) -- the only durable state before the write.
 *   8 the Meta write, no open transaction (META_WRITE_ERROR -> recovery_required marker).
 *   9 post-write re-read, must equal the approved budget (POST_WRITE_MISMATCH -> recovery_required marker).
 *  10 build + validate the receipt, mark applied, stamp the source recommendation (bookkeeping, never fatal).
 *
 * Every step 0-6 failure returns BEFORE claimLeaseAndMark, so a clean pre-write failure leaves NO
 * marker (a corrected re-proposal is never poisoned into recovery). Cents end-to-end; the only
 * dollars boundary (the gate's spendAmount) lives in the submit-request, never here.
 */
export function buildRileyBudgetExecutionWorkflow(deps: RileyBudgetExecutionDeps): WorkflowHandler {
  const now = deps.now ?? (() => new Date());
  return {
    async execute(workUnit) {
      const parsed = RileyBudgetExecutionInput.safeParse(workUnit.parameters);
      if (!parsed.success) {
        return {
          outcome: "failed",
          summary: "Riley reallocate payload is invalid",
          error: { code: "INVALID_REALLOCATE_INPUT", message: parsed.error.message },
        };
      }
      const input = parsed.data;
      const workUnitId = workUnit.id;
      const organizationId = workUnit.organizationId;

      // 1. Approval + content-binding. Fail closed BEFORE resolving (and decrypting) credentials
      // or making any Meta call.
      const approval = await deps.getApprovalContext({ organizationId, workUnitId });
      if (!approval.approvalOutcome || !APPROVED_OUTCOMES.has(approval.approvalOutcome)) {
        return {
          outcome: "failed",
          summary: "Refusing to reallocate: no approved lifecycle for this work unit",
          error: {
            code: "REALLOCATE_NOT_APPROVED",
            message:
              `Work unit ${workUnitId} reached the reallocate executor without an approved lifecycle ` +
              `(approvalOutcome=${approval.approvalOutcome ?? "none"}); refusing an unapproved budget write.`,
          },
        };
      }
      if (!approval.approvedLifecycleId || !approval.bindingHash || !approval.workTraceId) {
        return {
          outcome: "failed",
          summary: "Refusing to reallocate: the approved lifecycle is missing its content binding",
          error: {
            code: "REALLOCATE_NOT_APPROVED",
            message:
              `Work unit ${workUnitId} has an approved outcome but is missing ` +
              "approvedLifecycleId/bindingHash/workTraceId; refusing an unbound budget write.",
          },
        };
      }

      // 2. Replay-first, BEFORE any Meta call (a replay must short-circuit before drift could
      // mis-fire on the already-applied budget).
      const existing = await deps.attemptStore.findByExecutionWorkUnitId(workUnitId);
      if (existing) {
        if (existing.status === "applied") {
          const receipt = await deps.getExistingReceipt(workUnitId);
          if (receipt) {
            return {
              outcome: "completed",
              summary: `Replayed prior reallocation receipt for campaign ${input.campaignId} (no Meta call)`,
              outputs: { receipt, replayed: true },
            };
          }
        }
        // pending / recovery_required, or applied-without-receipt (inconsistent): block auto-replay
        // and require operator reconciliation against Meta.
        return {
          outcome: "failed",
          summary: `Prior reallocation attempt for work unit ${workUnitId} is unresolved; operator reconciliation required`,
          error: {
            code: "MUTATION_RECOVERY_REQUIRED",
            message:
              `A ${existing.status} MetaMutationAttempt already exists for work unit ${workUnitId}; ` +
              "refusing to retry automatically (reconcile the campaign budget against Meta).",
          },
        };
      }

      // 2.5. In-flight kill-switch: a runtime per-deployment stop checked at the last mile (AFTER
      // replay-first, so an already-applied unit still replays its receipt, and BEFORE credentials /
      // the new Meta write). A killed unit aborts cleanly with NO marker, so it is re-runnable once
      // the switch clears. Halts both in-flight (an approved, dispatched, not-yet-written unit) and
      // every future execution, at runtime (no redeploy).
      const deploymentId = workUnit.deployment.deploymentId;
      if (await deps.isReallocateKilled({ organizationId, deploymentId })) {
        return {
          outcome: "failed",
          summary: "Reallocation halted by the runtime kill-switch",
          error: {
            code: "RILEY_REALLOCATE_KILLED",
            message: `The reallocate kill-switch is engaged for deployment ${deploymentId}; refusing to execute (re-runnable once cleared).`,
          },
        };
      }

      // 3. Credentials + frozen-account lock.
      const credsResult = await deps.getDeploymentCredentials(organizationId, deploymentId);
      if (credsResult.kind === "org_mismatch") {
        return {
          outcome: "failed",
          summary: "Deployment does not belong to the work unit's organization",
          error: {
            code: "DEPLOYMENT_ORG_MISMATCH",
            message: `Deployment ${deploymentId} is not owned by organization ${organizationId}; refusing to use its credentials.`,
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
      if (creds.accountId !== input.adAccountId) {
        return {
          outcome: "failed",
          summary: "Frozen ad account does not match the deployment's connected account",
          error: {
            code: "ACCOUNT_MISMATCH",
            message:
              `Approved adAccountId ${input.adAccountId} does not match the connection account ` +
              `${creds.accountId}; refusing the write.`,
          },
        };
      }

      // 4. Live campaign read.
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
          summary: `Campaign ${input.campaignId} has no daily budget to reallocate`,
          error: {
            code: "UNSUPPORTED_BUDGET_TOPOLOGY",
            message: `Campaign ${input.campaignId} returned a null daily budget (campaign-level reallocation unsupported for this topology).`,
          },
        };
      }

      // 5. Drift vs the approved baseline.
      const drift = assessBudgetDrift(input.fromCents, live);
      if (!drift.ok) {
        return {
          outcome: "failed",
          summary: `Campaign ${input.campaignId} budget drifted from the approved baseline`,
          error: {
            code: "BUDGET_DRIFTED",
            message: `Approved fromCents ${input.fromCents} no longer matches live ${live}; refusing a stale reallocation.`,
          },
        };
      }

      // 6. Account spend + signed-delta blast radius. A null/unreadable spend fails closed
      // (SHARE_CAP) by feeding NaN into the contract. NO marker is written through here: a clean
      // pre-write failure must leave nothing to reconcile.
      let accountSpend: number | null;
      try {
        accountSpend = await deps.createAdsClient(creds).getAccountDailySpendCents();
      } catch (err) {
        return {
          outcome: "failed",
          summary: "Account daily spend unreadable",
          error: {
            code: "ACCOUNT_SPEND_UNREADABLE",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
      const deltaSigned = input.toCents - live;
      const verdict = assertWithinBlastRadius(
        deps.contract,
        deltaSigned,
        accountSpend ?? Number.NaN,
      );
      // Detective telemetry (A6/D3): record the cap verdict once, on BOTH the refuse-return and
      // the accept-continue path. The cap is the only active blast-radius protection; this makes
      // its accept-vs-refuse rate observable the moment the executor runs (flag-gated, see the
      // metric doc + docs/runbooks/riley-reallocation-go-live.md). NOT a money-path change.
      getMetrics().rileyReallocationCapEvaluated.inc({
        orgId: organizationId,
        outcome: verdict.ok
          ? "within_cap"
          : verdict.reason === "DELTA_CAP"
            ? "delta_cap"
            : "share_cap",
      });
      if (!verdict.ok) {
        return {
          outcome: "failed",
          summary: `Reallocation exceeds the blast-radius contract (${verdict.reason})`,
          error: {
            code: verdict.reason,
            message: `delta=${deltaSigned} accountSpend=${accountSpend ?? "null"}: ${verdict.reason}`,
          },
        };
      }

      // 7. Claim the lease + commit the pending marker BEFORE the write (the durability boundary).
      const claim = await deps.attemptStore.claimLeaseAndMark({
        organizationId,
        adAccountId: input.adAccountId,
        campaignId: input.campaignId,
        executionWorkUnitId: workUnitId,
        observedPriorCents: live,
        requestedToCents: input.toCents,
        workTraceId: approval.workTraceId,
        // Stamp the reallocation's deployment so the guardrail monitor can resolve credentials +
        // attribute the rollback (the monitor's listPendingGuardrailForOrg reads it back).
        deploymentId,
        now: now(),
      });
      if (!claim.claimed) {
        return {
          outcome: "failed",
          summary: `Another reallocation is in flight for campaign ${input.campaignId}`,
          error: {
            code: "LEASE_CONTENDED",
            message: `Could not acquire the reallocation lease for campaign ${input.campaignId}; an active attempt holds it.`,
          },
        };
      }

      // 8. The Meta write, with NO open transaction. Any failure leaves a recovery_required marker
      // (the move may or may not have landed) so replay refuses and an operator reconciles.
      try {
        await deps.createAdsClient(creds).updateCampaignBudget(input.campaignId, input.toCents);
      } catch (err) {
        await deps.attemptStore.markRecoveryRequired({
          executionWorkUnitId: workUnitId,
          organizationId,
        });
        return {
          outcome: "failed",
          summary: `Meta budget write failed for campaign ${input.campaignId}`,
          error: {
            code: "META_WRITE_ERROR",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }

      // 9. Post-write re-read: confirm the applied budget equals the approved target.
      let appliedCents: number | null;
      try {
        const reread = await deps.createAdsClient(creds).getCampaign(input.campaignId);
        appliedCents = reread.dailyBudgetCents;
      } catch (err) {
        await deps.attemptStore.markRecoveryRequired({
          executionWorkUnitId: workUnitId,
          organizationId,
        });
        return {
          outcome: "failed",
          summary: `Post-write re-read failed for campaign ${input.campaignId}`,
          error: {
            code: "POST_WRITE_MISMATCH",
            message: `Could not confirm the applied budget: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
      }
      if (appliedCents !== input.toCents) {
        await deps.attemptStore.markRecoveryRequired({
          executionWorkUnitId: workUnitId,
          organizationId,
        });
        return {
          outcome: "failed",
          summary: `Applied budget ${appliedCents ?? "null"} does not match the approved ${input.toCents}`,
          error: {
            code: "POST_WRITE_MISMATCH",
            message: `Re-read budget ${appliedCents ?? "null"} != approved ${input.toCents} for campaign ${input.campaignId}.`,
          },
        };
      }

      // 10. Build + validate the receipt, then mark applied. The write SUCCEEDED, so an invalid
      // receipt is a recovery case (reconcile), never a silently-lost move.
      const executedAt = now();
      const receiptParsed = ExecutionReceiptSchema.safeParse({
        kind: "campaign_budget_reallocation",
        organizationId,
        deploymentId,
        adAccountId: input.adAccountId,
        campaignId: input.campaignId,
        workTraceId: approval.workTraceId,
        executionWorkUnitId: workUnitId,
        approvedLifecycleId: approval.approvedLifecycleId,
        bindingHash: approval.bindingHash,
        requestedFromCents: input.fromCents,
        requestedToCents: input.toCents,
        observedPriorCents: live,
        appliedCents,
        deltaCentsSigned: appliedCents - live,
        executedAt: executedAt.toISOString(),
      });
      if (!receiptParsed.success) {
        await deps.attemptStore.markRecoveryRequired({
          executionWorkUnitId: workUnitId,
          organizationId,
        });
        return {
          outcome: "failed",
          summary: `Reallocation applied but the receipt is invalid for campaign ${input.campaignId}`,
          error: {
            code: "MUTATION_RECOVERY_REQUIRED",
            message: `ExecutionReceipt validation failed after a successful write: ${receiptParsed.error.message}`,
          },
        };
      }
      const receipt = receiptParsed.data;

      const applied = await deps.attemptStore.markApplied({
        executionWorkUnitId: workUnitId,
        organizationId,
      });
      if (!applied.transitioned) {
        // The write + re-read both succeeded but the marker did not flip to applied (lease
        // lazily expired/reaped, or already non-pending). Safe direction -- never a second write
        // -- but a later replay could surface a false recovery card; make it observable.
        console.warn(
          `[riley-reallocate] applied marker did not transition org=${organizationId} workUnit=${workUnitId}; a replay may surface a false recovery card`,
        );
      }

      // Bookkeeping: stamp the source recommendation. NEVER fails the unit -- the Meta write +
      // receipt + applied marker are the execution truth the operator was promised. not_found after
      // a successful write is suspicious (stale/cross-org/bad id) and warn-logged; infra errors are
      // error-logged; the benign first-writer-won race (not_pending) stays silent.
      let recommendationTransition: "acted" | "not_found" | "not_pending" | "error";
      try {
        const transition = await deps.markRecommendationActed({
          organizationId,
          recommendationId: input.recommendationId,
          executableWorkUnitId: workUnitId,
          executedAt,
        });
        recommendationTransition = transition.transitioned ? "acted" : transition.reason;
        if (recommendationTransition === "not_found") {
          console.warn(
            `[riley-reallocate] recommendation not found after successful reallocation org=${organizationId} rec=${input.recommendationId} workUnit=${workUnitId}`,
          );
        }
      } catch (err) {
        recommendationTransition = "error";
        console.error(
          `[riley-reallocate] failed to mark recommendation acted org=${organizationId} rec=${input.recommendationId} workUnit=${workUnitId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return {
        outcome: "completed",
        summary: `Reallocated campaign ${input.campaignId} daily budget ${live} -> ${appliedCents} cents on Meta (Riley self-execution, human-approved)`,
        outputs: { receipt, replayed: false, recommendationTransition },
      };
    },
  };
}
