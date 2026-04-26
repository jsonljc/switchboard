# Prisma Schema Drift Fix and Recurrence Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the schema-vs-migrations drift on `main` and add a CI-enforced guard so it cannot recur silently.

**Architecture:** One new SQL migration brings a fresh DB up to match the current schema. A new shell script wraps `prisma migrate diff --exit-code` with a clear error message. The script is wired into both CI and the existing `preflight.sh`. A vitest test guards the wrapper itself against silent breakage on Prisma upgrades.

**Tech Stack:** Prisma 6.19.x, vitest 2.1.x, bash, pnpm 9.x, GitHub Actions, PostgreSQL 17 + pgvector locally.

**Spec:** `docs/superpowers/specs/2026-04-26-prisma-drift-fix-and-guard.md`

**Working directory:** This plan must be executed inside the worktree `.worktrees/chore-local-dev-audit-clean/` on branch `chore/local-dev-audit-clean`. Do **not** execute against the main repo checkout — other Claude sessions are working there.

---

## File Structure

**Files to create:**
- `packages/db/prisma/migrations/<timestamp>_add_approval_lifecycle_and_lead_intake_drift/migration.sql` — the catch-up SQL (timestamp determined at generation time by Prisma)
- `scripts/check-prisma-drift.sh` — wrapper around `prisma migrate diff --exit-code` with a clear error message
- `scripts/__tests__/check-prisma-drift.test.ts` — vitest coverage for the wrapper (pass case + fail case)

**Files to modify:**
- `package.json` (root) — add `db:check-drift` script entry
- `scripts/preflight.sh` — add the drift check inside the existing Prisma section
- `.github/workflows/ci.yml` — add a CI step that runs the drift check
- `README.md` — add "Working with the database" subsection
- `CLAUDE.md` — add the rule "schema changes require a migration in the same commit"
- `docs/superpowers/specs/2026-04-26-local-dev-environment-audit.md` — mark F3 resolved with this commit's reference

---

## Prerequisites (run once before Task 1)

- [ ] Verify you are inside the correct worktree:

```bash
cd /Users/jasonli/switchboard/.worktrees/chore-local-dev-audit-clean
git rev-parse --show-toplevel
git branch --show-current
```

Expected output:
```
/Users/jasonli/switchboard/.worktrees/chore-local-dev-audit-clean
chore/local-dev-audit-clean
```

If you see a different branch, **stop and resolve** before continuing — running this plan on the wrong branch will mix this work with other in-flight feature branches.

- [ ] Verify Postgres is running and reachable:

```bash
/opt/homebrew/opt/postgresql@17/bin/pg_isready
```

Expected: `accepting connections` on port 5432. If not, start it: `brew services start postgresql@17`.

- [ ] Verify dependencies are installed in this worktree:

```bash
test -d node_modules && echo "OK"
```

