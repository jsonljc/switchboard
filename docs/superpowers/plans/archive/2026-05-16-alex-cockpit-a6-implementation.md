# Alex Cockpit A.6 — Retirement + Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the orphaned legacy `apps/dashboard/src/components/agent-home/` tree (umbrella consumer `agent-home-shell.tsx` + 5 block files + 3 internal helpers + 2 portrait sprites), the 2 colocated hooks that exit with it (`use-agent-wins.ts`, `use-agent-pipeline.ts`), and the orphaned `apps/dashboard/src/lib/cockpit/activity-kind-map.ts` translator, plus every colocated test for the above. 28 file deletions, 0 file modifications, 0 new files. After A.6 lands, Alex Cockpit Phase A is fully closed (6/6) and the umbrella spec is fully implemented.

**Architecture:** **Pure deletion sweep.** Leaf-first traversal of two self-contained subgraphs, with a zero-reference grep before each `rm`. The first subgraph (verified 2026-05-15): `agent-home-shell.tsx` → 5 block files + agent-block-boundary → 3 internal helpers (prose-segments, sparkline, fixture-folio-badge) + portrait/{alex,riley}; `agent-home-shell.tsx` has zero external consumers; nothing outside `agent-home/` imports from `agent-home/`; `use-agent-wins.ts` + `use-agent-pipeline.ts` consume hooks only used by `agent-home-shell.tsx`. The second subgraph: `apps/dashboard/src/lib/cockpit/activity-kind-map.ts` exports `translatedActionToActivityRow` consumed only by its own test (the active activity-stream path uses `useAgentActivityCockpit` → dashboard proxy → server-side row mapping; `activity-kind-map.ts` is a vestige of an earlier client-side translation step). Deleting `agent-home-shell.tsx` first orphans the first subgraph in one wave; subsequent deletions verify the cascade with a grep before each `rm`. `activity-kind-map.ts` deletes independently as a 2-file pair (source + test). No `HaltProvider` re-root. No `legacy-shapes.ts` or `use-agent-activity.ts` deletion (still consumed by cockpit / Riley). No `/team` precursor PR (`/team` consumes nothing from `agent-home/`). No backend touch.

**Tech Stack:** No new code. `pnpm` for test/lint/build/typecheck/format. `rg` for zero-reference grep. `git rm` for deletions.

**Parent docs:**

- [`docs/superpowers/plans/2026-05-16-alex-cockpit-a6-slice-brief.md`](./2026-05-16-alex-cockpit-a6-slice-brief.md) — scope, what-ships-vs-defers, risks, design decisions, zero-reference investigation results.
- [`docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md`](../specs/2026-05-14-alex-cockpit-home-design.md) — §A.6 (lines 83-93), §"Candidate deletion list for A.6 cleanup" (lines 953-971), §Scope §"Retirement of the existing block components" (line 198), §Acceptance criterion §14 (line 1021).
- [`docs/superpowers/plans/2026-05-15-alex-cockpit-a5-implementation.md`](./2026-05-15-alex-cockpit-a5-implementation.md) — structural template (boundary locks, precondition checks, pre-merge gates pattern).

> **The umbrella spec is authoritative.** If anything in this plan expands A.6's scope — re-rooting `HaltProvider`, deleting cockpit dependencies like `legacy-shapes.ts` / `activity-kind-map.ts` / `use-agent-activity.ts`, touching `packages/**` or `apps/api/**` / `apps/chat/**` / `apps/mcp-server/**`, refactoring `/team`, modifying backend API routes, lowering coverage thresholds — the spec + slice brief win and the conflicting text here is wrong. Resolve in favor of the narrowest cleanup interpretation; re-open the brief if a real conflict surfaces.

---

## Boundary locks (read before every task)

These contracts are easy to violate accidentally. Executors must respect them across every task:

1. **Zero-reference before deletion.** For every candidate file `X`, `rg "<filename without extension>|<exported symbol>"` must return only self-references (the file itself + its own `__tests__/X.test.tsx`) before `git rm` runs. The plan ships a Task that captures the grep output and **halts the slice if it returns a non-self match**. No "delete and hope" sweeps.

2. **No new surface.** A.6 only deletes. Any new file in `git diff origin/main..HEAD --diff-filter=A` is a violation. Any modified file outside the agent-home subgraph (`apps/dashboard/src/components/agent-home/**`, `apps/dashboard/src/hooks/use-agent-{wins,pipeline}.ts`, `apps/dashboard/src/hooks/__tests__/use-agent-{wins,pipeline}.test.tsx`) is a violation. The implementation plan ships a pre-merge gate that asserts the diff contains only deletions.

3. **No `HaltProvider` re-root.** `apps/dashboard/src/components/layout/halt/halt-context.tsx` is **not modified** in A.6. `apps/dashboard/src/components/layout/editorial-auth-shell.tsx` is **not modified** in A.6. The architecture diverged from the spec's assumption — both `/alex` and `/riley` continue to wrap their cockpit in `EditorialAuthShell`, which all non-cockpit surfaces also rely on. Re-rooting belongs to its own slice if ever needed. See slice brief §Design Decisions §1.

4. **No deletion of `legacy-shapes.ts` or `use-agent-activity.ts`.** The A.5 brief's "What comes after A.5" speculative sketch listed both; verification on `main` shows them as **active dependencies** — `legacy-shapes.ts` is consumed by `kpi-strip.tsx` + `metrics-to-kpi-input.ts`; `use-agent-activity.ts` is consumed by Riley-side hooks (`use-riley-activity.ts`, `use-riley-status.ts`) and the Riley translator + fixtures (`TranslatedAction` type). The implementation plan does not delete them. **The third file in that sketch — `activity-kind-map.ts` — IS a deletion candidate** (verified orphaned; only its own test consumes its export). See slice brief §Design Decisions §4 and Task 12 below (the dedicated activity-kind-map deletion task).

5. **No backend touch.** Zero edits under `packages/**`, `apps/api/**`, `apps/chat/**`, `apps/mcp-server/**`. The orphaned API routes `/api/dashboard/agents/[agentId]/wins` + `/pipeline` and their `packages/core/src/agent-home/{wins,pipeline}.ts` backends survive A.6; a separate post-A.6 follow-up PR sweeps them with its own discipline. See slice brief §"What does NOT ship at A.6" + §Risks §5.

6. **Test deletion is colocated with source deletion in the same commit.** When `X.tsx` is `git rm`-ed, `__tests__/X.test.tsx` is `git rm`-ed in the same task and commit. The deletion never leaves a test file orphan-pointing at a missing import.

7. **No coverage-threshold lowering.** Per `CLAUDE.md` §Code Basics: global 55/50/52/55. If the post-deletion `pnpm test -- --coverage` reports a dip below threshold, the slice halts; the brief is re-opened. No "lower the floor to make CI green." Per `[[ship-clean-not-followup]]`.

---

## Precondition checks

Run before Task 1.

- [ ] **Step 0a: Confirm worktree, branch, and base.**

```bash
git branch --show-current
git status --short
git log --oneline origin/main..HEAD
```

Expected: branch `feat/alex-cockpit-a6` (the implementation branch — separate from `docs/alex-cockpit-a6-plan` which holds this brief + plan). Working tree clean. Zero commits ahead of `origin/main` at start of implementation. If commits exist, verify they belong to this slice; otherwise halt.

- [ ] **Step 0b: Verify A.1–A.5 artifacts exist on `main`.**

