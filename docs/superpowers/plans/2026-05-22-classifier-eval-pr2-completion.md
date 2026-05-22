# Claim Classifier Eval PR-2 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out plan §PR-2 of the claim-classifier eval golden set by landing the 5 neutral fixtures and opening PR-2, then committing the locked baseline to the same PR after fixture review.

**Architecture:** Two phases on the existing branch `feat-claim-classifier-eval-golden-set` in the worktree at `.claude/worktrees/classifier-eval-ci`. Phase A (Tasks 1–4) authors `neutral.jsonl`, runs the existing shape test, and opens PR-2. Phase B (Tasks 5–8) — gated on reviewer approval of fixtures — generates `baseline.json` locally via the PR-1 harness, verifies thresholds, and commits to the same PR. No new code, no harness changes, no schema changes; this is data authoring + lifecycle.

**Tech Stack:** TypeScript, vitest, JSONL fixtures, pnpm workspaces, GitHub CLI (`gh`), Anthropic SDK (Haiku 4.5) for baseline generation in Phase B.

**Spec:** `docs/superpowers/specs/2026-05-22-classifier-eval-pr2-completion-design.md` (lives on docs branch `docs/classifier-eval-pr2-completion-spec`; must land on `main` before this plan opens PR-2 — see Pre-flight verification).

**Vertical note:** Alex/Riley are locked to the medspa / aesthetic-clinic vertical (memory: `project_alex_vertical_medspa`, locked 2026-05-15). The 90 existing fixtures use medspa-specific brand/treatment names. The 5 neutral fixtures intentionally use clinic-themed plain copy (hours, parking, consultations, KL clinic location, language availability) for consistency with the dataset. Do not generalize to non-medspa copy unless the vertical decision is explicitly revisited.

---

## File Structure

**Created in Phase A:**

- `evals/claim-classifier/fixtures/neutral.jsonl` — 5 `none`-class rows (3 SG, 2 MY), all `language: "en"`. Plain operational copy. Picked up automatically by the existing `loadFixtures()` glob in `evals/claim-classifier/load-fixtures.ts`.

**Created in Phase B (post-review):**

- `evals/claim-classifier/baseline.json` — machine-generated. Schema in `evals/claim-classifier/schema.ts` (`BaselineSchema`). Output of `pnpm eval:classifier --write-baseline`.

**No other files change.** The shape test (`evals/claim-classifier/__tests__/fixtures-shape.test.ts`) already iterates `*.jsonl`, so it picks up the new file without modification. Schema (`evals/claim-classifier/schema.ts`) already accepts `"none"` as `expectedClaimType` (positive files include `none`-class boundary rows; verified 2026-05-22).

---

## Pre-flight verification (do this once before Task 1)

- [ ] **Step 1: Worktree exists**

Run from the primary repo root (`/Users/jasonli/switchboard`):

```bash
git worktree list | grep classifier-eval-ci
```

Expected output (paths may vary):

```
/Users/jasonli/switchboard/.claude/worktrees/classifier-eval-ci  220901b8 [feat-claim-classifier-eval-golden-set]
```

If the worktree is missing, stop and ask. Do NOT recreate it — the 6 unpushed commits live on its checked-out branch.

- [ ] **Step 2: Spec is reachable from `main`**

The PR body in Task 4 links the spec path. That path must exist in the repo state reviewers see. The spec lives on docs branch `docs/classifier-eval-pr2-completion-spec` and ships as its own focused PR per CLAUDE.md doctrine ("Specs and plans land on main via focused PRs").

From the primary repo root:

```bash
git fetch origin main
git ls-tree --name-only origin/main docs/superpowers/specs/2026-05-22-classifier-eval-pr2-completion-design.md
```

Expected: the path is printed.

If the path is NOT printed, the spec PR has not merged yet. Stop and either:

1. (Recommended) Merge the spec docs PR into `main` first, then re-run this check.
2. Or proceed without linking the spec in the PR body — strip the spec link out of Task 4 Step 3's body and add the rationale inline instead.

