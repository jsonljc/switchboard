import { describe, it, expect, vi } from "vitest";
import {
  handleApprovalResponse,
  NOT_FOUND_MSG,
  STALE_MSG,
  NOT_AUTHORIZED_MSG,
  ALREADY_RESPONDED_MSG,
  APPROVE_EXECUTED_MSG,
  APPROVE_DISPATCH_FAILED_MSG,
  PARTIAL_APPROVAL_MSG,
  SELF_APPROVAL_MSG,
  REJECT_SUCCESS_MSG,
  APPROVAL_EXECUTION_ERROR_MSG,
  APPROVAL_LOOKUP_ERROR_MSG,
} from "../handle-approval-response.js";
import { StaleVersionError } from "../../approval/state-machine.js";
import { ApprovalLifecycleService } from "../../approval/lifecycle-service.js";
import { InMemoryLifecycleStore } from "../../approval/in-memory-lifecycle-store.js";
import type { ApprovalStore, IdentityStore } from "../../storage/interfaces.js";
import type { ReplySink, HandleApprovalResponseConfig } from "../types.js";
import type { ParsedApprovalResponsePayload } from "../approval-response-payload.js";
import type { OperatorChannelBindingStore } from "../operator-channel-binding-store.js";
import type { ExecuteResult, Principal } from "@switchboard/schemas";

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

function okExec(): ExecuteResult {
  return {
    success: true,
    summary: "handler ran",
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: 1,
    undoRecipe: null,
  };
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
            executionResult: okExec(),
          }),
      executeApproved: vi.fn(),
    },
    sessionManager: null,
    logger: { info: vi.fn(), error: vi.fn() },
  };
}

/**
 * A REAL ApprovalLifecycleService world reached through the gateway: the
 * legacy approval row and the lifecycle row share the same work unit id and
 * binding hash (the production coexistence shape). executeApproved is a spy:
 * the assertions below are about THE HANDLER RUNNING, not status flips.
 */
async function makeLifecycleWorld(opts?: { failDispatch?: boolean; noApprovalRow?: boolean }) {
  const store = new InMemoryLifecycleStore();
  const lifecycleService = new ApprovalLifecycleService({ store });
  const { lifecycle, revision } = await lifecycleService.createGatedLifecycle({
    actionEnvelopeId: "env_1",
    organizationId: "org-1",
    expiresAt: new Date(Date.now() + 3_600_000),
    initialRevision: {
      parametersSnapshot: { campaignId: "camp-1" },
      approvalScopeSnapshot: {},
      bindingHash: "hash123",
      createdBy: "user-orig",
    },
  });

  let trace = {
    workUnitId: "env_1",
    requestedAt: new Date().toISOString(),
    organizationId: "org-1",
    actor: { id: "user-orig", type: "user" as const },
    intent: "test.action",
    parameters: { campaignId: "camp-1" },
    mode: "skill",
    traceId: "trace-1",
    trigger: "api",
    governanceConstraints: {},
  };
  const workTraceStore = {
    getByWorkUnitId: vi.fn(async () => ({ trace, integrity: { status: "ok" } })),
    update: vi.fn(async (_id: string, fields: Record<string, unknown>) => {
      trace = { ...trace, ...fields } as typeof trace;
      return { ok: true, trace };
    }),
  } as never;

  const executeApproved = vi.fn(async () =>
    opts?.failDispatch ? { ...okExec(), success: false, summary: "boom" } : okExec(),
  );

  const approvalStore = makeStore(
    opts?.noApprovalRow
      ? vi.fn().mockResolvedValue(null)
      : vi.fn().mockResolvedValue(makeApproval()),
  );

  const respondDeps = {
    approvalStore,
    envelopeStore: {
      getById: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      save: vi.fn(),
    } as never,
    workTraceStore,
    lifecycleService,
    platformLifecycle: { respondToApproval: vi.fn(), executeApproved } as never,
    sessionManager: null,
    logger: { info: vi.fn(), error: vi.fn() },
  };

  return {
    respondDeps,
    approvalStore,
    lifecycleService,
    store,
    lifecycle,
    revision,
    executeApproved,
  };
}

function authorizedConfig(
  respondDeps: ReturnType<typeof makeRespondDeps>,
  principalId = "principal-1",
): HandleApprovalResponseConfig {
  return {
    bindingStore: makeBindingStore({ principalId } as never),
    identityStore: makeIdentityStore({ ...makePrincipal(["operator"]), id: principalId }),
    respondDeps,
  } as HandleApprovalResponseConfig;
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

  it("executes approve via shared helper and replies APPROVE_EXECUTED_MSG", async () => {
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
    expect(sendSpy).toHaveBeenCalledWith(APPROVE_EXECUTED_MSG);
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

  it("a wrong hash against the current revision replies STALE_MSG without responding", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
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

describe("handleApprovalResponse: quorum partial", () => {
  it("an approve that leaves quorum open replies PARTIAL_APPROVAL_MSG", async () => {
    const respondDeps = makeRespondDeps();
    respondDeps.platformLifecycle.respondToApproval = vi.fn().mockResolvedValue({
      envelope: { id: "env_1" },
      approvalState: { status: "pending" },
      executionResult: null,
    });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: PAYLOAD,
      ...BASE_ARGS,
      approvalStore: makeStore(vi.fn().mockResolvedValue(makeApproval())),
      replySink: sink,
      config: authorizedConfig(respondDeps),
    });
    expect(sendSpy).toHaveBeenCalledWith(PARTIAL_APPROVAL_MSG);
  });
});
