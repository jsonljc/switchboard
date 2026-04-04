import { vi } from "vitest";
import type { ActionEnvelope, ApprovalRequest } from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ApprovalState } from "../../approval/state-machine.js";
import type { SharedContext } from "../shared-context.js";

export function makeSharedContext(overrides?: Partial<SharedContext>): SharedContext {
  return {
    storage: {
      envelopes: {
        save: vi.fn().mockResolvedValue(undefined),
        getById: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
      },
      policies: {
        save: vi.fn(),
        getById: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        listActive: vi.fn().mockResolvedValue([]),
      },
      identity: {
        saveSpec: vi.fn(),
        getSpecByPrincipalId: vi.fn(),
        getSpecById: vi.fn(),
        listOverlaysBySpecId: vi.fn(),
        getOverlayById: vi.fn(),
        saveOverlay: vi.fn(),
        getPrincipal: vi.fn(),
        savePrincipal: vi.fn(),
        listDelegationRules: vi.fn().mockResolvedValue([]),
        saveDelegationRule: vi.fn(),
      },
      approvals: {
        save: vi.fn().mockResolvedValue(undefined),
        getById: vi.fn(),
        updateState: vi.fn().mockResolvedValue(undefined),
        listPending: vi.fn(),
      },
      cartridges: {
        register: vi.fn(),
        unregister: vi.fn(),
        get: vi.fn(),
        list: vi.fn(),
      },
      competence: {
        getRecord: vi.fn(),
        saveRecord: vi.fn(),
        listRecords: vi.fn(),
        getPolicy: vi.fn(),
        getDefaultPolicy: vi.fn(),
        savePolicy: vi.fn(),
        listPolicies: vi.fn(),
      },
    },
    ledger: { record: vi.fn().mockResolvedValue(undefined) } as unknown as SharedContext["ledger"],
    guardrailState: {
      actionCounts: new Map(),
      lastActionTimes: new Map(),
    },
    guardrailStateStore: null,
    routingConfig: {
      defaultApprovers: [],
      defaultFallbackApprover: null,
      defaultExpiryMs: 86400000,
      defaultExpiredBehavior: "deny" as const,
      elevatedExpiryMs: 43200000,
      mandatoryExpiryMs: 14400000,
      denyWhenNoApprovers: true,
    },
    competenceTracker: null,
    riskPostureStore: null,
    governanceProfileStore: null,
    policyCache: null,
    executionMode: "inline",
    onEnqueue: null,
    approvalNotifier: null,
    selfApprovalAllowed: false,
    approvalRateLimit: null,
    crossCartridgeEnricher: null,
    dataFlowExecutor: null,
    credentialResolver: null,
    circuitBreaker: null,
    idempotencyGuard: null,
    ...overrides,
  } as SharedContext;
}

export function makeEnvelope(overrides?: Partial<ActionEnvelope>): ActionEnvelope {
  const now = new Date();
  return {
    id: "env-1",
    version: 1,
    incomingMessage: null,
    conversationId: null,
    proposals: [],
    resolvedEntities: [],
    plan: null,
    decisions: [],
    approvalRequests: [],
    executionResults: [],
    auditEntryIds: [],
    status: "proposed",
    createdAt: now,
    updatedAt: now,
    parentEnvelopeId: null,
    traceId: null,
    ...overrides,
  };
}

export function makeApprovalRequest(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  const now = new Date();
  return {
    id: "appr-1",
    actionId: "action-1",
    envelopeId: "env-1",
    conversationId: null,
    summary: "Requires approval",
    riskCategory: "medium",
    bindingHash: "abc123",
    evidenceBundle: { decisionTrace: [], contextSnapshot: {} },
    suggestedButtons: [],
    approvers: ["approver-1"],
    fallbackApprover: null,
    status: "pending",
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt: new Date(now.getTime() + 3600000),
    expiredBehavior: "deny" as const,
    createdAt: now,
    quorum: null,
    ...overrides,
  } as ApprovalRequest;
}

export function makeApprovalState(overrides?: Partial<ApprovalState>): ApprovalState {
  return {
    status: "pending",
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt: new Date(Date.now() + 3600000),
    quorum: null,
    version: 1,
    ...overrides,
  };
}

export function makeExecuteResult(overrides?: Partial<ExecuteResult>): ExecuteResult {
  return {
    success: true,
    summary: "executed",
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: 5,
    undoRecipe: null,
    ...overrides,
  };
}
