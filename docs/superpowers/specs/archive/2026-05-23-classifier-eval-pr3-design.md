# Claim Classifier Eval — PR-3 (CI Gate) Design

**Goal.** Turn the locked `evals/claim-classifier/baseline.json` into a real CI regression gate. PR-3 adds a path-filtered GitHub Actions job that runs the eval harness against the 105 golden fixtures on every classifier-relevant PR, and tightens the comparison rules so the gate blocks on three independent regression conditions: per-class degradation, overall degradation, and stale prompt-vs-baseline hashes.

**Non-goal.** Provider-drift monitoring (no nightly cron in v1). Response caching (deferred — costs are trivial at path-filtered frequency). Latency gating (telemetry only in v1).

**Workstream context.** This is PR-3 of the three-part claim-classifier eval CI rollout.

- PR-1 (#611, harness + smoke fixtures) — **MERGED**.
- PR-2 fixture phase (#619, 90 SG/MY + 5 neutral fixtures) — **MERGED** at `9f0d5b8b` (2026-05-23). This is the `FIXTURE_APPROVED_SHA`.
- PR-2 baseline phase (#623, `baseline.json` + harness strict-mode fix) — **OPEN, awaiting review** as of 2026-05-23.
- PR-3 (this spec) — CI gate + tightened comparison rules.

**Hard prerequisite.** PR-3 depends on PR #623 merging first. #623 carries a real harness bugfix (drop `minimum`/`maximum` from the strict-mode classify_claim tool schema — the Anthropic Messages API rejects those keywords and every CI eval call would 400 without the fix). Do not open PR-3 until #623 merges to main, or rebase PR-3 onto #623's head if working in parallel.

---

## Architecture — 3 surfaces touched

### 1. `.github/workflows/ci.yml`

Add an `eval-classifier` job, sibling to existing `typecheck` / `lint` / `test` jobs. Run it only for classifier-relevant changes:

```
.github/workflows/ci.yml
packages/core/src/governance/classifier/**
packages/schemas/src/claim-classifier.ts
evals/claim-classifier/**
```

The workflow file itself is in the path filter so PR-3 (which modifies `ci.yml`) triggers its own gate at introduction. Side effect: any future `ci.yml` edit unrelated to the classifier also fires the eval. Acceptable cost — `ci.yml` doesn't change often.

**Path-filter mechanism.** GitHub Actions does not support job-level `paths:` directly. Implement path filtering using the repo's existing changed-files / path-filter pattern if one is present; otherwise add a dedicated path-filter step (`dorny/paths-filter@v3` or equivalent) and guard the eval steps with `if: steps.filter.outputs.classifier == 'true'`. **Do not put `paths:` under the job — it will be silently ignored.** Workflow-level `paths:` is also wrong here because we don't want to gate the entire workflow on classifier paths; other jobs still need to run.

**Build set.** The job needs the minimal packages required by `pnpm eval:classifier` — at minimum `@switchboard/schemas` and `@switchboard/core` (verified locally during PR-2 baseline generation: those two builds plus the harness's tsx runtime are sufficient). If the current CI build order requires additional workspace setup, preserve the existing repo convention rather than inventing a classifier-only build path. **No response cache step in v1.**

Job name (exact string, used by branch protection during promotion):

```yaml
eval-classifier:
  name: Eval — Claim Classifier
```

### 2. `evals/claim-classifier/score.ts`

Extend `ComparisonResult` to surface overall-accuracy regression alongside per-class. Keep the existing per-class > 2pp rule unchanged (`toleranceBps: 200`). Add a new failure condition:

```ts
const overallDrop = baseline.overallAccuracy - report.overallAccuracy;
if (overallDrop > 0.01) {
  regressions.push(
    `overall: ${(report.overallAccuracy * 100).toFixed(1)}% (current) vs ${(baseline.overallAccuracy * 100).toFixed(1)}% (baseline), drop ${(overallDrop * 100).toFixed(1)}pp > 1.0pp tolerance`,
  );
}
```

Strict inequality (`>`, not `>=`) so an exact 1pp drop is tolerated. With baseline at 97.1%, the floor is 96.1% (≈1 fixture of 105).

### 3. `evals/claim-classifier/run-eval.ts`

Two behavior changes:

a) **Promote prompt-hash mismatch from warn to hard fail.** Today (lines 64–68) a mismatch only prints a warning. Change to `process.exit(1)` with the same message. Forces baseline regeneration in the same PR as any prompt edit — you cannot ship a prompt change against a stale baseline.

b) **Add branch-aware `ANTHROPIC_API_KEY` absence handling.** Extract the branching predicate into a pure helper so it's cheaply unit-testable without spawning a full eval:

```ts
export function isMainPush(env: NodeJS.ProcessEnv): boolean {
  return env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF === "refs/heads/main";
}
```

In `main()`:

```ts
if (!apiKey) {
  if (isMainPush(process.env)) {
    console.error("claim-classifier eval failed: ANTHROPIC_API_KEY is required on main push");
    process.exit(2);
  }
  const msg = "claim-classifier eval skipped: ANTHROPIC_API_KEY is not available";
  console.log(msg);
  appendToGitHubStepSummary(msg); // wraps fs.appendFileSync to $GITHUB_STEP_SUMMARY when defined
  process.exit(0);
}
```

The skip path must use SKIPPED wording, never PASS wording, so a green-but-skipped job cannot be mistaken for a successful gate.

---

## Regression rules — all blocking when the gate runs

These rules apply only after preflight passes. A missing `ANTHROPIC_API_KEY` in PR / non-main contexts produces SKIPPED, not PASS or FAIL — the rules below do not evaluate at all in that case.

1. **Per-class drop > 2pp.** Existing rule in `score.ts`. Drop = `baseline.perClass[c].accuracy - current.perClass[c].accuracy`.
2. **Overall drop > 1pp.** New rule. Drop = `baseline.overallAccuracy - current.overallAccuracy`. Strict `>`.
3. **`classifierPromptHash` mismatch.** Promoted from warn to fail. Current prompt hash (computed at runtime in `packages/core/src/governance/classifier/prompt.ts`) must equal `baseline.classifierPromptHash`. Implement as a small pure helper that returns a result rather than throwing, so tests don't need to spawn the harness:

   ```ts
   export interface PromptHashCheck {
     ok: boolean;
     currentHash: string;
     baselineHash: string;
   }
   export function comparePromptHash(currentHash: string, baselineHash: string): PromptHashCheck;
   ```

   `run-eval.ts` calls `comparePromptHash(...)` and exits 1 with the existing warning message if `!ok`.

Latency is printed but stays informational in v1 — too noisy to gate on at fixture scale, and `score.ts` already reports `meanLatencyMs` for visibility.

---

## Secret handling

Branch-aware split:

- **PR / non-main contexts:** if `ANTHROPIC_API_KEY` is empty, exit 0, print `claim-classifier eval skipped: ANTHROPIC_API_KEY is not available` to stdout, and append the same line to `$GITHUB_STEP_SUMMARY`. The job must use SKIPPED wording, not PASS wording. Fork PRs from untrusted forks don't block. First-time setup before the secret is provisioned doesn't block.
- **Main push:** if `ANTHROPIC_API_KEY` is empty, exit 2 with a hard error. Prevents the gate from silently no-op'ing after merge if the secret is ever rotated or removed.

Detection (in `run-eval.ts`):

```ts
const isMainPush =
  process.env.GITHUB_EVENT_NAME === "push" && process.env.GITHUB_REF === "refs/heads/main";
```

If `!process.env.ANTHROPIC_API_KEY && isMainPush` → fail.
If `!process.env.ANTHROPIC_API_KEY && !isMainPush` → skip.

`run-eval.ts` cannot directly query GitHub branch protection. If `release/*` or other protected branches ever need enforcement, extend the allowlist:

```ts
const ENFORCED_REFS = new Set(["refs/heads/main"]);
```

**No `pull_request_target`.** Do not inject secrets into fork-PR execution.

---

## Bake-to-required plan

1. **PR-3 lands with the job informational only.** Do not add it to branch protection at merge time.

2. **Bake for 14 days after PR-3 merges.** During bake, confirm:
   - the job fires on classifier-relevant PRs;
   - at least one run completes with `ANTHROPIC_API_KEY` present (not skipped);
   - skipped runs are visibly marked SKIPPED in the GitHub Step Summary;
   - no Anthropic rate-limit or transient 5xx flakes create false failures;
   - the 2pp per-class and 1pp overall tolerances do not trip on Haiku non-determinism.

3. **Promotion criteria — all must hold:**
   - at least one real classifier-touching PR ran the eval to completion;
   - the successful bake run was not skipped;
   - zero false positives (job blocked merge for non-real regression);
   - no provider/network flake requiring rerun;
   - promotion date is at least PR-3 merge date + 14 days.

4. **Promotion is separate from PR-3.** Non-coding step done by a human via GitHub UI:
   Settings → Branches → Branch protection for `main` → add the exact job name `Eval — Claim Classifier` to required checks.

5. **Verify:**

   ```bash
   gh api repos/jsonljc/switchboard/branches/main/protection \
     --jq '.required_status_checks.contexts'
   ```

   Expected output includes `"Eval — Claim Classifier"`.

6. **Tracking:** create a GitHub issue at PR-3 merge time with the promotion checklist and a target date. Memory entries are not durable enough for an engineering control.

---

## Scope

### In scope (PR-3)

| File                                                | Change                                                                                                                                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                          | Add `eval-classifier` job (paths-filter + steps).                                                                                                                                                                                                   |
| `evals/claim-classifier/score.ts`                   | Extend `ComparisonResult` to surface overall-accuracy regression; add `overall > 1pp` failure. Keep per-class > 2pp rule unchanged.                                                                                                                 |
| `evals/claim-classifier/run-eval.ts`                | Promote prompt-hash mismatch from warn to hard fail. Add branch-aware `ANTHROPIC_API_KEY` handling using `GITHUB_EVENT_NAME + GITHUB_REF`. Extract preflight/branching logic into testable helper(s).                                               |
| `evals/claim-classifier/__tests__/score.test.ts`    | Add coverage for: 1) no regression; 2) **exactly 1pp overall drop does not fail** (boundary); 3) overall-only regression above 1pp; 4) per-class-only regression; 5) both regressions present.                                                      |
| `evals/claim-classifier/__tests__/run-eval.test.ts` | Add or extend tests for: main push + missing secret = fail; non-main / PR + missing secret = skip; secret present = continue; prompt-hash match = continue; prompt-hash mismatch = fail; **skipped run emits SKIPPED wording and no PASS wording**. |

