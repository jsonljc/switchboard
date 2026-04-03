import { describe, it, expect, vi } from "vitest";
import { compileHandler } from "../compile-handler.js";
import { createEventEnvelope } from "@switchboard/schemas";
import type { EmployeeConfig, EmployeeContext } from "../types.js";

describe("compileHandler", () => {
  it("maps EmployeeHandlerResult to AgentResponse", async () => {
    const mockHandle = vi.fn().mockResolvedValue({
      actions: [{ type: "test.do", params: { x: 1 } }],
      events: [{ type: "test.done", payload: { result: "ok" } }],
    });

    const config = { id: "test-emp", handle: mockHandle } as unknown as EmployeeConfig;
    const mockCtx = { organizationId: "org-1" } as EmployeeContext;
    const mockCtxFactory = vi.fn().mockReturnValue(mockCtx);

    const handler = compileHandler(config, mockCtxFactory);

    const event = createEventEnvelope({
      eventType: "test.requested",
      organizationId: "org-1",
      source: { type: "manual", id: "user-1" },
      payload: {},
    });

    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.actions).toHaveLength(1);
    expect(response.actions[0]!.actionType).toBe("test.do");
    expect(response.actions[0]!.parameters).toEqual({ x: 1 });
    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("test.done");
    expect(response.events[0]!.correlationId).toBe(event.correlationId);
    expect(response.events[0]!.causationId).toBe(event.eventId);
  });

  it("passes employee context from factory", async () => {
    const mockHandle = vi.fn().mockResolvedValue({ actions: [], events: [] });
    const config = { id: "test-emp", handle: mockHandle } as unknown as EmployeeConfig;
    const mockCtx = { organizationId: "org-1", custom: true } as unknown as EmployeeContext;
    const mockCtxFactory = vi.fn().mockReturnValue(mockCtx);

    const handler = compileHandler(config, mockCtxFactory);
    const event = createEventEnvelope({
      eventType: "test.requested",
      organizationId: "org-1",
      source: { type: "manual", id: "user-1" },
      payload: {},
    });

    await handler.handle(event, {}, { organizationId: "org-1" });

    expect(mockCtxFactory).toHaveBeenCalledWith({ organizationId: "org-1" }, event);
    expect(mockHandle).toHaveBeenCalledWith(event, mockCtx);
  });
});
