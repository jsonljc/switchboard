import { describe, it, expect, vi } from "vitest";
import {
  evaluateBlastRadiusGuardrails,
  planReallocationRollback,
  runReallocationGuardrailMonitor,
  type PendingReallocation,
  type ReallocationGuardrailMonitorDeps,
} from "./reallocation-guardrail-monitor.js";
import { DEFAULT_BLAST_RADIUS_CONTRACT } from "./blast-radius-contract.js";

describe("evaluateBlastRadiusGuardrails", () => {
  const guardrails = DEFAULT_BLAST_RADIUS_CONTRACT.guardrails;

  it("does not breach when every measured share is under its threshold", () => {
    const v = evaluateBlastRadiusGuardrails(guardrails, {
      account_booked_conversions_drop_share: 0.1, // < 0.2
      freed_budget_absorbed_share: 0.3, // < 0.5
    });
    expect(v.breached).toBe(false);
  });

  it("breaches (exceeded) when a measured share is over its threshold", () => {
    const v = evaluateBlastRadiusGuardrails(guardrails, {
      account_booked_conversions_drop_share: 0.35, // > 0.2
      freed_budget_absorbed_share: 0.3,
    });
    expect(v).toMatchObject({
      breached: true,
      metric: "account_booked_conversions_drop_share",
      reason: "exceeded",
    });
  });

  it("treats a value exactly at the threshold as NOT a breach (strictly exceeds)", () => {
    const v = evaluateBlastRadiusGuardrails(guardrails, {
      account_booked_conversions_drop_share: 0.2,
      freed_budget_absorbed_share: 0.5,
    });
    expect(v.breached).toBe(false);
  });

  it("fails CLOSED: a missing measurement for a configured guardrail trips (unmeasured)", () => {
    const v = evaluateBlastRadiusGuardrails(guardrails, {
      // account_booked_conversions_drop_share intentionally absent
      freed_budget_absorbed_share: 0.1,
    });
    expect(v).toMatchObject({
      breached: true,
      metric: "account_booked_conversions_drop_share",
      reason: "unmeasured",
    });
  });

  it("fails CLOSED on a non-finite (NaN) measurement", () => {
    const v = evaluateBlastRadiusGuardrails(guardrails, {
      account_booked_conversions_drop_share: NaN,
      freed_budget_absorbed_share: 0.1,
    });
    expect(v).toMatchObject({ breached: true, reason: "unmeasured" });
  });

  it("no guardrails ⇒ never breaches", () => {
    expect(evaluateBlastRadiusGuardrails([], {}).breached).toBe(false);
  });
});

describe("planReallocationRollback", () => {
  it("computes the delta to restore the prior budget", () => {
    // Riley scaled 5000 → 6000; rollback restores 5000 (delta -1000 from live 6000).
    const plan = planReallocationRollback(5000, 6000);
    expect(plan).toEqual({ noop: false, targetCents: 5000, deltaCentsSigned: -1000 });
  });

  it("is a noop when the live budget already equals the prior", () => {
    expect(planReallocationRollback(5000, 5000)).toEqual({ noop: true });
  });

  it("returns null on a non-finite or non-positive prior (unrestorable capture)", () => {
    expect(planReallocationRollback(NaN, 6000)).toBeNull();
    expect(planReallocationRollback(0, 6000)).toBeNull();
    expect(planReallocationRollback(5000, NaN)).toBeNull();
  });
});

