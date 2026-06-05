import { describe, expect, it, vi } from "vitest";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import { resolveHandoffBrief } from "../handoff-brief-enrichment.js";

const candidate = {
  organizationId: "org1",
  recommendationId: "rec1",
  actionType: "increase_budget",
  campaignId: "camp1",
  rationale: "strong CTR",
  evidence: { clicks: 100, conversions: 5, days: 7 },
};

const synthesized = { productDescription: "synth p", targetAudience: "synth t" };
const composed = { productDescription: "brain p", targetAudience: "brain t" };

function composeOk(response: string, outcome = "completed") {
  return {
    ok: true,
    result: {
      workUnitId: "wu1",
      outcome,
      summary: "ok",
      outputs: { response, toolCalls: [] },
      mode: "skill",
      durationMs: 1,
      traceId: "t1",
    },
    workUnit: { id: "wu1", traceId: "t1" },
  } as unknown as SubmitWorkResponse;
}

function makeDeps(overrides: Partial<Parameters<typeof resolveHandoffBrief>[0]> = {}) {
  return {
    candidate,
    readFlag: () => true,
    synthesize: vi.fn(async () => synthesized),
    submitCompose: vi.fn(async () =>
      composeOk(
        JSON.stringify({ decision: "propose", reason: "evidence supports it", brief: composed }),
      ),
    ),
    warn: vi.fn(),
    ...overrides,
  };
}

describe("resolveHandoffBrief", () => {
  it("returns the synthesized brief without composing when the flag is off", async () => {
    const deps = makeDeps({ readFlag: () => false });
    expect(await resolveHandoffBrief(deps)).toEqual(synthesized);
    expect(deps.submitCompose).not.toHaveBeenCalled();
    expect(deps.warn).not.toHaveBeenCalled();
  });

  it("returns the composed brief on propose, with the per-recommendation key and internal trigger", async () => {
    const deps = makeDeps();
    expect(await resolveHandoffBrief(deps)).toEqual(composed);
    expect(deps.submitCompose).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org1",
        composeSource: "riley_handoff",
        trigger: "internal",
        idempotencyKey: "handoff-compose:rec1:increase_budget",
        recommendation: expect.objectContaining({
          actionType: "increase_budget",
          campaignId: "camp1",
          rationale: "strong CTR",
          evidence: { clicks: 100, conversions: 5, days: 7 },
        }),
      }),
    );
  });

  it.each([
    [
      "model abstain",
      composeOk(JSON.stringify({ decision: "abstain", reason: "taste conflicts" })),
    ],
    ["parse failure", composeOk("not json at all")],
    [
      "ingress error",
      { ok: false, error: { type: "entitlement_required", intent: "x", message: "m" } },
    ],
    [
      "parked compose",
      { ...composeOk("{}", "pending_approval"), approvalRequired: true, lifecycleId: "l1" },
    ],
    ["failed outcome", composeOk("irrelevant", "failed")],
  ])("falls back to the synthesized brief on %s, with a warn", async (_label, response) => {
    const deps = makeDeps({
      submitCompose: vi.fn(async () => response as unknown as SubmitWorkResponse),
    });
    expect(await resolveHandoffBrief(deps)).toEqual(synthesized);
    expect(deps.warn).toHaveBeenCalled();
  });

  it("falls back when the compose submit throws (the handoff path is never blocked)", async () => {
    const deps = makeDeps({ submitCompose: vi.fn(async () => Promise.reject(new Error("boom"))) });
    expect(await resolveHandoffBrief(deps)).toEqual(synthesized);
    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });
});
