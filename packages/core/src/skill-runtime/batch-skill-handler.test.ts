import { describe, it, expect, vi } from "vitest";
import { BatchSkillHandler } from "./batch-skill-handler.js";
import type {
  BatchParameterBuilder,
  BatchSkillStores,
  BatchContextContract,
} from "./batch-types.js";
import type { SkillDefinition, SkillExecutor } from "./types.js";

const mockSkill: SkillDefinition = {
  name: "test-batch",
  slug: "test-batch",
  version: "1.0.0",
  description: "test",
  author: "test",
  parameters: [{ name: "DATA", type: "object", required: true }],
  tools: [],
  body: "Analyze {{DATA}}",
  context: [],
};

const mockContract: BatchContextContract = {
  required: [{ key: "data", source: "ads" }],
};

const mockStores: BatchSkillStores = {
  adsClient: { getCampaignInsights: vi.fn(), getAccountSummary: vi.fn() },
  crmDataProvider: { getFunnelData: vi.fn(), getBenchmarks: vi.fn() },
  deploymentStore: { findById: vi.fn() },
};

function makeTraceStore() {
  return { create: vi.fn().mockResolvedValue(undefined) };
}

function makeCircuitBreaker(allowed = true) {
  return {
    check: vi.fn().mockResolvedValue({ allowed, reason: allowed ? undefined : "tripped" }),
  };
}

function makeBlastRadius(allowed = true) {
  return {
    check: vi.fn().mockResolvedValue({ allowed, reason: allowed ? undefined : "capped" }),
  };
}

function makeOutcomeLinker() {
  return { linkFromToolCalls: vi.fn().mockResolvedValue(undefined) };
}

function makeExecutor(response: string) {
  return {
    execute: vi.fn().mockResolvedValue({
      response,
      toolCalls: [],
      tokenUsage: { input: 100, output: 50 },
      trace: {
        durationMs: 500,
        turnCount: 1,
        status: "success",
        responseSummary: response.slice(0, 500),
        writeCount: 0,
        governanceDecisions: [],
      },
    }),
  };
}

