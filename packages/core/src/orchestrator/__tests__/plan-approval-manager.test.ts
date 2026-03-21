import { describe, it, expect, vi } from "vitest";
import type { ApprovalRequest } from "@switchboard/schemas";
import type { ApprovalState } from "../../approval/state-machine.js";
import { respondToPlanApproval } from "../plan-approval-manager.js";
import {
  makeSharedContext,
  makeEnvelope,
  makeApprovalRequest,
  makeApprovalState,
  makeExecuteResult,
} from "./helpers.js";

function makeApprovalRecord(overrides?: {
  request?: Partial<ApprovalRequest>;
  state?: Partial<ApprovalState>;
  envelopeId?: string;
  organizationId?: string | null;
}) {
  return {
    request: makeApprovalRequest({
      id: "appr-plan-1",
      actionId: "plan-1",
      envelopeId: "env-plan-1",
      bindingHash: "hash123",
      approvers: ["approver-1"],
      evidenceBundle: {
        decisionTrace: [],
        contextSnapshot: { proposalEnvelopeIds: ["env-child-1", "env-child-2"] },
        identitySnapshot: {},
      },
      ...overrides?.request,
    }),
    state: makeApprovalState(overrides?.state),
    envelopeId: overrides?.envelopeId ?? "env-plan-1",
    organizationId: overrides?.organizationId ?? "org-1",
  };
}

// ---------------------------------------------------------------------------
// respondToPlanApproval — approval not found
// ---------------------------------------------------------------------------

describe("respondToPlanApproval — approval not found", () => {
  it("throws when the approval is not found", async () => {
    const ctx = makeSharedContext();
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      respondToPlanApproval(
        ctx,
        { approvalId: "no-exist", action: "approve", respondedBy: "u1", bindingHash: "h" },
        vi.fn(),
      ),
    ).rejects.toThrow("Plan approval not found: no-exist");
  });
});

// ---------------------------------------------------------------------------
// respondToPlanApproval — expired approval
// ---------------------------------------------------------------------------

describe("respondToPlanApproval — expired approval", () => {
  it("handles expired plan approval by marking envelopes as expired", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({ state: { expiresAt: new Date(Date.now() - 1000) } });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.envelopes.getById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEnvelope({ id: "env-plan-1" }),
    );

    const result = await respondToPlanApproval(
      ctx,
      { approvalId: "appr-plan-1", action: "approve", respondedBy: "u1", bindingHash: "h" },
      vi.fn(),
    );

    expect(ctx.storage.envelopes.update).toHaveBeenCalledWith("env-plan-1", { status: "expired" });
    expect(result.planEnvelope.status).toBe("expired");
    expect(result.executionResults).toEqual([]);
    expect(ctx.storage.envelopes.update).toHaveBeenCalledWith("env-child-1", { status: "expired" });
    expect(ctx.storage.envelopes.update).toHaveBeenCalledWith("env-child-2", { status: "expired" });
    expect(ctx.ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "action.expired", entityType: "plan" }),
    );
  });

  it("throws when plan envelope is not found on expired approval", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({ state: { expiresAt: new Date(Date.now() - 1000) } });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.envelopes.getById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      respondToPlanApproval(
        ctx,
        { approvalId: "appr-plan-1", action: "approve", respondedBy: "u1", bindingHash: "h" },
        vi.fn(),
      ),
    ).rejects.toThrow("Plan envelope not found for expired approval");
  });
});

// ---------------------------------------------------------------------------
// respondToPlanApproval — binding hash validation
// ---------------------------------------------------------------------------

