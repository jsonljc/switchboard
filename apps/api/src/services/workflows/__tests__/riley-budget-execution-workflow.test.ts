import { describe, it, expect, vi } from "vitest";
import { buildRileyBudgetExecutionWorkflow } from "../riley-budget-execution-workflow.js";
import { ExecutionReceiptSchema, type ExecutionReceipt } from "@switchboard/schemas";
import { DEFAULT_BLAST_RADIUS_CONTRACT } from "@switchboard/ad-optimizer";
import type { WorkUnit, WorkflowRuntimeServices } from "@switchboard/core/platform";
import { setMetrics, createInMemoryMetrics, getMetrics } from "@switchboard/core";

const services = {} as WorkflowRuntimeServices; // executor never submits child work
const NOW = new Date("2026-06-14T12:00:00.000Z");

type Params = {
  recommendationId: string;
  actionType: string;
  adAccountId: string;
  campaignId: string;
  fromCents: number;
  toCents: number;
};

function params(over?: Partial<Params> & Record<string, unknown>): Record<string, unknown> {
  return {
    recommendationId: "rec_1",
    actionType: "scale",
    adAccountId: "act_1",
    campaignId: "camp_1",
    fromCents: 5000,
    toCents: 6000,
    spendAmount: 10,
    rationale: "scale the winner",
    evidence: { clicks: 100, conversions: 12, days: 7 },
    ...over,
  };
}

function workUnit(parameters?: Record<string, unknown>): WorkUnit {
  return {
    id: "wu_realloc_1",
    requestedAt: "2026-06-14T11:00:00.000Z",
    organizationId: "org_1",
    actor: { id: "system", type: "system" },
    intent: "adoptimizer.campaign.reallocate",
    parameters: parameters ?? params(),
    deployment: {
      deploymentId: "dep_riley",
      skillSlug: "ad-optimizer",
      trustLevel: "supervised",
      trustScore: 0,
    },
    resolvedMode: "workflow",
    traceId: "trace_1",
    trigger: "internal",
    priority: "normal",
  } as WorkUnit;
}

type Campaign = {
  campaignId: string;
  name: string;
  status: string;
  dailyBudgetCents: number | null;
};
const campaign = (dailyBudgetCents: number | null): Campaign => ({
  campaignId: "camp_1",
  name: "C",
  status: "ACTIVE",
  dailyBudgetCents,
});

type ApprovalCtx = {
  approvalOutcome?: "approved" | "rejected" | "patched" | "expired";
  approvedLifecycleId?: string;
  bindingHash?: string;
  workTraceId?: string;
};

type AttemptStore = {
  findByExecutionWorkUnitId: (w: string) => Promise<{ status: string } | null | undefined>;
  claimLeaseAndMark: (input: {
    organizationId: string;
    adAccountId: string;
    campaignId: string;
    executionWorkUnitId: string;
    observedPriorCents: number;
    requestedToCents: number;
    workTraceId?: string;
    deploymentId?: string;
    now: Date;
  }) => Promise<{ claimed: true } | { claimed: false }>;
  markApplied: (a: {
    executionWorkUnitId: string;
    organizationId: string;
  }) => Promise<{ transitioned: boolean }>;
  markRecoveryRequired: (a: {
    executionWorkUnitId: string;
    organizationId: string;
  }) => Promise<{ transitioned: boolean }>;
};

/**
 * A real in-memory marker store with the lease semantics of the durable one (claim is
 * first-writer-wins per executionWorkUnitId; applied/recovery flip the status). Used to prove the
 * at-most-once invariant end-to-end across two executor runs sharing ONE store.
 */
function inMemoryAttemptStore(): AttemptStore & { markers: Map<string, { status: string }> } {
  const markers = new Map<string, { status: string }>();
  return {
    markers,
    findByExecutionWorkUnitId: async (w) => markers.get(w) ?? null,
    claimLeaseAndMark: async (input) => {
      if (markers.has(input.executionWorkUnitId)) return { claimed: false as const };
      markers.set(input.executionWorkUnitId, { status: "pending" });
      return { claimed: true as const };
    },
    markApplied: async (a) => {
      const m = markers.get(a.executionWorkUnitId);
      if (m) m.status = "applied";
      return { transitioned: Boolean(m) };
    },
    markRecoveryRequired: async (a) => {
      const m = markers.get(a.executionWorkUnitId);
      if (m) m.status = "recovery_required";
      return { transitioned: Boolean(m) };
    },
  };
}

