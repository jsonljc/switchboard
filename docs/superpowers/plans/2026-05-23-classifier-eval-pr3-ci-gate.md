# Claim Classifier Eval — PR-3 (CI Gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the locked `evals/claim-classifier/baseline.json` into a path-filtered GitHub Actions job that blocks classifier-touching PRs on three regression conditions (per-class > 2pp drop, overall > 1pp drop, prompt-hash mismatch), with branch-aware secret handling and a 14-day informational bake before promotion to required.

**Architecture:** Five tasks split across (1) `score.ts` rule extension, (2) a new pure-helper module for preflight logic, (3) `run-eval.ts` integration, (4) CI workflow job with `dorny/paths-filter@v3`, (5) smoke + PR + tracking. All non-IO logic lands in pure functions tested with vitest so the harness itself doesn't need to spawn for unit tests.

**Tech Stack:** TypeScript, vitest, GitHub Actions, pnpm workspaces, `dorny/paths-filter@v3`, Anthropic SDK (Haiku 4.5) at eval time only.

**Spec:** `docs/superpowers/specs/2026-05-23-classifier-eval-pr3-design.md` (lives on docs branch `docs-classifier-eval-pr3-spec`; must land on `main` before this plan opens PR-3 — see Pre-flight verification).

**Workstream context.** PR-1 (#611) and PR-2 fixture phase (#619) are MERGED. PR-2 baseline phase (#623) carries a harness bugfix (drop strict-mode `minimum`/`maximum` from the classify_claim tool schema) and is OPEN at plan-write time. This plan **cannot execute** until #623 merges or is rebased into PR-3's base — without that fix, every CI eval call returns `400 invalid_request_error`.

---

## File Structure

**Created in this plan:**

- `evals/claim-classifier/eval-preflight.ts` — pure helpers: `isMainPush(env)`, `comparePromptHash(currentHash, baselineHash)`, `appendStepSummary(message)`. No IO except the optional step-summary writer (gated on `$GITHUB_STEP_SUMMARY` presence). Single responsibility: preflight + CI-environment glue.
- `evals/claim-classifier/__tests__/eval-preflight.test.ts` — covers all branches in the helpers above with temp-file assertions for the step summary.
- `.github/workflows/ci.yml` (modified) — appends one new job `eval-classifier`.

**Modified in this plan:**

- `evals/claim-classifier/score.ts` — extends `ComparisonResult` with overall-accuracy regression and adds the strict `> 0.01` check.
- `evals/claim-classifier/__tests__/score.test.ts` — adds 5 new cases (boundary at exactly 1pp drop, overall-only, per-class-only, both, no-regression).
- `evals/claim-classifier/run-eval.ts` — uses the new helpers; promotes prompt-hash mismatch from warn to fail; routes secret-absence through branch-aware skip/fail.

**Untouched:**

- `evals/claim-classifier/baseline.json` — already locked by #623.
- `evals/claim-classifier/fixtures/**` — already locked by #619 at `FIXTURE_APPROVED_SHA = 9f0d5b8b`.
- `evals/claim-classifier/invoke-classifier.ts`, `load-fixtures.ts`, `schema.ts` — no behavior change needed.
- `packages/core/src/governance/classifier/prompt.ts` — read by the harness; no edit.

**Why a separate `eval-preflight.ts` module:** `run-eval.ts` is a thin script with top-level `await`-style flow. Pulling preflight predicates into pure helpers in their own file (a) keeps `run-eval.ts` small and (b) lets `eval-preflight.test.ts` exercise every branch without spawning Anthropic. This is the testability lever the spec called out ("Extract preflight/branching logic into testable helper(s)").

---

## Pre-flight verification (do this once before Task 1)

- [ ] **Step 1: Spec is reachable from `main`**

The plan and PR body reference the spec path. That path must exist in `main` at the time PR-3 opens.

From the primary repo root:

```bash
git fetch origin main
git ls-tree --name-only origin/main docs/superpowers/specs/2026-05-23-classifier-eval-pr3-design.md
```

Expected: the path is printed.

If not printed, the spec PR (`docs-classifier-eval-pr3-spec` branch / PR #625) has not merged yet. Either merge it first, or strip the spec link out of Task 9's PR body.

- [ ] **Step 2: PR #623 has merged**

```bash
gh pr view 623 --json state,mergedAt --jq '{state, mergedAt}'
```

Expected: `{"state":"MERGED","mergedAt":"..."}`.

If still open, stop. Either wait for merge, or rebase this PR's base onto `feat-claim-classifier-eval-baseline` after coordinating with the user. Without the harness fix in #623, Task 4's local smoke test fails (`400 invalid_request_error`) and Task 7's CI run fails for the same reason.

- [ ] **Step 3: Verify harness fix is on `main`**

```bash
grep -E "minimum|maximum" packages/core/src/governance/classifier/anthropic-classifier.ts
```

Expected: **no output** (the line was `confidence: { type: "number", minimum: 0, maximum: 1 }` pre-#623, fixed to `confidence: { type: "number" }`).

If `minimum` or `maximum` is still present, #623 has not actually landed. Stop.

- [ ] **Step 4: Cut a fresh branch off `main`**

```bash
cd /Users/jasonli/switchboard
git fetch origin main
git checkout main
git pull --ff-only
git checkout -b feat-classifier-eval-pr3-ci-gate
```

All remaining tasks run on this branch.

- [ ] **Step 5: Confirm working tree is clean**

```bash
git status --short
```

Expected: no output.

- [ ] **Step 6: Install + build minimal packages**

```bash
pnpm install
pnpm --filter @switchboard/schemas build
pnpm --filter @switchboard/core build
```

Expected: all builds exit 0. The harness needs these dist artifacts to import from `@switchboard/core` and `@switchboard/schemas`.

---

## Task 1: Add overall-accuracy regression rule to `score.ts`

**Files:**

- Modify: `evals/claim-classifier/score.ts` (extends `compareAgainstBaseline`)
- Modify: `evals/claim-classifier/__tests__/score.test.ts` (5 new cases)

This task is pure refactor + new rule. No harness touch, no CI touch.

- [ ] **Step 1: Add failing tests for the new overall-regression rule**

Open `evals/claim-classifier/__tests__/score.test.ts`. Append the following 5 tests at the end of the existing `describe("compareAgainstBaseline", ...)` block (after the existing "ignores baseline categories with zero samples..." test, before the closing `});` of the describe):

```typescript
it("passes when overall accuracy drops by exactly 1pp (boundary, > not >=)", () => {
  // baseline overall = 0.9. Construct a run at exactly 0.89.
  // Use a wide mix to avoid tripping per-class rules.
  // 89 of 100 fixtures correct: 89/100 = 0.89 (exact 1pp drop from baseline 0.9).
  const results: InvocationResult[] = [];
  // 45 of 50 efficacy correct (90% — matches baseline 100%? No, baseline is 100% with 5/5 — per-class drop = 10pp).
  // Per-class rule would fire. Strategy: use a claim type the baseline has zero samples for.
  // baseline urgency has 4/5 = 80%. Make current urgency 7/10 = 70% (10pp drop from 80% — fires per-class).
  // Cleaner approach: keep all current results in a per-class category absent from baseline so per-class is ignored.
  // baseline lists efficacy (5/5) and urgency (4/5); all other classes are 0/0 in baseline.
  // Run 100 fixtures all of class "safety-claim" — baseline has 0 samples there, so per-class is skipped.
  for (let i = 0; i < 89; i++) results.push(r(`p${i}`, "safety-claim", "safety-claim", true));
  for (let i = 0; i < 11; i++) results.push(r(`f${i}`, "safety-claim", "none", false));
  const report = scoreResults(results);
  expect(report.overallAccuracy).toBeCloseTo(0.89, 5);
  const out = compareAgainstBaseline(report, baseline);
  expect(out.passed).toBe(true); // exact 1pp drop is tolerated (strict >)
  expect(out.regressions).toHaveLength(0);
});

it("fails when overall accuracy drops by more than 1pp", () => {
  // 88 of 100 = 0.88 → 2pp drop from baseline 0.9.
  const results: InvocationResult[] = [];
  for (let i = 0; i < 88; i++) results.push(r(`p${i}`, "safety-claim", "safety-claim", true));
  for (let i = 0; i < 12; i++) results.push(r(`f${i}`, "safety-claim", "none", false));
  const report = scoreResults(results);
  const out = compareAgainstBaseline(report, baseline);
  expect(out.passed).toBe(false);
  expect(out.regressions.join("\n")).toMatch(/overall/);
  expect(out.regressions.join("\n")).toMatch(/2\.0pp/);
});

it("fails on per-class drop only (no overall regression)", () => {
  // baseline efficacy = 100% (5/5). Drop efficacy to 80% (4/5) while keeping overall above 0.89.
  // Mix in enough safety-claim wins to lift overall above baseline-1pp.
  const results: InvocationResult[] = [
    r("e1", "efficacy", "efficacy", true),
    r("e2", "efficacy", "efficacy", true),
    r("e3", "efficacy", "efficacy", true),
    r("e4", "efficacy", "efficacy", true),
    r("e5", "efficacy", "none", false), // efficacy 4/5 = 80% (20pp drop > 2pp)
  ];
  for (let i = 0; i < 95; i++) results.push(r(`s${i}`, "safety-claim", "safety-claim", true));
  const report = scoreResults(results);
  expect(report.overallAccuracy).toBeCloseTo(0.99, 5); // no overall regression
  const out = compareAgainstBaseline(report, baseline);
  expect(out.passed).toBe(false);
  expect(out.regressions.join("\n")).toMatch(/efficacy/);
  expect(out.regressions.join("\n")).not.toMatch(/overall/);
});

it("fails on overall drop only (no per-class regression)", () => {
  // baseline has per-class data only for efficacy (5/5) and urgency (4/5).
  // Run zero efficacy/urgency in the current report so those rules are skipped.
  // Use only safety-claim (baseline = 0/0, per-class skipped) to hit overall < baseline-1pp.
  const results: InvocationResult[] = [];
  for (let i = 0; i < 85; i++) results.push(r(`p${i}`, "safety-claim", "safety-claim", true));
  for (let i = 0; i < 15; i++) results.push(r(`f${i}`, "safety-claim", "none", false));
  const report = scoreResults(results);
  expect(report.overallAccuracy).toBeCloseTo(0.85, 5); // 5pp drop from baseline 0.9
  const out = compareAgainstBaseline(report, baseline);
  expect(out.passed).toBe(false);
  expect(out.regressions.join("\n")).toMatch(/overall/);
});

it("fails with both per-class and overall regressions reported", () => {
  // efficacy drops AND overall drops below 0.89.
  const results: InvocationResult[] = [
    r("e1", "efficacy", "none", false),
    r("e2", "efficacy", "none", false),
    r("e3", "efficacy", "none", false),
    r("e4", "efficacy", "efficacy", true),
    r("e5", "efficacy", "efficacy", true),
  ];
  for (let i = 0; i < 80; i++) results.push(r(`p${i}`, "safety-claim", "safety-claim", true));
  for (let i = 0; i < 15; i++) results.push(r(`f${i}`, "safety-claim", "none", false));
  const report = scoreResults(results);
  expect(report.overallAccuracy).toBeLessThan(0.89); // overall regression fires
  const out = compareAgainstBaseline(report, baseline);
  expect(out.passed).toBe(false);
  expect(out.regressions.join("\n")).toMatch(/efficacy/);
  expect(out.regressions.join("\n")).toMatch(/overall/);
  expect(out.regressions.length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 2: Run tests, expect 4 of 5 new tests to FAIL**

```bash
pnpm exec vitest run --config evals/vitest.config.ts claim-classifier/__tests__/score.test.ts
```

Expected: existing 3 tests PASS. New "boundary at 1pp" test passes (no overall rule exists yet, so it can't fire). The other 4 new tests FAIL with messages like `expected false to be true` or assertion mismatches because `compareAgainstBaseline` doesn't yet check overall.

If any existing test fails, stop and investigate before editing score.ts.

- [ ] **Step 3: Implement the overall-regression rule in `score.ts`**

Open `evals/claim-classifier/score.ts`. Replace the existing `compareAgainstBaseline` function (currently lines 47–63) with:

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
    if (drop > toleranceFraction) {
      regressions.push(
        `${type}: ${(current.accuracy * 100).toFixed(1)}% (current) vs ${(baselineMetric.accuracy * 100).toFixed(1)}% (baseline), drop ${(drop * 100).toFixed(1)}pp > ${(toleranceFraction * 100).toFixed(1)}pp tolerance`,
      );
    }
  }
  const OVERALL_TOLERANCE = 0.01;
  const overallDrop = baseline.overallAccuracy - report.overallAccuracy;
  if (overallDrop > OVERALL_TOLERANCE) {
    regressions.push(
      `overall: ${(report.overallAccuracy * 100).toFixed(1)}% (current) vs ${(baseline.overallAccuracy * 100).toFixed(1)}% (baseline), drop ${(overallDrop * 100).toFixed(1)}pp > ${(OVERALL_TOLERANCE * 100).toFixed(1)}pp tolerance`,
    );
  }
  return { passed: regressions.length === 0, regressions };
}
```

The overall constant is inlined (not added to `Baseline` schema) because changing the baseline schema would require a re-lock of `baseline.json`. If the tolerance ever needs to vary by baseline version, lift it then.

- [ ] **Step 4: Run tests, expect all PASS**

```bash
pnpm exec vitest run --config evals/vitest.config.ts claim-classifier/__tests__/score.test.ts
```

Expected: all 8 tests pass (3 existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add evals/claim-classifier/score.ts evals/claim-classifier/__tests__/score.test.ts
git commit -m "feat(eval-classifier): add overall-accuracy regression rule to score.ts"
```

---

## Task 2: Add `eval-preflight.ts` pure helpers + tests

**Files:**

- Create: `evals/claim-classifier/eval-preflight.ts`
- Create: `evals/claim-classifier/__tests__/eval-preflight.test.ts`

All branching logic for run-eval.ts (branch detection, prompt-hash check, SKIPPED summary write) goes here as pure functions so it's testable without spawning the harness.

- [ ] **Step 1: Write failing tests**

Create `evals/claim-classifier/__tests__/eval-preflight.test.ts` with:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMainPush, comparePromptHash, appendStepSummary } from "../eval-preflight.js";

describe("isMainPush", () => {
  it("returns true on push to main", () => {
    expect(isMainPush({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" })).toBe(true);
  });

  it("returns false on pull_request event (any ref)", () => {
    expect(
      isMainPush({
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REF: "refs/pull/123/merge",
      }),
    ).toBe(false);
    expect(
      isMainPush({
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REF: "refs/heads/main",
      }),
    ).toBe(false);
  });

  it("returns false on push to a non-main branch", () => {
    expect(isMainPush({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feature-x" })).toBe(
      false,
    );
  });

  it("returns false outside CI (env vars absent)", () => {
    expect(isMainPush({})).toBe(false);
  });
});

describe("comparePromptHash", () => {
  it("returns ok=true when hashes match", () => {
    const out = comparePromptHash("abc123", "abc123");
    expect(out.ok).toBe(true);
    expect(out.currentHash).toBe("abc123");
    expect(out.baselineHash).toBe("abc123");
  });

  it("returns ok=false when hashes differ", () => {
    const out = comparePromptHash("abc123", "def456");
    expect(out.ok).toBe(false);
    expect(out.currentHash).toBe("abc123");
    expect(out.baselineHash).toBe("def456");
  });
});

describe("appendStepSummary", () => {
  let dir: string;
  let summaryPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "eval-preflight-"));
    summaryPath = join(dir, "summary.md");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes message + newline to $GITHUB_STEP_SUMMARY when defined", () => {
    appendStepSummary("hello world", { GITHUB_STEP_SUMMARY: summaryPath });
    expect(existsSync(summaryPath)).toBe(true);
    expect(readFileSync(summaryPath, "utf8")).toBe("hello world\n");
  });

  it("appends to existing summary file without truncating", () => {
    appendStepSummary("first line", { GITHUB_STEP_SUMMARY: summaryPath });
    appendStepSummary("second line", { GITHUB_STEP_SUMMARY: summaryPath });
    expect(readFileSync(summaryPath, "utf8")).toBe("first line\nsecond line\n");
  });

  it("is a no-op when $GITHUB_STEP_SUMMARY is absent", () => {
    expect(() => appendStepSummary("ignored", {})).not.toThrow();
    expect(existsSync(summaryPath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm exec vitest run --config evals/vitest.config.ts claim-classifier/__tests__/eval-preflight.test.ts
```

Expected: vitest fails to resolve `../eval-preflight.js` (file doesn't exist yet).

- [ ] **Step 3: Implement the helpers**

Create `evals/claim-classifier/eval-preflight.ts`:

```typescript
import { appendFileSync } from "node:fs";

export function isMainPush(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return env["GITHUB_EVENT_NAME"] === "push" && env["GITHUB_REF"] === "refs/heads/main";
}

export interface PromptHashCheck {
  ok: boolean;
  currentHash: string;
  baselineHash: string;
}

export function comparePromptHash(currentHash: string, baselineHash: string): PromptHashCheck {
  return {
    ok: currentHash === baselineHash,
    currentHash,
    baselineHash,
  };
}

export function appendStepSummary(
  message: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): void {
  const path = env["GITHUB_STEP_SUMMARY"];
  if (!path) return;
  appendFileSync(path, message + "\n");
}
```

Notes:

- `env` is the second parameter on `appendStepSummary` (defaulting to `process.env`) purely to make it injectable for tests. Production callers in `run-eval.ts` pass no second arg.
- Bracket-notation env reads (`env["GITHUB_EVENT_NAME"]`) avoid the noPropertyAccessFromIndexSignature lint complaint that's common in strict-mode TS configs.

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm exec vitest run --config evals/vitest.config.ts claim-classifier/__tests__/eval-preflight.test.ts
```

Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add evals/claim-classifier/eval-preflight.ts evals/claim-classifier/__tests__/eval-preflight.test.ts
git commit -m "feat(eval-classifier): add eval-preflight helpers (isMainPush, comparePromptHash, appendStepSummary)"
```

---

## Task 3: Wire `eval-preflight` into `run-eval.ts`

**Files:**

- Modify: `evals/claim-classifier/run-eval.ts`

Three behavior changes in one task because they share the same control-flow rewrite at the top of `main()`: secret-absence branching, prompt-hash mismatch promotion, and SKIPPED summary writing.

- [ ] **Step 1: Read the current top of `main()` to anchor the edit**

```bash
sed -n '15,25p' evals/claim-classifier/run-eval.ts
sed -n '60,80p' evals/claim-classifier/run-eval.ts
```

You should see (a) the existing `apiKey = process.env["ANTHROPIC_API_KEY"]` block that calls `process.exit(2)` on absence, and (b) the prompt-hash mismatch block that currently calls `console.warn`.

- [ ] **Step 2: Modify the secret-absence branch**

In `evals/claim-classifier/run-eval.ts`, find this block (lines 17–21):

```typescript
const apiKey = process.env["ANTHROPIC_API_KEY"];
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is required");
  process.exit(2);
}
```

Replace with:

```typescript
const apiKey = process.env["ANTHROPIC_API_KEY"];
if (!apiKey) {
  if (isMainPush(process.env)) {
    console.error("claim-classifier eval failed: ANTHROPIC_API_KEY is required on main push");
    process.exit(2);
  }
  const skipMsg = "claim-classifier eval skipped: ANTHROPIC_API_KEY is not available";
  console.log(skipMsg);
  appendStepSummary(skipMsg);
  process.exit(0);
}
```

Then add the import at the top of the file (after the existing imports, before `const __dirname = ...`):

```typescript
import { isMainPush, comparePromptHash, appendStepSummary } from "./eval-preflight.js";
```

- [ ] **Step 3: Promote prompt-hash mismatch from warn to fail**

Find this block (lines 62–68 in the current file):

```typescript
if (baseline.classifierPromptHash !== results[0]?.promptHash) {
  console.warn(
    `\nWARNING: classifier prompt hash changed from baseline\n  baseline: ${baseline.classifierPromptHash}\n  current:  ${results[0]?.promptHash}\n  Run \`pnpm eval:classifier --write-baseline\` to lock the new prompt.`,
  );
}
```

Replace with:

```typescript
const currentHash = results[0]?.promptHash ?? "unknown";
const hashCheck = comparePromptHash(currentHash, baseline.classifierPromptHash);
if (!hashCheck.ok) {
  console.error(
    `\nFAIL: classifier prompt hash changed from baseline\n  baseline: ${hashCheck.baselineHash}\n  current:  ${hashCheck.currentHash}\n  Run \`pnpm eval:classifier --write-baseline\` to lock the new prompt.`,
  );
  process.exit(1);
}
```

The wording flips from `WARNING` to `FAIL`, and the action becomes `process.exit(1)`.

- [ ] **Step 4: Smoke-test locally with the secret present**

```bash
export ANTHROPIC_API_KEY=...   # user provides on request
pnpm eval:classifier
```

Expected: harness runs all 105 fixtures, prints `No regressions against baseline.`, exits 0.

If it exits non-zero with `FAIL: classifier prompt hash changed from baseline`, that's a real regression — investigate (likely the prompt was edited since baseline lock). If it exits 3 with a 400 error, #623's harness fix is missing — stop, re-verify pre-flight Step 3.

- [ ] **Step 5: Smoke-test the skip path (no key, no main push)**

```bash
unset ANTHROPIC_API_KEY
unset GITHUB_EVENT_NAME GITHUB_REF
pnpm eval:classifier
```

Expected output (final two lines):

```
claim-classifier eval skipped: ANTHROPIC_API_KEY is not available
```

Exit code 0 (`echo $?` to confirm).

- [ ] **Step 6: Smoke-test the fail-on-main-push path**

```bash
unset ANTHROPIC_API_KEY
export GITHUB_EVENT_NAME=push
export GITHUB_REF=refs/heads/main
pnpm eval:classifier
echo "exit: $?"
unset GITHUB_EVENT_NAME GITHUB_REF
```

Expected:

```
claim-classifier eval failed: ANTHROPIC_API_KEY is required on main push
exit: 2
```

- [ ] **Step 7: Run the full vitest suite for the eval workspace**

```bash
pnpm exec vitest run --config evals/vitest.config.ts
```

Expected: all tests pass (fixtures-shape: 4, load-fixtures: existing, schema: existing, score: 8, eval-preflight: 10).

- [ ] **Step 8: Commit**

```bash
git add evals/claim-classifier/run-eval.ts
git commit -m "feat(eval-classifier): wire preflight helpers — hash mismatch fails, secret absence branches on main push"
```

---

## Task 4: Add CI workflow job with `dorny/paths-filter`

**Files:**

- Modify: `.github/workflows/ci.yml`

The eval-classifier job is independent of `setup` (doesn't need Postgres or the full build artifact cache — just `pnpm install` + build the two packages it imports).

- [ ] **Step 1: Confirm `pnpm-lock.yaml` is unchanged**

```bash
git diff --stat pnpm-lock.yaml
```

Expected: no diff. This job uses no new npm dependencies; `dorny/paths-filter` is a GitHub Action, not a node module.

- [ ] **Step 2: Append the new job to `.github/workflows/ci.yml`**

The existing file has 9 jobs ending around line 350+. The new job slots in alphabetical-ish order after `docker` or before `secrets`; pick whichever keeps the file most readable. The exact position doesn't affect behavior.

Append (or insert) the following job block. Indentation is 2 spaces (matches the rest of the file). The job name string `Eval — Claim Classifier` is load-bearing — branch protection will reference it exactly:

```yaml
  eval-classifier:
    name: Eval — Claim Classifier
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v6

      - name: Filter classifier-relevant paths
        id: filter
        uses: dorny/paths-filter@v3
        with:
          filters: |
            classifier:
              - '.github/workflows/ci.yml'
              - 'packages/core/src/governance/classifier/**'
              - 'packages/schemas/src/claim-classifier.ts'
              - 'evals/claim-classifier/**'

      - name: Skip notice (no classifier-relevant changes)
        if: steps.filter.outputs.classifier != 'true' && github.event_name == 'pull_request'
        run: echo "Eval — Claim Classifier skipped: no classifier-relevant paths changed in this PR."

      - uses: pnpm/action-setup@v5
        if: steps.filter.outputs.classifier == 'true' || github.event_name == 'push'

      - uses: actions/setup-node@v6
        if: steps.filter.outputs.classifier == 'true' || github.event_name == 'push'
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        if: steps.filter.outputs.classifier == 'true' || github.event_name == 'push'
        run: pnpm install --no-frozen-lockfile

      - name: Build packages required by the harness
        if: steps.filter.outputs.classifier == 'true' || github.event_name == 'push'
        run: pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/core build

      - name: Run claim-classifier eval
        if: steps.filter.outputs.classifier == 'true' || github.event_name == 'push'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: pnpm eval:classifier
```

Design notes:

- The job has no `needs:` — it's independent of `setup`. The eval harness only needs `@switchboard/schemas` + `@switchboard/core` dist artifacts (built inline) and the eval workspace itself.
- The `dorny/paths-filter` step always runs (no `if:` on it) so subsequent steps can read `steps.filter.outputs.classifier`. On PR, the filter compares to the PR base; on push to main, `dorny/paths-filter@v3` compares to the previous commit (its documented `push` behavior).
- Every subsequent step is guarded by `if: steps.filter.outputs.classifier == 'true' || github.event_name == 'push'` so PRs that don't touch classifier paths short-circuit after the filter step. The job still reports green to GitHub (no failure), and branch protection sees a completed check.
- Always running on `push` events (regardless of path filter) ensures `main`-branch enforcement always fires — important so the "fail on main push when secret absent" branch in `run-eval.ts` actually executes after merge.
- `ANTHROPIC_API_KEY` is sourced from `${{ secrets.ANTHROPIC_API_KEY }}`. If the secret is not yet provisioned in repo Settings → Secrets → Actions, the eval step receives an empty string and the harness writes a SKIPPED summary on PRs (or fails on main, as designed). After PR-3 merges, configure the secret before the first push to `main` lands.

- [ ] **Step 3: Verify the YAML parses**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```

Expected: no output. Any parse error means the indentation is off.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(eval-classifier): add eval-classifier job with dorny/paths-filter guard"
```

---

## Task 5: End-to-end smoke + push + open PR + tracking issue

**Files:** none (git + GitHub operations)

- [ ] **Step 1: Final local sanity sweep**

```bash
pnpm exec vitest run --config evals/vitest.config.ts
pnpm typecheck
pnpm format:check
```

Expected: all three exit 0. If `format:check` flags any new file (likely `eval-preflight.ts` or the test file), run `pnpm format` and amend the relevant commit:

```bash
pnpm format
git add -u
git commit --amend --no-edit
```

- [ ] **Step 2: End-to-end smoke — confirm the gate would catch a real regression**

Create a scratch worktree (avoid polluting the working branch):

```bash
git worktree add /tmp/classifier-regression-smoke main
cd /tmp/classifier-regression-smoke
```

Edit `packages/core/src/governance/classifier/prompt.ts` and intentionally degrade the prompt — e.g., add a sentence telling the model to always return `confidence: 0.5` regardless of input, or remove one of the claim type definitions. The exact edit doesn't matter; what matters is that it changes the prompt hash and likely degrades accuracy.

```bash
pnpm --filter @switchboard/core build
export ANTHROPIC_API_KEY=...   # user provides
pnpm eval:classifier
echo "exit: $?"
```

Expected outcomes (any of these confirms the gate works):

1. Exit code 1 with `FAIL: classifier prompt hash changed from baseline` — confirms prompt-hash gate fires.
2. Exit code 1 with `REGRESSIONS:` followed by per-class or overall lines — confirms accuracy gates fire.

Tear down:

```bash
cd /Users/jasonli/switchboard
git worktree remove /tmp/classifier-regression-smoke --force
git worktree prune
```

**Do not commit the degraded prompt anywhere.** The smoke test is purely local.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat-classifier-eval-pr3-ci-gate
```

- [ ] **Step 4: Open PR-3**

```bash
gh pr create --base main --head feat-classifier-eval-pr3-ci-gate \
  --title "feat(eval-classifier): PR-3 CI gate + tightened comparison rules" \
  --body "$(cat <<'EOF'
## Summary

Wires the locked `evals/claim-classifier/baseline.json` into a path-filtered GitHub Actions job. Adds two new regression rules and promotes one warning to a hard fail.

## Changes

- `evals/claim-classifier/score.ts` — new overall-accuracy regression rule (fail if overall drops more than 1pp from baseline).
- `evals/claim-classifier/eval-preflight.ts` (new) — pure helpers: `isMainPush`, `comparePromptHash`, `appendStepSummary`.
- `evals/claim-classifier/run-eval.ts` — prompt-hash mismatch is now a hard fail (was warn-only); secret-absence skips with SKIPPED summary on non-main, fails on main push.
- `.github/workflows/ci.yml` — new `eval-classifier` job with `dorny/paths-filter@v3` guard.
- Tests: 5 new cases in `score.test.ts` (boundary, overall-only, per-class-only, both, no-regression), 10 new cases in `eval-preflight.test.ts`.

## Regression rules (all blocking when the gate runs)

1. Per-class drop > 2pp (existing).
2. Overall accuracy drop > 1pp (new). Strict `>` — exact 1pp drop tolerated.
3. `classifierPromptHash` mismatch between current prompt and `baseline.json` (promoted from warn to fail).

Latency stays informational in v1.

## Secret handling

- PR / non-main contexts: `ANTHROPIC_API_KEY` absent → exit 0, write `claim-classifier eval skipped: ANTHROPIC_API_KEY is not available` to stdout + `$GITHUB_STEP_SUMMARY`. SKIPPED wording, never PASS.
- `main` push: `ANTHROPIC_API_KEY` absent → exit 2.

No `pull_request_target`.

## Promotion to required check — deferred 14 days

This PR lands the job **informational only**. Promotion to a required check happens via GitHub UI after a 14-day bake. Promotion criteria and tracking are captured in a follow-up issue (created at merge time).

## Test plan

- [x] `pnpm exec vitest run --config evals/vitest.config.ts` — all tests pass (existing + 5 new score, + 10 new preflight).
- [x] `pnpm typecheck` clean.
- [x] `pnpm format:check` clean.
- [x] `pnpm eval:classifier` against the locked 105-fixture baseline — no regressions.
- [x] Skip path smoke-tested locally (no key, non-main env) — exits 0 with SKIPPED message.
- [x] Fail-on-main-push path smoke-tested locally — exits 2.
- [x] End-to-end smoke: degraded prompt in scratch worktree triggers gate (exit 1). Scratch worktree discarded.
- [ ] CI run on this PR shows `eval-classifier` job ran (not skipped due to path filter — `ci.yml` is in the path filter).
- [ ] After merge: configure `ANTHROPIC_API_KEY` secret in repo settings if not already present.
- [ ] After merge: open follow-up tracking issue for 14-day bake + branch-protection promotion.

## Hard prerequisite

PR #623 (PR-2 baseline phase + harness strict-mode fix) must have merged before this PR can pass CI. Without #623's fix, every classifier API call returns `400 invalid_request_error`.

## Related

- Spec: `docs/superpowers/specs/2026-05-23-classifier-eval-pr3-design.md`
- Plan: `docs/superpowers/plans/2026-05-23-classifier-eval-pr3-ci-gate.md`
- Workstream: PR-1 #611 (MERGED), PR-2 fixture #619 (MERGED), PR-2 baseline #623 (must be MERGED before this lands)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR number from the output.

- [ ] **Step 5: Verify PR-3's own CI run executed the eval-classifier job**

Wait for CI to start, then:

```bash
gh pr checks <PR#>
```

Expected: `Eval — Claim Classifier` appears in the list (status will be `pending` initially, then `success` or `failure`).

If the job appears as `skipped` (or doesn't appear at all), the path filter is wrong — `.github/workflows/ci.yml` should be in the trigger paths, and this PR modifies that file, so the filter should fire. Stop and fix before merge.

- [ ] **Step 6: After CI completes successfully, open the bake-tracking issue**

````bash
gh issue create --title "Eval — Claim Classifier: 14-day informational bake + branch-protection promotion" --body "$(cat <<'EOF'
## Context

PR-3 (`feat(eval-classifier): PR-3 CI gate + tightened comparison rules`) merged the `eval-classifier` CI job as **informational only**. This issue tracks the 14-day bake and the eventual promotion to a required status check.

## Bake checklist (during the 14-day window)

- [ ] At least one classifier-relevant PR runs the eval to completion with `ANTHROPIC_API_KEY` present (not skipped).
- [ ] Skipped runs on non-classifier PRs visibly show SKIPPED in the GitHub Step Summary.
- [ ] No Anthropic rate-limit / transient 5xx flakes block merges.
- [ ] The 2pp per-class and 1pp overall tolerances do not trip on Haiku non-determinism.

## Promotion criteria (all must hold before adding to branch protection)

- [ ] At least one real classifier-touching PR ran the eval to completion (not skipped).
- [ ] Zero false positives (job blocked merge for non-real regression).
- [ ] No provider/network flake required rerun.
- [ ] Today's date is at least PR-3 merge date + 14 days.

## Promotion action (GitHub UI)

1. Settings → Branches → Branch protection rule for `main` → "Require status checks to pass".
2. Add the exact job name string: `Eval — Claim Classifier`.
3. Verify:

   ```bash
   gh api repos/jsonljc/switchboard/branches/main/protection \
     --jq '.required_status_checks.contexts'
````

Expected output includes `"Eval — Claim Classifier"`.

## Related

- Spec: `docs/superpowers/specs/2026-05-23-classifier-eval-pr3-design.md`
- Plan: `docs/superpowers/plans/2026-05-23-classifier-eval-pr3-ci-gate.md`
- PR-3: <PR#>
  EOF
  )"

```

Replace `<PR#>` with the merged PR number.

- [ ] **Step 7: STOP — do not promote to required at merge time**

Merge happens when reviewers approve. **Do not add the job to branch protection in the same change window.** The tracking issue is the durable artifact that prevents this from being forgotten.

---

## Self-Review Notes

- **Spec coverage:**
  - Spec §Architecture surface 1 (`.github/workflows/ci.yml`) → Task 4.
  - Spec §Architecture surface 2 (`score.ts` overall regression) → Task 1.
  - Spec §Architecture surface 3 (`run-eval.ts` preflight + hash promotion) → Tasks 2 + 3.
  - Spec §Regression rules (per-class, overall, prompt-hash) → Tasks 1 (per-class kept unchanged + overall added) and 3 (hash promotion).
  - Spec §Secret handling (branch-aware split, SKIPPED wording, no pull_request_target) → Tasks 2 + 3 + 4 (the `if: ... || github.event_name == 'push'` is the workflow-level guard that always runs main pushes through the harness, exercising the fail branch).
  - Spec §Bake-to-required plan → Task 5 Steps 6 + 7 + tracking issue body.
  - Spec §Acceptance criteria — every box checked in Task 5 Step 4's PR body or marked as post-merge action item.
- **Placeholder scan:** No TBD/TODO. The `user provides on request` notes in Tasks 3 Step 4 and 5 Step 2 are intentional — the API key must come from the operator, not the plan.
- **Type consistency:** `PromptHashCheck` defined in Task 2, consumed in Task 3 — fields match. `isMainPush(env)` signature stable across Task 2 (definition) and Task 3 (consumption). `appendStepSummary(message, env?)` signature stable; production caller in Task 3 uses 1-arg form.
- **No code duplication:** the SKIPPED message string `"claim-classifier eval skipped: ANTHROPIC_API_KEY is not available"` appears in Task 2 test, Task 3 implementation, Task 4 expected output, and Task 5 PR body — that's the same canonical string, not duplicated logic. Worth a constant if it shifts again later; not worth lifting now.
- **What this plan does NOT do (per spec §Out of scope):** no response cache, no latency gating, no nightly cron, no `pull_request_target`, no branch-protection promotion at merge time, no `packages/schemas/src/index.ts` re-export changes.
```
