/**
 * The PR-1 keystone: the parked Riley pause is approved through the REAL
 * ApprovalLifecycleService + respondToParkedLifecycle + the REAL
 * PlatformLifecycle.executeApproved (executeAfterApproval -> the REAL
 * ExecutionModeRegistry -> the REAL pause executor over a fake Meta client).
 * Proves, end to end:
 *
 *   submit parks (NEVER auto-executes; Meta untouched pre-approval)
 *   -> a REAL approve dispatches the executor -> Meta receives PAUSED
 *   -> trace completed with execution truth, lifecycle approved, dispatch succeeded
 *   -> reject pauses nothing and fails the trace
 *   -> a failed Meta write parks a Retry card (recovery_required); retry recovers
 *   -> a duplicate keyed submit returns the prior park (no double lifecycle)
 *   -> a stale park cannot execute (the platform's 24h lifecycle expiry fires
 *      at respond time, ahead of the executor's own 48h backstop)
 *
 * PR-1 has no cron initiator: the hand-built buildRileyPauseSubmitRequest submit
 * stands in for PR-2's flag-gated initiator (same builder both use).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { respondToParkedLifecycle, ParkedLifecycleExpiredError } from "@switchboard/core";
import { buildRileyPauseSubmitRequest } from "../services/workflows/riley-pause-submit-request.js";
import { buildRileyPauseSubmitter } from "../bootstrap/riley-pause-submitter.js";
import { buildPauseLifecycleWorld } from "./riley-pause-lifecycle-world.js";
import { ORG } from "./recommendation-handoff-harness.js";
import type { RileyPauseCandidate } from "@switchboard/ad-optimizer";

const submitInput = {
  organizationId: ORG,
  recommendationId: "rec_1",
  campaignId: "camp_1",
  rationale: "sustained spend with zero booked revenue",
  evidence: { clicks: 1000, conversions: 100, days: 30 },
};
const dep = { deploymentId: "dep-riley", skillSlug: "ad-optimizer" };

async function park(w: ReturnType<typeof buildPauseLifecycleWorld>) {
  const req = buildRileyPauseSubmitRequest(submitInput, dep)!;
  expect(req).not.toBeNull();
  const res = await w.harness.ingress.submit(req);
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error("submit failed");
  // The phantom-success gotcha, pinned: the response MUST carry approvalRequired.
  expect("approvalRequired" in res && res.approvalRequired).toBe(true);
  expect(res.result.outcome).toBe("pending_approval");
  const lifecycleId = (res as { lifecycleId?: string }).lifecycleId;
  const bindingHash = (res as { bindingHash?: string }).bindingHash;
  if (!lifecycleId || !bindingHash) throw new Error("park did not return lifecycle identifiers");
  return { lifecycleId, bindingHash };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("riley pause approve-to-dispatch loop (real respond + dispatch stack)", () => {
  it("NEVER auto-executes: the submit parks and Meta is untouched before a human approves", async () => {
    const w = buildPauseLifecycleWorld();
    await park(w);
    expect(w.harness.metaCalls).toHaveLength(0);
  });

  it("park -> approve -> the executor pauses on Meta; trace + lifecycle + dispatch truthful", async () => {
    const w = buildPauseLifecycleWorld();
    const { lifecycleId, bindingHash } = await park(w);

    const result = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(result.approvalState.status).toBe("approved");
    expect(result.executionResult?.success).toBe(true);
    expect(w.harness.metaCalls).toEqual([{ campaignId: "camp_1", status: "PAUSED" }]);

    const lifecycle = await w.lifecycleService.getLifecycleById(lifecycleId);
    expect(lifecycle?.status).toBe("approved");
    const trace = (await w.harness.traceStore.getByWorkUnitId(lifecycle!.actionEnvelopeId))!.trace;
    expect(trace.outcome).toBe("completed");
    expect(trace.executionOutputs).toMatchObject({
      paused: true,
      campaignId: "camp_1",
      previousStatus: "ACTIVE",
      newStatus: "PAUSED",
      metaWriteAccepted: true,
    });
    expect((trace.executionOutputs as { rollbackPlan: string }).rollbackPlan).toMatch(
      /Resume the campaign/,
    );
  });

  it("D5-2a x #1007 seam: the last-mile gate reads the DURABLE approvalOutcome the replay leaves honest", async () => {
    // The executor's last-mile gate (D5-2a) is ACTIVE in this exact dispatch path:
    // it reads getApprovalState over the REAL trace store and only writes to Meta on
    // an approved lifecycle. PlatformLifecycle stamps approvalOutcome="approved" on
    // the durable trace BEFORE dispatch, and the idempotent-replay path (#1007)
    // reconstructs the SubmitWorkResponse WITHOUT touching that field, so a replayed
    // approved park reads "approved" here too and never falsely fails the gate.
    const w = buildPauseLifecycleWorld();
    const { lifecycleId, bindingHash } = await park(w);
    const result = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(result.executionResult?.success).toBe(true);
    expect(w.harness.metaCalls).toEqual([{ campaignId: "camp_1", status: "PAUSED" }]);

    // The gate's input is the durable WorkTrace.approvalOutcome - assert it is what a
    // replay would re-read (the seam the cross-tier dependency pins).
    const lifecycle = await w.lifecycleService.getLifecycleById(lifecycleId);
    const trace = (await w.harness.traceStore.getByWorkUnitId(lifecycle!.actionEnvelopeId))!.trace;
    expect(trace.approvalOutcome).toBe("approved");
  });

  it("a REAL reject pauses nothing and fails the trace", async () => {
    const w = buildPauseLifecycleWorld();
    const { lifecycleId } = await park(w);

    const result = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "reject",
      respondedBy: "operator_jane",
    });
    expect(result.approvalState.status).toBe("rejected");
    expect(result.executionResult).toBeNull();
    expect(w.harness.metaCalls).toHaveLength(0);
    const lifecycle = await w.lifecycleService.getLifecycleById(lifecycleId);
    expect(lifecycle?.status).toBe("rejected");
    const trace = (await w.harness.traceStore.getByWorkUnitId(lifecycle!.actionEnvelopeId))!.trace;
    expect(trace.outcome).toBe("failed");
  });

  it("a failed Meta write parks a Retry card (recovery_required); retrying recovers", async () => {
    const w = buildPauseLifecycleWorld();
    w.harness.breakMetaOnce();
    const { lifecycleId, bindingHash } = await park(w);

    const first = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(first.approvalState.status).toBe("approved");
    expect(first.executionResult?.success).toBe(false);
    expect((await w.lifecycleService.getLifecycleById(lifecycleId))?.status).toBe(
      "recovery_required",
    );
    expect(w.harness.metaCalls).toHaveLength(0);

    // Retry (same respond leg) now succeeds end to end.
    const second = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(second.executionResult?.success).toBe(true);
    expect(w.harness.metaCalls).toEqual([{ campaignId: "camp_1", status: "PAUSED" }]);
    expect((await w.lifecycleService.getLifecycleById(lifecycleId))?.status).toBe("approved");
  });

  it("a duplicate keyed submit returns the prior park (no double lifecycle, no execution)", async () => {
    const w = buildPauseLifecycleWorld();
    // The load-bearing "no second lifecycle" proof: spy on the ONLY lifecycle-creation
    // path and assert it runs exactly once across both submits (the replay must not
    // re-enter the require_approval branch). The returned lifecycleId's absence is a
    // weaker proxy; the call count is the direct proof.
    const createSpy = vi.spyOn(w.lifecycleService, "createGatedLifecycle");
    await park(w);
    const second = await w.harness.ingress.submit(buildRileyPauseSubmitRequest(submitInput, dep)!);
    expect(second.ok).toBe(true);
    if (second.ok) {
      // D5-3/D4-1: the idempotent replay reconstructs the same approvalRequired marker
      // the first park returned, so an approval-aware consumer reads it as parked, not
      // as a phantom execution...
      expect(second.result.outcome).toBe("pending_approval");
      expect("approvalRequired" in second && second.approvalRequired).toBe(true);
      // ...but it does NOT reconstruct lifecycle metadata: buildWorkTrace persists
      // neither lifecycleId nor bindingHash, and they were already minted on the first
      // park. Their absence is the contract, not the no-second-lifecycle proof.
      expect((second as { lifecycleId?: string }).lifecycleId).toBeUndefined();
    }
    // No SECOND gated lifecycle was created: the creation path ran exactly once.
    expect(createSpy).toHaveBeenCalledTimes(1);
    // And nothing executed on Meta on the replay.
    expect(w.harness.metaCalls).toHaveLength(0);
  });

  it("a stale park cannot execute: the platform's 24h lifecycle expiry fires at respond time", async () => {
    // Step 0.3 finding: respondToParkedLifecycle enforces lifecycle.expiresAt
    // (respond-to-parked-lifecycle.ts:118-120) and the park was created with the
    // 24h defaultExpiryMs (platform-ingress.ts createGatedLifecycle). The
    // executor's RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS=48 cap is therefore a pure
    // BACKSTOP behind this (unit-tested in riley-pause-execution-workflow.test.ts);
    // through this respond path the platform expiry fires first.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T00:00:00.000Z"));
    const w = buildPauseLifecycleWorld();
    const { lifecycleId, bindingHash } = await park(w);

    vi.setSystemTime(new Date("2026-06-07T01:00:00.000Z")); // 25h later: past the 24h park expiry
    await expect(
      respondToParkedLifecycle(w.deps, {
        lifecycleId,
        action: "approve",
        respondedBy: "operator_jane",
        bindingHash,
      }),
    ).rejects.toThrow(ParkedLifecycleExpiredError);
    expect(w.harness.metaCalls).toHaveLength(0);
    expect((await w.lifecycleService.getLifecycleById(lifecycleId))?.status).toBe("expired");
  });

  it("a cron RETRY of a parked pause replays as parked through the REAL submitter, no false alarm (D5-3/D4-1, seam #7)", async () => {
    // Producer -> consumer seam: drive the REAL buildRileyPauseSubmitter over the
    // REAL ingress (buildPauseLifecycleWorld) and submit the SAME candidate twice.
    // The second submit is the idempotent cron retry (same mutate:riley:<rec>:pause
    // key) that hits the cached-replay branch.
    const w = buildPauseLifecycleWorld();
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const submitter = buildRileyPauseSubmitter({
      submitRileyPause: async (input, deployment) => {
        const req = buildRileyPauseSubmitRequest(input, deployment);
        return req === null ? null : w.harness.ingress.submit(req);
      },
      log,
    });
    const candidate: RileyPauseCandidate = {
      organizationId: ORG,
      deploymentId: dep.deploymentId,
      recommendationId: submitInput.recommendationId,
      campaignId: submitInput.campaignId,
      rationale: submitInput.rationale,
      evidence: submitInput.evidence,
    };

    // First submit: the genuine park.
    expect(await submitter(candidate)).toEqual({ parked: true });
    // Second submit: the idempotent replay. It MUST still be read as a park. PRE-FIX
    // the replay omitted approvalRequired, so the submitter tripped its loudest
    // "UNEXPECTEDLY executed without approval" alarm and returned parked:false,
    // dropping the riley_self park-ownership truth.
    expect(await submitter(candidate)).toEqual({ parked: true });

    // The submitter's injected logger is submitter-scoped (no world noise), so a
    // clean error log proves the loud alarm never fired on the replay.
    expect(log.error).not.toHaveBeenCalled();
    // Both legs took the park branch (the replay tolerates the absent lifecycle id).
    expect(log.info).toHaveBeenCalledTimes(2);
    // Nothing executed on Meta on either attempt.
    expect(w.harness.metaCalls).toHaveLength(0);
  });
});
