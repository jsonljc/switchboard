import { describe, it, expect, vi } from "vitest";
import {
  handleApprovalResponse,
  NOT_FOUND_MSG,
  STALE_MSG,
  NOT_AUTHORIZED_MSG,
  ALREADY_RESPONDED_MSG,
  APPROVE_SUCCESS_MSG,
  REJECT_SUCCESS_MSG,
  APPROVAL_EXECUTION_ERROR_MSG,
  APPROVAL_LOOKUP_ERROR_MSG,
  type HandleApprovalResponseConfig,
} from "../handle-approval-response.js";
import { StaleVersionError } from "../../approval/state-machine.js";
import type { ApprovalStore, IdentityStore } from "../../storage/interfaces.js";
import type { ReplySink } from "../types.js";
import type { ParsedApprovalResponsePayload } from "../approval-response-payload.js";
import type { OperatorChannelBindingStore } from "../operator-channel-binding-store.js";
import type { Principal } from "@switchboard/schemas";

const PAYLOAD: ParsedApprovalResponsePayload = {
  action: "approve",
  approvalId: "appr_1",
  bindingHash: "hash123",
};

const REJECT_PAYLOAD: ParsedApprovalResponsePayload = {
  action: "reject",
  approvalId: "appr_1",
  bindingHash: "hash123",
};

const BASE_ARGS = {
  channel: "whatsapp",
  channelIdentifier: "+15551234567",
  organizationId: "org-1",
};

