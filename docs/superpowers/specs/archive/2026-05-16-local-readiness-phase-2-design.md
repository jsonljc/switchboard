# Local Readiness Phase 2 — Design

**Date:** 2026-05-16
**Status:** Draft
**Predecessor:** [`2026-05-15-local-readiness-and-ci-gates-design.md`](./2026-05-15-local-readiness-and-ci-gates-design.md)

## Context

PR-1 #549 + PR-2 #558 closed the local-readiness spec on **invariants**: env-completeness, live-flag manifest, route-ingress allowlist, seed minimums, dashboard build. CI now blocks regressions on those dimensions.

A post-merge audit (2026-05-16) found gaps that the invariant spec did not cover:

- `scripts/worktree-init.sh:54-58` runs `pnpm db:migrate` but swallows failure with a warning (`|| { echo WARNING ... }`), and never runs `pnpm db:seed` or `pnpm build`. Fresh worktree → empty DB → dashboard surfaces empty.
- `scripts/check-seed-counts.ts:24-26,71-74` exits 0 silently when `DATABASE_URL` is unset or DB unreachable. `pnpm local:verify:fast` can report green on a pre-bootstrap clone.
- No single bootstrap command; fresh-clone devs run install / build / migrate / seed / verify by hand.
- `apps/dashboard/.env.local.example` doesn't surface that `NEXTAUTH_URL` / `SWITCHBOARD_API_URL` / `CREDENTIALS_ENCRYPTION_KEY` must mirror root `.env` or auth/encryption silently fails.
- `.agent/tools/route-allowlist.yaml` has no "Temporarily justified" entries today (the 3 routes flagged in PR-1 were all migrated via #568, #571, #572 — each migration PR removed its own entry). But `check-routes` does not enforce that a hypothetical future "Temporarily justified:" entry must cite an issue, so the next temp entry could ship without one. This is forward-protection only.
- `pnpm dev` boots 3 services with no aggregate ready signal.
- Fast verify has no dashboard typecheck; only the heavy verify runs `dashboard build`.

## Goal

A fresh `git clone` followed by `pnpm local:setup` produces a working dev environment with no manual steps, and `pnpm local:verify[:fast]` cannot report green when the local database is empty or unconfigured.

Three risk buckets are addressed: (1) bootstrap correctness, (2) verify accuracy, (3) dev readiness polish. Buckets 1 and 2 ship together as PR A — they share the same "no silent green" promise. Bucket 3 is polish that should not gate the promise.

## Scope

### PR A — Local bootstrap correctness

The hard promise: fresh clone + DB configured → seeded, verified, truthful local dashboard. Single PR, 5 components.

**A1. Harden `scripts/worktree-init.sh`**

- Remove the `|| { echo "[worktree-init] WARNING: pnpm db:migrate failed (continuing)" }` swallow at step 3. Migrate failures become fatal (`set -e` already in effect; the `||` clause defeats it).
- When DB is reachable, after `pnpm db:migrate` succeeds: run `pnpm build` then `pnpm db:seed`. Build is required before seed because `tsx prisma/seed.ts` transitively imports `@switchboard/schemas/dist/index.js` (gotcha already documented in PR-2 memory).
- When DB is unreachable: warn + skip migrate/build/seed but exit 0 (so dev can re-run after starting Postgres). Output must be explicit so the script does not feel "successful" when setup is incomplete. Required message:
  ```
  [worktree-init] DB not reachable. Skipped migrate/build/seed.
  [worktree-init] Run `pnpm local:setup` after starting Postgres.
  ```
- Print explicit timing note in the "Next steps" footer: build adds ~30-60s on first run; subsequent re-runs are fast (turbo cache).

**A2. Add `pnpm local:setup` command**

- Naming: chosen over `pnpm onboard` because the dashboard already owns "onboard"/"onboarding" semantics (product onboarding wizard at `/onboarding`, marketplace `onboard` API route, `onboarding-page.test.tsx`). `local:setup` is symmetric with existing `local:verify` / `local:verify:fast`.
- New root `package.json` script. One-shot bootstrap chain:
  ```
  pnpm install
    → setup-env (env-file copy step, factored out of worktree-init.sh)
    → pnpm build
    → pnpm db:migrate
    → pnpm db:seed   (only if DB reachable; warn + skip otherwise)
    → pnpm local:verify:fast
  ```
- Idempotent; safe to re-run.
- Works on primary repo AND on worktrees. On worktrees, env-copy step pulls from primary's `.env` (matches current `worktree-init.sh` step 1).
- Documented in root `README.md` under a new "First-time local setup" section as the canonical entry point.

**A3. Make `check-seed-counts.ts` three-state**

Current behavior collapses two cases into "skipped":

| State            | DATABASE_URL set? | DB reachable? | Minimums met? | Current exit    | Target exit        |
| ---------------- | ----------------- | ------------- | ------------- | --------------- | ------------------ |
| PASS             | yes               | yes           | yes           | 0 (✓ counts)    | 0 (unchanged)      |
| FAIL             | yes               | yes           | no            | 1 (✗ diff)      | 1 (unchanged)      |
| SKIP-NO-URL      | no                | n/a           | n/a           | 0 (⚠ one-liner) | 0 (warning banner) |
| SKIP-UNREACHABLE | yes               | no            | n/a           | 0 (⚠ one-liner) | 0 (warning banner) |

- Replace the one-line warning with a prominent multi-line banner (border + recovery hint) so SKIP is unmistakable in scrolling output.
- Add `--strict-db` flag: turns either SKIP state into exit 1. `local:verify:fast` invokes with `--strict-db`. CI's setup job continues to call without the flag (CI configures DB before this check, so SKIP can't legitimately fire there).
- The `--strict-db` failure message must include a recovery hint (loud but helpful, since the prior failure mode was silent green). Required output:
  ```
  ✗ DATABASE_URL missing or DB unreachable.
    Start Postgres and run `pnpm local:setup`,
    or run `pnpm db:migrate && pnpm db:seed` directly.
  ```
