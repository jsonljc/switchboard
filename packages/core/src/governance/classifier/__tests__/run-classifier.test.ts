import { describe, it, expect } from "vitest";
import { runClassifier } from "../run-classifier.js";
import type { AnthropicClaimClassifier } from "../anthropic-classifier.js";

const SUCCESS = {
  result: { sentence: "x", claimType: "efficacy" as const, confidence: 0.9 },
  promptVersion: "claim-classifier@1.0.0",
  promptHash: "0123456789abcdef",
  schemaVersion: "1.0.0",
  model: "claude-haiku-4-5-20251001",
};

function makeClassifier(
  behavior: (sentence: string, signal: AbortSignal) => Promise<typeof SUCCESS>,
): AnthropicClaimClassifier {
  return {
    classify: ({ sentence, signal }) => behavior(sentence, signal),
  };
}

describe("runClassifier", () => {
  it("dispatches all sentences in parallel and preserves order", async () => {
    const order: string[] = [];
    const classifier = makeClassifier(async (s) => {
      order.push(`start:${s}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end:${s}`);
      return { ...SUCCESS, result: { ...SUCCESS.result, sentence: s } };
    });
    const outcomes = await runClassifier({
      sentences: ["a", "b", "c"],
      model: "m",
      latencyBudgetMs: 1000,
      classifier,
    });
    expect(outcomes.map((o) => o.status)).toEqual(["classified", "classified", "classified"]);
    // All three starts should happen before the first end — parallel dispatch.
    expect(order.slice(0, 3).every((s) => s.startsWith("start:"))).toBe(true);
  });

  it("returns timeout for sentences that exceed the budget", async () => {
    const classifier = makeClassifier(
      (sentence, signal) =>
        new Promise((resolve, reject) => {
          if (sentence === "slow") {
            signal.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          } else {
            resolve({ ...SUCCESS, result: { ...SUCCESS.result, sentence } });
          }
        }),
    );
    const outcomes = await runClassifier({
      sentences: ["fast1", "slow", "fast2"],
      model: "m",
      latencyBudgetMs: 30,
      classifier,
    });
    expect(outcomes[0]!.status).toBe("classified");
    expect(outcomes[1]!.status).toBe("timeout");
    expect(outcomes[2]!.status).toBe("classified");
  });

  it("returns error for non-abort rejections", async () => {
    const classifier = makeClassifier(async (sentence) => {
      if (sentence === "boom") throw new Error("api failure");
      return { ...SUCCESS, result: { ...SUCCESS.result, sentence } };
    });
    const outcomes = await runClassifier({
      sentences: ["ok", "boom"],
      model: "m",
      latencyBudgetMs: 1000,
      classifier,
    });
    expect(outcomes[0]!.status).toBe("classified");
    expect(outcomes[1]!.status).toBe("error");
    const outcome1 = outcomes[1]!;
    if (outcome1.status === "error") {
      expect(outcome1.error.message).toContain("api failure");
    }
  });

  it("handles empty sentence array", async () => {
    const classifier = makeClassifier(async () => SUCCESS);
    const outcomes = await runClassifier({
      sentences: [],
      model: "m",
      latencyBudgetMs: 1000,
      classifier,
    });
    expect(outcomes).toEqual([]);
  });
});
