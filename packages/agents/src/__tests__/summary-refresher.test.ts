import { describe, it, expect, vi } from "vitest";
import { refreshSummary, shouldRefreshSummary } from "../summary-refresher.js";
import type { LLMAdapter } from "@switchboard/core";
import type { Message } from "@switchboard/core";

describe("shouldRefreshSummary", () => {
  it("returns true when message count is a multiple of interval", () => {
    expect(shouldRefreshSummary(10, 10)).toBe(true);
    expect(shouldRefreshSummary(20, 10)).toBe(true);
  });

  it("returns false when message count is not a multiple", () => {
    expect(shouldRefreshSummary(5, 10)).toBe(false);
    expect(shouldRefreshSummary(13, 10)).toBe(false);
  });

  it("returns false for zero messages", () => {
    expect(shouldRefreshSummary(0, 10)).toBe(false);
  });
});

describe("refreshSummary", () => {
  it("generates summary via LLM", async () => {
    const mockLlm: LLMAdapter = {
      generateReply: vi.fn().mockResolvedValue({
        reply: "Lead interested in botox, asked about pricing. Positive sentiment.",
        confidence: 0.9,
      }),
    };

    const history: Message[] = [
      {
        id: "m-1",
        contactId: "c-1",
        direction: "inbound",
        content: "Hi",
        timestamp: new Date().toISOString(),
        channel: "whatsapp",
      },
      {
        id: "m-2",
        contactId: "c-1",
        direction: "outbound",
        content: "Hello!",
        timestamp: new Date().toISOString(),
        channel: "whatsapp",
      },
    ];

    const result = await refreshSummary(mockLlm, history);
    expect(result).toBe("Lead interested in botox, asked about pricing. Positive sentiment.");
    expect(mockLlm.generateReply).toHaveBeenCalledOnce();
  });

  it("returns fallback on LLM failure", async () => {
    const mockLlm: LLMAdapter = {
      generateReply: vi.fn().mockRejectedValue(new Error("timeout")),
    };

    const result = await refreshSummary(mockLlm, []);
    expect(result).toBe("");
  });
});