```bash
ls apps/dashboard/src/components/cockpit/cockpit-page.tsx \
   apps/dashboard/src/components/cockpit/topbar.tsx \
   apps/dashboard/src/components/cockpit/identity.tsx \
   apps/dashboard/src/components/cockpit/mission-popover.tsx \
   apps/dashboard/src/components/cockpit/empty-state.tsx \
   apps/dashboard/src/components/cockpit/kpi-strip.tsx \
   apps/dashboard/src/components/cockpit/roi-bar.tsx \
   apps/dashboard/src/components/cockpit/activity-stream.tsx \
   apps/dashboard/src/components/cockpit/thread-preview.tsx \
   apps/dashboard/src/components/cockpit/composer.tsx \
   apps/dashboard/src/components/cockpit/command-palette.tsx \
   apps/dashboard/src/app/\(auth\)/alex/page.tsx \
   apps/dashboard/src/app/\(auth\)/riley/page.tsx
```

Expected: all 13 files exist. If any is missing, the A.1–A.5 baseline has shifted — halt and investigate.

- [ ] **Step 0c: Confirm `[agentKey]` route is already collapsed.**

```bash
ls -d apps/dashboard/src/app/\(auth\)/\[agentKey\]/ 2>&1 || echo "(directory does not exist — expected)"
```

Expected: directory does not exist. PR #468 (`d8b17625`, 2026-05-08) collapsed it. If it exists, halt — the baseline has regressed and A.6's plan needs to be re-scoped to handle the legacy route.

- [ ] **Step 0d: Confirm `HaltProvider` is still mounted in `EditorialAuthShell`.**

```bash
grep -n "HaltProvider" apps/dashboard/src/components/layout/editorial-auth-shell.tsx
```

Expected: `import { HaltProvider } from "./halt/halt-context";` plus a `<HaltProvider>` open/close pair wrapping the shell's children. If the import is missing, the provider has moved — halt and re-read the brief's §Spec-conflict resolution before continuing.

- [ ] **Step 0e: Re-verify `/team` consumes no `agent-home/` import.**

```bash
rg "from \"@/components/agent-home" apps/dashboard/src/components/team apps/dashboard/src/app/\(auth\)/settings/team
rg "components/agent-home" apps/dashboard/src/components/team apps/dashboard/src/app/\(auth\)/settings/team
```

Expected: empty output for both. If either returns a match, a `/team` consumer has appeared since 2026-05-15 — halt and re-open the brief; A.6 does not silently expand to refactor `/team`.

- [ ] **Step 0f: Re-verify the deletion-candidate subgraph is still self-contained.**

```bash
rg -l "from \"@/components/agent-home|components/agent-home/" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx' \
   | grep -v "^apps/dashboard/src/components/agent-home/"
```

Expected: empty output. The only files importing `@/components/agent-home/*` should be other files inside `apps/dashboard/src/components/agent-home/`. A non-empty result means the subgraph has gained an external consumer — halt and re-open the brief.

- [ ] **Step 0g: Baseline tests pass.**

```bash
pnpm reset
pnpm typecheck
pnpm lint
pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/dashboard build
```

Expected: all green. Per `CLAUDE.md`: `pnpm reset` clears stale `dist/` before typecheck. Per `[[dashboard-build-not-in-ci]]`: `pnpm --filter @switchboard/dashboard build` is the only gate that catches `.js`-extension regressions in Next.js imports — run it locally now to confirm the baseline is clean.

Pre-existing flakes that may surface (per `[[db-integrity-tests-pg-advisory-lock]]`): `prisma-work-trace-store-integrity`, `prisma-ledger-storage`, `prisma-greeting-signal-store`. If they fail on the baseline (not introduced by A.6), record them and proceed; do not block on them.

- [ ] **Step 0h: Capture baseline coverage.**

```bash
pnpm --filter @switchboard/dashboard test -- --coverage 2>&1 | tail -30
```

Capture the four coverage percentages (statements / branches / functions / lines). The post-deletion gate at Task 13 asserts each stays at or above its floor; comparing to this baseline helps catch a marginal dip.

---

## File Structure

### Files created

**None.** A.6 is pure deletion.

### Files deleted