function harness(opts?: {
  approval?: ApprovalCtx;
  creds?: { accessToken: string; accountId: string } | "none" | "org_mismatch";
  existingMarker?: { status: string } | null;
  existingReceipt?: ExecutionReceipt;
  getCampaign?: ReturnType<typeof vi.fn>;
  updateCampaignBudget?: ReturnType<typeof vi.fn>;
  getAccountDailySpendCents?: ReturnType<typeof vi.fn>;
  claimLeaseAndMark?: ReturnType<typeof vi.fn>;
  markRecommendationActed?: ReturnType<typeof vi.fn>;
  attemptStore?: AttemptStore;
  killed?: boolean;
}) {
  const defaultApproval: ApprovalCtx = {
    approvalOutcome: "approved",
    approvedLifecycleId: "life_1",
    bindingHash: "hash_1",
    workTraceId: "trace_1",
  };
  const getApprovalContext = vi.fn(async (_a: { organizationId: string; workUnitId: string }) =>
    opts && "approval" in opts ? (opts.approval ?? {}) : defaultApproval,
  );

  // Default: pre-read returns the approved baseline (no drift), every later read returns the target.
  const getCampaign =
    opts?.getCampaign ??
    vi.fn().mockResolvedValueOnce(campaign(5000)).mockResolvedValue(campaign(6000));
  const updateCampaignBudget =
    opts?.updateCampaignBudget ?? vi.fn(async (_id: string, _cents: number) => undefined);
  const getAccountDailySpendCents = opts?.getAccountDailySpendCents ?? vi.fn(async () => 100_000);

  const createAdsClient = vi.fn((_creds: { accessToken: string; accountId: string }) => ({
    getCampaign,
    updateCampaignBudget,
    getAccountDailySpendCents,
  }));

  const findByExecutionWorkUnitId = vi.fn(
    async (_w: string) => (opts?.existingMarker ?? null) as { status: string } | null,
  );
  const claimLeaseAndMark =
    opts?.claimLeaseAndMark ??
    vi.fn(
      async (_input: {
        organizationId: string;
        adAccountId: string;
        campaignId: string;
        executionWorkUnitId: string;
        observedPriorCents: number;
        requestedToCents: number;
        workTraceId?: string;
        now: Date;
      }) => ({ claimed: true as const }),
    );
  const markApplied = vi.fn(
    async (_a: { executionWorkUnitId: string; organizationId: string }) => ({ transitioned: true }),
  );
  const markRecoveryRequired = vi.fn(
    async (_a: { executionWorkUnitId: string; organizationId: string }) => ({ transitioned: true }),
  );
  const getExistingReceipt = vi.fn(async (_w: string) => opts?.existingReceipt);
  const markRecommendationActed =
    opts?.markRecommendationActed ??
    vi.fn(
      async (_a: {
        organizationId: string;
        recommendationId: string;
        executableWorkUnitId: string;
        executedAt: Date;
      }) => ({ transitioned: true as const }),
    );

  const getDeploymentCredentials = vi.fn(async (_org: string, _dep: string) => {
    const c = opts?.creds;
    if (c === "org_mismatch") return { kind: "org_mismatch" as const };
    if (c === "none") return { kind: "none" as const };
    return {
      kind: "ok" as const,
      credentials: c ?? { accessToken: "tok", accountId: "act_1" },
    };
  });

  const attemptStore: AttemptStore = opts?.attemptStore ?? {
    findByExecutionWorkUnitId,
    claimLeaseAndMark,
    markApplied,
    markRecoveryRequired,
  };
  const isReallocateKilled = vi.fn(
    async (_a: { organizationId: string; deploymentId: string }) => opts?.killed ?? false,
  );
  const handler = buildRileyBudgetExecutionWorkflow({
    getApprovalContext,
    isReallocateKilled,
    getDeploymentCredentials,
    createAdsClient,
    attemptStore,
    getExistingReceipt,
    markRecommendationActed,
    contract: DEFAULT_BLAST_RADIUS_CONTRACT,
    now: () => NOW,
  });

  return {
    handler,
    getApprovalContext,
    isReallocateKilled,
    getDeploymentCredentials,
    createAdsClient,
    getCampaign,
    updateCampaignBudget,
    getAccountDailySpendCents,
    findByExecutionWorkUnitId,
    claimLeaseAndMark,
    markApplied,
    markRecoveryRequired,
    getExistingReceipt,
    markRecommendationActed,
  };
}

