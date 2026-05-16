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

### Persistence requirements

This spec does not just unblock today's friction; it is sized to prevent recurrence:

- The env-var guard generalizes — any future required env var inherits the same fail-fast behavior, not just `DATABASE_URL`.
- The `worktree:init` script is self-discovering — a `predev` env check prints the hint when `.env` is missing, so a dev who never read CLAUDE.md still finds it.
- The bootstrap guard is covered by an integration smoke test in CI — refactors that move or remove it fail the build.
- The `proxyError` contract is locked by a regression test on the user-visible `error` field — the next maintainer cannot silently revert message-forwarding.

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
| B1' | `predev` env check — discoverable hint | `scripts/check-env.sh`, root `package.json` |
| B3 | API fail-fast on **any** missing required env var | `apps/api/src/env.ts` (new), `apps/api/src/server.ts` |
| B4 | API bootstrap DB sanity check (`SELECT 1`) | `apps/api/src/app.ts` |
| C2a | API: include error message + stack in 5xx body when `NODE_ENV !== "production"` | `apps/api/src/app.ts` (`setErrorHandler`) |
| C2b | Dashboard: `proxyError` forwards upstream `error` + logs full body | `apps/dashboard/src/lib/proxy-error.ts` |

No new shared packages. No schema changes. No migration. Dashboard and API changes are independent — neither requires the other to ship first.

### B1 — `scripts/worktree-init.sh`

Idempotent. Run after `git worktree add`. Steps:

1. Refuse if invoked from the primary worktree (compare `git rev-parse --git-common-dir` against `git rev-parse --git-dir`). Exit 0 with a "skipping; primary worktree" message.
2. If `<worktree>/.env` is missing and `<repo-root>/.env` exists → copy it. If neither exists → print warning, continue (user may use `.env.example` later).
3. For each of `:3000`, `:3001`, `:3002`: if `lsof -ti :<port>` returns PIDs, kill them with `kill -9` and print which port + PID was killed. Skip silently if nothing's listening.
4. Source `.env` (if present), then `pg_isready -d "$DATABASE_URL"`. If reachable: run `pnpm db:migrate` (idempotent). If unreachable: print actionable hint, continue.
5. Print next steps: `pnpm dev` and the dashboard URL.

Wired as `"worktree:init": "bash scripts/worktree-init.sh"` in root `package.json`. Documented in `CLAUDE.md` under the Worktree Doctrine section: "After `git worktree add`, run `pnpm worktree:init`."

### B1' — `predev` env check (discoverability)

Root `package.json` gains `"predev": "bash scripts/check-env.sh"`. The script:

1. Detects whether the cwd is a worktree (not the primary).
2. If `.env` is missing in the cwd → print a one-line warning pointing at `pnpm worktree:init` and exit 0 (non-blocking — it's a hint, not a gate).
3. If `.env` is present → exit 0 silently.

This solves the discoverability gap: a dev who's never read `CLAUDE.md` still sees the hint the first time they run `pnpm dev` in a fresh worktree.

### B3 — API fail-fast (generalized)

A new module `apps/api/src/env.ts` exports a `REQUIRED_ENV` array — the single source of truth for env vars that, if missing, render the API non-functional:

```ts
export const REQUIRED_ENV = ["DATABASE_URL", "NEXTAUTH_SECRET"] as const;

export function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length === 0) return;
  console.error(
    `[api] Missing required env vars: ${missing.join(", ")}.\n` +
    "      In a worktree? Run `pnpm worktree:init` from the worktree root.\n" +
    "      Otherwise, copy .env.example to .env and set the missing vars.",
  );
  process.exit(1);
}
```

Called as the **first line** of `apps/api/src/server.ts` bootstrap, before any Prisma-related imports execute meaningfully. Replaces today's silent `app.prisma = null` cascade. The `REQUIRED_ENV` set is the contract — adding a new required env var means adding it here, and every future missing-env failure is loud and identical.

Initial set: `DATABASE_URL`, `NEXTAUTH_SECRET`. Implementation plan can audit the codebase and expand the list before the PR opens (out of scope for this spec to enumerate them definitively).

### B4 — API bootstrap DB sanity check

In `apps/api/src/app.ts`, immediately after `bootstrapStorage` returns a non-null `prismaClient`, run a connectivity probe:

```ts
if (prismaClient) {
  try {
    await Promise.race([
      prismaClient.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("DB sanity check timed out after 3s")), 3000),
      ),
    ]);
  } catch (err) {
    console.error(
      "[api] DATABASE_URL is set but the database is not reachable.\n" +
      `      ${err instanceof Error ? err.message : String(err)}\n` +
      "      Is Postgres running? Run `pnpm worktree:init` to verify and apply migrations.",
    );
    process.exit(1);
  }
}
```

Catches the failure mode B3 cannot: env var present, DB unreachable. Validated against today's friction — without this check, the API would have silently bound :3000 with `prismaClient = null` (B3 wouldn't fire because env was set; only the DB connection was wrong).

