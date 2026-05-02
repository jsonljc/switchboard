# Worktree Bootstrap & Dashboard Error Visibility

**Date:** 2026-05-02
**Status:** Approved for implementation

## Problem

Two recurring friction modes block worktree-based development. Both surfaced on 2026-05-02 while preparing the Surface 01 audit worktree, costing roughly 30 minutes of zombie-port and missing-env triage before `/console` rendered.

1. **Silent env-var failures.** A fresh worktree has no `.env`. The API starts with `DATABASE_URL` undefined, sets `app.prisma = null`, and returns `{statusCode: 500, error: "Internal server error"}` on every dashboard hook. The dashboard renders a degraded banner with no clue what's wrong.
2. **Opaque upstream errors.** When the API returns a Fastify error envelope `{statusCode, error, message}`, the dashboard's `proxyError` forwards only `body.error` ("Internal Server Error") and drops `body.message` (the actual cause). Operators can't diagnose without tailing API logs.

## Goals

- A new worktree is runnable in one command.
- API refuses to start in an unrunnable state, with an actionable error message.
- Dashboard 500s surface the real cause in DevTools and dashboard stdout.

## Non-Goals

- **B2 — postinstall auto-bootstrap.** Conceals the contract; breaks in CI. Only revisit if `worktree:init` adoption is poor.
- **C3 — `requestId` correlation across API + dashboard.** Right architectural shape, but a half-day spec on its own. Defer until error-visibility is decided as a first-class feature.
- **Shared error-envelope schema in `packages/schemas`.** Folded into C3.
- **Graceful API degradation when DB is unavailable.** Separate flag, separate spec.

## Design

### Scope summary

| Layer | Change | File(s) |
|---|---|---|
| B1 | Manual `pnpm worktree:init` script | `scripts/worktree-init.sh`, root `package.json` |
| B3 | API fail-fast on unset `DATABASE_URL` | `apps/api/src/server.ts` (or wherever Prisma is wired) |
| C2 | `proxyError` forwards `message` + logs body | `apps/dashboard/src/lib/proxy-error.ts` |

No new shared packages. No schema changes. No migration. Dashboard and API changes are independent — neither requires the other to ship first.

### B1 — `scripts/worktree-init.sh`

Idempotent. Run after `git worktree add`. Steps:

1. Refuse if invoked from the primary worktree (compare `git rev-parse --git-common-dir` against `git rev-parse --git-dir`). Exit 0 with a "skipping; primary worktree" message.
2. If `<worktree>/.env` is missing and `<repo-root>/.env` exists → copy it. If neither exists → print warning, continue (user may use `.env.example` later).
3. For each of `:3000`, `:3001`, `:3002`: if `lsof -ti :<port>` returns PIDs, kill them with `kill -9` and print which port + PID was killed. Skip silently if nothing's listening.
4. Source `.env` (if present), then `pg_isready -d "$DATABASE_URL"`. If reachable: run `pnpm db:migrate` (idempotent). If unreachable: print actionable hint, continue.
5. Print next steps: `pnpm dev` and the dashboard URL.

Wired as `"worktree:init": "bash scripts/worktree-init.sh"` in root `package.json`. Documented in `CLAUDE.md` under the Worktree Doctrine section: "After `git worktree add`, run `pnpm worktree:init`."

### B3 — API fail-fast

In `apps/api/src/server.ts`, at the top of bootstrap, **before** the Prisma client is constructed:

```ts
if (!process.env.DATABASE_URL) {
  console.error(
    "[api] DATABASE_URL is not set. The API requires Postgres.\n" +
    "      In a worktree? Run `pnpm worktree:init` from the worktree root.\n" +
    "      Otherwise, copy .env.example to .env and set DATABASE_URL.",
  );
  process.exit(1);
}
```

Replaces today's silent `app.prisma = null` cascade. No new degrade-mode flag.

### C2 — `proxyError` enrichment

`apps/dashboard/src/lib/proxy-error.ts` currently forwards `body.error` only. Fastify's default envelope is `{statusCode, error, message}`; `message` carries the specific cause.

New behavior:

1. **Body forwarding.** Return shape becomes `{ error: body.message ?? body.error ?? "Unknown error", statusCode }`. The two-arg signature `proxyError(body, status)` is preserved; existing call sites are unchanged. When both `message` and `error` are present, `message` wins (it's the specific one; `error` is the HTTP class label).
2. **Server-side log.** Before returning, `console.error("[proxyError]", { status: statusCode, body })`. Includes any extra fields Fastify or our routes attached. No PII concern beyond what's already in API logs — body is already in transit between dashboard server and API server.

Banner copy upstream is unchanged because banners read the `error` field, which now carries the real cause.

## Testing

- **B1 — manual smoke test.** In a fresh worktree: delete `.env`, spawn a `:3000` listener, run `pnpm worktree:init`, verify both fixed and `pnpm dev` brings the stack up. No automated test (interactive ops script).
- **B3 — `apps/api/src/__tests__/bootstrap.test.ts`.** Spawn the bootstrap module with `DATABASE_URL` unset; assert exit code 1 and stderr contains `worktree:init`.
- **C2 — `apps/dashboard/src/lib/__tests__/proxy-error.test.ts`.** Five cases:
  - Forwards `body.message` as `error` when present.
  - Falls back to `body.error` when `message` absent.
  - Falls back to `"Unknown error"` when both absent.
  - `console.error` called with full body (spy).
  - Returns the supplied `statusCode`.

## Rollout

Single PR titled `chore(dx): worktree bootstrap + dashboard error visibility`, three commits for clean bisect:

1. `chore(dx): add scripts/worktree-init.sh + pnpm worktree:init`
2. `feat(api): fail fast when DATABASE_URL is unset`
3. `feat(dashboard): proxyError forwards Fastify message and logs full body`

Branch `dx/worktree-bootstrap-and-error-visibility` from origin/main, opened from a fresh worktree — dogfooding the very script this PR ships.

## Acceptance Criteria

- `pnpm worktree:init` in a fresh worktree produces a runnable dashboard against `/console`.
- API started with `DATABASE_URL` unset exits cleanly with the actionable error.
- A 500 from `/api/dashboard/organizations` surfaces Fastify's `message` in the DevTools Network response and writes the full body to dashboard stdout.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `proxyError` log too verbose | Low | Trim to `console.warn` of a summary if it pollutes logs in practice |
| `DATABASE_URL` guard breaks intentional DB-less startup | Very low | No such use case today; if it emerges, add an explicit `--no-db` flag in a follow-up |
| `worktree-init.sh` shell incompatibility | Low | Bash-only (`#!/usr/bin/env bash`); test on macOS zsh and Linux |

## Deferred Follow-ups

- **C3** (`requestId` correlation, shared error-envelope schema) — revisit once error visibility is treated as a first-class feature.
- **B2** (postinstall auto-bootstrap) — only if `worktree:init` adoption is poor.