Decision must be made before Task 4. Tasks 1–3 can proceed independently.

- [ ] **Step 3: Move into the worktree**

All remaining tasks run **inside the worktree**:

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/classifier-eval-ci
```

---

# Phase A — Fixture authoring + PR open

### Task 1: Confirm worktree state matches expectations

**Files:** none (verification only)

- [ ] **Step 1: Verify branch + cleanliness**

Run:

```bash
git branch --show-current
git status --short
```

Expected:

```
feat-claim-classifier-eval-golden-set
```

(no output from `git status --short` — clean tree)

If branch is different or tree is dirty, stop and ask.

- [ ] **Step 2: Verify the 6 unpushed commits are present**

Run:

```bash
git log --oneline origin/main..HEAD
```

Expected (exact SHAs may differ if main has been re-fetched; titles must match):

```
220901b8 fix(eval-classifier): apply code-review fixes to golden-set fixtures
a46b8aac test(eval-classifier): add fixtures-directory shape test
93754cf6 feat(eval-classifier): add 15 MY English adversarial fixtures
9fd4496f feat(eval-classifier): add 30 MY English positive fixtures (3 per claim type)
3175a5b0 feat(eval-classifier): add 15 SG English adversarial fixtures (boundary cases)
38a8a362 feat(eval-classifier): add 30 SG English positive fixtures (3 per claim type)
```

If any of the six titled commits is missing, stop and ask.

- [ ] **Step 3: Verify the existing shape test passes against the current 90-row dataset**

Run:

```bash
pnpm exec vitest run evals/claim-classifier/__tests__/fixtures-shape.test.ts
```

Expected: all 4 assertions PASS. The "contains at least 95 fixtures" assertion may fail — it expects ≥95 and current is 100 (90 + 10 smoke), so it should pass. If it fails for any other reason, stop and investigate before adding new fixtures.

---

### Task 2: Author `neutral.jsonl`

**Files:**

- Create: `evals/claim-classifier/fixtures/neutral.jsonl`

- [ ] **Step 1: Read one row from an existing fixture file to confirm format**

Run:

```bash
head -1 evals/claim-classifier/fixtures/sg-positive.jsonl
```

Expected: one line of JSON ending with `}`. Field order: `id`, `text`, `language`, `jurisdiction`, `expectedClaimType`, optional `acceptableClaimTypes`, optional `notes`. Match this exact field ordering in the new file.

- [ ] **Step 2: Create `evals/claim-classifier/fixtures/neutral.jsonl`**

Write exactly these 5 lines (one JSON object per line, trailing newline at EOF, no blank lines):

```jsonl
{"id":"neutral-sg-001","text":"Our clinic is open Tuesday to Sunday, 10am to 7pm. Closed on Mondays and public holidays.","language":"en","jurisdiction":"SG","expectedClaimType":"none","notes":"Operating hours. No claim, no promotional framing."}
{"id":"neutral-sg-002","text":"Complimentary parking is available at Basement 2 of the building.","language":"en","jurisdiction":"SG","expectedClaimType":"none","notes":"Parking logistics. No claim."}
{"id":"neutral-sg-003","text":"You can reach our front desk at +65 6123 4567 or email hello@example.sg.","language":"en","jurisdiction":"SG","expectedClaimType":"none","notes":"Contact details. No claim."}
{"id":"neutral-my-001","text":"Our Kuala Lumpur clinic is located on the third floor of Pavilion Tower 2.","language":"en","jurisdiction":"MY","expectedClaimType":"none","notes":"Address. No claim, no superlatives."}
{"id":"neutral-my-002","text":"Consultations are available in English, Bahasa Malaysia, and Mandarin.","language":"en","jurisdiction":"MY","expectedClaimType":"none","notes":"Service availability. No claim, no outcome promise."}
```

Spec acceptance: each row must use `language: "en"`, `expectedClaimType: "none"`, no promotional framing, no performance claims, no superlatives, no scarcity, no time pressure, no implied outcome promises. The five rows above satisfy this — operating hours, parking, contact, location, language availability.

- [ ] **Step 3: Run the shape test to verify the new file parses and integrates**

Run:

```bash
pnpm exec vitest run evals/claim-classifier/__tests__/fixtures-shape.test.ts
```

Expected: all 4 assertions PASS. Specifically:

- "contains at least 95 fixtures" passes (count is now 105).
- "has at least 3 examples per claim type" passes (`none`-class count rises from 14 → 19).
- "has unique ids" passes (the 5 new IDs are unique).
- "has both SG and MY representation" passes (≥30 each, unchanged).

If any assertion fails, do not commit. Read the failure and fix the file inline.

- [ ] **Step 4: Spot-check via grep**

Run:

```bash
wc -l evals/claim-classifier/fixtures/neutral.jsonl
grep -c '"expectedClaimType":"none"' evals/claim-classifier/fixtures/neutral.jsonl
grep -c '"jurisdiction":"SG"' evals/claim-classifier/fixtures/neutral.jsonl
grep -c '"jurisdiction":"MY"' evals/claim-classifier/fixtures/neutral.jsonl
```

Expected:

```
5 evals/claim-classifier/fixtures/neutral.jsonl
5
3
2
```

If any count is off, fix the file before committing.

- [ ] **Step 5: Commit**

```bash
git add evals/claim-classifier/fixtures/neutral.jsonl
git commit -m "feat(eval-classifier): add 5 neutral none-class fixtures (3 SG, 2 MY)"
```

---

### Task 3: Format + workspace lint sanity

**Files:** none (verification only)

This task exists because CI's lint job runs prettier check and `pnpm lint`; local commits can pass git hooks but fail CI on `pnpm format:check`. See `feedback_ci_prettier_not_in_local_lint.md`.

- [ ] **Step 1: Run format check**

Run from the worktree root:

```bash
pnpm format:check
```

Expected: clean. If prettier flags `neutral.jsonl`, run `pnpm format` and amend the previous commit:

```bash
pnpm format
git add evals/claim-classifier/fixtures/neutral.jsonl
git commit --amend --no-edit
```

Note: JSONL is one-object-per-line by convention. Prettier should leave it alone. If prettier reformats it across multiple lines, the existing four fixture files would have the same problem — check those weren't reformatted either. If prettier wants to mangle JSONL specifically, that's a pre-existing config issue and the right move is to confirm the existing fixtures look the same as they did pre-format-check; stop and ask.

- [ ] **Step 2: Run typecheck on the eval package**

Run:

```bash
pnpm --filter @switchboard/eval-claim-classifier exec tsc --noEmit
```

Expected: no errors. (No TS files changed in this task, but this confirms the workspace is healthy before opening the PR.)

---

### Task 4: Push branch + open PR-2

**Files:** none (git + GitHub operations)

- [ ] **Step 1: Rebase on `origin/main` if needed**

Run:

```bash
git fetch origin main
git log --oneline origin/main..HEAD | head -10
git rebase origin/main
```

Expected: rebase either reports "Current branch is up to date" or completes without conflict. If conflicts occur in any fixture file, abort with `git rebase --abort` and stop — that means `main` has been touched by another classifier-eval change and the situation needs human judgment.

- [ ] **Step 2: Push the branch**

Run:

```bash
git push -u origin feat-claim-classifier-eval-golden-set
```

Expected: branch created on origin, 7 commits pushed (6 existing + 1 neutrals).

- [ ] **Step 3: Open PR-2**

Run from the worktree root:

```bash
gh pr create --base main --head feat-claim-classifier-eval-golden-set --title "feat(eval-classifier): PR-2 SG/MY golden fixtures + neutral none set" --body "$(cat <<'EOF'
## Summary