### C2 — Error visibility (two-sided)

The original C2 ("forward `body.message` in `proxyError`") **cannot work alone** because of a finding made during spec validation: `apps/api/src/app.ts:160-172` overrides Fastify's default error handler and explicitly scrubs `error.message` for any 5xx response, replacing it with the literal string `"Internal server error"`. The wire body the dashboard receives is `{error: "Internal server error", statusCode: 500}` — there is no `message` field to forward. C2 must touch both sides.

#### C2a — API: include error details for 5xx in non-production

In `apps/api/src/app.ts`, the `setErrorHandler`:

```ts
app.setErrorHandler((error, _request, reply) => {
  const statusCode = error.statusCode ?? 500;
  const isProd = process.env.NODE_ENV === "production";
  const message =
    statusCode >= 500
      ? isProd
        ? "Internal server error"
        : (error.message ?? "Internal server error")
      : error.message;

  if (statusCode >= 500) app.log.error(error);

  const body: { error: string; statusCode: number; stack?: string } = { error: message, statusCode };
  if (statusCode >= 500 && !isProd && error.stack) body.stack = error.stack;
  return reply.code(statusCode).send(body);
});
```

Production keeps today's scrubbing behavior (no leaking DB query strings, file paths, stack traces). Development surfaces the specific cause. The branch hinges on `NODE_ENV === "production"` — the same gate already used elsewhere in this file.

#### C2b — Dashboard: forward upstream message + log full body

`apps/dashboard/src/lib/proxy-error.ts`:

1. **Body forwarding.** Return shape: `{ error: body.error ?? "Unknown error", statusCode }`. The dashboard now relies on the API's `error` field carrying the real cause (because C2a populates it in dev). The two-arg signature `proxyError(body, status)` is preserved; existing call sites are unchanged.
2. **Server-side log.** Before returning, `console.error("[proxyError]", { status: statusCode, body })`. Includes any extra fields the API attached. No PII concern beyond what's already in API logs — body is already in transit between dashboard server and API server.

Banner copy upstream is unchanged because banners read the `error` field, which now carries the real cause in development.

C2a unblocks C2b: without C2a, C2b is a no-op because there's no useful message in the wire body to forward.

## Testing

Each layer gets a test that locks the persistence property — not just "the code works today" but "the friction stays fixed if a future maintainer touches the surrounding code."

- **B1 — manual smoke test.** In a fresh worktree: delete `.env`, spawn a `:3000` listener, run `pnpm worktree:init`, verify both are fixed and `pnpm dev` brings the stack up. No automated test (interactive ops script with side effects on real ports / Postgres).
- **B1' — `scripts/__tests__/check-env.test.sh`** (bash + a tiny test harness, or vitest spawning the script). Cases:
  - Missing `.env` in worktree → exit 0, stderr mentions `worktree:init`.
  - Present `.env` → exit 0, no stderr.
  - Run from primary worktree → exit 0, no stderr.
- **B3 — unit + integration coverage:**
  - **Unit:** `apps/api/src/__tests__/env.test.ts` — `assertRequiredEnv` exits 1 with each required var unset; passes silently with all set.
  - **Integration / smoke:** `apps/api/src/__tests__/bootstrap-smoke.test.ts` — spawn the actual `apps/api` entry point as a child process with `DATABASE_URL` unset; assert non-zero exit + stderr contains `worktree:init`. This one is the persistence guard: it fails the build if anyone reorders bootstrap so the check is bypassed.
