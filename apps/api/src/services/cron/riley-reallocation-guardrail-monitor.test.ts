import { describe, it, expect, vi } from "vitest";
import {
  executeReallocationGuardrailDispatch,
  buildReallocationRollbackDispatch,
  buildReallocationGuardrailMonitorDeps,
  executeReallocationGuardrailWorker,
  REALLOCATION_GUARDRAIL_EVENT,
  MIN_GUARDRAIL_WINDOW_MS,
} from "./riley-reallocation-guardrail-monitor.js";
import {
  runReallocationGuardrailMonitor,
  type GuardrailMeasurement,
} from "@switchboard/ad-optimizer";
import type { PendingGuardrailReallocation } from "@switchboard/db";
import type { SubmitWorkResponse, ExecutionResult, WorkUnit } from "@switchboard/core/platform";

// Minimal but correctly-SHAPED SubmitWorkResponse arms (the inner ExecutionResult/WorkUnit are cast,
// but the union arm — ok/result/error/approvalRequired — is real so the dispatch's branch order is
// genuinely exercised, unlike an `as never` fixture).
const okResponse = (outcome: ExecutionResult["outcome"]): SubmitWorkResponse => ({
  ok: true,
  result: { outcome } as ExecutionResult,
  workUnit: {} as WorkUnit,
});
const errResponse = (type: string): SubmitWorkResponse =>
  ({ ok: false, error: { type, message: type } }) as unknown as SubmitWorkResponse;
const parkedResponse = (): SubmitWorkResponse => ({
  ok: true,
  result: { outcome: "pending_approval" } as ExecutionResult,
  workUnit: {} as WorkUnit,
  approvalRequired: true,
});

const NOW = new Date("2026-06-25T12:00:00.000Z");

function row(over: Partial<PendingGuardrailReallocation> = {}): PendingGuardrailReallocation {
  return {
    executionWorkUnitId: "wu_fwd_1",
    organizationId: "org-1",
    deploymentId: "dep_riley",
    adAccountId: "act_1",
    campaignId: "camp_1",
    observedPriorCents: 5000,
    appliedAt: new Date("2026-06-22T00:00:00.000Z"),
    ...over,
  };
}

const HELD: GuardrailMeasurement = {
  shares: { account_booked_conversions_drop_share: 0.1, freed_budget_absorbed_share: 0 },
  currentLiveCents: 6000,
};
const BREACH: GuardrailMeasurement = {
  shares: { account_booked_conversions_drop_share: 0.5, freed_budget_absorbed_share: 0 },
  currentLiveCents: 6000,
};
const BREACH_UNRESTORABLE: GuardrailMeasurement = {
  shares: { account_booked_conversions_drop_share: 0.5 },
  currentLiveCents: Number.NaN, // budget unreadable -> cannot size the rollback
};

describe("executeReallocationGuardrailDispatch", () => {
  it("emits one guardrail-check event per org with pending work", async () => {
    const sendEvent = vi.fn(async () => ({}));
    const res = await executeReallocationGuardrailDispatch({
      listOrgsWithPending: async () => ["org-a", "org-b"],
      sendEvent,
    });
    expect(res).toEqual({ dispatched: 2 });
    expect(sendEvent).toHaveBeenCalledTimes(2);
    expect((sendEvent.mock.calls[0] as unknown[])[0]).toEqual({
      name: REALLOCATION_GUARDRAIL_EVENT,
      data: { orgId: "org-a" },
    });
  });

  it("is inert when no org has pending reallocations (no events)", async () => {
    const sendEvent = vi.fn(async () => ({}));
    const res = await executeReallocationGuardrailDispatch({
      listOrgsWithPending: async () => [],
      sendEvent,
    });
    expect(res).toEqual({ dispatched: 0 });
    expect(sendEvent).not.toHaveBeenCalled();
  });
});

describe("MIN_GUARDRAIL_WINDOW_MS", () => {
  it("is the longest contract guardrail window (72h)", () => {
    expect(MIN_GUARDRAIL_WINDOW_MS).toBe(72 * 60 * 60 * 1000);
  });
});