describe("respondToPlanApproval — binding hash validation", () => {
  it("throws on binding hash mismatch when approving", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({ request: { bindingHash: "correct", approvers: [] } });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);

    await expect(
      respondToPlanApproval(
        ctx,
        { approvalId: "appr-plan-1", action: "approve", respondedBy: "u1", bindingHash: "wrong" },
        vi.fn(),
      ),
    ).rejects.toThrow("Binding hash mismatch");
  });

  it("does not check binding hash when rejecting", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({ request: { bindingHash: "correct", approvers: [] } });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.envelopes.getById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEnvelope({ id: "env-plan-1" }),
    );

    const result = await respondToPlanApproval(
      ctx,
      { approvalId: "appr-plan-1", action: "reject", respondedBy: "u1", bindingHash: "any" },
      vi.fn(),
    );
    expect(result.planEnvelope.status).toBe("denied");
  });
});

// ---------------------------------------------------------------------------
// respondToPlanApproval — authorization
// ---------------------------------------------------------------------------

describe("respondToPlanApproval — authorization", () => {
  it("throws when principal is not found", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({
      request: { approvers: ["approver-1"], bindingHash: "h" },
    });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.identity.getPrincipal as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      respondToPlanApproval(
        ctx,
        { approvalId: "appr-plan-1", action: "reject", respondedBy: "unknown", bindingHash: "" },
        vi.fn(),
      ),
    ).rejects.toThrow("Principal not found: unknown");
  });

  it("throws when principal is not authorized", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({
      request: { approvers: ["approver-1"], bindingHash: "h" },
    });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.identity.getPrincipal as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
      roles: ["viewer"],
      organizationId: null,
    });

    await expect(
      respondToPlanApproval(
        ctx,
        { approvalId: "appr-plan-1", action: "reject", respondedBy: "u1", bindingHash: "" },
        vi.fn(),
      ),
    ).rejects.toThrow("not authorized");
  });

  it("allows response when approvers list is empty (no restriction)", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({ request: { approvers: [], bindingHash: "h" } });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.envelopes.getById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEnvelope({ id: "env-plan-1" }),
    );

    const result = await respondToPlanApproval(
      ctx,
      { approvalId: "appr-plan-1", action: "reject", respondedBy: "anyone", bindingHash: "" },
      vi.fn(),
    );
    expect(result.planEnvelope.status).toBe("denied");
  });
});

// ---------------------------------------------------------------------------
// respondToPlanApproval — rejection
// ---------------------------------------------------------------------------

