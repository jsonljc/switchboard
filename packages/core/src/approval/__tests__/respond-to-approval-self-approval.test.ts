// ---------------------------------------------------------------------------
// Self-approval prevention on the lifecycle-backed approval path — A2
//
// The legacy PlatformLifecycle.respondToApproval prevents an action's own
// originator from approving it (preventSelfApprovalFromTrace, gated by
// selfApprovalAllowed). The production path goes through respondToApproval ->
// respondViaLifecycle -> lifecycleService.approveLifecycle, which historically
// performed NO self-approval check. A principal could therefore approve their
// own risky action (defeating the four-eyes / human-override invariant). These
// tests pin the guard onto the lifecycle path, with the same default-prevent
// semantics and the same selfApprovalAllowed escape hatch as the legacy path.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import {
  respondToApproval,
  type RespondToApprovalDeps,
  type ApprovalRecordForResponse,
} from "../respond-to-approval.js";

function makeTrace(originatorId: string) {
  return {
    workUnitId: "env-1",
    requestedAt: new Date().toISOString(),
    organizationId: "org-1",
    actor: { id: originatorId, type: "user" as const },
    intent: "test.action",
    parameters: {},
    deploymentContext: {
      deploymentId: "dep-1",
      skillSlug: "s",
      trustLevel: "supervised",
      trustScore: 0,
    },
    mode: "skill",
    traceId: "trace-1",
    trigger: "api",
    governanceConstraints: {},
  };
}

function makeDeps(opts: { originatorId: string; selfApprovalAllowed?: boolean }) {
  const approveLifecycle = vi.fn().mockResolvedValue({
    lifecycle: {
      id: "lc-1",
      actionEnvelopeId: "env-1",
      organizationId: "org-1",
      status: "approved",
    },
    executableWorkUnit: { id: "wu-1" },
  });
  const updateState = vi.fn().mockResolvedValue(undefined);
  const deps = {
    approvalStore: { save: vi.fn(), getById: vi.fn(), updateState, listPending: vi.fn() },
    envelopeStore: {
      getById: vi.fn().mockResolvedValue({ id: "env-1" }),
      update: vi.fn().mockResolvedValue(undefined),
      save: vi.fn(),
    },
    workTraceStore: {
      getByWorkUnitId: vi
        .fn()
        .mockResolvedValue({ trace: makeTrace(opts.originatorId), integrity: { status: "ok" } }),
    },
    lifecycleService: {
      findByEnvelopeId: vi
        .fn()
        .mockResolvedValue({ id: "lc-1", actionEnvelopeId: "env-1", organizationId: "org-1" }),
      approveLifecycle,
    },
    platformLifecycle: { respondToApproval: vi.fn() },
    sessionManager: null,
    logger: { info: vi.fn(), error: vi.fn() },
    selfApprovalAllowed: opts.selfApprovalAllowed,
  } as unknown as RespondToApprovalDeps;
  return { deps, approveLifecycle, updateState };
}

const approval: ApprovalRecordForResponse = {
  request: { id: "appr-1", actionId: "act-1", createdAt: new Date() } as never,
  state: { status: "pending", version: 0 } as never,
  envelopeId: "env-1",
  organizationId: "org-1",
};

describe("respondToApproval — self-approval prevention (lifecycle path)", () => {
  it("rejects self-approval (responder === action originator) without mutating or executing", async () => {
    const { deps, approveLifecycle, updateState } = makeDeps({ originatorId: "user-1" });

    await expect(
      respondToApproval(
        deps,
        { approvalId: "appr-1", action: "approve", respondedBy: "user-1", bindingHash: "h" },
        approval,
      ),
    ).rejects.toThrow("Self-approval is not permitted");

    // The guard must fire BEFORE any state mutation or execution.
    expect(updateState).not.toHaveBeenCalled();
    expect(approveLifecycle).not.toHaveBeenCalled();
  });

  it("allows a different principal to approve (no false block)", async () => {
    const { deps, approveLifecycle } = makeDeps({ originatorId: "user-1" });

    await respondToApproval(
      deps,
      { approvalId: "appr-1", action: "approve", respondedBy: "user-2", bindingHash: "h" },
      approval,
    );

    expect(approveLifecycle).toHaveBeenCalledTimes(1);
  });

  it("honors the selfApprovalAllowed escape hatch", async () => {
    const { deps, approveLifecycle } = makeDeps({
      originatorId: "user-1",
      selfApprovalAllowed: true,
    });

    await respondToApproval(
      deps,
      { approvalId: "appr-1", action: "approve", respondedBy: "user-1", bindingHash: "h" },
      approval,
    );

    expect(approveLifecycle).toHaveBeenCalledTimes(1);
  });
});