const validReceipt: ExecutionReceipt = {
  kind: "campaign_budget_reallocation",
  organizationId: "org_1",
  deploymentId: "dep_riley",
  adAccountId: "act_1",
  campaignId: "camp_1",
  workTraceId: "trace_1",
  executionWorkUnitId: "wu_realloc_1",
  approvedLifecycleId: "life_1",
  bindingHash: "hash_1",
  requestedFromCents: 5000,
  requestedToCents: 6000,
  observedPriorCents: 5000,
  appliedCents: 6000,
  deltaCentsSigned: 1000,
  executedAt: "2026-06-14T12:00:00.000Z",
};

describe("buildRileyBudgetExecutionWorkflow — happy path (S2)", () => {
  it("reallocates the budget, persists a valid receipt, marks applied, stamps the recommendation", async () => {
    const h = harness();
    const res = await h.handler.execute(workUnit(), services);

    expect(res.outcome).toBe("completed");
    const receipt = (res.outputs as { receipt: unknown; replayed: boolean }).receipt;
    const parsed = ExecutionReceiptSchema.safeParse(receipt);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe("campaign_budget_reallocation");
      // Narrow the discriminated union to read the reallocation-only fields.
      if (parsed.data.kind === "campaign_budget_reallocation") {
        expect(parsed.data.observedPriorCents).toBe(5000);
        expect(parsed.data.appliedCents).toBe(6000);
        expect(parsed.data.deltaCentsSigned).toBe(1000);
        expect(parsed.data.approvedLifecycleId).toBe("life_1");
        expect(parsed.data.bindingHash).toBe("hash_1");
        expect(parsed.data.workTraceId).toBe("trace_1");
        expect(parsed.data.deploymentId).toBe("dep_riley");
      }
    }
    expect((res.outputs as { replayed: boolean }).replayed).toBe(false);

    // exactly four Graph calls: pre-read, account spend, write, post-read.
    expect(h.getCampaign.mock.calls.length).toBe(2);
    expect(h.getAccountDailySpendCents.mock.calls.length).toBe(1);
    expect(h.updateCampaignBudget.mock.calls).toEqual([["camp_1", 6000]]);

    // The claim stamps the reallocation's deployment so the guardrail monitor can find + attribute it.
    expect(h.claimLeaseAndMark).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: "dep_riley" }),
    );

    expect(h.markApplied).toHaveBeenCalledWith({
      executionWorkUnitId: "wu_realloc_1",
      organizationId: "org_1",
    });
    expect(h.markRecoveryRequired).not.toHaveBeenCalled();
    expect(h.markRecommendationActed).toHaveBeenCalledWith(
      expect.objectContaining({
        recommendationId: "rec_1",
        executableWorkUnitId: "wu_realloc_1",
        organizationId: "org_1",
      }),
    );
  });
});

