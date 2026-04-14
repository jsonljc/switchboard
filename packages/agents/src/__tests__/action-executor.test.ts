import { describe, it, expect, vi } from "vitest";
import { ActionExecutor } from "../action-executor.js";
import { PolicyBridge } from "../policy-bridge.js";
import { IdempotencyGuard, InMemoryIdempotencyStore } from "@switchboard/core";

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

describe("idempotency", () => {
  it("returns cached result for duplicate write action", async () => {
    const store = new InMemoryIdempotencyStore();
    const guard = new IdempotencyGuard({ store });
    const writeActions = new Set(["payments.charge.create"]);
    const executor = new ActionExecutor({ idempotencyGuard: guard, writeActions });

    const handler = vi.fn().mockResolvedValue({ success: true, result: { chargeId: "ch-1" } });
    executor.register("payments.charge.create", handler);

    const bridge = new PolicyBridge(null);
    const action = { actionType: "payments.charge.create", parameters: { amount: 100 } };
    const ctx = { organizationId: "org-1" };

    const result1 = await executor.execute(action, ctx, bridge);
    const result2 = await executor.execute(action, ctx, bridge);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result2.result).toEqual(result1.result);
    expect(handler).toHaveBeenCalledTimes(1); // Only executed once
  });

  it("does not apply idempotency to read actions", async () => {
    const store = new InMemoryIdempotencyStore();
    const guard = new IdempotencyGuard({ store });
    const writeActions = new Set(["payments.charge.create"]);
    const executor = new ActionExecutor({ idempotencyGuard: guard, writeActions });

    const handler = vi.fn().mockResolvedValue({ success: true, result: { contacts: [] } });
    executor.register("crm.contact.search", handler);

    const bridge = new PolicyBridge(null);
    const action = { actionType: "crm.contact.search", parameters: { q: "test" } };
    const ctx = { organizationId: "org-1" };

    await executor.execute(action, ctx, bridge);
    await executor.execute(action, ctx, bridge);

    expect(handler).toHaveBeenCalledTimes(2); // No dedup for reads
  });

  it("works without idempotency guard (backwards compatible)", async () => {
    const executor = new ActionExecutor();
    const handler = vi.fn().mockResolvedValue({ success: true });
    executor.register("test.action", handler);

    const bridge = new PolicyBridge(null);
    const result = await executor.execute(
      { actionType: "test.action", parameters: {} },
      { organizationId: "org-1" },
      bridge,
    );

    expect(result.success).toBe(true);
  });
});