describe("respondToPlanApproval — rejection", () => {
  it("rejects a plan and all child envelopes", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({ request: { approvers: [], bindingHash: "h" } });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.envelopes.getById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEnvelope({ id: "env-plan-1" }),
    );

    const result = await respondToPlanApproval(
      ctx,
      { approvalId: "appr-plan-1", action: "reject", respondedBy: "admin-1", bindingHash: "" },
      vi.fn(),
    );

    expect(result.planEnvelope.status).toBe("denied");
    expect(result.executionResults).toEqual([]);
    expect(ctx.storage.envelopes.update).toHaveBeenCalledWith("env-plan-1", { status: "denied" });
    expect(ctx.storage.envelopes.update).toHaveBeenCalledWith("env-child-1", { status: "denied" });
    expect(ctx.storage.envelopes.update).toHaveBeenCalledWith("env-child-2", { status: "denied" });
    expect(ctx.ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "action.rejected",
        actorId: "admin-1",
        entityType: "plan",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// respondToPlanApproval — approval
// ---------------------------------------------------------------------------

describe("respondToPlanApproval — approval", () => {
  it("approves and executes all child envelopes", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({ request: { approvers: [], bindingHash: "hash123" } });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.envelopes.getById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEnvelope({ id: "env-plan-1" }),
    );
    const executeApproved = vi.fn().mockResolvedValue(makeExecuteResult());

    const result = await respondToPlanApproval(
      ctx,
      {
        approvalId: "appr-plan-1",
        action: "approve",
        respondedBy: "admin-1",
        bindingHash: "hash123",
      },
      executeApproved,
    );

    expect(ctx.storage.envelopes.update).toHaveBeenCalledWith("env-plan-1", { status: "approved" });
    expect(ctx.storage.envelopes.update).toHaveBeenCalledWith("env-child-1", {
      status: "approved",
    });
    expect(ctx.storage.envelopes.update).toHaveBeenCalledWith("env-child-2", {
      status: "approved",
    });
    expect(executeApproved).toHaveBeenCalledWith("env-child-1");
    expect(executeApproved).toHaveBeenCalledWith("env-child-2");
    expect(result.executionResults.length).toBe(2);
    expect(result.executionResults.every((r) => r.success)).toBe(true);
    expect(result.planEnvelope.status).toBe("executed");
    expect(ctx.ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "action.approved",
        actorId: "admin-1",
        entityType: "plan",
      }),
    );
  });

  it("marks plan as failed when any execution fails", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({ request: { approvers: [], bindingHash: "hash123" } });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.envelopes.getById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEnvelope({ id: "env-plan-1" }),
    );
    const executeApproved = vi
      .fn()
      .mockResolvedValueOnce(makeExecuteResult({ success: true }))
      .mockResolvedValueOnce(makeExecuteResult({ success: false, summary: "payment failed" }));

    const result = await respondToPlanApproval(
      ctx,
      {
        approvalId: "appr-plan-1",
        action: "approve",
        respondedBy: "admin-1",
        bindingHash: "hash123",
      },
      executeApproved,
    );

    expect(result.planEnvelope.status).toBe("failed");
    expect(result.executionResults.length).toBe(2);
  });

  it("stops execution on atomic strategy when first fails", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({ request: { approvers: [], bindingHash: "hash123" } });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.envelopes.getById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEnvelope({
        id: "env-plan-1",
        plan: {
          id: "plan-1",
          envelopeId: "env-plan-1",
          strategy: "atomic",
          approvalMode: "single_approval",
          summary: "atomic",
          proposalOrder: [],
        },
      }),
    );
    const executeApproved = vi.fn().mockResolvedValueOnce(makeExecuteResult({ success: false }));

    const result = await respondToPlanApproval(
      ctx,
      {
        approvalId: "appr-plan-1",
        action: "approve",
        respondedBy: "admin-1",
        bindingHash: "hash123",
      },
      executeApproved,
    );

    expect(executeApproved).toHaveBeenCalledTimes(1);
    expect(result.executionResults.length).toBe(1);
    expect(ctx.storage.envelopes.update).toHaveBeenCalledWith("env-child-2", { status: "failed" });
    expect(result.planEnvelope.status).toBe("failed");
  });

  it("handles execution exception on atomic strategy", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({ request: { approvers: [], bindingHash: "hash123" } });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.envelopes.getById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEnvelope({
        id: "env-plan-1",
        plan: {
          id: "plan-1",
          envelopeId: "env-plan-1",
          strategy: "atomic",
          approvalMode: "single_approval",
          summary: "atomic",
          proposalOrder: [],
        },
      }),
    );
    const executeApproved = vi.fn().mockRejectedValueOnce(new Error("connection lost"));

    const result = await respondToPlanApproval(
      ctx,
      {
        approvalId: "appr-plan-1",
        action: "approve",
        respondedBy: "admin-1",
        bindingHash: "hash123",
      },
      executeApproved,
    );

    expect(result.executionResults.length).toBe(1);
    expect(result.executionResults[0]!.success).toBe(false);
    expect(result.executionResults[0]!.summary).toContain("connection lost");
    expect(ctx.storage.envelopes.update).toHaveBeenCalledWith("env-child-2", { status: "failed" });
    expect(result.planEnvelope.status).toBe("failed");
  });

  it("continues execution on non-atomic strategy even when one fails", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({ request: { approvers: [], bindingHash: "hash123" } });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.envelopes.getById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEnvelope({
        id: "env-plan-1",
        plan: {
          id: "plan-1",
          envelopeId: "env-plan-1",
          strategy: "best_effort",
          approvalMode: "single_approval",
          summary: "be",
          proposalOrder: [],
        },
      }),
    );
    const executeApproved = vi
      .fn()
      .mockResolvedValueOnce(makeExecuteResult({ success: false }))
      .mockResolvedValueOnce(makeExecuteResult({ success: true }));

    const result = await respondToPlanApproval(
      ctx,
      {
        approvalId: "appr-plan-1",
        action: "approve",
        respondedBy: "admin-1",
        bindingHash: "hash123",
      },
      executeApproved,
    );

    expect(executeApproved).toHaveBeenCalledTimes(2);
    expect(result.executionResults.length).toBe(2);
    expect(result.planEnvelope.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// respondToPlanApproval — missing proposal envelope IDs
// ---------------------------------------------------------------------------

describe("respondToPlanApproval — missing proposal envelope IDs", () => {
  it("throws when no proposalEnvelopeIds in contextSnapshot", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({
      request: {
        approvers: [],
        bindingHash: "h",
        evidenceBundle: { decisionTrace: [], contextSnapshot: {}, identitySnapshot: {} },
      },
    });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.envelopes.getById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEnvelope({ id: "env-plan-1" }),
    );

    await expect(
      respondToPlanApproval(
        ctx,
        { approvalId: "appr-plan-1", action: "reject", respondedBy: "admin-1", bindingHash: "" },
        vi.fn(),
      ),
    ).rejects.toThrow("No proposal envelope IDs found in plan approval");
  });

  it("throws when proposalEnvelopeIds is empty array", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({
      request: {
        approvers: [],
        bindingHash: "h",
        evidenceBundle: {
          decisionTrace: [],
          contextSnapshot: { proposalEnvelopeIds: [] },
          identitySnapshot: {},
        },
      },
    });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.envelopes.getById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEnvelope({ id: "env-plan-1" }),
    );

    await expect(
      respondToPlanApproval(
        ctx,
        { approvalId: "appr-plan-1", action: "reject", respondedBy: "admin-1", bindingHash: "" },
        vi.fn(),
      ),
    ).rejects.toThrow("No proposal envelope IDs found in plan approval");
  });
});

