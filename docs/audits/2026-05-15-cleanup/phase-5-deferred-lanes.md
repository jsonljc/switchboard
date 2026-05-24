# Phase 5 — Deferred-Lane Re-Run (`ci-gate-gaps` + `spec-plan-rot`)

**Date:** 2026-05-24
**Closes:** the two lanes intentionally deferred in the 2026-05-15 cleanup audit (design §"Deferred lanes", triage §"Phase 5"). Deadline was 2026-05-29; both preconditions are now met.
**Preconditions verified met:**

- `ci-gate-gaps` — local-readiness PR-1 has merged (`pnpm local:verify:fast` exists and runs in CI).
- `spec-plan-rot` — all named blocking workstreams have merged (Riley Wave A/B, Alex cockpit, local-readiness, and the full Route Governance Contract v1).

Both lanes were dispatched as read-only Explore subagents per the audit's Explore Subagent Charter Template. Findings below are the **controller-triaged** versions of their reports (one subagent finding was rejected as a stale-tree artifact — see note).

---

## Lane: `ci-gate-gaps`

**Charter:** Identify classes of regression that can land on `main` because no CI gate enforces against them — gaps between project conventions/doctrine and what CI actually blocks.

**Method:** Read `.github/workflows/ci.yml` (all jobs/steps on `pull_request`), root `package.json` + `turbo.json` scripts, `vitest.config.ts` (root + dashboard), `scripts/arch-check.ts`, `scripts/local-verify-fast.ts`, `.agent/tools/check-routes.ts`. Cross-checked the documented gap list and measured blast radius of each candidate fix against `origin/main`.

### Verified CLOSED since the original audit

- **Dashboard `next build` is now in CI** — `ci.yml:221` runs `pnpm --filter @switchboard/dashboard build`. (Previously a documented gap: `.js`-extension import regressions slipped past lint+typecheck+vitest.)
- **Schema drift is gated** — `ci.yml:57` runs `pnpm db:check-drift` (blocking).
- **Route governance is BLOCKING** — `ci.yml:319` runs `check-routes --mode=error` (no `continue-on-error`), live on `main` since PR-4C (`61d3495f`).
- **Coverage thresholds enforced** — root `vitest.config.ts` (55/50/52/55) + dashboard's own `vitest.config.ts` (40/35/40/40); both run under `vitest run --coverage` in CI.

### REJECTED subagent finding (stale-tree artifact)

The `ci-gate-gaps` subagent reported a HIGH "route governance is non-blocking (`--mode=warn-touched` + `continue-on-error`)". This was read off a **local checkout behind `origin/main`** (local was at `e76ac845`/PR-4B; PR-4C `61d3495f` was already on `origin/main`). Verified against `origin/main:.github/workflows/ci.yml:319` → `--mode=error`, no `continue-on-error`. **Finding rejected.** (Lesson: audit subagents must read the remote tip, not a possibly-behind local working copy.)

### Findings (triaged)

