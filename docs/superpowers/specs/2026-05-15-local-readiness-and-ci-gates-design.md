# Local Readiness + CI Gates — Design Spec

**Date:** 2026-05-15
**Status:** Approved with edits (user review 2026-05-15)
**Author:** brainstorming session (Approach 4 + Approach 1)
**Sequencing:** Two PRs. PR 1 fixes local; PR 2 makes CI enforce it.

## Goal

After a fresh clone and the documented setup steps, a developer can run `pnpm dev`
and land on a dashboard where every recently-shipped surface (`/alex`, `/riley`,
`/contacts`, `/activity`, `/reports`, `/approvals`, `/automations`) renders **real
local data**, not fixture illusions or empty states. CI then enforces that this
property doesn't regress.

This spec does **not** address production deployment, seam-consumer drift, or any
work beyond making local truthful and keeping it that way.

## Motivation

The "local-first" audit (2026-05-15) found that the structural seam-audit gives
false confidence:

- `pnpm test` is **not green on main** — `apps/mcp-server` test times out.
- `.env.example` is missing 8+ env vars the code reads (silent `undefined` at
  runtime).
- `apps/api/src/routes/operator-config.ts` is fully stubbed dead code masquerading
  as a real route.
- Most Mercury Tools surfaces (`/activity`, `/reports`, `/approvals`,
  `/automations`) default to fixture mode via `NEXT_PUBLIC_*_LIVE=false`.
- Post-seed DB has zero contacts/opportunities/audit entries; live-mode surfaces
  render empty.
- No automated check binds these properties together.

Until these are fixed, a developer can pass typecheck and lint and still ship a
dashboard that shows mock data locally without realizing it.

## Non-goals