- Net effect: local fast verify fails loudly if the dev hasn't configured DB yet, instead of falsely greenlighting.

**A4. Update `apps/dashboard/.env.local.example` + README**

- Prepend a comment block:
  ```
  # This file mirrors keys from the root `.env`.
  # Keys marked SYNC-FROM-ROOT must hold the same values as the root `.env`,
  # or auth / encryption will silently fail.
  ```
- Mark `NEXTAUTH_URL`, `SWITCHBOARD_API_URL`, `CREDENTIALS_ENCRYPTION_KEY` as `SYNC-FROM-ROOT` (inline comment on each line).
- Root `README.md`: add "First-time local setup" section pointing to `pnpm local:setup`. Reference the SYNC-FROM-ROOT convention.

**A5. Allowlist temporary-entry issue-reference rule**

- Extend the loader at `.agent/tools/allowlist.ts:10-34` (or `check-routes.ts`): for any entry whose `reason` starts with `Temporarily justified:`, require the `reason` field itself to match `/#\d+/`. The check inspects only the `reason` string — a `#NNN` mention in a YAML comment above the entry does **not** satisfy the rule. Lint-style check; no GitHub API call.
- Failure message: `Temporary allowlist entry for "<path>" must cite an open issue (e.g., #562) in its reason field.`
- The 3 entries that existed in PR-1 (recommendations, lifecycle-disqualifications, dashboard-opportunities) were all removed when their migrations merged (#568, #571, #572). There are no `Temporarily justified:` entries on `main` today; this rule is pure forward-protection.

### PR B — Dev readiness polish

Polish, not gating. Ships after PR A.

**B1. `pnpm dev:ready` probe**

- New `scripts/dev-ready.ts`: polls `http://localhost:3000/health` (api), `http://localhost:3001/health` (chat), and `http://localhost:3002/` (dashboard root, since dashboard has no `/health` endpoint today) at 500ms intervals. Plan may add `/api/health` to dashboard if trivial; not required.
- Prints per-port `:PORT ready` lines as each becomes available; prints `All services ready ✓` aggregate when all three respond.
- Default timeout 90s; on timeout, exit non-zero with a clear `Timed out waiting for :PORT — is \`pnpm dev\` running?` message.
- Documented as an optional companion run in a second terminal pane.

**B2. Dashboard typecheck in fast verify (conditional)**

- Append `pnpm --filter @switchboard/dashboard typecheck` to `local:verify:fast` (likely added to `scripts/local-verify-fast.ts`).
- **Acceptance gate:** new fast-track total wall-clock stays under 30s warm-cache, 60s cold. Plan must measure both before merging. If timing fails, drop this change and rely on heavy verify.
- Caveat: dashboard typecheck does **not** close the `.js`-extension regression gap (Next.js rejects `.js` even when `tsc` accepts them — see `feedback_dashboard_no_js_on_any_import.md`). Full `next build` is the only gate for that.
- Alternative if typecheck is too slow: add an ESLint rule forbidding `.js` extensions in dashboard relative imports. Cheaper, more targeted; consider as a follow-up if B2 is dropped.

### Out of scope

- **Issue #472** (Reports live-mode failure UX) — product UX workstream; doesn't gate bootstrap correctness. Tracked separately for the `/reports` live-mode flip.
- **Route migrations for the originally-flagged 3 routes** — already shipped on `main` via #568, #571, #572 (audit-wave-2-phase-1b). Each migration PR removed its own allowlist entry. Phase 2 inherits a clean slate; A5 prevents regression.
- **Live-flag matrix ↔ code cross-check** — no observed drift yet; defer until a pattern emerges.
- **Deprecated env-var sunset deadlines** — system exists in `env-allowlist.local-readiness.json` (`deprecated_allowed_temporarily` array), but no observed drift.
- **Multi-environment env-var management** (Vercel/Render) — owned by the deployment specs (#519/#523/#524/#526).

## Success criteria

**PR A is done when:**

- On a fresh clone with `DATABASE_URL` set and Postgres reachable, `pnpm local:setup` exits 0 in under 5 minutes cold on a typical dev machine (install ~2-3 min + build ~1-2 min + migrate + seed + verify:fast <30s).
- After `pnpm local:setup`, running `pnpm dev` produces `/contacts`, `/activity`, `/approvals`, `/automations` views with non-empty data.
- `pnpm worktree:init` exits non-zero if `pnpm db:migrate` fails (no more silent warnings).
- `pnpm local:verify:fast` exits non-zero on a fresh clone where DB is unconfigured (via `--strict-db`).
- `apps/dashboard/.env.local.example` documents the SYNC-FROM-ROOT keys; root `README.md` documents `pnpm local:setup`.
- Adding a hand-crafted "Temporarily justified" allowlist entry without `#NNN` reference fails the route-ingress check.

**PR B is done when:**

- `pnpm dev:ready` reports per-port + aggregate ready, with sensible timeout behavior when a port is stalled.
- If dashboard typecheck is added to fast verify, the new fast-track wall-clock meets the B2 acceptance gate.

## Risks and open questions

- **Build cost in worktree-init / onboard:** adds ~30-60s on first run, near-zero on re-runs (turbo cache). Acceptable but worth surfacing in output so devs don't think the script hung.
- **`--strict-db` and CI parity:** local fast verify uses `--strict-db`; CI's setup job does not. Plan must confirm CI's setup chain (per PR-2) runs `db:seed` + `check-seed-counts` only AFTER DB is provisioned, so SKIP cannot legitimately fire in CI. If there's any path in CI where `check-seed-counts` could run pre-DB, this becomes a CI bug to fix in the same PR.
- **Dashboard typecheck runtime:** unknown without measurement. Plan must measure cold and warm timing before deciding inclusion.
- **`pnpm local:setup` on a checkout without `.env` or `.env.example`:** must error clearly and exit non-zero, not produce a half-applied state. The setup-env step needs explicit handling for "no template available."
- **Onboard idempotency vs. destructive re-run:** if a dev runs `pnpm local:setup` after manually editing seed rows, will seed clobber their changes? The current `seed-dev-data.ts` uses upsert semantics (per audit), so this should be safe — but call out in onboard's stdout that seed is upsert-on-fixed-ids, not destructive.

## Sequencing

1. **PR A first.** Single PR with all 5 components (A1–A5) — they're tightly coupled through the "no silent green" promise.
2. **PR B follows independently.** Can ship in parallel with PR A review if convenient; carries no dependency on A.
3. **No spec amendments expected.** If dashboard typecheck timing forces dropping B2, that's an internal PR-B call; spec doesn't need to change.
