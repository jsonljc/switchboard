import { describe, it, expect } from "vitest";
import {
  ModelRouter,
  effortToSlotAndOptions,
  TASK_TYPE_EFFORT_MAP,
  effortForTaskType,
} from "../model-router.js";

describe("ModelRouter", () => {
  const router = new ModelRouter();

  it("resolves default slot to cheap model", () => {
    const config = router.resolve("default");
    expect(config.modelId).toBe("claude-haiku-4-5-20251001");
    expect(config.slot).toBe("default");
  });

  it("resolves premium slot to strong model", () => {
    const config = router.resolve("premium");
    expect(config.modelId).toBe("claude-sonnet-4-6");
  });

  it("resolves embedding slot", () => {
    const config = router.resolve("embedding");
    expect(config.slot).toBe("embedding");
  });

  it("upgrades default to premium when critical", () => {
    const config = router.resolve("default", { critical: true });
    expect(config.modelId).toBe("claude-sonnet-4-6");
    expect(config.slot).toBe("premium");
  });

  it("keeps premium as premium when critical", () => {
    const config = router.resolve("premium", { critical: true });
    expect(config.modelId).toBe("claude-sonnet-4-6");
  });

  it("returns fallback config for default slot", () => {
    const config = router.resolve("default");
    expect(config.fallbackSlot).toBe("premium");
  });

  it("returns fallback for premium slot when explicitly degradable", () => {
    const config = router.resolve("premium", { degradable: true });
    expect(config.fallbackSlot).toBe("default");
  });

  it("returns no fallback for premium slot by default (non-degradable)", () => {
    const config = router.resolve("premium");
    expect(config.fallbackSlot).toBeUndefined();
  });

  it("returns no fallback for premium slot when explicitly non-degradable", () => {
    const config = router.resolve("premium", { degradable: false });
    expect(config.fallbackSlot).toBeUndefined();
  });

  it("includes timeout from task class", () => {
    const config = router.resolve("default", { timeoutMs: 5000 });
    expect(config.timeoutMs).toBe(5000);
  });

  it("uses default timeout when none specified", () => {
    const config = router.resolve("default");
    expect(config.timeoutMs).toBe(8000);
  });
});

describe("effortToSlotAndOptions", () => {
  it("maps low effort to default slot", () => {
    const { slot, options } = effortToSlotAndOptions("low");
    expect(slot).toBe("default");
    expect(options.critical).toBe(false);
  });

  it("maps medium effort to default slot with critical=true", () => {
    const { slot, options } = effortToSlotAndOptions("medium");
    expect(slot).toBe("default");
    expect(options.critical).toBe(true);
  });

  it("maps high effort to premium slot", () => {
    const { slot, options } = effortToSlotAndOptions("high");
    expect(slot).toBe("premium");
    expect(options.critical).toBe(false);
  });

  it("medium effort resolves to Sonnet via critical upgrade", () => {
    const router = new ModelRouter();
    const { slot, options } = effortToSlotAndOptions("medium");
    const config = router.resolve(slot, options);
    expect(config.modelId).toBe("claude-sonnet-4-6");
  });

  it("low effort resolves to Haiku", () => {
    const router = new ModelRouter();
    const { slot, options } = effortToSlotAndOptions("low");
    const config = router.resolve(slot, options);
    expect(config.modelId).toBe("claude-haiku-4-5-20251001");
  });
});

describe("TASK_TYPE_EFFORT_MAP", () => {
  it("maps content.draft to medium", () => {
    expect(TASK_TYPE_EFFORT_MAP["content.draft"]).toBe("medium");
  });

  it("maps content.publish to low", () => {
    expect(TASK_TYPE_EFFORT_MAP["content.publish"]).toBe("low");
  });

  it("maps summarisation to low", () => {
    expect(TASK_TYPE_EFFORT_MAP["summarisation"]).toBe("low");
  });
});

describe("effortForTaskType", () => {
  it("returns mapped effort for a known task type", () => {
    expect(effortForTaskType("content.draft")).toBe("medium");
  });

  it("returns medium for an unknown task type (fallback)", () => {
    expect(effortForTaskType("unknown.task.type")).toBe("medium");
  });
});