describe("buildRileyBudgetExecutionWorkflow — approval + replay (S3)", () => {
  it("refuses an unapproved unit without touching credentials or Meta", async () => {
    const h = harness({ approval: { approvalOutcome: "rejected" } });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("REALLOCATE_NOT_APPROVED");
    expect(h.getDeploymentCredentials).not.toHaveBeenCalled();
    expect(h.getCampaign).not.toHaveBeenCalled();
  });

  it("refuses when the outcome is absent", async () => {
    const h = harness({ approval: {} });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("REALLOCATE_NOT_APPROVED");
  });

  it("refuses an approved-but-unbound unit (missing bindingHash/lifecycle)", async () => {
    const h = harness({ approval: { approvalOutcome: "approved", workTraceId: "trace_1" } });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("REALLOCATE_NOT_APPROVED");
    expect(h.getDeploymentCredentials).not.toHaveBeenCalled();
  });

  it("replays a prior success receipt with zero Meta calls", async () => {
    const h = harness({ existingMarker: { status: "applied" }, existingReceipt: validReceipt });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.outcome).toBe("completed");
    expect((res.outputs as { replayed: boolean }).replayed).toBe(true);
    expect(h.getCampaign).not.toHaveBeenCalled();
    expect(h.getDeploymentCredentials).not.toHaveBeenCalled();
  });

  it("blocks auto-retry on an unresolved pending marker (recovery required, zero Meta)", async () => {
    const h = harness({ existingMarker: { status: "pending" } });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("MUTATION_RECOVERY_REQUIRED");
    expect(h.getCampaign).not.toHaveBeenCalled();
  });

  it("blocks auto-retry on a recovery_required marker", async () => {
    const h = harness({ existingMarker: { status: "recovery_required" } });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("MUTATION_RECOVERY_REQUIRED");
  });

  it("treats an applied marker with no receipt as recovery required", async () => {
    const h = harness({ existingMarker: { status: "applied" } });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("MUTATION_RECOVERY_REQUIRED");
    expect(h.getCampaign).not.toHaveBeenCalled();
  });
});

describe("buildRileyBudgetExecutionWorkflow — credentials + reads (S4); clean fail leaves no marker", () => {
  it("DEPLOYMENT_ORG_MISMATCH", async () => {
    const h = harness({ creds: "org_mismatch" });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("DEPLOYMENT_ORG_MISMATCH");
    expect(h.getCampaign).not.toHaveBeenCalled();
    expect(h.claimLeaseAndMark).not.toHaveBeenCalled();
  });

  it("NO_META_CONNECTION", async () => {
    const h = harness({ creds: "none" });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("NO_META_CONNECTION");
    expect(h.claimLeaseAndMark).not.toHaveBeenCalled();
  });

  it("ACCOUNT_MISMATCH when the connection account differs from the frozen account", async () => {
    const h = harness({ creds: { accessToken: "tok", accountId: "act_other" } });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("ACCOUNT_MISMATCH");
    expect(h.getCampaign).not.toHaveBeenCalled();
    expect(h.claimLeaseAndMark).not.toHaveBeenCalled();
  });

  it("CAMPAIGN_BUDGET_UNREADABLE when the pre-read throws", async () => {
    const h = harness({ getCampaign: vi.fn().mockRejectedValue(new Error("graph #100")) });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("CAMPAIGN_BUDGET_UNREADABLE");
    expect(h.claimLeaseAndMark).not.toHaveBeenCalled();
  });

  it("UNSUPPORTED_BUDGET_TOPOLOGY when the daily budget is null", async () => {
    const h = harness({ getCampaign: vi.fn().mockResolvedValue(campaign(null)) });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("UNSUPPORTED_BUDGET_TOPOLOGY");
    expect(h.claimLeaseAndMark).not.toHaveBeenCalled();
  });

  it("BUDGET_DRIFTED when the live budget no longer matches the approved baseline", async () => {
    const h = harness({ getCampaign: vi.fn().mockResolvedValue(campaign(5500)) });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("BUDGET_DRIFTED");
    expect(h.claimLeaseAndMark).not.toHaveBeenCalled();
    expect(h.updateCampaignBudget).not.toHaveBeenCalled();
  });

  it("ACCOUNT_SPEND_UNREADABLE when account spend throws", async () => {
    const h = harness({ getAccountDailySpendCents: vi.fn().mockRejectedValue(new Error("rate")) });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("ACCOUNT_SPEND_UNREADABLE");
    expect(h.claimLeaseAndMark).not.toHaveBeenCalled();
  });
});

