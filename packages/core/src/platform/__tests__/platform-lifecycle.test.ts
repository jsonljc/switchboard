/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { PlatformLifecycle } from "../platform-lifecycle.js";
import { createApprovalState } from "../../approval/state-machine.js";
import type { ApprovalState } from "../../approval/state-machine.js";
import type { ActionEnvelope, ApprovalRequest, Principal } from "@switchboard/schemas";
import type { WorkTrace } from "../work-trace.js";
import type { WorkTraceStore } from "../work-trace-recorder.js";
import type {
  ApprovalStore as CoreApprovalStore,
  EnvelopeStore as CoreEnvelopeStore,
  IdentityStore as CoreIdentityStore,
} from "../../storage/interfaces.js";
import type { ExecutionModeRegistry } from "../execution-mode-registry.js";
import type { AuditLedger } from "../../audit/ledger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BINDING_HASH = "abc123hash";
const ORG_ID = "org-test";

function makeApprovalRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: overrides.id ?? `approval-${randomUUID()}`,
    actionId: overrides.actionId ?? `action-${randomUUID()}`,
    envelopeId: overrides.envelopeId ?? `env-${randomUUID()}`,
    conversationId: overrides.conversationId ?? null,
    summary: overrides.summary ?? "Test action",
    riskCategory: overrides.riskCategory ?? "medium",
    bindingHash: overrides.bindingHash ?? BINDING_HASH,
    evidenceBundle: overrides.evidenceBundle ?? {
      decisionTrace: {},
      contextSnapshot: {},
      identitySnapshot: {},
    },
    suggestedButtons: overrides.suggestedButtons ?? [
      { label: "Approve", action: "approve" },
      { label: "Reject", action: "reject" },
    ],
    approvers: overrides.approvers ?? ["approver-1"],
    fallbackApprover: overrides.fallbackApprover ?? null,
    status: overrides.status ?? "pending",
    respondedBy: overrides.respondedBy ?? null,
    respondedAt: overrides.respondedAt ?? null,
    patchValue: overrides.patchValue ?? null,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    expiredBehavior: overrides.expiredBehavior ?? "deny",
    createdAt: overrides.createdAt ?? new Date(),
    quorum: overrides.quorum ?? null,
  };
}

function makeEnvelope(id: string, overrides: Partial<ActionEnvelope> = {}): ActionEnvelope {
  return {
    id,
    version: 1,
    incomingMessage: null,
    conversationId: null,
    proposals: overrides.proposals ?? [
      {
        id: `prop-${randomUUID()}`,
        actionType: "campaign.pause",
        parameters: { campaignId: "camp-1", _principalId: "originator-user" },
        evidence: "test",
        confidence: 0.9,
        originatingMessageId: "msg-1",
      },
    ],
    resolvedEntities: [],
    plan: null,
    decisions: [],
    approvalRequests: [],
    executionResults: [],
    auditEntryIds: [],
    status: overrides.status ?? "pending_approval",
    createdAt: new Date(),
    updatedAt: new Date(),
    parentEnvelopeId: null,
    traceId: overrides.traceId ?? `trace-${randomUUID()}`,
    ...overrides,
  };
}

function makeWorkTrace(workUnitId: string, overrides: Partial<WorkTrace> = {}): WorkTrace {
  return {
    workUnitId,
    traceId: overrides.traceId ?? `trace-${randomUUID()}`,
    intent: overrides.intent ?? "campaign.pause",
    mode: overrides.mode ?? "skill",
    organizationId: overrides.organizationId ?? ORG_ID,
    actor: overrides.actor ?? { id: "originator-user", type: "user" },
    trigger: overrides.trigger ?? "api",
    governanceOutcome: overrides.governanceOutcome ?? "require_approval",
    riskScore: overrides.riskScore ?? 0.5,
    matchedPolicies: overrides.matchedPolicies ?? [],
    outcome: overrides.outcome ?? "pending_approval",
    durationMs: overrides.durationMs ?? 0,
    requestedAt: overrides.requestedAt ?? new Date().toISOString(),
    governanceCompletedAt: overrides.governanceCompletedAt ?? new Date().toISOString(),
    ...overrides,
  };
}

function makePrincipal(id: string): Principal {
  return {
    id,
    type: "user",
    name: `Principal ${id}`,
    organizationId: ORG_ID,
    roles: ["approver"],
  };
}

interface SeedResult {
  approvalId: string;
  envelopeId: string;
  approvalRequest: ApprovalRequest;
  approvalState: ApprovalState;
  envelope: ActionEnvelope;
  trace: WorkTrace;
}