function makeApproval(
  overrides: Partial<{
    bindingHash: string;
    organizationId: string | null;
    status: string;
  }> = {},
) {
  return {
    request: {
      id: "appr_1",
      bindingHash: overrides.bindingHash ?? "hash123",
    } as never,
    state: { status: overrides.status ?? "pending", version: 0 } as never,
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

function makeBindingStore(
  binding: Awaited<ReturnType<OperatorChannelBindingStore["findActiveBinding"]>>,
): OperatorChannelBindingStore {
  return {
    findActiveBinding: vi.fn().mockResolvedValue(binding),
  };
}

function makePrincipal(roles: Principal["roles"]): Principal {
  return {
    id: "principal-1",
    type: "user",
    name: "Operator",
    organizationId: "org-1",
    roles,
  };
}

function makeIdentityStore(principal: Principal | null): IdentityStore {
  return {
    getSpecByPrincipalId: vi.fn(),
    listOverlaysBySpecId: vi.fn(),
    saveSpec: vi.fn(),
    saveOverlay: vi.fn(),
    getPrincipal: vi.fn().mockResolvedValue(principal),
    savePrincipal: vi.fn(),
    listDelegationRules: vi.fn(),
  } as unknown as IdentityStore;
}

function makeRespondDeps(impl?: { throwInRespond?: boolean }) {
  return {
    approvalStore: makeStore(vi.fn().mockResolvedValue(makeApproval())),
    envelopeStore: { getById: vi.fn(), update: vi.fn(), save: vi.fn() } as never,
    workTraceStore: null,
    lifecycleService: null,
    platformLifecycle: {
      respondToApproval: impl?.throwInRespond
        ? vi.fn().mockRejectedValue(new Error("downstream lifecycle failure"))
        : vi.fn().mockResolvedValue({
            envelope: { id: "env_1" },
            approvalState: { status: "approved" },
            executionResult: { ok: true },
          }),
    },
    sessionManager: null,
    logger: { info: vi.fn(), error: vi.fn() },
  };
}

describe("handleApprovalResponse", () => {
  it("replies NOT_FOUND_MSG when approval is missing", async () => {
    const getById = vi.fn().mockResolvedValue(null);
    const store = makeStore(getById);
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: PAYLOAD,
      approvalStore: store,
      replySink: sink,
    });

    expect(getById).toHaveBeenCalledWith("appr_1");
    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
  });

  it("replies NOT_FOUND_MSG on org mismatch (does not leak existence)", async () => {
    const store = makeStore(
      vi.fn().mockResolvedValue(makeApproval({ organizationId: "org-other" })),
    );
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: PAYLOAD,
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
  });

  it("replies NOT_FOUND_MSG when stored organizationId is null", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval({ organizationId: null })));
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: PAYLOAD,
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
      ...BASE_ARGS,
      payload: PAYLOAD,
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
  });

  it("replies STALE_MSG when hashes are same length but content differs (timingSafeEqual branch)", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval({ bindingHash: "hash456" })));
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: PAYLOAD,
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
  });

  it("replies STALE_MSG when stored bindingHash is empty (defensive)", async () => {
    const malformed = makeApproval();
    (malformed.request as unknown as Record<string, unknown>).bindingHash = "";
    const store = makeStore(vi.fn().mockResolvedValue(malformed));
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: PAYLOAD,
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
        ...BASE_ARGS,
        payload: PAYLOAD,
        approvalStore: store,
        replySink: sink,
      }),
    ).resolves.toBeUndefined();

    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
  });

  it("replies APPROVAL_LOOKUP_ERROR_MSG when getById throws", async () => {
    const store = makeStore(vi.fn().mockRejectedValue(new Error("db down")));
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: PAYLOAD,
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledWith(APPROVAL_LOOKUP_ERROR_MSG);
  });

  // ---------------------------------------------------------------------------
  // Authorization gate (Risk #4a)
  // ---------------------------------------------------------------------------

  it("replies NOT_AUTHORIZED_MSG on hash match when no binding stack is wired (fail-closed)", async () => {
    // Audit invariant: channel-possession (binding hash match) MUST NOT execute on its own.
    // Without a configured binding store, we refuse — never silently approve.
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval()));
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: PAYLOAD,
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledWith(NOT_AUTHORIZED_MSG);
  });

  it("replies NOT_AUTHORIZED_MSG when no active binding exists for this channel identity", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval()));
    const { sink, sendSpy } = makeReplySink();
    const config: HandleApprovalResponseConfig = {
      bindingStore: makeBindingStore(null),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps: makeRespondDeps(),
    };

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: PAYLOAD,
      approvalStore: store,
      replySink: sink,
      config,
    });

    expect(sendSpy).toHaveBeenCalledWith(NOT_AUTHORIZED_MSG);
    expect(config.bindingStore.findActiveBinding).toHaveBeenCalledWith({
      organizationId: "org-1",
      channel: "whatsapp",
      channelIdentifier: "+15551234567",
    });
  });

  it("replies NOT_AUTHORIZED_MSG when binding's principal lacks an approver role", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval()));
    const { sink, sendSpy } = makeReplySink();
    const binding = {
      id: "b-1",
      organizationId: "org-1",
      channel: "whatsapp",
      channelIdentifier: "+15551234567",
      principalId: "principal-1",
      status: "active" as const,
      createdBy: "admin",
      revokedBy: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const config: HandleApprovalResponseConfig = {
      bindingStore: makeBindingStore(binding),
      identityStore: makeIdentityStore(makePrincipal(["requester"])), // no approver/operator/admin
      respondDeps: makeRespondDeps(),
    };

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: PAYLOAD,
      approvalStore: store,
      replySink: sink,
      config,
    });

    expect(sendSpy).toHaveBeenCalledWith(NOT_AUTHORIZED_MSG);
  });

  it("replies NOT_AUTHORIZED_MSG when binding's principal record is missing", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval()));
    const { sink, sendSpy } = makeReplySink();
    const binding = {
      id: "b-1",
      organizationId: "org-1",
      channel: "whatsapp",
      channelIdentifier: "+15551234567",
      principalId: "ghost-principal",
      status: "active" as const,
      createdBy: "admin",
      revokedBy: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const config: HandleApprovalResponseConfig = {
      bindingStore: makeBindingStore(binding),
      identityStore: makeIdentityStore(null),
      respondDeps: makeRespondDeps(),
    };

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: PAYLOAD,
      approvalStore: store,
      replySink: sink,
      config,
    });

    expect(sendSpy).toHaveBeenCalledWith(NOT_AUTHORIZED_MSG);
  });

  // ---------------------------------------------------------------------------
  // Successful execution
  // ---------------------------------------------------------------------------

  it("executes approve via shared helper and replies APPROVE_SUCCESS_MSG", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval()));
    const { sink, sendSpy } = makeReplySink();
    const binding = {
      id: "b-1",
      organizationId: "org-1",
      channel: "whatsapp",
      channelIdentifier: "+15551234567",
      principalId: "principal-1",
      status: "active" as const,
      createdBy: "admin",
      revokedBy: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const respondDeps = makeRespondDeps();
    const config: HandleApprovalResponseConfig = {
      bindingStore: makeBindingStore(binding),
      identityStore: makeIdentityStore(makePrincipal(["approver"])),
      respondDeps,
    };

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: PAYLOAD,
      approvalStore: store,
      replySink: sink,
      config,
    });

    expect(respondDeps.platformLifecycle.respondToApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: "appr_1",
        action: "approve",
        respondedBy: "principal-1", // critical: bound principal id, NOT channel sender
        bindingHash: "hash123",
      }),
    );
    expect(sendSpy).toHaveBeenCalledWith(APPROVE_SUCCESS_MSG);
  });

  it("executes reject via shared helper and replies REJECT_SUCCESS_MSG", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval()));
    const { sink, sendSpy } = makeReplySink();
    const binding = {
      id: "b-1",
      organizationId: "org-1",
      channel: "whatsapp",
      channelIdentifier: "+15551234567",
      principalId: "principal-1",
      status: "active" as const,
      createdBy: "admin",
      revokedBy: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const respondDeps = makeRespondDeps();
    const config: HandleApprovalResponseConfig = {
      bindingStore: makeBindingStore(binding),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps,
    };

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: REJECT_PAYLOAD,
      approvalStore: store,
      replySink: sink,
      config,
    });

    expect(respondDeps.platformLifecycle.respondToApproval).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reject", respondedBy: "principal-1" }),
    );
    expect(sendSpy).toHaveBeenCalledWith(REJECT_SUCCESS_MSG);
  });

  it("replies ALREADY_RESPONDED_MSG when approval state is no longer pending (pre-check)", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval({ status: "approved" })));
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: PAYLOAD,
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledWith(ALREADY_RESPONDED_MSG);
  });

  it("replies ALREADY_RESPONDED_MSG when shared helper throws StaleVersionError (race)", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval()));
    const { sink, sendSpy } = makeReplySink();
    const binding = {
      id: "b-1",
      organizationId: "org-1",
      channel: "whatsapp",
      channelIdentifier: "+15551234567",
      principalId: "principal-1",
      status: "active" as const,
      createdBy: "admin",
      revokedBy: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const respondDeps = makeRespondDeps();
    respondDeps.platformLifecycle.respondToApproval = vi
      .fn()
      .mockRejectedValue(new StaleVersionError("appr_1", 0, 1));
    const config: HandleApprovalResponseConfig = {
      bindingStore: makeBindingStore(binding),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps,
    };

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: PAYLOAD,
      approvalStore: store,
      replySink: sink,
      config,
    });

    expect(sendSpy).toHaveBeenCalledWith(ALREADY_RESPONDED_MSG);
  });

  it("replies ALREADY_RESPONDED_MSG when lifecycle throws status-mismatch (race, lifecycle path)", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval()));
    const { sink, sendSpy } = makeReplySink();
    const binding = {
      id: "b-1",
      organizationId: "org-1",
      channel: "whatsapp",
      channelIdentifier: "+15551234567",
      principalId: "principal-1",
      status: "active" as const,
      createdBy: "admin",
      revokedBy: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const respondDeps = makeRespondDeps();
    respondDeps.platformLifecycle.respondToApproval = vi
      .fn()
      .mockRejectedValue(new Error('Cannot approve: lifecycle status is "approved"'));
    const config: HandleApprovalResponseConfig = {
      bindingStore: makeBindingStore(binding),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps,
    };

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: PAYLOAD,
      approvalStore: store,
      replySink: sink,
      config,
    });

    expect(sendSpy).toHaveBeenCalledWith(ALREADY_RESPONDED_MSG);
  });

  it("replies APPROVAL_EXECUTION_ERROR_MSG when the shared helper throws", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval()));
    const { sink, sendSpy } = makeReplySink();
    const binding = {
      id: "b-1",
      organizationId: "org-1",
      channel: "whatsapp",
      channelIdentifier: "+15551234567",
      principalId: "principal-1",
      status: "active" as const,
      createdBy: "admin",
      revokedBy: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const config: HandleApprovalResponseConfig = {
      bindingStore: makeBindingStore(binding),
      identityStore: makeIdentityStore(makePrincipal(["admin"])),
      respondDeps: makeRespondDeps({ throwInRespond: true }),
    };

    await handleApprovalResponse({
      ...BASE_ARGS,
      payload: PAYLOAD,
      approvalStore: store,
      replySink: sink,
      config,
    });

    expect(sendSpy).toHaveBeenCalledWith(APPROVAL_EXECUTION_ERROR_MSG);
  });
});
