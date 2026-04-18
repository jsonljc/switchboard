import { describe, it, expect, vi } from "vitest";
import { CartridgeMode } from "../modes/cartridge-mode.js";
import type { CartridgeModeConfig } from "../modes/cartridge-mode.js";
import type { WorkUnit } from "../work-unit.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionContext } from "../execution-context.js";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";

function makeWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: new Date().toISOString(),
    organizationId: "org-1",
    actor: { id: "user-1", type: "user" },
    intent: "digital-ads.campaign.pause",
    parameters: { campaignId: "camp-42" },
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "test-skill",
      trustLevel: "guided",
      trustScore: 42,
    },
    resolvedMode: "cartridge",
    traceId: "trace-abc",
    trigger: "chat",
    priority: "normal",
    ...overrides,
  };
}

const defaultConstraints: ExecutionConstraints = {
  allowedModelTiers: ["default"],
  maxToolCalls: 10,
  maxLlmTurns: 8,
  maxTotalTokens: 50_000,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 5,
  trustLevel: "guided",
};

const defaultContext: ExecutionContext = {
  traceId: "trace-abc",
  governanceDecision: {
    outcome: "execute",
    riskScore: 0.2,
    budgetProfile: "standard",
    constraints: defaultConstraints,
    matchedPolicies: [],
  },
};

function successResult(summary = "Campaign paused"): ExecuteResult {
  return {
    success: true,
    summary,
    externalRefs: { campaignId: "camp-42" },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: 120,
    undoRecipe: null,
  };
}

function makeConfig(
  executeFn: (
    actionType: string,
    parameters: Record<string, unknown>,
    context: Record<string, unknown>,
  ) => Promise<ExecuteResult>,
): CartridgeModeConfig {
  return {
    cartridgeRegistry: {
      get: vi.fn().mockReturnValue({
        manifest: { id: "digital-ads", actions: [] },
        execute: executeFn,
      }),
    },
  };
}

describe("CartridgeMode", () => {
  it("returns completed when cartridge.execute succeeds", async () => {
    const exec = vi.fn().mockResolvedValue(successResult());
    const mode = new CartridgeMode(makeConfig(exec));
    const result = await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(result.outcome).toBe("completed");
    expect(result.workUnitId).toBe("wu-1");
    expect(result.mode).toBe("cartridge");
    expect(result.summary).toBe("Campaign paused");
    expect(result.outputs).toEqual({
      externalRefs: { campaignId: "camp-42" },
      data: undefined,
    });
  });

  it("returns failed when cartridge.execute returns success=false", async () => {
    const exec = vi.fn().mockResolvedValue({
      ...successResult(),
      success: false,
      summary: "Policy violation",
    });
    const mode = new CartridgeMode(makeConfig(exec));
    const result = await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("CARTRIDGE_ERROR");
    expect(result.error?.message).toBe("Policy violation");
  });

  it("calls cartridge.execute with correct parameters", async () => {
    const exec = vi.fn().mockResolvedValue(successResult());
    const mode = new CartridgeMode(makeConfig(exec));
    await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(exec).toHaveBeenCalledWith(
      "digital-ads.campaign.pause",
      { campaignId: "camp-42" },
      expect.objectContaining({ principalId: "user-1", organizationId: "org-1" }),
    );
  });

  it("returns failed on cartridge error", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("Connection timeout"));
    const mode = new CartridgeMode(makeConfig(exec));
    const result = await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("CARTRIDGE_ERROR");
    expect(result.error?.message).toBe("Connection timeout");
  });

  it("returns failed when cartridge not found", async () => {
    const mode = new CartridgeMode({
      cartridgeRegistry: { get: vi.fn().mockReturnValue(null) },
    });
    const result = await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("CARTRIDGE_NOT_FOUND");
  });

  it("passes through data field from ExecuteResult", async () => {
    const resultWithData = { ...successResult(), data: { diagnostics: [1, 2] } };
    const exec = vi.fn().mockResolvedValue(resultWithData);
    const mode = new CartridgeMode(makeConfig(exec));
    const result = await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(result.outcome).toBe("completed");
    expect(result.outputs).toEqual({
      externalRefs: { campaignId: "camp-42" },
      data: { diagnostics: [1, 2] },
    });
  });

  it("does not create any ActionEnvelope", async () => {
    const exec = vi.fn().mockResolvedValue(successResult());
    const registryGet = vi.fn().mockReturnValue({
      manifest: { id: "digital-ads", actions: [] },
      execute: exec,
    });
    const mode = new CartridgeMode({ cartridgeRegistry: { get: registryGet } });
    await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(registryGet).toHaveBeenCalledWith("digital-ads");
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
