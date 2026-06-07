/**
 * Slice 4f keystone: the executed pause becomes ATTRIBUTABLE. Traces the full
 * leg the #860 lesson demands (gate-decision tests do not cover post-approval):
 *
 *   submit -> park -> approve -> execute -> recommendation transitioned
 *   (acted, resolvedAt = EXECUTION clock not requestedAt, machine sentinel,
 *   work-unit id stashed and AGREEING with the WorkTrace) -> the row
 *   satisfies the candidates predicate
 *
 * plus the never-transition negatives: reject, recovery-then-retry exactly
 * once, operator preempt (pause still completes; transition no-ops).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { respondToParkedLifecycle } from "@switchboard/core";
import { RILEY_PAUSE_EXECUTION_RESOLVED_BY } from "../services/workflows/riley-pause-execution-workflow.js";
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
  const res = await w.harness.ingress.submit(buildRileyPauseSubmitRequest(submitInput, dep)!);
  if (!res.ok) throw new Error("submit failed");
  const lifecycleId = (res as { lifecycleId?: string }).lifecycleId;
  const bindingHash = (res as { bindingHash?: string }).bindingHash;
  if (!lifecycleId || !bindingHash) throw new Error("park did not return lifecycle identifiers");
  return { lifecycleId, bindingHash };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("riley executed-pause attribution loop (slice 4f)", () => {
  it("park -> approve -> execute: the rec row is acted, anchored on EXECUTION time, candidate-eligible", async () => {
    vi.useFakeTimers();
    const parkAt = new Date("2026-06-06T00:00:00.000Z");
    vi.setSystemTime(parkAt);
    const w = buildPauseLifecycleWorld();
    const { lifecycleId, bindingHash } = await park(w);
    expect(w.harness.recommendationRow.status).toBe("pending");

    // Approve 20h later: inside the platform's 24h park expiry, but far enough
    // from requestedAt that a requestedAt-anchored transition fails loudly.
    const executeAt = new Date("2026-06-06T20:00:00.000Z");
    vi.setSystemTime(executeAt);
    const result = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(result.executionResult?.success).toBe(true);
    expect(w.harness.metaCalls).toEqual([{ campaignId: "camp_1", status: "PAUSED" }]);

    const row = w.harness.recommendationRow;
    expect(row.status).toBe("acted");
    expect(row.resolvedAt).toEqual(executeAt); // the attribution anchor: execution, not submit
    expect(row.resolvedBy).toBe(RILEY_PAUSE_EXECUTION_RESOLVED_BY);

    // The stash links the rec to the executing work unit (= the parked unit).
    // Review-requested agreement pin: the WorkTrace and the rec row name the
    // SAME work-unit id.
    const lifecycle = await w.lifecycleService.getLifecycleById(lifecycleId);
    expect(row.executedWorkUnitId).toBe(lifecycle!.actionEnvelopeId);
    const trace = (await w.harness.traceStore.getByWorkUnitId(lifecycle!.actionEnvelopeId))!.trace;
    expect(trace.workUnitId).toBe(row.executedWorkUnitId);
    expect(trace.executionOutputs).toMatchObject({
      recommendationTransition: "acted",
      executedAt: executeAt.toISOString(),
    });

    // The candidates predicate (findAttributableCandidates WHERE, pinned in db
    // tests): acted + resolvedAt + recommendation.* intent.
    expect(row.intent.startsWith("recommendation.")).toBe(true);
    expect(row.resolvedAt).not.toBeNull();
  });

  it("reject transitions nothing", async () => {
    const w = buildPauseLifecycleWorld();
    const { lifecycleId } = await park(w);
    await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "reject",
      respondedBy: "operator_jane",
    });
    expect(w.harness.recommendationRow.status).toBe("pending");
    expect(w.harness.recommendationRow.resolvedAt).toBeNull();
  });

  it("a failed Meta write transitions nothing; the recovery retry transitions exactly once", async () => {
    const w = buildPauseLifecycleWorld();
    w.harness.breakMetaOnce();
    const { lifecycleId, bindingHash } = await park(w);

    const first = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(first.executionResult?.success).toBe(false);
    expect(w.harness.recommendationRow.status).toBe("pending"); // META_PAUSE_FAILED leg never transitions

    const second = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(second.executionResult?.success).toBe(true);
    expect(w.harness.recommendationRow.status).toBe("acted");
  });

  it("operator preempt: the pause still completes; the transition is a recorded benign no-op", async () => {
    const w = buildPauseLifecycleWorld();
    const { lifecycleId, bindingHash } = await park(w);
    w.harness.recommendationRow.status = "dismissed"; // operator got there first

    const result = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(result.executionResult?.success).toBe(true);
    expect(w.harness.metaCalls).toEqual([{ campaignId: "camp_1", status: "PAUSED" }]);
    expect(w.harness.recommendationRow.status).toBe("dismissed"); // first writer won
    const lifecycle = await w.lifecycleService.getLifecycleById(lifecycleId);
    const trace = (await w.harness.traceStore.getByWorkUnitId(lifecycle!.actionEnvelopeId))!.trace;
    expect(trace.executionOutputs).toMatchObject({ recommendationTransition: "not_pending" });
  });
});
