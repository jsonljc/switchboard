import { describe, it, expect } from "vitest";
import { SimulationPolicyHook } from "./simulation-policy-hook.js";
import type { ToolCallContext } from "../types.js";
import type { EffectCategory } from "../governance.js";

function makeCtx(effectCategory: EffectCategory): ToolCallContext {
  return {
    toolId: "test-tool",
    operation: "test-op",
    params: {},
    effectCategory,
    trustLevel: "guided",
  };
}

describe("SimulationPolicyHook", () => {
  const hook = new SimulationPolicyHook();

  it("has name 'simulation-policy'", () => {
    expect(hook.name).toBe("simulation-policy");
  });

  it("allows read operations", async () => {
    const result = await hook.beforeToolCall!(makeCtx("read"));
    expect(result.proceed).toBe(true);
  });

  it("allows propose operations", async () => {
    const result = await hook.beforeToolCall!(makeCtx("propose"));
    expect(result.proceed).toBe(true);
  });

  it("allows simulate operations", async () => {
    const result = await hook.beforeToolCall!(makeCtx("simulate"));
    expect(result.proceed).toBe(true);
  });

  it("blocks write operations with substituteResult", async () => {
    const result = await hook.beforeToolCall!(makeCtx("write"));
    expect(result.proceed).toBe(false);
    expect(result.substituteResult).toBeDefined();
    expect(result.substituteResult!.status).toBe("success");
    expect(result.substituteResult!.data?.simulated).toBe(true);
    expect(result.substituteResult!.data?.effect_category).toBe("write");
  });

  it("blocks external_send operations", async () => {
    const result = await hook.beforeToolCall!(makeCtx("external_send"));
    expect(result.proceed).toBe(false);
    expect(result.substituteResult!.data?.simulated).toBe(true);
  });

  it("blocks external_mutation operations", async () => {
    const result = await hook.beforeToolCall!(makeCtx("external_mutation"));
    expect(result.proceed).toBe(false);
    expect(result.substituteResult!.data?.effect_category).toBe("external_mutation");
  });

  it("blocks irreversible operations", async () => {
    const result = await hook.beforeToolCall!(makeCtx("irreversible"));
    expect(result.proceed).toBe(false);
    expect(result.substituteResult!.data?.simulated).toBe(true);
  });

  it("does NOT set decision when blocking (invariant compliance)", async () => {
    const result = await hook.beforeToolCall!(makeCtx("write"));
    expect(result.decision).toBeUndefined();
  });
});
