import { describe, it, expect, vi } from "vitest";
import type { ActionEnvelope, ActionPlan, DecisionTrace } from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { SharedContext } from "../shared-context.js";
import type { ProposeResult } from "../lifecycle.js";
import type { ProposePipeline } from "../propose-pipeline.js";
import { proposePlan } from "../plan-pipeline.js";
import { makeSharedContext, makeEnvelope, makeApprovalRequest } from "./helpers.js";

function makePlan(overrides?: Partial<ActionPlan>): ActionPlan {
  return {
    id: "plan-1",
    envelopeId: "env-plan-1",
    strategy: "best_effort",
    approvalMode: "per_action",
    summary: "Test plan",
    proposalOrder: [],
    ...overrides,
  };
}

function makeDecisionTrace(overrides?: Partial<DecisionTrace>): DecisionTrace {
  return {
    actionId: "action-1",
    envelopeId: "env-1",
    checks: [],
    computedRiskScore: { rawScore: 10, category: "low", factors: [] },
    finalDecision: "allow",
    approvalRequired: "none",
    explanation: "Allowed",
    evaluatedAt: new Date(),
    ...overrides,
  };
}

function makeProposeResult(overrides?: Partial<ProposeResult>): ProposeResult {
  return {
    envelope: makeEnvelope(),
    decisionTrace: makeDecisionTrace(),
    approvalRequest: null,
    denied: false,
    explanation: "Action allowed",
    ...overrides,
  };
}

function makePipeline(proposeFn: ProposePipeline["propose"]): ProposePipeline {
  return { propose: proposeFn } as ProposePipeline;
}

const noopExecute: (envelopeId: string) => Promise<ExecuteResult> = vi.fn().mockResolvedValue({
  success: true,
  summary: "executed",
  externalRefs: {},
  rollbackAvailable: false,
  partialFailures: [],
  durationMs: 5,
  undoRecipe: null,
});

// ---------------------------------------------------------------------------
// proposePlan — data-flow delegation
// ---------------------------------------------------------------------------

describe("proposePlan — data-flow delegation", () => {
  it("delegates to dataFlowExecutor when dataFlowSteps are present", async () => {
    const dataFlowExecutor = {
      execute: vi.fn().mockResolvedValue({
        planId: "plan-1",
        strategy: "best_effort",
        stepResults: [{ stepId: "s1", outcome: "completed" }],
        overallOutcome: "completed",
      }),
    };
    const ctx = makeSharedContext({ dataFlowExecutor } as unknown as Partial<SharedContext>);
    const plan = makePlan({
      dataFlowSteps: [
        { actionType: "pay", index: 0, cartridgeId: "payments", parameters: {}, condition: null },
      ],
    });
    const proposals = [
      {
        actionType: "pay",
        parameters: {},
        principalId: "u1",
        cartridgeId: "payments",
        organizationId: "org-1",
      },
    ];
    const result = await proposePlan(makePipeline(vi.fn()), ctx, plan, proposals, noopExecute);
    expect(dataFlowExecutor.execute).toHaveBeenCalled();
    expect(result.planDecision).toBe("allow");
    expect(result.results).toEqual([]);
    expect(result.explanation).toContain("Data-flow plan completed");
  });

  it("returns deny when data-flow execution fails", async () => {
    const dataFlowExecutor = {
      execute: vi.fn().mockResolvedValue({
        planId: "plan-1",
        strategy: "best_effort",
        stepResults: [],
        overallOutcome: "failed",
      }),
    };
    const ctx = makeSharedContext({ dataFlowExecutor } as unknown as Partial<SharedContext>);
    const plan = makePlan({
      dataFlowSteps: [
        { actionType: "pay", index: 0, cartridgeId: "payments", parameters: {}, condition: null },
      ],
    });
    const result = await proposePlan(
      makePipeline(vi.fn()),
      ctx,
      plan,
      [{ actionType: "pay", parameters: {}, principalId: "u1", cartridgeId: "payments" }],
      noopExecute,
    );
    expect(result.planDecision).toBe("deny");
  });

  it("returns partial when data-flow execution is partial", async () => {
    const dataFlowExecutor = {
      execute: vi.fn().mockResolvedValue({
        planId: "plan-1",
        strategy: "best_effort",
        stepResults: [{ stepId: "s1" }, { stepId: "s2" }],
        overallOutcome: "partial",
      }),
    };
    const ctx = makeSharedContext({ dataFlowExecutor } as unknown as Partial<SharedContext>);
    const plan = makePlan({
      dataFlowSteps: [
        { actionType: "pay", index: 0, cartridgeId: "payments", parameters: {}, condition: null },
      ],
    });
    const result = await proposePlan(
      makePipeline(vi.fn()),
      ctx,
      plan,
      [{ actionType: "pay", parameters: {}, principalId: "u1", cartridgeId: "payments" }],
      noopExecute,
    );
    expect(result.planDecision).toBe("partial");
    expect(result.explanation).toContain("2 steps processed");
  });
});

