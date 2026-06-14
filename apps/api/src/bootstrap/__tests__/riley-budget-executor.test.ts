import { describe, it, expect, vi } from "vitest";
import {
  buildGetReallocateApprovalContext,
  buildGetExistingReceipt,
  buildRileyBudgetExecutorHandler,
} from "../riley-budget-executor.js";
import type { WorkTrace, WorkTraceReadResult } from "@switchboard/core/platform";
import type { ExecutionReceipt } from "@switchboard/schemas";

function traceRead(over: Partial<WorkTrace>): WorkTraceReadResult {
  return {
    trace: {
      workUnitId: "wu_1",
      traceId: "trace_1",
      organizationId: "org_1",
      approvalId: "life_1",
      approvalOutcome: "approved",
      approvalRespondedBy: "user_owner",
      contentHash: "hash_1",
      ...over,
    } as WorkTrace,
    integrity: { status: "ok" },
  } as WorkTraceReadResult;
}

const receipt: ExecutionReceipt = {
  kind: "campaign_budget_reallocation",
  organizationId: "org_1",
  deploymentId: "dep_riley",
  adAccountId: "act_1",
  campaignId: "camp_1",
  workTraceId: "trace_1",
  executionWorkUnitId: "wu_1",
  approvedLifecycleId: "life_1",
  bindingHash: "hash_1",
  requestedFromCents: 5000,
  requestedToCents: 6000,
  observedPriorCents: 5000,
  appliedCents: 6000,
  deltaCentsSigned: 1000,
  executedAt: "2026-06-14T12:00:00.000Z",
};

describe("buildGetReallocateApprovalContext", () => {
  it("surfaces outcome + the receipt's binding inputs for a matching-org trace", async () => {
    const store = { getByWorkUnitId: vi.fn(async () => traceRead({})) };
    const ctx = await buildGetReallocateApprovalContext(store)({
      organizationId: "org_1",
      workUnitId: "wu_1",
    });
    expect(ctx).toEqual({
      approvalOutcome: "approved",
      approvedLifecycleId: "life_1",
      bindingHash: "hash_1",
      workTraceId: "trace_1",
    });
  });

  it("is org-scoped: a cross-tenant trace reads as no approval", async () => {
    const store = {
      getByWorkUnitId: vi.fn(async () => traceRead({ organizationId: "org_other" })),
    };
    const ctx = await buildGetReallocateApprovalContext(store)({
      organizationId: "org_1",
      workUnitId: "wu_1",
    });
    expect(ctx).toEqual({});
  });

  it("reads as no approval when the trace is absent", async () => {
    const store = { getByWorkUnitId: vi.fn(async () => null) };
    const ctx = await buildGetReallocateApprovalContext(store)({
      organizationId: "org_1",
      workUnitId: "wu_1",
    });
    expect(ctx).toEqual({});
  });
});

describe("buildGetExistingReceipt", () => {
  it("parses a valid receipt off WorkTrace.executionOutputs", async () => {
    const store = {
      getByWorkUnitId: vi.fn(async () => traceRead({ executionOutputs: { receipt } })),
    };
    const out = await buildGetExistingReceipt(store)("wu_1");
    expect(out?.appliedCents).toBe(6000);
  });

  it("returns undefined when there is no receipt", async () => {
    const store = { getByWorkUnitId: vi.fn(async () => traceRead({ executionOutputs: {} })) };
    expect(await buildGetExistingReceipt(store)("wu_1")).toBeUndefined();
  });

  it("returns undefined when the stored receipt no longer validates", async () => {
    const store = {
      getByWorkUnitId: vi.fn(async () =>
        traceRead({ executionOutputs: { receipt: { kind: "campaign_budget_reallocation" } } }),
      ),
    };
    expect(await buildGetExistingReceipt(store)("wu_1")).toBeUndefined();
  });
});

describe("buildRileyBudgetExecutorHandler", () => {
  it("registers the reallocate intent with a real handler (no longer the fail-closed placeholder)", async () => {
    const prisma = {
      agentDeployment: { findUnique: vi.fn(async () => null) },
      deploymentConnection: { findFirst: vi.fn(async () => null) },
      recommendation: { updateMany: vi.fn(async () => ({ count: 0 })) },
      metaMutationAttempt: { findUnique: vi.fn(async () => null) },
    };
    const store = { getByWorkUnitId: vi.fn(async () => traceRead({})) };
    const { intent, handler } = await buildRileyBudgetExecutorHandler(prisma, store);
    expect(intent).toBe("adoptimizer.campaign.reallocate");
    expect(typeof handler.execute).toBe("function");
  });
});
