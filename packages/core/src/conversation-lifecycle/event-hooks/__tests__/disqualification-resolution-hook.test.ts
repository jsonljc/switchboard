import { describe, expect, it, vi } from "vitest";
import { DisqualificationResolutionHook } from "../disqualification-resolution-hook.js";

function setup(capabilities: ReadonlySet<"mechanical" | "qualification">) {
  const resolver = {
    confirm: vi.fn().mockResolvedValue({ result: "confirmed" }),
    dismiss: vi.fn().mockResolvedValue({ result: "dismissed", restoredStatus: "unknown" }),
  };
  const configResolver = { resolveCapabilities: vi.fn().mockResolvedValue(capabilities) };
  const hook = new DisqualificationResolutionHook({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: resolver as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configResolver: configResolver as any,
  });
  return { hook, resolver, configResolver };
}

describe("DisqualificationResolutionHook", () => {
  it("rejects confirm when qualification capability is off", async () => {
    const { hook, resolver } = setup(new Set(["mechanical"] as const));
    const out = await hook.confirm({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "capability_disabled" });
    expect(resolver.confirm).not.toHaveBeenCalled();
  });

  it("delegates confirm to resolver when capability is on", async () => {
    const { hook, resolver } = setup(new Set(["mechanical", "qualification"] as const));
    const out = await hook.confirm({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "confirmed" });
    expect(resolver.confirm).toHaveBeenCalled();
  });

  it("rejects dismiss when qualification capability is off", async () => {
    const { hook, resolver } = setup(new Set(["mechanical"] as const));
    const out = await hook.dismiss({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "capability_disabled" });
    expect(resolver.dismiss).not.toHaveBeenCalled();
  });

  it("delegates dismiss to resolver when capability is on", async () => {
    const { hook, resolver } = setup(new Set(["mechanical", "qualification"] as const));
    await hook.dismiss({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(resolver.dismiss).toHaveBeenCalled();
  });
});
