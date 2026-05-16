# Local Dev Environment Audit

**Date:** 2026-04-26
**Branch:** `chore/local-dev-setup-audit`
**Scope:** Every gap, missing piece, undocumented step, and potential breakage that prevents `pnpm dev` from "just working" against a fresh clone of this repo. No automation in this deliverable — findings + manual fix instructions only.

---

## Method

- Walked all four runnable apps (`api`, `dashboard`, `chat`, `mcp-server`) and enumerated every `process.env.*` reference.
- Identified hard-fail vs. soft-fail conditions at startup.
- Compared required env vars against what's actually documented in `.env.example` files.
- Verified service prerequisites (Postgres, Redis, pgvector) and OS-level requirements.
- Cross-referenced `next.config.mjs`, Prisma schema/migrations, and seed scripts.
- Reproduced the actual fresh-clone path during this session — every issue below was hit firsthand.

---

## Findings

### F1 — `pnpm dev` cannot start cleanly without channel tokens (BLOCKER)

**Where:** `apps/chat/src/startup-checks.ts:33-37`

The chat server hard-exits if **none** of `TELEGRAM_BOT_TOKEN`, `WHATSAPP_TOKEN+WHATSAPP_PHONE_NUMBER_ID`, or `SLACK_BOT_TOKEN` is set. Since `pnpm dev` from the root runs `turbo dev` which starts every app including `apps/chat`, a fresh clone with no third-party tokens fails immediately.

**Impact:** Even after running `setup-env.sh`, a developer who does not configure a third-party messaging channel cannot run `pnpm dev` end-to-end. The dashboard works (because Turbo runs apps in parallel), but the chat tab in the terminal will be a wall of red.

**Manual fix:** Either (a) set a placeholder `TELEGRAM_BOT_TOKEN=stub` in `.env` (not validated, just non-empty), or (b) downgrade the chat startup check to a warning when `NODE_ENV=development`, or (c) exclude `apps/chat` from `turbo dev` by default and add a separate `pnpm dev:full` for the full stack.

---

### F2 — pgvector dependency is undocumented and version-locked to PG 17/18

**Where:** `packages/db/prisma/schema.prisma` (vector extension), Homebrew `pgvector` formula

The schema requires the `vector` Postgres extension. Homebrew's `pgvector` package only builds for `postgresql@17` and `postgresql@18` — installing `postgresql@16` (the version implied by `.env.example`'s connection string) silently leads to migration failure with `extension "vector" is not available`.

**Impact:** A developer who runs `brew install postgresql` (defaults vary) or `postgresql@16` will hit a confusing migration error mid-setup with no breadcrumb pointing at pgvector.

**Manual fix:** Document that local Postgres must be **version 17 or 18**, and that `brew install pgvector` is required separately. Add a startup check in the API/migrate flow that probes for the `vector` extension and prints an actionable message.

---

### F3 — Schema drift: 6 unmigrated tables + 3 unmigrated columns in `main`

**Where:** `packages/db/prisma/schema.prisma` vs. `packages/db/prisma/migrations/`

Running `prisma migrate dev` on a fresh DB created a migration named `add_cancel_at_period_end` containing far more than that one column:

- New columns: `Contact.leadgenId`, `ConversationThread.firstAgentMessageAt`, `OrganizationConfig.cancelAtPeriodEnd`
- New tables: `ApprovalLifecycle`, `ApprovalRevision`, `ExecutableWorkUnit`, `DispatchRecord`, `WebhookEventLog`, `PendingLeadRetry`
- Multiple indexes on the above.

**Impact:** The committed Prisma client (which other devs run against) expects these tables/columns, but the migrations directory does not create them. Anyone applying migrations cleanly to a new DB ends up with a schema that the app's queries will fail against (we hit `column "cancelAtPeriodEnd" does not exist` during this session).

**Manual fix:** Generate and commit the missing migration on `main` before any new dev tries to set up locally. Investigate process gap — likely a developer edited the schema directly without running `prisma migrate dev`, then `pnpm db:generate` regenerated the client without producing migration SQL.

**Status:** Resolved on this branch. Catch-up migration committed (`408e7c16`) and recurrence guard wired into CI (`2da69310`) + preflight (`bd526179`). See `docs/superpowers/specs/2026-04-26-prisma-drift-fix-and-guard.md` for the implementation.

---

### F4 — CSP blocks Next.js dev mode hot reload

**Where:** `apps/dashboard/next.config.mjs:11`

`script-src 'self' 'unsafe-inline'` does not include `'unsafe-eval'`, but Next.js dev mode's webpack/react-refresh runtime calls `eval()`. The browser blocks it, React fails to mount interactive handlers, and the login form's controlled inputs never update state — making the Sign in button appear permanently disabled.

**Impact:** Login is impossible in local dev with the default config. (A previous mitigation was reverted, so this remains broken on `main`.)

**Manual fix:** Either (a) conditionally add `'unsafe-eval'` to `script-src` when `NODE_ENV === "development"`, (b) implement a nonce-based CSP that satisfies React Refresh, or (c) disable the CSP header entirely in dev. Option (a) is lowest-risk because it touches only dev mode.

