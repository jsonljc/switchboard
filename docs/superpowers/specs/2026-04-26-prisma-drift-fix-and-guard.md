# Prisma Schema Drift Fix and Recurrence Guard (Spec A)

**Date:** 2026-04-26
**Branch:** `chore/local-dev-audit-clean`
**Closes:** F3 in `2026-04-26-local-dev-environment-audit.md`
**Sequenced before:** Spec B (env hygiene — F6, F10, F11, F12) which will be written after this ships.

---

## Problem

`packages/db/prisma/schema.prisma` defines models and fields that no committed migration creates. A fresh clone running `pnpm db:migrate` ends up with a database missing:

- Columns: `Contact.leadgenId`, `ConversationThread.firstAgentMessageAt`, `OrganizationConfig.cancelAtPeriodEnd`
- Tables: `ApprovalLifecycle`, `ApprovalRevision`, `ExecutableWorkUnit`, `DispatchRecord`, `WebhookEventLog`, `PendingLeadRetry`
- Indexes on the above

The first request that hits any of them fails with `column ... does not exist` or `relation ... does not exist`. These additions are already on `main` — they were added to the schema directly without running `prisma migrate dev` to generate the matching SQL.

---

## Goals

1. Bring `main`'s migrations into sync with `main`'s schema so a fresh clone works end-to-end.
2. Add a recurrence guard so the same drift cannot land silently again.

This spec is intentionally focused on F3 only. The remaining audit findings (F6, F10, F11, F12) are deferred to Spec B, written after this implements. F9 (per-app `.env.example`) and F13 (dashboard fallback UI) are dropped from scope entirely.

---

## Non-Goals

- Restructuring existing migration history.
- Pre-commit husky hook for the drift check (CI is sufficient; pre-commit creates friction that gets bypassed).
- Anything in Spec B.

---

## Design

### Component 1 — The catch-up migration

A new migration at `packages/db/prisma/migrations/<timestamp>_add_approval_lifecycle_and_lead_intake_drift/migration.sql`.

**Generation procedure during implementation (mandatory, do not reuse pre-existing SQL):**

1. From a clean state of this branch, drop the local dev database: `dropdb switchboard && createdb -O switchboard switchboard`.
2. Apply all currently-committed migrations: `pnpm db:migrate` (this brings the DB to the pre-fix state).
3. Generate the diff: `pnpm --filter @switchboard/db exec prisma migrate dev --create-only --name add_approval_lifecycle_and_lead_intake_drift`.
4. Inspect the generated SQL. It should contain ~3 `ADD COLUMN`, ~6 `CREATE TABLE`, and the corresponding indexes. If it contains anything else, stop and investigate — `main` may have other unmigrated drift that we missed.
5. Add a comment header to the SQL file explaining this is a backfill of schema additions that landed without their migrations.

This procedure ensures the SQL is current as of the implementation date, not stale from when the audit was written.

**Verification before commit (mandatory):**

1. Drop the local dev database again.
2. `pnpm db:migrate` — applies all migrations including the new one.
3. `pnpm db:seed` — completes without errors.
4. `pnpm typecheck` — proves no Prisma-client/schema mismatch.
5. Boot `apps/api` and `apps/dashboard`; load `localhost:3002/dashboard` and confirm data renders without database errors.

If any step fails, the migration is wrong — debug and regenerate.

### Component 2 — The drift guard

A new shell script `scripts/check-prisma-drift.sh` that runs:

```bash
pnpm --filter @switchboard/db exec prisma migrate diff \
  --from-migrations packages/db/prisma/migrations \
  --to-schema-datamodel packages/db/prisma/schema.prisma \
  --exit-code
```

`prisma migrate diff` computes the difference between the cumulative migration history and the current schema in-memory. With `--exit-code`, exit 2 means drift exists. **No database connection required.**

On detected drift, the wrapper script prints:

```
ERROR: Prisma schema drift detected.
schema.prisma defines models or fields that no committed migration creates.
A fresh clone running `pnpm db:migrate` would NOT get these tables/columns.

Fix:
  pnpm --filter @switchboard/db exec prisma migrate dev --name <descriptive-name>
  git add packages/db/prisma/migrations/
  git commit
```

Exposed as `pnpm db:check-drift` via a script entry in the root `package.json`.

**Wired in two places:**

