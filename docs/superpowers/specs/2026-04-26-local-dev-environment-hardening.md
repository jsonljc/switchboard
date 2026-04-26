# Local Dev Environment Hardening

**Date:** 2026-04-26
**Branch:** `chore/local-dev-audit-clean`
**Closes:** F3, F6, F9, F10, F11, F12 in `2026-04-26-local-dev-environment-audit.md`
**(Already closed on this branch:** F1, F2, F4, F5, F7, F8 — committed in `96d8d0c7`)

---

## Problem

The local-dev audit identified 13 issues blocking or degrading the "fresh clone → working app" path. Six were addressed in an earlier commit. This spec closes the remaining six so a new developer (human or AI) can clone the repo, follow the documented setup, and reach a working `pnpm dev` without trial-and-error troubleshooting.

The unifying theme: every issue here is a place where the dev environment fails silently or behaves differently from what the docs / examples promise. The fixes are individually small but related — they share scripts, documentation surfaces, and the audit doc itself.

---

## Goals

1. Eliminate the schema-vs-migrations drift on `main` and prevent it from recurring (F3).
2. Detect when shared secrets between root `.env` and dashboard `.env.local` go out of sync (F6).
3. Give every runnable app its own `.env.example` so vars are discoverable per-app (F9).
4. Make the `DEV_BYPASS_AUTH` escape hatch actually work without a seeded database (F10).
5. Document and tooling-wrap the two known operational gotchas: Postgres `CREATEDB` privilege and stuck Prisma advisory locks (F11, F12).

---

## Non-Goals

- A single bootstrap script that installs Postgres and creates the DB. (Out of scope; documented as manual steps.)
- F13 (dashboard-without-API graceful UI). UX work; tracked separately.
- Pre-commit husky hooks. Friction not justified by marginal benefit over CI.

---

## Design

### Component 1 — Catch-up migration (F3)

A new migration at `packages/db/prisma/migrations/<timestamp>_add_approval_lifecycle_and_lead_intake_drift/migration.sql`.

**Contents:** the SQL that `prisma migrate dev --create-only` produces against an empty database — exactly what we generated during the audit session. It creates 3 columns and 6 tables plus indexes:

- `Contact.leadgenId`, `ConversationThread.firstAgentMessageAt`, `OrganizationConfig.cancelAtPeriodEnd`
- `ApprovalLifecycle`, `ApprovalRevision`, `ExecutableWorkUnit`, `DispatchRecord`, `WebhookEventLog`, `PendingLeadRetry`

A comment header inside the file explains it backfills schema additions that landed without their migrations.

**Mandatory verification before commit:**

1. Drop the local dev database (`dropdb switchboard && createdb -O switchboard switchboard`).
2. `pnpm db:migrate` — applies all migrations including the new one.
3. `pnpm db:seed` — completes without errors.
4. `pnpm typecheck` — proves no Prisma-client/schema mismatch.
5. Boot `apps/api` and `apps/dashboard`, confirm the dashboard loads `/dashboard` without a database error.

If any step fails, regenerate before commit.

### Component 2 — Drift guard (F3)

A new shell script `scripts/check-prisma-drift.sh` that runs:

```bash
pnpm --filter @switchboard/db exec prisma migrate diff \
  --from-migrations packages/db/prisma/migrations \
  --to-schema-datamodel packages/db/prisma/schema.prisma \
  --exit-code
```

`prisma migrate diff` computes the difference between the cumulative migration history and the current schema. With `--exit-code`, exit 2 means drift exists. No database connection required.

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

Exposed as `pnpm db:check-drift` for ergonomic local use.

**Wired in two places:**

1. **`.github/workflows/ci.yml`** — added in the `setup` job after `prisma generate` and before tests. PR-blocking.
2. **`scripts/preflight.sh`** — added inside the existing "Prisma Client Generation & Drift Check" section.

### Component 3 — Drift guard test (polish, F3)

`scripts/__tests__/check-prisma-drift.test.ts` (vitest).

1. **Pass case:** runs the check against the real schema + migrations; expects exit 0.
2. **Fail case:** writes a temp schema fixture that adds a model the migrations don't create; expects exit 2 and a stderr substring of "drift detected".

This guards against a future Prisma upgrade silently changing the exit-code contract.

### Component 4 — Env consistency check (F6)