---

### F5 — `setup-env.sh` only seeds the root `.env`, not the dashboard's `.env.local`

**Where:** `scripts/setup-env.sh`

The script generates secrets into `.env` at the repo root. The dashboard reads from `apps/dashboard/.env.local` for NextAuth-specific vars (`NEXTAUTH_URL`, `NEXTAUTH_SECRET`) and for vars that must duplicate values from the root `.env` (`DATABASE_URL`, `CREDENTIALS_ENCRYPTION_KEY`). The script doesn't touch `.env.local`, so a developer following the documented setup still has a broken dashboard.

**Impact:** Running `./scripts/setup-env.sh` gives a false sense of completeness. Login flow hits `ClientFetchError` because NextAuth has no secret. The dashboard's `getApiClient()` throws because `SWITCHBOARD_API_URL` is unset.

**Manual fix:** Extend `setup-env.sh` to also create/populate `apps/dashboard/.env.local` from `apps/dashboard/.env.local.example`, and ensure shared secrets (`CREDENTIALS_ENCRYPTION_KEY`, `DATABASE_URL`) are copied from the root `.env` so they always match.

---

### F6 — Shared secret duplication with no consistency check

**Where:** Root `.env` ↔ `apps/dashboard/.env.local`

Three values must be byte-identical across both files:

- `DATABASE_URL` (API + dashboard both connect)
- `CREDENTIALS_ENCRYPTION_KEY` (API encrypts, dashboard reads)
- The implicit pairing of `SWITCHBOARD_API_URL` (dashboard) with `PORT` (API)

Nothing enforces or even checks this. A developer who regenerates a key in one place and forgets the other gets opaque decryption failures (`Failed to decrypt API key for user ...`).

**Impact:** Footgun. Easy to misalign during routine secret rotation or env troubleshooting.

**Manual fix:** Either (a) have the dashboard read shared values from a single source via Turbo's `globalEnv`/dotenv loader, (b) add a preflight check that compares the values and bails on mismatch, or (c) consolidate to a single root `.env` with everything (NextAuth included) and have the dashboard read from it.

---

### F7 — Dashboard `.env.local.example` documents the wrong env var name for dev bypass

**Where:** `apps/dashboard/.env.local.example:5`

The example shows `# NEXT_PUBLIC_DEV_BYPASS_AUTH=true` (commented out), but the actual code at `apps/dashboard/src/lib/dev-auth.ts:17,28` reads `process.env.DEV_BYPASS_AUTH` — without the `NEXT_PUBLIC_` prefix. A developer who uncomments the suggested var enables nothing.

**Impact:** The documented escape hatch silently doesn't work. Combined with F10, the dev bypass is effectively unusable as documented.

**Manual fix:** Change the example to `# DEV_BYPASS_AUTH=true` to match the code. (The original draft of this audit incorrectly claimed `CREDENTIALS_ENCRYPTION_KEY` was missing from this file — it is present on line 24 with the helpful value `same-value-as-api-server`. That finding was wrong; this is the real issue with the file.)

---

### F8 — README setup section is incomplete

**Where:** `README.md` `### Setup` and `### Development` sections

The README documents `pnpm install`, `pnpm build`, and `pnpm dev`, but omits every external prerequisite: Node version, pnpm version, Postgres 17, pgvector, optional Redis, the `setup-env.sh` step, the migration step, the seed step. A developer who follows the README literally has no working app.

