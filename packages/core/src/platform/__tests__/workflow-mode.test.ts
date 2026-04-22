import { describe, expect, it, vi } from "vitest";
import type { ExecutionConstraints } from "../governance-types.js";
import type { WorkUnit } from "../work-unit.js";
import { WorkflowMode } from "../modes/workflow-mode.js";

const constraints: ExecutionConstraints = {
  allowedModelTiers: ["default"],
  maxToolCalls: 5,
  maxLlmTurns: 3,
  maxTotalTokens: 4000,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 5,
  trustLevel: "guided",
};

function makeWorkUnit(intent: string): WorkUnit {
  return {
    id: "wu_1",
    requestedAt: new Date().toISOString(),
    organizationId: "org_1",
    actor: { id: "principal_1", type: "user" },
    intent,
    parameters: { jobId: "job_1" },
    deployment: {
      deploymentId: "dep_1",
      skillSlug: "creative",
      trustLevel: "guided",
      trustScore: 42,
    },
    resolvedMode: "workflow",
    traceId: "trace_1",
    trigger: "api",
    priority: "normal",
  };
}

describe("WorkflowMode", () => {
  it("dispatches to the registered handler", async () => {
    const execute = vi.fn().mockResolvedValue({
      outcome: "queued",
      summary: "Creative job submitted",
      outputs: { jobId: "job_1" },
    });

    const mode = new WorkflowMode({
      handlers: new Map([["creative.job.submit", { execute }]]),
      services: {
        submitChildWork: vi.fn(),
      },
    });

    const result = await mode.execute(makeWorkUnit("creative.job.submit"), constraints, {
      traceId: "trace_1",
      governanceDecision: {
        outcome: "execute",
        riskScore: 0.2,
        budgetProfile: "standard",
        constraints,
        matchedPolicies: [],
      },
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(result.outcome).toBe("queued");
    expect(result.outputs.jobId).toBe("job_1");
  });

  it("passes services to the handler", async () => {
    const submitChildWork = vi.fn();
    const execute = vi.fn().mockImplementation(async (_wu, services) => {
      await services.submitChildWork({ intent: "child.intent" });
      return { outcome: "completed", summary: "done", outputs: {} };
    });

    const mode = new WorkflowMode({
      handlers: new Map([["parent.intent", { execute }]]),
      services: { submitChildWork },
    });

    await mode.execute(makeWorkUnit("parent.intent"), constraints, {
      traceId: "trace_1",
      governanceDecision: {
        outcome: "execute",
        riskScore: 0.1,
        budgetProfile: "standard",
        constraints,
        matchedPolicies: [],
      },
    });

    expect(submitChildWork).toHaveBeenCalledWith({ intent: "child.intent" });
  });

  it("returns a failed execution result when no handler is registered", async () => {
    const mode = new WorkflowMode({
      handlers: new Map(),
      services: { submitChildWork: vi.fn() },
    });

    const result = await mode.execute(makeWorkUnit("missing.intent"), constraints, {
      traceId: "trace_1",
      governanceDecision: {
        outcome: "execute",
        riskScore: 0.2,
        budgetProfile: "standard",
        constraints,
        matchedPolicies: [],
      },
    });

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("WORKFLOW_NOT_REGISTERED");
  });
});