describe("BatchSkillHandler", () => {
  it("calls builder, executor, and returns parsed result", async () => {
    const builder: BatchParameterBuilder = vi.fn().mockResolvedValue({ DATA: { foo: "bar" } });
    const resultJson = JSON.stringify({
      recommendations: [
        { type: "scale", action: "Scale up", confidence: "high", reasoning: "CPA low" },
      ],
      proposedWrites: [],
      summary: "One rec.",
    });
    const executor = makeExecutor(resultJson);

    const handler = new BatchSkillHandler({
      skill: mockSkill,
      executor: executor as unknown as SkillExecutor,
      builder,
      stores: mockStores,
      contract: mockContract,
      tools: new Map(),
      trustLevel: "guided",
      trustScore: 50,
      traceStore: makeTraceStore(),
      circuitBreaker: makeCircuitBreaker(),
      blastRadiusLimiter: makeBlastRadius(),
      outcomeLinker: makeOutcomeLinker(),
    });

    const result = await handler.execute({
      deploymentId: "d1",
      orgId: "org1",
      trigger: "weekly_audit",
    });

    expect(builder).toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalled();
    expect(result.recommendations).toHaveLength(1);
    expect(result.summary).toBe("One rec.");
  });

  it("returns empty result when executor returns non-JSON", async () => {
    const builder: BatchParameterBuilder = vi.fn().mockResolvedValue({ DATA: {} });
    const executor = makeExecutor("I could not complete the analysis.");

    const handler = new BatchSkillHandler({
      skill: mockSkill,
      executor: executor as unknown as SkillExecutor,
      builder,
      stores: mockStores,
      contract: mockContract,
      tools: new Map(),
      trustLevel: "guided",
      trustScore: 50,
      traceStore: makeTraceStore(),
      circuitBreaker: makeCircuitBreaker(),
      blastRadiusLimiter: makeBlastRadius(),
      outcomeLinker: makeOutcomeLinker(),
    });

    const result = await handler.execute({
      deploymentId: "d1",
      orgId: "org1",
      trigger: "weekly_audit",
    });
    expect(result.recommendations).toHaveLength(0);
    expect(result.summary).toContain("could not");
  });

  it("routes auto-approved writes through tool execution", async () => {
    const mockTool = {
      id: "test-tool",
      operations: {
        "do-write": {
          description: "write",
          governanceTier: "internal_write" as const,
          inputSchema: {},
          execute: vi.fn().mockResolvedValue({ success: true }),
        },
      },
    };

    const builder: BatchParameterBuilder = vi.fn().mockResolvedValue({ DATA: {} });
    const resultJson = JSON.stringify({
      recommendations: [],
      proposedWrites: [
        {
          tool: "test-tool",
          operation: "do-write",
          params: { x: 1 },
          governanceTier: "internal_write",
        },
      ],
      summary: "One write.",
    });
    const executor = makeExecutor(resultJson);

    const handler = new BatchSkillHandler({
      skill: mockSkill,
      executor: executor as unknown as SkillExecutor,
      builder,
      stores: mockStores,
      contract: mockContract,
      tools: new Map([["test-tool", mockTool]]),
      trustLevel: "autonomous",
      trustScore: 80,
      traceStore: makeTraceStore(),
      circuitBreaker: makeCircuitBreaker(),
      blastRadiusLimiter: makeBlastRadius(),
      outcomeLinker: makeOutcomeLinker(),
    });

    const result = await handler.execute({
      deploymentId: "d1",
      orgId: "org1",
      trigger: "weekly_audit",
    });
    expect(mockTool.operations["do-write"].execute).toHaveBeenCalledWith({ x: 1 });
    expect(result.executedWrites).toBe(1);
  });

  it("skips denied writes", async () => {
    const mockTool = {
      id: "dangerous",
      operations: {
        destroy: {
          description: "destroy",
          governanceTier: "destructive" as const,
          inputSchema: {},
          execute: vi.fn(),
        },
      },
    };

    const builder: BatchParameterBuilder = vi.fn().mockResolvedValue({ DATA: {} });
    const resultJson = JSON.stringify({
      recommendations: [],
      proposedWrites: [
        { tool: "dangerous", operation: "destroy", params: {}, governanceTier: "destructive" },
      ],
      summary: "Denied write.",
    });

    const handler = new BatchSkillHandler({
      skill: mockSkill,
      executor: makeExecutor(resultJson) as unknown as SkillExecutor,
      builder,
      stores: mockStores,
      contract: mockContract,
      tools: new Map([["dangerous", mockTool]]),
      trustLevel: "supervised",
      trustScore: 10,
      traceStore: makeTraceStore(),
      circuitBreaker: makeCircuitBreaker(),
      blastRadiusLimiter: makeBlastRadius(),
      outcomeLinker: makeOutcomeLinker(),
    });

    const result = await handler.execute({
      deploymentId: "d1",
      orgId: "org1",
      trigger: "weekly_audit",
    });
    expect(mockTool.operations.destroy.execute).not.toHaveBeenCalled();
    expect(result.executedWrites).toBe(0);
    expect(result.deniedWrites).toBe(1);
  });

  it("persists batch_job trace", async () => {
    const traceStore = makeTraceStore();
    const builder: BatchParameterBuilder = vi.fn().mockResolvedValue({ DATA: {} });
    const resultJson = JSON.stringify({
      recommendations: [],
      proposedWrites: [],
      summary: "Done.",
    });

    const handler = new BatchSkillHandler({
      skill: mockSkill,
      executor: makeExecutor(resultJson) as unknown as SkillExecutor,
      builder,
      stores: mockStores,
      contract: mockContract,
      tools: new Map(),
      trustLevel: "guided",
      trustScore: 50,
      traceStore,
      circuitBreaker: makeCircuitBreaker(),
      blastRadiusLimiter: makeBlastRadius(),
      outcomeLinker: makeOutcomeLinker(),
    });

    await handler.execute({ deploymentId: "d1", orgId: "org1", trigger: "weekly_audit" });
    expect(traceStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "d1",
        trigger: "batch_job",
        skillSlug: "test-batch",
      }),
    );
  });

  it("blocks execution when circuit breaker trips", async () => {
    const executor = { execute: vi.fn() };
    const handler = new BatchSkillHandler({
      skill: mockSkill,
      executor: executor as unknown as SkillExecutor,
      builder: vi.fn(),
      stores: mockStores,
      contract: mockContract,
      tools: new Map(),
      trustLevel: "guided",
      trustScore: 50,
      traceStore: makeTraceStore(),
      circuitBreaker: makeCircuitBreaker(false),
      blastRadiusLimiter: makeBlastRadius(),
      outcomeLinker: makeOutcomeLinker(),
    });

    await expect(
      handler.execute({ deploymentId: "d1", orgId: "org1", trigger: "weekly_audit" }),
    ).rejects.toThrow("Circuit breaker");
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("blocks execution when blast radius limit reached", async () => {
    const executor = { execute: vi.fn() };
    const handler = new BatchSkillHandler({
      skill: mockSkill,
      executor: executor as unknown as SkillExecutor,
      builder: vi.fn(),
      stores: mockStores,
      contract: mockContract,
      tools: new Map(),
      trustLevel: "guided",
      trustScore: 50,
      traceStore: makeTraceStore(),
      circuitBreaker: makeCircuitBreaker(),
      blastRadiusLimiter: makeBlastRadius(false),
      outcomeLinker: makeOutcomeLinker(),
    });

    await expect(
      handler.execute({ deploymentId: "d1", orgId: "org1", trigger: "weekly_audit" }),
    ).rejects.toThrow("Blast radius");
    expect(executor.execute).not.toHaveBeenCalled();
  });
});
