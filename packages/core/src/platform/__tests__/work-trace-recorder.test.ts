import { describe, it, expect } from "vitest";
import { buildWorkTrace } from "../work-trace-recorder.js";
import type { TraceInput } from "../work-trace-recorder.js";
import type { WorkUnit } from "../work-unit.js";
import type { GovernanceDecision } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";

const baseWorkUnit: WorkUnit = {
  id: "wu-1",
  traceId: "trace-1",
  requestedAt: "2026-04-16T10:00:00.000Z",
  organizationId: "org-1",
  actor: { id: "user-1", type: "user" },
  intent: "campaign.pause",
  parameters: { campaignId: "camp-123" },
  resolvedMode: "skill",
  trigger: "chat",
  priority: "normal",
};

const denyDecision: GovernanceDecision = {
  outcome: "deny",
  reasonCode: "BUDGET_EXCEEDED",
  riskScore: 0.9,
  matchedPolicies: ["budget-limit"],
};

const executeDecision: GovernanceDecision = {
  outcome: "execute",
  riskScore: 0.2,
  budgetProfile: "standard",
  constraints: {
    allowedModelTiers: ["default"],
    maxToolCalls: 5,
    maxLlmTurns: 3,
    maxTotalTokens: 4000,
    maxRuntimeMs: 30000,
    maxWritesPerExecution: 2,
    trustLevel: "guided",
  },
  matchedPolicies: ["default-policy"],
};

const approvalDecision: GovernanceDecision = {
  outcome: "require_approval",
  riskScore: 0.6,
  approvalLevel: "manager",
  approvers: ["mgr-1"],
  constraints: {
    allowedModelTiers: ["default"],
    maxToolCalls: 5,
    maxLlmTurns: 3,
    maxTotalTokens: 4000,
    maxRuntimeMs: 30000,
    maxWritesPerExecution: 2,
    trustLevel: "supervised",
  },
  matchedPolicies: ["approval-required"],
};

describe("buildWorkTrace", () => {
  it("builds a deny trace with failed outcome", () => {
    const input: TraceInput = {
      workUnit: baseWorkUnit,
      governanceDecision: denyDecision,
      governanceCompletedAt: "2026-04-16T10:00:01.000Z",
    };

    const trace = buildWorkTrace(input);

    expect(trace.workUnitId).toBe("wu-1");
    expect(trace.traceId).toBe("trace-1");
    expect(trace.governanceOutcome).toBe("deny");
    expect(trace.outcome).toBe("failed");
    expect(trace.riskScore).toBe(0.9);
    expect(trace.matchedPolicies).toEqual(["budget-limit"]);
    expect(trace.intent).toBe("campaign.pause");
    expect(trace.mode).toBe("skill");
  });

  it("builds a success trace from execution result", () => {
    const executionResult: ExecutionResult = {
      workUnitId: "wu-1",
      outcome: "completed",
      summary: "Campaign paused",
      outputs: { paused: true },
      mode: "skill",
      durationMs: 1200,
      traceId: "trace-1",
    };

    const input: TraceInput = {
      workUnit: baseWorkUnit,
      governanceDecision: executeDecision,
      governanceCompletedAt: "2026-04-16T10:00:01.000Z",
      executionResult,
      executionStartedAt: "2026-04-16T10:00:01.500Z",
      completedAt: "2026-04-16T10:00:02.700Z",
    };

    const trace = buildWorkTrace(input);

    expect(trace.outcome).toBe("completed");
    expect(trace.governanceOutcome).toBe("execute");
    expect(trace.durationMs).toBe(1200);
    expect(trace.executionStartedAt).toBe("2026-04-16T10:00:01.500Z");
    expect(trace.completedAt).toBe("2026-04-16T10:00:02.700Z");
  });

  it("builds a failed trace from execution result with error", () => {
    const executionResult: ExecutionResult = {
      workUnitId: "wu-1",
      outcome: "failed",
      summary: "Execution failed",
      outputs: {},
      mode: "skill",
      durationMs: 500,
      traceId: "trace-1",
      error: { code: "TIMEOUT", message: "Execution timed out" },
    };

    const input: TraceInput = {
      workUnit: baseWorkUnit,
      governanceDecision: executeDecision,
      governanceCompletedAt: "2026-04-16T10:00:01.000Z",
      executionResult,
    };

    const trace = buildWorkTrace(input);

    expect(trace.outcome).toBe("failed");
    expect(trace.error).toEqual({ code: "TIMEOUT", message: "Execution timed out" });
    expect(trace.durationMs).toBe(500);
  });

  it("builds a queued trace from execution result", () => {
    const executionResult: ExecutionResult = {
      workUnitId: "wu-1",
      outcome: "queued",
      summary: "Queued for execution",
      outputs: {},
      mode: "pipeline",
      durationMs: 0,
      traceId: "trace-1",
      jobId: "job-42",
    };

    const input: TraceInput = {
      workUnit: { ...baseWorkUnit, resolvedMode: "pipeline" },
      governanceDecision: executeDecision,
      governanceCompletedAt: "2026-04-16T10:00:01.000Z",
      executionResult,
    };

    const trace = buildWorkTrace(input);

    expect(trace.outcome).toBe("queued");
    expect(trace.mode).toBe("pipeline");
  });

  it("includes modeMetrics when provided", () => {
    const executionResult: ExecutionResult = {
      workUnitId: "wu-1",
      outcome: "completed",
      summary: "Done",
      outputs: {},
      mode: "skill",
      durationMs: 100,
      traceId: "trace-1",
    };

    const input: TraceInput = {
      workUnit: baseWorkUnit,
      governanceDecision: executeDecision,
      governanceCompletedAt: "2026-04-16T10:00:01.000Z",
      executionResult,
      modeMetrics: { llmTokens: 500, toolCalls: 3 },
    };

    const trace = buildWorkTrace(input);

    expect(trace.modeMetrics).toEqual({ llmTokens: 500, toolCalls: 3 });
  });

  it("maps all timestamp fields correctly", () => {
    const input: TraceInput = {
      workUnit: baseWorkUnit,
      governanceDecision: approvalDecision,
      governanceCompletedAt: "2026-04-16T10:00:01.000Z",
      completedAt: "2026-04-16T10:00:05.000Z",
    };

    const trace = buildWorkTrace(input);

    expect(trace.requestedAt).toBe("2026-04-16T10:00:00.000Z");
    expect(trace.governanceCompletedAt).toBe("2026-04-16T10:00:01.000Z");
    expect(trace.completedAt).toBe("2026-04-16T10:00:05.000Z");
    expect(trace.outcome).toBe("pending_approval");
    expect(trace.organizationId).toBe("org-1");
    expect(trace.actor).toEqual({ id: "user-1", type: "user" });
    expect(trace.trigger).toBe("chat");
  });
});
