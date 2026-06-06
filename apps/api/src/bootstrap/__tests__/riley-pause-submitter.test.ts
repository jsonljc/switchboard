import { describe, it, expect, vi } from "vitest";
import { buildRileyPauseSubmitter } from "../riley-pause-submitter.js";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import type { RileyPauseCandidate } from "@switchboard/ad-optimizer";

const candidate: RileyPauseCandidate = {
  organizationId: "org_1",
  deploymentId: "dep_riley",
  recommendationId: "rec_1",
  campaignId: "camp_1",
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

describe("buildRileyPauseSubmitter (the apps/api submit safety contract)", () => {
  it("parked: the approvalRequired branch (checked BEFORE the result) returns park truth", async () => {
    const l = log();
    const submitter = buildRileyPauseSubmitter({
      submitRileyPause: async () =>
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

  it("governance DENY (ok + outcome failed) is a LOUD error, never parked", async () => {
    const l = log();
    const submitter = buildRileyPauseSubmitter({
      submitRileyPause: async () => okResult("failed"),
      log: l,
    });
    expect(await submitter(candidate)).toEqual({ parked: false });
    expect(l.error).toHaveBeenCalledTimes(1);
    expect(String(l.error.mock.calls[0]![0])).toContain("denied/failed");
    expect(String(l.error.mock.calls[0]![0])).toContain("POLICY_DENIED");
  });

  it("an UNEXPECTED auto-execute (ok, no approvalRequired, completed) is the loudest alarm", async () => {
    const l = log();
    const submitter = buildRileyPauseSubmitter({
      submitRileyPause: async () => okResult("completed"),
      log: l,
    });
    expect(await submitter(candidate)).toEqual({ parked: false });
    expect(l.error).toHaveBeenCalledTimes(1);
    expect(String(l.error.mock.calls[0]![0])).toContain("UNEXPECTEDLY executed");
    expect(String(l.error.mock.calls[0]![0])).toContain("governance seeding");
  });

  it("entitlement_required is the NAMED skip (warn), never silent", async () => {
    const l = log();
    const submitter = buildRileyPauseSubmitter({
      submitRileyPause: async () =>
        ({
          ok: false,
          error: {
            type: "entitlement_required",
            intent: "adoptimizer.campaign.pause",
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
    const submitter = buildRileyPauseSubmitter({
      submitRileyPause: async () =>
        ({
          ok: false,
          error: {
            type: "deployment_not_found",
            intent: "adoptimizer.campaign.pause",
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
      await buildRileyPauseSubmitter({ submitRileyPause: async () => null, log: l })(candidate),
    ).toEqual({ parked: false });
    expect(await buildRileyPauseSubmitter({ log: l })(candidate)).toEqual({ parked: false });
    expect(l.info).not.toHaveBeenCalled();
    expect(l.warn).not.toHaveBeenCalled();
    expect(l.error).not.toHaveBeenCalled();
  });

  it("a throwing submit is caught (warn) and the audit never breaks", async () => {
    const l = log();
    const submitter = buildRileyPauseSubmitter({
      submitRileyPause: async () => {
        throw new Error("ingress down");
      },
      log: l,
    });
    expect(await submitter(candidate)).toEqual({ parked: false });
    expect(l.warn).toHaveBeenCalledTimes(1);
    expect(String(l.warn.mock.calls[0]![0])).toContain("ingress down");
  });
});
