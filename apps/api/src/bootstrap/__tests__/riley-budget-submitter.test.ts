import { describe, it, expect, vi } from "vitest";
import { buildRileyBudgetSubmitter } from "../riley-budget-submitter.js";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import type { RileyBudgetCandidate } from "@switchboard/ad-optimizer";

const candidate: RileyBudgetCandidate = {
  organizationId: "org_1",
  deploymentId: "dep_riley",
  adAccountId: "act_123",
  recommendationId: "rec_1",
  campaignId: "camp_1",
  currentDailyBudgetCents: 5000,
  proposedDailyBudgetCents: 8000,
  rationale: "r",
  evidence: { clicks: 1000, conversions: 100, days: 30 },
};

function log() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function okResult(outcome: string): SubmitWorkResponse {
  return {
    ok: true,
    result: {
      workUnitId: "wu_1",
      outcome,
      summary: "s",
      outputs: {},
      mode: "workflow",
      durationMs: 0,
      traceId: "t_1",
      ...(outcome === "failed" ? { error: { code: "POLICY_DENIED", message: "deny" } } : {}),
    },
    workUnit: { id: "wu_1" },
  } as unknown as SubmitWorkResponse;
}

describe("buildRileyBudgetSubmitter (the reallocate submit safety contract)", () => {
  it("parked: the approvalRequired branch (checked BEFORE the result) returns park truth", async () => {
    const l = log();
    const submitter = buildRileyBudgetSubmitter({
      submitRileyBudget: async () =>
        ({
          ...okResult("pending_approval"),
          approvalRequired: true,
          lifecycleId: "lc_1",
        }) as unknown as SubmitWorkResponse,
      log: l,
    });
    expect(await submitter(candidate)).toEqual({ parked: true });
    expect(l.info).toHaveBeenCalledTimes(1);
    expect(String(l.info.mock.calls[0]![0])).toContain("lc_1");
    expect(l.error).not.toHaveBeenCalled();
  });

  it("passes the frozen reallocate parameters (from/to cents + adAccountId) into the submit input", async () => {
    const l = log();
    const submitRileyBudget = vi.fn(
      async (_input: RileyBudgetSubmitInputLike, _dep: unknown) =>
        ({
          ...okResult("pending_approval"),
          approvalRequired: true,
        }) as unknown as SubmitWorkResponse,
    );
    await buildRileyBudgetSubmitter({ submitRileyBudget, log: l })(candidate);
    expect(submitRileyBudget).toHaveBeenCalledTimes(1);
    expect(submitRileyBudget.mock.calls[0]![0]).toEqual({
      organizationId: "org_1",
      recommendationId: "rec_1",
      adAccountId: "act_123",
      campaignId: "camp_1",
      fromCents: 5000,
      toCents: 8000,
      rationale: "r",
      evidence: { clicks: 1000, conversions: 100, days: 30 },
    });
    expect(submitRileyBudget.mock.calls[0]![1]).toEqual({
      deploymentId: "dep_riley",
      skillSlug: "ad-optimizer",
    });
  });

  it("governance DENY (ok + outcome failed) is a LOUD error, never parked", async () => {
    const l = log();
    const submitter = buildRileyBudgetSubmitter({
      submitRileyBudget: async () => okResult("failed"),
      log: l,
    });
    expect(await submitter(candidate)).toEqual({ parked: false });
    expect(l.error).toHaveBeenCalledTimes(1);
    expect(String(l.error.mock.calls[0]![0])).toContain("denied/failed");
    expect(String(l.error.mock.calls[0]![0])).toContain("POLICY_DENIED");
  });

  it("an UNEXPECTED auto-execute (ok, no approvalRequired, completed) is the loudest alarm", async () => {
    const l = log();
    const submitter = buildRileyBudgetSubmitter({
      submitRileyBudget: async () => okResult("completed"),
      log: l,
    });
    expect(await submitter(candidate)).toEqual({ parked: false });
    expect(l.error).toHaveBeenCalledTimes(1);
    expect(String(l.error.mock.calls[0]![0])).toContain("UNEXPECTEDLY executed");
    expect(String(l.error.mock.calls[0]![0])).toContain("governance seeding");
  });

  it("entitlement_required is the NAMED skip (warn), never silent", async () => {
    const l = log();
    const submitter = buildRileyBudgetSubmitter({
      submitRileyBudget: async () =>
        ({
          ok: false,
          error: {
            type: "entitlement_required",
            intent: "adoptimizer.campaign.reallocate",
            message: "m",
          },
        }) as unknown as SubmitWorkResponse,
      log: l,
    });
    expect(await submitter(candidate)).toEqual({ parked: false });
    expect(l.warn).toHaveBeenCalledTimes(1);
    expect(String(l.warn.mock.calls[0]![0])).toContain("skip:org_not_entitled");
  });

  it("any other ingress error is a loud error, never parked", async () => {
    const l = log();
    const submitter = buildRileyBudgetSubmitter({
      submitRileyBudget: async () =>
        ({
          ok: false,
          error: {
            type: "deployment_not_found",
            intent: "adoptimizer.campaign.reallocate",
            message: "m",
          },
        }) as unknown as SubmitWorkResponse,
      log: l,
    });
    expect(await submitter(candidate)).toEqual({ parked: false });
    expect(l.error).toHaveBeenCalledTimes(1);
    expect(String(l.error.mock.calls[0]![0])).toContain("deployment_not_found");
  });

  it("builder abstention (null) and a missing closure are quiet parked:false", async () => {
    const l = log();
    expect(
      await buildRileyBudgetSubmitter({ submitRileyBudget: async () => null, log: l })(candidate),
    ).toEqual({ parked: false });
    expect(await buildRileyBudgetSubmitter({ log: l })(candidate)).toEqual({ parked: false });
    expect(l.info).not.toHaveBeenCalled();
    expect(l.warn).not.toHaveBeenCalled();
    expect(l.error).not.toHaveBeenCalled();
  });

  it("a throwing submit is caught (warn) and the audit never breaks", async () => {
    const l = log();
    const submitter = buildRileyBudgetSubmitter({
      submitRileyBudget: async () => {
        throw new Error("ingress down");
      },
      log: l,
    });
    expect(await submitter(candidate)).toEqual({ parked: false });
    expect(l.warn).toHaveBeenCalledTimes(1);
    expect(String(l.warn.mock.calls[0]![0])).toContain("ingress down");
  });
});

interface RileyBudgetSubmitInputLike {
  organizationId: string;
  recommendationId: string;
  adAccountId: string;
  campaignId: string;
  fromCents: number;
  toCents: number;
  rationale: string;
  evidence: { clicks: number; conversions: number; days: number };
}
