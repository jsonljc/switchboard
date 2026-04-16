import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutionManager } from "../execution-manager.js";
import { makeSharedContext, makeExecuteResult } from "./helpers.js";
import type { SharedContext } from "../shared-context.js";
import type { ActionEnvelope } from "@switchboard/schemas";

describe("ExecutionManager.executePreApproved", () => {
  let ctx: SharedContext;
  let manager: ExecutionManager;
  let savedEnvelope: ActionEnvelope | undefined;

  beforeEach(() => {
    savedEnvelope = undefined;
    ctx = makeSharedContext();

    // Capture the envelope when save is called, then make getById return it
    vi.mocked(ctx.storage.envelopes.save).mockImplementation(async (env: ActionEnvelope) => {
      savedEnvelope = env;
    });

    vi.mocked(ctx.storage.envelopes.getById).mockImplementation(async (id: string) => {
      if (savedEnvelope && savedEnvelope.id === id) {
        return savedEnvelope;
      }
      return undefined;
    });

    // Register a cartridge so executeApproved can find it
    vi.mocked(ctx.storage.cartridges.list).mockReturnValue(["test-cartridge"]);
    vi.mocked(ctx.storage.cartridges.get).mockReturnValue({
      manifest: { id: "test-cartridge", name: "Test", version: "1.0.0", actions: [] },
      getGuardrails: () => ({ rateLimits: [], cooldowns: [], forbiddenBehaviors: [] }),
      execute: vi.fn().mockResolvedValue(makeExecuteResult()),
    } as unknown as ReturnType<typeof ctx.storage.cartridges.get>);

    manager = new ExecutionManager(ctx);
  });

  const baseParams = {
    actionType: "test.action",
    parameters: { foo: "bar" },
    principalId: "user-1",
    organizationId: "org-1" as string | null,
    cartridgeId: "test-cartridge",
    traceId: "trace-123",
  };

  it("creates an envelope with status 'approved'", async () => {
    await manager.executePreApproved(baseParams);

    expect(savedEnvelope).toBeDefined();
    expect(savedEnvelope!.status).toBe("approved");
  });

  it("creates an envelope with a pre-approved decision trace", async () => {
    await manager.executePreApproved(baseParams);

    expect(savedEnvelope!.decisions).toHaveLength(1);
    const decision = savedEnvelope!.decisions[0];
    expect(decision.finalDecision).toBe("allow");
    expect(decision.approvalRequired).toBe("none");
    expect(decision.explanation).toBe("Pre-approved by platform governance");
    expect(decision.checks).toEqual([]);
    expect(decision.computedRiskScore.rawScore).toBe(0);
    expect(decision.computedRiskScore.category).toBe("none");
  });

  it("persists the envelope before execution", async () => {
    const saveOrder: string[] = [];

    vi.mocked(ctx.storage.envelopes.save).mockImplementation(async (env: ActionEnvelope) => {
      savedEnvelope = env;
      saveOrder.push("save");
    });

    const originalUpdate = vi.mocked(ctx.storage.envelopes.update);
    originalUpdate.mockImplementation(async () => {
      saveOrder.push("update");
    });

    await manager.executePreApproved(baseParams);

    // save must come before the first update (which is executeApproved setting status to "executing")
    expect(saveOrder[0]).toBe("save");
    expect(saveOrder.length).toBeGreaterThanOrEqual(2);
  });

  it("calls executeApproved with the new envelope ID", async () => {
    const executeApprovedSpy = vi.spyOn(manager, "executeApproved");

    await manager.executePreApproved(baseParams);

    expect(executeApprovedSpy).toHaveBeenCalledWith(savedEnvelope!.id);
  });

  it("does NOT call the policy engine evaluate()", async () => {
    // The policy engine is not directly on ExecutionManager — the point is
    // that no governance evaluation happens. We verify this by confirming
    // the decision trace is synthetic (pre-approved) with no checks.
    await manager.executePreApproved(baseParams);

    const decision = savedEnvelope!.decisions[0];
    expect(decision.checks).toEqual([]);
    expect(decision.explanation).toBe("Pre-approved by platform governance");
  });

  it("sets proposal parameters with _principalId, _cartridgeId, _organizationId", async () => {
    await manager.executePreApproved(baseParams);

    const proposal = savedEnvelope!.proposals[0];
    expect(proposal.parameters["_principalId"]).toBe("user-1");
    expect(proposal.parameters["_cartridgeId"]).toBe("test-cartridge");
    expect(proposal.parameters["_organizationId"]).toBe("org-1");
    expect(proposal.parameters["foo"]).toBe("bar");
  });

  it("sets traceId from params", async () => {
    await manager.executePreApproved(baseParams);

    expect(savedEnvelope!.traceId).toBe("trace-123");
  });

  it("returns the execution result from executeApproved", async () => {
    const result = await manager.executePreApproved(baseParams);

    expect(result.success).toBe(true);
    expect(result.summary).toBe("executed");
  });

  it("handles null organizationId", async () => {
    await manager.executePreApproved({ ...baseParams, organizationId: null });

    const proposal = savedEnvelope!.proposals[0];
    expect(proposal.parameters["_organizationId"]).toBeNull();
  });
});
