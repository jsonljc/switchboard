import { describe, it, expect } from "vitest";
import { ModelRouter } from "../model-router.js";
import type { TierContext } from "../model-router.js";

describe("ModelRouter.resolveTier", () => {
  const router = new ModelRouter();

  function ctx(overrides: Partial<TierContext> = {}): TierContext {
    return {
      messageIndex: 5,
      toolCount: 1,
      hasHighRiskTools: false,
      previousTurnUsedTools: false,
      previousTurnEscalated: false,
      modelFloor: undefined,
      ...overrides,
    };
  }

  it("Rule 1: first message → default", () => {
    expect(router.resolveTier(ctx({ messageIndex: 0 }))).toBe("default");
  });

  it("Rule 2: no tools → default", () => {
    expect(router.resolveTier(ctx({ toolCount: 0 }))).toBe("default");
  });

  it("Rule 3: previous turn escalated → critical", () => {
    expect(router.resolveTier(ctx({ previousTurnEscalated: true }))).toBe("critical");
  });

  it("Rule 4: previous turn used tools → premium", () => {
    expect(router.resolveTier(ctx({ previousTurnUsedTools: true }))).toBe("premium");
  });

  it("Rule 5: has high risk tools → premium", () => {
    expect(router.resolveTier(ctx({ hasHighRiskTools: true }))).toBe("premium");
  });

  it("Rule 6: default for everything else", () => {
    expect(router.resolveTier(ctx())).toBe("default");
  });

  it("modelFloor overrides when resolved tier is lower", () => {
    expect(router.resolveTier(ctx({ messageIndex: 0, modelFloor: "premium" }))).toBe("premium");
  });

  it("modelFloor does not downgrade", () => {
    expect(router.resolveTier(ctx({ previousTurnEscalated: true, modelFloor: "default" }))).toBe(
      "critical",
    );
  });

  it("resolve('critical') returns opus config", () => {
    const config = router.resolve("critical");
    expect(config.modelId).toBe("claude-opus-4-6");
    expect(config.maxTokens).toBe(4096);
    expect(config.temperature).toBe(0.3);
  });
});