#### [MED] `format:check` glob is `.ts`-only — `.tsx` and `.css` formatting unguarded
- **Where:** `package.json:20` (`"format:check": "prettier --check \"packages/*/src/**/*.ts\" \"apps/*/src/**/*.ts\""`), invoked at `ci.yml:160`.
- **Evidence:** glob matches only `*.ts`. **29** `.tsx`/`.css` files currently fail `prettier --check` (measured 2026-05-24). The CI format gate never sees them.
- **Why it matters:** `feedback_ci_prettier_not_in_local_lint` documents that CI's `format:check` is the only prettier gate; with a `.ts`-only glob, dashboard component + CSS-module style drift accrues silently.
- **Fix → needs a prep sweep (NOT a one-liner):** widening the glob turns the *blocking* CI format step red on 29 files immediately. Must run `prettier --write` on `.tsx`/`.css` first (in a PR that doesn't straddle active dashboard work), then widen the glob. Tracked.
- **Effort:** M · **Risk if untouched:** slow style drift in ~360 `.tsx`/`.css` files.

#### [MED] `arch-check` walks `.ts` only — file-size gate blind to `.tsx`/`.css`
- **Where:** `scripts/arch-check.ts:110` (`walkDir(srcDir, ".ts")`) + `:217`; runs blocking at `ci.yml:313`.
- **Evidence:** confirms the standing `feedback_arch_check_ts_only` memory. **4** `.tsx`/`.css` files already exceed the 600-line error threshold: `reports.module.css` (1350), `globals.css` (1193), `activity.module.css` (941), `riley-cockpit-page.test.tsx` (720); plus **9** in the 400–600 warn band.
- **Why it matters:** the 600-line "error" invariant (CLAUDE.md) is silently unenforced for the entire dashboard component + stylesheet surface.
- **Fix → needs design (NOT a flip):** naively adding `.tsx`/`.css` to `walkDir` turns blocking arch-check red on 4 files. Open questions a fix must answer: should a 1350-line **CSS module** be subject to a TS god-module rule (or a separate CSS budget)? should **test files** (`*.test.tsx`) be exempt or higher-capped? Needs a small design pass + likely file splits/exemptions before enabling. Tracked.
- **Effort:** M · **Risk if untouched:** dashboard god-components/CSS grow unchecked.

#### [LOW] `arch-check` package file-count report undercounts `.tsx`-heavy packages
- **Where:** `scripts/arch-check.ts:201-206`, `:217`.
- **Evidence:** package "source files" count derives from `walkDir(srcDir, ".ts")`; dashboard reports ~80 source files but has 150+ `.tsx`. Visibility-only (per-file `max-lines` still applies); folded into the arch-check fix above.
- **Effort:** S (rides the MED arch-check fix).

#### [LOW] Dashboard's separate 40% coverage threshold isn't isolated in CI output
- **Where:** root `vitest.config.ts:8` (excludes `apps/dashboard/**`) + `apps/dashboard/vitest.config.ts`.
- **Evidence:** threshold IS enforced (vitest fails on breach); only the CI *labelling* is non-obvious. No functional gap. Documentation-only.
- **Effort:** S · folded into Phase 4 (no dedicated action).

### Triage outcome (`ci-gate-gaps`)
- 4 documented gaps **verified CLOSED**; 1 subagent finding **rejected** (stale tree).
- 2 real MED gaps (`format:check` + `arch-check` extension coverage) → **tracked in issue #657** (each needs a prep sweep / design, not a safe in-PR flip).
- 2 LOW items fold into the arch-check fix / Phase 4.

---

## Lane: `spec-plan-rot`

**Charter:** Detect rot in `docs/superpowers/{specs,plans}` — docs presenting merged/superseded/abandoned work as in-flight, broken cross-references, stale state contradicting the codebase.

**Method:** Inventoried all specs + plans; read status headers + "next step" sections; verified each against `git log` (PR numbers / feature slugs) and the filesystem; sampled load-bearing path references.

### Findings (triaged)

#### [MED] Four spec headers claimed "pending user review" for fully-shipped work — FIXED in this PR
- **Where:** `2026-05-16-route-governance-contract-v1.md:4`, `2026-05-15-operator-direct-ingress-pattern.md:4`, `2026-05-15-architecture-cleanup-audit-design.md:4`, `2026-05-22-classifier-eval-pr2-completion-design.md:4`.
- **Evidence:** all four read `**Status:** Spec — pending user review`. Reality: Route Governance Contract v1 shipped end-to-end (PRs #614/#624/#627/#632/#641/#636/#638/#645/#651/#656, all merged); Operator-Direct Ingress pattern applied across Phase 1 migrations (#568/#570/#571/#572/#582) and generalized by the Contract; the audit-design doc is approved + mid-execution; classifier-eval PR-2 fixtures (#619) + baseline (#623) shipped and superseded by the PR-3 gate (#629).
- **Why it matters:** a reader would assume design review is still blocking work that is in fact merged and (for route governance) **blocking-enforced** on `main` — risking issues filed against already-forbidden patterns, or work that re-litigates settled design.
- **Severity note:** the subagent rated the route-governance header CRITICAL; downgraded to MED per the severity ladder — a stale status header misleads but does not by itself corrupt a live architecture decision.
- **Fix:** ✅ **Done in this PR** — each header rewritten to its true state with merged-PR SHAs and a "historical design record" marker.
- **Effort:** S · **Risk:** resolved.

### Verified clean
- **Cross-references:** sampled load-bearing paths (audit dir, `DOCTRINE.md`, `state-machine.ts`, `chat.ts`, `.agent/conventions/*`) all resolve. No broken load-bearing path refs found.
- **Implementation plans (Alex/Riley/local-readiness/consent/classifier-eval/etc.):** their past-tense language + checked-off TODOs are intentional execution records, not rot — left as-is.
- **Orphaned plans:** none found; every active plan maps to an active spec or merged work.

### Triage outcome (`spec-plan-rot`)
- 1 MED rot cluster (4 stale status headers) → **fixed in this PR** (docs-only, zero CI risk).
- No CRITICAL/HIGH residue; no broken refs; no orphans.

---

## Phase 5 closing summary

- Both deferred lanes re-run **before** the 2026-05-29 deadline.
- **Fixed in this PR (safe, docs-only):** 4 stale spec status headers.
- **New tracked issue:** `ci-gate-gaps` — `format:check` + `arch-check` are `.ts`-only (both need a prep sweep/design before the *blocking* gate can be widened).
- **Folded into Phase 4:** dashboard coverage-label visibility (LOW).
- **Verified CLOSED, no action:** dashboard `next build` in CI, schema-drift gate, route-governance blocking enforcement, coverage thresholds.
- **No new CRITICAL/HIGH findings.** The audit loop (Phase 5) is closed; remaining open phases are 3B (Inngest Failure Contract — design-led) and 4 (maintenance backlog — opportunistic).