| Path                                                                               | Notes                                                                                         |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/components/agent-home/agent-home-shell.tsx`                    | Umbrella consumer; zero external consumers. Deleted first.                                    |
| `apps/dashboard/src/components/agent-home/__tests__/agent-home-shell.test.tsx`     | Colocated test.                                                                               |
| `apps/dashboard/src/components/agent-home/agent-block-boundary.tsx`                | Block-tree primitive; only used by shell.                                                     |
| `apps/dashboard/src/components/agent-home/__tests__/agent-block-boundary.test.tsx` | Colocated test.                                                                               |
| `apps/dashboard/src/components/agent-home/greeting-block.tsx`                      | Only used by shell.                                                                           |
| `apps/dashboard/src/components/agent-home/__tests__/greeting-block.test.tsx`       | Colocated test.                                                                               |
| `apps/dashboard/src/components/agent-home/needs-you-block.tsx`                     | Only used by shell.                                                                           |
| `apps/dashboard/src/components/agent-home/__tests__/needs-you-block.test.tsx`      | Colocated test.                                                                               |
| `apps/dashboard/src/components/agent-home/wins-block.tsx`                          | Only used by shell.                                                                           |
| `apps/dashboard/src/components/agent-home/__tests__/wins-block.test.tsx`           | Colocated test.                                                                               |
| `apps/dashboard/src/components/agent-home/metrics-block.tsx`                       | Only used by shell.                                                                           |
| `apps/dashboard/src/components/agent-home/__tests__/metrics-block.test.tsx`        | Colocated test.                                                                               |
| `apps/dashboard/src/components/agent-home/pipeline-block.tsx`                      | Only used by shell.                                                                           |
| `apps/dashboard/src/components/agent-home/__tests__/pipeline-block.test.tsx`       | Colocated test.                                                                               |
| `apps/dashboard/src/components/agent-home/prose-segments.tsx`                      | Only used by greeting/metrics/wins-block.                                                     |
| `apps/dashboard/src/components/agent-home/__tests__/prose-segments.test.tsx`       | Colocated test.                                                                               |
| `apps/dashboard/src/components/agent-home/sparkline.tsx`                           | Only used by metrics-block.                                                                   |
| `apps/dashboard/src/components/agent-home/__tests__/sparkline.test.tsx`            | Colocated test.                                                                               |
| `apps/dashboard/src/components/agent-home/fixture-folio-badge.tsx`                 | Only used by deleted blocks.                                                                  |
| `apps/dashboard/src/components/agent-home/__tests__/fixture-folio-badge.test.tsx`  | Colocated test.                                                                               |
| `apps/dashboard/src/components/agent-home/portrait/alex.tsx`                       | Only used by greeting-block.                                                                  |
| `apps/dashboard/src/components/agent-home/portrait/riley.tsx`                      | Only used by greeting-block.                                                                  |
| `apps/dashboard/src/hooks/use-agent-wins.ts`                                       | Only consumed by shell.                                                                       |
| `apps/dashboard/src/hooks/__tests__/use-agent-wins.test.tsx`                       | Colocated test.                                                                               |
| `apps/dashboard/src/hooks/use-agent-pipeline.ts`                                   | Only consumed by shell.                                                                       |
| `apps/dashboard/src/hooks/__tests__/use-agent-pipeline.test.tsx`                   | Colocated test.                                                                               |
| `apps/dashboard/src/lib/cockpit/activity-kind-map.ts`                              | Exports `translatedActionToActivityRow`; only consumer is its own test (verified 2026-05-15). |
| `apps/dashboard/src/lib/cockpit/__tests__/activity-kind-map.test.ts`               | Colocated test.                                                                               |

**Total: 28 file deletions in the manifest above. The two empty directories (`apps/dashboard/src/components/agent-home/portrait/` and `apps/dashboard/src/components/agent-home/`) disappear naturally — git does not track empty directories — but the implementation plan confirms with `ls`.**

### Files explicitly NOT modified

- **A.1–A.5 cockpit artifacts** — `apps/dashboard/src/components/cockpit/**`, `apps/dashboard/src/lib/cockpit/**`, `apps/dashboard/src/hooks/use-cockpit-status.ts`, `apps/dashboard/src/hooks/use-agent-mission.ts`, `apps/dashboard/src/hooks/use-agent-greeting.ts`, `apps/dashboard/src/hooks/use-agent-metrics.ts`, `apps/dashboard/src/hooks/use-agent-activity.ts`. Active surface.
- **Riley cockpit + adapters** — `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`, `riley-cockpit-page.test.tsx`, `apps/dashboard/src/lib/cockpit/riley/**`, `apps/dashboard/src/hooks/use-riley-*`. Independent surface.
- **Cockpit-side library files partially mistaken in the A.5 brief's "What comes after A.5" sketch** — `apps/dashboard/src/lib/cockpit/legacy-shapes.ts` and `apps/dashboard/src/hooks/use-agent-activity.ts` are NOT deleted; both are active dependencies (legacy-shapes powers the cockpit KPI strip via `kpi-strip.tsx` + `metrics-to-kpi-input.ts`; use-agent-activity is consumed by Riley-side hooks + translator). The third file in that sketch, `apps/dashboard/src/lib/cockpit/activity-kind-map.ts`, **IS deleted** in this slice (see Task 12 — the dedicated activity-kind-map deletion task). See slice brief §Design Decisions §4.
- **Routes** — `apps/dashboard/src/app/(auth)/alex/page.tsx`, `apps/dashboard/src/app/(auth)/riley/page.tsx`, `apps/dashboard/src/app/(auth)/layout.tsx`. Untouched.
- **Layout shell + halt provider** — `apps/dashboard/src/components/layout/editorial-auth-shell.tsx`, `apps/dashboard/src/components/layout/halt/halt-context.tsx`. No re-root.
- **`/team`** — `apps/dashboard/src/components/team/**`, `apps/dashboard/src/app/(auth)/settings/team/**`. Verified clean of agent-home imports.
- **`apps/dashboard/src/lib/agent-home/types.ts`** — still consumed by `use-agent-greeting.ts`, `use-agent-metrics.ts`, `metrics-types.ts`, `governance.ts`, `route-availability.ts`. Two of its exports (`WinsViewModel`, `PipelineViewModel`) become orphan; trimming individual exports is out of scope.
- **`packages/**`, `apps/api/**`, `apps/chat/**`, `apps/mcp-server/**`** — out of scope. Surface-agnostic backend invariant trivially holds.

---

## Adapter-boundary invariant (unchanged from A.1–A.5 and Riley B.1/B.2a/B.2b/B.3)

A.6 adds **zero** new imports anywhere. The expected outcome is that the count of audit-domain imports inside `apps/dashboard/src/components/cockpit/**` and `apps/dashboard/src/hooks/**` goes **down** as the deleted hooks (`use-agent-wins.ts`, `use-agent-pipeline.ts`) take their `@switchboard/schemas` + view-model imports with them.

Pre-merge grep gate (Task 13):

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected outcome: the result is a **subset** of `main`'s match set, never a superset.

## Surface-agnostic backend invariant (per `[[surface-agnostic-backend]]`)

A.6 makes **zero** edits under `packages/**`, `apps/api/**`, `apps/chat/**`, `apps/mcp-server/**`. Trivially clean.

```bash
git diff origin/main..HEAD -- packages/ apps/api apps/chat apps/mcp-server
```

Expected: empty output.

---

## Locked code references

A.6 ships no new code. The only "locked" content is the zero-reference grep recipe (Task 1) and the deletion order (Tasks 2–10), both derived from the slice brief's investigation findings.

### Zero-reference grep recipe (Task 1 + each delete task)

For each candidate file at path `apps/dashboard/src/components/agent-home/<name>.tsx`, the grep is:

```bash
rg -l "<ExportedComponentName>|components/agent-home/<name>" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx' \
   | grep -v "^apps/dashboard/src/components/agent-home/<name>\.tsx$" \
   | grep -v "^apps/dashboard/src/components/agent-home/__tests__/<name>\.test\.tsx$"
```

Expected: empty output. If non-empty, halt — investigate the consumer and either refactor it into the cockpit, document it in the brief, or remove the file from the sweep.

For hooks (`use-agent-wins.ts`, `use-agent-pipeline.ts`):

```bash
rg -l "use-agent-<name>|useAgent<PascalName>" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx' \
   | grep -v "^apps/dashboard/src/hooks/use-agent-<name>\.ts$" \
   | grep -v "^apps/dashboard/src/hooks/__tests__/use-agent-<name>\.test\.tsx$"
```

Expected: empty output (after Task 2 deletes `agent-home-shell.tsx`, since that's the only non-self consumer of each).

---

## Tasks

Tasks are ordered **leaf-first from the consumer side**: the umbrella `agent-home-shell.tsx` deletes first, which orphans every block. Each subsequent task verifies the orphaning via a fresh grep before `git rm`. Each task commits in its own atomic unit so a halt mid-sweep leaves a coherent intermediate state.

---

### Task 1: Capture full zero-reference snapshot

**Files:**

- None modified. Records the grep output for the audit trail.

- [ ] **Step 1: Run the full subgraph grep and save the output.**

```bash
mkdir -p /tmp/a6-zero-ref
rg "components/agent-home/|@/components/agent-home" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx' > /tmp/a6-zero-ref/agent-home-imports.txt
cat /tmp/a6-zero-ref/agent-home-imports.txt
```

Expected output (every line should start with `apps/dashboard/src/components/agent-home/`):

```
apps/dashboard/src/components/agent-home/agent-home-shell.tsx:import { AgentBlockBoundary } from "@/components/agent-home/agent-block-boundary";
apps/dashboard/src/components/agent-home/agent-home-shell.tsx:import { GreetingBlock } from "@/components/agent-home/greeting-block";
apps/dashboard/src/components/agent-home/agent-home-shell.tsx:import { NeedsYouBlock } from "@/components/agent-home/needs-you-block";
apps/dashboard/src/components/agent-home/agent-home-shell.tsx:import { WinsBlock } from "@/components/agent-home/wins-block";
apps/dashboard/src/components/agent-home/agent-home-shell.tsx:import { MetricsBlock } from "@/components/agent-home/metrics-block";
apps/dashboard/src/components/agent-home/agent-home-shell.tsx:import { PipelineBlock } from "@/components/agent-home/pipeline-block";
```

If any line starts with a path **outside** `apps/dashboard/src/components/agent-home/`, halt the slice and re-open the brief. The expected delta from the brief's 2026-05-15 snapshot is zero new external consumers.

- [ ] **Step 2: Run the hook grep.**

```bash
rg "use-agent-(wins|pipeline)" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx' > /tmp/a6-zero-ref/hooks-imports.txt
cat /tmp/a6-zero-ref/hooks-imports.txt
```

Expected: every line is either in `apps/dashboard/src/components/agent-home/` (the soon-to-be-deleted shell + its test), `apps/dashboard/src/hooks/use-agent-{wins,pipeline}.ts` (self), or `apps/dashboard/src/hooks/__tests__/use-agent-{wins,pipeline}.test.tsx` (own test). Halt on any other consumer.

- [ ] **Step 3: Confirm subgraph is closed.**

The captured outputs above are the slice's zero-reference audit trail. No commit yet — this task is verification only. The implementation plan continues to Task 2 only if both greps confirm the subgraph is self-contained.

---

### Task 2: Delete `agent-home-shell.tsx` and its test (the umbrella consumer)

This is the load-bearing delete: removing `agent-home-shell.tsx` orphans every block file in one wave, because every block's only non-self consumer is the shell. After this task, the block files are deletable in any order.

**Files:**

- Delete: `apps/dashboard/src/components/agent-home/agent-home-shell.tsx`
- Delete: `apps/dashboard/src/components/agent-home/__tests__/agent-home-shell.test.tsx`

- [ ] **Step 1: Re-verify zero external consumers immediately before `rm`.**

```bash
rg -l "AgentHomeShell|agent-home-shell" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx' \
   | grep -v "^apps/dashboard/src/components/agent-home/agent-home-shell\.tsx$" \
   | grep -v "^apps/dashboard/src/components/agent-home/__tests__/agent-home-shell\.test\.tsx$"
```

Expected: empty output.

- [ ] **Step 2: Delete both files.**

```bash
git rm apps/dashboard/src/components/agent-home/agent-home-shell.tsx
git rm apps/dashboard/src/components/agent-home/__tests__/agent-home-shell.test.tsx
```

- [ ] **Step 3: Scoped test + typecheck.**

```bash
pnpm --filter @switchboard/dashboard test -- --run agent-home
pnpm typecheck
```

Expected: the shell's own test file is gone, so the `agent-home` test pattern matches the block tests only (still passing on `main` — they survive this task). Typecheck stays green; the shell had no exports consumed elsewhere.

- [ ] **Step 4: Commit.**

```bash
git commit -m "refactor(cockpit): A.6 — delete agent-home-shell umbrella

The cockpit composition replaced this shell when /alex and /riley
became dedicated routes; the file has had no external consumer since.
Removing the shell orphans the block tree for the rest of the slice.

Zero-reference verified: no external import of AgentHomeShell or
components/agent-home/agent-home-shell across the repo."
```

---

### Task 3: Delete `agent-block-boundary.tsx` and its test

`agent-block-boundary.tsx` is a layout primitive used only by `agent-home-shell.tsx` (deleted in Task 2). After Task 2, its only consumer is gone.

**Files:**

- Delete: `apps/dashboard/src/components/agent-home/agent-block-boundary.tsx`
- Delete: `apps/dashboard/src/components/agent-home/__tests__/agent-block-boundary.test.tsx`

- [ ] **Step 1: Re-verify orphaning.**

```bash
rg -l "AgentBlockBoundary|agent-block-boundary" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx' \
   | grep -v "^apps/dashboard/src/components/agent-home/agent-block-boundary\.tsx$" \
   | grep -v "^apps/dashboard/src/components/agent-home/__tests__/agent-block-boundary\.test\.tsx$"
```

Expected: empty output (Task 2 removed the only external consumer).

- [ ] **Step 2: Delete both files.**

```bash
git rm apps/dashboard/src/components/agent-home/agent-block-boundary.tsx
git rm apps/dashboard/src/components/agent-home/__tests__/agent-block-boundary.test.tsx
```

- [ ] **Step 3: Scoped test + typecheck.**

```bash
pnpm --filter @switchboard/dashboard test -- --run agent-home
pnpm typecheck
```

Expected: green. Block test files still exist; their imports of `agent-block-boundary` are now broken, but they will be removed in Tasks 4–8. Typecheck flags the broken imports inside the still-present block tests — **this is expected and resolved by Tasks 4–8**.

> **Note on Task 3 typecheck:** If `pnpm typecheck` fails because the block-component tests import `AgentBlockBoundary` from this just-deleted file, that is the expected failure mode of a leaf-first sweep partway through. **Do not halt on this typecheck failure** — the broken imports are inside test files scheduled for deletion in Tasks 4–8. Continue. The slice's final gate at Task 13 asserts a clean typecheck after the full sweep. If you prefer a strict per-task typecheck, alternate execution order: combine Tasks 3–8 into a single delete-and-commit (still atomic, still leaf-first by construction since Task 2 already orphaned everything).

- [ ] **Step 4: Commit.**

```bash
git commit -m "refactor(cockpit): A.6 — delete agent-block-boundary

Layout primitive consumed only by agent-home-shell (deleted in
prior commit). Zero-reference verified."
```

---

### Task 4: Delete `greeting-block.tsx` and its test

**Files:**

- Delete: `apps/dashboard/src/components/agent-home/greeting-block.tsx`
- Delete: `apps/dashboard/src/components/agent-home/__tests__/greeting-block.test.tsx`

- [ ] **Step 1: Re-verify orphaning.**

```bash
rg -l "GreetingBlock|components/agent-home/greeting-block" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx' \
   | grep -v "^apps/dashboard/src/components/agent-home/greeting-block\.tsx$" \
   | grep -v "^apps/dashboard/src/components/agent-home/__tests__/greeting-block\.test\.tsx$"
```

Expected: empty output.

- [ ] **Step 2: Delete both files.**

```bash
git rm apps/dashboard/src/components/agent-home/greeting-block.tsx
git rm apps/dashboard/src/components/agent-home/__tests__/greeting-block.test.tsx
```

- [ ] **Step 3: Scoped test + typecheck.** Same expectations as Task 3 — block tests still present may have broken imports; resolved by Tasks 5–8.

```bash
pnpm --filter @switchboard/dashboard test -- --run agent-home
pnpm typecheck
```

- [ ] **Step 4: Commit.**

```bash
git commit -m "refactor(cockpit): A.6 — delete greeting-block

Only consumed by agent-home-shell (already deleted). Zero-reference
verified."
```

---

### Task 5: Delete `needs-you-block.tsx` and its test

**Files:**

- Delete: `apps/dashboard/src/components/agent-home/needs-you-block.tsx`
- Delete: `apps/dashboard/src/components/agent-home/__tests__/needs-you-block.test.tsx`

- [ ] **Step 1: Re-verify orphaning.**

```bash
rg -l "NeedsYouBlock|components/agent-home/needs-you-block" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx' \
   | grep -v "^apps/dashboard/src/components/agent-home/needs-you-block\.tsx$" \
   | grep -v "^apps/dashboard/src/components/agent-home/__tests__/needs-you-block\.test\.tsx$"
```

Expected: empty output.

- [ ] **Step 2: Delete both files.**

```bash
git rm apps/dashboard/src/components/agent-home/needs-you-block.tsx
git rm apps/dashboard/src/components/agent-home/__tests__/needs-you-block.test.tsx
```

- [ ] **Step 3: Scoped test + typecheck.** Same as Tasks 3–4.

```bash
pnpm --filter @switchboard/dashboard test -- --run agent-home
pnpm typecheck
```

- [ ] **Step 4: Commit.**

```bash
git commit -m "refactor(cockpit): A.6 — delete needs-you-block

Only consumed by agent-home-shell (already deleted). The cockpit's
approval block + decisions surface continue to consume useDecisionFeed
directly; no fallout for those. Zero-reference verified."
```

---

### Task 6: Delete `wins-block.tsx` and its test

**Files:**

- Delete: `apps/dashboard/src/components/agent-home/wins-block.tsx`
- Delete: `apps/dashboard/src/components/agent-home/__tests__/wins-block.test.tsx`

- [ ] **Step 1: Re-verify orphaning.**

```bash
rg -l "WinsBlock|components/agent-home/wins-block" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx' \
   | grep -v "^apps/dashboard/src/components/agent-home/wins-block\.tsx$" \
   | grep -v "^apps/dashboard/src/components/agent-home/__tests__/wins-block\.test\.tsx$"
```

Expected: empty output.

- [ ] **Step 2: Delete both files.**

```bash
git rm apps/dashboard/src/components/agent-home/wins-block.tsx
git rm apps/dashboard/src/components/agent-home/__tests__/wins-block.test.tsx
```

- [ ] **Step 3: Scoped test + typecheck.** Same as Tasks 3–5.

- [ ] **Step 4: Commit.**

```bash
git commit -m "refactor(cockpit): A.6 — delete wins-block

Only consumed by agent-home-shell (already deleted). Zero-reference
verified."
```

---

### Task 7: Delete `metrics-block.tsx` and its test

**Files:**

- Delete: `apps/dashboard/src/components/agent-home/metrics-block.tsx`
- Delete: `apps/dashboard/src/components/agent-home/__tests__/metrics-block.test.tsx`

- [ ] **Step 1: Re-verify orphaning.**

```bash
rg -l "\bMetricsBlock\b|components/agent-home/metrics-block" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx' \
   | grep -v "^apps/dashboard/src/components/agent-home/metrics-block\.tsx$" \
   | grep -v "^apps/dashboard/src/components/agent-home/__tests__/metrics-block\.test\.tsx$"
```

Expected: empty output. (Note the `\b` word-boundary anchors — `MetricsBlock` should not match `MetricsBlockProps` or unrelated identifiers in the cockpit; double-check by eyeballing the output before `rm`.)

- [ ] **Step 2: Delete both files.**

```bash
git rm apps/dashboard/src/components/agent-home/metrics-block.tsx
git rm apps/dashboard/src/components/agent-home/__tests__/metrics-block.test.tsx
```

- [ ] **Step 3: Scoped test + typecheck.** Same as Tasks 3–6.

- [ ] **Step 4: Commit.**

```bash
git commit -m "refactor(cockpit): A.6 — delete metrics-block

Only consumed by agent-home-shell (already deleted). The cockpit's
KPI strip + ROI bar consume legacy-shapes.ts / metrics-to-kpi-input.ts
directly and are unaffected. Zero-reference verified."
```

---

### Task 8: Delete `pipeline-block.tsx` and its test

**Files:**

- Delete: `apps/dashboard/src/components/agent-home/pipeline-block.tsx`
- Delete: `apps/dashboard/src/components/agent-home/__tests__/pipeline-block.test.tsx`

- [ ] **Step 1: Re-verify orphaning.**

```bash
rg -l "PipelineBlock|components/agent-home/pipeline-block" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx' \
   | grep -v "^apps/dashboard/src/components/agent-home/pipeline-block\.tsx$" \
   | grep -v "^apps/dashboard/src/components/agent-home/__tests__/pipeline-block\.test\.tsx$"
```

Expected: empty output.

- [ ] **Step 2: Delete both files.**

```bash
git rm apps/dashboard/src/components/agent-home/pipeline-block.tsx
git rm apps/dashboard/src/components/agent-home/__tests__/pipeline-block.test.tsx
```

- [ ] **Step 3: Scoped test + typecheck.** Block-test failures from earlier tasks should now resolve — all 5 block tests are deleted; the remaining files in `components/agent-home/` are the internal helpers (`prose-segments`, `sparkline`, `fixture-folio-badge`, `portrait/*`) which Tasks 9–10 sweep.

```bash
pnpm --filter @switchboard/dashboard test -- --run agent-home
pnpm typecheck
```

Expected: typecheck green again (no broken block-test imports remaining); test run reports only the internal-helper tests (`prose-segments`, `sparkline`, `fixture-folio-badge`) plus any cockpit tests that happen to match the pattern. All passing.

- [ ] **Step 4: Commit.**

```bash
git commit -m "refactor(cockpit): A.6 — delete pipeline-block

Only consumed by agent-home-shell (already deleted). The cockpit's
pipeline surface is decision-feed-driven, not view-model-driven.
Zero-reference verified."
```

---

### Task 9: Delete internal helpers (`prose-segments`, `sparkline`, `fixture-folio-badge`) and their tests

These three files were used only by the deleted block files. After Task 8, they are fully orphaned.

**Files:**

- Delete: `apps/dashboard/src/components/agent-home/prose-segments.tsx`
- Delete: `apps/dashboard/src/components/agent-home/__tests__/prose-segments.test.tsx`
- Delete: `apps/dashboard/src/components/agent-home/sparkline.tsx`
- Delete: `apps/dashboard/src/components/agent-home/__tests__/sparkline.test.tsx`
- Delete: `apps/dashboard/src/components/agent-home/fixture-folio-badge.tsx`
- Delete: `apps/dashboard/src/components/agent-home/__tests__/fixture-folio-badge.test.tsx`

- [ ] **Step 1: Re-verify orphaning for all three.**

```bash
for name in prose-segments sparkline fixture-folio-badge; do
  pascal=$(echo "$name" | awk -F- '{for(i=1;i<=NF;i++) printf "%s%s", toupper(substr($i,1,1)), substr($i,2); print ""}')
  echo "=== checking $name ($pascal) ==="
  rg -l "${pascal}|components/agent-home/${name}" \
     apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
     -g '*.ts' -g '*.tsx' \
     | grep -v "^apps/dashboard/src/components/agent-home/${name}\.tsx$" \
     | grep -v "^apps/dashboard/src/components/agent-home/__tests__/${name}\.test\.tsx$"
done
```

Expected: empty output under each `===` header.

- [ ] **Step 2: Delete all six files.**

```bash
git rm apps/dashboard/src/components/agent-home/prose-segments.tsx
git rm apps/dashboard/src/components/agent-home/__tests__/prose-segments.test.tsx
git rm apps/dashboard/src/components/agent-home/sparkline.tsx
git rm apps/dashboard/src/components/agent-home/__tests__/sparkline.test.tsx
git rm apps/dashboard/src/components/agent-home/fixture-folio-badge.tsx
git rm apps/dashboard/src/components/agent-home/__tests__/fixture-folio-badge.test.tsx
```

- [ ] **Step 3: Scoped test + typecheck.**

```bash
pnpm --filter @switchboard/dashboard test -- --run agent-home
pnpm typecheck
```

Expected: green. After this task, the only remaining files inside `apps/dashboard/src/components/agent-home/` are `portrait/alex.tsx` + `portrait/riley.tsx` (deleted in Task 10).

- [ ] **Step 4: Commit.**

```bash
git commit -m "refactor(cockpit): A.6 — delete prose-segments / sparkline / fixture-folio-badge

Internal helpers consumed only by the now-deleted block files.
Zero-reference verified for all three."
```

---

### Task 10: Delete portrait sprites + clean up empty directories

**Files:**

- Delete: `apps/dashboard/src/components/agent-home/portrait/alex.tsx`
- Delete: `apps/dashboard/src/components/agent-home/portrait/riley.tsx`

- [ ] **Step 1: Re-verify orphaning.**

```bash
rg -l "PortraitAlex|PortraitRiley|portrait/alex|portrait/riley|agent-home/portrait" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx' \
   | grep -v "^apps/dashboard/src/components/agent-home/portrait/"
```

Expected: empty output (the portrait files had only one consumer, `greeting-block.tsx`, already deleted in Task 4).

- [ ] **Step 2: Delete both portrait files.**

```bash
git rm apps/dashboard/src/components/agent-home/portrait/alex.tsx
git rm apps/dashboard/src/components/agent-home/portrait/riley.tsx
```

- [ ] **Step 3: Confirm empty directories disappear.**

```bash
ls apps/dashboard/src/components/agent-home/portrait/ 2>&1 || echo "(directory gone — expected)"
ls apps/dashboard/src/components/agent-home/__tests__/ 2>&1 || echo "(directory gone — expected)"
ls apps/dashboard/src/components/agent-home/ 2>&1 || echo "(directory gone — expected)"
```

Expected: all three "directory gone" messages. Git does not track empty directories, so they disappear from the working tree once the last file in each is removed. If a directory persists, it has a residual file — investigate before continuing.

- [ ] **Step 4: Scoped test + typecheck.**

```bash
pnpm --filter @switchboard/dashboard test -- --run agent-home
pnpm typecheck
```

Expected: green. The `--run agent-home` pattern matches nothing now (no files), which Vitest reports as "no test files found." That is the correct outcome.

- [ ] **Step 5: Commit.**

```bash
git commit -m "refactor(cockpit): A.6 — delete portrait sprites + empty directories

PortraitAlex + PortraitRiley were consumed only by greeting-block
(already deleted). apps/dashboard/src/components/agent-home/ is now
empty and disappears from the working tree.

Zero-reference verified."
```

---

### Task 11: Delete `use-agent-wins.ts` + `use-agent-pipeline.ts` + their tests

After Task 2 deleted `agent-home-shell.tsx`, both of these hooks are fully orphaned.

**Files:**

- Delete: `apps/dashboard/src/hooks/use-agent-wins.ts`
- Delete: `apps/dashboard/src/hooks/__tests__/use-agent-wins.test.tsx`
- Delete: `apps/dashboard/src/hooks/use-agent-pipeline.ts`
- Delete: `apps/dashboard/src/hooks/__tests__/use-agent-pipeline.test.tsx`

- [ ] **Step 1: Re-verify orphaning.**

```bash
for hook in use-agent-wins use-agent-pipeline; do
  pascal=$(echo "$hook" | awk -F- '{for(i=1;i<=NF;i++) printf "%s%s", toupper(substr($i,1,1)), substr($i,2); print ""}')
  echo "=== checking $hook ($pascal) ==="
  rg -l "${pascal}|hooks/${hook}\b" \
     apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
     -g '*.ts' -g '*.tsx' \
     | grep -v "^apps/dashboard/src/hooks/${hook}\.ts$" \
     | grep -v "^apps/dashboard/src/hooks/__tests__/${hook}\.test\.tsx$"
done
```

Expected: empty output under both headers.

- [ ] **Step 2: Delete all four files.**

```bash
git rm apps/dashboard/src/hooks/use-agent-wins.ts
git rm apps/dashboard/src/hooks/__tests__/use-agent-wins.test.tsx
git rm apps/dashboard/src/hooks/use-agent-pipeline.ts
git rm apps/dashboard/src/hooks/__tests__/use-agent-pipeline.test.tsx
```

- [ ] **Step 3: Scoped test + typecheck.**

```bash
pnpm --filter @switchboard/dashboard test -- --run use-agent
pnpm typecheck
```

Expected: green. The remaining `use-agent-*` hooks (`use-agent-greeting`, `use-agent-metrics`, `use-agent-activity`, `use-agent-roster`, `use-agent-state`, `use-agent-mission`) are unaffected — they all live in `apps/dashboard/src/hooks/` and have active cockpit consumers.

- [ ] **Step 4: Commit.**

```bash
git commit -m "refactor(cockpit): A.6 — delete orphaned use-agent-wins + use-agent-pipeline hooks

Both hooks' only consumer was agent-home-shell (deleted earlier in
this slice). The cockpit's KPI strip and pipeline surface consume
use-agent-metrics / decision-feed / cockpit-side adapters directly;
neither of these hooks fed any cockpit component.

Backend API routes /api/dashboard/agents/[agentId]/wins + /pipeline
remain wired and serve no caller after this PR. Their deletion is
a separate post-A.6 follow-up under the same zero-reference discipline."
```

---

### Task 12: Delete `activity-kind-map.ts` + its test

`activity-kind-map.ts` exports `translatedActionToActivityRow`, consumed only by its own colocated test (verified 2026-05-15). The active activity-stream path uses `useAgentActivityCockpit` (from `use-agent-activity-cockpit.ts`, a different hook) → `/api/dashboard/agents/[agentId]/activity` → server-returned `ActivityRow[]`. `activity-kind-map.ts` is a vestige of an earlier client-side translation step now done server-side.

Important boundary: `activity-kind-map.ts` imports `TranslatedAction` from `@/hooks/use-agent-activity` as a type-only import. Deleting `activity-kind-map.ts` does NOT orphan `use-agent-activity.ts` — that hook stays in place because Riley-side hooks and translator still consume it.

**Files:**

- Delete: `apps/dashboard/src/lib/cockpit/activity-kind-map.ts`
- Delete: `apps/dashboard/src/lib/cockpit/__tests__/activity-kind-map.test.ts`

- [ ] **Step 1: Re-verify orphaning.**

```bash
rg -l "translatedActionToActivityRow|lib/cockpit/activity-kind-map" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx' \
   | grep -v "^apps/dashboard/src/lib/cockpit/activity-kind-map\.ts$" \
   | grep -v "^apps/dashboard/src/lib/cockpit/__tests__/activity-kind-map\.test\.ts$"
```

Expected: empty output. If a consumer has appeared since 2026-05-15, halt — re-open the brief; do not silently expand the slice.

- [ ] **Step 2: Confirm `use-agent-activity.ts` remains consumed (sanity check the boundary).**

```bash
rg -l "use-agent-activity\b|useAgentActivity\b" \
   apps/dashboard/src/ \
   -g '*.ts' -g '*.tsx' \
   | grep -v "^apps/dashboard/src/lib/cockpit/activity-kind-map\.ts$" \
   | grep -v "^apps/dashboard/src/lib/cockpit/__tests__/activity-kind-map\.test\.ts$" \
   | grep -v "^apps/dashboard/src/hooks/use-agent-activity\.ts$"
```

Expected: at minimum, references in `apps/dashboard/src/hooks/use-riley-activity.ts`, `apps/dashboard/src/hooks/use-riley-status.ts`, `apps/dashboard/src/lib/cockpit/riley/riley-activity-translator.ts`, `apps/dashboard/src/lib/cockpit/riley/__fixtures__/riley-activity-fixtures.ts`. If this list is empty, the boundary has shifted — halt and re-verify the brief.

- [ ] **Step 3: Delete both files.**

```bash
git rm apps/dashboard/src/lib/cockpit/activity-kind-map.ts
git rm apps/dashboard/src/lib/cockpit/__tests__/activity-kind-map.test.ts
```

- [ ] **Step 4: Scoped test + typecheck.**

```bash
pnpm --filter @switchboard/dashboard test -- --run activity-kind-map
pnpm typecheck
```

Expected: green. The `--run activity-kind-map` pattern matches nothing (Vitest reports "no test files found" — correct outcome). Typecheck remains green; `use-agent-activity.ts` and Riley consumers are unaffected.

- [ ] **Step 5: Commit.**

```bash
git commit -m "refactor(cockpit): A.6 — delete orphaned activity-kind-map translator

translatedActionToActivityRow was an earlier client-side translation
step that the dashboard proxy now performs server-side. The active
activity stream path is useAgentActivityCockpit -> /api/dashboard/
agents/[agentId]/activity -> server-returned ActivityRow[].

Zero-reference verified: only the file's own test referenced its
export. use-agent-activity.ts stays — Riley-side hooks and translator
still consume its TranslatedAction type."
```

---

### Task 13: Pre-merge gates

This task is the slice's final gate. It runs the full discipline from `[[ship-clean-not-followup]]` + `[[dashboard-build-not-in-ci]]` + `[[ci-prettier-not-in-local-lint]]` + the boundary locks at the top of this plan. Any failure halts the slice and re-opens the brief.

- [ ] **Step 1: Zero-reference end-state grep.**

The full `agent-home/` subgraph plus the two deleted hooks plus `activity-kind-map.ts` should have zero references anywhere in the repo:

```bash
rg "AgentHomeShell|AgentBlockBoundary|GreetingBlock|NeedsYouBlock|WinsBlock|MetricsBlock|PipelineBlock|ProseSegments|Sparkline|FixtureFolioBadge|PortraitAlex|PortraitRiley" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx'

rg "components/agent-home|agent-home/portrait" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx'

rg "use-agent-wins|use-agent-pipeline|useAgentWins|useAgentPipeline" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx'

rg "translatedActionToActivityRow|lib/cockpit/activity-kind-map" \
   apps/dashboard/src/ packages/ apps/api apps/chat apps/mcp-server \
   -g '*.ts' -g '*.tsx'
```

Expected: all four return empty output. If any returns a match, halt — a consumer survived that should have been swept (or never existed; revisit the brief's investigation).

- [ ] **Step 2: Adapter-boundary grep gate.**

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: a **subset** of `main`'s match set. Compare against a fresh checkout of `origin/main`:

```bash
git fetch origin
git diff origin/main -- apps/dashboard/src/components/cockpit apps/dashboard/src/hooks | grep "^[+-].*\(Recommendation\|AuditEntry\|@switchboard/db\|@prisma\)" || echo "(no audit-domain import delta)"
```

Expected: either no diff lines containing audit-domain identifiers, or only `-` (removed) lines. **Zero `+` (added) lines.** A.6 must never _add_ an audit-domain import.

- [ ] **Step 3: Surface-agnostic backend grep gate.**

```bash
git diff origin/main..HEAD -- packages/ apps/api apps/chat apps/mcp-server
```

Expected: empty output. A.6 is dashboard-only.

- [ ] **Step 4: Diff-filter assertion — no additions, no modifications outside the subgraph.**

```bash
git diff origin/main..HEAD --diff-filter=A
git diff origin/main..HEAD --diff-filter=M
```

Expected:

- `--diff-filter=A` (added): empty. A.6 ships no new files. The two docs files at `docs/superpowers/plans/2026-05-16-alex-cockpit-a6-*.md` are on the **docs branch** (`docs/alex-cockpit-a6-plan`), not on the implementation branch — they merge to `main` separately as the planning PR.
- `--diff-filter=M` (modified): empty. A.6 modifies no files. Every change is a deletion.

If either is non-empty, halt — the slice has expanded beyond pure deletion.

- [ ] **Step 5: Full test sweep.**

```bash
pnpm reset
pnpm typecheck
pnpm lint
pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/dashboard build
```

Expected: all green. Per `CLAUDE.md`: `pnpm reset` clears stale `dist/` before typecheck — load-bearing because the deleted hooks may have shipped types in turbo's cache. Per `[[dashboard-build-not-in-ci]]`: dashboard build is not in CI; it is the only gate that catches `.js`-extension regressions in Next.js imports.

If a pre-existing flake reproduces from the baseline (per `[[db-integrity-tests-pg-advisory-lock]]`), record it but do not block on it. If a new failure surfaces in a previously-green test (e.g., a fixture imported from a deleted file), halt and investigate — the cascade has caught something the grep missed.

- [ ] **Step 6: Coverage threshold gate.**

```bash
pnpm --filter @switchboard/dashboard test -- --coverage 2>&1 | tail -30
```

Expected: each of statements / branches / functions / lines stays at or above the `CLAUDE.md` thresholds (55 / 50 / 52 / 55). If any threshold dips, halt. Per slice brief §Risks §2 and boundary lock #7: no "lower the floor."

Compare against the baseline captured in §Precondition checks §Step 0h. A delta within ±1pp is normal noise; a larger swing in either direction is worth a sanity check (a sharp _increase_ often means a swath of low-coverage tests was deleted, which is fine; a sharp _decrease_ means a uncovered file is now a higher share of remaining code, which can dip a threshold).

- [ ] **Step 7: Prettier format check.**

```bash
pnpm format:check
```

Expected: clean. A.6 is pure deletion, so format drift is improbable — but per `[[ci-prettier-not-in-local-lint]]`: CI's lint job catches prettier drift that local `pnpm lint` misses. Run before pushing.

- [ ] **Step 8: Manual verification on the dev stack.**

```bash
pnpm dev
# Open http://localhost:3002/alex and http://localhost:3002/riley
```

- Load `/alex`. Confirm:
  - The cockpit renders identity + mission popover + KPI strip + ROI bar + approval block + activity stream + composer + ⌘K palette as it did pre-A.6.
  - No console errors about missing components or 404 imports.
  - The status pill toggles `HALTED` when the halt button is clicked, and the composer disables — the `HaltProvider` still mounts in `EditorialAuthShell` (boundary lock #3 honored).

- Load `/riley`. Confirm:
  - `<RileyCockpitPage>` renders KPI strip + ROI bar + mission popover + identity + composer placeholder + topbar disabled palette button (pre-B.3-followup state).
  - Halt-state toggle still works.

- Load `/team`, `/settings`, `/activity`, `/approvals`, `/contacts`, `/automations`, `/reports`. Confirm:
  - Each surface renders normally. No regression from removing the agent-home tree (none should consume from `agent-home/` per the brief's verification).
  - Halt-state still propagates through `EditorialAuthShell`'s `HaltProvider`.

If anything diverges, halt and investigate before declaring A.6 done.

- [ ] **Step 9: PR description checklist (paste into the implementation PR body).**

```markdown
## A.6 — Retirement + Cleanup

### Layers shipped

- **Dashboard component tree** — deleted `apps/dashboard/src/components/agent-home/` (umbrella shell + 5 blocks + 3 helpers + 2 portrait sprites + all colocated tests).
- **Dashboard hooks** — deleted `use-agent-wins.ts` + `use-agent-pipeline.ts` (orphaned after the shell deletion).
- **Cockpit library** — deleted `apps/dashboard/src/lib/cockpit/activity-kind-map.ts` (orphaned translator; only its own test consumed it).
- **Total** — 28 file deletions in the implementation PR (plus 2 empty directories that disappear naturally). 0 file modifications. 0 new files.

### Decision locks

- No `HaltProvider` re-root — provider stays in `EditorialAuthShell`; the architecture diverged from the spec's assumption.
- No deletion of `legacy-shapes.ts` (cockpit KPI dep) or `use-agent-activity.ts` (Riley-side dep) — the A.5 brief's sketch was partially wrong.
- `activity-kind-map.ts` IS deleted — the third file in the A.5 sketch is genuinely orphaned (only its own test consumes it; the active activity-stream path uses `useAgentActivityCockpit` with server-side row mapping).
- No backend touch — orphaned API routes for `/wins` + `/pipeline` survive A.6; separate post-A.6 follow-up sweeps them.
- No `/team` precursor PR — `/team` consumes nothing from `agent-home/` (verified).
- No new surface, no test rewrites, no coverage-threshold lowering.

### Test contract

- [ ] Zero-reference end-state grep clean (Step 1)
- [ ] Adapter-boundary grep gate: zero `+` audit-domain import lines (Step 2)
- [ ] Surface-agnostic backend grep gate: empty packages/ diff (Step 3)
- [ ] Diff-filter assertion: zero adds, zero modifications (Step 4)
- [ ] `pnpm reset && pnpm typecheck && pnpm lint` clean (Step 5)
- [ ] `pnpm --filter @switchboard/dashboard test` clean (Step 5)
- [ ] `pnpm --filter @switchboard/dashboard build` clean (Step 5)
- [ ] Coverage thresholds ≥ 55/50/52/55 (Step 6)
- [ ] `pnpm format:check` clean (Step 7)
- [ ] Manual verification of /alex, /riley, /team, /settings, /activity, /approvals, /contacts, /automations, /reports (Step 8)

### What does NOT ship here

(Mirror the slice brief's §"What does NOT ship at A.6" list. Reviewers can grep for "❌" to confirm.)

### Downstream

- Backend route cleanup follow-up: deletes `/api/dashboard/agents/[agentId]/wins` + `/pipeline` proxy routes, the Fastify endpoints in `apps/api/src/bootstrap/routes.ts`, and the `packages/core/src/agent-home/{wins,pipeline}.ts` implementations + tests. Separate PR with its own discipline.
- Riley B.3-followup: independent; unblocked by A.5; not coupled to A.6.

### Closes

Alex Cockpit Phase A (6/6). The umbrella spec at `docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md` is fully implemented.
```

---

## Risk Watchlist

These are the slice brief's risks, with the implementation-side mitigations called out at the relevant tasks:

| #   | Risk                                                                   | Mitigation                                                                                                                            | Task        |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Hidden caller has landed since 2026-05-15                              | Per-file zero-reference grep before every `rm`; full-subgraph grep at Step 0f as a precondition                                       | 0f, 1, 2–10 |
| 2   | Coverage dips below thresholds after deletion                          | Coverage gate compares against baseline (Step 0h); slice halts on dip; no "lower the floor"                                           | 0h, 13.6    |
| 3   | Test fixture imports from a deleted file                               | Scoped test run after each deletion; broken-import surfaces fast                                                                      | 2–10        |
| 4   | HaltProvider re-root edge case re-emerges                              | Boundary lock #3; no edit to `halt-context.tsx` or `editorial-auth-shell.tsx`                                                         | All         |
| 5   | Backend API routes orphaned but not deleted                            | Documented in PR description; separate follow-up PR sweeps them                                                                       | 13.9        |
| 6   | `lib/agent-home/types.ts` orphan exports                               | Documented in brief; out of scope for A.6; future opportunistic trim                                                                  | (none)      |
| 7   | Pre-existing test flakes (`prisma-work-trace-store-integrity` etc.)    | Baseline capture at Step 0g identifies them; do not block on them per `[[db-integrity-tests-pg-advisory-lock]]`                       | 0g, 13.5    |
| 8   | Auto-merge captures stale HEAD                                         | Manual `gh pr merge --squash` after CI is green; do not use `--auto`                                                                  | 11          |
| 9   | Empty directories confuse readers                                      | Step 10.3 confirms directories disappear naturally                                                                                    | 10          |
| 10  | Subagent dispatch drifts cwd                                           | Branch verification (`git branch --show-current`) before each commit                                                                  | 2–11        |
| 11  | Mid-sweep typecheck failure in Task 3–7 from broken block-test imports | Expected; continue per Task 3's "Note on Task 3 typecheck" callout; final gate at Task 13.5 confirms clean typecheck after full sweep | 3–7         |

---

## Out-of-band guardrails

Carry-over from prior cockpit slices and `CLAUDE.md` memories:

- **Worktree discipline (`CLAUDE.md` §Branch & Worktree Doctrine):** This slice runs on its own implementation branch (`feat/alex-cockpit-a6`); `docs/alex-cockpit-a6-plan` is a separate docs branch that holds the slice brief + this plan and merges to `main` before the implementation branch begins. Do not stack the two.
- **Branch context verification (`CLAUDE.md` §Branch & Worktree Doctrine):** Run `git branch --show-current` before every commit. Subagent dispatches may drift cwd per `[[subagent-worktree-drift]]`.
- **Test alignment (`feedback_api_test_mocked_prisma.md`):** Not relevant — A.6 ships no API or DB tests.
- **Migrate discipline (`feedback_prisma_migrate_dev_tty.md`):** Not relevant — A.6 ships no migration.
- **Module size (`CLAUDE.md`):** Not relevant — A.6 is pure deletion. Every file the slice touches becomes 0 lines (deleted).
- **Reset before typecheck (`CLAUDE.md`):** `pnpm reset` runs at Step 0g and Step 13.5. Load-bearing because turbo's `dist/` cache may still hold artifacts for the deleted hooks; a stale `dist/` can mask a real failure or surface a false one.
- **Dashboard imports omit `.js` (`feedback_dashboard_no_js_on_any_import.md`):** Not directly relevant — A.6 is deletion-only. The dashboard build at Step 13.5 catches any latent regression.
- **Dashboard build is not in CI (`[[dashboard-build-not-in-ci]]`):** `pnpm --filter @switchboard/dashboard build` is the only way to catch a `.js`-extension regression — run it locally before opening the PR.
- **Prettier (`[[ci-prettier-not-in-local-lint]]`):** Run `pnpm format:check` at Step 13.7 before pushing.
- **Modes not knobs (`[[modes-not-knobs]]`):** Not relevant — A.6 ships no new behavior.
- **Adapter-boundary invariant:** Step 13.2 asserts zero new audit-domain imports under `components/cockpit/**` or `hooks/`.
- **Surface-agnostic backend invariant:** Step 13.3 asserts empty diff under `packages/**`, `apps/api/**`, `apps/chat/**`, `apps/mcp-server/**`.
- **Ship clean, don't defer (`[[ship-clean-not-followup]]`):** If the sweep can't go clean (hidden consumer, coverage dip, fixture break), halt — do not merge with a "fix in follow-up" TODO. The one exception (backend API route cleanup) is structurally out of A.6's scope per user instruction and is documented up-front, not deferred mid-PR.
- **Verify against codebase, not mental model (`[[verify-against-codebase]]`):** Step 0f re-runs the brief's zero-reference investigation against current `main`; the brief's snapshot is from 2026-05-15 and may have drifted.
- **Auto-merge caveat (`[[auto-merge-captures-head-early]]`):** Manual `gh pr merge --squash` after CI is green; do not use `--auto`.

---

## Estimated effort

13 implementation tasks (14 including the precondition checks "task" §Precondition checks). Estimated 1–2 hours for a focused executor using `superpowers:subagent-driven-development`. Risk concentration is at Task 2 (orphaning the agent-home tree in one wave; the rest cascade) and Task 13 (full-suite pre-merge sweep, including coverage). Subsequent tasks are mechanical `git rm` pairs with a guarded grep — fast.
