import { describe, it, expect } from "vitest";
import { TestToolAdapter } from "../adapters/test-tool-adapter.js";
import type { LLMResponse } from "../llm-types.js";

describe("TestToolAdapter", () => {
  it("returns configured responses in sequence", async () => {
    const responses: LLMResponse[] = [
      {
        content: [{ type: "text", text: "Hello" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ];

    const adapter = new TestToolAdapter(responses);
    const result = await adapter.chatWithTools({
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });

    expect(result.content[0]!.type).toBe("text");
    expect(adapter.calls).toHaveLength(1);
  });

  it("throws when responses exhausted", async () => {
    const adapter = new TestToolAdapter([]);
    await expect(
      adapter.chatWithTools({ system: "test", messages: [], tools: [] }),
    ).rejects.toThrow("no more responses");
  });
});
