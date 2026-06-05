// ---------------------------------------------------------------------------
// handle-approval-response over a REAL ApprovalLifecycleService: the honest
// reply contract (spec section 3) and the lifecycle fallback leg (section 4).
// Split from handle-approval-response.test.ts (600-line max-lines gate);
// shared fixtures live in approval-response-fixtures.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import {
  handleApprovalResponse,
  NOT_FOUND_MSG,
  STALE_MSG,
  NOT_AUTHORIZED_MSG,
  APPROVE_EXECUTED_MSG,
  APPROVE_DISPATCH_FAILED_MSG,
  ADMISSION_FAILED_MSG,
  SELF_APPROVAL_MSG,
  REJECT_SUCCESS_MSG,
} from "../handle-approval-response.js";
import { DispatchAdmissionError } from "../../approval/dispatch-admission.js";
import type { HandleApprovalResponseConfig } from "../types.js";
import type { ParsedApprovalResponsePayload } from "../approval-response-payload.js";
import {
  PAYLOAD,
  BASE_ARGS,
  makeReplySink,
  makeBindingStore,
  makePrincipal,
  makeIdentityStore,
  makeRespondDeps,
  makeStore,
  makeApproval,
  makeLifecycleWorld,
  authorizedConfig,
  okExec,
} from "./approval-response-fixtures.js";

describe("handleApprovalResponse: honest replies over a real lifecycle", () => {
  it("approve runs the dispatch and replies APPROVE_EXECUTED_MSG (the handler ran)", async () => {
    const w = await makeLifecycleWorld();
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: PAYLOAD,
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(w.executeApproved).toHaveBeenCalledWith("env_1");
    expect(sendSpy).toHaveBeenCalledWith(APPROVE_EXECUTED_MSG);
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("approved");
  });

  it("approve whose dispatch fails replies APPROVE_DISPATCH_FAILED_MSG and parks recovery_required", async () => {
    const w = await makeLifecycleWorld({ failDispatch: true });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: PAYLOAD,
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(w.executeApproved).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(APPROVE_DISPATCH_FAILED_MSG);
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe(
      "recovery_required",
    );
  });

  it("self-approval through chat replies SELF_APPROVAL_MSG and runs nothing", async () => {
    const w = await makeLifecycleWorld();
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: PAYLOAD,
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never, "user-orig"),
    });
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith(SELF_APPROVAL_MSG);
  });

  it("a post-patch (stale) button replies STALE_MSG, not the generic execution error", async () => {
    const w = await makeLifecycleWorld();
    // a patch moved the current revision; the chat button still carries hash123
    await w.lifecycleService.createRevision({
      lifecycleId: w.lifecycle.id,
      parametersSnapshot: { campaignId: "patched" },
      approvalScopeSnapshot: {},
      bindingHash: "hash456",
      createdBy: "operator-2",
      sourceBindingHash: "hash123",
    });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: PAYLOAD,
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
  });

  it("a raced dispatch admission failure replies ADMISSION_FAILED_MSG (approved, not started)", async () => {
    // The admission gate can refuse between approve and execute (raced
    // transition, expired executable). The old generic reply claimed the
    // action "remains pending", which is wrong post-approve.
    const respondDeps = makeRespondDeps();
    respondDeps.platformLifecycle.respondToApproval = vi
      .fn()
      .mockRejectedValue(new DispatchAdmissionError("STALE_AUTHORITY", "authority superseded"));
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: PAYLOAD,
      ...BASE_ARGS,
      approvalStore: makeStore(vi.fn().mockResolvedValue(makeApproval())),
      replySink: sink,
      config: authorizedConfig(respondDeps),
    });
    expect(sendSpy).toHaveBeenCalledWith(ADMISSION_FAILED_MSG);
  });
});

describe("handleApprovalResponse: lifecycle fallback when the approval row is missing", () => {
  function lifecyclePayload(
    w: Awaited<ReturnType<typeof makeLifecycleWorld>>,
  ): ParsedApprovalResponsePayload {
    return { action: "approve", approvalId: w.lifecycle.id, bindingHash: "hash123" };
  }

  it("falls through to the lifecycle, dispatches, and replies APPROVE_EXECUTED_MSG", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: lifecyclePayload(w),
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(w.executeApproved).toHaveBeenCalledWith("env_1");
    expect(sendSpy).toHaveBeenCalledWith(APPROVE_EXECUTED_MSG);
  });

  it("approve on a recovery_required lifecycle IS retry (attempt 2) through the fallback", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true, failDispatch: true });
    const first = makeReplySink();
    await handleApprovalResponse({
      payload: lifecyclePayload(w),
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: first.sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(first.sendSpy).toHaveBeenCalledWith(APPROVE_DISPATCH_FAILED_MSG);
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe(
      "recovery_required",
    );
    // the handler is fixed now
    w.executeApproved.mockImplementation(async () => okExec());
    const second = makeReplySink();
    await handleApprovalResponse({
      payload: lifecyclePayload(w),
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: second.sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(second.sendSpy).toHaveBeenCalledWith(APPROVE_EXECUTED_MSG);
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("approved");
    expect(w.store.listDispatchRecords()).toHaveLength(2);
    expect(w.store.listDispatchRecords()[1]?.attemptNumber).toBe(2);
  });

  it("org mismatch on the lifecycle replies NOT_FOUND_MSG (no existence leak)", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: lifecyclePayload(w),
      ...BASE_ARGS,
      organizationId: "org-other",
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
    expect(w.executeApproved).not.toHaveBeenCalled();
  });

  it("a wrong hash against the current revision replies STALE_MSG before any respond attempt", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    // The engine (approveLifecycle) would also refuse a stale hash; the
    // surface pre-check must refuse BEFORE the respond engine is reached.
    const approveSpy = vi.spyOn(w.lifecycleService, "approveLifecycle");
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: { ...lifecyclePayload(w), bindingHash: "hashXX3" },
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect(approveSpy).not.toHaveBeenCalled();
  });

  it("reject through the fallback works and replies REJECT_SUCCESS_MSG", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: { ...lifecyclePayload(w), action: "reject" },
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(sendSpy).toHaveBeenCalledWith(REJECT_SUCCESS_MSG);
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("rejected");
  });

  it("no binding on the fallback leg fails closed with NOT_AUTHORIZED_MSG", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: lifecyclePayload(w),
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: {
        bindingStore: makeBindingStore(null),
        identityStore: makeIdentityStore(makePrincipal(["operator"])),
        respondDeps: w.respondDeps,
      } as HandleApprovalResponseConfig,
    });
    expect(sendSpy).toHaveBeenCalledWith(NOT_AUTHORIZED_MSG);
    expect(w.executeApproved).not.toHaveBeenCalled();
  });

  it("an unknown id (no row, no lifecycle) still replies NOT_FOUND_MSG", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: { action: "approve", approvalId: "lc-unknown", bindingHash: "hash123" },
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
  });
});
