import { describe, it, expect, vi } from "vitest";
import { SessionGatewayInflightRegistry } from "../session-gateway-inflight.js";

describe("SessionGatewayInflightRegistry", () => {
  it("abortInvocation aborts the active controller and clears the slot", () => {
    const r = new SessionGatewayInflightRegistry();
    const ac = r.beginInvocation("sess-1");
    const listener = vi.fn();
    ac.signal.addEventListener("abort", listener);
    r.abortInvocation("sess-1");
    expect(listener).toHaveBeenCalled();
    const ac2 = r.beginInvocation("sess-1");
    expect(ac2).not.toBe(ac);
  });

  it("endInvocation only clears matching controller", () => {
    const r = new SessionGatewayInflightRegistry();
    const ac = r.beginInvocation("sess-1");
    r.endInvocation("sess-1", ac);
    const ac2 = r.beginInvocation("sess-1");
    expect(ac2.signal.aborted).toBe(false);
  });
});
