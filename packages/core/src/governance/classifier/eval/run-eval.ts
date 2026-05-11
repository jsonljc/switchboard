/**
 * Offline classifier eval harness.
 *
 * EVAL=1 gated — throws immediately if the env flag is absent so this file
 * cannot accidentally fire in CI or production.
 *
 * Usage:
 *   EVAL=1 ANTHROPIC_API_KEY=sk-... pnpm --filter @switchboard/core classifier-eval
 *
 * What it does:
 * - Iterates the GOLDEN_SET once per model (Haiku 4.5 + Sonnet 4.6).
 * - Records pass/fail per entry (correct claimType + confidence ≥ floor).
 * - Computes per-model accuracy and inter-model disagreement rate.
 * - Emits a JSON report to stdout and a Markdown-friendly summary to stderr.
 *
 * Report schema (stdout):
 * {
 *   "runAt": "<ISO timestamp>",
 *   "models": {
 *     "<model-id>": {
 *       "accuracy": 0.0–1.0,
 *       "passed": number,
 *       "failed": number,
 *       "total": number,
 *       "entries": [{ id, sentence, expected, got, confidence, pass }]
 *     }
 *   },
 *   "interModelDisagreements": number,
 *   "disagreementRate": 0.0–1.0
 * }
 */

import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClaimClassifier } from "../anthropic-classifier.js";
import { GOLDEN_SET } from "./golden-set.js";
import type { ClaimType } from "@switchboard/schemas";

// Pinned model IDs. Haiku uses the dated suffix so the eval is reproducible against
// a specific snapshot (matches the production default in
// `resolveClaimClassifierConfig` and `packages/core/src/model-router.ts`). Sonnet
// uses the family-alias form the rest of the codebase already standardizes on
// (`claude-sonnet-4-6`). To rerun against a different model snapshot, set
// `EVAL_HAIKU_MODEL` / `EVAL_SONNET_MODEL` rather than editing this file.
const HAIKU_MODEL = process.env["EVAL_HAIKU_MODEL"] ?? "claude-haiku-4-5-20251001";
const SONNET_MODEL = process.env["EVAL_SONNET_MODEL"] ?? "claude-sonnet-4-6";
const MODELS = [HAIKU_MODEL, SONNET_MODEL] as const;

type Model = (typeof MODELS)[number];

interface EntryResult {
  id: string;
  sentence: string;
  expected: ClaimType;
  got: ClaimType;
  confidence: number;
  pass: boolean;
  confidencePass: boolean;
}

interface ModelReport {
  accuracy: number;
  passed: number;
  failed: number;
  total: number;
  entries: EntryResult[];
}

interface EvalReport {
  runAt: string;
  promptVersion: string;
  promptHash: string;
  models: Record<Model, ModelReport>;
  interModelDisagreements: number;
  disagreementRate: number;
}

