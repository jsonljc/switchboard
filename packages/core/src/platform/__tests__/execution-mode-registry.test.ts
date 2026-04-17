import { describe, it, expect, vi } from "vitest";
import { ExecutionModeRegistry } from "../execution-mode-registry.js";
import type { ExecutionMode } from "../execution-context.js";
import type { WorkUnit } from "../work-unit.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";
import type { ExecutionModeName } from "../types.js";

function makeWorkUnit(overrides?: Partial<WorkUnit>): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: new Date().toISOString(),
    organizationId: "org-1",
    actor: { id: "user-1", type: "user" },
    intent: "test.action",
    parameters: {},
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "test-skill",
      trustLevel: "guided",
      trustScore: 42,
    },
    resolvedMode: "skill",
    traceId: "trace-1",
    trigger: "api",
    priority: "normal",
    ...overrides,
  };
}

const defaultConstraints: ExecutionConstraints = {
  allowedModelTiers: ["default", "premium", "critical"],
  maxToolCalls: 5,
  maxLlmTurns: 6,
  maxTotalTokens: 64_000,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 5,
  trustLevel: "guided",
};

describe("ExecutionModeRegistry", () => {
  it("registers and dispatches to a mode", async () => {
    const registry = new ExecutionModeRegistry();
    const expectedResult: ExecutionResult = {
      workUnitId: "wu-1",
      outcome: "completed",
      summary: "test completed",
      outputs: { result: "success" },
      mode: "skill",
      durationMs: 100,
      traceId: "trace-1",
    };

    const mockExecute = vi.fn().mockResolvedValue(expectedResult);

    const skillMode: ExecutionMode = {
      name: "skill",
      execute: mockExecute,
    };

    registry.register(skillMode);

    const workUnit = makeWorkUnit();
    const context = {
      traceId: "trace-1",
      governanceDecision: {
        outcome: "execute" as const,
        riskScore: 20,
        budgetProfile: "standard",
        constraints: defaultConstraints,
        matchedPolicies: ["default"],
      },
    };

    const result = await registry.dispatch("skill", workUnit, defaultConstraints, context);

    expect(mockExecute).toHaveBeenCalledWith(workUnit, defaultConstraints, context);
    expect(result).toEqual(expectedResult);
  });

  it("throws on unknown mode", async () => {
    const registry = new ExecutionModeRegistry();

    const workUnit = makeWorkUnit({ resolvedMode: "unknown" as ExecutionModeName });
    const context = {
      traceId: "trace-1",
      governanceDecision: {
        outcome: "execute" as const,
        riskScore: 20,
        budgetProfile: "standard",
        constraints: defaultConstraints,
        matchedPolicies: ["default"],
      },
    };

    await expect(
      registry.dispatch("unknown", workUnit, defaultConstraints, context),
    ).rejects.toThrow("Unknown execution mode: unknown");
  });

  it("throws on duplicate registration", () => {
    const registry = new ExecutionModeRegistry();

    const skillMode: ExecutionMode = {
      name: "skill",
      execute: vi.fn(),
    };

    registry.register(skillMode);

    const duplicateMode: ExecutionMode = {
      name: "skill",
      execute: vi.fn(),
    };

    expect(() => registry.register(duplicateMode)).toThrow(
      "Execution mode already registered: skill",
    );
  });

  it("lists registered modes", () => {
    const registry = new ExecutionModeRegistry();

    const skillMode: ExecutionMode = {
      name: "skill",
      execute: vi.fn(),
    };

    const cartridgeMode: ExecutionMode = {
      name: "cartridge",
      execute: vi.fn(),
    };

    registry.register(skillMode);
    registry.register(cartridgeMode);

    expect(registry.listModes()).toEqual(["cartridge", "skill"]);
  });

  it("checks if a mode is registered", () => {
    const registry = new ExecutionModeRegistry();

    const pipelineMode: ExecutionMode = {
      name: "pipeline",
      execute: vi.fn(),
    };

    registry.register(pipelineMode);

    expect(registry.hasMode("pipeline")).toBe(true);
    expect(registry.hasMode("skill")).toBe(false);
  });
});