// ---------------------------------------------------------------------------
// respondToPlanApproval — plan envelope not found
// ---------------------------------------------------------------------------

describe("respondToPlanApproval — plan envelope not found", () => {
  it("throws when plan envelope is not found during approve/reject", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({ request: { approvers: [], bindingHash: "h" } });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.envelopes.getById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      respondToPlanApproval(
        ctx,
        { approvalId: "appr-plan-1", action: "reject", respondedBy: "admin-1", bindingHash: "" },
        vi.fn(),
      ),
    ).rejects.toThrow("Plan envelope not found: env-plan-1");
  });
});

// ---------------------------------------------------------------------------
// respondToPlanApproval — state transition
// ---------------------------------------------------------------------------

describe("respondToPlanApproval — state transition", () => {
  it("transitions approval state and persists with optimistic concurrency", async () => {
    const ctx = makeSharedContext();
    const approval = makeApprovalRecord({
      request: { approvers: [], bindingHash: "hash123" },
      state: { version: 3 },
    });
    (ctx.storage.approvals.getById as ReturnType<typeof vi.fn>).mockResolvedValue(approval);
    (ctx.storage.envelopes.getById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEnvelope({ id: "env-plan-1" }),
    );
    const executeApproved = vi.fn().mockResolvedValue(makeExecuteResult());

    await respondToPlanApproval(
      ctx,
      {
        approvalId: "appr-plan-1",
        action: "approve",
        respondedBy: "admin-1",
        bindingHash: "hash123",
      },
      executeApproved,
    );

    expect(ctx.storage.approvals.updateState).toHaveBeenCalledWith(
      "appr-plan-1",
      expect.objectContaining({ status: "approved", respondedBy: "admin-1", version: 4 }),
      3,
    );
  });
});
