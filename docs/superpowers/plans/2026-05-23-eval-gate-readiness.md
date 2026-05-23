# Eval-Gate Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `Eval — Claim Classifier` CI gate promotable — eliminate the small-class non-determinism false-positive (per-class AND overall) and wire the harness into static typechecking — without changing the production classifier.

**Architecture:** Two focused, sequential PRs to `main`. PR A (eval-only) couples each accuracy-drop rule with a minimum-additional-wrong-fixture count so a 1–2 fixture stochastic flip no longer blocks. PR B (CI hygiene) fixes the pre-existing strict-mode errors that block a clean `tsc` over the eval harness and wires the eval workspace into the existing typecheck job. Production `temperature` is deliberately out of scope (separate PR-4 / issue #631).

**Tech Stack:** TypeScript, vitest, pnpm workspaces, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-05-23-eval-gate-readiness-design.md` (must land on `main` before PR A opens — see Pre-flight).

---

## File Structure

**Modified in PR A:**

- `evals/claim-classifier/score.ts` — add exported `countWrong` helper; extend `compareAgainstBaseline` per-class rule with `additionalWrong >= 2` and overall rule with `overallAdditionalWrong >= 3`. `scoreResults` untouched in PR A.
- `evals/claim-classifier/__tests__/score.test.ts` — rewrite the `makeReport` helper to derive `overallAccuracy`/`totalFixtures` from per-class counts; rewrite the 5 `makeReport`-based comparison tests for the new behavior; add `countWrong` unit tests.

**Modified in PR B:**

- `evals/claim-classifier/score.ts` — fix `scoreResults` strict-mode index errors (type `perType` as a full `Record<ClaimTypeLabel, …>`). No behavior change.
- `evals/claim-classifier/load-fixtures.ts` — guard the `lines[i]` index access. No behavior change.
- `evals/claim-classifier/package.json` — add a `typecheck` script.
- (Verify) `.github/workflows/ci.yml` — confirm the existing `typecheck` job now covers the eval workspace; add an explicit step only if turbo does not pick it up.

**Untouched anywhere in this plan:** `evals/claim-classifier/baseline.json`, `fixtures/**`, `invoke-classifier.ts`, `eval-preflight.ts`, `run-eval.ts`, `schema.ts`, and `packages/core/src/governance/classifier/**` (no production classifier change, no baseline re-lock).

---

## Pre-flight verification (do once before Task 1)

- [ ] **Step 1: Spec is on `main`**

```bash
git fetch origin main
git ls-tree --name-only origin/main docs/superpowers/specs/2026-05-23-eval-gate-readiness-design.md
```

Expected: the path prints. If not, merge the spec PR (`docs-eval-gate-readiness-spec`) first.

- [ ] **Step 2: Cut a fresh branch off `main` for PR A**

```bash
cd /Users/jasonli/switchboard
git checkout main && git pull --ff-only
git checkout -b fix-eval-classifier-min-fixture-count
```

- [ ] **Step 3: Build the packages the eval workspace imports + confirm baseline of tests**

```bash
pnpm install
pnpm --filter @switchboard/core^... build && pnpm --filter @switchboard/core build
pnpm exec vitest run --config evals/vitest.config.ts
```

Expected: builds exit 0; vitest reports all current eval tests passing (36 across 5 files).

---

## PR A — robust small-class gating

### Task 1: Add the `countWrong` helper (raw-count, independently tested)

**Files:**

- Modify: `evals/claim-classifier/score.ts`
- Modify: `evals/claim-classifier/__tests__/score.test.ts`

- [ ] **Step 1: Add the failing `countWrong` unit tests**

In `evals/claim-classifier/__tests__/score.test.ts`, change the top imports from:

```typescript
import { scoreResults, compareAgainstBaseline, type ScoreReport } from "../score.js";
import type { InvocationResult } from "../invoke-classifier.js";
import type { Baseline } from "../schema.js";
```

to:

```typescript
import { scoreResults, compareAgainstBaseline, countWrong, type ScoreReport } from "../score.js";
import { ClaimTypeEnum } from "../schema.js";
import type { InvocationResult } from "../invoke-classifier.js";
import type { Baseline, ClaimTypeLabel } from "../schema.js";
```

Then add this new top-level describe block at the end of the file (after the closing `});` of `describe("compareAgainstBaseline", …)`):

```typescript
describe("countWrong", () => {
  const zero = { correct: 0, total: 0, accuracy: 0 };
  const allZero: ScoreReport["perClaimTypeAccuracy"] = {
    efficacy: zero,
    urgency: zero,
    "safety-claim": zero,
    superiority: zero,
    testimonial: zero,
    "medical-advice": zero,
    diagnosis: zero,
    credentials: zero,
    none: zero,
  };

  it("returns 0 when every class is empty", () => {
    expect(countWrong(allZero)).toBe(0);
  });

  it("sums (total - correct) across all classes", () => {
    expect(
      countWrong({
        ...allZero,
        efficacy: { correct: 4, total: 5, accuracy: 0.8 }, // 1 wrong
        urgency: { correct: 3, total: 5, accuracy: 0.6 }, // 2 wrong
      }),
    ).toBe(3);
  });

  it("skips undefined metrics (partial baseline record)", () => {
    expect(countWrong({ efficacy: { correct: 5, total: 8, accuracy: 0.625 } })).toBe(3);
  });
});
```

- [ ] **Step 2: Run, expect FAIL (unresolved import)**

```bash
pnpm exec vitest run --config evals/vitest.config.ts claim-classifier/__tests__/score.test.ts
```

Expected: FAIL — `countWrong` is not exported from `../score.js`.

- [ ] **Step 3: Implement `countWrong` in `score.ts`**

In `evals/claim-classifier/score.ts`, immediately after the `OVERALL_TOLERANCE_BPS` constant (line ~50) and before `export function compareAgainstBaseline`, add:

```typescript
const PER_CLASS_MIN_ADDITIONAL_WRONG = 2;
const OVERALL_MIN_ADDITIONAL_WRONG = 3;

// Sum of (total - correct) across all claim types, from raw integer counts — so the
// overall regression rule never depends on Math.round(accuracy * total). Tolerates a
// partial record (a baseline category with no entry) by skipping undefined metrics.
export function countWrong(
  perClass: Record<string, { correct: number; total: number } | undefined>,
): number {
  let wrong = 0;
  for (const type of ClaimTypeEnum.options) {
    const m = perClass[type];
    if (!m) continue;
    wrong += m.total - m.correct;
  }
  return wrong;
}
```

- [ ] **Step 4: Run, expect PASS for the `countWrong` block**

```bash
pnpm exec vitest run --config evals/vitest.config.ts claim-classifier/__tests__/score.test.ts -t countWrong
```

Expected: the 3 `countWrong` tests pass. (Other tests in the file may still pass — they don't use `countWrong` yet.)

- [ ] **Step 5: Format + commit**

```bash
pnpm exec prettier --write evals/claim-classifier/score.ts evals/claim-classifier/__tests__/score.test.ts
git add evals/claim-classifier/score.ts evals/claim-classifier/__tests__/score.test.ts
git commit -m "feat(eval-classifier): add countWrong helper for raw-count regression checks"
```

---

### Task 2: Couple both regression rules with a minimum additional-wrong count

**Files:**

- Modify: `evals/claim-classifier/score.ts` (`compareAgainstBaseline`)
- Modify: `evals/claim-classifier/__tests__/score.test.ts` (`makeReport` + the 5 `makeReport`-based tests)

This task changes behavior, so the tests are rewritten first to express the new contract, then the implementation follows.

- [ ] **Step 1: Replace the `makeReport` helper so reports are internally consistent**

In `score.test.ts`, inside `describe("compareAgainstBaseline", …)`, replace the entire existing `makeReport` function (the one taking `{ overallAccuracy, perClaimTypeAccuracy?, totalFixtures? }`) with this count-driven version:

```typescript
// Builds a ScoreReport from per-class {correct,total} counts and DERIVES overallAccuracy
// + totalFixtures from those counts, so a test can never set an overall drop that
// disagrees with the per-class wrong-counts the overall rule now reads.
function makeReport(
  counts: Partial<Record<ClaimTypeLabel, { correct: number; total: number }>>,
): ScoreReport {
  const perClass = {} as ScoreReport["perClaimTypeAccuracy"];
  let totalCorrect = 0;
  let totalCount = 0;
  for (const type of ClaimTypeEnum.options) {
    const provided = counts[type];
    const correct = provided?.correct ?? 0;
    const total = provided?.total ?? 0;
    perClass[type] = { correct, total, accuracy: total === 0 ? 0 : correct / total };
    totalCorrect += correct;
    totalCount += total;
  }
  return {
    totalFixtures: totalCount,
    overallAccuracy: totalCount === 0 ? 0 : totalCorrect / totalCount,
    perClaimTypeAccuracy: perClass,
    meanLatencyMs: 0,
  };
}
```

The `baseline` fixture in this describe block is unchanged (efficacy 5/5, urgency 4/5, `overallAccuracy: 0.9`, `toleranceBps: 200`, `totalFixtures: 10`). Note `countWrong(baseline.perClaimTypeAccuracy) === 1` (only urgency has a wrong fixture).

- [ ] **Step 2: Replace the 5 `makeReport`-based tests with the new-contract tests**

Delete the five `makeReport`-based `it(...)` blocks currently between the `baseline` declaration's close and the end of the describe — i.e. the tests titled "passes when overall accuracy drops by exactly 1pp…", "fails when overall accuracy drops by more than 1pp", "fails on per-class drop only…", "fails on overall drop only…", and "fails with both per-class and overall regressions…". Leave the three `scoreResults`-based tests ("passes when accuracy holds within tolerance", "fails when a claim type drops more than tolerance", "ignores baseline categories with zero samples in the current run") untouched. Replace those five deleted blocks with these **six** new tests:

```typescript
it("per-class: a single-fixture flip on a class does NOT fire (suppressed)", () => {
  // efficacy 5/5 -> 4/5 is a 20pp drop but only +1 wrong; additionalWrong (1) < 2.
  // urgency held at baseline (4/5). Overall additionalWrong = 1 (< 3) so overall is silent too.
  const report = makeReport({
    efficacy: { correct: 4, total: 5 },
    urgency: { correct: 4, total: 5 },
  });
  const out = compareAgainstBaseline(report, baseline);
  expect(out.passed).toBe(true);
  expect(out.regressions).toHaveLength(0);
});

it("per-class: a two-fixture drop on a class fires", () => {
  // efficacy 5/5 -> 3/5: drop 40pp and +2 wrong; additionalWrong (2) >= 2 -> fires.
  const report = makeReport({
    efficacy: { correct: 3, total: 5 },
    urgency: { correct: 4, total: 5 },
  });
  const out = compareAgainstBaseline(report, baseline);
  expect(out.passed).toBe(false);
  expect(out.regressions.join("\n")).toMatch(/efficacy/);
  expect(out.regressions.join("\n")).not.toMatch(/overall/);
});

it("overall: a two-fixture cross-class swing does NOT fire (suppressed)", () => {
  // efficacy +1 wrong, urgency +1 wrong => no class reaches additionalWrong 2,
  // and overall additionalWrong = 2 (< 3). Overall drop is 20pp but is suppressed.
  const report = makeReport({
    efficacy: { correct: 4, total: 5 },
    urgency: { correct: 3, total: 5 },
  });
  const out = compareAgainstBaseline(report, baseline);
  expect(out.passed).toBe(true);
  expect(out.regressions).toHaveLength(0);
});

it("overall: a three-fixture cross-class swing fires (overall only)", () => {
  // efficacy +1, urgency +1, safety-claim +1 (baseline 0/0 so per-class skips it).
  // No class reaches additionalWrong 2; overall additionalWrong = 3 (>= 3) -> overall fires.
  const report = makeReport({
    efficacy: { correct: 4, total: 5 },
    urgency: { correct: 3, total: 5 },
    "safety-claim": { correct: 0, total: 1 },
  });
  const out = compareAgainstBaseline(report, baseline);
  expect(out.passed).toBe(false);
  expect(out.regressions.join("\n")).toMatch(/overall/);
  expect(out.regressions.join("\n")).not.toMatch(/efficacy/);
  expect(out.regressions.join("\n")).not.toMatch(/urgency/);
});

it("overall: an exactly-1pp drop never fires even when many fixtures are wrong (strict >)", () => {
  // 89/100 overall = exactly 1pp below baseline 0.9 -> overallDropBps == 100, not > 100.
  // All wrong fixtures land in `none` (baseline 0/0 -> per-class skips). additionalWrong is
  // large but the drop gate is false, so nothing fires.
  const report = makeReport({ none: { correct: 89, total: 100 } });
  const out = compareAgainstBaseline(report, baseline);
  expect(out.passed).toBe(true);
  expect(out.regressions).toHaveLength(0);
});

it("fires both per-class and overall when a real broad regression occurs", () => {
  // efficacy 2/5: drop 60pp, +3 wrong -> per-class fires. urgency 3/5: +1 wrong.
  // overall additionalWrong = 3 + 1 = 4 (>= 3) and overall drop is large -> overall fires.
  const report = makeReport({
    efficacy: { correct: 2, total: 5 },
    urgency: { correct: 3, total: 5 },
  });
  const out = compareAgainstBaseline(report, baseline);
  expect(out.passed).toBe(false);
  expect(out.regressions.join("\n")).toMatch(/efficacy/);
  expect(out.regressions.join("\n")).toMatch(/overall/);
  expect(out.regressions.length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 3: Run, expect FAIL on the new behavior**

```bash
pnpm exec vitest run --config evals/vitest.config.ts claim-classifier/__tests__/score.test.ts
```

Expected: the new "suppressed" tests FAIL (current code still fires on a 1-fixture per-class drop and on a 2-fixture overall drop), because `compareAgainstBaseline` does not yet apply the min-additional-wrong thresholds. The `countWrong` tests and the three `scoreResults`-based tests still pass.

- [ ] **Step 4: Update `compareAgainstBaseline` to apply both thresholds**

In `evals/claim-classifier/score.ts`, replace the body of `compareAgainstBaseline` (the per-class loop and the overall block) so it reads:

```typescript
export function compareAgainstBaseline(report: ScoreReport, baseline: Baseline): ComparisonResult {
  const regressions: string[] = [];
  const toleranceFraction = baseline.toleranceBps / 10_000;
  for (const type of ClaimTypeEnum.options) {
    const current = report.perClaimTypeAccuracy[type];
    if (current.total === 0) continue;
    const baselineMetric = baseline.perClaimTypeAccuracy[type];
    if (!baselineMetric || baselineMetric.total === 0) continue;
    const drop = baselineMetric.accuracy - current.accuracy;
    // Clamp at 0 so the name matches the semantics: an improved class has no "additional wrong".
    const additionalWrong = Math.max(
      0,
      current.total - current.correct - (baselineMetric.total - baselineMetric.correct),
    );
    // Effective blocking threshold is additionalWrong >= PER_CLASS_MIN_ADDITIONAL_WRONG.
    // The pp drop alone never blocks: at small fixture counts one stochastic flip is a
    // large pp swing but is not statistically meaningful.
    if (drop > toleranceFraction && additionalWrong >= PER_CLASS_MIN_ADDITIONAL_WRONG) {
      regressions.push(
        `${type}: ${(current.accuracy * 100).toFixed(1)}% (current) vs ${(baselineMetric.accuracy * 100).toFixed(1)}% (baseline), drop ${(drop * 100).toFixed(1)}pp > ${(toleranceFraction * 100).toFixed(1)}pp tolerance AND +${additionalWrong} wrong fixtures (>= ${PER_CLASS_MIN_ADDITIONAL_WRONG})`,
      );
    }
  }
  // Integer bps comparison avoids float drift around exact 1pp boundaries.
  const overallDropBps = Math.round((baseline.overallAccuracy - report.overallAccuracy) * 10_000);
  const overallAdditionalWrong = Math.max(
    0,
    countWrong(report.perClaimTypeAccuracy) - countWrong(baseline.perClaimTypeAccuracy),
  );
  // Effective blocking threshold is overallAdditionalWrong >= OVERALL_MIN_ADDITIONAL_WRONG.
  // The 1pp drop is only an early signal; it never blocks on its own.
  if (
    overallDropBps > OVERALL_TOLERANCE_BPS &&
    overallAdditionalWrong >= OVERALL_MIN_ADDITIONAL_WRONG
  ) {
    const overallDropPp = overallDropBps / 100;
    regressions.push(
      `overall: ${(report.overallAccuracy * 100).toFixed(1)}% (current) vs ${(baseline.overallAccuracy * 100).toFixed(1)}% (baseline), drop ${overallDropPp.toFixed(2)}pp > ${(OVERALL_TOLERANCE_BPS / 100).toFixed(2)}pp tolerance AND +${overallAdditionalWrong} wrong fixtures (>= ${OVERALL_MIN_ADDITIONAL_WRONG})`,
    );
  }
  return { passed: regressions.length === 0, regressions };
}
```

- [ ] **Step 5: Run the full eval suite, expect PASS**

```bash
pnpm exec vitest run --config evals/vitest.config.ts
```

Expected: all eval tests pass across all 5 files (the 3 `scoreResults`-based comparison tests, the 6 new comparison tests, the 3 `countWrong` tests, plus the unchanged `scoreResults`, schema, fixtures-shape, load-fixtures, and eval-preflight suites).

- [ ] **Step 6: Format + commit**

```bash
pnpm exec prettier --write evals/claim-classifier/score.ts evals/claim-classifier/__tests__/score.test.ts
git add evals/claim-classifier/score.ts evals/claim-classifier/__tests__/score.test.ts
git commit -m "fix(eval-classifier): require minimum fixture-count delta for per-class and overall regressions"
```

---

### Task 3: Open PR A

**Files:** none (git + GitHub).

- [ ] **Step 1: Final local sweep**

```bash
pnpm exec vitest run --config evals/vitest.config.ts
pnpm exec prettier --check "evals/claim-classifier/score.ts" "evals/claim-classifier/__tests__/score.test.ts"
```

Expected: tests pass; prettier clean.

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin fix-eval-classifier-min-fixture-count
gh pr create --base main --head fix-eval-classifier-min-fixture-count \
  --title "fix(eval-classifier): require minimum fixture-count delta for per-class and overall regressions" \
  --body "$(cat <<'EOF'
## Summary

Couples each accuracy-drop rule in the claim-classifier eval gate with a minimum additional-wrong-fixture count, so a 1–2 fixture stochastic flip no longer false-positives. Eval-only — no production classifier change, no baseline re-lock.

## Effective blocking thresholds

- Per-class fires only when `drop > toleranceFraction AND additionalWrong >= 2`.
- Overall fires only when `overallDropBps > 100 AND overallAdditionalWrong >= 3` (counts derived via the new `countWrong` helper from raw per-class integers).

The gate now blocks only when accuracy drop AND minimum additional wrong-count both indicate regression. This intentionally sacrifices sensitivity to 1–2 fixture movements in exchange for a promotable, non-flaky CI gate. The percentage thresholds (`>2pp` / `>1pp`) are now early signals only; neither blocks on its own.

## Why

The merged gate false-positived on `testimonial` (9 fixtures): one stochastic flip = 11.1pp, which the 2pp tolerance can't absorb. Evaluation showed the overall rule had the same flaw (2 fixtures over 105 ≈ 1.9pp > 1pp). Both rules are now count-coupled.

## Tests

- `countWrong` unit tests (empty / mixed / partial record).
- Per-class: 1-flip suppressed; 2-flip fires.
- Overall: 2-fixture swing suppressed; 3-fixture swing fires (overall-only); exact-1pp drop never fires; broad regression fires both.

## Out of scope

Production `temperature=0` (changes prod behavior, needs baseline re-lock) — tracked in #631 as PR-4. No `baseline.json` change.

## Test plan

- [ ] `pnpm exec vitest run --config evals/vitest.config.ts` — all pass.
- [ ] CI `Eval — Claim Classifier` job runs (path filter includes `evals/claim-classifier/**`).

## Related

- Spec: `docs/superpowers/specs/2026-05-23-eval-gate-readiness-design.md`
- Plan: `docs/superpowers/plans/2026-05-23-eval-gate-readiness.md`
- Predecessor: PR-3 #629 (`d60d475c`); bake/promotion tracked in #631

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: STOP — do not self-merge.** Only check the test-plan boxes after running the commands and seeing them pass. PR B starts only after PR A merges (both touch `score.ts`).

---

## PR B — wire eval typecheck into CI + strict-error cleanup

> Start only after PR A has merged to `main`. Cut a fresh branch off the updated `main`.

### Task 4: Fix strict-mode errors and add the typecheck script

**Files:**

- Modify: `evals/claim-classifier/score.ts` (`scoreResults` only)
- Modify: `evals/claim-classifier/load-fixtures.ts`
- Modify: `evals/claim-classifier/package.json`

- [ ] **Step 1: Branch off updated main + reproduce the failing typecheck**

```bash
git checkout main && git pull --ff-only
git checkout -b chore-eval-classifier-typecheck-ci
pnpm --filter @switchboard/core^... build && pnpm --filter @switchboard/core build
pnpm exec tsc -p evals/tsconfig.json --noEmit
```

Expected: FAIL with `Object is possibly 'undefined'` at `load-fixtures.ts:15` and `score.ts` lines ~23/25/32 (the `scoreResults` `perType` accesses). Note the exact errors reported — they are the only ones to fix.

- [ ] **Step 2: Fix `scoreResults` index typing in `score.ts`**

In `evals/claim-classifier/score.ts`, replace BOTH the `perType` declaration AND the loop that initializes it. `scoreResults` currently starts:

```typescript
const perType: Record<string, { correct: number; total: number; accuracy: number }> = {};
for (const type of ClaimTypeEnum.options) {
  perType[type] = { correct: 0, total: 0, accuracy: 0 };
}
```

Replace those four lines with a single fully-initialized record — every key genuinely present (sound, not an empty-object assertion), so indexed access is typed as defined:

```typescript
const perType = Object.fromEntries(
  ClaimTypeEnum.options.map((type) => [type, { correct: 0, total: 0, accuracy: 0 }]),
) as Record<ClaimTypeLabel, { correct: number; total: number; accuracy: number }>;
```

`ClaimTypeLabel` is already imported at the top of `score.ts` (`import type { Baseline, ClaimTypeLabel } from "./schema.js";`). All `ClaimTypeEnum.options` keys are initialized up front, so the later `perType[r.expected]` / `perType[type]` accesses type-check (finite `ClaimTypeLabel` key union, not `string`) and are sound at runtime. No other line in `scoreResults` changes.

- [ ] **Step 3: Guard the line index in `load-fixtures.ts`**

In `evals/claim-classifier/load-fixtures.ts`, change line 15 from:

```typescript
const line = lines[i].trim();
```

to:

```typescript
const line = (lines[i] ?? "").trim();
```

Behavior is identical (an out-of-range index can't occur inside `i < lines.length`; the `?? ""` only satisfies the type-checker and an empty line is already skipped by the next `if`).

- [ ] **Step 4: Re-run typecheck, expect clean**

```bash
pnpm exec tsc -p evals/tsconfig.json --noEmit
```

Expected: no output (exit 0). If new errors appear in test files added by PR A, fix them the same way (guard or type) — they must be bounded; if a fix is non-mechanical, stop and report.

- [ ] **Step 5: Add a `typecheck` script to the eval package**

In `evals/claim-classifier/package.json`, add a `scripts` block (the file currently has none) so the existing turbo `typecheck` job picks the workspace up:

```json
  "scripts": {
    "typecheck": "tsc -p ../tsconfig.json --noEmit"
  },
```

Place it after the `"type": "module",` line. `../tsconfig.json` is `evals/tsconfig.json` (which `include`s `claim-classifier/**/*.ts` and extends the repo's strict base), resolving the previously-orphaned config.

- [ ] **Step 6: Confirm `pnpm typecheck` now covers evals and passes**

```bash
pnpm typecheck
```

Expected: turbo runs `@switchboard/eval-claim-classifier#typecheck` among the others and the whole command exits 0. If turbo runs the eval typecheck before its dependencies are built and it fails on missing `@switchboard/*` types, add an explicit step to the `eval-classifier` job in `.github/workflows/ci.yml` instead — insert immediately before "Run eval unit tests":

```yaml
- name: Typecheck eval harness
  if: steps.filter.outputs.classifier == 'true' || github.ref == 'refs/heads/main'
  run: pnpm exec tsc -p evals/tsconfig.json --noEmit
```

Only add this CI step if `pnpm typecheck` does not already cover evals cleanly. **Acceptance condition: PR B is complete only if CI demonstrably runs the eval typecheck** — either the existing `typecheck` job's `pnpm typecheck` now includes `@switchboard/eval-claim-classifier#typecheck`, or the explicit step above was added to the `eval-classifier` job. Determine which by inspecting the CI logs of PR B's own run, and state the chosen path explicitly in the PR body (do not assume — confirm from the log).

- [ ] **Step 7: Run the eval test suite (confirm no behavior change)**

```bash
pnpm exec vitest run --config evals/vitest.config.ts
```

Expected: all eval tests still pass — PR B changes types/guards only, not scoring.

- [ ] **Step 8: Format + commit**

```bash
pnpm exec prettier --write evals/claim-classifier/score.ts evals/claim-classifier/load-fixtures.ts
git add evals/claim-classifier/score.ts evals/claim-classifier/load-fixtures.ts evals/claim-classifier/package.json
# include .github/workflows/ci.yml in the add only if you added the CI step in Step 6
git commit -m "chore(eval-classifier): wire eval typecheck into CI + bounded strict-error cleanup"
```

---

### Task 5: Open PR B + bake-clock housekeeping

**Files:** none (git + GitHub).

- [ ] **Step 1: Final sweep**

```bash
pnpm exec tsc -p evals/tsconfig.json --noEmit
pnpm exec vitest run --config evals/vitest.config.ts
pnpm typecheck
```

Expected: all exit 0.

- [ ] **Step 2: Push + open PR B**

```bash
git push -u origin chore-eval-classifier-typecheck-ci
gh pr create --base main --head chore-eval-classifier-typecheck-ci \
  --title "chore(eval-classifier): wire eval typecheck into CI + bounded strict-error cleanup" \
  --body "$(cat <<'EOF'
## Summary

Fixes the pre-existing strict-mode (`noUncheckedIndexedAccess`) errors that blocked a clean `tsc` over the eval harness, and adds a `typecheck` script so the eval workspace is covered by CI. No scoring-behavior change.

## Changes

- `score.ts` `scoreResults`: type `perType` as `Record<ClaimTypeLabel, …>` (full keyed record) so indexed access is defined.
- `load-fixtures.ts`: guard the `lines[i]` access (`?? ""`) — behavior identical.
- `evals/claim-classifier/package.json`: add `typecheck` script (`tsc -p ../tsconfig.json --noEmit`), resolving the previously-orphaned `evals/tsconfig.json`.
- (If needed) explicit typecheck step in the `eval-classifier` CI job.

## Test plan

- [ ] `pnpm exec tsc -p evals/tsconfig.json --noEmit` clean.
- [ ] `pnpm typecheck` covers the eval workspace and passes.
- [ ] **CI proof:** confirmed from this PR's CI logs that the eval typecheck actually runs — path used: _(state one)_ existing `typecheck` job picks up `@switchboard/eval-claim-classifier#typecheck`, OR explicit step in the `eval-classifier` job.
- [ ] `pnpm exec vitest run --config evals/vitest.config.ts` — all pass (no behavior change).

## Related

- Spec: `docs/superpowers/specs/2026-05-23-eval-gate-readiness-design.md`
- Plan: `docs/superpowers/plans/2026-05-23-eval-gate-readiness.md`
- Promotion bake tracked in #631

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Bake-clock housekeeping in #631**

Two distinct milestones — keep them separate in the issue:

- **Gate-stability (informational):** after PR A merges and a `main` run of `Eval — Claim Classifier` is green, note that the gate is no longer known-flaky. This is _not_ the promotion clock.
- **Official 14-day promotion bake:** starts only **after PR B merges and main is green**, because "promotable" requires both robustness (PR A) _and_ static verification (PR B) to have landed — otherwise you'd be baking a gate whose own code isn't yet typechecked in CI. Comment on #631 recording the official bake start date.

Do not add the job to branch protection until: PR A + PR B merged, the official ≥14-day bake is clean with ≥1 real classifier-touching PR running the eval to completion, and zero false-positives.

---

## Step 0 (operational, optional, anytime)

Clearing the existing red on `main`'s HEAD (`d60d475c`) by re-running its `eval-classifier` job runs the _old_ gate logic and may re-flake on `testimonial`. The authoritative green comes from PR A's post-merge `main` run. Treat this as optional cosmetic cleanup; do not block on it.

---

## Self-Review Notes

- **Spec coverage:** PR A per-class rule → Task 2; overall rule + `countWrong` raw-count helper → Tasks 1–2; effective-threshold framing → in-code comments + PR A body (Task 3); residual/tradeoff → documented in spec, surfaced in PR body. PR B strict-error fix + typecheck script + CI coverage → Task 4; lint left out (spec marked optional/stretch). Bake-clock reset → Task 5 Step 3. Step 0 → final section.
- **Placeholder scan:** none — every code/test block is concrete; numeric test constructions are computed against the real baseline (`countWrong(baseline)=1`, `overallAccuracy=0.9`, `toleranceBps=200`).
- **Type/name consistency:** `countWrong` (exported, `score.ts`) used in Task 1 tests, Task 2 impl, and Task 2 overall rule; `PER_CLASS_MIN_ADDITIONAL_WRONG=2` / `OVERALL_MIN_ADDITIONAL_WRONG=3` defined in Task 1, consumed in Task 2; `makeReport` new signature (count-driven) defined in Task 2 Step 1, used by all Task 2 tests; `ClaimTypeLabel` import reused in `score.ts` (PR B) and the test file (PR A).
- **No production change / no baseline re-lock:** confirmed — `baseline.json`, `anthropic-classifier.ts`, `prompt.ts` untouched.