- 30 SG + 30 MY English positive fixtures (3 per claim type).
- 15 SG + 15 MY English adversarial fixtures (boundary cases).
- 5 neutral `none`-class fixtures (3 SG, 2 MY) covering plain operational copy (hours, parking, contact, location, language availability).
- Fixtures-directory shape integration test (≥95 fixtures, ≥3 per claim type, unique IDs, ≥30 SG and ≥30 MY).
- Code-review fixups across SG/MY positive + adversarial files.

## Out of scope — `baseline.json` intentionally deferred

This PR is the **fixture phase** of plan §PR-2. The locked `baseline.json` is **NOT included** and will be added as a post-review commit to **this same PR** once reviewers approve the fixture set.

Rationale (full design at `docs/superpowers/specs/2026-05-22-classifier-eval-pr2-completion-design.md`):

- The baseline is the regression floor that PR-3 (CI gate) compares against.
- Generating it before fixture review risks baking a flawed example into the floor.
- Splitting puts human dataset judgment strictly before the machine-generated regression-floor step.

**Reviewers: please approve the fixture phase first.** After fixture approval, the baseline commit will land in this PR and should receive only a light mechanical review unless fixture content changes.

## Neutral vs adversarial `none`

Both legitimately use `expectedClaimType: "none"`, but they test different failure modes:

