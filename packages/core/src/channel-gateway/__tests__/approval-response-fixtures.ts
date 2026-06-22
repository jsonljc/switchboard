// ---------------------------------------------------------------------------
// Shared fixtures for the handle-approval-response suites
// (handle-approval-response.test.ts + handle-approval-response.lifecycle.test.ts)
// ---------------------------------------------------------------------------

import { vi } from "vitest";
import { ApprovalLifecycleService } from "../../approval/lifecycle-service.js";
import { InMemoryLifecycleStore } from "../../approval/in-memory-lifecycle-store.js";
import type { ApprovalStore, IdentityStore } from "../../storage/interfaces.js";
import type { ReplySink, HandleApprovalResponseConfig } from "../types.js";
import type { ParsedApprovalResponsePayload } from "../approval-response-payload.js";
import type { OperatorChannelBindingStore } from "../operator-channel-binding-store.js";
import type { ExecuteResult, Principal } from "@switchboard/schemas";

export const PAYLOAD: ParsedApprovalResponsePayload = {
  action: "approve",
  approvalId: "appr_1",
  bindingHash: "hash123",
};

export const REJECT_PAYLOAD: ParsedApprovalResponsePayload = {
  action: "reject",
  approvalId: "appr_1",
  bindingHash: "hash123",
};

export const BASE_ARGS = {
  channel: "whatsapp",
  channelIdentifier: "+15551234567",
  organizationId: "org-1",
};

export function makeApproval(
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

export function makeStore(getById: ApprovalStore["getById"]): ApprovalStore {
  return {
    save: vi.fn(),
    getById,
    updateState: vi.fn(),
    listPending: vi.fn(),
  };
}

export function makeReplySink(): { sink: ReplySink; sendSpy: ReturnType<typeof vi.fn> } {
  const sendSpy = vi.fn().mockResolvedValue(undefined);
  return { sink: { send: sendSpy }, sendSpy };
}

export function makeBindingStore(
  binding: Awaited<ReturnType<OperatorChannelBindingStore["findActiveBinding"]>>,
): OperatorChannelBindingStore {
  return {
    findActiveBinding: vi.fn().mockResolvedValue(binding),
  };
}

/** The full OperatorChannelBindingRecord shape used by the authorized-path cases. */
export function makeFullBinding() {
  return {
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
}

export function makePrincipal(roles: Principal["roles"]): Principal {
  return {
    id: "principal-1",
    type: "user",
    name: "Operator",
    organizationId: "org-1",
    roles,
  };
}

export function makeIdentityStore(principal: Principal | null): IdentityStore {
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

export function okExec(): ExecuteResult {
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

export function makeRespondDeps(impl?: { throwInRespond?: boolean }) {
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
 * the assertions in the lifecycle suite are about THE HANDLER RUNNING, not
 * status flips.
 */
export async function makeLifecycleWorld(opts?: {
  failDispatch?: boolean;
  noApprovalRow?: boolean;
  /** Designated approvers for the revision's approvalScopeSnapshot (A16). Empty/omitted = unrestricted. */
  approvers?: string[];
}) {
  const store = new InMemoryLifecycleStore();
  const lifecycleService = new ApprovalLifecycleService({ store });
  const { lifecycle, revision } = await lifecycleService.createGatedLifecycle({
    actionEnvelopeId: "env_1",
    organizationId: "org-1",
    expiresAt: new Date(Date.now() + 3_600_000),
    initialRevision: {
      parametersSnapshot: { campaignId: "camp-1" },
      approvalScopeSnapshot: opts?.approvers ? { approvers: opts.approvers } : {},
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

export function authorizedConfig(
  respondDeps: ReturnType<typeof makeRespondDeps>,
  principalId = "principal-1",
): HandleApprovalResponseConfig {
  return {
    bindingStore: makeBindingStore({ principalId } as never),
    identityStore: makeIdentityStore({ ...makePrincipal(["operator"]), id: principalId }),
    respondDeps,
  } as HandleApprovalResponseConfig;
}
