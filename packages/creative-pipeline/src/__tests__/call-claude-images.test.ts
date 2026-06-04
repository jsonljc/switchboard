// Image-block Claude call for frame-QA (slice-3 spec 3.1): frames go to the
// model as base64 image content blocks followed by the text instruction, with
// the same extractJson + zod-parse tail as the text-only callClaude.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: createMock },
  })),
}));

import { callClaudeWithImages } from "../stages/call-claude.js";

const schema = z.object({ verdict: z.string() });

describe("callClaudeWithImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends image blocks before the text block and parses fenced json", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: '```json\n{"verdict":"ok"}\n```' }],
    });

    const result = await callClaudeWithImages({
      apiKey: "k",
      systemPrompt: "sys",
      userMessage: "judge these frames",
      images: ["QUJD", "REVG"],
      schema,
    });

    expect(result).toEqual({ verdict: "ok" });
    const payload = createMock.mock.calls[0]![0];
    expect(payload.system).toBe("sys");
    const content = payload.messages[0].content;
    expect(content).toHaveLength(3);
    expect(content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "QUJD" },
    });
    expect(content[1].source.data).toBe("REVG");
    expect(content[2]).toEqual({ type: "text", text: "judge these frames" });
  });

  it("throws when the reply fails schema validation", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: '{"wrong":"shape"}' }],
    });

    await expect(
      callClaudeWithImages({
        apiKey: "k",
        systemPrompt: "sys",
        userMessage: "judge",
        images: ["QUJD"],
        schema,
      }),
    ).rejects.toThrow("schema validation");
  });
});
