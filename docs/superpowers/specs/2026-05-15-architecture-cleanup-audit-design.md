# Architecture & Codebase Cleanup Audit — Design

**Date:** 2026-05-15
**Status:** Spec — pending user review
**Type:** Multi-agent audit + gated cleanup

## Goal

Run a thorough, parallelized audit of Switchboard's architecture, infrastructure, and codebase, producing a triaged cleanup backlog. Execute approved cleanup work through isolated worktree PRs without colliding with workstreams currently in flight on other Claude sessions.

## Constraints

- **Parallel workstreams in flight** (must not collide):
  - **Local readiness / CI gates** — branches `docs/local-readiness-spec`, `docs/local-readiness-plan`; implementation branch not yet created.
  - **Riley cockpit** — Wave B PR-1 already merged (`feat/riley-wave-b-pr1`, `feat/riley-prod-emitter-wiring`, `feat/riley-wave-b-pr1-followup`); further Riley follow-up may be in progress.
- **One branch per worktree** (per `CLAUDE.md` doctrine).
- **No mutating bypass paths** — audit must not introduce them while flagging them.
- **Token budget** — bounded per-lane reports; raw evidence by file:line, not by inlining files.
- **Existing audit work is authoritative until contradicted.** `.audit/12-pre-launch-security-audit.md` is a 77 KB security audit covering tenant isolation, AI/skill-runtime, auth surface, credential storage, mutation bypass, and OWASP sweep. This audit does **not** redo that work — it diffs against it.

## Shape: Two Waves

### Wave 1 — Discovery (read-only, parallel)

Many Explore subagents dispatched in a single message. Each lane has a tight charter and produces a structured report at a predictable path. Wave 1 never writes outside `docs/audits/2026-05-15-cleanup/`.

### Wave 2 — Cleanup (gated on user triage)

Only after user approves a prioritized backlog. Each approved item becomes either:

- a mechanical fix bundled into a small sweep PR, or
- a structural fix on its own worktree, with brainstorm → spec → plan if non-trivial.

**Hard gate:** Wave 2 does NOT auto-execute. User triages, picks scope, then approves.

## Wave 1 Lanes (20 total, 2 deferred at start)

Each lane is run by an Explore subagent. Output goes to `docs/audits/2026-05-15-cleanup/<lane-slug>.md`.

### Architecture & invariants

1. **doctrine-compliance** — PlatformIngress as sole mutating entry, WorkTrace as canonical persistence, approval as lifecycle state, no bypass paths. Uses `.agent/skills/architecture-audit` playbook.
2. **layer-hygiene** — `schemas → sdk/cartridge-sdk/creative-pipeline/ad-optimizer → core → db → apps`; flag circular deps, wrong-layer imports, barrel files with >40 exports.
3. **route-chain-integrity** — button → API route → store reachability. Uses `.agent/skills/route-chain-audit` + `.agent/tools/check-routes`.
4. **surface-agnostic-backend** — `packages/core`, `packages/schemas`, `packages/db`, `packages/ad-optimizer` free of UI surface references (per `feedback_surface_agnostic_backend`).
5. **cartridge-sdk-removal-readiness** — `packages/cartridge-sdk` is marked pending removal in `CLAUDE.md`. Enumerate live import sites (~245 references across the repo per scout), classify into hard blockers (core uses) vs trivial migrations (test-only, dead exports), and identify what must land before deletion is safe. Output: wind-down inventory + suggested removal order.

### Code health

6. **file-size-splits** — `.ts` files >400 (warn) / >600 (error). **Also** sweep `.tsx` and `.css` since `arch-check` ignores them (per `feedback_arch_check_ts_only`). Known offenders to confirm: dashboard `.module.css` files (`reports`, `activity`, `pipeline`, `detail`, `contact-detail`, `landing` — six files >400 LOC); `packages/db/prisma/seed-marketplace.ts` (972 LOC); `packages/core/src/orchestrator/propose-pipeline.ts` (818 LOC); `apps/api/src/app.ts` (815 LOC).
7. **type-safety** — `any` leaks across both `.ts` AND `.tsx` (excluding documented exceptions in `apps/api` and `auth.ts`), unsafe `as` casts, `@ts-ignore` / `@ts-expect-error` suppressions in dashboard `.tsx` (~264 instances reported by scout), missing null guards, types in `apps/*` that should live in `@switchboard/schemas`.
8. **dead-code** — orphan files, unreferenced exports, never-imported routes, stale feature flags, unused dependencies in `package.json`. **Required sub-audit:** enumerate every Store class exported from `packages/db/src/storage/` (approval, competence, connection, envelope, governance-profile, identity, ledger, lifecycle, pause, policy, risk-posture, role-override, run, session, tool-event — 15 stores) and verify each has ≥1 external caller. Zero-caller stores are HIGH-severity dead code.
9. **lint-debt** — `console.log` slips, `_`-prefixed escapes that mask real bugs, prettier drift (run `pnpm format:check` to enumerate), `.js` extension issues (extra in dashboard imports, missing elsewhere — per `feedback_dashboard_no_js_on_any_import`). Scope explicitly covers `.ts`, `.tsx`, `.mjs`, `.cjs`.

### Tests

