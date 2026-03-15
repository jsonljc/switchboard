# `/gate` Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a single `/gate` custom skill with two modes (pre-merge safety verdict and weekly health check), replacing the 3 existing custom skills (arch-guard, refactor-reviewer, health-audit).

**Architecture:** The skill is a single SKILL.md file that instructs Claude to run checks against the git diff (pre-merge mode) or full codebase (weekly mode). No new TypeScript code — the skill leverages existing tools (git diff, arch-check.ts, file reading) and Claude's analysis capabilities. The security backlog is tracked in a markdown checklist; weekly snapshots are saved as JSON.

**Tech Stack:** Claude Code skill (SKILL.md), git, existing `scripts/arch-check.ts`, markdown, JSON

---

## Task 1: Create the `/gate` skill file

**Files:**

- Create: `.claude/skills/gate/SKILL.md`

**Step 1: Write the skill file**

Create `.claude/skills/gate/SKILL.md` with the full skill definition. The skill has two modes triggered by the presence of the `weekly` argument.

```markdown
# gate — Pre-Merge Safety Gate & Weekly Health Check

## Description

Final safety check before merging code. Two modes:

- `/gate` — reviews the current branch diff and gives a ship/hold verdict
- `/gate weekly` — reviews full codebase health with trend tracking

## When to Use

Activate this skill when:

- The user runs `/gate` or `/gate weekly`
- The user says "is this ready to merge?", "can I ship this?", "ready to merge?"
- The user says "how's the codebase?", "health check", "weekly report"
- Before creating a PR or merging to main

## Mode Detection

- If the user says "weekly", "health", "report", or "how's the codebase" -> run Weekly Mode
- Otherwise -> run Pre-Merge Mode

---

## Pre-Merge Mode

### Step 1: Get the diff

Run `git diff main...HEAD --name-only` to get the list of changed files.
If no diff (already on main or no changes), tell the user there's nothing to review.

### Step 2: Read changed files

Read each changed file. For files over 500 lines, focus on the changed sections by running `git diff main...HEAD -- <file>` for each.

### Step 3: Security checks

Scan each changed file for these patterns. Only flag issues in NEW or MODIFIED code (not pre-existing issues).

**3a. Org-scoping gaps:**

- In `apps/api/src/routes/` files: look for database queries (prisma calls, provider calls) where `organizationId` is taken from `request.params` or `request.query` without being verified against `request.organizationIdFromAuth` or `requireOrganizationScope(request, reply)`
- In `packages/db/src/storage/` files: look for `findUnique`, `update`, `delete` calls that use only `id` without including the org filter from `this.orgFilter()` or an `organizationId` constraint
- PASS if: all database queries in routes are org-scoped via `requireOrganizationScope()` or equivalent

**3b. Input validation:**

- Look for `request.body as <Type>` without a preceding Zod `.parse()` or `.safeParse()` call
- Look for `request.query as Record<string, string>` without validation
- PASS if: all request bodies go through Zod validation before use

**3c. Auth checks:**

- In new route files: verify they use auth middleware or are explicitly public (health, webhooks with signature verification)
- Look for string comparison (`===` or `!==`) of secrets, tokens, or API keys — should use `timingSafeEqual`
- PASS if: no unprotected routes and no unsafe string comparisons for secrets

**3d. PII in logs:**

- Look for `console.error`, `console.warn`, `logger.info`, `logger.error` calls that include fields named `email`, `phone`, `ssn`, `name`, `address`, or `password`
- PASS if: no PII fields in log statements

**3e. User-controlled URLs:**

- Look for `fetch()`, `axios`, or HTTP client calls where the URL comes from request parameters, query strings, or body fields
- PASS if: no user-controlled URLs in HTTP calls, or URLs are validated against an allowlist

### Step 4: Architecture checks

**4a. Import boundaries:**

- In `packages/core/` files: flag any import from `@switchboard/digital-ads`, `@switchboard/customer-engagement`, `@switchboard/payments`, `@switchboard/crm`, `@switchboard/quant-trading`, `@switchboard/revenue-growth`, or `@switchboard/db`
- In `cartridges/*/` files: flag any import from `@switchboard/db` or from another cartridge
- In `packages/schemas/` files: flag any `@switchboard/*` import
- PASS if: all imports respect the layer model

**4b. File size:**

- For each modified file, count its total lines
- WARN if > 400 lines
- BLOCK if > 600 lines and file does not have `/* eslint-disable max-lines */`
- PASS if: no files exceed limits

**4c. Test file exists:**

- For each NEW `.ts` file in a `src/` directory (not test, not index, not types), check that a corresponding `__tests__/<name>.test.ts` exists
- PASS if: all new source files have test files

**4d. `.js` extensions:**

- In changed files, check relative imports (`from "./` or `from "../`) for missing `.js` extension
- PASS if: all relative imports have `.js` extensions

**4e. `as any`:**

- Check if the diff introduces new `as any` patterns (look at added lines only via `git diff main...HEAD`)
- PASS if: no new `as any` in the diff

**4f. Cartridge checklist (only if a new cartridge directory exists in the diff):**

- Has `manifest.ts`
- Has `defaults/guardrails.ts`
- Has at least one test file
- Is in the Dockerfile
- Is in `.eslintrc.json` blocklists
- PASS if: not applicable (no new cartridge) or all items present

### Step 5: Completeness checks

**5a. No `console.log`:**

- Check added lines in the diff for `console.log(`
- PASS if: none found

**5b. Typecheck and tests:**

- Check if the user has already run `pnpm typecheck` and `pnpm test` in this session
- If not, suggest running them but do not block (CI will catch these)
- PASS if: already run or user acknowledges

### Step 6: Output verdict

Count all BLOCK-level issues across all categories.

**If zero blockers:**
```

SHIP IT
Security: pass
Architecture: pass
Completeness: pass

```

If there were WARNs (non-blocking), append them:

```

SHIP IT
Security: pass
Architecture: pass (1 warning)
Completeness: pass

Warnings (non-blocking):

- [ARCHITECTURE] apps/chat/src/bootstrap.ts — 535 lines (consider splitting)

```

**If any blockers:**

```

HOLD — N issues to fix

1. [SECURITY] apps/api/src/routes/new-route.ts:34
   -> User input reaches database without org-scoping

2. [COMPLETENESS] apps/chat/src/jobs/new-job.ts
   -> No test file exists for this module

Fix these, then run /gate again.

```

Keep it short. Max 3 bullet points per issue. No essays.

---

## Weekly Mode

### Step 1: Run arch-check

Run: `node --experimental-strip-types scripts/arch-check.ts`
Capture the output.

### Step 2: Load previous snapshot

Read `docs/health/last-report.json`. If it doesn't exist, this is the first run — skip comparison.

### Step 3: Count security backlog

Read `docs/health/security-backlog.md`. Count unchecked items (`- [ ]`) per severity section (Critical, High, Medium, Production Resilience).

### Step 4: Compute current metrics

From the arch-check output, extract:
- `godFiles`: count of files over 400 lines
- `asAnyCount`: total `as any` occurrences
- `packagesWithLowTests`: count of packages with <3 test files

From the security backlog:
- `securityBacklog.critical`: unchecked critical items
- `securityBacklog.high`: unchecked high items

### Step 5: Compute grade

Apply grading logic:
- **A**: `securityBacklog.critical === 0` AND `godFiles` trending down AND no new `as any`
- **B**: `securityBacklog.critical <= 2` AND `godFiles` stable or down
- **C**: `securityBacklog.critical >= 3` AND (`godFiles` growing OR `asAnyCount` growing)
- **D**: security backlog growing AND new god files AND packages with zero tests

Compute trend by comparing to previous snapshot:
- Numbers improved -> "improving"
- Numbers unchanged -> "stable"
- Numbers worsened -> "declining"

### Step 6: Pick top priority

Priority order:
1. Any unchecked Critical security item -> fix that
2. Any unchecked High security item -> fix that
3. God file count increasing -> split the largest one
4. `as any` count increasing -> fix the newest ones
5. Package with zero tests -> add tests

### Step 7: Output report

```

CODEBASE HEALTH: [grade] ([trend])

Trend: [improving/stable/declining] vs [previous date]
Security backlog: [N] critical, [N] high
God files: [N] ([change from last])
as-any count: [N] ([change from last])
Low-test packages: [N]

Top priority this week:
[single most impactful action]

````

### Step 8: Save snapshot

Write the current metrics to `docs/health/last-report.json`:

```json
{
  "date": "YYYY-MM-DD",
  "grade": "B+",
  "godFiles": 14,
  "asAnyCount": 23,
  "securityBacklog": { "critical": 4, "high": 8 },
  "packagesWithLowTests": 3
}
````

Tell the user to commit this file so it's available for next week's comparison.

````

**Step 2: Verify the skill file renders correctly**

Run: `cat .claude/skills/gate/SKILL.md | head -5`
Expected: Shows the skill header

**Step 3: Commit**

```bash
git add .claude/skills/gate/SKILL.md
git commit -m "feat: add /gate skill — pre-merge safety gate and weekly health check"
````

---

## Task 2: Delete the 3 replaced skills

**Files:**

- Delete: `.claude/skills/arch-guard/SKILL.md`
- Delete: `.claude/skills/refactor-reviewer/SKILL.md`
- Delete: `.claude/skills/health-audit/SKILL.md`

**Step 1: Delete the files**

```bash
rm .claude/skills/arch-guard/SKILL.md
rmdir .claude/skills/arch-guard
rm .claude/skills/refactor-reviewer/SKILL.md
rmdir .claude/skills/refactor-reviewer
rm .claude/skills/health-audit/SKILL.md
rmdir .claude/skills/health-audit
```

**Step 2: Verify they're gone**

Run: `ls .claude/skills/`
Expected: Only `gate/` directory remains

**Step 3: Commit**

```bash
git add -A .claude/skills/
git commit -m "chore: remove arch-guard, refactor-reviewer, health-audit skills (replaced by /gate)"
```

---

## Task 3: Seed the initial weekly snapshot

**Files:**

- Create: `docs/health/last-report.json`

**Step 1: Run the first weekly check**

Run `/gate weekly` to generate the initial snapshot. This will:

1. Run `arch-check.ts`
2. Find no previous snapshot (first run)
3. Count the security backlog
4. Output the first health report
5. Save `docs/health/last-report.json`

**Step 2: Verify the snapshot**

Run: `cat docs/health/last-report.json`
Expected: JSON with date, grade, godFiles, asAnyCount, securityBacklog, packagesWithLowTests

**Step 3: Commit**

```bash
git add docs/health/last-report.json
git commit -m "chore: seed initial weekly health snapshot"
```

---

## Task 4: Smoke test `/gate` pre-merge mode

**Step 1: Run `/gate` on the current branch**

Run `/gate` to verify it works against the current `feat/stage-2-outcome-lifecycle` branch diff.

**Step 2: Verify output format**

Expected: Either `SHIP IT` with 3 category statuses, or `HOLD` with specific blockers. The output should be short (under 15 lines).

**Step 3: Fix any issues with the skill definition**

If the output is too verbose, too vague, or checks the wrong things, edit `.claude/skills/gate/SKILL.md` to fix it.

**Step 4: Commit any fixes**

```bash
git add .claude/skills/gate/SKILL.md
git commit -m "fix: refine /gate skill based on smoke test"
```

---

## Implementation Order

```
Task 1: Create /gate skill file         (the core deliverable)
Task 2: Delete replaced skills           (cleanup)
Task 3: Seed initial weekly snapshot      (first run)
Task 4: Smoke test pre-merge mode         (validation)
```

All tasks are sequential — each depends on the previous.

---

## Verification

After all tasks:

1. `ls .claude/skills/` shows only `gate/`
2. `.claude/skills/gate/SKILL.md` exists and is well-formed
3. `docs/health/security-backlog.md` exists with unchecked items
4. `docs/health/last-report.json` exists with valid JSON
5. Running `/gate` produces a short verdict
6. Running `/gate weekly` produces a health report with grade and trends

## Files Summary

| Action | File                                        | Task |
| ------ | ------------------------------------------- | ---- |
| CREATE | `.claude/skills/gate/SKILL.md`              | T1   |
| DELETE | `.claude/skills/arch-guard/SKILL.md`        | T2   |
| DELETE | `.claude/skills/refactor-reviewer/SKILL.md` | T2   |
| DELETE | `.claude/skills/health-audit/SKILL.md`      | T2   |
| CREATE | `docs/health/last-report.json`              | T3   |