**Impact:** Every new developer (human or AI) reinvents the setup path by trial and error — exactly the path we walked today. The Docker section assumes Docker is installed (it wasn't on this machine).

**Manual fix:** Expand the README "Setup" section (or split into a new `docs/LOCAL-DEV.md`) to cover: required Node/pnpm versions, Postgres 17 + pgvector install commands, database creation, `./scripts/setup-env.sh`, dashboard `.env.local` creation, `pnpm db:migrate`, `pnpm db:seed`, and only then `pnpm dev`.

---

### F9 — `apps/api` and `apps/chat` have no `.env.example`

**Where:** `apps/api/`, `apps/chat/`, `apps/mcp-server/`

Only the dashboard ships a per-app env example. The API consumes ~50 distinct env vars (many optional integrations), the chat app has its own (channel tokens, internal secret), and `mcp-server` has its own. All currently rely on the root `.env` being populated correctly, with no per-app discoverability.

**Impact:** When working on a single app, there's no quick way to see what that app needs. Optional vs. required is ambiguous — a developer wiring up Stripe, for example, has to grep the codebase for `STRIPE_*`.

**Manual fix:** Add `apps/<app>/.env.example` for each, listing the vars that app actually reads with required/optional annotations.

---

### F10 — Dev bypass auth path is half-implemented

**Where:** `apps/dashboard/src/lib/dev-auth.ts`, `apps/dashboard/src/lib/get-api-client.ts:35-40`

`isDevBypassEnabled()` checks `DEV_BYPASS_AUTH=true`. If enabled, `getApiClient()` falls back to a `SWITCHBOARD_API_KEY` env var if the user lookup fails. But:

- The dev bypass session uses `id: "dev-user"`, but the seeded dev dashboard user uses the same ID — so the user lookup _succeeds_ and the fallback is never hit.
- `SWITCHBOARD_API_KEY` is not in any `.env.example`.
- The bypass session is hardcoded to `org_dev`/`principal_dev`, which only exist if the seed has run.

**Impact:** The "skip login" escape hatch advertised in `apps/dashboard/.env.local.example` only works if the database is seeded — which is the same prerequisite as just signing in normally. The bypass adds no value over a real login.

**Manual fix:** Either (a) make `DEV_BYPASS_AUTH` actually work without a database (in-memory mock data path), or (b) remove it and document that local dev requires the seed.

---

### F11 — Migration shadow database needs CREATE privilege

**Where:** Prisma `migrate dev` behavior

`prisma migrate dev` creates a temporary "shadow" database to detect drift. The seeded `switchboard` Postgres user must have `CREATEDB` privilege. The setup commands in this session used `createuser -s switchboard` (superuser flag) which works, but a security-conscious developer might create a non-superuser and hit cryptic permission errors.

**Impact:** Friction in security-conscious setups. Not a hard blocker, but a documentation gap.

**Manual fix:** Document the `CREATEDB` requirement explicitly, or switch local dev to `prisma migrate deploy` (no shadow DB) for already-applied migrations.

---

### F12 — Stuck migration locks not handled

**Where:** Postgres advisory lock `72707369` used by Prisma

A failed `prisma migrate dev` run can leave behind connections holding the migration advisory lock. Subsequent runs hang for 10s and fail with a timeout. The fix (`SELECT pg_terminate_backend(...)`) is undocumented; a developer is left with no obvious recovery path.

**Impact:** A first-time migration failure (e.g., the pgvector issue from F2) cascades into a "database is locked" loop that's hard to diagnose.

**Manual fix:** Add a doc note or troubleshooting entry. Optionally a script `scripts/db-unstick.sh` that terminates lingering connections on the dev DB.

---

### F13 — Dashboard depends on `useDashboardOverview` returning before render with no fallback UI

**Where:** `apps/dashboard/src/components/dashboard/owner-today.tsx`

When the API server is down (or unconfigured), the entire dashboard root page shows only "Unable to load dashboard data. Check that the API server is running." No nav, no degraded mode, no path to the settings/login pages without manually changing the URL.

**Impact:** Developers who run only the dashboard (not the API) see a dead-end page with no recovery. We hit this in this session.

**Manual fix:** Render the chrome (nav, settings link) regardless of API availability. Replace the full-page error with a banner so the rest of the app remains navigable. (Out of scope for "audit only" but worth noting.)

---

## Summary

| #   | Finding                                                                | Severity | Effort                      |
| --- | ---------------------------------------------------------------------- | -------- | --------------------------- |
| F1  | Chat app blocks `pnpm dev` without channel tokens                      | Blocker  | Low                         |
| F2  | pgvector / Postgres 17+ undocumented                                   | Blocker  | Low (doc)                   |
| F3  | Unmigrated schema changes on `main`                                    | Blocker  | ✅ Resolved                 |
| F4  | CSP breaks Next.js dev mode                                            | Blocker  | Low                         |
| F5  | `setup-env.sh` doesn't seed dashboard env                              | High     | Low                         |
| F6  | Shared secrets duplicated, no consistency check                        | High     | Medium                      |
| F7  | Dashboard `.env.local.example` documents wrong var name for dev bypass | High     | Trivial                     |
| F8  | No `LOCAL-DEV.md` documentation                                        | High     | Medium                      |
| F9  | Per-app `.env.example` files missing                                   | Medium   | Low                         |
| F10 | Dev-bypass auth doesn't work standalone                                | Medium   | Medium                      |
| F11 | Shadow DB privilege not documented                                     | Low      | Trivial                     |
| F12 | Stuck migration locks not handled                                      | Low      | Trivial                     |
| F13 | Dashboard has no API-down fallback UI                                  | Medium   | Medium (out of audit scope) |

**Blockers (F1–F4) must be resolved for any fresh clone to reach a working `pnpm dev`.** The rest are quality-of-life improvements that significantly reduce friction.

---

## Recommended fix order

1. ~~**F3** — commit the missing migration so other devs don't hit it.~~ ✅ Resolved.
2. **F2 + F8** — document Postgres 17 + pgvector prerequisites in a new `docs/LOCAL-DEV.md`.
3. **F4** — re-apply the conditional `'unsafe-eval'` fix in `next.config.mjs` (or implement a nonce-based alternative).
4. **F1** — make chat startup tolerant of missing channel tokens in dev, or exclude it from default `pnpm dev`.
5. **F5 + F7** — extend `setup-env.sh` to populate dashboard env, add the missing key to the example.
6. **F6, F9–F12** — quality-of-life improvements; sequence based on team priorities.
7. **F13** — out of audit scope; track separately as a UX improvement.