describe("buildRileyBudgetExecutionWorkflow — cap, lease, write (S5)", () => {
  it("DELTA_CAP and writes no marker", async () => {
    const h = harness();
    const res = await h.handler.execute(workUnit(params({ toCents: 50_000 })), services);
    expect(res.error?.code).toBe("DELTA_CAP");
    expect(h.claimLeaseAndMark).not.toHaveBeenCalled();
  });

  it("SHARE_CAP when the delta exceeds the account-spend share", async () => {
    const h = harness({ getAccountDailySpendCents: vi.fn(async () => 10_000) });
    const res = await h.handler.execute(workUnit(params({ toCents: 10_000 })), services);
    expect(res.error?.code).toBe("SHARE_CAP");
    expect(h.claimLeaseAndMark).not.toHaveBeenCalled();
  });

  it("SHARE_CAP (fail closed) when account spend is null", async () => {
    const h = harness({ getAccountDailySpendCents: vi.fn(async () => null) });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("SHARE_CAP");
    expect(h.claimLeaseAndMark).not.toHaveBeenCalled();
  });

  it("LEASE_CONTENDED when the claim is not granted, without writing", async () => {
    const h = harness({ claimLeaseAndMark: vi.fn(async () => ({ claimed: false as const })) });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("LEASE_CONTENDED");
    expect(h.updateCampaignBudget).not.toHaveBeenCalled();
  });

  it("META_WRITE_ERROR marks the attempt recovery_required", async () => {
    const h = harness({
      updateCampaignBudget: vi.fn().mockRejectedValue(new Error("graph 500")),
    });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("META_WRITE_ERROR");
    expect(h.markRecoveryRequired).toHaveBeenCalledWith({
      executionWorkUnitId: "wu_realloc_1",
      organizationId: "org_1",
    });
    expect(h.markApplied).not.toHaveBeenCalled();
  });

  it("at-most-once end-to-end: the marker a thrown write leaves is the one the replay refuses on, ZERO Meta calls (§13 #1)", async () => {
    // ONE shared marker store across both attempts: attempt 1 commits the marker before the write,
    // the write throws and flips it to recovery_required; attempt 2 (replay) reads THAT marker.
    const store = inMemoryAttemptStore();

    const first = harness({
      attemptStore: store,
      updateCampaignBudget: vi.fn().mockRejectedValue(new Error("graph 500")),
    });
    const r1 = await first.handler.execute(workUnit(), services);
    expect(r1.error?.code).toBe("META_WRITE_ERROR");
    expect(first.updateCampaignBudget).toHaveBeenCalledTimes(1);
    expect(store.markers.get("wu_realloc_1")?.status).toBe("recovery_required");

    // Replay against the SAME store: short-circuits before any Meta call.
    const replay = harness({ attemptStore: store });
    const r2 = await replay.handler.execute(workUnit(), services);
    expect(r2.error?.code).toBe("MUTATION_RECOVERY_REQUIRED");
    expect(replay.getCampaign).not.toHaveBeenCalled();
    expect(replay.updateCampaignBudget).not.toHaveBeenCalled();
  });

  it("POST_WRITE_MISMATCH when the re-read budget differs from the approved target", async () => {
    const getCampaign = vi
      .fn()
      .mockResolvedValueOnce(campaign(5000))
      .mockResolvedValue(campaign(5500));
    const h = harness({ getCampaign });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("POST_WRITE_MISMATCH");
    expect(h.markRecoveryRequired).toHaveBeenCalledTimes(1);
    expect(h.markApplied).not.toHaveBeenCalled();
  });

  it("POST_WRITE_MISMATCH when the re-read throws", async () => {
    const getCampaign = vi
      .fn()
      .mockResolvedValueOnce(campaign(5000))
      .mockRejectedValue(new Error("read failed"));
    const h = harness({ getCampaign });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("POST_WRITE_MISMATCH");
    expect(h.markRecoveryRequired).toHaveBeenCalledTimes(1);
  });

  it("a not_found recommendation stamp is non-fatal: the unit still completes", async () => {
    const h = harness({
      markRecommendationActed: vi.fn(async () => ({
        transitioned: false as const,
        reason: "not_found" as const,
      })),
    });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.outcome).toBe("completed");
    expect((res.outputs as { recommendationTransition: string }).recommendationTransition).toBe(
      "not_found",
    );
    expect(h.markApplied).toHaveBeenCalledTimes(1);
  });
});