describe("buildReallocationRollbackDispatch", () => {
  function pending() {
    return {
      executionWorkUnitId: "wu_fwd_1",
      deploymentId: "dep_riley",
      organizationId: "org-1",
      adAccountId: "act_1",
      campaignId: "camp_1",
      observedPriorCents: 5000,
      appliedAt: NOW,
      contract: {
        maxDeltaCents: 5000,
        maxAccountSpendShare: 0.25,
        guardrails: [],
        rollback: { kind: "reset_prior_budget" as const, capturePriorValue: true as const },
      },
    };
  }

  const BREACH_ARG = {
    metric: "account_booked_conversions_drop_share" as const,
    reason: "exceeded" as const,
    measured: 0.5,
    breachAbove: 0.2,
  };
  const PLAN = { targetCents: 5000, deltaCentsSigned: -1000 };

  it("submits the reset built from the breach + plan on a completed execution", async () => {
    const submitReset = vi.fn(async () => okResponse("completed"));
    const dispatch = buildReallocationRollbackDispatch({
      submitReset,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    await dispatch(pending(), PLAN, BREACH_ARG);
    const req = (submitReset.mock.calls[0] as unknown[])[0] as {
      intent: string;
      parameters: Record<string, unknown>;
    };
    expect(req.intent).toBe("adoptimizer.campaign.reset_prior_budget");
    expect(req.parameters).toMatchObject({
      targetCents: 5000,
      rollbackOfWorkUnitId: "wu_fwd_1",
      breachMetric: "account_booked_conversions_drop_share",
      breachReason: "exceeded",
    });
  });

  it("THROWS when the reset parks instead of executing (allow-only misconfig)", async () => {
    const error = vi.fn();
    const dispatch = buildReallocationRollbackDispatch({
      submitReset: async () => parkedResponse(),
      logger: { warn: vi.fn(), error },
    });
    await expect(dispatch(pending(), PLAN, BREACH_ARG)).rejects.toThrow(
      /parked instead of executing/,
    );
    expect(error).toHaveBeenCalled();
  });

  it("THROWS on an ingress error (ok:false) so the row is re-monitored, not marked rolled_back", async () => {
    const dispatch = buildReallocationRollbackDispatch({
      submitReset: async () => errResponse("entitlement_required"),
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    await expect(dispatch(pending(), PLAN, BREACH_ARG)).rejects.toThrow(/reset submit failed/);
  });

  it("THROWS when the reset EXECUTED but FAILED (ok:true + outcome failed): the budget was NOT restored", async () => {
    // This is the fail-open the dispatch must close: a failed reset must never read as a rollback.
    const dispatch = buildReallocationRollbackDispatch({
      submitReset: async () => okResponse("failed"),
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    await expect(dispatch(pending(), PLAN, BREACH_ARG)).rejects.toThrow(/did not complete/);
  });
});

describe("buildReallocationGuardrailMonitorDeps + runReallocationGuardrailMonitor (integration)", () => {
  function harness(
    rows: PendingGuardrailReallocation[],
    measurement: GuardrailMeasurement,
    markTransitioned = true,
  ) {
    const markGuardrailOutcome = vi.fn(async () => ({ transitioned: markTransitioned }));
    const dispatchRollback = vi.fn(async () => {});
    const recordOutcome = vi.fn();
    const alertCritical = vi.fn();
    const deps = buildReallocationGuardrailMonitorDeps({
      organizationId: "org-1",
      store: {
        listPendingGuardrailForOrg: async () => rows,
        markGuardrailOutcome,
      },
      measure: async () => measurement,
      dispatchRollback,
      recordOutcome,
      alertCritical,
      now: () => NOW,
    });
    return { deps, markGuardrailOutcome, dispatchRollback, recordOutcome, alertCritical };
  }

  it("HOLDS a reallocation whose guardrails pass (no rollback dispatched)", async () => {
    const h = harness([row()], HELD);
    await runReallocationGuardrailMonitor(h.deps);
    expect(h.dispatchRollback).not.toHaveBeenCalled();
    expect(h.markGuardrailOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ executionWorkUnitId: "wu_fwd_1", outcome: "held" }),
    );
    expect(h.recordOutcome).toHaveBeenCalledWith("org-1", "held");
  });

  it("ROLLS BACK a breached reallocation (dispatch + rolled_back outcome)", async () => {
    const h = harness([row()], BREACH);
    await runReallocationGuardrailMonitor(h.deps);
    expect(h.dispatchRollback).toHaveBeenCalledTimes(1);
    // The plan restores the captured prior (5000) from the live 6000.
    expect((h.dispatchRollback.mock.calls[0] as unknown[])[1]).toMatchObject({ targetCents: 5000 });
    expect(h.markGuardrailOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "rolled_back" }),
    );
    expect(h.recordOutcome).toHaveBeenCalledWith("org-1", "rolled_back");
  });

  it("ALARMS on an unrestorable breach (no dispatch, critical alert, distinct outcome)", async () => {
    const h = harness([row()], BREACH_UNRESTORABLE);
    await runReallocationGuardrailMonitor(h.deps);
    expect(h.dispatchRollback).not.toHaveBeenCalled();
    expect(h.markGuardrailOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "rollback_unrestorable" }),
    );
    expect(h.alertCritical).toHaveBeenCalledWith(
      expect.stringContaining("could NOT be rolled back"),
    );
  });

  it("does NOT double-count the metric when a concurrent pass already resolved the row (transitioned:false)", async () => {
    const h = harness([row()], HELD, false);
    await runReallocationGuardrailMonitor(h.deps);
    expect(h.markGuardrailOutcome).toHaveBeenCalled();
    expect(h.recordOutcome).not.toHaveBeenCalled();
  });

  it("SKIPS + alarms a row with no deploymentId (cannot attribute the rollback)", async () => {
    const h = harness([row({ deploymentId: null })], BREACH);
    await runReallocationGuardrailMonitor(h.deps);
    expect(h.dispatchRollback).not.toHaveBeenCalled();
    expect(h.markGuardrailOutcome).not.toHaveBeenCalled();
    expect(h.alertCritical).toHaveBeenCalledWith(expect.stringContaining("no deploymentId"));
  });
});

describe("executeReallocationGuardrailWorker", () => {
  it("throws on a missing orgId in the event payload", async () => {
    await expect(
      executeReallocationGuardrailWorker(
        {
          failure: {} as never,
          buildMonitorDeps: vi.fn(),
          logger: { info: vi.fn(), error: vi.fn() },
        },
        { data: {}, name: REALLOCATION_GUARDRAIL_EVENT },
      ),
    ).rejects.toThrow("missing orgId");
  });

  it("runs the monitor for the event's org", async () => {
    const buildMonitorDeps = vi.fn(() => ({
      listPendingReallocations: async () => [],
      measureGuardrails: async () => ({ shares: {}, currentLiveCents: 0 }),
      dispatchRollback: async () => {},
      resolveReallocation: async () => {},
    }));
    const res = await executeReallocationGuardrailWorker(
      { failure: {} as never, buildMonitorDeps, logger: { info: vi.fn(), error: vi.fn() } },
      { data: { orgId: "org-z" }, name: REALLOCATION_GUARDRAIL_EVENT },
    );
    expect(buildMonitorDeps).toHaveBeenCalledWith("org-z");
    expect(res).toEqual({ orgId: "org-z" });
  });
});
