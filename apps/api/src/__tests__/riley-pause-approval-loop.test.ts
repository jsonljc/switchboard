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
import { buildPauseLifecycleWorld } from "./riley-pause-lifecycle-world.js";
import { ORG } from "./recommendation-handoff-harness.js";

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
    await park(w);
    const second = await w.harness.ingress.submit(buildRileyPauseSubmitRequest(submitInput, dep)!);
    expect(second.ok).toBe(true);
    if (second.ok) {
      // Cached replay of the parked trace: still pending, nothing executed. The
      // cached branch returns the plain {ok,result,workUnit} shape WITHOUT
      // approvalRequired/lifecycleId, which is itself the proof that no second
      // gated lifecycle was created (only the require_approval branch creates one).
      expect(second.result.outcome).toBe("pending_approval");
      expect("approvalRequired" in second).toBe(false);
    }
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
});