describe("runReallocationGuardrailMonitor", () => {
  function pending(over: Partial<PendingReallocation> = {}): PendingReallocation {
    return {
      deploymentId: "dep-1",
      organizationId: "org-1",
      campaignId: "c1",
      observedPriorCents: 5000,
      contract: DEFAULT_BLAST_RADIUS_CONTRACT,
      ...over,
    };
  }

  function deps(
    over: Partial<ReallocationGuardrailMonitorDeps> = {},
  ): ReallocationGuardrailMonitorDeps {
    return {
      listPendingReallocations: vi.fn().mockResolvedValue([pending()]),
      measureGuardrails: vi.fn().mockResolvedValue({
        shares: { account_booked_conversions_drop_share: 0.05, freed_budget_absorbed_share: 0.1 },
        currentLiveCents: 6000,
      }),
      dispatchRollback: vi.fn().mockResolvedValue(undefined),
      resolveReallocation: vi.fn().mockResolvedValue(undefined),
      ...over,
    };
  }

  it("holds a reallocation whose guardrails all pass (no rollback)", async () => {
    const d = deps();
    await runReallocationGuardrailMonitor(d);
    expect(d.dispatchRollback).not.toHaveBeenCalled();
    expect(d.resolveReallocation).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "c1" }),
      "held",
    );
  });

  it("rolls back to the prior budget when a guardrail trips", async () => {
    const d = deps({
      measureGuardrails: vi.fn().mockResolvedValue({
        shares: { account_booked_conversions_drop_share: 0.4, freed_budget_absorbed_share: 0.1 },
        currentLiveCents: 6000,
      }),
    });
    await runReallocationGuardrailMonitor(d);
    expect(d.dispatchRollback).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "c1" }),
      { targetCents: 5000, deltaCentsSigned: -1000 },
      expect.objectContaining({
        metric: "account_booked_conversions_drop_share",
        reason: "exceeded",
      }),
    );
    expect(d.resolveReallocation).toHaveBeenCalledWith(expect.anything(), "rolled_back");
  });

  it("rolls back when a guardrail is UNMEASURED (fail-closed)", async () => {
    const d = deps({
      measureGuardrails: vi.fn().mockResolvedValue({
        shares: { freed_budget_absorbed_share: 0.1 }, // booked-drop absent
        currentLiveCents: 6000,
      }),
    });
    await runReallocationGuardrailMonitor(d);
    expect(d.dispatchRollback).toHaveBeenCalled();
    expect(d.resolveReallocation).toHaveBeenCalledWith(expect.anything(), "rolled_back");
  });

  it("resolves rollback_noop (no dispatch) when tripped but already at the prior budget", async () => {
    const d = deps({
      measureGuardrails: vi.fn().mockResolvedValue({
        shares: { account_booked_conversions_drop_share: 0.4, freed_budget_absorbed_share: 0.1 },
        currentLiveCents: 5000, // already equals observedPriorCents
      }),
    });
    await runReallocationGuardrailMonitor(d);
    expect(d.dispatchRollback).not.toHaveBeenCalled();
    expect(d.resolveReallocation).toHaveBeenCalledWith(expect.anything(), "rollback_noop");
  });

  it("resolves rollback_unrestorable (distinct from noop) when tripped but the prior is a bad capture", async () => {
    const d = deps({
      listPendingReallocations: vi.fn().mockResolvedValue([pending({ observedPriorCents: 0 })]),
      measureGuardrails: vi.fn().mockResolvedValue({
        shares: { account_booked_conversions_drop_share: 0.4, freed_budget_absorbed_share: 0.1 },
        currentLiveCents: 6000,
      }),
    });
    await runReallocationGuardrailMonitor(d);
    // A real breach went un-rolled-back because the captured prior is unusable: it must NOT
    // read as a clean noop — it gets a distinct outcome the wiring alarms on.
    expect(d.dispatchRollback).not.toHaveBeenCalled();
    expect(d.resolveReallocation).toHaveBeenCalledWith(expect.anything(), "rollback_unrestorable");
  });

  it("isolates a per-reallocation failure and continues the rest of the batch", async () => {
    const onMonitorFailure = vi.fn();
    const d = deps({
      listPendingReallocations: vi
        .fn()
        .mockResolvedValue([pending({ campaignId: "c_bad" }), pending({ campaignId: "c_ok" })]),
      measureGuardrails: vi
        .fn()
        .mockRejectedValueOnce(new Error("measure failed for c_bad"))
        .mockResolvedValueOnce({
          shares: { account_booked_conversions_drop_share: 0.05, freed_budget_absorbed_share: 0.1 },
          currentLiveCents: 6000,
        }),
      onMonitorFailure,
    });
    await runReallocationGuardrailMonitor(d);
    expect(onMonitorFailure).toHaveBeenCalledTimes(1);
    expect(onMonitorFailure).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "c_bad" }),
      expect.any(Error),
    );
    // c_ok still processed (held).
    expect(d.resolveReallocation).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "c_ok" }),
      "held",
    );
  });
});