If missing, run `pnpm install --no-frozen-lockfile` (the lockfile in this worktree may be slightly out of date relative to main; that's expected).

---

## Task 1: Generate the catch-up migration

**Files:**
- Create: `packages/db/prisma/migrations/<timestamp>_add_approval_lifecycle_and_lead_intake_drift/migration.sql`

This task does NOT use TDD because the migration is verified end-to-end (Step 6) rather than via unit tests. The verification IS the test.

- [ ] **Step 1: Drop and recreate the local dev database**

```bash
/opt/homebrew/opt/postgresql@17/bin/dropdb switchboard
/opt/homebrew/opt/postgresql@17/bin/createdb -O switchboard switchboard
/opt/homebrew/opt/postgresql@17/bin/psql -d switchboard -c "ALTER USER switchboard WITH PASSWORD 'switchboard';"
```

Expected: `ALTER ROLE` on the last command. No errors on the first two.

- [ ] **Step 2: Apply currently-committed migrations**

```bash
DATABASE_URL="postgresql://switchboard:switchboard@localhost:5432/switchboard" \
  npx --prefix packages/db prisma migrate deploy
```

Expected: prints "N migrations found" and "Applying migration..." for each. Final line: "All migrations have been successfully applied." This brings the DB to the pre-fix state — schema additions like `cancelAtPeriodEnd` are NOT yet in the DB.

- [ ] **Step 3: Generate the diff migration**

```bash
DATABASE_URL="postgresql://switchboard:switchboard@localhost:5432/switchboard" \
  npx --prefix packages/db prisma migrate dev \
  --create-only \
  --name add_approval_lifecycle_and_lead_intake_drift
```

Expected: a new directory under `packages/db/prisma/migrations/` named `<timestamp>_add_approval_lifecycle_and_lead_intake_drift/` containing one file `migration.sql`.

- [ ] **Step 4: Inspect the generated SQL**

```bash
ls packages/db/prisma/migrations/ | tail -1
cat "packages/db/prisma/migrations/$(ls packages/db/prisma/migrations/ | tail -1)/migration.sql"
```

The SQL should contain (in any order, with exact spelling):
- `ALTER TABLE "Contact" ADD COLUMN "leadgenId"`
- `ALTER TABLE "ConversationThread" ADD COLUMN "firstAgentMessageAt"`
- `ALTER TABLE "OrganizationConfig" ADD COLUMN "cancelAtPeriodEnd"`
- `CREATE TABLE "ApprovalLifecycle"`
- `CREATE TABLE "ApprovalRevision"`
- `CREATE TABLE "ExecutableWorkUnit"`
- `CREATE TABLE "DispatchRecord"`
- `CREATE TABLE "WebhookEventLog"`
- `CREATE TABLE "PendingLeadRetry"`
- Several `CREATE INDEX` and `CREATE UNIQUE INDEX` statements on the above

If the SQL contains anything else (other table changes, drops, etc.), **STOP**. `main` may have other unmigrated drift. Investigate what other schema changes were made without migrations before continuing. Do not commit the migration; report findings to the user.

- [ ] **Step 5: Add a comment header to the migration file**

Open the file with `Edit` and prepend before the first SQL line:

```sql
-- Backfill migration: schema additions that previously landed in
-- packages/db/prisma/schema.prisma without their generated migrations.
-- Brings a fresh DB to the same state as one running this branch's schema.

```

(Blank line after the header, before the first `-- AlterTable` comment.)

- [ ] **Step 6: Verify the migration end-to-end**

```bash
/opt/homebrew/opt/postgresql@17/bin/dropdb switchboard
/opt/homebrew/opt/postgresql@17/bin/createdb -O switchboard switchboard
/opt/homebrew/opt/postgresql@17/bin/psql -d switchboard -c "ALTER USER switchboard WITH PASSWORD 'switchboard';"
DATABASE_URL="postgresql://switchboard:switchboard@localhost:5432/switchboard" \
  npx --prefix packages/db prisma migrate deploy
DATABASE_URL="postgresql://switchboard:switchboard@localhost:5432/switchboard" \
  pnpm --filter @switchboard/db seed
pnpm typecheck
```

Expected:
- `migrate deploy`: ends with "All migrations have been successfully applied."
- `seed`: ends with "Seeded 5 knowledge entries for org_dev" and similar success lines, no errors.
- `typecheck`: zero errors.

If any step fails, the migration is wrong. Delete the new migration directory, return to Step 1, and investigate.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/migrations/
git commit -m "$(cat <<'EOF'
chore(db): add catch-up migration for schema drift

Backfills schema additions that landed in schema.prisma without their
matching migrations: 3 columns (Contact.leadgenId,
ConversationThread.firstAgentMessageAt, OrganizationConfig.cancelAtPeriodEnd)
and 6 tables (ApprovalLifecycle, ApprovalRevision, ExecutableWorkUnit,
DispatchRecord, WebhookEventLog, PendingLeadRetry) plus indexes.

A fresh clone running `pnpm db:migrate` will now produce a database that
matches what application code expects. Closes F3 from the local-dev audit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Write failing test for the drift check script

**Files:**
- Create: `scripts/__tests__/check-prisma-drift.test.ts`

- [ ] **Step 1: Confirm where existing scripts/ tests live**

```bash
ls scripts/__tests__/ 2>/dev/null || echo "directory does not exist yet"
find scripts -name "*.test.ts" 2>/dev/null
```

If no `scripts/__tests__/` directory exists, you'll create it as part of Step 2.

- [ ] **Step 2: Write the failing test**

Create `scripts/__tests__/check-prisma-drift.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = "scripts/check-prisma-drift.sh";
const REAL_SCHEMA = "packages/db/prisma/schema.prisma";
const REAL_MIGRATIONS = "packages/db/prisma/migrations";

describe("check-prisma-drift", () => {
  it("exits 0 when schema matches migrations", () => {
    const result = spawnSync("bash", [SCRIPT], {
      encoding: "utf-8",
      cwd: process.cwd(),
    });
    expect(result.status).toBe(0);
  }, 30_000);

  it("exits 2 with 'drift detected' message when schema has an unmigrated model", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "drift-test-"));
    const driftedSchemaPath = join(tmpDir, "schema.prisma");
    const real = readFileSync(REAL_SCHEMA, "utf-8");
    writeFileSync(
      driftedSchemaPath,
      `${real}\n\nmodel TestDriftSentinel {\n  id String @id\n}\n`,
    );

    const result = spawnSync(
      "bash",
      [SCRIPT, driftedSchemaPath, REAL_MIGRATIONS],
      { encoding: "utf-8", cwd: process.cwd() },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("drift detected");
  }, 30_000);
});
```

Note the 30-second timeouts on each test — Prisma boot is slow.

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm vitest run scripts/__tests__/check-prisma-drift.test.ts 2>&1 | tail -20
```

Expected: both tests fail. The likely error is "ENOENT" or "No such file or directory" for `scripts/check-prisma-drift.sh` (because it doesn't exist yet). That's the correct failure mode — confirms the test would catch a missing script.

- [ ] **Step 4: Commit the failing test**

```bash
git add scripts/__tests__/check-prisma-drift.test.ts
git commit -m "$(cat <<'EOF'
test(scripts): add failing test for prisma drift check (TDD)

Test will pass once scripts/check-prisma-drift.sh exists and behaves
per spec: exit 0 on no drift, exit 2 with 'drift detected' on drift.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Implement the drift check script

**Files:**
- Create: `scripts/check-prisma-drift.sh`

- [ ] **Step 1: Create the script**

Write `scripts/check-prisma-drift.sh` with:

```bash
#!/usr/bin/env bash
# =============================================================================
# Prisma Schema Drift Check
# Wraps `prisma migrate diff --exit-code` with a developer-friendly error
# message when the schema has unmigrated changes.
#
# Usage:
#   ./scripts/check-prisma-drift.sh [SCHEMA_PATH] [MIGRATIONS_DIR]
#
# Defaults:
#   SCHEMA_PATH      packages/db/prisma/schema.prisma
#   MIGRATIONS_DIR   packages/db/prisma/migrations
#
# Exit codes:
#   0   no drift
#   2   drift detected
#   *   unexpected error from prisma migrate diff
# =============================================================================

set -uo pipefail

SCHEMA="${1:-packages/db/prisma/schema.prisma}"
MIGRATIONS="${2:-packages/db/prisma/migrations}"

pnpm --filter @switchboard/db exec prisma migrate diff \
  --from-migrations "$MIGRATIONS" \
  --to-schema-datamodel "$SCHEMA" \
  --exit-code > /dev/null 2>&1
status=$?

case $status in
  0)
    echo "OK: no Prisma schema drift detected"
    exit 0
    ;;
  2)
    cat >&2 <<'MSG'
ERROR: Prisma schema drift detected.
schema.prisma defines models or fields that no committed migration creates.
A fresh clone running `pnpm db:migrate` would NOT get these tables/columns.

Fix:
  pnpm --filter @switchboard/db exec prisma migrate dev --name <descriptive-name>
  git add packages/db/prisma/migrations/
  git commit
MSG
    exit 2
    ;;
  *)
    echo "ERROR: prisma migrate diff failed with unexpected status $status" >&2
    exit "$status"
    ;;
esac
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/check-prisma-drift.sh
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
pnpm vitest run scripts/__tests__/check-prisma-drift.test.ts 2>&1 | tail -15
```

Expected: both tests pass. If the pass-case test fails, the catch-up migration from Task 1 is incomplete or buggy — re-run Task 1's verification (Step 6) and investigate. If the fail-case test fails with status 0, the wrapper script is letting drift through silently — debug the bash logic.

- [ ] **Step 4: Smoke-test the script manually**

```bash
bash scripts/check-prisma-drift.sh
```

Expected: prints `OK: no Prisma schema drift detected` and exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-prisma-drift.sh
git commit -m "$(cat <<'EOF'
feat(scripts): add prisma drift check wrapper

Wraps `prisma migrate diff --exit-code` with a developer-friendly error
message and stable exit codes (0 = OK, 2 = drift, other = unexpected).
No database required — diff is computed in-memory from migrations dir
and schema.prisma.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add `pnpm db:check-drift` script entry

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Inspect current `db:*` scripts in root package.json**

```bash
grep -n '"db:' package.json
```

You should see entries like `"db:generate"`, `"db:migrate"`, `"db:seed"`. The new entry will be inserted alongside them.

- [ ] **Step 2: Add the script entry**

Edit `package.json`. Find the `"db:seed"` line and add immediately after it:

```json
    "db:check-drift": "bash scripts/check-prisma-drift.sh",
```

Take care to preserve the existing trailing comma syntax of the file. The end result should look like:

```json
    "db:generate": "pnpm --filter @switchboard/db generate",
    "db:migrate": "pnpm --filter @switchboard/db migrate",
    "db:seed": "pnpm --filter @switchboard/db seed",
    "db:check-drift": "bash scripts/check-prisma-drift.sh",
```

- [ ] **Step 3: Verify the script is wired up**

```bash
pnpm db:check-drift
```

Expected: prints `OK: no Prisma schema drift detected` and exits 0. Same behavior as Task 3 Step 4, just routed through pnpm.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
chore: add pnpm db:check-drift script

Routes the new drift check through pnpm so it composes with the
existing db:generate / db:migrate / db:seed family.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire drift check into `scripts/preflight.sh`

**Files:**
- Modify: `scripts/preflight.sh`

- [ ] **Step 1: Find the existing Prisma section in preflight**

```bash
grep -n "Prisma Client Generation" scripts/preflight.sh
```

Expected: a single match like `"--- Prisma Client Generation & Drift Check ---"`. Note the line number; the drift check will be added to this section.

- [ ] **Step 2: Find a good insertion point inside the Prisma section**

Read the file from the matched line until the next `# ──` section divider:

```bash
sed -n "$(grep -n 'Prisma Client Generation' scripts/preflight.sh | head -1 | cut -d: -f1),/# ── 3/p" scripts/preflight.sh
```

You'll see existing logic that calls `prisma_hash`, runs `db:generate`, and reports `ok` / `warn` / `fail`. The drift check should run AFTER the existing client check and report via the same `ok` / `fail` helpers.

- [ ] **Step 3: Add the drift check**

In the Prisma section, after the existing `db:generate` check completes (after the line containing `else` of the `if [[ "$BEFORE_HASH" != "$AFTER_HASH" ]]` check, or just before the `step_end` of the section), insert:

```bash
# Drift check: schema models/fields without a matching migration?
if bash scripts/check-prisma-drift.sh > /dev/null 2>&1; then
  ok "No Prisma schema drift (migrations cover schema)"
else
  drift_status=$?
  if [[ $drift_status -eq 2 ]]; then
    fail "Prisma schema drift detected — schema has fields/tables not in any migration"
    echo -e "  ${YELLOW}→ Run: pnpm db:check-drift to see details${NC}"
  else
    fail "Prisma drift check errored unexpectedly (status $drift_status)"
  fi
fi
```

To find the exact insertion point, read the file:

```bash
sed -n '/Prisma Client Generation/,/# ── 3/p' scripts/preflight.sh | head -40
```

Insert the drift check block between the closing `fi` of the client-staleness check and the section's `step_end`. If you can't determine the exact line confidently, paste the full Prisma section into your reasoning, decide on the insertion point, then use `Edit` with the unique surrounding context.

- [ ] **Step 4: Verify the preflight section runs**

You don't need to run the entire `preflight.sh` (it does heavy work). Verify the syntax instead:

```bash
bash -n scripts/preflight.sh && echo "preflight.sh syntax OK"
```

Expected: `preflight.sh syntax OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/preflight.sh
git commit -m "$(cat <<'EOF'
chore(preflight): add prisma drift check to launch readiness

Launch preflight now fails when schema.prisma has models/fields not
covered by any migration. Catches the same gap CI catches, in case
preflight is run before pushing.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire drift check into CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Find the Prisma generate step in CI**

```bash
grep -n "prisma generate\|prisma migrate" .github/workflows/ci.yml
```

You'll see at minimum a `Generate Prisma client` step (running `prisma generate`) and a `prisma migrate deploy` step. The drift check belongs after `Generate Prisma client` and before any test step — it does not require the database, just the schema and migrations files.

- [ ] **Step 2: Add the drift check step**

Open `.github/workflows/ci.yml`. Find the step:

```yaml
      - name: Generate Prisma client
        run: pnpm --filter @switchboard/db exec prisma generate
```

Add immediately after it:

```yaml
      - name: Check Prisma schema drift
        run: pnpm db:check-drift
```

Indentation must match the surrounding steps exactly (4 spaces for the `- name`, 8 spaces for `run`). Validate by viewing the diff:

```bash
git diff .github/workflows/ci.yml
```

The new step should sit at the same level as the steps above and below it.

- [ ] **Step 3: Verify YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML OK"
```

Expected: `YAML OK`. If parsing fails, fix indentation.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: add prisma drift check to setup job

PRs that introduce schema additions without matching migrations now
fail CI with a clear pointer to the fix. No DB required for the check
itself — runs in seconds against schema.prisma + migrations dir only.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update README and CLAUDE.md

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Find the Quick Start section in README**

```bash
grep -n "## Quick Start\|### Setup\|### Development" README.md
```

Note the line numbers. The new "Working with the database" subsection will go after the "Development" subsection, before any subsequent top-level `##` heading.

- [ ] **Step 2: Add the README subsection**

Find the closing of the `### Development` subsection in `README.md`. After the `Note:` paragraph about `apps/chat`, insert:

```markdown

### Working with the database

Edits to `packages/db/prisma/schema.prisma` must be paired with a migration in the same commit. After editing the schema:

```bash
pnpm --filter @switchboard/db exec prisma migrate dev --name <descriptive-name>
git add packages/db/prisma/migrations/
```

`pnpm db:check-drift` runs the same validation locally. CI runs it on every PR and blocks merges when drift is detected.
```

(Three backticks on their own lines around the bash block; render the markdown carefully.)

- [ ] **Step 3: Find the Code Basics section in CLAUDE.md**

```bash
grep -n "## Code Basics" CLAUDE.md
```

- [ ] **Step 4: Add the rule to CLAUDE.md**

In `CLAUDE.md`, under `## Code Basics`, add a new bullet near the existing `Run pnpm test and pnpm typecheck before committing` bullet:

```markdown
- Schema changes require a migration in the same commit. Run `pnpm db:check-drift` before committing schema changes.
```

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: document the schema/migration coupling rule

README gets a 'Working with the database' subsection explaining the
edit-schema-then-migrate workflow and pointing at pnpm db:check-drift.
CLAUDE.md gets a one-liner under Code Basics so AI assistants follow
the same rule.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Update audit doc bookkeeping

**Files:**
- Modify: `docs/superpowers/specs/2026-04-26-local-dev-environment-audit.md`

- [ ] **Step 1: Find the F3 finding section**

```bash
grep -n "### F3" docs/superpowers/specs/2026-04-26-local-dev-environment-audit.md
```

- [ ] **Step 2: Mark F3 as resolved**

In the audit doc, edit the F3 section. After the `**Manual fix:**` paragraph, add a new paragraph:

```markdown
**Status:** Resolved on this branch. Catch-up migration committed and recurrence guard wired into CI + preflight. See `docs/superpowers/specs/2026-04-26-prisma-drift-fix-and-guard.md` for the implementation.
```

- [ ] **Step 3: Update the summary table**

In the same doc, find the row in the summary table for F3:

```markdown
| F3 | Unmigrated schema changes on `main` | Blocker | Low (commit migration) |
```

Change it to:

```markdown
| F3 | Unmigrated schema changes on `main` | Blocker | ✅ Resolved |
```

- [ ] **Step 4: Strike through F3 in the recommended fix order**

Find the numbered list at the bottom of the audit doc:

```markdown
1. **F3** — commit the missing migration so other devs don't hit it.
```

Change it to:

```markdown
1. ~~**F3** — commit the missing migration so other devs don't hit it.~~ ✅ Resolved.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-04-26-local-dev-environment-audit.md
git commit -m "$(cat <<'EOF'
docs(audit): mark F3 resolved

Updates the local-dev environment audit to reflect that the schema
drift blocker is closed by the prisma-drift-fix-and-guard work.
F1, F2, F4, F5, F7, F8 were already shipped on this branch.
F6, F9, F10, F11, F12, F13 remain as future work (Spec B and beyond).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run the full drift check via pnpm**

```bash
pnpm db:check-drift
```

Expected: `OK: no Prisma schema drift detected`, exit 0.

- [ ] **Step 2: Run the drift-check tests**

```bash
pnpm vitest run scripts/__tests__/check-prisma-drift.test.ts 2>&1 | tail -10
```

Expected: 2 tests pass.

- [ ] **Step 3: Re-run the chat startup-checks tests (regression check)**

```bash
pnpm --filter @switchboard/chat test -- startup-checks 2>&1 | tail -10
```

Expected: 7 tests pass. (These passed before; this just confirms nothing regressed.)

- [ ] **Step 4: Verify git log shows the expected sequence of commits**

```bash
git log main..HEAD --oneline
```

Expected (from oldest to newest, top-down most recent):
- `docs(audit): mark F3 resolved`
- `docs: document the schema/migration coupling rule`
- `ci: add prisma drift check to setup job`
- `chore(preflight): add prisma drift check to launch readiness`
- `chore: add pnpm db:check-drift script`
- `feat(scripts): add prisma drift check wrapper`
- `test(scripts): add failing test for prisma drift check (TDD)`
- `chore(db): add catch-up migration for schema drift`
- (older commits from earlier in the branch — the audit doc commit `eef187c0`, the audit fixes `96d8d0c7`, and the spec commits)

- [ ] **Step 5: Confirm working tree is clean**

```bash
git status --short
```

Expected: empty output (no staged or unstaged changes).

If everything in Task 9 passes, the implementation is complete.
