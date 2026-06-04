/**
 * FULL-LOOP integration proof for the Riley cron -> Mira handoff (Contract 3).
 *
 * Where recommendation-handoff-cron-live-path.test.ts proves the SUBMIT SEAM
 * (builder -> ingress -> gate), this test drives the WHOLE governed loop the way
 * the seeded org_dev now can, end-to-end, from a synthetic Meta insight forward:
 *
 *   REAL executeWeeklyAudit (synthetic insight provider yields a refresh_creative
 *   rec) -> REAL recommendation sink -> the bootstrap-shaped recommendationHandoff
 *   Submitter (synthesizeCreativeBrief + buildRecommendationHandoffSubmitRequest +
 *   REAL PlatformIngress.submit) -> REAL GovernanceGate with the SEEDED allow +
 *   require_approval(mandatory) policies + the seeded { id:"system" } principal ->
 *   PARKS at mandatory -> drive the approved handler (REAL
 *   buildRecommendationHandoffWorkflow) -> REAL submitChildWork re-enters the ingress
 *   -> REAL buildCreativeConceptDraftWorkflow creates a CreativeJob row -> the row
 *   SURFACES via the REAL PrismaMiraCreativeReadModelReader (the /mira read seam).
 *
 * The harness lives in recommendation-handoff-harness.ts (shared with
 * recommendation-handoff-approval-loop.test.ts, which closes the approval leg
 * this file hand-drives).
 *
 * The approval LIFECYCLE transition itself is covered by api-approvals.test.ts
 * and recommendation-handoff-approval-loop.test.ts; this test drives the
 * post-approval handler dispatch directly, as the proven harness in
 * recommendation-handoff-cron-live-path.test.ts does.
 */
import { describe, it, expect } from "vitest";
import type {
  WorkUnit,
  ExecutionConstraints,
  GovernanceDecision,
} from "@switchboard/core/platform";
import { executeWeeklyAudit } from "@switchboard/ad-optimizer";
import { synthesizeCreativeBrief } from "../services/workflows/creative-brief-synthesis.js";
import {
  ORG,
  buildHarness,
  buildCronDeps,
  allowPolicy,
  approvalPolicy,
  readerFor,
  step,
  type ParkedHandoff,
} from "./recommendation-handoff-harness.js";

describe("Riley cron -> Mira handoff (FULL loop: synthetic insight to /mira read seam)", () => {
  it("the weekly audit submits exactly one handoff (refresh_creative) and it PARKS at mandatory", async () => {
    const { ingress } = buildHarness([allowPolicy(), approvalPolicy()]);
    const parked: ParkedHandoff[] = [];
    await executeWeeklyAudit(
      step as Parameters<typeof executeWeeklyAudit>[0],
      buildCronDeps(ingress, parked),
    );

    // refresh_creative is the only creative-handoff action; restructure (co-fired by
    // audience_saturation) abstains as unroutable -> exactly one submit.
    expect(parked).toHaveLength(1);
    const { req, res } = parked[0]!;
    expect(req.parameters["actionType"]).toBe("refresh_creative");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect("approvalRequired" in res && res.approvalRequired).toBe(true);
    expect(res.result.outcome).toBe("pending_approval");
    // The cron uses the seeded system principal verbatim (never system_auto_approved).
    expect(res.workUnit?.actor).toEqual({ id: "system", type: "system" });
  });

  it("on approval, the real handler creates a Mira CreativeJob that SURFACES on the /mira read seam", async () => {
    const h = buildHarness([allowPolicy(), approvalPolicy()]);
    const parked: ParkedHandoff[] = [];
    await executeWeeklyAudit(
      step as Parameters<typeof executeWeeklyAudit>[0],
      buildCronDeps(h.ingress, parked),
    );
    expect(parked).toHaveLength(1);
    const { req } = parked[0]!;

    // Post-approval dispatch: production approves the parked WorkUnit then dispatches
    // it via modeRegistry.dispatch("workflow", ...) (platform-lifecycle executeAfterApproval).
    // Drive that SAME path through the REAL ExecutionModeRegistry so a missing/renamed
    // "adoptimizer.recommendation.handoff" handler REGISTRATION would fail here
    // (WorkflowMode returns WORKFLOW_NOT_REGISTERED), not just a hand-called factory.
    const parkedWorkUnit = {
      id: "wu-handoff",
      organizationId: ORG,
      actor: req.actor,
      intent: req.intent,
      parameters: req.parameters,
      trigger: "internal",
      priority: "normal",
    } as WorkUnit;
    const result = await h.modeRegistry.dispatch(
      "workflow",
      parkedWorkUnit,
      {} as ExecutionConstraints,
      { traceId: "trace-handoff", governanceDecision: {} as GovernanceDecision },
    );

    expect(result.outcome).toBe("completed");
    const jobId = (result.outputs as { jobId?: string }).jobId;
    expect(jobId).toBeDefined();
    expect(h.jobs).toHaveLength(1);

    // The REAL Mira read model (the /mira reader) surfaces the fresh draft.
    const expectedBrief = synthesizeCreativeBrief(null);
    const rm = await readerFor(h.jobs).read(ORG, { now: new Date(), timezone: "UTC" });
    const surfaced = rm.jobs.find((j) => j.id === jobId);
    expect(surfaced).toBeDefined();
    expect(surfaced!.title).toBe(expectedBrief.productDescription);
    // A fresh "trends" draft (no stage outputs) maps to in_progress / Drafting.
    expect(surfaced!.status).toBe("in_progress");
    expect(rm.counts.total).toBeGreaterThanOrEqual(1);
    expect(rm.counts.inFlight).toBeGreaterThanOrEqual(1);
  });

  it("default-DENIES on an un-seeded org (no allow policy) — fail safe, no phantom handoff", async () => {
    const { ingress } = buildHarness([]); // no policies seeded
    const parked: ParkedHandoff[] = [];
    await executeWeeklyAudit(
      step as Parameters<typeof executeWeeklyAudit>[0],
      buildCronDeps(ingress, parked),
    );
    // A submit is still attempted (Riley does not abstain), but the gate default-denies.
    expect(parked).toHaveLength(1);
    const { res } = parked[0]!;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Specifically a GOVERNANCE default-deny, not an intent/deployment setup failure:
    // the deny path returns a failed result with the "Denied by governance" summary and
    // NO approvalRequired flag (so it neither parks nor auto-executes). Asserting the
    // reason keeps the control from passing vacuously on an unrelated ok:false setup error.
    expect("approvalRequired" in res).toBe(false);
    expect(res.result.outcome).toBe("failed");
    expect(res.result.summary).toBe("Denied by governance");
  });
});
