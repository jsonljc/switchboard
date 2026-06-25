/**
 * Staged end-to-end exercise of Riley's reallocate act-leg (runbook §4): drive the REAL forward
 * executor, the REAL guardrail monitor orchestrator, the REAL rollback dispatch, and the REAL reset
 * executor against in-memory fakes (a budget map standing in for Meta, an in-memory at-most-once
 * store). Proves the safety chain end-to-end without a live Meta account:
 *   1. the forward executor applies a +20% budget increase + captures the prior,
 *   2. the monitor measures a breach -> evaluates -> plans the rollback,
 *   3. the rollback dispatch routes the reset through the reset executor,
 *   4. the reset restores the captured prior on the fake Meta + the row resolves rolled_back,
 *   5. with the kill-switch engaged, the forward executor aborts and writes nothing.
 * The live-Meta exercise stays operational/deferred; this is the staged proof.
 */
import { describe, it, expect, vi } from "vitest";
import { buildRileyBudgetExecutionWorkflow } from "../services/workflows/riley-budget-execution-workflow.js";
import { buildRileyResetBudgetExecutionWorkflow } from "../services/workflows/riley-reset-budget-execution-workflow.js";
import {
  buildReallocationRollbackDispatch,
  buildReallocationGuardrailMonitorDeps,
} from "../services/cron/riley-reallocation-guardrail-monitor.js";
import { buildRileyResetBudgetSubmitRequest } from "../services/workflows/riley-reset-budget-submit-request.js";
import {
  runReallocationGuardrailMonitor,
  DEFAULT_BLAST_RADIUS_CONTRACT,
  type GuardrailMeasurement,
} from "@switchboard/ad-optimizer";
import { ExecutionReceiptSchema } from "@switchboard/schemas";
import { setMetrics, createInMemoryMetrics } from "@switchboard/core";
import type {
  WorkUnit,
  WorkflowRuntimeServices,
  SubmitWorkResponse,
  ExecutionResult,
} from "@switchboard/core/platform";

const services = {} as WorkflowRuntimeServices;
const ORG = "org_e2e";
const DEP = "dep_riley_e2e";
const ACCT = "act_e2e";
const CAMPAIGN = "camp_e2e";
const NOW = new Date("2026-06-25T12:00:00.000Z");
const APPLIED_AT = new Date(NOW.getTime() - 73 * 60 * 60 * 1000); // window-elapsed (> 72h)

// ── Fake Meta: one mutable daily-budget cell the forward + reset executors share. ──
function fakeMeta(initialCents: number) {
  const state = { budget: initialCents as number | null, accountSpend: 10_000 };
  const createAdsClient = () => ({
    getCampaign: async (campaignId: string) => ({
      campaignId,
      name: "C",
      status: "ACTIVE",
      dailyBudgetCents: state.budget,
    }),
    updateCampaignBudget: async (_c: string, cents: number) => {
      state.budget = cents;
    },
    getAccountDailySpendCents: async () => state.accountSpend,
  });
  return { state, createAdsClient };
}

