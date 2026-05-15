# Architecture & Codebase Cleanup Audit — Design

**Date:** 2026-05-15
**Status:** Spec — pending user review
**Type:** Multi-agent audit + gated cleanup

## Goal

Run a thorough, parallelized audit of Switchboard's architecture, infrastructure, and codebase, producing a triaged cleanup backlog. Execute approved cleanup work through isolated worktree PRs without colliding with workstreams currently in flight on other Claude sessions.

## Constraints

- **Parallel workstreams in flight** (must not collide):
  - **Local readiness / CI gates** — branches `docs/local-readiness-spec`, `docs/local-readiness-plan`, implementation likely soon on `feat/local-readiness-pr1`.
  - **Riley cockpit** — Wave B PR-1 already merged (`feat/riley-wave-b-pr1`, `feat/riley-prod-emitter-wiring`, `feat/riley-wave-b-pr1-followup`); further Riley follow-up may be in progress.
- **One branch per worktree** (per `CLAUDE.md` doctrine).
- **No mutating bypass paths** — audit must not introduce them while flagging them.
- **Token budget** — bounded per-lane reports; raw evidence by file:line, not by inlining files.

## Shape: Two Waves

### Wave 1 — Discovery (read-only, parallel)

Many Explore subagents dispatched in a single message. Each lane has a tight charter and produces a structured report at a predictable path. Wave 1 never writes outside `docs/audits/2026-05-15-cleanup/`.

### Wave 2 — Cleanup (gated on user triage)

Only after user approves a prioritized backlog. Each approved item becomes either:

- a mechanical fix bundled into a small sweep PR, or
- a structural fix on its own worktree, with brainstorm → spec → plan if non-trivial.

**Hard gate:** Wave 2 does NOT auto-execute. User triages, picks scope, then approves.

## Wave 1 Lanes (17 total, 2 deferred at start)

Each lane is run by an Explore subagent. Output goes to `docs/audits/2026-05-15-cleanup/<lane-slug>.md`.

### Architecture & invariants

1. **doctrine-compliance** — PlatformIngress as sole mutating entry, WorkTrace as canonical persistence, approval as lifecycle state, no bypass paths. Uses `.agent/skills/architecture-audit` playbook.
2. **layer-hygiene** — `schemas → sdk/cartridge-sdk/creative-pipeline/ad-optimizer → core → db → apps`; flag circular deps, wrong-layer imports, barrel files with >40 exports.
3. **route-chain-integrity** — button → API route → store reachability. Uses `.agent/skills/route-chain-audit` + `.agent/tools/check-routes`.
4. **surface-agnostic-backend** — `packages/core`, `packages/schemas`, `packages/db`, `packages/ad-optimizer` free of UI surface references (per `feedback_surface_agnostic_backend`).

### Code health

5. **file-size-splits** — `.ts` files >400 (warn) / >600 (error). **Also** sweep `.tsx` and `.css` since `arch-check` ignores them (per `feedback_arch_check_ts_only`).
6. **type-safety** — `any` leaks (excluding documented exceptions in `apps/api` and `auth.ts`), unsafe `as` casts, missing null guards, types in `apps/*` that should live in `@switchboard/schemas`.
7. **dead-code** — orphan files, unreferenced exports, never-imported routes, stale feature flags, unused dependencies in `package.json`.
8. **lint-debt** — `console.log` slips, `_`-prefixed escapes that mask real bugs, prettier drift (run `pnpm format:check` to enumerate), `.js` extension issues (extra in dashboard imports, missing elsewhere — per `feedback_dashboard_no_js_on_any_import`).

### Tests

9. **coverage-vs-threshold** — global 55/50/52/55, core 65/65/70/65. Flag packages drifting below or above without threshold update.
10. **missing-co-located-tests** — new modules without sibling `*.test.ts` (CLAUDE.md rule).

### Data & API

11. **prisma-hygiene** — migration drift (`pnpm db:check-drift` if Postgres reachable), missing indexes (with the 63-char truncation rule per `feedback_prisma_index_name_63_char_limit`), N+1 includes, raw SQL audit, encryption boundary checks.
12. **api-consistency** — error shape, idempotency keys, audit-trail coverage on mutating routes, auth guards.

### Security & infra

13. **security-sweep** — secret leakage in repo (`.env*`, fixtures, logs), CSP regression check (per `feedback_dashboard_csp`), auth bypass paths, dependency CVE scan (`pnpm audit`).
14. **deploy-infra-parity** — Vercel envs vs `.env.example`, Render config in `infra/`, Inngest webhook registration, Sentry coverage gaps, cron registration (Riley emitter, etc.).

### Docs & memory

15. **doctrine-architecture-drift** — `docs/DOCTRINE.md` and `docs/ARCHITECTURE.md` claims vs actual code state.

### Deferred lanes (do NOT run during this audit)

The following two lanes are **intentionally deferred** because they would collide with currently active parallel work:

- **ci-gate-gaps** — overlaps directly with the in-flight local-readiness PR-1 work. The spec/plan are still being authored on `docs/local-readiness-spec` and `docs/local-readiness-plan`. Re-enable after local-readiness PR-1 merges.
- **spec-plan-rot** — Riley/Alex/local-readiness specs and plans are being actively edited. Stale-detection would produce false positives. Re-enable after all named workstreams merge.

Synthesis step records these as "deferred — re-run after merges" so the backlog stays honest.

## Per-Lane Output Schema

Each lane writes one markdown file with this structure:

