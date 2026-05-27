## P.3 recon findings — 2026-05-15

Per plan §P.3, recording mismatches from the plan's pre-baked assumptions.

### Task 1 — mcp-server test PREMISE IS FALSE

`pnpm --filter @switchboard/mcp-server test` passes in 540ms today on a fresh
`feat/local-readiness` cut from main. The plan assumes the test times out at
5004ms because `await import("../main.js")` triggers `main()`'s top-level
side effects.

Reality: `apps/mcp-server/src/main.ts:97` already has the entry-point guard
`if (process.env["VITEST"] === undefined) { main().catch(...) }`. Added by
commit 3a8a63e3 on 2026-04-21. So importing `main.js` from a vitest
environment never invokes `main()`, and `buildMutationModeGuard` (defined at
the top of `main.ts`) is reachable cleanly.

Test output (this branch, no changes):

```
✓ src/__tests__/production-mutation-guard.test.ts (2 tests) 540ms
```

**Implication:** Task 1's refactor (extract guard into `guard.ts`) is
unnecessary — there is no symptom to fix. Doing it anyway adds two-file
restructuring with no behavioral payoff.

### Task 2 — enumeration shows 33 missing keys, not 8

Step 2.1's grep against `apps/{api,chat,dashboard,mcp-server}/src` yields 33
keys present in code but absent from `.env.example`. The plan's allowlist
template covers 18 in `required_in_env_example` and ~3 across `ci_only` /
`test_only` / `production_managed`. The remaining ~12 keys need triage per
the plan's Step 2.2 escape hatch (grep call sites, classify).

Surfaced separately to the user — does not change Task 2's structure, just
its size.

### Task 3 — file path correction

The spec's "File touch list" cites `apps/api/src/index.ts` for the route
registration removal. That file does NOT exist. Route registration lives in
`apps/api/src/bootstrap/routes.ts`, and `operatorConfigRoutes` is **never
imported there** — confirmed by `grep -rn operatorConfigRoutes apps/api`.

So Task 3 reduces to: `git rm apps/api/src/routes/operator-config.ts` plus
deleting the dead `operatorConfig` namespace in
`apps/dashboard/src/lib/query-keys.ts`. No bootstrap/routes.ts edit needed.

### Task 5 — schema mapping verified ✓

All four models exist with the documented names: `Opportunity`, `Contact`,
`ApprovalRecord`, `ScheduledTriggerRecord`. Plan's pre-baked seed code
should apply without modification (subject to required-field re-spot-check
in Step 5.1 within the implementer subagent).

### Live-flag baseline ✓

`.env.example` matches plan §1.4's "current default" column exactly:

```
NEXT_PUBLIC_CONTACTS_LIVE=true
NEXT_PUBLIC_AUTOMATIONS_LIVE=false
NEXT_PUBLIC_ACTIVITY_LIVE=false
NEXT_PUBLIC_REPORTS_LIVE=false
NEXT_PUBLIC_APPROVALS_LIVE=false
```

Runtime flag references all live in `apps/dashboard/src/lib/route-availability.ts`.

### Pre-existing test flake confirmed

`pnpm test` fails on `@switchboard/db#test` with the documented
`pg_advisory_xact_lock` errors in `prisma-work-trace-store-integrity.test.ts`,
`prisma-ledger-storage*`, etc. Matches `feedback_db_integrity_tests_pg_advisory_lock.md`.
Reproduces on main — not a regression.

### Dev DB drift

Shared local Postgres has an extra column `BusinessConfig.verification` from
an out-of-tree `prisma db push` (likely from another worktree). Doesn't
affect any Task 5 model. Means `prisma migrate dev` complains; we can use
the DB as-is for seed validation since `BusinessConfig` is untouched here.

### Task 4 — no Mercury "advisory" token exists

Recon for advisory/notice/warning tokens across `(mercury)/**` and
`globals.css` returned only one site-local class
(`automations.module.css .notice` — uppercase metadata strip, no semantic
background/border tokens) and `reports.module.css .livePip.fixture::before`
(an inline pip indicator, also no shared color). No `--mercury-advisory-*`
or `--sw-advisory-*` token exists.

Implication: the new `/reports` `<FixtureModeBanner/>` uses the inline HSL
values from the plan (`hsl(45 55% 96%)` background, `hsl(30 35% 80%)`
border, `hsl(30 55% 46%)` chip — the canonical operator-amber). Centralize
into a shared advisory token if/when a second surface needs the same
treatment.
