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
```

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
```

Tell the user to commit this file so it's available for next week's comparison.