- **B4 — `apps/api/src/__tests__/db-sanity.test.ts`.** Spawn bootstrap with `DATABASE_URL` pointing at a closed port (`postgresql://nobody@127.0.0.1:1/x`); assert exit code 1 + stderr contains `worktree:init`.
- **C2a — `apps/api/src/__tests__/error-handler.test.ts`.** Three cases:
  - In `NODE_ENV=development`, a route that throws `new Error("synthetic-cause")` produces a 500 body with `error === "synthetic-cause"` and includes a `stack` field.
  - In `NODE_ENV=production`, the same route produces `error === "Internal server error"` and no `stack` field.
  - 4xx errors keep `error.message` in both environments (no scrubbing for client errors).
- **C2b — `apps/dashboard/src/lib/__tests__/proxy-error.test.ts`.** Five cases:
  - Forwards `body.error` when present.
  - Falls back to `"Unknown error"` when absent.
  - `console.error` called with full body (spy).
  - Returns the supplied `statusCode`.
  - **Regression case:** for a body `{error: "synthetic-cause", statusCode: 500}` (the shape C2a produces in dev), the returned JSON `error` field equals `"synthetic-cause"`. Locks the C2a → C2b contract that pass-through cannot be silently reverted.

## Rollout

Single PR titled `chore(dx): worktree bootstrap + dashboard error visibility`, six commits for clean bisect:

1. `chore(dx): add scripts/worktree-init.sh + check-env.sh + pnpm worktree:init`
2. `feat(api): fail fast on any missing required env var (REQUIRED_ENV)`
3. `feat(api): bootstrap DB sanity check — exit 1 if Postgres unreachable`
4. `feat(api): include error message + stack in 5xx body when NODE_ENV !== production`
5. `feat(dashboard): proxyError forwards upstream error and logs full body`
6. `docs(claude-md): worktree doctrine — run pnpm worktree:init after add`

Branch `dx/worktree-bootstrap-and-error-visibility` from origin/main, opened from a fresh worktree — dogfooding the very script this PR ships.

## Acceptance Criteria

**Functional (the bug stays fixed today):**

- `pnpm worktree:init` in a fresh worktree produces a runnable dashboard against `/console`.
- API started with any `REQUIRED_ENV` var unset exits cleanly with the actionable error.
- A 500 from `/api/dashboard/organizations` surfaces Fastify's `message` in the DevTools Network response and writes the full body to dashboard stdout.
- Running `pnpm dev` in a fresh worktree without `.env` prints the `pnpm worktree:init` hint.

**Persistence (the bug stays fixed tomorrow):**

- The `bootstrap-smoke` integration test fails the build if the env guard is removed or moved past Prisma initialization.
- The `proxy-error` regression test fails the build if message-forwarding is silently reverted.
- Adding a new required env var is a one-line change to `REQUIRED_ENV` — no other code changes are needed for it to be guarded.
- A new contributor running `pnpm dev` in a fresh worktree discovers `pnpm worktree:init` without reading `CLAUDE.md`.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `proxyError` log too verbose | Low | Trim to `console.warn` of a summary if it pollutes logs in practice |
| Env guard breaks an intentional partial-startup use case (e.g., a CLI tool importing `apps/api`) | Low | `REQUIRED_ENV` lives in its own module so the guard can be opt-in for non-server entry points if it ever matters |
| `predev` hook annoys devs who use multiple `.env.*` files | Low | Hook is non-blocking (exit 0); only prints when `.env` is missing |
| `worktree-init.sh` shell incompatibility | Low | Bash-only (`#!/usr/bin/env bash`); test on macOS zsh and Linux |
| Future env var added but not registered in `REQUIRED_ENV` | Medium | Tradeoff accepted — `REQUIRED_ENV` is the explicit contract; we'd rather miss-add than over-guard. Code review catches it. |

## Deferred Follow-ups

- **C3** (`requestId` correlation, shared error-envelope schema) — revisit once error visibility is treated as a first-class feature.
- **B2** (postinstall auto-bootstrap) — only if `worktree:init` adoption is poor.
