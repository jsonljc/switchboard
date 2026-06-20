import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAnthropicClaimClassifier } from "../anthropic-classifier.js";
import { createInMemoryMetrics, setMetrics } from "../../../telemetry/metrics.js";

// The classifier now records prompt-cache effectiveness per call and warns on a
// zero-read "miss". Stub console.warn so any miss in these fixtures stays out of
// test output; recordLlmCacheEffectiveness's own warn is asserted directly in
// telemetry/metrics.test.ts.
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function mockClient(response: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue(response),
    },
  } as const;
}

// Real Message responses always carry `usage`; include it so the per-call
// cache-effectiveness recording reads a realistic shape (a cached-prefix hit).
const SUCCESS_RESPONSE = {
  content: [
    {
      type: "tool_use",
      name: "classify_claim",
      input: { claimType: "efficacy", confidence: 0.92 },
    },
  ],
  usage: {
    input_tokens: 40,
    output_tokens: 8,
    cache_read_input_tokens: 1024,
    cache_creation_input_tokens: 0,
  },
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
    const client = mockClient({
      content: [{ type: "text", text: "ignored" }],
      usage: {
        input_tokens: 40,
        output_tokens: 8,
        cache_read_input_tokens: 1024,
        cache_creation_input_tokens: 0,
      },
    });
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

  it("records per-call prompt-cache effectiveness from the response usage", async () => {
    const m = createInMemoryMetrics();
    setMetrics(m);
    const inc = vi.spyOn(m.llmCacheCallsTotal, "inc");
    const client = mockClient({
      content: [
        {
          type: "tool_use",
          name: "classify_claim",
          input: { claimType: "none", confidence: 0.1 },
        },
      ],
      usage: {
        input_tokens: 40,
        output_tokens: 8,
        cache_read_input_tokens: 2048,
        cache_creation_input_tokens: 0,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const classifier = createAnthropicClaimClassifier(client as any);
    await classifier.classify({
      sentence: "x",
      model: "claude-haiku-4-5-20251001",
      signal: new AbortController().signal,
    });
    expect(inc).toHaveBeenCalledWith({
      model: "claude-haiku-4-5-20251001",
      outcome: "hit",
    });
  });

  it("sends no sampling params, so the call is already forward-compatible with 4.7+ ids", async () => {
    // The classifier sends neither temperature, top_p, nor top_k, so a future
    // model-id bump to a 4.7+ generation (which hard-400s on sampling params)
    // needs no per-id guard here. This regression-guards against a change that
    // reintroduces one without the modelSupportsSamplingParams gate the other
    // non-governance call sites use.
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
    expect("temperature" in call).toBe(false);
    expect("top_p" in call).toBe(false);
    expect("top_k" in call).toBe(false);
  });
});