export async function runEval(): Promise<void> {
  if (process.env["EVAL"] !== "1") {
    throw new Error(
      "runEval() is offline-only. Set EVAL=1 to run it. " +
        "This prevents accidental API spend in CI.",
    );
  }

  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for the classifier eval harness.");
  }

  const client = new Anthropic({ apiKey });
  const classifier = createAnthropicClaimClassifier(client);

  const modelResults = new Map<Model, EntryResult[]>();

  for (const model of MODELS) {
    console.warn(`[eval] Running model: ${model} (${GOLDEN_SET.length} entries) …`);
    const entries: EntryResult[] = [];

    for (const golden of GOLDEN_SET) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30_000);

      try {
        const { result } = await classifier.classify({
          sentence: golden.sentence,
          model,
          signal: ctrl.signal,
        });

        const claimPass = result.claimType === golden.expectedClaimType;
        const confidencePass = result.confidence >= golden.expectedConfidenceFloor;

        entries.push({
          id: golden.id,
          sentence: golden.sentence,
          expected: golden.expectedClaimType,
          got: result.claimType,
          confidence: result.confidence,
          pass: claimPass,
          confidencePass,
        });

        const icon = claimPass ? "✓" : "✗";
        console.warn(
          `  [${icon}] ${golden.id} expected=${golden.expectedClaimType} ` +
            `got=${result.claimType} conf=${result.confidence.toFixed(2)}`,
        );
      } catch (err) {
        console.warn(
          `  [!] ${golden.id} ERROR: ${err instanceof Error ? err.message : String(err)}`,
        );
        entries.push({
          id: golden.id,
          sentence: golden.sentence,
          expected: golden.expectedClaimType,
          got: "none",
          confidence: 0,
          pass: false,
          confidencePass: false,
        });
      } finally {
        clearTimeout(timer);
      }
    }

    modelResults.set(model, entries);
  }

  // ── Build per-model reports ──────────────────────────────────────────────
  const models = {} as Record<Model, ModelReport>;

  for (const model of MODELS) {
    const entries = modelResults.get(model) ?? [];
    const passed = entries.filter((e) => e.pass).length;
    models[model] = {
      accuracy: passed / entries.length,
      passed,
      failed: entries.length - passed,
      total: entries.length,
      entries,
    };
  }

  // ── Inter-model disagreement ─────────────────────────────────────────────
  // Two models disagree when they return different claimType for the same entry.
  const [primaryModel, secondaryModel] = MODELS;
  const primaryEntries = modelResults.get(primaryModel) ?? [];
  const secondaryEntries = modelResults.get(secondaryModel) ?? [];

  let interModelDisagreements = 0;
  for (let i = 0; i < primaryEntries.length; i++) {
    const primary = primaryEntries[i];
    const secondary = secondaryEntries[i];
    if (primary && secondary && primary.got !== secondary.got) {
      interModelDisagreements++;
      console.warn(
        `  [disagree] ${primary.id}: ${primaryModel}=${primary.got} vs ${secondaryModel}=${secondary.got}`,
      );
    }
  }

  const disagreementRate =
    primaryEntries.length > 0 ? interModelDisagreements / primaryEntries.length : 0;

  // ── Assemble report ──────────────────────────────────────────────────────
  // Import prompt metadata lazily to keep this file self-contained.
  const { CLASSIFIER_PROMPT_VERSION, CLASSIFIER_PROMPT_HASH } = await import("../prompt.js");

  const report: EvalReport = {
    runAt: new Date().toISOString(),
    promptVersion: CLASSIFIER_PROMPT_VERSION,
    promptHash: CLASSIFIER_PROMPT_HASH,
    models,
    interModelDisagreements,
    disagreementRate,
  };

  // JSON report → stdout (pipe-friendly)
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");

  // Markdown summary → stderr
  console.warn("\n## Classifier Eval Summary\n");
  console.warn(`Prompt: ${CLASSIFIER_PROMPT_VERSION} (${CLASSIFIER_PROMPT_HASH})`);
  console.warn(`Run at: ${report.runAt}\n`);
  console.warn("| Model | Accuracy | Passed | Failed | Total |");
  console.warn("| ----- | -------- | ------ | ------ | ----- |");
  for (const model of MODELS) {
    const r = models[model]!;
    console.warn(
      `| ${model} | ${(r.accuracy * 100).toFixed(1)}% | ${r.passed} | ${r.failed} | ${r.total} |`,
    );
  }
  console.warn(
    `\nInter-model disagreements: ${interModelDisagreements} / ${primaryEntries.length} ` +
      `(${(disagreementRate * 100).toFixed(1)}%)`,
  );

  const haiku = models[primaryModel]!;
  const sonnet = models[secondaryModel]!;
  const haikuPass = haiku.accuracy >= 0.8;
  const sonnetPass = sonnet.accuracy >= 0.85;
  const driftPass = disagreementRate <= 0.15;

  console.warn("\n## Thresholds\n");
  console.warn(`  Haiku accuracy ≥ 80%: ${haikuPass ? "PASS" : "FAIL"}`);
  console.warn(`  Sonnet accuracy ≥ 85%: ${sonnetPass ? "PASS" : "FAIL"}`);
  console.warn(`  Inter-model drift ≤ 15%: ${driftPass ? "PASS" : "FAIL"}`);

  const allPass = haikuPass && sonnetPass && driftPass;
  console.warn(`\nOverall: ${allPass ? "PASS" : "FAIL"}`);

  // Soft gate by default: warn but exit 0 so the harness can be embedded in
  // notebooks / dashboards / informational CI runs without hard-blocking
  // unrelated work. To enforce the thresholds (e.g. in a dedicated
  // classifier-regression CI step), set `EVAL_FAIL_ON_THRESHOLD=1`.
  if (!allPass && process.env["EVAL_FAIL_ON_THRESHOLD"] === "1") {
    process.exitCode = 1;
  }
}

// ESM main detection — allows `tsx run-eval.ts` to invoke directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  runEval().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
