/**
 * Lifecycle twin of api-approvals.test.ts: POST /api/approvals/:id/respond for
 * units that parked WITH a wired ApprovalLifecycleService (the production
 * shape). The :id here is the LIFECYCLE id that routes/actions.ts returns as
 * approvalRequest.id; no legacy ApprovalRequest row exists. Approve must drive
 * the REAL lifecycle transition AND the real mode dispatch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer } from "./test-server.js";

describe("approvals respond: lifecycle-native leg", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const ctx = await buildTestServer({ lifecycle: true });
    app = ctx.app;
    const spec = await app.storageContext.identity.getSpecByPrincipalId("default");
    if (spec) {
      spec.riskTolerance = { ...spec.riskTolerance, medium: "standard" as const };
      await app.storageContext.identity.saveSpec(spec);
    }
  });

  afterEach(async () => {
    await app.close();
  });

  async function parkOne() {
    const res = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: { "Idempotency-Key": `lc-${Date.now()}-${Math.random()}` },
      payload: {
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_123" },
        principalId: "default",
        cartridgeId: "digital-ads",
        organizationId: "default",
      },
    });
    const body = res.json();
    expect(body.outcome).toBe("PENDING_APPROVAL");
    return {
      workUnitId: body.workUnitId as string,
      approval: body.approvalRequest as { id: string; bindingHash: string },
    };
  }

  it("approves a lifecycle-parked unit and executes the real dispatch", async () => {
    const { workUnitId, approval } = await parkOne();

    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/respond`,
      payload: {
        action: "approve",
        respondedBy: "reviewer_1",
        bindingHash: approval.bindingHash,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.approvalState.status).toBe("approved");
    expect(body.executionResult.success).toBe(true);

    const traceResult = await app.workTraceStore!.getByWorkUnitId(workUnitId);
    expect(traceResult?.trace.outcome).toBe("completed");
    expect(traceResult?.trace.approvalOutcome).toBe("approved");
    expect(traceResult?.trace.approvalRespondedBy).toBe("reviewer_1");

    // The card disappears from the feed once responded.
    const feed = await app.inject({ method: "GET", url: "/api/dashboard/decisions" });
    expect(
      feed
        .json()
        .decisions.find(
          (d: { sourceRef: { sourceId: string } }) => d.sourceRef.sourceId === approval.id,
        ),
    ).toBeUndefined();
  });

  it("rejects a lifecycle-parked unit (no dispatch, trace failed)", async () => {
    const { workUnitId, approval } = await parkOne();
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/respond`,
      payload: { action: "reject", respondedBy: "reviewer_1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.approvalState.status).toBe("rejected");
    expect(body.executionResult).toBeNull();
    const traceResult = await app.workTraceStore!.getByWorkUnitId(workUnitId);
    expect(traceResult?.trace.outcome).toBe("failed");
    expect(traceResult?.trace.approvalOutcome).toBe("rejected");
  });

  it("refuses a stale bindingHash with 400 stale_binding", async () => {
    const { approval } = await parkOne();
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/respond`,
      payload: { action: "approve", respondedBy: "reviewer_1", bindingHash: "wrong" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("stale_binding");
    expect(res.json().error.toLowerCase()).toContain("stale");
  });

  it("409s a second response with already_responded", async () => {
    const { approval } = await parkOne();
    await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/respond`,
      payload: { action: "reject", respondedBy: "reviewer_1" },
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/respond`,
      payload: {
        action: "approve",
        respondedBy: "reviewer_1",
        bindingHash: approval.bindingHash,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("already_responded");
  });

  it("403s when the authenticated principal mismatches respondedBy", async () => {
    const { approval } = await parkOne();
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/respond`,
      headers: { "x-principal-id": "user_a" },
      payload: {
        action: "approve",
        respondedBy: "user_b",
        bindingHash: approval.bindingHash,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("principal_mismatch");
  });

  it("derives respondedBy from the authenticated principal when omitted", async () => {
    const { workUnitId, approval } = await parkOne();
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/respond`,
      headers: { "x-principal-id": "reviewer_9" },
      payload: { action: "approve", bindingHash: approval.bindingHash },
    });
    expect(res.statusCode).toBe(200);
    const traceResult = await app.workTraceStore!.getByWorkUnitId(workUnitId);
    expect(traceResult?.trace.approvalRespondedBy).toBe("reviewer_9");
  });

  it("blocks the originator from approving their own action", async () => {
    const { approval } = await parkOne();
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/respond`,
      payload: { action: "approve", respondedBy: "default", bindingHash: approval.bindingHash },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("self_approval");
  });

  it("404s an unknown id (neither approval row nor lifecycle)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/approvals/totally-unknown/respond",
      payload: { action: "approve", respondedBy: "r", bindingHash: "h" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("503s with lookup_failed when the lifecycle store is unreachable (structured, not a bare 400)", async () => {
    const { approval } = await parkOne();
    const spy = vi
      .spyOn(app.lifecycleService!, "getLifecycleById")
      .mockRejectedValueOnce(new Error("connection refused"));
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/respond`,
      payload: {
        action: "approve",
        respondedBy: "reviewer_1",
        bindingHash: approval.bindingHash,
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("lookup_failed");
    spy.mockRestore();
  });

  it("400s patch on the lifecycle-native leg", async () => {
    const { approval } = await parkOne();
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/respond`,
      payload: {
        action: "patch",
        respondedBy: "reviewer_1",
        bindingHash: approval.bindingHash,
        patchValue: { campaignId: "other" },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("patch_unsupported");
  });

  it("emits success:false (200) and a Retry card when dispatch fails post-approval", async () => {
    const { approval } = await parkOne();
    // Pin the route + recovery read-model contract; the REAL dispatch-failure
    // path is integration-covered in recommendation-handoff-approval-loop.
    const spy = vi.spyOn(app.platformLifecycle, "executeApproved").mockResolvedValueOnce({
      success: false,
      summary: "boom",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 0,
      undoRecipe: null,
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/respond`,
      payload: {
        action: "approve",
        respondedBy: "reviewer_1",
        bindingHash: approval.bindingHash,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().executionResult.success).toBe(false);

    const feed = await app.inject({ method: "GET", url: "/api/dashboard/decisions" });
    const retry = feed
      .json()
      .decisions.find(
        (d: { sourceRef: { sourceId: string } }) => d.sourceRef.sourceId === approval.id,
      );
    expect(retry).toBeDefined();
    expect(retry.presentation.primaryLabel).toBe("Retry");
    expect(retry.meta.dispatchFailed).toBe(true);
    spy.mockRestore();
  });
});
