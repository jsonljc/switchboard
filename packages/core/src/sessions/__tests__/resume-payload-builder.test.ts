import { describe, it, expect } from "vitest";
import { buildResumePayload } from "../resume-payload-builder.js";
import type { AgentSession, AgentPause, ToolEvent } from "@switchboard/schemas";

describe("buildResumePayload", () => {
  const baseSession: AgentSession = {
    id: "sess-1",
    organizationId: "org-1",
    roleId: "ad-operator",
    principalId: "principal-1",
    status: "paused",
    safetyEnvelope: {
      maxToolCalls: 200,
      maxMutations: 50,
      maxDollarsAtRisk: 10_000,
      sessionTimeoutMs: 30 * 60 * 1000,
    },
    toolCallCount: 5,
    mutationCount: 2,
    dollarsAtRisk: 1_000,
    currentStep: 5,
    toolHistory: [],
    checkpoint: null,
    traceId: "trace-1",
    startedAt: new Date("2026-01-01T00:00:00Z"),
    completedAt: null,
  };

  const basePause: AgentPause = {
    id: "pause-1",
    sessionId: "sess-1",
    runId: "run-1",
    pauseIndex: 0,
    approvalId: "appr-1",
    resumeStatus: "consumed",
    resumeToken: "token-1",
    checkpoint: {
      agentState: { step: 5, memory: "context" },
      pendingApprovalId: "appr-1",
    },
    approvalOutcome: {
      action: "approve",
      respondedBy: "owner-1",
    },
    createdAt: new Date("2026-01-01T00:05:00Z"),
    resumedAt: null,
  };

  it("builds complete resume payload", () => {
    const payload = buildResumePayload({
      session: baseSession,
      pause: basePause,
      toolHistory: [],
      runId: "run-2",
      instruction: "Continue managing ad campaigns.",
    });

    expect(payload.sessionId).toBe("sess-1");
    expect(payload.runId).toBe("run-2");
    expect(payload.roleId).toBe("ad-operator");
    expect(payload.checkpoint).toEqual(basePause.checkpoint);
    expect(payload.approvalOutcome).toEqual(basePause.approvalOutcome);
    expect(payload.instruction).toBe("Continue managing ad campaigns.");
  });

  it("calculates remaining safety budget correctly", () => {
    const payload = buildResumePayload({
      session: baseSession,
      pause: basePause,
      toolHistory: [],
      runId: "run-2",
      instruction: "Continue.",
    });

    expect(payload.safetyBudgetRemaining.toolCalls).toBe(195); // 200 - 5
    expect(payload.safetyBudgetRemaining.mutations).toBe(48); // 50 - 2
    expect(payload.safetyBudgetRemaining.dollarsAtRisk).toBe(9_000); // 10000 - 1000
  });

  it("includes tool history passed as parameter", () => {
    const toolEvent: ToolEvent = {
      id: "evt-1",
      sessionId: "sess-1",
      runId: "run-1",
      stepIndex: 0,
      toolName: "get_campaign_metrics",
      parameters: { campaignId: "c1" },
      result: { impressions: 1000 },
      isMutation: false,
      dollarsAtRisk: 0,
      durationMs: 150,
      envelopeId: null,
      timestamp: new Date(),
    };

    const payload = buildResumePayload({
      session: baseSession,
      pause: basePause,
      toolHistory: [toolEvent],
      runId: "run-2",
      instruction: "Continue.",
    });

    expect(payload.toolHistory).toHaveLength(1);
    expect(payload.toolHistory[0].toolName).toBe("get_campaign_metrics");
  });

  it("clamps remaining budget to zero (no negative values)", () => {
    const exhaustedSession = {
      ...baseSession,
      toolCallCount: 250,
      mutationCount: 60,
      dollarsAtRisk: 15_000,
    };

    const payload = buildResumePayload({
      session: exhaustedSession,
      pause: basePause,
      toolHistory: [],
      runId: "run-2",
      instruction: "Continue.",
    });

    expect(payload.safetyBudgetRemaining.toolCalls).toBe(0);
    expect(payload.safetyBudgetRemaining.mutations).toBe(0);
    expect(payload.safetyBudgetRemaining.dollarsAtRisk).toBe(0);
  });

  it("calculates time remaining from session start", () => {
    const payload = buildResumePayload({
      session: baseSession,
      pause: basePause,
      toolHistory: [],
      runId: "run-2",
      instruction: "Continue.",
      now: new Date("2026-01-01T00:10:00Z"), // 10 minutes after start
    });

    // 30 min timeout - 10 min elapsed = 20 min remaining
    expect(payload.safetyBudgetRemaining.timeRemainingMs).toBe(20 * 60 * 1000);
  });
});