A new shell script `scripts/check-env-consistency.sh` that compares three values that **must** be byte-identical between root `.env` and `apps/dashboard/.env.local`:

- `DATABASE_URL`
- `CREDENTIALS_ENCRYPTION_KEY`
- `NEXTAUTH_SECRET`

For each mismatched key, prints:

```
MISMATCH: CREDENTIALS_ENCRYPTION_KEY
  root .env:                <prefix>...
  apps/dashboard/.env.local: <prefix>...

Fix: re-run `./scripts/setup-env.sh` to sync.
```

Exits non-zero on any mismatch. Skips gracefully (exit 0 with a note) if either file is absent — this is a local-dev tool, not a production check.

Exposed as `pnpm dev:check-env`.

**Wired in:**

- **`scripts/preflight.sh`** — runs alongside the existing env-validation step.
- **NOT in CI** — CI generates its own env from secrets and doesn't have either of these files.

Values are masked in output (first 4 chars only) so the script is safe to share output in chats / issues.

### Component 5 — Per-app `.env.example` files (F9)

Three new files: `apps/api/.env.example`, `apps/chat/.env.example`, `apps/mcp-server/.env.example`.

Each lists only the env vars that app actually reads (gathered by the same grep we ran during the audit), annotated as `# REQUIRED` or `# OPTIONAL` based on whether the app's startup-checks treat them as hard fails.

Example (`apps/chat/.env.example`):

```
# REQUIRED in production (warning-only in dev)
TELEGRAM_BOT_TOKEN=
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
SLACK_BOT_TOKEN=

# REQUIRED — provided by root .env
DATABASE_URL=
CREDENTIALS_ENCRYPTION_KEY=

# OPTIONAL
REDIS_URL=
LOG_LEVEL=
SENTRY_DSN=
```

