import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicToolAdapter } from "./anthropic-tool-adapter.js";

// Minimal mock of the Anthropic messages.create response (cast to avoid full SDK type surface)
const makeResponse = () => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "Hello" }],
  model: "claude-sonnet-4-6",
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
});

function makeClient(createFn: ReturnType<typeof vi.fn>) {
  return {
    messages: {
      create: createFn,
    },
  } as never;
}

describe("AnthropicToolAdapter.chatWithTools — temperature defaults", () => {
  let createMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createMock = vi.fn().mockResolvedValue(makeResponse());
  });

  it("sends temperature 0.4 when no profile is provided", async () => {
    const adapter = new AnthropicToolAdapter(makeClient(createMock));
    await adapter.chatWithTools({ system: "s", messages: [], tools: [] });

    expect(createMock).toHaveBeenCalledOnce();
    const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["temperature"]).toBe(0.4);
  });

  it("sends the profile temperature when profile.temperature is explicitly set", async () => {
    const adapter = new AnthropicToolAdapter(makeClient(createMock));
    await adapter.chatWithTools({
      system: "s",
      messages: [],
      tools: [],
      profile: {
        model: "claude-sonnet-4-6",
        maxTokens: 512,
        temperature: 0.7,
        timeoutMs: 30000,
      },
    });

    expect(createMock).toHaveBeenCalledOnce();
    const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["temperature"]).toBe(0.7);
  });
});