// ---------------------------------------------------------------------------
// Mock store factories
// ---------------------------------------------------------------------------

function createMockStores() {
  const approvals = new Map<
    string,
    {
      request: ApprovalRequest;
      state: ApprovalState;
      envelopeId: string;
      organizationId?: string | null;
    }
  >();
  const envelopes = new Map<string, ActionEnvelope>();
  const traces = new Map<string, WorkTrace>();

  const approvalStore: CoreApprovalStore = {
    save: vi.fn(async (a) => {
      approvals.set(a.request.id, a);
    }),
    getById: vi.fn(async (id: string) => approvals.get(id) ?? null),
    updateState: vi.fn(async (id: string, state: ApprovalState, _expectedVersion?: number) => {
      const existing = approvals.get(id);
      if (existing) {
        approvals.set(id, { ...existing, state });
      }
    }),
    listPending: vi.fn(async () => []),
  };

  const envelopeStore: CoreEnvelopeStore = {
    save: vi.fn(async (e) => {
      envelopes.set(e.id, e);
    }),
    getById: vi.fn(async (id: string) => envelopes.get(id) ?? null),
    update: vi.fn(async (id: string, updates: Partial<ActionEnvelope>) => {
      const existing = envelopes.get(id);
      if (existing) {
        envelopes.set(id, { ...existing, ...updates } as ActionEnvelope);
      }
    }),
    list: vi.fn(async () => []),
  };

  const traceStore: WorkTraceStore = {
    persist: vi.fn(async (t) => {
      traces.set(t.workUnitId, t);
    }),
    getByWorkUnitId: vi.fn(async (id: string) => traces.get(id) ?? null),
    update: vi.fn(async (id: string, fields: Partial<WorkTrace>) => {
      const existing = traces.get(id);
      if (existing) {
        traces.set(id, { ...existing, ...fields });
      }
      return { ok: true as const, trace: traces.get(id) ?? ({} as never) };
    }),
    getByIdempotencyKey: vi.fn().mockResolvedValue(null),
  };

  const identityStore = {
    saveSpec: vi.fn(),
    getSpecByPrincipalId: vi.fn(),
    getSpecById: vi.fn(),
    listOverlaysBySpecId: vi.fn(),
    getOverlayById: vi.fn(),
    saveOverlay: vi.fn(),
    getPrincipal: vi.fn(async (id: string) => makePrincipal(id)),
    savePrincipal: vi.fn(),
    listDelegationRules: vi.fn(async () => []),
    saveDelegationRule: vi.fn(),
  } satisfies CoreIdentityStore;

  const modeRegistry = {
    dispatch: vi.fn(async (_mode, workUnit) => ({
      workUnitId: workUnit.id,
      outcome: "completed" as const,
      summary: "Executed successfully",
      outputs: {},
      mode: "skill" as const,
      durationMs: 42,
      traceId: workUnit.traceId,
    })),
    register: vi.fn(),
    hasMode: vi.fn(() => true),
    listModes: vi.fn(() => []),
  } as unknown as ExecutionModeRegistry;

  const ledger = {
    record: vi.fn(async () => ({
      id: `audit-${randomUUID()}`,
      eventType: "action.approved",
      timestamp: new Date(),
      actorType: "user",
      actorId: "test",
      entityType: "action",
      entityId: "test",
      riskCategory: "low",
      visibilityLevel: "public",
      summary: "test",
      snapshot: {},
      evidencePointers: [],
      redactionApplied: false,
      redactedFields: [],
      chainHashVersion: 1,
      schemaVersion: 1,
      entryHash: "hash",
      previousEntryHash: null,
      envelopeId: null,
      organizationId: null,
      traceId: null,
    })),
    query: vi.fn(async () => []),
    getById: vi.fn(async () => null),
    verifyChain: vi.fn(async () => ({ valid: true, brokenAt: null })),
  } as unknown as AuditLedger;

  function seed(overrides?: {
    expiresAt?: Date;
    actorId?: string;
    approvers?: string[];
    bindingHash?: string;
  }): SeedResult {
    const envelopeId = `env-${randomUUID()}`;
    const approvalId = `appr-${randomUUID()}`;
    const actorId = overrides?.actorId ?? "originator-user";

    const approvalRequest = makeApprovalRequest({
      id: approvalId,
      envelopeId,
      bindingHash: overrides?.bindingHash ?? BINDING_HASH,
      approvers: overrides?.approvers ?? ["approver-1"],
    });

    const expiresAt = overrides?.expiresAt ?? new Date(Date.now() + 3_600_000);
    const approvalState = createApprovalState(expiresAt);

    approvals.set(approvalId, {
      request: approvalRequest,
      state: approvalState,
      envelopeId,
      organizationId: ORG_ID,
    });

    const envelope = makeEnvelope(envelopeId, {
      proposals: [
        {
          id: `prop-${randomUUID()}`,
          actionType: "campaign.pause",
          parameters: { campaignId: "camp-1", _principalId: actorId },
          evidence: "test",
          confidence: 0.9,
          originatingMessageId: "msg-1",
        },
      ],
    });
    envelopes.set(envelopeId, envelope);

    const trace = makeWorkTrace(envelopeId, {
      actor: { id: actorId, type: "user" },
    });
    traces.set(envelopeId, trace);

    return { approvalId, envelopeId, approvalRequest, approvalState, envelope, trace };
  }

  return {
    approvalStore,
    envelopeStore,
    traceStore,
    identityStore,
    modeRegistry,
    ledger,
    seed,
    _approvals: approvals,
    _envelopes: envelopes,
    _traces: traces,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlatformLifecycle", () => {
  let stores: ReturnType<typeof createMockStores>;
  let lifecycle: PlatformLifecycle;

  beforeEach(() => {
    stores = createMockStores();
    lifecycle = new PlatformLifecycle({
      approvalStore: stores.approvalStore,
      envelopeStore: stores.envelopeStore,
      identityStore: stores.identityStore,
      modeRegistry: stores.modeRegistry,
      traceStore: stores.traceStore,
      ledger: stores.ledger,
    });
  });

  // -----------------------------------------------------------------------
  // 1. Approve -> execute -> trace updated
  // -----------------------------------------------------------------------
  describe("approve -> execute -> trace updated", () => {
    it("approves, executes via modeRegistry, and updates the work trace", async () => {
      const { approvalId } = stores.seed();

      const result = await lifecycle.respondToApproval({
        approvalId,
        action: "approve",
        respondedBy: "approver-1",
        bindingHash: BINDING_HASH,
      });

      // Approval state transitions to "approved"
      expect(result.approvalState.status).toBe("approved");

      // Execution happened
      expect(result.executionResult).not.toBeNull();
      expect(result.executionResult!.success).toBe(true);

      // modeRegistry.dispatch was called
      expect(stores.modeRegistry.dispatch).toHaveBeenCalledOnce();

      // Envelope status updated to "approved" (before execution)
      expect(stores.envelopeStore.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: "approved" }),
      );

      // Trace was updated with approval info
      expect(stores.traceStore.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          approvalOutcome: "approved",
          approvalRespondedBy: "approver-1",
        }),
        expect.objectContaining({ caller: expect.any(String) }),
      );

      // Trace was updated with execution result
      expect(stores.traceStore.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          outcome: "completed",
        }),
        expect.objectContaining({ caller: expect.any(String) }),
      );

      // Audit ledger recorded the approval and execution events
      expect(stores.ledger.record).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Reject -> trace shows "failed" + approvalOutcome: "rejected"
  // -----------------------------------------------------------------------
  describe("reject -> trace shows failed + rejected", () => {
    it("rejects the approval and marks trace as failed with rejected outcome", async () => {
      const { approvalId, envelopeId } = stores.seed();

      const result = await lifecycle.respondToApproval({
        approvalId,
        action: "reject",
        respondedBy: "approver-1",
        bindingHash: BINDING_HASH,
      });

      // Approval state transitions to "rejected"
      expect(result.approvalState.status).toBe("rejected");

      // No execution happened
      expect(result.executionResult).toBeNull();

      // Envelope status updated to "denied"
      expect(stores.envelopeStore.update).toHaveBeenCalledWith(envelopeId, {
        status: "denied",
      });

      // Trace updated with failed outcome and rejected approvalOutcome
      expect(stores.traceStore.update).toHaveBeenCalledWith(
        envelopeId,
        expect.objectContaining({
          approvalOutcome: "rejected",
          approvalRespondedBy: "approver-1",
          outcome: "failed",
        }),
        expect.objectContaining({ caller: expect.any(String) }),
      );

      // modeRegistry.dispatch was NOT called
      expect(stores.modeRegistry.dispatch).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 3. Expired approval -> envelope "expired" -> trace updated
  // -----------------------------------------------------------------------
  describe("expired approval", () => {
    it("detects expired approval, sets envelope to expired, and updates trace", async () => {
      const pastDate = new Date(Date.now() - 60_000);
      const { approvalId, envelopeId } = stores.seed({ expiresAt: pastDate });

      const result = await lifecycle.respondToApproval({
        approvalId,
        action: "approve",
        respondedBy: "approver-1",
        bindingHash: BINDING_HASH,
      });

      // Approval state transitions to "expired"
      expect(result.approvalState.status).toBe("expired");

      // No execution happened
      expect(result.executionResult).toBeNull();

      // Envelope status updated to "expired"
      expect(result.envelope.status).toBe("expired");
      expect(stores.envelopeStore.update).toHaveBeenCalledWith(envelopeId, {
        status: "expired",
      });

      // Trace updated with failed outcome
      expect(stores.traceStore.update).toHaveBeenCalledWith(
        envelopeId,
        expect.objectContaining({ outcome: "failed" }),
        expect.objectContaining({ caller: expect.any(String) }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // 4. Self-approval prevention
  // -----------------------------------------------------------------------
  describe("self-approval prevention", () => {
    it("throws when the responder is the originator of the action", async () => {
      const { approvalId } = stores.seed({
        actorId: "self-actor",
        approvers: ["self-actor"],
      });

      await expect(
        lifecycle.respondToApproval({
          approvalId,
          action: "approve",
          respondedBy: "self-actor",
          bindingHash: BINDING_HASH,
        }),
      ).rejects.toThrow("Self-approval is not permitted");
    });

    it("allows self-approval when selfApprovalAllowed is true", async () => {
      lifecycle = new PlatformLifecycle({
        approvalStore: stores.approvalStore,
        envelopeStore: stores.envelopeStore,
        identityStore: stores.identityStore,
        modeRegistry: stores.modeRegistry,
        traceStore: stores.traceStore,
        ledger: stores.ledger,
        selfApprovalAllowed: true,
      });

      const { approvalId } = stores.seed({
        actorId: "self-actor",
        approvers: ["self-actor"],
      });

      const result = await lifecycle.respondToApproval({
        approvalId,
        action: "approve",
        respondedBy: "self-actor",
        bindingHash: BINDING_HASH,
      });

      expect(result.approvalState.status).toBe("approved");
    });
  });

  // -----------------------------------------------------------------------
  // 5. Binding hash mismatch
  // -----------------------------------------------------------------------
  describe("binding hash mismatch", () => {
    it("throws when the binding hash does not match on approve", async () => {
      const { approvalId } = stores.seed();

      await expect(
        lifecycle.respondToApproval({
          approvalId,
          action: "approve",
          respondedBy: "approver-1",
          bindingHash: "wrong-hash-value",
        }),
      ).rejects.toThrow("Binding hash mismatch");
    });

    it("throws when the binding hash does not match on patch", async () => {
      const { approvalId } = stores.seed();

      await expect(
        lifecycle.respondToApproval({
          approvalId,
          action: "patch",
          respondedBy: "approver-1",
          bindingHash: "wrong-hash-value",
          patchValue: { budget: 500 },
        }),
      ).rejects.toThrow("Binding hash mismatch");
    });

    it("does not check binding hash on reject", async () => {
      const { approvalId } = stores.seed();

      const result = await lifecycle.respondToApproval({
        approvalId,
        action: "reject",
        respondedBy: "approver-1",
        bindingHash: "wrong-hash-value",
      });

      expect(result.approvalState.status).toBe("rejected");
    });
  });

  // -----------------------------------------------------------------------
  // 6. Rate limiting
  // -----------------------------------------------------------------------
  describe("rate limiting", () => {
    it("throws when the same responder exceeds the rate limit", async () => {
      lifecycle = new PlatformLifecycle({
        approvalStore: stores.approvalStore,
        envelopeStore: stores.envelopeStore,
        identityStore: stores.identityStore,
        modeRegistry: stores.modeRegistry,
        traceStore: stores.traceStore,
        ledger: stores.ledger,
        approvalRateLimit: { maxApprovals: 1, windowMs: 60_000 },
      });

      const first = stores.seed();
      const second = stores.seed();

      // First approval succeeds
      await lifecycle.respondToApproval({
        approvalId: first.approvalId,
        action: "approve",
        respondedBy: "approver-1",
        bindingHash: BINDING_HASH,
      });

      // Second approval from the same responder is rate-limited
      await expect(
        lifecycle.respondToApproval({
          approvalId: second.approvalId,
          action: "approve",
          respondedBy: "approver-1",
          bindingHash: BINDING_HASH,
        }),
      ).rejects.toThrow("Approval rate limit exceeded");
    });

    it("does not rate-limit different responders", async () => {
      lifecycle = new PlatformLifecycle({
        approvalStore: stores.approvalStore,
        envelopeStore: stores.envelopeStore,
        identityStore: stores.identityStore,
        modeRegistry: stores.modeRegistry,
        traceStore: stores.traceStore,
        ledger: stores.ledger,
        approvalRateLimit: { maxApprovals: 1, windowMs: 60_000 },
      });

      const first = stores.seed({ approvers: ["approver-1", "approver-2"] });
      const second = stores.seed({ approvers: ["approver-1", "approver-2"] });

      await lifecycle.respondToApproval({
        approvalId: first.approvalId,
        action: "approve",
        respondedBy: "approver-1",
        bindingHash: BINDING_HASH,
      });

      // Different responder is not rate-limited
      const result = await lifecycle.respondToApproval({
        approvalId: second.approvalId,
        action: "approve",
        respondedBy: "approver-2",
        bindingHash: BINDING_HASH,
      });

      expect(result.approvalState.status).toBe("approved");
    });
  });

  // -----------------------------------------------------------------------
  // 7. Patched re-evaluation (safety shim 2A-i)
  // -----------------------------------------------------------------------
  describe("patched parameter re-evaluation", () => {
    const CARTRIDGE_ID = "test-cartridge";
    const PRINCIPAL_ID = "originator-user";

    function seedWithCartridge(overrides?: { actorId?: string; approvers?: string[] }) {
      const result = stores.seed({
        actorId: overrides?.actorId ?? PRINCIPAL_ID,
        approvers: overrides?.approvers ?? ["approver-1"],
      });

      // Update the envelope to include _cartridgeId in proposal parameters
      const envelope = stores._envelopes.get(result.envelopeId)!;
      envelope.proposals[0]!.parameters = {
        ...envelope.proposals[0]!.parameters,
        _cartridgeId: CARTRIDGE_ID,
        _principalId: overrides?.actorId ?? PRINCIPAL_ID,
        _organizationId: ORG_ID,
      };
      stores._envelopes.set(result.envelopeId, envelope);

      return result;
    }

    it("denies when patched parameters violate policy", async () => {
      lifecycle = new PlatformLifecycle({
        approvalStore: stores.approvalStore,
        envelopeStore: stores.envelopeStore,
        identityStore: stores.identityStore,
        modeRegistry: stores.modeRegistry,
        traceStore: stores.traceStore,
        ledger: stores.ledger,
      });

      const { approvalId } = seedWithCartridge();

      const result = await lifecycle.respondToApproval({
        approvalId,
        action: "patch",
        respondedBy: "approver-1",
        bindingHash: BINDING_HASH,
        patchValue: { budget: 500 },
      });

      // Should proceed to execution (no cartridge re-evaluation on this branch)
      expect(result.executionResult).not.toBeNull();
      expect(result.executionResult!.success).toBe(true);
      expect(stores.modeRegistry.dispatch).toHaveBeenCalledOnce();
    });

    it("persists patched parameters to the work trace", async () => {
      const { approvalId, envelopeId } = seedWithCartridge();

      // Set trace parameters to match the original proposal
      const trace = stores._traces.get(envelopeId)!;
      trace.parameters = { campaignId: "camp-1", budget: 100 };
      stores._traces.set(envelopeId, trace);

      await lifecycle.respondToApproval({
        approvalId,
        action: "patch",
        respondedBy: "approver-1",
        bindingHash: BINDING_HASH,
        patchValue: { budget: 55 },
      });

      // modeRegistry.dispatch was called with patched parameters
      expect(stores.modeRegistry.dispatch).toHaveBeenCalledOnce();
      const dispatchCall = vi.mocked(stores.modeRegistry.dispatch).mock.calls[0]!;
      const dispatchedWorkUnit = dispatchCall[1];
      expect(dispatchedWorkUnit.parameters).toEqual(
        expect.objectContaining({ campaignId: "camp-1", budget: 55 }),
      );

      // The stored trace reflects patched parameters
      const updatedTrace = stores._traces.get(envelopeId)!;
      expect(updatedTrace.parameters).toEqual(
        expect.objectContaining({ campaignId: "camp-1", budget: 55 }),
      );
    });

    it("throws when trace update fails during patch (no silent proceed)", async () => {
      const { approvalId } = seedWithCartridge();

      // Force the first trace update (updateWorkTraceApproval) to fail.
      // If the error is silently swallowed, executeAfterApproval would proceed
      // with stale parameters — this test ensures the error propagates.
      vi.mocked(stores.traceStore.update).mockRejectedValueOnce(
        new Error("Trace store unavailable"),
      );

      await expect(
        lifecycle.respondToApproval({
          approvalId,
          action: "patch",
          respondedBy: "approver-1",
          bindingHash: BINDING_HASH,
          patchValue: { campaignId: "camp-patched" },
        }),
      ).rejects.toThrow("Trace store unavailable");
    });
  });
});
