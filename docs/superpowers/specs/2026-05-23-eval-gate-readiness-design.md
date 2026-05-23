# Eval-Gate Readiness — Design

**Date:** 2026-05-23
**Status:** Proposed
**Predecessor:** PR-3 (#629 → `d60d475c`, MERGED) shipped the `Eval — Claim Classifier` CI job as an informational-only gate. This spec covers the follow-up work to make that gate **promotable to a required check**.

## Goal

Bring the `Eval — Claim Classifier` gate to a promotable state — **no known false-positives** and **statically verified** — and cleanly (re)start the 14-day promotion bake. Promotion to a required status check happens only after this work lands, main is reliably green, and a clean bake completes.

## Motivation / evaluation findings

The first live runs of the merged gate surfaced a false-positive: the `testimonial` class (9 fixtures) flips by one classification between runs under the production classifier's **default temperature** (1.0), producing an 11.1pp per-class swing the 2pp tolerance can't absorb. Three live runs: `testimonial` 7/9 (fail) / 8/9 / 8/9; prompt hash matched baseline every run, so this is pure model non-determinism, not a regression.

Evaluating the proposed fix (per-class minimum-flipped-count) revealed it is **necessary but not sufficient**:

- **Per-class rule alone** kills the demonstrated 1-fixture flip but leaves the **overall rule** flawed in the same way. The baseline is **102/105** correct (97.14%); the overall rule fires at `> 1pp`, and 1pp over 105 fixtures ≈ 1.05 fixtures. So a **2-fixture cross-class noise swing** (e.g. `testimonial` −1 and a borderline `safety-claim` −1) is suppressed per-class (each `additionalWrong = 1`) **but trips the overall rule** (100/105 = 95.24% → 1.90pp drop). The gate would stay flaky and "main is green" (the bake-start gate) would be unreliable.

Therefore the gating fix must apply minimum-flipped-count robustness to **both** the per-class and overall rules.

The production classifier's `temperature` is intentionally **not** changed here. `anthropic-classifier.ts` is the production classifier (used by `runClassifier`), so pinning `temperature: 0` changes production behavior and requires a baseline re-lock and a before/after accuracy check. That is carved out as a separate follow-up (PR-4 / issue #631), not folded into this readiness work.

## Scope

Three pieces, sequenced. Step 0 is operational; PR A and PR B are focused follow-up PRs to `main`.

### Step 0 (operational, optional) — clear the red

The `eval-classifier` job is red on `main`'s HEAD (`d60d475c`) because the merge pushed to main at 12:59 _before_ the `ANTHROPIC_API_KEY` secret was set (13:09); on a main push with no key the harness correctly exits 2. Re-running that job now (secret present) would clear the cosmetic red, **but it runs the old gate logic still on main**, so it carries the same ~1-in-3 `testimonial` flake risk. The authoritative green comes from PR A's post-merge main run. Treat Step 0 as optional cosmetic cleanup; do not block on it.

### PR A — `fix(eval-classifier): require minimum fixture-count delta for per-class and overall regressions`

**Promotion-critical. Eval-only. No production classifier change. No baseline re-lock.**

Modify `compareAgainstBaseline` in `evals/claim-classifier/score.ts`:

**Per-class rule** — fire only when BOTH hold:

- `drop > toleranceFraction` (existing 2pp from `baseline.toleranceBps`), AND
- `additionalWrong >= 2`, where for each class:
  - `baselineWrong = baselineMetric.total - baselineMetric.correct`
  - `currentWrong = current.total - current.correct`
  - `additionalWrong = currentWrong - baselineWrong`

**Overall rule** — fire only when BOTH hold:

- `overallDropBps > OVERALL_TOLERANCE_BPS` (existing strict `> 100`, i.e. 1.00pp), AND
- `overallAdditionalWrong >= 3`, where (integer counts, derived from the report's overall accuracy and fixture count so the rule is independent of the per-class loop and testable):
  - `currentTotalWrong = report.totalFixtures - Math.round(report.overallAccuracy * report.totalFixtures)`
  - `baselineTotalWrong = baseline.totalFixtures - Math.round(baseline.overallAccuracy * baseline.totalFixtures)`
  - `overallAdditionalWrong = currentTotalWrong - baselineTotalWrong`

**Unchanged:** prompt-hash mismatch (hard fail), secret handling, the `OVERALL_TOLERANCE_BPS = 100` constant and its config-independence comment, the bps rounding for the drop comparison.

**Thresholds rationale:** per-class `>= 2` means a single noisy fixture never trips a small class; overall `>= 3` (3/105 ≈ 2.86pp) suppresses the realistic 1- and 2-fixture cross-class noise swings. A real broad regression flips many more fixtures and still fires both rules.

**Residual (documented, accepted):** a rare **3-fixture pure-noise swing** could still trip the overall rule; this residual is what the deferred temperature=0 work (PR-4) shrinks. Also, by design the gate will **not** catch a real 1-fixture regression on a tiny class — a 1-fixture change at n=9 is statistically indistinguishable from noise, so this is the correct specificity/sensitivity trade.

**Tests** (`evals/claim-classifier/__tests__/score.test.ts`):

- Add: small-class 1-flip → passes (per-class suppressed); small-class 2-flip → fails; per-class boundary at exactly `additionalWrong == 2`.
- Add: overall 2-fixture swing → passes (overall suppressed); overall 3-fixture swing → fails; overall boundary at exactly `overallAdditionalWrong == 3`.
- **Update existing PR-3 tests** that used a single-fixture flip to assert a per-class regression (e.g. `efficacy` 4/5): under the new rule a 1-flip no longer fires, so these must use `>= 2` flips to still intend a per-class regression.
- **`makeReport` helper subtlety:** PR-3's helper sets `overallAccuracy` independently of per-class counts. The new overall rule derives wrong-counts from `overallAccuracy * totalFixtures`, so overall tests must set `overallAccuracy` and `totalFixtures` to values that yield the intended integer `overallAdditionalWrong` (relative to the `baseline` fixture's `overallAccuracy`/`totalFixtures`). Make these consistent so a test can't silently pass with `overallAdditionalWrong = 0`.

### PR B — `chore(eval-classifier): wire eval typecheck into CI + bounded strict-error cleanup`

**CI hygiene. No scoring-behavior change.**

- Fix the bounded pre-existing strict-mode (`noUncheckedIndexedAccess`) errors that block a clean `tsc`: `evals/claim-classifier/load-fixtures.ts:15`, and `evals/claim-classifier/score.ts` `scoreResults` (≈ lines 23/25/32) — `Object is possibly 'undefined'`. Guard the indexed accesses; do not change behavior.
- Add a `typecheck` script to `evals/claim-classifier/package.json` (e.g. `tsc -p ../tsconfig.json --noEmit`, or a package-local tsconfig — wire whichever config is kept; `evals/tsconfig.json` is currently referenced nowhere).
- Add a typecheck step to the `eval-classifier` CI job (or wire the eval package into the turbo `typecheck` task) **only after** local `tsc` is clean.
- **Lint is optional/stretch:** `evals/` has no eslint config today and is outside the repo's lint globs (`packages/*/src`, `apps/*/src`). Adding lint requires an eslintrc for the eval workspace — out of PR B's core scope unless trivial. Prefer prettier-check + typecheck as the static gates.

### Deferred — PR-4 (tracked in issue #631): production classifier determinism

Evaluate `temperature: 0` for the production classifier (`anthropic-classifier.ts`): before/after accuracy on the golden fixtures, re-lock `baseline.json` if adopted, and decide whether the prompt hash should incorporate model params beyond prompt text. **Out of scope here** because it changes production behavior.

## Bake / promotion semantics

- The 14-day promotion bake **(re)starts after PR A merges and main is green** — pre-PR-A days do not count, since the bake already surfaced a false-positive blocker.
- Update issue #631: note the bake-clock reset and that PR A + PR B are the promotion prerequisites alongside a clean bake.
- Promotion to a required check (`Eval — Claim Classifier` in `main` branch protection) happens only after: PR A merged, PR B merged, ≥14 days clean bake with ≥1 real classifier-touching PR running the eval to completion, and zero false-positives.

## Sequencing & dependencies

1. Step 0 (optional) — clear red now.
2. **PR A** — gating robustness (per-class + overall). Promotion-critical; do first.
3. **PR B** — typecheck wiring + strict-error cleanup.

PR A and PR B both touch `score.ts` (PR A: `compareAgainstBaseline`; PR B: `scoreResults` strict-error fixes) in different functions — land sequentially (A then B) to avoid conflicts.

## Out of scope

- Production classifier `temperature` change / baseline re-lock (PR-4 / #631).
- Adding fixtures to small classes.
- Latency gating, response cache, nightly cron, `pull_request_target`, branch-protection promotion at merge time.
- `packages/schemas` changes; any production classifier runtime change.

## Acceptance criteria

- `compareAgainstBaseline` per-class rule requires `drop > toleranceFraction && additionalWrong >= 2`; overall rule requires `overallDropBps > 100 && overallAdditionalWrong >= 3`.
- The observed `testimonial` 1-flip and a synthetic 2-fixture cross-class swing both **pass**; a 2-flip small-class and a 3-fixture overall swing both **fail**; prompt-hash mismatch still fails.
- All eval tests pass; existing single-flip per-class tests updated; overall tests use consistent count data.
- `tsc` over the eval harness is clean and runs in CI (PR B).
- No production classifier change; no baseline re-lock; `baseline.json` byte-unchanged.
- Issue #631 updated with the bake-clock reset and promotion prerequisites.
