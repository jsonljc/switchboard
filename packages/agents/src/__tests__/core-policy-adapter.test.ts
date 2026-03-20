import { describe, it, expect, vi } from "vitest";
import { CorePolicyEngineAdapter } from "../core-policy-adapter.js";
import type { DeliveryIntent } from "../policy-bridge.js";

const makeIntent = (overrides: Partial<DeliveryIntent> = {}): DeliveryIntent => ({
  eventId: "evt-1",
  destinationType: "agent",
  destinationId: "lead-responder",
  action: "lead.received",
  payload: { contactId: "c1" },
  criticality: "required",
  ...overrides,
});

describe("CorePolicyEngineAdapter", () => {
  it("returns allow when core engine returns finalDecision=allow", async () => {
    const coreEvaluate = vi.fn().mockReturnValue({
      finalDecision: "allow",
      approvalRequired: "none",
      explanation: "All checks passed",
    });

    const adapter = new CorePolicyEngineAdapter({
      evaluate: coreEvaluate,
      organizationId: "org-1",
    });

    const result = await adapter.evaluate(makeIntent());
    expect(result.effect).toBe("allow");
    expect(coreEvaluate).toHaveBeenCalledOnce();
  });

  it("returns deny with reason when core engine returns finalDecision=deny", async () => {
    const coreEvaluate = vi.fn().mockReturnValue({
      finalDecision: "deny",
      approvalRequired: "none",
      explanation: "Forbidden behavior",
    });

    const adapter = new CorePolicyEngineAdapter({
      evaluate: coreEvaluate,
      organizationId: "org-1",
    });

    const result = await adapter.evaluate(makeIntent());
    expect(result.effect).toBe("deny");
    expect(result.reason).toBe("Forbidden behavior");
  });

  it("returns require_approval when approvalRequired is not none", async () => {
    const coreEvaluate = vi.fn().mockReturnValue({
      finalDecision: "allow",
      approvalRequired: "standard",
      explanation: "Needs approval",
    });

    const adapter = new CorePolicyEngineAdapter({
      evaluate: coreEvaluate,
      organizationId: "org-1",
    });

    const result = await adapter.evaluate(makeIntent());
    expect(result.effect).toBe("require_approval");
    expect(result.reason).toBe("Needs approval");
  });

  it("returns deny when core engine throws (fail-closed)", async () => {
    const coreEvaluate = vi.fn().mockImplementation(() => {
      throw new Error("engine crash");
    });

    const adapter = new CorePolicyEngineAdapter({
      evaluate: coreEvaluate,
      organizationId: "org-1",
    });

    const result = await adapter.evaluate(makeIntent());
    expect(result.effect).toBe("deny");
    expect(result.reason).toContain("engine crash");
  });

  it("maps DeliveryIntent fields to ActionProposal correctly", async () => {
    const coreEvaluate = vi.fn().mockReturnValue({
      finalDecision: "allow",
      approvalRequired: "none",
      explanation: "ok",
    });

    const adapter = new CorePolicyEngineAdapter({
      evaluate: coreEvaluate,
      organizationId: "org-1",
    });

    const intent = makeIntent({
      action: "lead.received",
      payload: { contactId: "c1" },
    });
    await adapter.evaluate(intent);

    const [proposal, evalCtx] = coreEvaluate.mock.calls[0]!;
    expect(proposal.actionType).toBe("lead.received");
    expect(proposal.parameters).toEqual({ contactId: "c1" });
    expect(proposal.originatingMessageId).toBe("evt-1");
    expect(evalCtx.organizationId).toBe("org-1");
  });

  it("treats finalDecision=modify as allow", async () => {
    const coreEvaluate = vi.fn().mockReturnValue({
      finalDecision: "modify",
      approvalRequired: "none",
      explanation: "Parameters adjusted",
    });

    const adapter = new CorePolicyEngineAdapter({
      evaluate: coreEvaluate,
      organizationId: "org-1",
    });

    const result = await adapter.evaluate(makeIntent());
    expect(result.effect).toBe("allow");
  });
});
