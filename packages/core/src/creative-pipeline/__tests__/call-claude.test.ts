// packages/core/src/creative-pipeline/__tests__/call-claude.test.ts
import { describe, it, expect, vi } from "vitest";
import { callClaude, extractJson } from "../stages/call-claude.js";
import { z } from "zod";

const mockCreate = vi.fn();

// Mock the Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(() => ({
    messages: { create: mockCreate },
  })),
}));

describe("extractJson", () => {
  it("extracts JSON from markdown code fence", () => {
    const text = 'Here is the result:\n```json\n{"key": "value"}\n```';
    expect(extractJson(text)).toBe('{"key": "value"}');
  });

  it("extracts raw JSON object", () => {
    const text = '{"key": "value"}';
    expect(extractJson(text)).toBe('{"key": "value"}');
  });

  it("extracts JSON object surrounded by text", () => {
    const text = 'Sure, here you go: {"key": "value"} Hope that helps!';
    expect(extractJson(text)).toBe('{"key": "value"}');
  });

  it("throws when no JSON found", () => {
    expect(() => extractJson("No JSON here")).toThrow("No JSON object found in response");
  });
});

describe("callClaude", () => {
  const TestSchema = z.object({ name: z.string(), score: z.number() });

  it("sends prompt and parses valid response", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"name": "test", "score": 42}' }],
    });

    const result = await callClaude({
      apiKey: "test-key",
      systemPrompt: "You are a test assistant.",
      userMessage: "Do the thing.",
      schema: TestSchema,
      model: "claude-sonnet-4-5-20250514",
      maxTokens: 4096,
    });

    expect(result).toEqual({ name: "test", score: 42 });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-5-20250514",
        max_tokens: 4096,
        system: "You are a test assistant.",
        messages: [{ role: "user", content: "Do the thing." }],
      }),
    );
  });

  it("handles response wrapped in code fence", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '```json\n{"name": "fenced", "score": 1}\n```' }],
    });

    const result = await callClaude({
      apiKey: "test-key",
      systemPrompt: "Test",
      userMessage: "Test",
      schema: TestSchema,
    });

    expect(result).toEqual({ name: "fenced", score: 1 });
  });

  it("throws on schema validation failure", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"name": "test"}' }], // missing score
    });

    await expect(
      callClaude({
        apiKey: "test-key",
        systemPrompt: "Test",
        userMessage: "Test",
        schema: TestSchema,
      }),
    ).rejects.toThrow();
  });

  it("throws on empty response", async () => {
    mockCreate.mockResolvedValue({
      content: [],
    });

    await expect(
      callClaude({
        apiKey: "test-key",
        systemPrompt: "Test",
        userMessage: "Test",
        schema: TestSchema,
      }),
    ).rejects.toThrow("Empty response from Claude");
  });
});
