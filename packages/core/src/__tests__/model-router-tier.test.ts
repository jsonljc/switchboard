import { describe, it, expect } from "vitest";
import { ModelRouter } from "../model-router.js";
import type { TierContext } from "../model-router.js";

describe("ModelRouter.resolveTier", () => {
  const router = new ModelRouter();

  function ctx(overrides: Partial<TierContext> = {}): TierContext {
    return {
      conversationDepth: 5,
      toolCount: 1,
      previousTurnUsedTools: false,
      previousTurnEscalated: false,
      modelFloor: undefined,
      ...overrides,
    };
  }

  it("routes a first-contact greeting to default (Haiku)", () => {
    expect(router.resolveTier(ctx({ conversationDepth: 1, toolCount: 4 }))).toBe("default");
  });

  it("routes a deep engaged tool-bearing turn to premium (Sonnet), NOT default", () => {
    expect(router.resolveTier(ctx({ conversationDepth: 6, toolCount: 4 }))).toBe("premium");
  });

  it("a tool-less skill stays default even when deep", () => {
    expect(router.resolveTier(ctx({ conversationDepth: 6, toolCount: 0 }))).toBe("default");
  });

  it("escalation raises to critical at any depth", () => {
    expect(
      router.resolveTier(ctx({ conversationDepth: 6, toolCount: 4, previousTurnEscalated: true })),
    ).toBe("critical");
  });

  it("escalation raises a first-contact greeting to critical", () => {
    expect(
      router.resolveTier(ctx({ conversationDepth: 1, toolCount: 4, previousTurnEscalated: true })),
    ).toBe("critical");
  });

  it("previous turn used tools → premium", () => {
    expect(
      router.resolveTier(ctx({ conversationDepth: 1, toolCount: 4, previousTurnUsedTools: true })),
    ).toBe("premium");
  });

  it("modelFloor overrides when resolved tier is lower", () => {
    expect(router.resolveTier(ctx({ conversationDepth: 1, modelFloor: "premium" }))).toBe(
      "premium",
    );
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

  it("Stage: objection raises a tool-less turn to premium", () => {
    expect(
      router.resolveTier(ctx({ conversationDepth: 1, toolCount: 0, currentStage: "objection" })),
    ).toBe("premium");
  });

  it("Stage: closing raises a tool-less turn to premium", () => {
    expect(
      router.resolveTier(ctx({ conversationDepth: 1, toolCount: 0, currentStage: "closing" })),
    ).toBe("premium");
  });

  it("Stage: fear raises to critical", () => {
    expect(
      router.resolveTier(ctx({ conversationDepth: 1, toolCount: 0, currentStage: "fear" })),
    ).toBe("critical");
  });

  it("fear raises even a first-contact greeting to critical", () => {
    expect(
      router.resolveTier(ctx({ conversationDepth: 1, toolCount: 4, currentStage: "fear" })),
    ).toBe("critical");
  });

  it("Stage never lowers: escalated + objection stays critical", () => {
    expect(
      router.resolveTier(ctx({ previousTurnEscalated: true, currentStage: "objection" })),
    ).toBe("critical");
  });

  it("Stage + floor: premium floor + fear → critical", () => {
    expect(router.resolveTier(ctx({ modelFloor: "premium", currentStage: "fear" }))).toBe(
      "critical",
    );
  });

  it("Stage raises a premium rule slot: tool-followup + fear → critical", () => {
    expect(router.resolveTier(ctx({ previousTurnUsedTools: true, currentStage: "fear" }))).toBe(
      "critical",
    );
  });

  it("Stage no-op on equal rank: deep engaged premium + objection stays premium", () => {
    expect(
      router.resolveTier(ctx({ conversationDepth: 6, toolCount: 4, currentStage: "objection" })),
    ).toBe("premium");
  });
});
