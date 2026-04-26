# Prisma Schema Drift Fix and Recurrence Guard

**Date:** 2026-04-26
**Branch:** `chore/local-dev-audit-clean`
**Closes:** F3 in `2026-04-26-local-dev-environment-audit.md`

---

## Problem

`packages/db/prisma/schema.prisma` defines models and fields that no committed migration creates. A fresh clone that runs `pnpm db:migrate` ends up with a database missing 3 columns and 6 tables that the application code expects. The first request that touches any of them fails with `column ... does not exist` or `relation ... does not exist`.

**Concretely missing from migrations:**

- Columns: `Contact.leadgenId`, `ConversationThread.firstAgentMessageAt`, `OrganizationConfig.cancelAtPeriodEnd`
- Tables: `ApprovalLifecycle`, `ApprovalRevision`, `ExecutableWorkUnit`, `DispatchRecord`, `WebhookEventLog`, `PendingLeadRetry`
- Indexes on the above

These additions are already on `main` — they were added to the schema directly without running `prisma migrate dev` to generate the matching SQL.

---

## Goal

1. Bring `main`'s migrations into sync with `main`'s schema so a fresh clone works end-to-end.
2. Add a recurrence guard so the same drift cannot land silently again.

---

## Non-Goals

- Restructuring the existing migration history. The fix is additive: one new migration on top of what's there.
- A pre-commit hook. (Explicitly evaluated and rejected — see "Alternatives considered".)
- Other audit items (F6, F9–F12). Tracked separately.

---

## Design

### Component 1 — The catch-up migration

A single new migration file at `packages/db/prisma/migrations/<timestamp>_add_approval_lifecycle_and_lead_intake_drift/migration.sql`.

**Contents:** the SQL that `prisma migrate dev --create-only` produces when run against a database whose schema is empty of these models. We already generated this exact SQL during the local-dev audit session; it's known-good.

**Naming:** `add_approval_lifecycle_and_lead_intake_drift` — the two substantive feature groups (the Approval lifecycle tables, and the lead intake additions: `Contact.leadgenId`, `PendingLeadRetry`, `WebhookEventLog`) plus the `_drift` suffix flagging that this is a backfill rather than fresh feature work. The 3 small column additions get a comment header inside `migration.sql` since they don't fit the headline.

**Verification before commit (mandatory):**

1. Drop the local dev database.
2. Run `pnpm db:migrate` to apply all migrations including the new one.
3. Run `pnpm db:seed` and confirm it completes without errors.
4. Run `pnpm typecheck` (proves no Prisma-client/schema mismatch).
5. Boot `apps/api` and `apps/dashboard` and confirm the dashboard loads `/dashboard` without a database error.

If any step fails, the migration SQL is wrong — debug and regenerate before commit.

### Component 2 — The drift guard

A new script `scripts/check-prisma-drift.sh` that runs:

```bash
pnpm --filter @switchboard/db exec prisma migrate diff \
  --from-migrations packages/db/prisma/migrations \
  --to-schema-datamodel packages/db/prisma/schema.prisma \
  --exit-code
```

`prisma migrate diff` computes the difference between the cumulative migration history and the current schema. With `--exit-code`, it returns 2 when a non-empty diff exists. No database connection required.

On detected drift, the script prints:

```
ERROR: Prisma schema drift detected.

schema.prisma defines models or fields that no committed migration creates.
A fresh clone running `pnpm db:migrate` would NOT get these tables/columns.

Fix:
  pnpm --filter @switchboard/db exec prisma migrate dev --name <descriptive-name>
  git add packages/db/prisma/migrations/
  git commit
```

A new pnpm script `pnpm db:check-drift` aliases the script for ergonomic local use.

**Wired in two places:**

1. **`.github/workflows/ci.yml`** — added as a step in the `setup` job, after `prisma generate` and before tests. This makes drift PR-blocking.
2. **`scripts/preflight.sh`** — added inside the existing "Prisma Client Generation & Drift Check" section, alongside the existing client-staleness check. Launch readiness now fails on schema drift, not just client staleness.