1. **`.github/workflows/ci.yml`** — added in the `setup` job after `prisma generate` and before tests. PR-blocking.
2. **`scripts/preflight.sh`** — added inside the existing "Prisma Client Generation & Drift Check" section.

Pre-commit hook intentionally skipped — CI catches the same drift before merge with zero developer friction; `pnpm db:check-drift` is available locally for fast feedback when wanted.

### Component 3 — Test for the guard

`scripts/__tests__/check-prisma-drift.test.ts` (vitest, picked up by the existing test runner).

1. **Pass case:** runs the check against the real `packages/db/prisma/schema.prisma` and `packages/db/prisma/migrations/`. Expects exit code 0. This regression-tests both the script and the actual repo state.
2. **Fail case:** writes a temporary schema fixture that adds a model the migrations don't create. Runs the check against the fixture + the real migrations dir. Expects exit code 2 and stderr containing the substring `drift detected`.

This is the polish step: without it, a future Prisma CLI change could silently break the guard's exit-code contract.

### Component 4 — Documentation

Two short additions, ~3–5 lines each:

1. **`README.md`** — under "Quick Start", add a "Working with the database" subsection: "Edits to `packages/db/prisma/schema.prisma` must be paired with a migration. After editing the schema, run `pnpm --filter @switchboard/db exec prisma migrate dev --name <descriptive>`. CI runs `pnpm db:check-drift` and blocks PRs that violate this."
2. **`CLAUDE.md`** — under "Code Basics", add: "Schema changes require a migration in the same commit. Run `pnpm db:check-drift` before committing schema changes."

### Component 5 — Audit doc bookkeeping

Update `docs/superpowers/specs/2026-04-26-local-dev-environment-audit.md`:

- F3 marked **Resolved** with reference to this spec's commit hash (filled in at implementation time).
- The summary table for F3 gets a "Resolved on this branch" note.
- Recommended fix order at the bottom strikes through F3.

This keeps the audit doc as an accurate point-in-time record.

---

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Pre-commit husky hook | Friction on every schema edit; bypassable; CI provides equivalent guarantee |
| Squash all migrations into a baseline | Loses history; doesn't prevent recurrence; large unrelated diff |
| Custom ESLint plugin | Heavy infra for a one-line `prisma migrate diff` check |
| `prisma migrate status` | Wrong direction — checks DB-vs-migrations, not migrations-vs-schema |
| Inline the diff command in three places (no shared script) | Duplication of error message; harder to keep in sync |
| Reuse the SQL we generated in the audit session | Pre-generated SQL may be stale relative to current `main`; regenerating during implementation is cheap insurance |

---

## Risks

1. **The generated migration may pick up additional unexpected drift.** Mitigation: Component 1 step 4 explicitly says to inspect the SQL and stop if anything beyond the expected items appears. That escalates the issue rather than papering over it.
2. **`prisma migrate diff` output format may change between Prisma versions.** Mitigation: the test in Component 3 asserts on exit code (stable contract) and a substring of the message (`drift detected`) that we control in our wrapper script. We do not parse Prisma's stdout.
3. **CI runs against `pgvector/pgvector:pg16` while local dev now runs `postgresql@17`.** Pre-existing inconsistency outside this spec's scope. The catch-up migration is plain SQL with no version-specific syntax — it applies cleanly to both.

---

## Acceptance criteria

- A fresh clone of this branch (after the implementation lands), running the documented setup (Postgres 17 + pgvector + `setup-env.sh` + `pnpm db:migrate` + `pnpm db:seed`), ends with a working dashboard at `localhost:3002`.
- `pnpm db:check-drift` against the post-implementation repo state exits 0.
- Editing `schema.prisma` to add a new model and re-running `pnpm db:check-drift` exits 2 with the documented error message.
- The CI job fails on a PR that introduces drift.
- The audit doc shows F3 as resolved.

---

## Follow-up: Spec B (queued, not written yet)

Spec B will cover the remaining open audit findings — F6 (env consistency check), F10 (DEV_BYPASS_AUTH standalone), F11 (CREATEDB documentation), F12 (db-unstick script for stuck migration locks). It will be written after Spec A implements, so it benefits from the conventions and lessons learned during Spec A's implementation. F9 (per-app `.env.example`) and F13 (dashboard fallback UI) remain out of scope.
