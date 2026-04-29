/**
 * Admission gate integration tests for PlatformLifecycle.
 *
 * Verifies that assertExecutionAdmissible is called at the two read sites
 * inside PlatformLifecycle:
 *   - respondToApproval (line ~88): reads trace then calls assertExecutionAdmissible
 *   - executeAfterApproval (line ~295): reads trace then calls assertExecutionAdmissible
 *     (triggered via respondToApproval with action:"approve")
 *
 * These tests use the same fixture pattern as platform-lifecycle.test.ts.
 * They focus ONLY on whether the admission gate fires and produces the right
 * error — not on the full lifecycle flow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { PlatformLifecycle } from "../platform-lifecycle.js";
import { createApprovalState } from "../../approval/state-machine.js";
import { WorkTraceIntegrityError } from "../work-trace-integrity.js";
import type { ApprovalRequest, ActionEnvelope } from "@switchboard/schemas";
import type { WorkTrace } from "../work-trace.js";
import type { WorkTraceStore, WorkTraceReadResult } from "../work-trace-recorder.js";
import type { IntegrityVerdict } from "../work-trace-integrity.js";
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

const BINDING_HASH = "integrity-test-hash";
const ORG_ID = "org-integrity";

function makeTrace(workUnitId: string): WorkTrace {
  return {
    workUnitId,
    traceId: `trace-${randomUUID()}`,
    intent: "campaign.pause",
    mode: "skill",
    organizationId: ORG_ID,
    actor: { id: "originator-user", type: "user" },
    trigger: "api",
    governanceOutcome: "require_approval",
    riskScore: 0.5,
    matchedPolicies: [],
    outcome: "pending_approval",
    durationMs: 0,
    requestedAt: new Date().toISOString(),
    governanceCompletedAt: new Date().toISOString(),
    ingressPath: "platform_ingress",
    hashInputVersion: 2,
  };
}

function makeApprovalRequest(id: string, envelopeId: string): ApprovalRequest {
  return {
    id,
    actionId: `action-${randomUUID()}`,
    envelopeId,
    conversationId: null,
    summary: "Test action",
    riskCategory: "medium",
    bindingHash: BINDING_HASH,
    evidenceBundle: { decisionTrace: {}, contextSnapshot: {}, identitySnapshot: {} },
    suggestedButtons: [
      { label: "Approve", action: "approve" },
      { label: "Reject", action: "reject" },
    ],
    approvers: ["approver-1"],
    fallbackApprover: null,
    status: "pending",
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    expiredBehavior: "deny",
    createdAt: new Date(),
    quorum: null,
  };
}

function makeEnvelope(id: string): ActionEnvelope {
  return {
    id,
    version: 1,
    incomingMessage: null,
    conversationId: null,
    proposals: [
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
    status: "pending_approval",
    createdAt: new Date(),
    updatedAt: new Date(),
    parentEnvelopeId: null,
    traceId: `trace-${randomUUID()}`,
  };
}

interface FixtureConfig {
  verdict: IntegrityVerdict;
}

function buildFixtures(cfg: FixtureConfig) {
  const envelopeId = `env-${randomUUID()}`;
  const approvalId = `appr-${randomUUID()}`;
  const approval = makeApprovalRequest(approvalId, envelopeId);
  const envelope = makeEnvelope(envelopeId);
  const trace = makeTrace(envelopeId);

  // Set envelope status to "approved" so executeAfterApproval doesn't short-circuit
  envelope.status = "approved";

  const approvalState = createApprovalState(new Date(Date.now() + 3_600_000));

  const approvalStore: CoreApprovalStore = {
    save: vi.fn(),
    getById: vi.fn().mockResolvedValue({
      request: approval,
      state: approvalState,
      envelopeId,
      organizationId: ORG_ID,
    }),
    updateState: vi.fn().mockResolvedValue(undefined),
    listPending: vi.fn().mockResolvedValue([]),
  };

  const envelopeStore: CoreEnvelopeStore = {
    save: vi.fn(),
    getById: vi.fn().mockResolvedValue(envelope),
    update: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
  };

  const traceReadResult: WorkTraceReadResult = { trace, integrity: cfg.verdict };
  const traceStore: WorkTraceStore = {
    persist: vi.fn().mockResolvedValue(undefined),
    getByWorkUnitId: vi.fn().mockResolvedValue(traceReadResult),
    getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({ ok: true as const, trace }),
  };

  const identityStore: CoreIdentityStore = {
    saveSpec: vi.fn(),
    getSpecByPrincipalId: vi.fn(),
    getSpecById: vi.fn(),
    listOverlaysBySpecId: vi.fn(),
    getOverlayById: vi.fn(),
    saveOverlay: vi.fn(),
    getPrincipal: vi.fn().mockResolvedValue({
      id: "approver-1",
      type: "user",
      name: "Approver One",
      organizationId: ORG_ID,
      roles: ["approver"],
    }),
    savePrincipal: vi.fn(),
    listDelegationRules: vi.fn().mockResolvedValue([]),
    saveDelegationRule: vi.fn(),
  };

  const modeRegistry = {
    dispatch: vi.fn().mockResolvedValue({
      workUnitId: envelopeId,
      outcome: "completed" as const,
      summary: "Done",
      outputs: {},
      mode: "skill" as const,
      durationMs: 10,
      traceId: trace.traceId,
    }),
    register: vi.fn(),
    hasMode: vi.fn(() => true),
    listModes: vi.fn(() => []),
  } as unknown as ExecutionModeRegistry;

  const ledger = {
    record: vi.fn().mockResolvedValue({
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
    }),
    query: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    verifyChain: vi.fn().mockResolvedValue({ valid: true, brokenAt: null }),
  } as unknown as AuditLedger;

  const lifecycle = new PlatformLifecycle({
    approvalStore,
    envelopeStore,
    identityStore,
    modeRegistry,
    traceStore,
    ledger,
  });

  return {
    lifecycle,
    approvalId,
    envelopeId,
    traceStore,
    modeRegistry,
    ledger,
  };
}

// ---------------------------------------------------------------------------
// Tests — respondToApproval admission gate (line ~88)
// ---------------------------------------------------------------------------

describe("PlatformLifecycle — admission gate in respondToApproval", () => {
  describe("when integrity is ok", () => {
    it("proceeds through respondToApproval and calls modeRegistry.dispatch on approve", async () => {
      const { lifecycle, approvalId, modeRegistry } = buildFixtures({
        verdict: { status: "ok" },
      });

      const result = await lifecycle.respondToApproval({
        approvalId,
        action: "approve",
        respondedBy: "approver-1",
        bindingHash: BINDING_HASH,
      });

      expect(result.approvalState.status).toBe("approved");
      expect(modeRegistry.dispatch).toHaveBeenCalledOnce();
    });

    it("proceeds through respondToApproval on reject (no execution)", async () => {
      const { lifecycle, approvalId, modeRegistry } = buildFixtures({
        verdict: { status: "ok" },
      });

      const result = await lifecycle.respondToApproval({
        approvalId,
        action: "reject",
        respondedBy: "approver-1",
        bindingHash: "wrong-hash-irrelevant-for-reject",
      });

      expect(result.approvalState.status).toBe("rejected");
      expect(modeRegistry.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("when integrity is mismatch", () => {
    it("throws WorkTraceIntegrityError before any execution", async () => {
      const { lifecycle, approvalId, modeRegistry } = buildFixtures({
        verdict: { status: "mismatch", expected: "hash-a", actual: "hash-b" },
      });

      await expect(
        lifecycle.respondToApproval({
          approvalId,
          action: "approve",
          respondedBy: "approver-1",
          bindingHash: BINDING_HASH,
        }),
      ).rejects.toThrow(WorkTraceIntegrityError);

      expect(modeRegistry.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("when integrity is missing_anchor", () => {
    it("throws WorkTraceIntegrityError before any execution", async () => {
      const { lifecycle, approvalId, modeRegistry } = buildFixtures({
        verdict: { status: "missing_anchor", expectedAtVersion: 1 },
      });

      await expect(
        lifecycle.respondToApproval({
          approvalId,
          action: "approve",
          respondedBy: "approver-1",
          bindingHash: BINDING_HASH,
        }),
      ).rejects.toThrow(WorkTraceIntegrityError);

      expect(modeRegistry.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("when integrity is skipped (pre-migration)", () => {
    it("throws WorkTraceIntegrityError before any execution", async () => {
      const { lifecycle, approvalId, modeRegistry } = buildFixtures({
        verdict: { status: "skipped", reason: "pre_migration" },
      });

      await expect(
        lifecycle.respondToApproval({
          approvalId,
          action: "approve",
          respondedBy: "approver-1",
          bindingHash: BINDING_HASH,
        }),
      ).rejects.toThrow(WorkTraceIntegrityError);

      expect(modeRegistry.dispatch).not.toHaveBeenCalled();
    });
  });

  it.todo(
    "when integrity is mismatch AND an operator override is provided, proceeds and records audit entry (blocked on operator override plumbing in respondToApproval)",
  );
});

// ---------------------------------------------------------------------------
// Tests — executeAfterApproval admission gate (line ~295)
// Triggered via the executeApproved public wrapper.
// ---------------------------------------------------------------------------

describe("PlatformLifecycle — admission gate in executeAfterApproval (via executeApproved)", () => {
  let stores: {
    traceStore: WorkTraceStore;
    modeRegistry: ExecutionModeRegistry;
  };
  let lifecycle: PlatformLifecycle;
  let envelopeId: string;

  beforeEach(() => {
    envelopeId = `env-${randomUUID()}`;
    const trace = makeTrace(envelopeId);
    const envelope = makeEnvelope(envelopeId);
    envelope.status = "approved";

    const traceStore: WorkTraceStore = {
      persist: vi.fn().mockResolvedValue(undefined),
      getByWorkUnitId: vi.fn().mockResolvedValue({
        trace,
        integrity: { status: "ok" as const },
      } satisfies WorkTraceReadResult),
      getByIdempotencyKey: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ ok: true as const, trace }),
    };

    const modeRegistry = {
      dispatch: vi.fn().mockResolvedValue({
        workUnitId: envelopeId,
        outcome: "completed" as const,
        summary: "Done",
        outputs: {},
        mode: "skill" as const,
        durationMs: 10,
        traceId: trace.traceId,
      }),
      register: vi.fn(),
      hasMode: vi.fn(() => true),
      listModes: vi.fn(() => []),
    } as unknown as ExecutionModeRegistry;

    const envelopeStore: CoreEnvelopeStore = {
      save: vi.fn(),
      getById: vi.fn().mockResolvedValue(envelope),
      update: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
    };

    stores = { traceStore, modeRegistry };

    lifecycle = new PlatformLifecycle({
      approvalStore: {
        save: vi.fn(),
        getById: vi.fn().mockResolvedValue(null),
        updateState: vi.fn(),
        listPending: vi.fn().mockResolvedValue([]),
      },
      envelopeStore,
      identityStore: {
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
      modeRegistry,
      traceStore,
      ledger: {
        record: vi.fn().mockResolvedValue({ id: "audit-1", entryHash: "h" }),
        query: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
        verifyChain: vi.fn().mockResolvedValue({ valid: true, brokenAt: null }),
      } as unknown as AuditLedger,
    });
  });

  it("dispatches to modeRegistry when integrity is ok", async () => {
    await lifecycle.executeApproved(envelopeId);
    expect(stores.modeRegistry.dispatch).toHaveBeenCalledOnce();
  });

  it("throws WorkTraceIntegrityError when integrity is mismatch (no dispatch)", async () => {
    vi.mocked(stores.traceStore.getByWorkUnitId).mockResolvedValue({
      trace: makeTrace(envelopeId),
      integrity: { status: "mismatch", expected: "a", actual: "b" },
    });

    await expect(lifecycle.executeApproved(envelopeId)).rejects.toThrow(WorkTraceIntegrityError);
    expect(stores.modeRegistry.dispatch).not.toHaveBeenCalled();
  });

  it("throws WorkTraceIntegrityError when integrity is missing_anchor (no dispatch)", async () => {
    vi.mocked(stores.traceStore.getByWorkUnitId).mockResolvedValue({
      trace: makeTrace(envelopeId),
      integrity: { status: "missing_anchor", expectedAtVersion: 2 },
    });

    await expect(lifecycle.executeApproved(envelopeId)).rejects.toThrow(WorkTraceIntegrityError);
    expect(stores.modeRegistry.dispatch).not.toHaveBeenCalled();
  });
});
