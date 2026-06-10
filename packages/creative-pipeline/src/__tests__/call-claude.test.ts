// packages/creative-pipeline/src/__tests__/call-claude.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  callClaude,
  callClaudeWithImages,
  extractJson,
  assertValidModelId,
  DEFAULT_MODEL,
  KNOWN_GOOD_MODELS,
} from "../stages/call-claude.js";
import { z } from "zod";

const mockCreate = vi.fn();

// Mock the Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(() => ({
    messages: { create: mockCreate },
  })),
}));

beforeEach(() => {
  mockCreate.mockReset();
});

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

// Offline regression guard for the D1-F1 defect (2026-06-10 Mira audit): the
// shipped DEFAULT_MODEL "claude-sonnet-4-5-20250514" is a non-existent id (it
// mixes Sonnet 4.5's name with Sonnet 4's date) so every live call 404'd. It
// shipped because every test mocks the SDK, and nothing pinned the id. These
// tests close that gap WITHOUT needing live API access.
describe("DEFAULT_MODEL / KNOWN_GOOD_MODELS", () => {
  it("DEFAULT_MODEL is a member of the maintained known-good list", () => {
    expect(KNOWN_GOOD_MODELS).toContain(DEFAULT_MODEL);
  });

  it("pins the default and the known-good list (edit both together, deliberately)", () => {
    // Changing the default model (or the supported list) must be a conscious
    // edit reviewed against the real Anthropic catalog, not an accident. If you
    // are updating models, update this assertion in the same change.
    expect(DEFAULT_MODEL).toBe("claude-sonnet-4-6");
    expect([...KNOWN_GOOD_MODELS]).toEqual([
      "claude-sonnet-4-6",
      "claude-opus-4-8",
      "claude-haiku-4-5",
    ]);
  });

  it("never re-admits the historical broken id", () => {
    expect(KNOWN_GOOD_MODELS).not.toContain("claude-sonnet-4-5-20250514");
  });

  it("every known-good id passes the construction-time validator", () => {
    for (const id of KNOWN_GOOD_MODELS) {
      expect(() => assertValidModelId(id)).not.toThrow();
    }
  });
});

describe("assertValidModelId", () => {
  it.each([
    "claude-sonnet-4-6",
    "claude-opus-4-8",
    "claude-haiku-4-5",
    "claude-sonnet-4-5-20250929", // a real dated snapshot is well-formed
  ])("accepts well-formed id %s", (id) => {
    expect(() => assertValidModelId(id)).not.toThrow();
  });

  it.each([
    ["", "empty string"],
    ["   ", "whitespace only"],
    ["gpt-4", "non-claude provider"],
    ["dall-e-3", "non-claude provider"],
    ["claude-sonnet-4.6", "dotted typo (a common 404 cause)"],
    ["claude sonnet 4 6", "spaces"],
    ["Claude-Sonnet-4-6", "uppercase"],
  ])("rejects malformed id %j (%s)", (id) => {
    expect(() => assertValidModelId(id)).toThrow();
  });
});

describe("callClaude", () => {
  const TestSchema = z.object({ name: z.string(), score: z.number() });

  it("forwards an explicit (valid) model override and parses the response", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"name": "test", "score": 42}' }],
    });

    const result = await callClaude({
      apiKey: "test-key",
      systemPrompt: "You are a test assistant.",
      userMessage: "Do the thing.",
      schema: TestSchema,
      model: "claude-opus-4-8",
      maxTokens: 4096,
    });

    expect(result).toEqual({ name: "test", score: 42 });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-4-8",
        max_tokens: 4096,
        system: "You are a test assistant.",
        messages: [{ role: "user", content: "Do the thing." }],
      }),
    );
  });

  it("uses DEFAULT_MODEL when no model option is given", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"name": "d", "score": 1}' }],
    });

    await callClaude({
      apiKey: "test-key",
      systemPrompt: "Test",
      userMessage: "Test",
      schema: TestSchema,
    });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: DEFAULT_MODEL }));
  });

  it("rejects a malformed model before calling the SDK (no opaque 404)", async () => {
    await expect(
      callClaude({
        apiKey: "test-key",
        systemPrompt: "Test",
        userMessage: "Test",
        schema: TestSchema,
        model: "gpt-4",
      }),
    ).rejects.toThrow();
    expect(mockCreate).not.toHaveBeenCalled();
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

  it("throws descriptive error on malformed JSON", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "{not valid json}" }],
    });

    await expect(
      callClaude({
        apiKey: "test-key",
        systemPrompt: "Test",
        userMessage: "Test",
        schema: TestSchema,
      }),
    ).rejects.toThrow("Failed to parse JSON from Claude response");
  });

  it("throws descriptive error on schema validation failure", async () => {
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
    ).rejects.toThrow("Claude response failed schema validation");
  });

  it("propagates API errors from Anthropic SDK", async () => {
    mockCreate.mockRejectedValue(new Error("401 Unauthorized"));

    await expect(
      callClaude({
        apiKey: "bad-key",
        systemPrompt: "Test",
        userMessage: "Test",
        schema: TestSchema,
      }),
    ).rejects.toThrow("401 Unauthorized");
  });
});

describe("callClaudeWithImages", () => {
  const TestSchema = z.object({ verdict: z.string() });

  it("sends image blocks + DEFAULT_MODEL and parses the response", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"verdict": "ok"}' }],
    });

    const result = await callClaudeWithImages({
      apiKey: "test-key",
      systemPrompt: "Inspect frames.",
      userMessage: "Rate realism.",
      schema: TestSchema,
      images: ["BASE64FRAME"],
    });

    expect(result).toEqual({ verdict: "ok" });
    const call = mockCreate.mock.calls[0]?.[0] as {
      model: string;
      messages: Array<{ content: Array<{ type: string }> }>;
    };
    expect(call.model).toBe(DEFAULT_MODEL);
    expect(call.messages[0]?.content.some((b) => b.type === "image")).toBe(true);
  });

  it("rejects a malformed model before calling the SDK", async () => {
    await expect(
      callClaudeWithImages({
        apiKey: "test-key",
        systemPrompt: "Test",
        userMessage: "Test",
        schema: TestSchema,
        images: ["BASE64FRAME"],
        model: "claude-sonnet-4.6", // dotted typo
      }),
    ).rejects.toThrow();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