// ---------------------------------------------------------------------------
// proposePlan — standard (non-data-flow) proposals
// ---------------------------------------------------------------------------

describe("proposePlan — standard proposals", () => {
  it("evaluates each proposal through the pipeline", async () => {
    const proposeFn = vi.fn().mockResolvedValue(makeProposeResult());
    const ctx = makeSharedContext();
    const plan = makePlan({ strategy: "best_effort" });
    const proposals = [
      { actionType: "pay", parameters: {}, principalId: "u1", cartridgeId: "payments" },
      { actionType: "send", parameters: {}, principalId: "u1", cartridgeId: "crm" },
    ];
    const result = await proposePlan(makePipeline(proposeFn), ctx, plan, proposals, noopExecute);
    expect(proposeFn).toHaveBeenCalledTimes(2);
    expect(result.results.length).toBe(2);
    expect(result.planDecision).toBe("allow");
  });

  it("updates proposalOrder on the plan", async () => {
    const r1 = makeProposeResult({
      envelope: makeEnvelope({
        proposals: [{ id: "prop-A", actionType: "a", parameters: {} }],
      } as Partial<ActionEnvelope>),
    });
    const r2 = makeProposeResult({
      envelope: makeEnvelope({
        id: "env-2",
        proposals: [{ id: "prop-B", actionType: "b", parameters: {} }],
      } as Partial<ActionEnvelope>),
    });
    const proposeFn = vi.fn().mockResolvedValueOnce(r1).mockResolvedValueOnce(r2);
    const plan = makePlan({ strategy: "best_effort" });
    await proposePlan(
      makePipeline(proposeFn),
      makeSharedContext(),
      plan,
      [
        { actionType: "a", parameters: {}, principalId: "u", cartridgeId: "c" },
        { actionType: "b", parameters: {}, principalId: "u", cartridgeId: "c" },
      ],
      noopExecute,
    );
    expect(plan.proposalOrder).toEqual(["prop-A", "prop-B"]);
  });
});

// ---------------------------------------------------------------------------
// proposePlan — atomic strategy
// ---------------------------------------------------------------------------