**Pre-commit hook intentionally skipped.** Pre-commit slowdown for every `schema.prisma` edit (~2s Prisma boot) creates friction that gets bypassed under deadline pressure. CI catches the same drift before merge with zero developer friction; `pnpm db:check-drift` is available for fast local feedback when wanted.

### Component 3 — Test for the guard

`scripts/__tests__/check-prisma-drift.test.ts` (vitest, run by the existing test suite).

Two cases:

1. **Pass case:** runs the drift check against the real `packages/db/prisma/schema.prisma` and `packages/db/prisma/migrations/` directory. Expects exit code 0. This regression-tests both the script and the actual repo state.
2. **Fail case:** writes a temporary schema fixture that adds a model the migrations don't create, runs the check against the fixture + the real migrations dir, expects exit code 2 and an error message containing "drift detected".

This is the polish step — without it, a future Prisma CLI upgrade could change the exit-code behavior and the guard would silently stop catching drift.

### Component 4 — Documentation

Two short additions, both ~5 lines:

1. **`README.md`** — under the existing "Quick Start" section, add a "Working with the database" subsection: "Edits to `packages/db/prisma/schema.prisma` must be paired with a migration. After editing the schema, run `pnpm --filter @switchboard/db exec prisma migrate dev --name <descriptive>`. CI runs `pnpm db:check-drift` and blocks PRs that violate this."
2. **`CLAUDE.md`** — under "Code Basics", add: "Schema changes require a migration in the same commit. Run `pnpm db:check-drift` before committing schema changes."

### Component 5 — Audit doc bookkeeping

Update `docs/superpowers/specs/2026-04-26-local-dev-environment-audit.md`:

- F3 status: mark as resolved with reference to this spec.
- Summary table row for F3: severity stays "Blocker" but the row gets a "Resolved on this branch" note.
- Recommended fix order: F3 line gets a strikethrough or "(done — see prisma-drift-fix-and-guard spec)".

This keeps the audit doc as an accurate point-in-time record of what was found and what was done about it.

---

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Pre-commit husky hook | Friction on every schema edit; bypassable under pressure; CI provides equivalent guarantee |
| Squash all migrations into a baseline | Loses history; doesn't prevent recurrence; large unrelated diff |
| Custom ESLint plugin | Heavy infra for a one-line `prisma migrate diff` check |
| `prisma migrate status` | Wrong direction — checks DB-vs-migrations, not migrations-vs-schema |
| Inline the diff command in three places (no shared script) | Duplication of error message and command; harder to keep in sync |

---

## Risks

1. **The catch-up migration's SQL was generated weeks ago against a possibly-stale schema.** Mitigation: the verification step in Component 1 re-runs the migration against a fresh DB and exercises the app — if anything has changed in the schema since generation, this catches it.
2. **The `prisma migrate diff` command output format may change between Prisma versions.** Mitigation: the test in Component 3 asserts on exit code (stable contract) and a substring of the message ("drift detected") that we control in our wrapper script. We do not parse Prisma's stdout.
3. **CI runs against `pgvector/pgvector:pg16` but local dev is `postgresql@17`.** This is a pre-existing inconsistency outside this spec's scope, but the catch-up migration is plain SQL with no version-specific syntax — it applies cleanly to both.

---

## Acceptance criteria

- A fresh clone of `chore/local-dev-audit-clean` (after merge) where the developer runs the documented setup (Postgres 17 + pgvector + setup-env.sh + db:migrate + db:seed) ends with a working dashboard at `localhost:3002`.
- Running `pnpm db:check-drift` against the post-merge state of the repo exits 0.
- Deliberately editing `schema.prisma` to add a model and re-running `pnpm db:check-drift` exits 2 with the documented error message.
- The CI job fails on a PR that introduces drift.
- The audit doc accurately reflects F3 as resolved.
