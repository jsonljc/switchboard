import { describe, it, expect } from "vitest";
import {
  ModelRouter,
  effortToSlotAndOptions,
  TASK_TYPE_EFFORT_MAP,
  effortForTaskType,
  modelSupportsSamplingParams,
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

  it("uses the per-tier slot timeout when no explicit option is given (C2)", () => {
    // The per-slot timeoutMs replaces the old Haiku-shaped 8s DEFAULT_TIMEOUT_MS.
    expect(router.resolve("default").timeoutMs).toBe(15_000);
    expect(router.resolve("premium").timeoutMs).toBe(25_000);
    expect(router.resolve("critical").timeoutMs).toBe(30_000);
    expect(router.resolve("embedding").timeoutMs).toBe(8_000);
  });

  it("lets an explicit timeoutMs option override the per-tier slot value (C2)", () => {
    expect(router.resolve("premium", { timeoutMs: 1234 }).timeoutMs).toBe(1234);
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

  it("covers all expected task types", () => {
    expect(Object.keys(TASK_TYPE_EFFORT_MAP)).toHaveLength(10);
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

describe("modelSupportsSamplingParams", () => {
  it("returns true for the current 4.5/4.6 generation (sampling params accepted)", () => {
    expect(modelSupportsSamplingParams("claude-haiku-4-5-20251001")).toBe(true);
    expect(modelSupportsSamplingParams("claude-sonnet-4-6")).toBe(true);
    expect(modelSupportsSamplingParams("claude-opus-4-6")).toBe(true);
  });

  it("returns false for 4.7+ generations that hard-400 on temperature/top_p/top_k", () => {
    expect(modelSupportsSamplingParams("claude-opus-4-7")).toBe(false);
    expect(modelSupportsSamplingParams("claude-opus-4-8")).toBe(false);
    expect(modelSupportsSamplingParams("claude-sonnet-4-8")).toBe(false);
  });

  it("returns false for Fable 5 (rejects sampling params)", () => {
    expect(modelSupportsSamplingParams("claude-fable-5")).toBe(false);
    expect(modelSupportsSamplingParams("claude-fable-5-20260101")).toBe(false);
  });

  it("handles a provider-prefixed (bedrock-style) 4.8 id", () => {
    expect(modelSupportsSamplingParams("us.anthropic.claude-opus-4-8-v1:0")).toBe(false);
  });

  it("ignores a trailing date suffix when reading the minor version", () => {
    expect(modelSupportsSamplingParams("claude-opus-4-6-20260201")).toBe(true);
    expect(modelSupportsSamplingParams("claude-opus-4-7-20260201")).toBe(false);
  });

  it("returns true for an unrecognized id (preserve current behavior; no silent temp drop)", () => {
    expect(modelSupportsSamplingParams("voyage-3-large")).toBe(true);
    expect(modelSupportsSamplingParams("claude-3-5-sonnet-20241022")).toBe(true);
    expect(modelSupportsSamplingParams("some-future-model")).toBe(true);
  });
});
