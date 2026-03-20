import { describe, it, expect, vi } from "vitest";
import { ActionExecutor } from "../action-executor.js";
import { PolicyBridge } from "../policy-bridge.js";

describe("ActionExecutor", () => {
  it("executes a registered action handler", async () => {
    const executor = new ActionExecutor();
    const handler = vi.fn().mockResolvedValue({ success: true, result: { bookingId: "b1" } });
    executor.register("customer-engagement.appointment.book", handler);

    const bridge = new PolicyBridge(null);
    const result = await executor.execute(
      { actionType: "customer-engagement.appointment.book", parameters: { contactId: "c1" } },
      { organizationId: "org-1" },
      bridge,
    );

    expect(result.success).toBe(true);
    expect(result.blockedByPolicy).toBe(false);
    expect(result.result).toEqual({ bookingId: "b1" });
    expect(handler).toHaveBeenCalledWith({ contactId: "c1" }, { organizationId: "org-1" });
  });

  it("blocks action when policy denies", async () => {
    const executor = new ActionExecutor();
    executor.register("digital-ads.conversion.send", vi.fn());

    const bridge = new PolicyBridge({
      evaluate: vi.fn().mockResolvedValue({ effect: "deny", reason: "no consent" }),
    });

    const result = await executor.execute(
      { actionType: "digital-ads.conversion.send", parameters: {} },
      { organizationId: "org-1" },
      bridge,
    );

    expect(result.success).toBe(false);
    expect(result.blockedByPolicy).toBe(true);
    expect(result.error).toBe("no consent");
  });

  it("returns error for unregistered action type", async () => {
    const executor = new ActionExecutor();
    const bridge = new PolicyBridge(null);

    const result = await executor.execute(
      { actionType: "unknown.action", parameters: {} },
      { organizationId: "org-1" },
      bridge,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("No handler registered");
  });

  it("catches and reports handler errors", async () => {
    const executor = new ActionExecutor();
    executor.register("crm.activity.log", vi.fn().mockRejectedValue(new Error("CRM offline")));

    const bridge = new PolicyBridge(null);
    const result = await executor.execute(
      { actionType: "crm.activity.log", parameters: {} },
      { organizationId: "org-1" },
      bridge,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("CRM offline");
  });

  it("lists registered action types", () => {
    const executor = new ActionExecutor();
    executor.register("a.b", vi.fn());
    executor.register("c.d", vi.fn());

    expect(executor.listRegistered().sort()).toEqual(["a.b", "c.d"]);
  });
});
