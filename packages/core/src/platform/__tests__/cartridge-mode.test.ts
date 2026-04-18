import { describe, it, expect, vi } from "vitest";
import { CartridgeMode } from "../modes/cartridge-mode.js";
import type { CartridgeOrchestrator, CartridgeModeConfig } from "../modes/cartridge-mode.js";
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

function failureResult(summary = "Cartridge failed"): ExecuteResult {
  return {
    success: false,
    summary,
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [{ step: "execute", error: summary }],
    durationMs: 50,
    undoRecipe: null,
  };
}

function makeConfig(
  executeFn: CartridgeOrchestrator["executePreApproved"],
  lookupResult?: { executor: { actionId: string } },
): CartridgeModeConfig {
  return {
    orchestrator: { executePreApproved: executeFn },
    intentRegistry: {
      lookup: vi.fn().mockReturnValue(
        lookupResult ?? {
          executor: { actionId: "digital-ads.campaign.pause" },
        },
      ),
    },
  };
}

describe("CartridgeMode", () => {
  it("returns completed when executePreApproved succeeds", async () => {
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

  it("returns failed when executePreApproved returns success=false", async () => {
    const exec = vi.fn().mockResolvedValue(failureResult("Policy violation"));
    const mode = new CartridgeMode(makeConfig(exec));
    const result = await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("CARTRIDGE_ERROR");
    expect(result.error?.message).toBe("Policy violation");
  });

  it("maps workUnit fields correctly to executePreApproved params", async () => {
    const exec = vi.fn().mockResolvedValue(successResult());
    const mode = new CartridgeMode(makeConfig(exec));
    const workUnit = makeWorkUnit({
      idempotencyKey: "idem-1",
    });
    await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(exec).toHaveBeenCalledWith({
      actionType: "digital-ads.campaign.pause",
      parameters: { campaignId: "camp-42" },
      principalId: "user-1",
      organizationId: "org-1",
      cartridgeId: "digital-ads",
      traceId: "trace-abc",
      idempotencyKey: "idem-1",
      workUnitId: "wu-1",
    });
  });

  it("returns failed on orchestrator error", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("Connection timeout"));
    const mode = new CartridgeMode(makeConfig(exec));
    const result = await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("CARTRIDGE_ERROR");
    expect(result.error?.message).toBe("Connection timeout");
  });

  it("passes null organizationId when workUnit has none", async () => {
    const exec = vi.fn().mockResolvedValue(successResult());
    const mode = new CartridgeMode(makeConfig(exec));
    const workUnit = makeWorkUnit({ organizationId: undefined });
    await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(exec).toHaveBeenCalledWith(expect.objectContaining({ organizationId: null }));
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
});
