import { describe, it, expect, vi } from "vitest";
import { CartridgeMode } from "../modes/cartridge-mode.js";
import type { CartridgeOrchestrator, CartridgeModeConfig } from "../modes/cartridge-mode.js";
import type { WorkUnit } from "../work-unit.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionContext } from "../execution-context.js";

function makeWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: new Date().toISOString(),
    organizationId: "org-1",
    actor: { id: "user-1", type: "user" },
    intent: "digital-ads.campaign.pause",
    parameters: { campaignId: "camp-42" },
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

function makeConfig(
  proposeFn: CartridgeOrchestrator["propose"],
  lookupResult?: { executor: { actionId: string } },
): CartridgeModeConfig {
  return {
    orchestrator: { propose: proposeFn },
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
  it("returns completed when orchestrator allows", async () => {
    const propose = vi.fn().mockResolvedValue({
      envelope: { id: "env-1", status: "executed" },
      approvalRequest: null,
      denied: false,
      explanation: "Campaign paused",
    });
    const mode = new CartridgeMode(makeConfig(propose));
    const result = await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(result.outcome).toBe("completed");
    expect(result.workUnitId).toBe("wu-1");
    expect(result.mode).toBe("cartridge");
    expect(result.summary).toBe("Campaign paused");
    expect(result.outputs).toEqual({ envelopeId: "env-1" });
  });

  it("returns pending_approval when approval requested", async () => {
    const propose = vi.fn().mockResolvedValue({
      envelope: { id: "env-2", status: "pending" },
      approvalRequest: { approvers: ["mgr-1"] },
      denied: false,
      explanation: "Needs manager approval",
    });
    const mode = new CartridgeMode(makeConfig(propose));
    const result = await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(result.outcome).toBe("pending_approval");
    expect(result.approvalId).toBe("env-2");
    expect(result.summary).toBe("Needs manager approval");
  });

  it("returns failed when denied", async () => {
    const propose = vi.fn().mockResolvedValue({
      envelope: { id: "env-3", status: "denied" },
      approvalRequest: null,
      denied: true,
      explanation: "Policy violation",
    });
    const mode = new CartridgeMode(makeConfig(propose));
    const result = await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("DENIED");
    expect(result.error?.message).toBe("Policy violation");
  });

  it("maps workUnit fields correctly to propose params", async () => {
    const propose = vi.fn().mockResolvedValue({
      envelope: { id: "env-4", status: "executed" },
      approvalRequest: null,
      denied: false,
      explanation: "OK",
    });
    const mode = new CartridgeMode(makeConfig(propose));
    const workUnit = makeWorkUnit({
      idempotencyKey: "idem-1",
    });
    await mode.execute(workUnit, defaultConstraints, defaultContext);

    expect(propose).toHaveBeenCalledWith({
      actionType: "digital-ads.campaign.pause",
      parameters: { campaignId: "camp-42" },
      principalId: "user-1",
      organizationId: "org-1",
      cartridgeId: "digital-ads",
      traceId: "trace-abc",
      idempotencyKey: "idem-1",
    });
  });

  it("returns failed on orchestrator error", async () => {
    const propose = vi.fn().mockRejectedValue(new Error("Connection timeout"));
    const mode = new CartridgeMode(makeConfig(propose));
    const result = await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("CARTRIDGE_ERROR");
    expect(result.error?.message).toBe("Connection timeout");
  });
});
