# Classifier Eval Harness

Offline cross-model drift detector for the Layer 2 regulatory claim classifier.

## Overview

The harness runs the GOLDEN_SET through two models (Haiku 4.5 + Sonnet 4.5) and
measures per-model accuracy and inter-model disagreement. It is a **soft signal** —
manual, EVAL-gated, never run in CI.

Run it when you:

- bump `CLASSIFIER_PROMPT_VERSION` or edit `CLASSIFIER_SYSTEM_PROMPT`
- change the `ClaimType` enum (add, rename, or remove a claim type)
- upgrade the Anthropic SDK or switch model IDs
- want to verify the classifier still behaves after a long-lived merge

## Prerequisites

- `ANTHROPIC_API_KEY` set in your environment
- `tsx` available (it is a `devDependency` of `@switchboard/core`)
- API access to `claude-haiku-4-5` and `claude-sonnet-4-5`

## Running

```bash
# From the monorepo root
EVAL=1 ANTHROPIC_API_KEY=sk-... pnpm classifier-eval

# Or directly from the core package
cd packages/core
EVAL=1 ANTHROPIC_API_KEY=sk-... pnpm classifier-eval

# Save the JSON report
EVAL=1 ANTHROPIC_API_KEY=sk-... pnpm classifier-eval > eval-report-$(date +%Y%m%d).json
```

The runner emits:

- **stdout** — machine-readable JSON report (pipe-friendly)
- **stderr** — human-readable Markdown summary with per-model tables and threshold badges

## Thresholds

| Metric                        | Threshold | Notes                                              |
| ----------------------------- | --------- | -------------------------------------------------- |
| Haiku 4.5 accuracy            | ≥ 80%     | Cost model; higher miss rate is acceptable         |
| Sonnet 4.5 accuracy           | ≥ 85%     | Quality model; should track closer to ground truth |
| Inter-model disagreement rate | ≤ 15%     | High drift = prompt is ambiguous or enum drifted   |

All three thresholds must pass for `process.exitCode = 0`. Any failure sets `exitCode = 1`.

## Golden Set

Located at `packages/core/src/governance/classifier/eval/golden-set.ts`.

- 45 entries spanning all 9 claim types (`efficacy`, `safety-claim`, `superiority`,
  `urgency`, `testimonial`, `medical-advice`, `diagnosis`, `credentials`, `none`)
- Both jurisdictions: Singapore (`SG`) and Malaysia (`MY`)
- Each entry has an `expectedConfidenceFloor` — the minimum confidence score for a
  "high-confidence pass" (checked independently from claim-type accuracy)
- Sentences drawn from real medical aesthetic and beauty spa marketing contexts

### Adding entries

1. Add a new `GoldenEntry` to `GOLDEN_SET` in `golden-set.ts`.
2. Pick a unique `id` following the pattern `<type>-NN` (e.g., `eff-09`).
3. Set `expectedConfidenceFloor` between 0.75 (ambiguous boundary cases) and 0.95
   (unambiguous logistic facts).
4. Run `pnpm --filter @switchboard/core test -- golden-set` to confirm the structural
   tests still pass (≥40 entries, all 9 types, both jurisdictions).

## Structural Test (always-on)

```bash
pnpm --filter @switchboard/core test -- golden-set
```

Three tests run in CI without API calls:

1. `has ≥40 entries` — guards against accidental truncation
2. `covers all 9 claim types` — each ClaimType must appear at least once
3. `has entries for both jurisdictions` — SG and MY must both be present

## Report Format

```jsonc
{
  "runAt": "2026-05-11T10:00:00.000Z",
  "promptVersion": "claim-classifier@1.0.0",
  "promptHash": "a1b2c3d4e5f60718",
  "models": {
    "claude-haiku-4-5": {
      "accuracy": 0.91,
      "passed": 41,
      "failed": 4,
      "total": 45,
      "entries": [
        {
          "id": "eff-01",
          "sentence": "...",
          "expected": "efficacy",
          "got": "efficacy",
          "confidence": 0.92,
          "pass": true,
          "confidencePass": true
        }
      ]
    },
    "claude-sonnet-4-5": { ... }
  },
  "interModelDisagreements": 3,
  "disagreementRate": 0.067
}
```

## Versioning Guidance

After a passing run, record the `promptVersion` and `promptHash` in a comment above
`CLASSIFIER_PROMPT_VERSION` in `prompt.ts` so the next author knows the last-validated
baseline. Example:

```ts
// Last eval: claim-classifier@1.0.0 (a1b2c3d4e5f60718) — 2026-05-11
// Haiku: 91.1% | Sonnet: 95.6% | Drift: 6.7%
export const CLASSIFIER_PROMPT_VERSION = "claim-classifier@1.0.0" as const;
```

## CI Integration

The eval harness is **not** in CI. The structural golden-set tests run on every push.
The full eval is a pre-release gate: run it before merging any PR that touches the
classifier prompt, claim-type enum, or model identifiers.
