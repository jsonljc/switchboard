import { describe, it, expect, vi } from "vitest";
import { toDelegationResult, createChildWorkSubmitter } from "../delegation-submitter.js";
import type { SubmitWorkResponse } from "@switchboard/core/platform";

const okResp = (outcome: string): SubmitWorkResponse =>
  ({
    ok: true,
    result: {
      workUnitId: "wu-child",
      outcome,
      summary: "",
      outputs: {},
      mode: "workflow",
      durationMs: 1,
    },
    workUnit: { id: "wu-child" },
  }) as unknown as SubmitWorkResponse;

describe("toDelegationResult", () => {
  it("maps a transport failure to ok:false with the error code", () => {
    const resp = {
      ok: false,
      error: { code: "TRIGGER_NOT_ALLOWED", message: "no" },
    } as unknown as SubmitWorkResponse;
    expect(toDelegationResult(resp)).toEqual({ ok: false, error: "TRIGGER_NOT_ALLOWED" });
  });

  it("maps an executed-but-FAILED outcome to ok:false (the bug-#1 case)", () => {
    const resp = {
      ok: true,
      result: {
        workUnitId: "wu-child",
        outcome: "failed",
        summary: "",
        outputs: {},
        mode: "workflow",
        durationMs: 1,
        error: { code: "DEPLOYMENT_NOT_FOUND", message: "no creative deployment" },
      },
      workUnit: { id: "wu-child" },
    } as unknown as SubmitWorkResponse;
    expect(toDelegationResult(resp)).toEqual({
      ok: false,
      outcome: "failed",
      childWorkUnitId: "wu-child",
      error: "DEPLOYMENT_NOT_FOUND",
    });
  });

  it("maps approvalRequired to ok:true / pending_approval", () => {
    const resp = {
      ok: true,
      approvalRequired: true,
      result: {
        workUnitId: "wu-child",
        outcome: "pending_approval",
        summary: "",
        outputs: {},
        mode: "workflow",
        durationMs: 1,
      },
      workUnit: { id: "wu-child" },
    } as unknown as SubmitWorkResponse;
    expect(toDelegationResult(resp)).toEqual({
      ok: true,
      outcome: "pending_approval",
      childWorkUnitId: "wu-child",
    });
  });

  it("maps a completed outcome to ok:true with the child work unit id", () => {
    expect(toDelegationResult(okResp("completed"))).toEqual({
      ok: true,
      outcome: "completed",
      childWorkUnitId: "wu-child",
    });
  });
});

describe("createChildWorkSubmitter", () => {
  it("returns platform_not_ready when the submit ref is unbound", async () => {
    const submitter = createChildWorkSubmitter(() => undefined);
    const res = await submitter.submitChildWork({
      organizationId: "org-1",
      actor: { id: "dep-alex", type: "agent" },
      intent: "creative.concept.draft",
      parameters: {},
      parentWorkUnitId: "wu-parent",
      idempotencyKey: "k",
    });
    expect(res).toEqual({ ok: false, error: "platform_not_ready" });
  });

  it("forwards the mapped child request fields and returns the mapped result", async () => {
    const submit = vi.fn().mockResolvedValue(okResp("completed"));
    const submitter = createChildWorkSubmitter(() => submit);
    const res = await submitter.submitChildWork({
      organizationId: "org-1",
      actor: { id: "dep-alex", type: "agent" },
      intent: "creative.concept.draft",
      parameters: { brief: { x: 1 } },
      parentWorkUnitId: "wu-parent",
      idempotencyKey: "k1",
    });
    expect(submit).toHaveBeenCalledWith({
      intent: "creative.concept.draft",
      organizationId: "org-1",
      actor: { id: "dep-alex", type: "agent" },
      parameters: { brief: { x: 1 } },
      parentWorkUnitId: "wu-parent",
      idempotencyKey: "k1",
    });
    expect(res).toMatchObject({ ok: true, outcome: "completed", childWorkUnitId: "wu-child" });
  });
});
