import { describe, it, expect, vi } from "vitest";
import {
  handleApprovalResponse,
  NOT_FOUND_MSG,
  STALE_MSG,
  DASHBOARD_HANDOFF_MSG,
  APPROVAL_LOOKUP_ERROR_MSG,
} from "../handle-approval-response.js";
import type { ApprovalStore } from "../../storage/interfaces.js";
import type { ReplySink } from "../types.js";
import type { ParsedApprovalResponsePayload } from "../approval-response-payload.js";

const PAYLOAD: ParsedApprovalResponsePayload = {
  action: "approve",
  approvalId: "appr_1",
  bindingHash: "hash123",
};

function makeApproval(
  overrides: Partial<{ bindingHash: string; organizationId: string | null }> = {},
) {
  return {
    request: {
      id: "appr_1",
      bindingHash: overrides.bindingHash ?? "hash123",
    } as never,
    state: { status: "pending", version: 0 } as never,
    envelopeId: "env_1",
    organizationId: overrides.organizationId === undefined ? "org-1" : overrides.organizationId,
  };
}

function makeStore(getById: ApprovalStore["getById"]): ApprovalStore {
  return {
    save: vi.fn(),
    getById,
    updateState: vi.fn(),
    listPending: vi.fn(),
  };
}

function makeReplySink(): { sink: ReplySink; sendSpy: ReturnType<typeof vi.fn> } {
  const sendSpy = vi.fn().mockResolvedValue(undefined);
  return { sink: { send: sendSpy }, sendSpy };
}

describe("handleApprovalResponse", () => {
  it("replies NOT_FOUND_MSG when approval is missing", async () => {
    const getById = vi.fn().mockResolvedValue(null);
    const store = makeStore(getById);
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      payload: PAYLOAD,
      organizationId: "org-1",
      approvalStore: store,
      replySink: sink,
    });

    expect(getById).toHaveBeenCalledWith("appr_1");
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
  });

  it("replies NOT_FOUND_MSG on org mismatch (does not leak existence)", async () => {
    const store = makeStore(
      vi.fn().mockResolvedValue(makeApproval({ organizationId: "org-other" })),
    );
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      payload: PAYLOAD,
      organizationId: "org-1",
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
  });

  it("replies NOT_FOUND_MSG when stored organizationId is null", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval({ organizationId: null })));
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      payload: PAYLOAD,
      organizationId: "org-1",
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
  });

  it("replies STALE_MSG when hash lengths differ (length-guard branch)", async () => {
    const store = makeStore(
      vi.fn().mockResolvedValue(makeApproval({ bindingHash: "differenthash" })),
    );
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      payload: PAYLOAD,
      organizationId: "org-1",
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
  });

  it("replies STALE_MSG when hashes are same length but content differs (timingSafeEqual branch)", async () => {
    // Both "hash456" and "hash123" are 7 chars — passes length guard, fails timingSafeEqual.
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval({ bindingHash: "hash456" })));
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      payload: PAYLOAD,
      organizationId: "org-1",
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
  });

  it("replies STALE_MSG when stored bindingHash is not a non-empty string (defensive)", async () => {
    const malformed = makeApproval();
    (malformed.request as unknown as Record<string, unknown>).bindingHash = "";
    const store = makeStore(vi.fn().mockResolvedValue(malformed));
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      payload: PAYLOAD,
      organizationId: "org-1",
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
  });

  it("replies STALE_MSG when supplied and stored hashes have different lengths (no throw)", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval({ bindingHash: "short" })));
    const { sink, sendSpy } = makeReplySink();

    await expect(
      handleApprovalResponse({
        payload: PAYLOAD, // bindingHash length 7
        organizationId: "org-1",
        approvalStore: store,
        replySink: sink,
      }),
    ).resolves.toBeUndefined();

    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
  });

  it("replies DASHBOARD_HANDOFF_MSG on binding-hash match", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval()));
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      payload: PAYLOAD,
      organizationId: "org-1",
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(DASHBOARD_HANDOFF_MSG);
  });

  it("replies APPROVAL_LOOKUP_ERROR_MSG when getById throws", async () => {
    const store = makeStore(vi.fn().mockRejectedValue(new Error("db down")));
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      payload: PAYLOAD,
      organizationId: "org-1",
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(APPROVAL_LOOKUP_ERROR_MSG);
  });
});
