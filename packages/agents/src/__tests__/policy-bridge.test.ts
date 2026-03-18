import { describe, it, expect, vi } from "vitest";
import { PolicyBridge, type DeliveryIntent } from "../policy-bridge.js";

describe("PolicyBridge", () => {
  it("approves intent when policy engine allows", async () => {
    const policyEngine = {
      evaluate: vi.fn().mockResolvedValue({ effect: "allow" }),
    };
    const bridge = new PolicyBridge(policyEngine);

    const intent: DeliveryIntent = {
      eventId: "evt-1",
      destinationType: "agent",
      destinationId: "lead-responder",
      action: "lead.received",
      payload: { contactId: "c1" },
      criticality: "required",
    };

    const result = await bridge.evaluate(intent);
    expect(result.approved).toBe(true);
  });

  it("denies intent when policy engine denies", async () => {
    const policyEngine = {
      evaluate: vi.fn().mockResolvedValue({ effect: "deny", reason: "consent not active" }),
    };
    const bridge = new PolicyBridge(policyEngine);

    const intent: DeliveryIntent = {
      eventId: "evt-1",
      destinationType: "webhook",
      destinationId: "hubspot",
      action: "reminder.send",
      payload: {},
      criticality: "required",
    };

    const result = await bridge.evaluate(intent);
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("consent not active");
  });

  it("marks requires_approval when policy engine requests it", async () => {
    const policyEngine = {
      evaluate: vi.fn().mockResolvedValue({ effect: "require_approval" }),
    };
    const bridge = new PolicyBridge(policyEngine);

    const intent: DeliveryIntent = {
      eventId: "evt-1",
      destinationType: "agent",
      destinationId: "sales-closer",
      action: "appointment.book",
      payload: {},
      criticality: "required",
    };

    const result = await bridge.evaluate(intent);
    expect(result.approved).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it("approves when no policy engine is configured (permissive mode)", async () => {
    const bridge = new PolicyBridge(null);

    const intent: DeliveryIntent = {
      eventId: "evt-1",
      destinationType: "agent",
      destinationId: "lead-responder",
      action: "lead.received",
      payload: {},
      criticality: "required",
    };

    const result = await bridge.evaluate(intent);
    expect(result.approved).toBe(true);
  });
});