describe("buildRileyBudgetExecutionWorkflow — cap telemetry (A6)", () => {
  it("emits within_cap on an accepted move", async () => {
    setMetrics(createInMemoryMetrics());
    const incSpy = vi.spyOn(getMetrics().rileyReallocationCapEvaluated, "inc");
    const h = harness();
    await h.handler.execute(workUnit(), services);
    expect(incSpy).toHaveBeenCalledWith({ orgId: "org_1", outcome: "within_cap" });
  });

  it("emits delta_cap when the dollar cap is breached", async () => {
    setMetrics(createInMemoryMetrics());
    const incSpy = vi.spyOn(getMetrics().rileyReallocationCapEvaluated, "inc");
    const h = harness();
    await h.handler.execute(workUnit(params({ toCents: 50_000 })), services);
    expect(incSpy).toHaveBeenCalledWith({ orgId: "org_1", outcome: "delta_cap" });
  });

  it("emits share_cap when account spend cannot size the move (null spend)", async () => {
    setMetrics(createInMemoryMetrics());
    const incSpy = vi.spyOn(getMetrics().rileyReallocationCapEvaluated, "inc");
    const h = harness({ getAccountDailySpendCents: vi.fn(async () => null) });
    await h.handler.execute(workUnit(), services);
    expect(incSpy).toHaveBeenCalledWith({ orgId: "org_1", outcome: "share_cap" });
  });
});

describe("buildRileyBudgetExecutionWorkflow — in-flight kill-switch (runbook §3)", () => {
  it("aborts a killed execution with RILEY_REALLOCATE_KILLED and NO marker / NO Meta write", async () => {
    const h = harness({ killed: true });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("RILEY_REALLOCATE_KILLED");
    // Clean abort: no lease claimed (re-runnable), no credentials resolved, no Meta call.
    expect(h.claimLeaseAndMark).not.toHaveBeenCalled();
    expect(h.getDeploymentCredentials).not.toHaveBeenCalled();
    expect(h.getCampaign).not.toHaveBeenCalled();
    expect(h.updateCampaignBudget).not.toHaveBeenCalled();
  });

  it("checks the kill-switch org-scoped, by the work unit's deployment", async () => {
    const h = harness();
    await h.handler.execute(workUnit(), services);
    expect(h.isReallocateKilled).toHaveBeenCalledWith({
      organizationId: "org_1",
      deploymentId: "dep_riley",
    });
  });

  it("a replay of an already-applied unit STILL returns its receipt even when killed (kill is after replay)", async () => {
    const h = harness({
      killed: true,
      existingMarker: { status: "applied" },
      existingReceipt: validReceipt,
    });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.outcome).toBe("completed");
    expect((res.outputs as { replayed: boolean }).replayed).toBe(true);
    // The kill-switch never ran (the replay short-circuited first); no new Meta write.
    expect(h.isReallocateKilled).not.toHaveBeenCalled();
    expect(h.updateCampaignBudget).not.toHaveBeenCalled();
  });
});

describe("buildRileyBudgetExecutionWorkflow - EV-11 pre-flip gate (MONEY-9: fresh client per Graph call)", () => {
  it("builds a FRESH MetaAdsClient for each of the four Graph operations (no shared 60s-limited instance)", async () => {
    // MONEY-9 dispatch call-site contract. The per-instance 60s limiter paces the audit crons, NOT
    // this human-latency reallocate dispatch: the read-modify-re-read executor builds a fresh client
    // for the pre-read, the account-spend read, the budget write, and the post-write re-read so
    // independent operator-approved moves never serialize behind one another's 60s window. Teeth:
    // hoisting one client and reusing it across the ops drops this count below four.
    const h = harness();
    const res = await h.handler.execute(workUnit(), services);
    expect(res.outcome).toBe("completed");
    expect(h.createAdsClient).toHaveBeenCalledTimes(4);
    for (const call of h.createAdsClient.mock.calls) {
      expect(call[0]).toEqual({ accessToken: "tok", accountId: "act_1" });
    }
  });
});
