/**
 * Slice-4 weekly self-brief loop (spec 3.7): the pure worker executor with
 * injected deps, covering the floor matrix, every compose branch (named skips,
 * never a phantom success), the draft branch matrix, and key determinism.
 */
import { describe, expect, it, vi } from "vitest";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import {
  executeMiraSelfBriefScan,
  executeMiraSelfBriefDispatch,
  SELF_BRIEF_BACKLOG_CAP,
  type MiraSelfBriefWorkerDeps,
} from "../services/cron/mira-self-brief.js";

const FIXED_NOW = new Date("2026-06-08T10:00:00Z"); // Monday, ISO week 2026-W24

const proposeJson = JSON.stringify({
  decision: "propose",
  reason: "question hooks keep winning",
  brief: { productDescription: "Botox intro consult", targetAudience: "women 30-45 SG" },
});

const abstainJson = JSON.stringify({ decision: "abstain", reason: "thin signal" });

function composeOk(response: string, outcome = "completed") {
  return {
    ok: true as const,
    result: {
      workUnitId: "wu-compose",
      outcome,
      summary: "ok",
      outputs: { response, toolCalls: [] },
      mode: "skill",
      durationMs: 5,
      traceId: "t-compose",
    },
    workUnit: { id: "wu-compose", traceId: "t-compose" },
  } as unknown as SubmitWorkResponse & { ok: true; result: { outcome: string } };
}

function draftOk(outputs: Record<string, unknown>, outcome = "completed") {
  return {
    ok: true as const,
    result: {
      workUnitId: "wu-draft",
      outcome,
      summary: "ok",
      outputs,
      mode: "workflow",
      durationMs: 5,
      traceId: "t-draft",
    },
    workUnit: { id: "wu-draft", traceId: "t-draft" },
  } as unknown as SubmitWorkResponse & { ok: true; result: { outcome: string } };
}

const measuredJob = { performance: { delivery: "measured" } };

function makeDeps(overrides: Partial<MiraSelfBriefWorkerDeps> = {}): MiraSelfBriefWorkerDeps {
  return {
    readEnabledFlag: () => true,
    isMiraEnabled: vi.fn(async () => true),
    resolveCreativeDeployment: vi.fn(async () => ({
      deploymentId: "dep1",
      skillSlug: "creative",
    })),
    readModel: {
      read: vi.fn(async () => ({
        jobs: [measuredJob],
        counts: { inFlight: 0 },
      })),
    },
    memoryReader: {
      listHighConfidence: vi.fn(async () => []),
    },
    submitCompose: vi.fn(async () => composeOk(proposeJson)),
    submitConceptDraft: vi.fn(async () => draftOk({ jobId: "job-9" })),
    warn: vi.fn(),
    now: () => FIXED_NOW,
    ...overrides,
  };
}

describe("executeMiraSelfBriefScan floor", () => {
  it("skips when the flag is off, before any read", async () => {
    const deps = makeDeps({ readEnabledFlag: () => false });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toEqual({ skipped: "disabled" });
    expect(deps.isMiraEnabled).not.toHaveBeenCalled();
  });

  it("skips when mira is not enabled for the org", async () => {
    const deps = makeDeps({ isMiraEnabled: vi.fn(async () => false) });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toEqual({ skipped: "mira_not_enabled" });
    expect(deps.submitCompose).not.toHaveBeenCalled();
  });

  it("skips when no creative deployment resolves", async () => {
    const deps = makeDeps({ resolveCreativeDeployment: vi.fn(async () => null) });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toEqual({
      skipped: "no_creative_deployment",
    });
  });

  it("skips at the inFlight backlog cap (Mira's own unacted drafts throttle her)", async () => {
    const deps = makeDeps({
      readModel: {
        read: vi.fn(async () => ({
          jobs: [measuredJob],
          counts: { inFlight: SELF_BRIEF_BACKLOG_CAP },
        })),
      },
    });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toEqual({ skipped: "backlog_cap" });
    expect(deps.submitCompose).not.toHaveBeenCalled();
  });

  it("skips a zero-signal org (no measured performance, no surfaced memory)", async () => {
    const deps = makeDeps({
      readModel: { read: vi.fn(async () => ({ jobs: [{}], counts: { inFlight: 0 } })) },
    });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toEqual({ skipped: "no_signal" });
    expect(deps.submitCompose).not.toHaveBeenCalled();
  });

  it("proceeds on surfaced creative memory even with zero jobs", async () => {
    const deps = makeDeps({
      readModel: { read: vi.fn(async () => ({ jobs: [], counts: { inFlight: 0 } })) },
      memoryReader: {
        listHighConfidence: vi.fn(async () => [
          {
            id: "m1",
            category: "taste",
            canonicalKey: "taste:kept_polished_question",
            sourceCount: 3,
            confidence: 0.7,
          },
        ]),
      },
    });
    const out = await executeMiraSelfBriefScan(deps, "org1");
    expect(out).toEqual({ jobId: "job-9" });
  });

  it("skips the memory query when measured performance already satisfies the floor", async () => {
    const deps = makeDeps();
    await executeMiraSelfBriefScan(deps, "org1");
    expect(deps.memoryReader.listHighConfidence).not.toHaveBeenCalled();
  });
});

