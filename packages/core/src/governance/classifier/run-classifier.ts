import type { AnthropicClaimClassifier, ClassifierCallResult } from "./anthropic-classifier.js";

export interface RunClassifierInput {
  sentences: readonly string[];
  model: string;
  latencyBudgetMs: number;
  classifier: AnthropicClaimClassifier;
}

export type ClassifierOutcome =
  | { status: "classified"; result: ClassifierCallResult }
  | { status: "timeout"; sentence: string }
  | { status: "error"; sentence: string; error: Error };

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError"
  );
}

/**
 * Dispatch all sentence classifications in parallel under a single per-turn
 * latency budget. Budget exhaustion → remaining unresolved sentences emit
 * `{ status: "timeout", sentence }` (NOT silent emit). Non-abort rejections
 * (API errors, schema-parse failures) emit `{ status: "error", sentence, error }`.
 *
 * Order is preserved: outcomes[i] always corresponds to input.sentences[i].
 */
export async function runClassifier(
  input: RunClassifierInput,
): Promise<readonly ClassifierOutcome[]> {
  if (input.sentences.length === 0) return [];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), input.latencyBudgetMs);

  try {
    const settled = await Promise.allSettled(
      input.sentences.map((sentence) =>
        input.classifier.classify({ sentence, model: input.model, signal: ctrl.signal }),
      ),
    );

    return settled.map((s, i): ClassifierOutcome => {
      // `settled` and `input.sentences` have the same length by construction.
      const sentence = input.sentences[i] as string;
      if (s.status === "fulfilled") {
        return { status: "classified", result: s.value };
      }
      const err = s.reason;
      if (isAbortError(err)) return { status: "timeout", sentence };
      return {
        status: "error",
        sentence,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    });
  } finally {
    clearTimeout(timer);
  }
}