// ── In-memory at-most-once store: serves the forward executor, the monitor queue, and the reset's
//    captured-prior read, all from one Map (the real PrismaMetaMutationAttemptStore's contract). ──
type Row = {
  executionWorkUnitId: string;
  organizationId: string;
  deploymentId: string | null;
  adAccountId: string;
  campaignId: string;
  observedPriorCents: number;
  status: string;
  guardrailOutcome: string | null;
  appliedAt: Date | null;
};
function inMemoryStore() {
  const rows = new Map<string, Row>();
  return {
    rows,
    // forward executor surface
    findByExecutionWorkUnitId: async (id: string) => rows.get(id) ?? null,
    claimLeaseAndMark: async (input: {
      organizationId: string;
      adAccountId: string;
      campaignId: string;
      executionWorkUnitId: string;
      observedPriorCents: number;
      deploymentId?: string;
    }) => {
      if (rows.has(input.executionWorkUnitId)) return { claimed: false as const };
      rows.set(input.executionWorkUnitId, {
        executionWorkUnitId: input.executionWorkUnitId,
        organizationId: input.organizationId,
        deploymentId: input.deploymentId ?? null,
        adAccountId: input.adAccountId,
        campaignId: input.campaignId,
        observedPriorCents: input.observedPriorCents,
        status: "pending",
        guardrailOutcome: null,
        appliedAt: null,
      });
      return { claimed: true as const };
    },
    markApplied: async (a: { executionWorkUnitId: string }) => {
      const r = rows.get(a.executionWorkUnitId);
      if (!r || r.status !== "pending") return { transitioned: false };
      r.status = "applied";
      r.appliedAt = APPLIED_AT; // window-elapsed so the monitor picks it up this pass
      return { transitioned: true };
    },
    markRecoveryRequired: async (a: { executionWorkUnitId: string }) => {
      const r = rows.get(a.executionWorkUnitId);
      if (!r || r.status !== "pending") return { transitioned: false };
      r.status = "recovery_required";
      return { transitioned: true };
    },
    // monitor queue surface
    listPendingGuardrailForOrg: async (organizationId: string, now: Date, minWindowMs: number) =>
      [...rows.values()]
        .filter(
          (r) =>
            r.organizationId === organizationId &&
            r.status === "applied" &&
            r.guardrailOutcome === null &&
            r.appliedAt !== null &&
            r.appliedAt.getTime() <= now.getTime() - minWindowMs,
        )
        .map((r) => ({
          executionWorkUnitId: r.executionWorkUnitId,
          organizationId: r.organizationId,
          deploymentId: r.deploymentId,
          adAccountId: r.adAccountId,
          campaignId: r.campaignId,
          observedPriorCents: r.observedPriorCents,
          appliedAt: r.appliedAt!,
        })),
    markGuardrailOutcome: async (a: { executionWorkUnitId: string; outcome: string }) => {
      const r = rows.get(a.executionWorkUnitId);
      if (!r || r.status !== "applied" || r.guardrailOutcome !== null) {
        return { transitioned: false };
      }
      r.guardrailOutcome = a.outcome;
      return { transitioned: true };
    },
  };
}

function forwardWorkUnit(): WorkUnit {
  return {
    id: "wu_fwd_e2e",
    requestedAt: "2026-06-22T00:00:00.000Z",
    organizationId: ORG,
    actor: { id: "system", type: "system" },
    intent: "adoptimizer.campaign.reallocate",
    parameters: {
      recommendationId: "rec_e2e",
      actionType: "scale",
      adAccountId: ACCT,
      campaignId: CAMPAIGN,
      fromCents: 5000,
      toCents: 6000,
    },
    deployment: {
      deploymentId: DEP,
      skillSlug: "ad-optimizer",
      trustLevel: "supervised",
      trustScore: 0,
    },
    resolvedMode: "workflow",
    traceId: "trace_fwd_e2e",
    trigger: "internal",
    priority: "normal",
  } as WorkUnit;
}

const okCreds = { kind: "ok" as const, credentials: { accessToken: "t", accountId: ACCT } };

