/**
 * Closes the loop #861 left open: the parked Riley -> Mira handoff is approved
 * through the REAL ApprovalLifecycleService + respondToParkedLifecycle + the
 * REAL PlatformLifecycle.executeApproved (executeAfterApproval -> the REAL
 * ExecutionModeRegistry), not a hand-called handler. Proves, end to end:
 *
 *   cron parks (lifecycle row + bindingHash on the submit response)
 *   -> the feed composition (adaptParkedApproval + summarizeParkedIntent)
 *      surfaces a humanized card carrying the bindingHash
 *   -> a REAL approve dispatches the REAL handoff handler
 *   -> submitChildWork re-enters the ingress -> Mira CreativeJob exists
 *   -> the job surfaces via the REAL PrismaMiraCreativeReadModelReader
 *   -> trace completed, lifecycle approved, DispatchRecord succeeded
 *
 * Plus the dispatch-failure leg (review #3): a failed dispatch parks a Retry
 * card (recovery_required), and retrying through the SAME respond leg recovers.
 */
import { describe, it, expect } from "vitest";
import { respondToParkedLifecycle, adaptParkedApproval } from "@switchboard/core";
import { executeWeeklyAudit } from "@switchboard/ad-optimizer";
import { synthesizeCreativeBrief } from "../services/workflows/creative-brief-synthesis.js";
import { summarizeParkedIntent } from "../services/workflows/parked-approval-cards.js";
import {
  ORG,
  buildCronDeps,
  readerFor,
  step,
  type ParkedHandoff,
} from "./recommendation-handoff-harness.js";
import { buildLifecycleWorld } from "./recommendation-handoff-lifecycle-world.js";

async function parkViaCron(w: ReturnType<typeof buildLifecycleWorld>) {
  const parked: ParkedHandoff[] = [];
  await executeWeeklyAudit(
    step as Parameters<typeof executeWeeklyAudit>[0],
    buildCronDeps(w.harness.ingress, parked),
  );
  expect(parked).toHaveLength(1);
  const res = parked[0]!.res;
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error("submit failed");
  expect("lifecycleId" in res && res.lifecycleId).toBeTruthy();
  return {
    lifecycleId: (res as { lifecycleId: string }).lifecycleId,
    bindingHash: (res as { bindingHash: string }).bindingHash,
  };
}

describe("Riley -> Mira handoff: parked approval surfaces and a REAL approve creates the draft", () => {
  it("parks with a lifecycle id, surfaces a humanized card, approve drives the real dispatch", async () => {
    const w = buildLifecycleWorld();
    const { lifecycleId, bindingHash } = await parkViaCron(w);

    // The feed leg (the same composition the decisions route runs).
    const lifecycle = await w.lifecycleService.getLifecycleById(lifecycleId);
    const revision = await w.lifecycleService.getCurrentRevision(lifecycleId);
    const traceResult = await w.harness.traceStore.getByWorkUnitId(lifecycle!.actionEnvelopeId);
    const card = adaptParkedApproval(
      lifecycle!,
      revision!,
      traceResult!.trace,
      summarizeParkedIntent,
    );
    expect(card.kind).toBe("workflow_approval");
    expect(card.agentKey).toBe("riley");
    expect(card.humanSummary).toContain("camp-1");
    expect(card.humanSummary).toMatch(/Riley wants to brief Mira/);
    expect(card.meta.bindingHash).toBe(bindingHash);
    expect(card.presentation.primaryLabel).toBe("Approve handoff");

    // REAL approve -> REAL lifecycle transition -> REAL dispatch -> Mira job.
    const result = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(result.approvalState.status).toBe("approved");
    expect(result.executionResult?.success).toBe(true);

    expect(w.harness.jobs).toHaveLength(1);
    const expectedBrief = synthesizeCreativeBrief(null);
    const rm = await readerFor(w.harness.jobs).read(ORG, { now: new Date(), timezone: "UTC" });
    expect(rm.jobs.find((j) => j.title === expectedBrief.productDescription)).toBeDefined();

    const trace = (await w.harness.traceStore.getByWorkUnitId(lifecycle!.actionEnvelopeId))!.trace;
    expect(trace.outcome).toBe("completed");
    expect(trace.approvalOutcome).toBe("approved");
    expect(trace.approvalRespondedBy).toBe("operator_jane");
    expect((await w.lifecycleService.getLifecycleById(lifecycleId))?.status).toBe("approved");
    const dispatches = w.store.listDispatchRecords();
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.state).toBe("succeeded");
  });

  it("a REAL reject parks no draft and fails the trace", async () => {
    const w = buildLifecycleWorld();
    const { lifecycleId } = await parkViaCron(w);

    const result = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "reject",
      respondedBy: "operator_jane",
    });
    expect(result.approvalState.status).toBe("rejected");
    expect(result.executionResult).toBeNull();
    expect(w.harness.jobs).toHaveLength(0);
    const lifecycle = await w.lifecycleService.getLifecycleById(lifecycleId);
    expect(lifecycle?.status).toBe("rejected");
    const trace = (await w.harness.traceStore.getByWorkUnitId(lifecycle!.actionEnvelopeId))!.trace;
    expect(trace.outcome).toBe("failed");
    expect(trace.approvalOutcome).toBe("rejected");
  });

  it("a failed dispatch parks a Retry card; retrying the SAME respond leg recovers (review #3)", async () => {
    const w = buildLifecycleWorld();
    w.harness.breakHandoffHandlerOnce();
    const { lifecycleId, bindingHash } = await parkViaCron(w);

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
    expect(w.harness.jobs).toHaveLength(0);

    // The feed renders it as a Retry card.
    const lifecycle = await w.lifecycleService.getLifecycleById(lifecycleId);
    const revision = await w.lifecycleService.getCurrentRevision(lifecycleId);
    const trace = (await w.harness.traceStore.getByWorkUnitId(lifecycle!.actionEnvelopeId))!.trace;
    const card = adaptParkedApproval(lifecycle!, revision!, trace, summarizeParkedIntent);
    expect(card.presentation.primaryLabel).toBe("Retry");
    expect(card.meta.dispatchFailed).toBe(true);
    expect(card.urgencyScore).toBe(100);

    // Retry (same respond leg) now succeeds end to end.
    const second = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(second.executionResult?.success).toBe(true);
    expect(w.harness.jobs).toHaveLength(1);
    expect((await w.lifecycleService.getLifecycleById(lifecycleId))?.status).toBe("approved");
    const records = w.store.listDispatchRecords();
    expect(records).toHaveLength(2);
    expect(records[0]?.state).toBe("failed");
    expect(records[1]?.attemptNumber).toBe(2);
    expect(records[1]?.state).toBe("succeeded");

    // The recovered job surfaces on the /mira read seam like any other draft.
    const rm = await readerFor(w.harness.jobs).read(ORG, { now: new Date(), timezone: "UTC" });
    expect(rm.counts.total).toBeGreaterThanOrEqual(1);
  });

  it("the cron's own system principal cannot approve its parked handoff (four-eyes)", async () => {
    const w = buildLifecycleWorld();
    const { lifecycleId, bindingHash } = await parkViaCron(w);

    await expect(
      respondToParkedLifecycle(w.deps, {
        lifecycleId,
        action: "approve",
        respondedBy: "system",
        bindingHash,
      }),
    ).rejects.toThrow(/self-approval/i);
    expect(w.harness.jobs).toHaveLength(0);
    expect((await w.lifecycleService.getLifecycleById(lifecycleId))?.status).toBe("pending");
  });
});