- **Adversarial `none`** — copy that looks claim-like but should be rejected (false-positive traps).
- **Neutral `none`** — ordinary operational copy that should never be classified as a claim.

5 neutral fixtures satisfies the planned minimum; broader neutral coverage is deferred to a later eval-hardening PR.

## Test plan

- [x] `pnpm exec vitest run evals/claim-classifier/__tests__/fixtures-shape.test.ts` passes (105 fixtures, ≥3 per type, unique IDs, SG ≥ 30, MY ≥ 30).
- [x] `pnpm format:check` clean.
- [x] `pnpm --filter @switchboard/eval-claim-classifier exec tsc --noEmit` clean.
- [ ] Reviewer dataset review of the PR-2 fixture set: 90 SG/MY positive/adversarial fixtures + 5 neutral fixtures. (Smoke fixtures are exercised by the harness but were landed in PR #611 and are not in this PR's review scope.)
- [ ] After approval: baseline commit lands on this PR (separate review).

## Related

- Plan: `docs/superpowers/plans/2026-05-16-claim-classifier-eval-ci.md` §PR-2
- Spec: `docs/superpowers/specs/2026-05-22-classifier-eval-pr2-completion-design.md`
- Prerequisite: PR #611 (PR-1 harness + smoke fixtures) — MERGED

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: `gh` prints the PR URL. Capture it.

- [ ] **Step 4: Verify the PR diff includes `neutral.jsonl` and excludes `baseline.json`**

Run (replace `<PR#>` with the number from Step 3 output):

```bash
gh pr diff <PR#> --name-only > /tmp/pr-files.txt
cat /tmp/pr-files.txt
grep -q "evals/claim-classifier/fixtures/neutral.jsonl" /tmp/pr-files.txt && echo "neutral present"
! grep -q "evals/claim-classifier/baseline.json" /tmp/pr-files.txt && echo "baseline absent"
```

Expected: both `neutral present` and `baseline absent` print.

If either fails, stop and investigate. Do NOT proceed.

- [ ] **Step 5: STOP — wait for fixture review**

Phase A is complete. Do not proceed to Phase B until reviewers approve the fixture phase on the PR. Phase B is gated on human review.

- [ ] **Step 6: After reviewer approval — record the approved SHA**

Once reviewers approve the fixture phase, run from the worktree root:

```bash
git rev-parse HEAD
```

Capture the output as `FIXTURE_APPROVED_SHA` and keep it for Phase B Task 5:

```bash
export FIXTURE_APPROVED_SHA=<sha-from-above>
```

This is the load-bearing artifact that lets Phase B verify "no fixture edits since approval." If you skip this step, Phase B cannot reliably prove the fixture set is unchanged.

---

# Phase B — Post-review baseline commit (same PR)

> ⚠️ **GATED:** Only execute Phase B after reviewers approve the fixture phase on PR-2. If reviewers request fixture changes, apply them, run shape test, push, re-request review, and only then proceed to Phase B.

### Task 5: Re-verify fixture state before baseline generation

**Files:** none (verification only)

- [ ] **Step 1: Confirm no fixture edits since approval**

This step uses `FIXTURE_APPROVED_SHA` recorded in Phase A Task 4 Step 6. If you don't have it, stop — you cannot prove fixture-set parity without it. Find the approval comment on the PR, then run `git log` to identify the SHA at that approval time and export it before continuing.

Run:

```bash
echo "Comparing against approved SHA: $FIXTURE_APPROVED_SHA"
git diff --name-only "$FIXTURE_APPROVED_SHA"..HEAD -- evals/claim-classifier/fixtures/
```

Expected: no output (no fixture paths changed since approval).

If any fixture path appears, **stop**: any fixture edit after approval invalidates the baseline. Re-request fixture review on the PR, get fresh approval, update `FIXTURE_APPROVED_SHA` to the new approved HEAD, and only then proceed.

- [ ] **Step 2: Rebase on `main` if needed**

```bash
git fetch origin main
git rebase origin/main
```

Expected: no conflicts. If a conflict occurs in any fixture file, abort and stop.

- [ ] **Step 3: Re-run fixture shape validation**

```bash
pnpm exec vitest run evals/claim-classifier/__tests__/fixtures-shape.test.ts
```

Expected: all 4 assertions PASS.

---

### Task 6: Generate `baseline.json`

**Files:**

- Create: `evals/claim-classifier/baseline.json`

- [ ] **Step 1: Verify `ANTHROPIC_API_KEY` is set**

Run:

```bash
echo "${ANTHROPIC_API_KEY:+set}"
```

Expected: `set`. If empty, export your key before continuing:

```bash
export ANTHROPIC_API_KEY=...
```

Do NOT commit or echo the key value.

- [ ] **Step 2: Run the harness with `--write-baseline`**

From the worktree root:

```bash
pnpm eval:classifier --write-baseline
```

Expected:

```
Loaded 105 fixtures from .../evals/claim-classifier/fixtures
[dots and x's per fixture, one char each]
Baseline written to evals/claim-classifier/baseline.json
```

Estimated cost: ~$0.10 (Haiku 4.5 × ~105 calls). Runtime: a few minutes depending on rate limit.

If the harness exits non-zero, do not commit. Read the error and fix the underlying issue (network, rate limit, fixture parse failure) before retrying.

- [ ] **Step 3: Confirm `baseline.json` exists and parses**

```bash
test -f evals/claim-classifier/baseline.json && echo "exists"
cat evals/claim-classifier/baseline.json | python3 -m json.tool > /dev/null && echo "valid json"
```

Expected: `exists` and `valid json`.

---

### Task 7: Verify baseline against acceptance thresholds

**Files:** none (verification only)

- [ ] **Step 1: Check `classifierPromptHash` matches source-of-truth**

Find the current prompt hash constant:

```bash
grep -E "CLASSIFIER_PROMPT_HASH" packages/core/src/governance/classifier/prompt.ts
```

Read the `classifierPromptHash` field from baseline:

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('evals/claim-classifier/baseline.json','utf8')).classifierPromptHash)"
```

Expected: the two values match exactly.

If they do not match, the harness is running against a different prompt version than what is committed. Stop and investigate before committing the baseline.

- [ ] **Step 2: Check `overallAccuracy >= 0.80`**

```bash
node -e "const b=JSON.parse(require('fs').readFileSync('evals/claim-classifier/baseline.json','utf8'));console.log('overallAccuracy:',b.overallAccuracy);process.exit(b.overallAccuracy >= 0.80 ? 0 : 1)"
```

Expected: prints `overallAccuracy: 0.XX` where the value is ≥ 0.80, and exits 0.

If the value is < 0.80: **do not commit `baseline.json`**. Stop and investigate whether the issue is fixture quality, label correctness, prompt drift, or classifier behavior (per spec §Risks).

- [ ] **Step 3: Check per-class accuracy ≥ 0.70 for any category with ≥3 samples**

```bash
node -e "
const b = JSON.parse(require('fs').readFileSync('evals/claim-classifier/baseline.json','utf8'));
const failed = [];
for (const [cls, m] of Object.entries(b.perClaimTypeAccuracy)) {
  if (m.total >= 3 && m.accuracy < 0.70) failed.push(`\${cls}: \${m.accuracy} (\${m.correct}/\${m.total})`);
}
if (failed.length) { console.error('Below 0.70:', failed); process.exit(1); }
console.log('All classes with >=3 samples meet >=0.70');
"
```

Expected: prints `All classes with >=3 samples meet >=0.70` and exits 0.

If any class is below 0.70: **do not commit `baseline.json`**. Stop and investigate.

---

### Task 8: Commit baseline + re-request review

**Files:**

- Add: `evals/claim-classifier/baseline.json`

- [ ] **Step 1: Stage and commit using the canonical message from plan §Task 14 step 4**

```bash
git add evals/claim-classifier/baseline.json
git commit -m "feat(eval-classifier): lock baseline.json (v1) against current classifier prompt"
```

- [ ] **Step 2: Push the baseline commit**

```bash
git push origin feat-claim-classifier-eval-golden-set
```

Expected: push succeeds; PR-2 picks up the new commit.

- [ ] **Step 3: Re-request review on the PR**

```bash
gh pr comment <PR#> --body "Baseline phase: `baseline.json` generated against the approved fixture set. overallAccuracy and per-class accuracy thresholds verified per spec §Acceptance criteria. Light mechanical review only — fixture content unchanged since approval."
```

Replace `<PR#>` with the PR number from Task 4 Step 3.

