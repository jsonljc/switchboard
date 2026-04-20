import { describe, it, expect, vi } from "vitest";
import { LlmCallWrapper, type LlmCallFn, type LlmCallResult } from "../llm-call-wrapper.js";
import { ModelRouter, type ModelConfig } from "../model-router.js";
import type { ContextBudget } from "../context-budget.js";
import { DEFAULT_CONTEXT_BUDGET_LIMITS } from "../context-budget.js";

describe("LlmCallWrapper", () => {
  const router = new ModelRouter();

  it("returns result on first successful call", async () => {
    const callFn: LlmCallFn = vi.fn().mockResolvedValue({ reply: "hello", confidence: 0.9 });
    const wrapper = new LlmCallWrapper({ router, callFn });

    const result = await wrapper.call("default", { prompt: "test" });
    expect(result.reply).toBe("hello");
    expect(callFn).toHaveBeenCalledOnce();
  });

  it("retries once on transient failure then succeeds", async () => {
    const callFn: LlmCallFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue({ reply: "ok", confidence: 0.8 });
    const wrapper = new LlmCallWrapper({ router, callFn, maxRetries: 1 });

    const result = await wrapper.call("default", { prompt: "test" });
    expect(result.reply).toBe("ok");
    expect(callFn).toHaveBeenCalledTimes(2);
  });

  it("falls back to fallback slot after retries exhausted", async () => {
    const callFn: LlmCallFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValue({ reply: "fallback ok", confidence: 0.7 });
    const wrapper = new LlmCallWrapper({ router, callFn, maxRetries: 1 });

    const result = await wrapper.call("default", { prompt: "test" });
    expect(result.reply).toBe("fallback ok");
    expect(callFn).toHaveBeenCalledTimes(3);
  });

  it("returns fail-safe when all attempts fail and no fallback", async () => {
    const callFn: LlmCallFn = vi.fn().mockRejectedValue(new Error("always fail"));
    const wrapper = new LlmCallWrapper({
      router,
      callFn,
      maxRetries: 1,
      failSafe: { reply: "I'll have someone follow up shortly", confidence: 0 },
    });

    const result = await wrapper.call("premium", { prompt: "test" });
    expect(result.reply).toBe("I'll have someone follow up shortly");
  });

  it("throws when all attempts fail and no fail-safe provided", async () => {
    const callFn: LlmCallFn = vi.fn().mockRejectedValue(new Error("always fail"));
    const wrapper = new LlmCallWrapper({ router, callFn, maxRetries: 0 });

    await expect(wrapper.call("premium", { prompt: "test" })).rejects.toThrow("always fail");
  });

  it("calls usage logger on success", async () => {
    const logFn = vi.fn();
    const callFn: LlmCallFn = vi.fn().mockResolvedValue({ reply: "hi", confidence: 0.9 });
    const wrapper = new LlmCallWrapper({ router, callFn, onUsage: logFn });

    await wrapper.call("default", { prompt: "test", orgId: "org-1", taskType: "qualification" });
    expect(logFn).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5-20251001", orgId: "org-1" }),
    );
  });
});

describe("LlmCallWrapper with ContextBudget", () => {
  it("assembles prompt from budget when budget is provided", async () => {
    let capturedInput: Record<string, unknown> = {};
    const callFn = async (
      _config: ModelConfig,
      input: Record<string, unknown>,
    ): Promise<LlmCallResult> => {
      capturedInput = input;
      return { reply: "ok", confidence: 1 };
    };

    const wrapper = new LlmCallWrapper({
      router: new ModelRouter(),
      callFn,
    });

    const budget: ContextBudget = {
      doctrine: "You are helpful.",
      memory: { brand: "Brand: direct." },
      task: { goal: "Draft post", scope: [], constraints: [], expectedOutput: "post" },
      effort: "medium",
      orgId: "org-1",
      taskType: "content.draft",
    };

    await wrapper.call("default", { prompt: "", budget, limits: DEFAULT_CONTEXT_BUDGET_LIMITS });

    expect(typeof capturedInput["prompt"]).toBe("string");
    expect(capturedInput["prompt"] as string).toContain("You are helpful.");
    expect(capturedInput["prompt"] as string).toContain("Brand: direct.");
    expect(capturedInput["prompt"] as string).toContain("Draft post");
  });

  it("uses raw prompt when no budget is provided", async () => {
    let capturedInput: Record<string, unknown> = {};
    const callFn = async (
      _config: ModelConfig,
      input: Record<string, unknown>,
    ): Promise<LlmCallResult> => {
      capturedInput = input;
      return { reply: "ok", confidence: 1 };
    };

    const wrapper = new LlmCallWrapper({
      router: new ModelRouter(),
      callFn,
    });

    await wrapper.call("default", { prompt: "raw prompt here" });
    expect(capturedInput["prompt"]).toBe("raw prompt here");
  });

  it("sources orgId and taskType from budget when not set on options", async () => {
    const logFn = vi.fn();
    const callFn: LlmCallFn = vi.fn().mockResolvedValue({ reply: "ok", confidence: 1 });

    const wrapper = new LlmCallWrapper({
      router: new ModelRouter(),
      callFn,
      onUsage: logFn,
    });

    const budget: ContextBudget = {
      doctrine: "You are helpful.",
      memory: {},
      task: { goal: "Draft post", scope: [], constraints: [], expectedOutput: "post" },
      effort: "medium",
      orgId: "org-from-budget",
      taskType: "tasktype-from-budget",
    };

    await wrapper.call("default", { prompt: "", budget });

    expect(logFn).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-from-budget",
        taskType: "tasktype-from-budget",
      }),
    );
  });
});
