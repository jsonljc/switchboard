import { describe, it, expect, vi } from "vitest";
import { createAnthropicClaimClassifier } from "../anthropic-classifier.js";

function mockClient(response: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue(response),
    },
  } as const;
}

const SUCCESS_RESPONSE = {
  content: [
    {
      type: "tool_use",
      name: "classify_claim",
      input: { claimType: "efficacy", confidence: 0.92 },
    },
  ],
};

describe("AnthropicClaimClassifier", () => {
  it("returns a classified result with prompt-version/hash/schema-version stamps", async () => {
    const client = mockClient(SUCCESS_RESPONSE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const classifier = createAnthropicClaimClassifier(client as any);
    const { result, promptVersion, promptHash, schemaVersion, model } = await classifier.classify({
      sentence: "Most clients see visible slimming.",
      model: "claude-haiku-4-5-20251001",
      signal: new AbortController().signal,
    });
    expect(result.claimType).toBe("efficacy");
    expect(result.confidence).toBeCloseTo(0.92);
    expect(promptVersion).toBe("claim-classifier@1.0.0");
    expect(promptHash).toMatch(/^[0-9a-f]{16}$/);
    expect(schemaVersion).toBe("1.0.0");
    expect(model).toBe("claude-haiku-4-5-20251001");
  });

  it("sets cache_control on system text and last tool definition", async () => {
    const client = mockClient(SUCCESS_RESPONSE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const classifier = createAnthropicClaimClassifier(client as any);
    await classifier.classify({
      sentence: "x",
      model: "claude-haiku-4-5-20251001",
      signal: new AbortController().signal,
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const call = client.messages.create.mock.calls[0]![0];
    expect(Array.isArray(call.system)).toBe(true);
    expect(call.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(call.tools[call.tools.length - 1].cache_control).toEqual({ type: "ephemeral" });
    expect(call.tools[0].strict).toBe(true);
    expect(call.tools[0].input_schema.additionalProperties).toBe(false);
    expect(call.tool_choice).toEqual({ type: "tool", name: "classify_claim" });
  });

  it("throws when the response has no classify_claim tool use", async () => {
    const client = mockClient({ content: [{ type: "text", text: "ignored" }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const classifier = createAnthropicClaimClassifier(client as any);
    await expect(
      classifier.classify({
        sentence: "x",
        model: "claude-haiku-4-5-20251001",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/classify_claim/);
  });

  it("propagates AbortError when signal is aborted", async () => {
    const ctrl = new AbortController();
    const client = {
      messages: {
        create: vi.fn().mockImplementation(
          () =>
            new Promise((_, reject) => {
              ctrl.signal.addEventListener("abort", () =>
                reject(Object.assign(new Error("Request aborted"), { name: "AbortError" })),
              );
            }),
        ),
      },
    } as const;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const classifier = createAnthropicClaimClassifier(client as any);
    const promise = classifier.classify({
      sentence: "x",
      model: "claude-haiku-4-5-20251001",
      signal: ctrl.signal,
    });
    ctrl.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