- Production data integrity, deployment, or Vercel/Render env-var management
  (covered by deployment foundation PRs #504 / #519 / #526).
- Seam-consumer index (Approach 2) — deferred.
- Quarterly cross-PR sweeps (Approach 3) — deferred.
- Backfilling `operatorConfig` business logic — see PR 1 §3 for the explicit
  delete-vs-finish decision.
- New product features. This is plumbing only.

---

## PR 1 — Local Readiness

**Branch slug:** `feat/local-readiness`
**Outcome:** `pnpm test` green; `.env.example` complete; live-mode surfaces
populated; `pnpm local:verify` script exists and exits 0.

### 1.1 — Fix `pnpm test` on main

**Problem:** `apps/mcp-server/src/__tests__/production-mutation-guard.test.ts`
times out at 5004ms during `await import("../main.js")`.

**Likely root cause:** `apps/mcp-server/src/main.ts` does top-level work
(server bootstrap, network probe, or env-validation that hangs) on import. The
test only needs `buildMutationModeGuard` — a synchronous factory.

**Fix:** extract `buildMutationModeGuard` into a sibling module (e.g.
`apps/mcp-server/src/guard.ts`) that has no top-level side effects, and re-export
from `main.ts`. Update the test to import from the leaner module.

**Acceptance:** `pnpm --filter @switchboard/mcp-server test` completes under 2s
and exits 0. `pnpm test` at root exits 0.

### 1.2 — `.env.example` is the complete superset

**Problem:** The audit found these env keys read by code but absent from
`.env.example`:

- `ALLOW_SELF_APPROVAL`
- `ESCALATION_EMAIL_RECIPIENTS`
- `ESCALATION_NOTIFY_ON_BREACH`
- `ESCALATION_SLA_MINUTES`
- `META_GRAPH_VERSION`
- `OPERATOR_ALERT_WEBHOOK_SECRET`
- `OPERATOR_ALERT_WEBHOOK_URL`
- `SWITCHBOARD_CHAT_URL`
- `WHATSAPP_GRAPH_TOKEN`

**Fix:** Add each with an empty default and a one-line comment describing its
purpose. Group with existing sections (governance, escalations, channels, etc.).
Where a sane default exists (e.g. `META_GRAPH_VERSION=v21.0`,
`SWITCHBOARD_CHAT_URL=http://localhost:3001`), fill it in.

**Acceptance:** `scripts/check-env-completeness.ts` (new — see §1.6) reports zero
missing keys.

### 1.3 — Decide the fate of `operator-config.ts`

**Current state:** `apps/api/src/routes/operator-config.ts` registers four
routes (POST/GET/PUT `/api/operator-config`, GET `/api/operator-config/:orgId/autonomy`).
Lines 8–56 are inline shim types and classes (`AdsOperatorConfigSchema`,
`PrismaAdsOperatorConfigStore`, `ProgressiveAutonomyController`,
`automationLevelToProfile`). Every store call returns `null` or `{}`. The route
loads fine — it's intentional dead code, not broken.

**Dashboard callers:** `query-keys.ts` defines `operatorConfig.current` /
`.autonomy` query keys, but no hook references them. The `operatorConfig` strings
elsewhere in `apps/dashboard` and `apps/api/src/routes/agents.ts` refer to a
_different_ field (agent state blob), not this route.

**Options:**

- **(A) Delete the route + its query keys.** Cleanest. ~200 lines removed. Safe
  because nothing reads it. Re-add when the feature is actually built.
- **(B) Finish the stubs.** Build `AdsOperatorConfigSchema`,
  `PrismaAdsOperatorConfigStore`, `ProgressiveAutonomyController` properly.
  Out of scope for "local readiness" — this is a product feature.
- **(C) Leave it as-is but document.** Adds a test asserting the no-op is
  intentional. Doesn't fix the misleading appearance of a live route.

**Decision (user-approved):** **(A) Delete.** "Local readiness" means local
matches reality. A registered route that always returns null is the kind of
confusing surface this spec is trying to eliminate. If someone needs the
feature, the planned design will re-add it deliberately.

**Isolation requirement:** Deletion touches API route registration and
dashboard query keys, so it must be its own commit within PR 1:
`chore(api): remove unused operator-config stub route`. This makes rollback
trivial if a hidden dependency surfaces.

### 1.4 — Explicit live-flag defaults

**Problem:** `NEXT_PUBLIC_CONTACTS_LIVE` defaults to `true` but other
`NEXT_PUBLIC_*_LIVE` flags default to `false`. Fresh-clone behavior is
inconsistent: `/contacts` tries the API, `/activity` and `/reports` and
`/approvals` and `/automations` render fixtures. Developer can't tell which is
which without reading source.

**Decision matrix:**

| Flag                           | Current default | Spec recommendation | Reasoning                                                           |
| ------------------------------ | --------------- | ------------------- | ------------------------------------------------------------------- |
| `NEXT_PUBLIC_CONTACTS_LIVE`    | `true`          | `true`              | Already correct                                                     |
| `NEXT_PUBLIC_ACTIVITY_LIVE`    | `false`         | `true`              | Audit-log surface should reflect actual local audit entries         |
| `NEXT_PUBLIC_REPORTS_LIVE`     | `false`         | `false` (KEEP)      | Requires connected Meta Ads `Connection`; no local provider yet     |
| `NEXT_PUBLIC_APPROVALS_LIVE`   | `false`         | `true`              | Approvals are first-class architecture per DOCTRINE; should be live |
| `NEXT_PUBLIC_AUTOMATIONS_LIVE` | `false`         | `true`              | Backend shipped (#406); live by default                             |

**Reports stays fixture-mode** because the launch is blocked on a connected
Connection row + issue #472 (memory: `project_reports_is_launch_priority`).
Flipping it on locally would render an error or empty state that's worse than
the fixture.

**Fixture-mode visibility requirement.** Because `/reports` deliberately stays
non-live in local dev, it MUST visibly label itself as fixture/demo data when
rendered with `NEXT_PUBLIC_REPORTS_LIVE !== "true"`. A small persistent banner
or chip near the page header reading "Demo data — not connected to a live ads
account" is sufficient. This prevents the exact failure mode this spec exists
to eliminate: a surface that looks real but isn't.

**Acceptance:** `.env.example` documents each `NEXT_PUBLIC_*_LIVE` flag in one
section with comments explaining why each default was chosen. `/reports`
renders a visible "demo data" indicator when the flag is off.

### 1.5 — Seed expansion for live-mode surfaces

**Problem:** Post-seed DB has org + agents + admin user, but zero domain data.
Live-mode surfaces render empty.

**Required seed additions** (in `packages/db/prisma/seed.ts` or a sibling
`seed-dev-data.ts` loaded only when `NODE_ENV !== "production"`):

- **5–10 contacts/opportunities** spanning all pipeline stages, owned by
  `org_dev`. Covers `/contacts`.
- **15–30 audit entries** via `store_recorded_operator_mutation` or direct
  insert, spanning the last 14 days, multiple actors. Covers `/activity`.
- **2–3 pending approvals** with realistic `bindingHash` / `riskCategory`.
  Covers `/approvals`.
- **1–2 automations** (browse rows from #406). Covers `/automations`.

**Bounds:**

- Seed must remain idempotent (re-runnable without dupes).
- Dev-only data path must be skipped in test runs (CI seed should NOT include
  this — verify against existing test fixtures).
- Do NOT seed Connection rows for Meta Ads. `/reports` stays in fixture mode by
  design (§1.4).

**Acceptance:** After `pnpm db:migrate && pnpm db:seed`, each live-enabled
surface renders **either seeded real data or an explicitly truthful empty
state**. For the initial local demo, `/contacts`, `/activity`, `/approvals`,
and `/automations` MUST render non-empty seeded rows. A surface that is
legitimately empty (e.g., no pending approvals after a drained workflow) is
acceptable IF its empty state is truthful and distinguishable from "broken /
not wired" — i.e., it must read as "no data yet," not as "loading forever" or
"silent fixture fallback."

### 1.6 — `pnpm local:verify` — two-tier script

**Design principle.** A single "mega-check" duplicates CI and frustrates local
devs. Split into a fast structural check (seconds) and a full pre-flight check
(minutes). CI calls only the sub-checks it needs.

#### 1.6.a — `pnpm local:verify:fast`

**New script:** `scripts/local-verify-fast.ts` — structural checks only, no
heavy builds.

**Checks (in order, fail-fast, target wall-clock ≤10s):**

1. **Env completeness.** Parse `process.env.*` references from
   `apps/{dashboard,api,chat}/src/**/*.ts(x)`, diff against `.env.example`
   keys, fail with list of missing keys. Honors the env allowlist (§1.6.c).
2. **Live-mode flag manifest.** Read `.env.example`, parse `NEXT_PUBLIC_*_LIVE`
   defaults, compare against the decision matrix in §1.4. Fail if drifted.
3. **Arch check.** Run `pnpm arch:check`. Fail on non-zero.
4. **Route ingress check.** Run `.agent/tools/check-routes`. Fail on non-zero.
5. **Seed row count (if DB reachable).** Connect to `DATABASE_URL`, query row
   counts for org / agents / opportunities / audit entries / approvals /
   automations. Fail if minimums (§1.5) not met. **Skip with loud warning**
   if `DATABASE_URL` unset or connection fails — print "⚠ skipping seed-count
   check (no DB reachable)" but exit 0.

**Use case:** Developer wants to confirm "did I break local?" before pushing.
CI uses this in the lint/typecheck job.

#### 1.6.b — `pnpm local:verify`

**New script:** `scripts/local-verify.ts` — full pre-flight including builds
and tests. Calls `local:verify:fast` first, then heavy checks.

**Additional checks (after fast checks pass):**

6. **Typecheck.** Run `pnpm typecheck`. Fail on non-zero.
7. **Lint.** Run `pnpm lint`. Fail on non-zero.
8. **Test.** Run `pnpm test`. Fail on non-zero.
9. **Dashboard build.** Run `pnpm --filter @switchboard/dashboard build`. Fail
   on non-zero (closes the [build-not-in-CI gap](feedback_dashboard_build_not_in_ci.md)).
10. **Seed integrity (if DB reachable).** Run `pnpm db:seed` against a clean
    schema, then re-run the seed-count check from step 5. Asserts idempotency
    (re-running seed doesn't dupe). Skip with warning if `DATABASE_URL` unset.

**Use case:** Pre-PR confidence check. Developer runs before pushing a branch
that touches anything load-bearing.

**Behavior:** Both variants exit 0 only if every applicable check passes.
Print a one-line summary per check.

**Acceptance:** `pnpm local:verify` exits 0 from a clean `pnpm install` +
`./scripts/setup-env.sh` + `pnpm db:migrate` + `pnpm db:seed` state.

#### 1.6.c — Env allowlist categories

**New file:** `scripts/env-allowlist.local-readiness.json`

**Categories:**

- `required_in_env_example` — must appear in `.env.example` with an empty or
  default value. Default category for any newly-discovered env var.
- `ci_only` — read only by CI workflows or CI-side scripts. Exempt from
  `.env.example`.
- `test_only` — read only inside `*.test.ts(x)` or test-bootstrap code.
  Exempt.
- `production_managed` — provisioned by Vercel / Render / secret manager;
  must NOT appear in `.env.example` (avoids leaking secret names into
  developer environments). Examples: production DSNs, vendor webhooks.
- `deprecated_allowed_temporarily` — read by code but slated for removal;
  surfaces a warning, not a failure. Each entry must include a `removeBy`
  date.

**Rule:** Every env key the code reads must fall into exactly one category.
The completeness check (§1.6.a step 1) fails if a key is uncategorized OR if
a `required_in_env_example` key is missing from `.env.example` OR if a
`production_managed` key appears in `.env.example`.

**Rationale:** Without categorization, a raw `process.env.*` grep produces
false positives (CI-only vars, test fixtures) and the check gets weakened or
ignored. Explicit categories keep the signal high.

---

## PR 2 — CI Enforcement

**Branch slug:** `chore/ci-local-readiness-gates`
**Outcome:** PR 1's invariants are enforced by the CI workflow. Regressions are
blocked at PR time.

### 2.1 — Identify the existing CI workflow

**Action:** Read `.github/workflows/*.yml` to find the canonical CI workflow.
Document its current job structure in the PR description so reviewers can audit
the additions.

### 2.2 — Add gates to CI

**New CI steps** mapped onto the existing workflow structure:

- **Lint/typecheck job** — add `pnpm local:verify:fast`. Covers env
  completeness, flag manifest, arch check, route ingress, seed-count (skipped
  if no DB attached). Fast, no Postgres needed.
- **Test job** — `pnpm test` (make explicit if currently implicit) +
  `pnpm --filter @switchboard/dashboard build` (closes the build-not-in-CI
  gap).
- **DB job** (Postgres service attached) — `pnpm db:check-drift` + seed
  integrity check (§1.6.b step 10). Only this job needs Postgres.

**Postgres service:** Add the service container only to the DB job. Do NOT
force every job to depend on Postgres — keeps fast jobs fast. Reuse the
service definition `apps/api` tests already use, if one exists.

### 2.3 — Verify CI doesn't slow unacceptably

**Target:** Total CI runtime budget for the new gates: ≤3 minutes added.

**Acceptance:** PR 2's own CI run completes within the project's existing time
expectations. If it exceeds, split into parallel jobs.

---

## Decisions (resolved on user review 2026-05-15)

| Question               | Decision                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Operator-config route  | **Delete** (§1.3). Isolated commit within PR 1.                                                                          |
| Live-flag defaults     | **Accept matrix** (§1.4). Contacts / activity / approvals / automations ON; reports OFF with visible fixture-mode label. |
| Seed dev-data location | **Sibling `seed-dev-data.ts`** called from `seed.ts` only when `NODE_ENV !== "production"`.                              |
| CI Postgres            | **Service container on DB job only.** Don't force every job to depend on Postgres.                                       |
| Offline `local:verify` | **Skip DB checks with a loud warning** when `DATABASE_URL` unset. Exit 0.                                                |

## Implementation order (within PR 1)

User-prescribed sequencing — each step is independently committable:

1. **Fix mcp-server test** — extract side-effect-free guard module
   (`apps/mcp-server/src/guard.ts`), update test import.
2. **Env completeness script + allowlist + `.env.example` updates** — adds
   `scripts/env-allowlist.local-readiness.json` and the 8+ missing keys.
3. **Delete operator-config route + dashboard query keys** — its own
   commit per §1.3.
4. **Live-flag manifest + `.env.example` flag section + `/reports` fixture-mode
   label** — encodes §1.4 decisions in code and UI.
5. **`seed-dev-data.ts`** — populates opportunities, audit entries, approvals,
   automations for `org_dev`.
6. **`local:verify:fast` + `local:verify`** — wires §1.6 checks. CI changes
   come in PR 2.

Steps 1–5 can in principle run in parallel, but the prescribed order keeps the
PR reviewable as a linear narrative: tests-green → env-honest → routes-honest
→ flags-honest → data-real → verify.

## Out of scope (explicit reminders)

- Approach 2 (seam-consumer index in `docs/SEAMS.md` + `pnpm audit:seams`).
  Deferred until local-first is solid.
- Approach 3 (quarterly Explore-agent cross-PR sweep). Deferred.
- Meta spend provider wiring TODO at `apps/api/src/routes/agent-home/metrics.ts:58`.
  Not a local-readiness blocker (graceful null degrade); covered by the
  cockpit roadmap.
- Production env-var management on Vercel / Render. Owned by deployment PRs.

## Success criteria (whole spec)

- Fresh-clone → `pnpm install` → `./scripts/setup-env.sh` → `pnpm db:migrate` →
  `pnpm db:seed` → `pnpm dev` → open `localhost:3002` → `/alex`, `/riley`,
  `/contacts`, `/activity`, `/approvals`, `/automations` all render seeded
  real data (or a truthful empty state per §1.5). `/reports` renders fixture
  data with a visible "demo data" label per §1.4.
- `pnpm local:verify:fast` exits 0 in seconds. `pnpm local:verify` exits 0
  including builds and tests.
- CI fails on any of: missing env var (uncategorized or required-but-absent),
  `pnpm test` regression, dashboard build break, arch-check violation,
  route-ingress violation, Prisma drift, live-flag manifest drift, or seed-row
  minimums unmet.

## File touch list (estimate)

**PR 1:**

- `apps/mcp-server/src/main.ts` (refactor)
- `apps/mcp-server/src/guard.ts` (new)
- `apps/mcp-server/src/__tests__/production-mutation-guard.test.ts` (update import)
- `.env.example` (add 8+ keys, group live flags with rationale comments)
- `apps/api/src/routes/operator-config.ts` (delete)
- `apps/api/src/index.ts` (remove route registration)
- `apps/dashboard/src/lib/query-keys.ts` (remove dead `operatorConfig` query keys)
- `apps/dashboard/src/app/(auth)/(mercury)/reports/**` (add fixture-mode label
  banner — exact component path TBD by plan)
- `packages/db/prisma/seed.ts` (call dev-data seed when not production)
- `packages/db/prisma/seed-dev-data.ts` (new)
- `scripts/local-verify-fast.ts` (new)
- `scripts/local-verify.ts` (new — calls fast then heavy checks)
- `scripts/check-env-completeness.ts` (new — used by local-verify-fast)
- `scripts/env-allowlist.local-readiness.json` (new — env categories)
- `package.json` (add `local:verify:fast` and `local:verify` scripts)

**PR 2:**

- `.github/workflows/*.yml` (the canonical CI workflow — add `local:verify:fast`
  to lint/typecheck job, add Postgres service container to DB job only,
  ensure `pnpm test` + dashboard build run explicitly)