describe("proposePlan — atomic strategy", () => {
  it("denies all when any proposal is denied", async () => {
    const allowedResult = makeProposeResult({
      envelope: makeEnvelope({ id: "env-a", status: "proposed" }),
      decisionTrace: makeDecisionTrace({ finalDecision: "allow" }),
    });
    const deniedResult = makeProposeResult({
      envelope: makeEnvelope({ id: "env-b", status: "denied" }),
      decisionTrace: makeDecisionTrace({ finalDecision: "deny" }),
      denied: true,
    });
    const proposeFn = vi
      .fn()
      .mockResolvedValueOnce(allowedResult)
      .mockResolvedValueOnce(deniedResult);
    const ctx = makeSharedContext();
    const plan = makePlan({ strategy: "atomic" });
    const result = await proposePlan(
      makePipeline(proposeFn),
      ctx,
      plan,
      [
        { actionType: "a", parameters: {}, principalId: "u", cartridgeId: "c" },
        { actionType: "b", parameters: {}, principalId: "u", cartridgeId: "c" },
      ],
      noopExecute,
    );
    expect(result.planDecision).toBe("deny");
    expect(ctx.storage.envelopes.update).toHaveBeenCalledWith("env-a", { status: "denied" });
    expect(result.results[0]!.envelope.status).toBe("denied");
  });

  it("allows all when all proposals are allowed", async () => {
    const r1 = makeProposeResult({
      envelope: makeEnvelope({ id: "env-a" }),
      decisionTrace: makeDecisionTrace({ finalDecision: "allow" }),
    });
    const r2 = makeProposeResult({
      envelope: makeEnvelope({ id: "env-b" }),
      decisionTrace: makeDecisionTrace({ finalDecision: "allow" }),
    });
    const proposeFn = vi.fn().mockResolvedValueOnce(r1).mockResolvedValueOnce(r2);
    const ctx = makeSharedContext();
    const result = await proposePlan(
      makePipeline(proposeFn),
      ctx,
      makePlan({ strategy: "atomic" }),
      [
        { actionType: "a", parameters: {}, principalId: "u", cartridgeId: "c" },
        { actionType: "b", parameters: {}, principalId: "u", cartridgeId: "c" },
      ],
      noopExecute,
    );
    expect(result.planDecision).toBe("allow");
    expect(ctx.storage.envelopes.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// proposePlan — sequential strategy
// ---------------------------------------------------------------------------

describe("proposePlan — sequential strategy", () => {
  it("denies subsequent proposals after the first failure", async () => {
    const r1 = makeProposeResult({
      envelope: makeEnvelope({
        id: "env-a",
        status: "proposed",
        proposals: [{ id: "prop-1", actionType: "a", parameters: {} }],
      } as Partial<ActionEnvelope>),
      decisionTrace: makeDecisionTrace({ actionId: "prop-1", finalDecision: "deny" }),
      denied: true,
    });
    const r2 = makeProposeResult({
      envelope: makeEnvelope({
        id: "env-b",
        status: "proposed",
        proposals: [{ id: "prop-2", actionType: "b", parameters: {} }],
      } as Partial<ActionEnvelope>),
      decisionTrace: makeDecisionTrace({ actionId: "prop-2", finalDecision: "allow" }),
    });
    const proposeFn = vi.fn().mockResolvedValueOnce(r1).mockResolvedValueOnce(r2);
    const ctx = makeSharedContext();
    const result = await proposePlan(
      makePipeline(proposeFn),
      ctx,
      makePlan({ strategy: "sequential" }),
      [
        { actionType: "a", parameters: {}, principalId: "u", cartridgeId: "c" },
        { actionType: "b", parameters: {}, principalId: "u", cartridgeId: "c" },
      ],
      noopExecute,
    );
    expect(["deny", "partial"]).toContain(result.planDecision);
    expect(ctx.storage.envelopes.update).toHaveBeenCalledWith("env-b", { status: "denied" });
  });
});

// ---------------------------------------------------------------------------
// proposePlan — single_approval consolidation
// ---------------------------------------------------------------------------

describe("proposePlan — single_approval consolidation", () => {
  it("consolidates pending approvals into a single plan approval", async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3600000);
    const apprReq1 = makeApprovalRequest({
      id: "appr-1",
      approvers: ["approver-A"],
      summary: "Pay 100",
      createdAt: now,
      expiresAt,
      riskCategory: "medium",
    });
    const apprReq2 = makeApprovalRequest({
      id: "appr-2",
      approvers: ["approver-B"],
      summary: "Pay 200",
      createdAt: now,
      expiresAt,
      riskCategory: "high",
    });
    const r1 = makeProposeResult({
      envelope: makeEnvelope({ id: "env-a" }),
      decisionTrace: makeDecisionTrace({
        computedRiskScore: { rawScore: 30, category: "medium", factors: [] },
      }),
      approvalRequest: apprReq1,
    });
    const r2 = makeProposeResult({
      envelope: makeEnvelope({ id: "env-b" }),
      decisionTrace: makeDecisionTrace({
        computedRiskScore: { rawScore: 50, category: "high", factors: [] },
      }),
      approvalRequest: apprReq2,
    });
    const proposeFn = vi.fn().mockResolvedValueOnce(r1).mockResolvedValueOnce(r2);
    const ctx = makeSharedContext();
    const plan = makePlan({ strategy: "best_effort", approvalMode: "single_approval" });
    const result = await proposePlan(
      makePipeline(proposeFn),
      ctx,
      plan,
      [
        {
          actionType: "a",
          parameters: {},
          principalId: "u",
          cartridgeId: "c",
          organizationId: "org-1",
        },
        {
          actionType: "b",
          parameters: {},
          principalId: "u",
          cartridgeId: "c",
          organizationId: "org-1",
        },
      ],
      noopExecute,
    );
    expect(result.planApprovalRequest).toBeDefined();
    expect(result.planEnvelope).toBeDefined();
    const planAppr = result.planApprovalRequest!;
    expect(planAppr.approvers).toContain("approver-A");
    expect(planAppr.approvers).toContain("approver-B");
    expect(planAppr.summary).toContain("Pay 100");
    expect(planAppr.summary).toContain("Pay 200");
    expect(planAppr.riskCategory).toBe("high");
    expect(result.results[0]!.approvalRequest).toBeNull();
    expect(result.results[1]!.approvalRequest).toBeNull();
    expect(ctx.storage.envelopes.update).toHaveBeenCalledWith("env-a", { status: "queued" });
    expect(ctx.storage.envelopes.update).toHaveBeenCalledWith("env-b", { status: "queued" });
    expect(ctx.storage.envelopes.save).toHaveBeenCalled();
    expect(ctx.storage.approvals.save).toHaveBeenCalled();
  });

  it("sends notification when approvalNotifier is present", async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3600000);
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const ctx = makeSharedContext({ approvalNotifier: notifier });
    const apprReq = makeApprovalRequest({ createdAt: now, expiresAt });
    const r1 = makeProposeResult({
      envelope: makeEnvelope({ id: "env-a" }),
      decisionTrace: makeDecisionTrace({
        computedRiskScore: { rawScore: 10, category: "low", factors: [] },
      }),
      approvalRequest: apprReq,
    });
    const plan = makePlan({ strategy: "best_effort", approvalMode: "single_approval" });
    await proposePlan(
      makePipeline(vi.fn().mockResolvedValueOnce(r1)),
      ctx,
      plan,
      [{ actionType: "a", parameters: {}, principalId: "u", cartridgeId: "c" }],
      noopExecute,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(notifier.notify).toHaveBeenCalled();
  });

  it("does not consolidate when plan decision is deny", async () => {
    const r1 = makeProposeResult({
      envelope: makeEnvelope({ id: "env-a", status: "denied" }),
      decisionTrace: makeDecisionTrace({ finalDecision: "deny" }),
      denied: true,
    });
    const r2 = makeProposeResult({
      envelope: makeEnvelope({ id: "env-b", status: "denied" }),
      decisionTrace: makeDecisionTrace({ finalDecision: "deny" }),
      denied: true,
    });
    const proposeFn = vi.fn().mockResolvedValueOnce(r1).mockResolvedValueOnce(r2);
    const result = await proposePlan(
      makePipeline(proposeFn),
      makeSharedContext(),
      makePlan({ strategy: "best_effort", approvalMode: "single_approval" }),
      [
        { actionType: "a", parameters: {}, principalId: "u", cartridgeId: "c" },
        { actionType: "b", parameters: {}, principalId: "u", cartridgeId: "c" },
      ],
      noopExecute,
    );
    expect(result.planDecision).toBe("deny");
    expect(result.planApprovalRequest).toBeUndefined();
  });

  it("returns results without consolidation when approvalMode is per_action", async () => {
    const now = new Date();
    const apprReq = makeApprovalRequest({
      createdAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
    });
    const r1 = makeProposeResult({
      envelope: makeEnvelope({ id: "env-a" }),
      approvalRequest: apprReq,
    });
    const result = await proposePlan(
      makePipeline(vi.fn().mockResolvedValueOnce(r1)),
      makeSharedContext(),
      makePlan({ strategy: "best_effort", approvalMode: "per_action" }),
      [{ actionType: "a", parameters: {}, principalId: "u", cartridgeId: "c" }],
      noopExecute,
    );
    expect(result.planApprovalRequest).toBeUndefined();
    expect(result.results[0]!.approvalRequest).toBeDefined();
  });

  it("skips consolidation when no proposals have pending approvals", async () => {
    const r1 = makeProposeResult({
      envelope: makeEnvelope({ id: "env-a" }),
      decisionTrace: makeDecisionTrace({ finalDecision: "allow" }),
    });
    const result = await proposePlan(
      makePipeline(vi.fn().mockResolvedValueOnce(r1)),
      makeSharedContext(),
      makePlan({ strategy: "best_effort", approvalMode: "single_approval" }),
      [{ actionType: "a", parameters: {}, principalId: "u", cartridgeId: "c" }],
      noopExecute,
    );
    expect(result.planApprovalRequest).toBeUndefined();
    expect(result.planDecision).toBe("allow");
  });
});