LOC estimate: ~155 across 3 source files + 2 test files. No new dependencies. No schema migrations.

### Explicitly out of scope

- **Response cache.** Dropped for v1. Cost is trivial at path-filtered frequency. Add later only if CI runtime/cost becomes material.
- **Latency gating.** Latency remains telemetry only in v1.
- **Nightly cron on main.** Deferred. This gate is for code/prompt regression, not continuous provider-drift monitoring. Path-filtered PR/push CI covers code and prompt changes; it does not continuously detect provider-side drift, but that is acceptable for v1.
- **`pull_request_target`.** Rejected. Do not inject secrets into fork-PR execution.
- **Branch-protection promotion.** Separate non-coding step after the 14-day bake. Track via GitHub issue or calendar reminder.
- **`packages/schemas/src/index.ts` re-export changes.** Out of scope unless implementation discovers the eval build needs it.

---

## Testing strategy

1. **Existing tests must still pass:** `pnpm exec vitest run --config evals/vitest.config.ts`.
2. **New unit coverage in `score.test.ts`** (5 cases listed under In Scope).
3. **New unit coverage for the branching logic** in `run-eval.test.ts` (6 cases listed under In Scope), driven by a pure helper (`isMainPush(env)` or similar).
4. **End-to-end smoke** (kept from Task 19 of the original umbrella plan): in a scratch branch, intentionally degrade the prompt → confirm the harness exits non-zero with regression output → discard scratch branch. Do not commit the degraded prompt.
5. **Self-bootstrap check:** when PR-3's own CI run completes, confirm the `eval-classifier` job actually executed (not skipped due to path-filter miss). If it shows skipped, the path filter is wrong; fix before merge.