describe("executeMiraSelfBriefScan compose branches", () => {
  it("maps entitlement_required to the named org_not_entitled skip", async () => {
    const deps = makeDeps({
      submitCompose: vi.fn(
        async () =>
          ({
            ok: false as const,
            error: { type: "entitlement_required", intent: "x", message: "m" },
          }) as unknown as SubmitWorkResponse,
      ),
    });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toEqual({ skipped: "org_not_entitled" });
  });

  it("maps idempotency_in_flight to compose_claim_unresolved (orphaned running claim)", async () => {
    const deps = makeDeps({
      submitCompose: vi.fn(
        async () =>
          ({
            ok: false as const,
            error: { type: "idempotency_in_flight", intent: "x", message: "m" },
          }) as unknown as SubmitWorkResponse,
      ),
    });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toEqual({
      skipped: "compose_claim_unresolved",
    });
  });

  it("maps any other ingress error to compose_submit_failed with a warn", async () => {
    const deps = makeDeps({
      submitCompose: vi.fn(
        async () =>
          ({
            ok: false as const,
            error: { type: "governance_error", intent: "x", message: "denied" },
          }) as unknown as SubmitWorkResponse,
      ),
    });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toMatchObject({
      skipped: "compose_submit_failed",
    });
    expect(deps.warn).toHaveBeenCalled();
  });

  it("stops on a parked compose without creating a draft (no phantom)", async () => {
    const deps = makeDeps({
      submitCompose: vi.fn(
        async () =>
          ({
            ...composeOk(proposeJson, "pending_approval"),
            approvalRequired: true as const,
            lifecycleId: "l1",
          }) as unknown as SubmitWorkResponse,
      ),
    });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toEqual({ skipped: "compose_parked" });
    expect(deps.submitConceptDraft).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalled();
  });

  it("maps a failed compose outcome to compose_failed", async () => {
    const deps = makeDeps({ submitCompose: vi.fn(async () => composeOk("x", "failed")) });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toMatchObject({
      skipped: "compose_failed",
    });
  });

  it("maps a non-JSON response to compose_parse_failure with a structured warn", async () => {
    const deps = makeDeps({
      submitCompose: vi.fn(async () => composeOk("I think we should make an ad.")),
    });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toEqual({
      skipped: "compose_parse_failure",
    });
    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining("parse failure"));
    expect(deps.submitConceptDraft).not.toHaveBeenCalled();
  });

  it("records a model abstain distinctly from a parse failure", async () => {
    const deps = makeDeps({ submitCompose: vi.fn(async () => composeOk(abstainJson)) });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toEqual({ abstained: "thin signal" });
    expect(deps.submitConceptDraft).not.toHaveBeenCalled();
  });

  it("derives both idempotency keys from the same ISO week and links the parent", async () => {
    const deps = makeDeps();
    await executeMiraSelfBriefScan(deps, "org1");
    expect(deps.submitCompose).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "self-brief-compose:dep1:2026-W24" }),
      { deploymentId: "dep1", skillSlug: "creative" },
    );
    expect(deps.submitConceptDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "self-brief:dep1:2026-W24",
        parentWorkUnitId: "wu-compose",
        brief: { productDescription: "Botox intro consult", targetAudience: "women 30-45 SG" },
      }),
      { deploymentId: "dep1", skillSlug: "creative" },
    );
  });
});

describe("executeMiraSelfBriefScan draft branches", () => {
  it("returns the created jobId on success", async () => {
    expect(await executeMiraSelfBriefScan(makeDeps(), "org1")).toEqual({ jobId: "job-9" });
  });

  it("treats a queued draft as success when it carries a jobId", async () => {
    const deps = makeDeps({
      submitConceptDraft: vi.fn(async () => draftOk({ jobId: "job-q" }, "queued")),
    });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toEqual({ jobId: "job-q" });
  });

  it("never reports a phantom draft when the child skipped (no jobId)", async () => {
    const deps = makeDeps({
      submitConceptDraft: vi.fn(async () => draftOk({ skipped: true, reason: "mira_not_enabled" })),
    });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toEqual({
      skipped: "draft_child_skipped:mira_not_enabled",
    });
  });

  it("maps an unexpectedly parked draft to draft_parked with a warn", async () => {
    const deps = makeDeps({
      submitConceptDraft: vi.fn(
        async () =>
          ({
            ...draftOk({}, "pending_approval"),
            approvalRequired: true as const,
          }) as unknown as SubmitWorkResponse,
      ),
    });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toEqual({ skipped: "draft_parked" });
    expect(deps.warn).toHaveBeenCalled();
  });

  it("maps a draft ingress failure to draft_submit_failed", async () => {
    const deps = makeDeps({
      submitConceptDraft: vi.fn(
        async () =>
          ({
            ok: false as const,
            error: { type: "deployment_not_found", intent: "x", message: "m" },
          }) as unknown as SubmitWorkResponse,
      ),
    });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toMatchObject({
      skipped: "draft_submit_failed",
    });
  });

  it("maps a failed draft outcome to draft_failed", async () => {
    const deps = makeDeps({
      submitConceptDraft: vi.fn(async () => draftOk({}, "failed")),
    });
    expect(await executeMiraSelfBriefScan(deps, "org1")).toMatchObject({ skipped: "draft_failed" });
  });
});

describe("executeMiraSelfBriefDispatch", () => {
  it("emits one scan event per creative org", async () => {
    const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
    const step = { run: async <T>(_n: string, fn: () => T | Promise<T>) => fn() };
    const out = await executeMiraSelfBriefDispatch(step, {
      listCreativeOrgs: async () => ["org1", "org2"],
      sendEvent: async (e) => {
        sent.push(e);
      },
    });
    expect(out).toEqual({ dispatched: 2 });
    expect(sent).toEqual([
      { name: "mira/self-brief.scan", data: { organizationId: "org1" } },
      { name: "mira/self-brief.scan", data: { organizationId: "org2" } },
    ]);
  });
});