- [ ] **Step 4: Verify final PR state**

```bash
gh pr view <PR#> --json title,state,headRefName,commits --jq '{title,state,head:.headRefName,commitCount:(.commits|length)}'
```

Expected:

- `state`: `OPEN`
- `head`: `feat-claim-classifier-eval-golden-set`
- `commitCount`: 8 (6 original + 1 neutrals + 1 baseline)

- [ ] **Step 5: STOP — merge is reviewer/operator decision**

Do not merge in this plan. Merge happens after the baseline review pass approves.

---

## Self-Review Notes

- **Spec coverage:**
  - Spec §"Scope of PR-2 fixture phase" → Tasks 1–4.
  - Spec §"Neutral vs adversarial `none`" → embedded in Task 2 content + PR body.
  - Spec §"Post-review baseline commit, same PR" → Tasks 5–8.
  - Spec §Risks → mitigated via Task 5 Step 1 (fixture-diff-unchanged), Task 7 Steps 1–3 (threshold + hash verify), Task 8 stop-before-merge.
  - Spec §Acceptance criteria (fixture phase) → Task 2 Step 3, Task 3 Steps 1–2, Task 4 Step 4, PR body.
  - Spec §Acceptance criteria (baseline phase) → Tasks 6–8.
- **Placeholder scan:** no TBDs, no "add appropriate error handling," no "implement later." Every code/command block is concrete.
- **Type consistency:** field names (`expectedClaimType`, `language`, `jurisdiction`, `id`, `text`, `notes`) match `FixtureRowSchema` exactly. Baseline fields (`classifierPromptHash`, `overallAccuracy`, `perClaimTypeAccuracy`) match `BaselineSchema` exactly.
- **Note:** Spec §"No new harness behavior" parenthetical says "adversarial fixtures use" `none`. Verified 2026-05-22 on the worktree: `none`-class rows actually live in `sg-positive.jsonl` (6), `my-positive.jsonl` (6), and `smoke.jsonl` (2), not in the adversarial files. The substantive claim (schema accepts `none`, file picked up automatically) still holds. Not worth amending the spec for this one detail.