The actual env loading still happens via the root `.env` (Turbo's `globalEnv`). These files are reference documentation that keeps each app self-describing.

A short header comment at the top of each file says: "This file documents the env vars this app reads. Actual values are loaded from the repo-root `.env`. Do NOT copy this to `.env.local` in this directory."

### Component 6 — `DEV_BYPASS_AUTH` standalone (F10)

Today the bypass session has `id: "dev-user"`. `getApiClient()` looks the user up in the database; only if **not found** does it fall back to `SWITCHBOARD_API_KEY`. Since the seed creates `dev-user`, the lookup succeeds and the env-key fallback is dead code in practice. If the seed hasn't run, the lookup fails and the bypass throws.

**Fix:** in `apps/dashboard/src/lib/get-api-client.ts`, when `isDevBypassEnabled()` returns true, **skip the database lookup entirely** and return a `SwitchboardClient` constructed from `SWITCHBOARD_API_KEY` directly. Throw a clear error if `SWITCHBOARD_API_KEY` is unset:

```
DEV_BYPASS_AUTH is enabled but SWITCHBOARD_API_KEY is not set.
Either set SWITCHBOARD_API_KEY in apps/dashboard/.env.local, or run the seed
to create the dev-user (`pnpm db:seed`).
```

Update `apps/dashboard/.env.local.example` to include a commented `# SWITCHBOARD_API_KEY=` line near the `# DEV_BYPASS_AUTH=true` entry, with a comment explaining the relationship.

Also seed an `SWITCHBOARD_API_KEY` value in `setup-env.sh` (matching the dev API key the seed script already creates: `sb_dev_key_0123456789abcdef`) so the bypass works out of the box after `setup-env.sh` even without running the DB seed.

Test: a new vitest case in `apps/dashboard/src/lib/__tests__/get-api-client.test.ts` (or a new file if none exists) covering the bypass path with no DB user.

### Component 7 — `db-unstick` script (F12)

A new shell script `scripts/db-unstick.sh` that terminates lingering Postgres connections holding Prisma's migration advisory lock:

```bash
psql -d "${1:-switchboard}" -c "
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND pid != pg_backend_pid()
    AND (query LIKE 'SELECT pg_advisory_lock%' OR query LIKE '%prisma_migrate_shadow_db%');
"
```

Exposed as `pnpm db:unstick`. Used when `prisma migrate dev` hangs with the "Timed out trying to acquire a postgres advisory lock" error.

### Component 8 — Documentation (F11, F12, and meta)

**`README.md` additions:**

- Under "Prerequisites": call out that the Postgres role used for local dev needs `CREATEDB` privilege (Prisma's shadow database). Show the exact `createuser -s switchboard` command (already there), and add a one-liner explaining why.
- Under "Quick Start", add a "Working with the database" subsection: schema edits require a paired migration; `pnpm db:check-drift` runs locally; CI blocks PRs that drift; if `prisma migrate dev` hangs, run `pnpm db:unstick`.

**`CLAUDE.md` addition** under "Code Basics":

- "Schema changes require a migration in the same commit. Run `pnpm db:check-drift` before committing schema changes."
- "If `prisma migrate dev` hangs, run `pnpm db:unstick` to clear stuck advisory locks."

### Component 9 — Audit doc bookkeeping

Update `docs/superpowers/specs/2026-04-26-local-dev-environment-audit.md`:

- F3, F6, F9, F10, F11, F12 marked **Resolved** with a reference to this spec's commit.
- The summary table gains a "Status" column.
- Recommended fix order at the bottom is updated to reflect the new completion state.
- Only F13 remains open at the end of this spec's implementation.

---

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Pre-commit husky hook for drift check | Friction on every schema edit; bypassable; CI provides equivalent guarantee |
| Squash all migrations into a baseline | Loses history; doesn't prevent recurrence; large unrelated diff |
| One unified env file (no dashboard `.env.local`) | Conflicts with Next.js convention of per-app `.env.local`; harder to gitignore selectively; the consistency check is a smaller intervention |
| Make dev-bypass mock the entire API in-process | Major scope; we'd be reimplementing the API; using a real dev API key is simpler |
| Track stuck-lock recovery only in docs (no script) | We already lost ~30 min to this in the audit session; one-line script is cheap insurance |

---

## Risks

1. **Component 1 — catch-up migration's SQL was generated weeks ago.** Mitigation: the verification step re-runs it against a fresh DB and exercises the app.
2. **Component 2 — `prisma migrate diff` output format may change.** Mitigation: the test in Component 3 asserts on exit code (stable contract) and a substring we control in our wrapper.
3. **Component 4 — env consistency check could give false positives.** If a developer intentionally diverges values (e.g., to point dashboard at a remote dev API), the check shouts at them. Mitigation: the script accepts `--allow=DATABASE_URL` flags to whitelist intentional divergence; documented in the script's `--help`.
4. **Component 6 — making bypass standalone reduces "real" code path coverage in dev.** A developer who only ever uses the bypass might miss bugs in the encrypted-key flow. Mitigation: doc note that the bypass is for fast iteration; the real flow should be exercised periodically. Existing tests already cover the encrypted-key path.
5. **Component 5 — per-app `.env.example` files can drift from reality.** Mitigation: a follow-up could add a check, but for v1 it's lower-risk than the original problem (no per-app docs at all). Listed as future work.
6. **CI's `pgvector/pgvector:pg16`** vs local `postgresql@17`. Pre-existing inconsistency outside scope. The catch-up migration is plain SQL with no version-specific syntax.

---

## Acceptance criteria

A fresh clone where the developer follows the README:

1. Installs Postgres 17 + pgvector.
2. Runs `createuser -s switchboard && createdb -O switchboard switchboard`.
3. Runs `pnpm install`, `./scripts/setup-env.sh`.
4. Runs `pnpm db:migrate`, `pnpm db:seed`.
5. Runs `pnpm dev`.

…ends with a working dashboard at `localhost:3002`, login works with `admin@switchboard.local / admin123`, and the dashboard's data loads.

Additional checks:

- `pnpm db:check-drift` exits 0.
- Editing `schema.prisma` to add a new model and re-running `pnpm db:check-drift` exits 2 with the documented error.
- CI fails on a PR that introduces drift.
- `pnpm dev:check-env` reports OK on a freshly-set-up environment; reports MISMATCH if a key is changed in only one place.
- Setting `DEV_BYPASS_AUTH=true` and `SWITCHBOARD_API_KEY=<value>` lets the dashboard load without running the seed.
- `apps/api/.env.example`, `apps/chat/.env.example`, `apps/mcp-server/.env.example` exist and accurately list the vars each app reads.
- `pnpm db:unstick` terminates lingering migration locks.
- The audit doc shows F3, F6, F9, F10, F11, F12 as resolved; only F13 remains open.
