import { describe, it, expect, vi } from "vitest";
import { PipelineMode } from "../modes/pipeline-mode.js";
import type { WorkUnit } from "../work-unit.js";
import type { ExecutionContext } from "../execution-context.js";
import type { ExecutionConstraints } from "../governance-types.js";

describe("PipelineMode", () => {
  const mockSend = vi.fn().mockResolvedValue(undefined);
  const mode = new PipelineMode({ eventSender: { send: mockSend } });

  const baseWorkUnit: WorkUnit = {
    id: "work-123",
    requestedAt: "2026-04-16T12:00:00Z",
    organizationId: "org-456",
    actor: { id: "user-789", type: "user" },
    intent: "creative.produce",
    parameters: {},
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "test-skill",
      trustLevel: "guided",
      trustScore: 42,
    },
    resolvedMode: "pipeline",
    traceId: "trace-abc",
    trigger: "api",
    priority: "normal",
  };

  const baseContext: ExecutionContext = {
    traceId: "trace-abc",
    governanceDecision: {
      outcome: "execute",
      riskScore: 0.2,
      budgetProfile: "expensive",
      constraints: {} as ExecutionConstraints,
      matchedPolicies: ["default-policy"],
    },
  };

  const baseConstraints: ExecutionConstraints = {
    allowedModelTiers: ["premium"],
    maxToolCalls: 20,
    maxLlmTurns: 5,
    maxTotalTokens: 100000,
    maxRuntimeMs: 300000,
    maxWritesPerExecution: 10,
    trustLevel: "autonomous",
  };

  it("dispatches event and returns queued result", async () => {
    const result = await mode.execute(baseWorkUnit, baseConstraints, baseContext);

    expect(mockSend).toHaveBeenCalledWith({
      name: "creative-pipeline/job.submitted",
      data: {
        jobId: "work-123",
        taskId: "work-123",
        organizationId: "org-456",
        deploymentId: "org-456",
        mode: "polished",
      },
    });

    expect(result.outcome).toBe("queued");
    expect(result.jobId).toBe("work-123");
    expect(result.mode).toBe("pipeline");
  });

  it("defaults to polished mode", async () => {
    mockSend.mockClear();

    await mode.execute(baseWorkUnit, baseConstraints, baseContext);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mode: "polished" }),
      }),
    );
  });

  it("uses UGC mode when parameters.mode is ugc", async () => {
    mockSend.mockClear();

    const ugcWorkUnit = { ...baseWorkUnit, parameters: { mode: "ugc" } };

    await mode.execute(ugcWorkUnit, baseConstraints, baseContext);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mode: "ugc" }),
      }),
    );
  });

  it("includes workUnit metadata in event data", async () => {
    mockSend.mockClear();

    await mode.execute(baseWorkUnit, baseConstraints, baseContext);

    expect(mockSend).toHaveBeenCalledWith({
      name: "creative-pipeline/job.submitted",
      data: {
        jobId: "work-123",
        taskId: "work-123",
        organizationId: "org-456",
        deploymentId: "org-456",
        mode: "polished",
      },
    });
  });

  it("returns failed when dispatch throws", async () => {
    mockSend.mockRejectedValueOnce(new Error("Network error"));

    const result = await mode.execute(baseWorkUnit, baseConstraints, baseContext);

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("PIPELINE_DISPATCH_ERROR");
    expect(result.error?.message).toBe("Network error");
  });
});