10. **coverage-vs-threshold** — global `55/50/52/55` (statements/branches/functions/lines), core `65/65/70/65`. Confirmed exact in `vitest.config.ts` files. Flag packages drifting below or above without threshold update.
11. **missing-co-located-tests** — new modules without sibling `*.test.ts` (CLAUDE.md rule).
12. **test-stability-inventory** — enumerate every `.skip` / `.skipIf` / `.todo` / `it.skip` / `describe.skip` across all test files. Flag known-flake suites from auto-memory (`prisma-work-trace-store-integrity`, `prisma-greeting-signal-store`, `prisma-ledger-storage`). Triage each into "quarantine OK", "needs fix", or "delete". This lane does NOT fix — it inventories.

### Data & API

13. **prisma-hygiene** — migration drift (`pnpm db:check-drift` if Postgres reachable), missing indexes, N+1 includes, raw SQL audit, encryption boundary checks. **Required sub-audits:**
    - Enumerate every `@@index` / `@@unique` name in `schema.prisma`; flag any whose pre-truncation name exceeds 63 chars (per `feedback_prisma_index_name_63_char_limit`); propose canonical Prisma-truncated replacements.
    - Audit all tenant-scoped models for nullable `organizationId String?` (TI-9 in `.audit/12-pre-launch-security-audit.md` flags 11 such models as orphan-row risk). Output: model-by-model list with current nullability + recommended migration.
14. **api-consistency** — error shape, idempotency keys, audit-trail coverage on mutating routes, auth guards. **Required sub-audit:** for high-risk shared types (`ConversationState`, `ApprovalRecord`, `Handoff`, and any approval/lifecycle DTO), grep `apps/api`, `apps/dashboard`, `apps/chat` for local re-declarations that shadow `@switchboard/schemas` exports — these are contract-drift bombs.
15. **fixture-schema-alignment** — `packages/db/prisma/seed-marketplace.ts` (972 LOC), `seed.ts`, and other fixture files are static demo data and drift silently. Verify: (a) seed runs against current schema without errors; (b) demo agent slugs/names align with canonical Alex/Riley/Mira (per `project_canonical_agent_names` — no lingering `nova`/`jordan`); (c) fixture data doesn't reference removed columns or stale enums.

### Security & infra

16. **security-sweep-delta** — **DELTA against `.audit/12-pre-launch-security-audit.md`**, not a from-scratch audit. For each finding in that document, classify as: FIXED (cite commit/PR), STILL-OPEN (cite current evidence), REGRESSED (was fixed, now broken), or NEW (issue not in original audit). Out of scope: re-running OWASP top-10 — that document is authoritative for the original sweep. Also runs `pnpm audit` for CVE deltas since the audit was written.
17. **deploy-infra-parity** — Vercel envs vs `.env.example`, Render config in `infra/`, Sentry coverage gaps, cron registration (Riley emitter, etc.). **Required sub-audit:** enumerate every Inngest function in `apps/api/src/bootstrap/inngest.ts` (654 LOC); verify each has `onFailure` and a DLQ path (launch-blocker #18 flags creative-pipeline as `retries: 3` with no DLQ handler — confirm whether resolved). BullMQ queues if any: same treatment.

### Docs & memory

18. **doctrine-architecture-drift** — `docs/DOCTRINE.md` and `docs/ARCHITECTURE.md` claims vs actual code state.

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

- `packages/core/src/**/riley*` (4 files confirmed — `metrics-riley.ts`, `pipeline-riley.ts`, plus tests)
- `packages/core/src/**/recommendation*` and `packages/core/src/recommendations/**`
- `packages/schemas/src/recommendation*`
- WorkTrace mirror paths in `packages/db` and `packages/core` (resolve precise paths via `git diff main...origin/feat/riley-wave-b-pr1-followup --name-only` at dispatch time)
- `.github/workflows/**`
- Root `package.json` scripts, `turbo.json`, `pnpm-workspace.yaml`
- `.husky/**`
- `apps/dashboard/next.config.mjs`
- `.env.example`
- `docs/superpowers/specs/2026-05-1*`, `docs/superpowers/plans/2026-05-1*`

Note: there is **no** `apps/dashboard/src/app/riley/` route directory — Riley is currently a packages/core feature, not a dashboard route. Earlier draft of this spec incorrectly listed it.

Wave 1 lanes still **report** findings inside these paths (so we know what's there) but tag them `Collides with active work?: yes (<branch>)`. Wave 2 **skips** these paths entirely unless their branches have merged by then.

## Synthesis (main agent, after lanes return)

1. Read all reports from `docs/audits/2026-05-15-cleanup/<lane>.md`.
2. Dedupe overlapping findings (file-size + barrel-file + dead-code tend to collide; cartridge-sdk-removal-readiness will overlap dead-code).
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
- **Dependabot PR noise.** ~20 open dependabot PRs. The `dead-code` and `lint-debt` lanes ignore them; the `security-sweep-delta` lane summarizes them under "Dependency upgrades pending" rather than auditing each.
- **Cartridge-sdk lane collides with dead-code lane.** Both will flag cartridge-sdk dead exports. Synthesis dedupes; cartridge-sdk-removal-readiness lane is authoritative for the wind-down plan.

## Success Criteria

- 18 of 20 lanes complete with structured reports at `docs/audits/2026-05-15-cleanup/<lane>.md` (2 deferred by design).
- Synthesis doc at `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit.md` with ranked backlog.
- Zero collisions with the named in-flight branches (no edits to masked paths during the audit).
- User has a clear, triaged list to pick from for Wave 2.

## Next Step

After user reviews this spec, invoke `superpowers:writing-plans` to produce the per-lane charters and dispatch plan for Wave 1.