---

## Acceptance criteria

PR-3 is ready to merge when all of the following hold:

- [ ] PR #623 has merged to main (or PR-3 is rebased onto its head).
- [ ] `.github/workflows/ci.yml` contains the `eval-classifier` job with the exact path filter listed in §Architecture.
- [ ] `score.ts` `compareAgainstBaseline` returns regressions for: per-class > 2pp drop, overall > 1pp drop. Both can fire independently.
- [ ] `run-eval.ts` exits non-zero on prompt-hash mismatch (no longer warn-only).
- [ ] `run-eval.ts` skips with SKIPPED wording when secret is absent on non-main contexts; fails when secret is absent on main push.
- [ ] All 5 new `score.test.ts` cases pass, including the exact-1pp boundary test.
- [ ] All 6 new `run-eval.test.ts` cases pass, including the "skipped ≠ pass" wording assertion.
- [ ] PR-3's own CI run shows the `eval-classifier` job ran (not skipped due to path filter).
- [ ] End-to-end smoke test executed once locally; degraded-prompt branch discarded.
- [ ] A missing-secret dry run writes the SKIPPED message to `$GITHUB_STEP_SUMMARY` when that env var is defined — verified either by a unit test that points the helper at a temp file or by an actual CI run in a no-secret context.
- [ ] GitHub issue created with promotion checklist + target date (merge + 14 days).

---

## Risks

- **Haiku non-determinism within tolerance.** The classifier had high accuracy on the baseline run (97.1%), but that proves accuracy on one run, not repeatability across runs. If a model update or sampling variability introduces 1–2pp run-to-run drift, the gate could false-positive. Mitigation: bake period observes this directly; if real drift fires the gate, widen tolerance with explicit justification rather than disabling the rule.
- **Anthropic rate-limit / transient 5xx during CI.** `run-eval.ts` today exits 3 on any per-fixture API failure (line 35–36), which would block the gate even on transient errors. Out of scope for PR-3 (no retry logic added), but worth flagging — if this becomes a real problem during bake, add `p-retry`-style logic in a follow-up. Until then, manual rerun of the failing job is the workaround.
- **Path filter false negatives.** A change in `packages/schemas/src/index.ts` re-exports or in a shared util that the classifier transitively imports could affect classifier behavior without triggering the eval. Acceptable for v1; widen the filter only if a post-bake real miss demonstrates the gap. Adding indirect dependencies pre-emptively grows the trigger surface fast and erodes the path-filter's value.
- **Stale baseline on main after a prompt change rebase.** Rule 3 (prompt-hash mismatch fails) is what prevents this. Bake will exercise this on the first prompt edit.

---

## Open questions

None at spec-lock time. All design decisions resolved during brainstorming.