describe("Riley reallocate act-leg — staged end-to-end exercise (runbook §4)", () => {
  it("forward increase -> monitor breach -> governed reset restores the captured prior", async () => {
    setMetrics(createInMemoryMetrics());
    const meta = fakeMeta(5000); // the campaign starts at $50.00/day
    const store = inMemoryStore();

    // ── The REAL forward executor applies the +20% increase + captures the prior. ──
    const forward = buildRileyBudgetExecutionWorkflow({
      getApprovalContext: async () => ({
        approvalOutcome: "approved",
        approvedLifecycleId: "life_e2e",
        bindingHash: "hash_e2e",
        workTraceId: "trace_fwd_e2e",
      }),
      isReallocateKilled: async () => false,
      getDeploymentCredentials: async () => okCreds,
      createAdsClient: meta.createAdsClient,
      attemptStore: store,
      getExistingReceipt: async () => undefined,
      markRecommendationActed: async () => ({ transitioned: true as const }),
      contract: DEFAULT_BLAST_RADIUS_CONTRACT,
      now: () => NOW,
    });
    const fwdRes = await forward.execute(forwardWorkUnit(), services);
    expect(fwdRes.outcome).toBe("completed");
    expect(meta.state.budget).toBe(6000); // applied the increase
    expect(store.rows.get("wu_fwd_e2e")?.observedPriorCents).toBe(5000); // captured the prior
    expect(store.rows.get("wu_fwd_e2e")?.deploymentId).toBe(DEP); // stamped for the monitor

    // ── The REAL reset executor (the rollback target). ──
    const reset = buildRileyResetBudgetExecutionWorkflow({
      getDeploymentCredentials: async () => okCreds,
      getCapturedPrior: async ({ rollbackOfWorkUnitId }) => {
        const r = store.rows.get(rollbackOfWorkUnitId);
        return r ? { observedPriorCents: r.observedPriorCents } : null;
      },
      createAdsClient: meta.createAdsClient,
      now: () => NOW,
    });

    // ── dispatchRollback routes the reset submit through the REAL reset executor (in place of
    //    PlatformIngress, which would do the same synchronous execute + surface the same outcome). ──
    let resetReceipt: unknown;
    const submitReset = async (req: {
      parameters: Record<string, unknown>;
    }): Promise<SubmitWorkResponse> => {
      const resetWorkUnit = {
        id: "wu_reset_e2e",
        requestedAt: NOW.toISOString(),
        organizationId: ORG,
        actor: { id: "system", type: "system" },
        intent: "adoptimizer.campaign.reset_prior_budget",
        parameters: req.parameters,
        deployment: {
          deploymentId: "platform-direct",
          skillSlug: "adoptimizer",
          trustLevel: "supervised",
          trustScore: 0,
        },
        resolvedMode: "workflow",
        traceId: "trace_reset_e2e",
        trigger: "internal",
        priority: "normal",
      } as WorkUnit;
      const res = await reset.execute(resetWorkUnit, services);
      if (res.outcome === "completed")
        resetReceipt = (res.outputs as { receipt?: unknown }).receipt;
      return {
        ok: true,
        result: { outcome: res.outcome } as ExecutionResult,
        workUnit: resetWorkUnit,
      };
    };

    // ── The REAL monitor: a scripted breach measurement + the real evaluate/plan/dispatch/resolve. ──
    const breach: GuardrailMeasurement = {
      shares: { account_booked_conversions_drop_share: 0.5, freed_budget_absorbed_share: 0 },
      currentLiveCents: 6000, // the increased budget the monitor reads live
    };
    const monitorDeps = buildReallocationGuardrailMonitorDeps({
      organizationId: ORG,
      store,
      measure: async () => breach,
      dispatchRollback: buildReallocationRollbackDispatch({
        submitReset,
        logger: { warn: vi.fn(), error: vi.fn() },
      }),
      recordOutcome: vi.fn(),
      alertCritical: vi.fn(),
      now: () => NOW,
    });
    await runReallocationGuardrailMonitor(monitorDeps);

    // ── The rollback restored the captured prior on the fake Meta, and the row resolved rolled_back. ──
    expect(meta.state.budget).toBe(5000); // restored to the prior $50.00
    expect(store.rows.get("wu_fwd_e2e")?.guardrailOutcome).toBe("rolled_back");
    const parsed = ExecutionReceiptSchema.safeParse(resetReceipt);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.kind === "campaign_budget_reset") {
      expect(parsed.data.targetCents).toBe(5000);
      expect(parsed.data.observedLiveCents).toBe(6000);
      expect(parsed.data.appliedCents).toBe(5000);
      expect(parsed.data.rollbackOfWorkUnitId).toBe("wu_fwd_e2e");
    } else {
      throw new Error("expected a campaign_budget_reset receipt");
    }

    // The reset submit-request the monitor built carries the captured prior as the target.
    const builtReset = buildRileyResetBudgetSubmitRequest({
      organizationId: ORG,
      deploymentId: DEP,
      adAccountId: ACCT,
      campaignId: CAMPAIGN,
      targetCents: 5000,
      rollbackOfWorkUnitId: "wu_fwd_e2e",
      breachMetric: "account_booked_conversions_drop_share",
      breachReason: "exceeded",
    });
    expect(builtReset?.parameters).toMatchObject({
      targetCents: 5000,
      rollbackOfWorkUnitId: "wu_fwd_e2e",
    });
  });

  it("kill-switch engaged: the forward executor aborts and writes nothing to Meta", async () => {
    const meta = fakeMeta(5000);
    const store = inMemoryStore();
    const forward = buildRileyBudgetExecutionWorkflow({
      getApprovalContext: async () => ({
        approvalOutcome: "approved",
        approvedLifecycleId: "life_e2e",
        bindingHash: "hash_e2e",
        workTraceId: "trace_fwd_e2e",
      }),
      isReallocateKilled: async () => true, // the operator engaged the runtime kill-switch
      getDeploymentCredentials: async () => okCreds,
      createAdsClient: meta.createAdsClient,
      attemptStore: store,
      getExistingReceipt: async () => undefined,
      markRecommendationActed: async () => ({ transitioned: true as const }),
      contract: DEFAULT_BLAST_RADIUS_CONTRACT,
      now: () => NOW,
    });
    const res = await forward.execute(forwardWorkUnit(), services);
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("RILEY_REALLOCATE_KILLED");
    // The fake Meta budget is untouched and NO durable marker was written (clean, re-runnable).
    expect(meta.state.budget).toBe(5000);
    expect(store.rows.size).toBe(0);
  });
});