```markdown
# <lane-name>

**Charter:** <one sentence>
**Method:** <globs, greps, tools used — keep terse>
**Scope exclusions applied:** <see "Exclusion Masks" below>

## Findings

### [SEV] <short-title>

- **Where:** <file:line>, <file:line>
- **Evidence:** <quote, count, or pattern — verbatim>
- **Why it matters:** <invariant / memory entry / doctrine rule violated>
- **Fix:** <one-liner OR "needs design">
- **Effort:** S / M / L
- **Risk if untouched:** <one line>
- **Collides with active work?:** <yes/no — if yes, name the branch>

## Out of scope / deferred for this lane

- <notes>
```

**Severity ladder:**

- `CRITICAL` — architectural invariant violation, security issue, data loss risk.
- `HIGH` — correctness bug, launch-blocker debt, broken contract.
- `MED` — significant debt with concrete bite (perf, maintainability, drift).
- `LOW` — polish, minor consistency, documentation.

## Exclusion Masks (Wave 1 advisory, Wave 2 enforced)

Before dispatching Wave 1, compute and pin these mask files using `git diff main...origin/<branch> --name-only`:

- `apps/dashboard/src/app/riley/**`
- `packages/core/src/**/riley*`
- `packages/core/src/**/recommendation*`
- `packages/schemas/src/recommendation*`
- WorkTrace mirror paths in `packages/db` and `packages/core`
- `.github/workflows/**`
- Root `package.json` scripts, `turbo.json`, `pnpm-workspace.yaml`
- `.husky/**`
- `apps/dashboard/next.config.mjs`
- `.env.example`
- `docs/superpowers/specs/2026-05-1*`, `docs/superpowers/plans/2026-05-1*`

Wave 1 lanes still **report** findings inside these paths (so we know what's there) but tag them `Collides with active work?: yes (<branch>)`. Wave 2 **skips** these paths entirely unless their branches have merged by then.

## Synthesis (main agent, after lanes return)

1. Read all reports from `docs/audits/2026-05-15-cleanup/<lane>.md`.
2. Dedupe overlapping findings (file-size + barrel-file + dead-code tend to collide).
3. Verify each finding's evidence still matches HEAD — flag stale items, do not auto-fix.
4. Produce `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit.md` (the **synthesis doc**, not this design doc) containing:
   - Top 10 by impact (CRITICAL/HIGH first).
   - Full ranked backlog.
   - "Mechanical-only sweep" candidates (lint, format, dead-imports) called out separately.
   - "Deferred-collision" list — findings blocked on in-flight branches.
   - Deferred lanes to re-run later (`ci-gate-gaps`, `spec-plan-rot`).
5. Stop. User triages.

## Wave 2 Execution (after user approval)

Two execution tracks, gated independently:

### Track A — Mechanical sweep (optional pre-authorization)

Single PR, no design, low collision risk:

- Prettier drift fixes
- Unused-import removal
- `console.log` → `console.warn`/`console.error` swaps
- `.js` extension consistency fixes (per dashboard rule)

Excludes everything in the mask. User can pre-authorize this OR review the diff first. Default: **review first**.

### Track B — Structural fixes

For each approved item:

1. New worktree off `main`: `git worktree add ../switchboard-<slug>` + `pnpm worktree:init`.
2. Brainstorm → spec → plan only if effort = `L` or fix is "needs design".
3. Dispatch via `subagent-driven-development`.
4. Each PR: targeted fix + tests + `pnpm typecheck` + `pnpm --filter @switchboard/dashboard build` if dashboard touched + `pnpm format:check`.
5. Verify branch context (`git branch --show-current`) before commit (per CLAUDE.md).

If a fix's file list intersects the exclusion mask, **do not start it** — wait for the colliding branch to merge, then re-snapshot evidence.

## Guardrails

- **Read-only Wave 1.** Lanes use `subagent_type: "Explore"` — no Edit/Write available.
- **Resumability.** Each lane writes its raw report independently. Failure of one lane doesn't tank the run.
- **Token budget.** Reports cap at ~150 findings per lane; overflow goes to a `## Overflow (truncated)` section listing only file:line.
- **Memory advisory only.** Auto-memory entries in `MEMORY.md` are treated as advisory during the run — they may be edited by other Claude sessions in parallel. Synthesis step does not write to memory.
- **Hard gate on Wave 2.** No autonomous cleanup. User approval required per item or per group.

## Open Risks

- **Stale evidence.** If parallel workstreams rewrite a file between Wave 1 capture and Wave 2 execution, findings on that file need re-snapshotting. Mitigation: the evidence-still-matches check in synthesis, plus the exclusion mask.
- **Lane collisions on shared infra.** `pnpm audit`, `pnpm db:check-drift`, and `.agent/tools/check-routes` each may briefly hold local resources. Lanes invoke them serially within their own subprocess — no cross-lane locking needed because each subagent has its own working state.
- **Dependabot PR noise.** ~20 open dependabot PRs. The `dead-code` and `lint-debt` lanes ignore them; the `security-sweep` lane summarizes them under "Dependency upgrades pending" rather than auditing each.

## Success Criteria

- 15 of 17 lanes complete with structured reports at `docs/audits/2026-05-15-cleanup/<lane>.md`.
- Synthesis doc at `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit.md` with ranked backlog.
- Zero collisions with the named in-flight branches (no edits to masked paths during the audit).
- User has a clear, triaged list to pick from for Wave 2.

## Next Step

After user reviews this spec, invoke `superpowers:writing-plans` to produce the per-lane charters and dispatch plan for Wave 1.
