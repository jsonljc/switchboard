import { describe, it, expect, vi } from "vitest";
import { LlmCallWrapper, type LlmCallFn } from "../llm-call-wrapper.js";
import { ModelRouter } from "../model-router.js";

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
