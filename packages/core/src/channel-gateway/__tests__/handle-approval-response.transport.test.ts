import { describe, it, expect, vi } from "vitest";
import {
  handleApprovalResponse,
  replyForChannelOutcome,
  NOT_FOUND_MSG,
  STALE_MSG,
  NOT_AUTHORIZED_MSG,
  APPROVAL_LOOKUP_ERROR_MSG,
  ALREADY_RESPONDED_MSG,
  REJECT_SUCCESS_MSG,
  APPROVE_EXECUTED_MSG,
  APPROVE_DISPATCH_FAILED_MSG,
  PARTIAL_APPROVAL_MSG,
  SELF_APPROVAL_MSG,
  ADMISSION_FAILED_MSG,
  APPROVAL_EXECUTION_ERROR_MSG,
} from "../handle-approval-response.js";
import type {
  ApprovalRespondTransport,
  ChannelApprovalRespondOutcome,
} from "../respond-to-channel-approval.js";
import { PAYLOAD, BASE_ARGS, makeStore, makeReplySink } from "./approval-response-fixtures.js";

function run(transport: ApprovalRespondTransport) {
  const { sink, sendSpy } = makeReplySink();
  const approvalStore = makeStore(vi.fn());
  const promise = handleApprovalResponse({
    payload: PAYLOAD,
    ...BASE_ARGS,
    approvalStore,
    replySink: sink,
    config: { transport },
  });
  return { promise, sendSpy, approvalStore };
}

describe("handleApprovalResponse: transport mode", () => {
  it("forwards the attested identity and renders the outcome reply", async () => {
    const respond = vi.fn().mockResolvedValue({
      kind: "responded",
      action: "approve",
      executionSuccess: true,
    } satisfies ChannelApprovalRespondOutcome);
    const { promise, sendSpy } = run({ respond });
    await promise;
    expect(respond).toHaveBeenCalledWith({
      approvalId: PAYLOAD.approvalId,
      action: PAYLOAD.action,
      bindingHash: PAYLOAD.bindingHash,
      organizationId: BASE_ARGS.organizationId,
      channel: BASE_ARGS.channel,
      channelIdentifier: BASE_ARGS.channelIdentifier,
    });
    expect(sendSpy).toHaveBeenCalledWith(APPROVE_EXECUTED_MSG);
  });

  it("does not touch local stores in transport mode (thin-forward)", async () => {
    const respond = vi.fn().mockResolvedValue({
      kind: "refused",
      code: "not_found",
    } satisfies ChannelApprovalRespondOutcome);
    const { promise, sendSpy, approvalStore } = run({ respond });
    await promise;
    expect(approvalStore.getById).not.toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
  });

  it("renders APPROVAL_LOOKUP_ERROR_MSG when the transport throws", async () => {
    const respond = vi.fn().mockRejectedValue(new Error("bridge down"));
    const { promise, sendSpy } = run({ respond });
    await promise;
    expect(sendSpy).toHaveBeenCalledWith(APPROVAL_LOOKUP_ERROR_MSG);
  });
});

describe("replyForChannelOutcome: total mapping", () => {
  it.each<[ChannelApprovalRespondOutcome, string]>([
    [{ kind: "responded", action: "reject", executionSuccess: null }, REJECT_SUCCESS_MSG],
    [{ kind: "responded", action: "approve", executionSuccess: true }, APPROVE_EXECUTED_MSG],
    [
      { kind: "responded", action: "approve", executionSuccess: false },
      APPROVE_DISPATCH_FAILED_MSG,
    ],
    [{ kind: "responded", action: "approve", executionSuccess: null }, PARTIAL_APPROVAL_MSG],
    [{ kind: "refused", code: "not_found" }, NOT_FOUND_MSG],
    [{ kind: "refused", code: "stale" }, STALE_MSG],
    [{ kind: "refused", code: "expired" }, STALE_MSG],
    [{ kind: "refused", code: "not_authorized" }, NOT_AUTHORIZED_MSG],
    [{ kind: "refused", code: "lookup_error" }, APPROVAL_LOOKUP_ERROR_MSG],
    [{ kind: "refused", code: "already_responded" }, ALREADY_RESPONDED_MSG],
    [{ kind: "refused", code: "conflict" }, ALREADY_RESPONDED_MSG],
    [{ kind: "refused", code: "self_approval" }, SELF_APPROVAL_MSG],
    [{ kind: "refused", code: "admission_failed" }, ADMISSION_FAILED_MSG],
    [{ kind: "refused", code: "execution_error" }, APPROVAL_EXECUTION_ERROR_MSG],
  ])("maps %j to the right constant", (outcome, expected) => {
    expect(replyForChannelOutcome(outcome)).toBe(expected);
  });
});
