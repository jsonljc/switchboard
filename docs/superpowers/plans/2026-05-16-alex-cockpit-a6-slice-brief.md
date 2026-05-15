# Alex Cockpit A.6 — Retirement + Cleanup (Slice Brief)

**Date:** 2026-05-16
**Parent spec:** [Alex Cockpit Home — Design Spec](../specs/2026-05-14-alex-cockpit-home-design.md) (§Implementation slices §A.6, §Candidate deletion list for A.6 cleanup, §Scope §"Retirement of the existing block components")
**Predecessor slices:**
- A.1 — `feat(cockpit): A.1 shell + basic Alex composition` (shipped)
- A.2 — `feat(cockpit): A.2 mission popover + Day-1 narrator + setup checklist` (#485, squash `67eb0618`)
- A.3 — `feat(cockpit): A.3 — KPI strip + ROI bar on /alex` (#500, squash `ed54c4a8`)
- A.4 — `feat(cockpit): A.4 — activity richness + thread previews` (#529, squash `c3ee595d`)
- A.5 — `feat(cockpit): A.5 — composer + command palette on /alex` (#542, squash `5a4fe7dc`)

---

## Why A.6 lands now

A.5 closed Phase A's last feature slice. The Alex cockpit now ships identity + mission popover + KPI strip + ROI bar + approval block + activity stream + composer + ⌘K command palette — every input and output affordance the locked design calls for. The Riley cockpit reached the same finish line earlier on 2026-05-15 (B.2a #497/#494/#493, B.2b #522, Wave B PR-1 #538, production emitter #541). Both agents render via dedicated route handlers — `/alex` → `<CockpitPage>` and `/riley` → `<RileyCockpitPage>` — each wrapped in `EditorialAuthShell`.

What remains on disk is `apps/dashboard/src/components/agent-home/` — the pre-cockpit block tree (`greeting-block.tsx`, `needs-you-block.tsx`, `wins-block.tsx`, `metrics-block.tsx`, `pipeline-block.tsx`, `agent-block-boundary.tsx`, plus the internal helpers `prose-segments.tsx` / `sparkline.tsx` / `fixture-folio-badge.tsx` / `portrait/{alex,riley}.tsx`) and its umbrella consumer `agent-home-shell.tsx`. None of these files have an external consumer anymore (zero-reference verification below); they exist only because they were never deleted when the cockpit superseded them.

The umbrella spec calls this out explicitly:

> **A.6 — Retirement + cleanup**
> **Ships** (only after Alex cockpit has been stable in production through A.5): delete the legacy block components and any orphaned hooks after zero-reference verification.
> **Gate:** every deletion is preceded by a grep across the repo proving zero references. No "delete and hope" sweeps.
> — `docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md:83-93`

A.6 is the **retirement slice**. It ships no new surface, no new behavior, no new dependency. It only removes dead code and the colocated tests for that code. After A.6 lands, Alex Cockpit Phase A is fully closed and the umbrella spec is fully implemented.

### Downstream consumers

- **Riley Wave B and downstream Riley work** — Independent of A.6. Riley B.3-followup (the only other unblocked cockpit slice, awaiting palette adoption on `/riley`) reads from `<CommandPalette>` + `<Composer>` shipped at A.5, not from anything A.6 touches.
- **Wave 1.5 / Wave 2 surface conventions** — Independent. A.6 deletes nothing inside `apps/dashboard/src/components/cockpit/**` and nothing inside `packages/**`.
- **Backend API routes for `/wins` and `/pipeline`** — Out of scope. The frontend hooks `use-agent-wins` and `use-agent-pipeline` become orphaned by A.6, but the API endpoints they call (and the `packages/core/src/agent-home/{wins,pipeline}.ts` implementations) remain on the wire untouched. Backend cleanup is a separate post-A.6 follow-up; see §Risks.

### Out-of-band: what A.6 does NOT redo

- **No `[agentKey]` collapse.** PR #468 (`d8b17625`, 2026-05-08) already split `apps/dashboard/src/app/(auth)/[agentKey]/` into dedicated `/alex` and `/riley` routes. The spec's "remove the per-agent branch" item is **already done**; A.6 inherits a tree with no `[agentKey]` directory. Likewise the spec's `agent-home-client.tsx` + `legacy-agent-home-client.tsx` deletion items are **already done** — those files no longer exist on `main`.
- **No `HaltProvider` re-root.** The spec assumed A.6 would replace `EditorialAuthShell` for the per-agent routes and re-root `HaltProvider` inside `CockpitPage`. The architecture diverged: `apps/dashboard/src/app/(auth)/alex/page.tsx` and `riley/page.tsx` both continue to wrap their cockpit in `<EditorialAuthShell>`, and `HaltProvider` continues to mount inside the shell at `apps/dashboard/src/components/layout/editorial-auth-shell.tsx:33`. Both `<CockpitPage>` and `<RileyCockpitPage>` consume the existing provider via `useHalt()` — they always have. The legacy shell is **not going away**. Re-rooting `HaltProvider` into `CockpitPage` is therefore unnecessary; doing it now would force every other surface wrapped by `EditorialAuthShell` (`/team`, `/settings`, `/activity`, `/approvals`, `/contacts`, `/automations`, `/reports`, `/mira` tab) to either get its own provider or lose halt-state access, which is far broader than A.6's mandate. Resolve in favor of the narrowest cleanup: **HaltProvider stays where it is**. See §Spec-conflict resolution.

---

## Slice goal

Delete the orphaned legacy agent-home block tree and its colocated tests after zero-reference verification, plus the two `use-agent-*` hooks whose only remaining consumer is that tree.

One sentence: **A.6 is a leaf-first deletion sweep — no behavior change, no new file, no rewritten test.**

---

## What ships

A.6 ships **no new files**. Every change is a deletion. The slice modifies one or two existing files only when a `__tests__` index or barrel needs an export removed (verified at write-time; no such re-exports exist today, so the realistic count is "modifies zero files").

### Files deleted

| Path | Reason | Zero-reference status (2026-05-15) |
|---|---|---|
| `apps/dashboard/src/components/agent-home/agent-home-shell.tsx` | Umbrella consumer of every block; not imported by any route, layout, or other component. The only references are its own colocated test (deleted in the same task) and self-reference. | ✅ Verified: `rg "AgentHomeShell\|agent-home-shell"` returns only the file itself and its `__tests__/agent-home-shell.test.tsx`. |
| `apps/dashboard/src/components/agent-home/__tests__/agent-home-shell.test.tsx` | Colocated test for the deleted shell. | ✅ Verified: no other module references it. |
| `apps/dashboard/src/components/agent-home/agent-block-boundary.tsx` | Block-tree boundary primitive; only used by `agent-home-shell.tsx` and tests. | ✅ Verified: deleted-shell test is its only non-self reference. |
| `apps/dashboard/src/components/agent-home/__tests__/agent-block-boundary.test.tsx` | Colocated test. | ✅ Verified. |
| `apps/dashboard/src/components/agent-home/greeting-block.tsx` | Only consumed by `agent-home-shell.tsx`. | ✅ Verified. |
| `apps/dashboard/src/components/agent-home/__tests__/greeting-block.test.tsx` | Colocated test. | ✅ Verified. |
| `apps/dashboard/src/components/agent-home/needs-you-block.tsx` | Only consumed by `agent-home-shell.tsx`. | ✅ Verified. |
| `apps/dashboard/src/components/agent-home/__tests__/needs-you-block.test.tsx` | Colocated test. | ✅ Verified. |
| `apps/dashboard/src/components/agent-home/wins-block.tsx` | Only consumed by `agent-home-shell.tsx`. | ✅ Verified. |
| `apps/dashboard/src/components/agent-home/__tests__/wins-block.test.tsx` | Colocated test. | ✅ Verified. |
| `apps/dashboard/src/components/agent-home/metrics-block.tsx` | Only consumed by `agent-home-shell.tsx`. | ✅ Verified. |
| `apps/dashboard/src/components/agent-home/__tests__/metrics-block.test.tsx` | Colocated test. | ✅ Verified. |
| `apps/dashboard/src/components/agent-home/pipeline-block.tsx` | Only consumed by `agent-home-shell.tsx`. | ✅ Verified. |
| `apps/dashboard/src/components/agent-home/__tests__/pipeline-block.test.tsx` | Colocated test. | ✅ Verified. |
| `apps/dashboard/src/components/agent-home/prose-segments.tsx` | Only consumed by the deleted block files (`greeting-block.tsx`, `metrics-block.tsx`, `wins-block.tsx`). | ✅ Verified: no external consumer. |
| `apps/dashboard/src/components/agent-home/__tests__/prose-segments.test.tsx` | Colocated test. | ✅ Verified. |
| `apps/dashboard/src/components/agent-home/sparkline.tsx` | Only consumed by `metrics-block.tsx`. | ✅ Verified: no external consumer. |
| `apps/dashboard/src/components/agent-home/__tests__/sparkline.test.tsx` | Colocated test. | ✅ Verified. |
| `apps/dashboard/src/components/agent-home/fixture-folio-badge.tsx` | Only consumed by the deleted block files. | ✅ Verified: no external consumer. |
| `apps/dashboard/src/components/agent-home/__tests__/fixture-folio-badge.test.tsx` | Colocated test. | ✅ Verified. |
| `apps/dashboard/src/components/agent-home/portrait/alex.tsx` | Only consumed by `greeting-block.tsx`. | ✅ Verified: no external consumer. |
| `apps/dashboard/src/components/agent-home/portrait/riley.tsx` | Only consumed by `greeting-block.tsx`. | ✅ Verified: no external consumer. |
| `apps/dashboard/src/components/agent-home/portrait/` (the directory itself) | Empty after the two portrait files are removed. | Mechanical follow-on. |
| `apps/dashboard/src/components/agent-home/` (the directory itself) | Empty after the sweep. | Mechanical follow-on. |
| `apps/dashboard/src/hooks/use-agent-wins.ts` | Only consumer is `agent-home-shell.tsx` (deleted above) + colocated test. | ✅ Verified: no other consumer. |
| `apps/dashboard/src/hooks/__tests__/use-agent-wins.test.tsx` | Colocated test. | ✅ Verified. |
| `apps/dashboard/src/hooks/use-agent-pipeline.ts` | Only consumer is `agent-home-shell.tsx` (deleted above) + colocated test. | ✅ Verified: no other consumer. |
| `apps/dashboard/src/hooks/__tests__/use-agent-pipeline.test.tsx` | Colocated test. | ✅ Verified. |

**Total: 28 file deletions + 2 empty-directory removals. No file modifications.**

### Files modified

None. The deletion candidates form a self-contained subgraph; nothing outside the subgraph imports them.

If the zero-reference grep at task execution time reveals a new consumer that has landed since 2026-05-15 (e.g., a freshly-merged PR consuming `use-agent-wins`), the implementation plan halts and the new consumer is refactored or the file is removed from the sweep — **the brief does not greenlight modifying anything outside the agent-home subgraph in A.6**. Such a discovery is a sign that A.6 needs to be re-scoped, not silently expanded.

### Files explicitly NOT touched

- **A.1–A.5 cockpit artifacts** — all files under `apps/dashboard/src/components/cockpit/**`, `apps/dashboard/src/lib/cockpit/**`, and the cockpit-side hooks (`use-cockpit-status.ts`, `use-agent-mission.ts`, `use-agent-greeting.ts`, `use-agent-metrics.ts`, `use-agent-activity.ts`). These are the active cockpit — A.6 does not touch them.
- **Riley cockpit + Riley adapters** — `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`, `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`, `apps/dashboard/src/lib/cockpit/riley/**`, `apps/dashboard/src/hooks/use-riley-*`. Independent surface.
- **Cockpit-side helpers that the A.5 brief speculatively listed for A.6 deletion but which are in fact active cockpit dependencies:**
  - `apps/dashboard/src/lib/cockpit/legacy-shapes.ts` — imported by `apps/dashboard/src/components/cockpit/kpi-strip.tsx:7-11` (`legacyTiles` / `legacyRoi`) and `apps/dashboard/src/lib/cockpit/metrics-to-kpi-input.ts:1` (`LegacyKpiInput` type). Active KPI-strip dependency; **NOT a deletion candidate**.
  - `apps/dashboard/src/lib/cockpit/activity-kind-map.ts` — imported by `apps/dashboard/src/components/cockpit/cockpit-page.tsx` and Riley's translator. Active activity-stream dependency; **NOT a deletion candidate**.
  - `apps/dashboard/src/hooks/use-agent-activity.ts` — imported by `cockpit-page.tsx`, `riley-activity-translator.ts`, `use-riley-status.ts`. Active dependency; **NOT a deletion candidate**.
  These three correct the A.5 brief's "What comes after A.5" sketch ([[alex-cockpit-a5-shipped]]). See §Spec-conflict resolution.
- **`apps/dashboard/src/hooks/use-agent-greeting.ts` + `use-agent-metrics.ts`** — both consumed by `cockpit-page.tsx` (Alex cockpit) and, for metrics, by `riley-cockpit-page.tsx`. **NOT deletion candidates** despite being agent-home-vintage hooks.
- **`apps/dashboard/src/lib/agent-home/types.ts`** — still has multiple cockpit-side and api-client consumers (`use-agent-greeting`, `use-agent-metrics`, `metrics-types.ts`, `governance.ts`, `route-availability.ts`). The specific exports `WinsViewModel` and `PipelineViewModel` will become orphaned after this slice, but trimming individual exports inside a file with active consumers is **out of scope for A.6**. Future work may sweep them.
- **`apps/dashboard/src/components/layout/editorial-auth-shell.tsx`** — `HaltProvider` mount point stays. Re-rooting is not happening (see §Out-of-band §"No `HaltProvider` re-root" above and §Design decisions §1).
- **`apps/dashboard/src/components/layout/halt/halt-context.tsx`** — unchanged.
- **`apps/dashboard/src/app/(auth)/alex/page.tsx`, `apps/dashboard/src/app/(auth)/riley/page.tsx`** — both already render the cockpit; no `[agentKey]` branch to collapse. Untouched.
- **`apps/dashboard/src/app/(auth)/settings/team/**`** — `/team` does NOT import any agent-home component (verified). No precursor PR needed.
- **`packages/**`, `apps/api/**`, `apps/chat/**`, `apps/mcp-server/**`** — out of scope per user instruction. Surface-agnostic backend invariant trivially holds.
- **Backend API routes `/api/dashboard/agents/[agentId]/wins` + `/pipeline`** — these become unconsumed by the frontend but remain wired in `apps/api/src/bootstrap/routes.ts` and implemented under `packages/core/src/agent-home/{wins,pipeline}.ts`. Backend cleanup is post-A.6 follow-up (see §Risks).

---

## What does NOT ship at A.6

Explicit non-goals — preserved against accidental scope creep:

- ❌ **No new surface.** A.6 is cleanup-only. Any new file in the diff is a violation of the boundary lock (§Adapter-boundary invariant). The implementation plan's first boundary lock asserts this.
- ❌ **No `HaltProvider` re-root.** Spec §A.6 + §"HaltProvider placement" called for it; the architecture diverged (both `/alex` and `/riley` remain inside `EditorialAuthShell`); re-rooting now is out of scope. See §Spec-conflict resolution.
- ❌ **No `legacy-shapes.ts` / `activity-kind-map.ts` / `use-agent-activity.ts` deletion.** The A.5 brief sketched these for A.6 ([[alex-cockpit-a5-shipped]] "What comes after A.5"); the codebase shows them as active cockpit dependencies. The brief corrects the sketch; the implementation plan respects the actual usage. See §Spec-conflict resolution.
- ❌ **No backend route deletion.** API routes for `/wins` and `/pipeline` survive A.6. Frontend orphaning is the trigger for a future backend-cleanup follow-up; A.6 does not authorize a backend touch.
- ❌ **No `lib/agent-home/types.ts` trim.** `WinsViewModel` + `PipelineViewModel` become orphan exports inside a still-consumed file; trimming individual exports is out of scope. The future backend-cleanup follow-up may sweep them.
- ❌ **No `/team` precursor PR.** Spec §"Candidate deletion list" warned that `/team` might consume blocks and would need a precursor. Verification (2026-05-15) shows `/team` consumes none. No precursor needed; this is a clean delta from the spec.
- ❌ **No Riley page changes.** Riley's cockpit is independently shipped; A.6 does not touch it.
- ❌ **No schema changes.** No Prisma migration, no Zod schema, no `AgentRoster.config` field add/remove.
- ❌ **No API route changes.** Dashboard proxy routes under `apps/dashboard/src/app/api/**` are unchanged.
- ❌ **No test rewrites.** Tests for deleted components/hooks are **deleted in the same commit as the source file** (colocated, mechanical). Production tests for cockpit components are not modified or re-tuned; if any happens to fail after the deletion sweep, that is a regression and the slice halts.
- ❌ **No "follow-up issue" deferrals for in-scope work.** Per `[[ship-clean-not-followup]]`: if the sweep can't go clean (e.g., a hidden consumer surfaces), the slice halts and the consumer is addressed in the same PR. The slice does not merge with a "fix in follow-up" TODO.
- ❌ **No coverage-threshold lowering.** Per `CLAUDE.md` global thresholds (55/50/52/55). If the deletion sweep dips coverage below threshold, the slice halts and the brief is re-opened. See §Risks.

---

## Adapter-boundary invariant

The shared invariant from A.1/A.2/A.3/A.4/A.5 and Riley B.1/B.2a/B.2b/B.3 continues to hold:

> Cockpit UI consumes view-models only. Only files under `apps/dashboard/src/lib/cockpit/**` may import `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` / `@switchboard/schemas/{recommendations,audit}`.

A.6 is a **pure deletion**. It adds **zero** new imports anywhere. The expected outcome is that the count of audit-domain imports inside `apps/dashboard/src/components/cockpit/**` and `apps/dashboard/src/hooks/**` goes **down** as the deleted hooks (`use-agent-wins.ts`, `use-agent-pipeline.ts`) take their `@switchboard/schemas` and view-model imports with them.

Pre-merge grep gate (same as A.5):

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected outcome: the result is a **subset** of `main`'s — never a superset.

### Surface-agnostic backend invariant

Per `[[surface-agnostic-backend]]` (`feedback_surface_agnostic_backend.md`): core/schemas/db must not reference UI surfaces. A.6 makes **zero** edits under `packages/**`, `apps/api/**`, `apps/chat/**`, `apps/mcp-server/**`. Trivially clean.

```bash
git diff origin/main..HEAD -- packages/ apps/api apps/chat apps/mcp-server
```

Expected: empty output.

---

## Dependencies

- ✅ A.1 merged — `<CockpitPage>` mounted at `/alex`.
- ✅ A.2 merged (#485, `67eb0618`) — mission popover + cold-state narrator.
- ✅ A.3 merged (#500, `ed54c4a8`) — KPI strip + ROI bar.
- ✅ A.4 merged (#529, `c3ee595d`) — activity richness.
- ✅ A.5 merged (#542, `5a4fe7dc`) — composer + ⌘K palette. Phase A 5/6 closed.
- ✅ Riley cockpit shipped — `/riley` route mounts `<RileyCockpitPage>` directly (B.2a #497/#494/#493, B.2b #522, Wave B PR-1 #538, production emitter #541). No `[agentKey]` branching remains.
- ✅ `[agentKey]` route already collapsed — PR #468 (`d8b17625`, 2026-05-08) split into dedicated `/alex` and `/riley` routes; spec's "remove the per-agent branch" item is already done.
- ✅ `/team` audit clean — no agent-home imports in `apps/dashboard/src/components/team/**` or `apps/dashboard/src/app/(auth)/settings/team/**`. No precursor PR needed.
- ✅ Production stability through A.5 — A.5 shipped 2026-05-15; A.6 lands once Phase A has had operational time on the new surface. The spec says "after the cockpit has been stable in production through A.5"; the slice lands the day after A.5 because A.5 itself only added composer/palette to an already-stable cockpit, and the deletion targets are dead code that has had no consumer since the redesign cutover.
- ❌ Riley B.3-followup — independent of A.6 (no shared files). Riley B.3-followup unblocks on its own track.
- ❌ Backend API route cleanup (`/wins`, `/pipeline`) — depends on A.6 (frontend orphaning is the trigger) but is a separate follow-up PR, not part of A.6.

---

## Design decisions ratified by this slice

Five+ design decisions, each with one-line rationale and where the implementation plan picks them up.

1. **`HaltProvider` re-rooting is NOT in A.6's scope; the provider stays in `EditorialAuthShell`.** The spec assumed `EditorialAuthShell` would be replaced for the per-agent routes; the architecture diverged (both `/alex` and `/riley` continue to wrap their cockpit in the editorial shell, which all non-cockpit surfaces — `/team`, `/settings`, `/activity`, `/approvals`, `/contacts`, `/automations`, `/reports` — also rely on for halt-state). Re-rooting now would force a parallel provider in every other surface or break halt-state across the dashboard. The narrowest cleanup interpretation wins: A.6 deletes only what is provably orphaned, and the `HaltProvider` mount is anything but orphaned. The implementation plan does not modify `editorial-auth-shell.tsx` or `halt-context.tsx`.

2. **`apps/dashboard/src/app/(auth)/[agentKey]/page.tsx` is not deleted in A.6 because it does not exist.** PR #468 (2026-05-08) already collapsed the `[agentKey]` branch into dedicated `/alex` and `/riley` routes. The spec's deletion item "Remove the `agentKey === 'alex' ? <CockpitPage /> : <LegacyAgentHomeClient />` branch (after Riley cockpit ships per its own spec)" was completed ahead of A.6. The implementation plan records the verification step but ships no code change for this item.

3. **`/team` is not refactored as a precursor PR.** The spec §"Candidate deletion list" line "If `/team`'s roster cards re-use any of the above (audit during A.6 plan), the `/team` refactor is a precursor PR to A.6" is contingent on `/team` consuming a block. Verification (`rg "agent-home/" -g '*.tsx' apps/dashboard/src/components/team apps/dashboard/src/app/(auth)/settings/team`) returns empty. No precursor PR.

4. **`legacy-shapes.ts`, `activity-kind-map.ts`, and `use-agent-activity.ts` are NOT deleted at A.6.** The A.5 brief's "What comes after A.5" speculative sketch ([[alex-cockpit-a5-shipped]]) listed these. Codebase verification shows them as active cockpit dependencies (`kpi-strip.tsx`, `metrics-to-kpi-input.ts` consume `legacy-shapes.ts`; `cockpit-page.tsx` + `riley-activity-translator.ts` consume `use-agent-activity.ts`; `cockpit-page.tsx` consumes `activity-kind-map.ts`). The brief overrides the sketch in favor of the actual usage. Per the user's prompt: "Resolve in favor of the narrowest possible cleanup interpretation."

5. **Test deletion strategy: colocated deletes in the same commit as the source file.** Per `CLAUDE.md` §Code Basics ("Every new module must include co-located tests") — the inverse is also load-bearing: when a module is deleted, its colocated test is deleted in the same commit. The implementation plan groups each source file with its `__tests__/*.test.tsx` peer in a single task, so the deletion never leaves a test file orphan-pointing at a missing import.

6. **Coverage thresholds (per `CLAUDE.md`: global 55/50/52/55) must remain green after the sweep.** A.6 deletes both source and tests for the same code, so the *ratios* should hold — but the absolute file counts shrink, which can move thresholds at the margin. The implementation plan ships an explicit pre-merge gate that runs `pnpm --filter @switchboard/dashboard test -- --coverage` and confirms each of the four coverage thresholds (statements / branches / functions / lines) stays above its floor. If a threshold dips, the slice halts; the brief is re-opened, not "fix in follow-up." Per `[[ship-clean-not-followup]]`.

7. **The deletion order is leaf-first, with a zero-reference grep before each `rm`.** `agent-home-shell.tsx` is the umbrella consumer with zero external consumers — deleting it first orphans the entire block tree in one wave. The block files (`*-block.tsx` + `agent-block-boundary.tsx`) then delete one at a time with a grep check before each. The internal helpers (`prose-segments.tsx`, `sparkline.tsx`, `fixture-folio-badge.tsx`, `portrait/*`) delete last because they could in principle have been pulled into something outside `agent-home/` between the grep-write and the delete. Per the spec gate: "every deletion is preceded by a grep across the repo proving zero references. No 'delete and hope' sweeps."

8. **Backend route deletion is a separate follow-up.** Frontend orphaning of `use-agent-wins` + `use-agent-pipeline` does not authorize a backend cleanup in this PR. The API endpoints (`/api/dashboard/agents/[agentId]/wins`, `/pipeline`) and their `packages/core/src/agent-home/{wins,pipeline}.ts` implementations stay until a dedicated backend-cleanup PR sweeps them with its own zero-reference + tests-still-green discipline. Per the user's instruction: "Files explicitly NOT touched — anything under packages/, apps/api, apps/chat, apps/mcp-server."

9. **`/team` consumption is `none`, locked at this brief.** Re-verified at slice execution time as part of precondition checks (the implementation plan's Step 0e). If a `/team` consumer has appeared between brief and execution, the slice halts and the brief is re-opened — the plan does not silently expand to refactor `/team`.

---

## Risks specific to A.6

1. **A hidden caller has landed in `/team`, another surface, or a non-cockpit page since 2026-05-15.** The zero-reference grep at brief-time (2026-05-15) returned a clean self-contained subgraph; a fresh consumer between brief and execution invalidates the assumption. **Mitigation:** the implementation plan's first task is a zero-reference grep that runs in CI-like conditions and halts the slice if it returns a non-self match. Per Design Decision #7: leaf-first, grep-before-rm.

2. **Coverage drops below `CLAUDE.md` thresholds (55/50/52/55) after the sweep.** Although source and test delete together (so ratios should hold), absolute counts shrink and edge effects exist. **Mitigation:** the implementation plan ships a post-deletion `pnpm test -- --coverage` gate; the slice halts if any threshold dips. No "lower the threshold to make CI green" — that is a `[[ship-clean-not-followup]]` violation.

3. **A test fixture imports from a deleted file.** Some tests outside `agent-home/__tests__/` may rely on a fixture or helper exported from a deleted module. **Mitigation:** each task ends with a scoped test run (`pnpm --filter @switchboard/dashboard test`); failure on a test outside the deletion set means a fixture must be inlined or moved before the deletion completes. The slice does not delete a file whose deletion breaks a test outside its own colocated `__tests__/`.

4. **`HaltProvider` re-root edge case re-emerges.** If a future re-root discussion surfaces, the brief's §Design Decisions §1 is the answer: re-rooting is out of A.6's scope; if it is genuinely needed, it deserves its own slice that audits every editorial-shell consumer. **Mitigation:** the implementation plan does not touch `halt-context.tsx` or `editorial-auth-shell.tsx`. If a reviewer suggests re-rooting, point them at this brief.

5. **Backend API routes for `/wins` and `/pipeline` are orphaned but not deleted.** Risk: someone re-discovers them and assumes they're live. **Mitigation:** the PR description explicitly flags them as "frontend-orphaned, backend-deferred" and a future backend-cleanup PR sweeps them. Until then, the routes serve real responses to no caller — operationally harmless, organizationally a `// TODO` against `[[ship-clean-not-followup]]`, but contained: the orphan is now documented in both the brief and the PR description, not a silent debt.

6. **`lib/agent-home/types.ts` exports `WinsViewModel` + `PipelineViewModel` become unreachable from the dashboard tree.** Risk: unused-export lint or `ts-prune` flags them in a follow-up. **Mitigation:** the orphan exports are noted in the brief; a future cleanup may trim them. A.6 does not modify a still-consumed types file to delete two exports.

7. **Pre-existing test flakes (e.g., `prisma-work-trace-store-integrity`) trip CI during A.6's full-suite gate.** Per `[[db-integrity-tests-pg-advisory-lock]]`: these are baseline flakes unrelated to A.6. **Mitigation:** the implementation plan's precondition check runs the test suite **before** the sweep; if a pre-existing flake reproduces on the baseline, it is documented and the slice still merges if all A.6-touched files pass. Per `CLAUDE.md` §"db prisma-work-trace integrity tests fail on pg_advisory_xact_lock void — reproduces on baseline, don't block PRs on it."

8. **Auto-merge captures a stale HEAD if a late fix is pushed.** Per `[[auto-merge-captures-head-early]]`: `gh pr merge --auto --squash` squashes whatever GitHub evaluated, not what is HEAD at fire time. **Mitigation:** A.6 is short enough that auto-merge is not needed; the implementation plan instructs a manual `gh pr merge --squash` once CI is green.

9. **Empty directory remnants confuse readers.** After all files are deleted, `apps/dashboard/src/components/agent-home/portrait/` and `apps/dashboard/src/components/agent-home/` are empty. **Mitigation:** the implementation plan's final task removes the empty directories via `git rm -r` semantics (git does not track empty dirs, so the directories disappear naturally; the task confirms with `ls`).

10. **A subagent dispatch drifts cwd to the wrong worktree.** Per `[[subagent-worktree-drift]]`. **Mitigation:** the implementation plan's pre-merge gate verifies the branch via `git branch --show-current` before each commit.

---

## Test contract

A.6 ships **no new tests** and **rewrites no existing tests**. The test surface contracts mechanically as colocated tests are deleted alongside their source files.

Pre-merge gates (full list — the implementation plan's last task):

- **Zero-reference grep gate** — for each deletion candidate, `rg <name>` returns only self-references. Run **before** every `rm`. The slice halts on any non-self match.
- **Adapter-boundary grep gate** — `rg "Recommendation|AuditEntry|@switchboard/db|@prisma" apps/dashboard/src/components/cockpit apps/dashboard/src/hooks` returns a subset of `main`'s match set, never a superset.
- **Surface-agnostic backend grep gate** — `git diff origin/main..HEAD -- packages/ apps/api apps/chat apps/mcp-server` is empty.
- **Full test sweep** — `pnpm reset && pnpm typecheck && pnpm lint && pnpm --filter @switchboard/dashboard test && pnpm --filter @switchboard/dashboard build` all green. The dashboard build is the only gate that catches `.js`-extension regressions in Next.js imports per `[[dashboard-build-not-in-ci]]`.
- **Coverage gate** — `pnpm --filter @switchboard/dashboard test -- --coverage` shows statements / branches / functions / lines ≥ `CLAUDE.md` thresholds (55/50/52/55). The slice halts if any threshold dips.
- **Format gate** — `pnpm format:check` clean. Per `[[ci-prettier-not-in-local-lint]]`: CI catches prettier drift that local `pnpm lint` misses; run before pushing.
- **Manual verification** — open `/alex` and `/riley` in a dev stack; confirm the cockpit renders, the activity stream populates, halt-state toggles, the composer dispatches, the ⌘K palette opens. No 404s, no missing-component errors, no console exceptions.

---

## What comes after A.6

**Explicitly nothing in Phase A.** A.6 closes Alex Cockpit Phase A (6/6). The umbrella spec at `docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md` is fully implemented.

Independent workstreams that remain unblocked but are **NOT part of A.6**:

- **Riley B.3-followup** — palette adoption on `/riley`. Spec'd in Riley's slice brief; unblocked by A.5; independent of A.6.
- **Post-Phase-A Alex ramps** (deferred per umbrella spec, NOT part of A.6):
  - Auto-resume on pause N(h) — adds `pausedUntil` to `HaltProvider` and a scheduler. Post-Phase-A.
  - `brief` / `followup` cron + delivery — separate slice owns `Brief` / `Followup` persistence and Inngest jobs.
  - `TALKING` status pill wiring — depends on clean live-conversation backend signals.
  - Thread-context wire-through from expanded activity rows to composer's `threadContext`.
- **Backend route cleanup follow-up** — deletes the now-orphaned `/api/dashboard/agents/[agentId]/wins` + `/pipeline` proxy routes, the Fastify endpoints in `apps/api/src/bootstrap/routes.ts`, and the `packages/core/src/agent-home/{wins,pipeline}.ts` implementations + tests. Its own zero-reference + tests-still-green discipline. Out of A.6's scope per user instruction.
- **`lib/agent-home/types.ts` orphan-export trim** — opportunistic; bundled with the backend cleanup follow-up or done as a tiny lint sweep.

---

## Spec-conflict resolution

The umbrella spec at `docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md` was written on 2026-05-14, before A.2–A.5 shipped and before PR #468 (`d8b17625`, 2026-05-08, retroactively visible at spec-time) was discovered to have already collapsed `[agentKey]`. The brief resolves the following ambiguities in favor of the narrowest cleanup interpretation:

1. **Spec §A.6 + §"HaltProvider placement" + §Risks call for re-rooting `HaltProvider` into `CockpitPage`.** The architecture diverged: both `/alex` and `/riley` continue to wrap their cockpit in `EditorialAuthShell`, which all non-cockpit surfaces also rely on. Re-rooting now is out of scope. **Resolution:** HaltProvider stays in `EditorialAuthShell`. Brief §Design Decisions §1.

2. **Spec §"Candidate deletion list" lists `legacy-agent-home-client.tsx` and `agent-home-client.tsx` under `app/(auth)/[agentKey]/`.** Both files (and the directory) no longer exist on `main` — PR #468 removed them. **Resolution:** the implementation plan inherits a tree with the items already deleted; the verification step records the absence.

3. **Spec §"Candidate deletion list" does NOT include `agent-home-shell.tsx`.** This file (the umbrella consumer of all blocks) is the actual entry point for the legacy tree on current `main` — it was either added or renamed after the spec was authored. **Resolution:** the deletion list in this brief adds `agent-home-shell.tsx` as the leaf-first delete; the umbrella spec's intent (delete the legacy tree) is satisfied even though the file name differs.

4. **A.5 brief's "What comes after A.5" speculative sketch lists `legacy-shapes.ts`, `activity-kind-map.ts`, and `use-agent-activity.ts` for A.6 deletion.** Codebase verification shows them as active cockpit dependencies. **Resolution:** brief §Design Decisions §4 overrides the sketch; these files are not deletion candidates.

5. **Spec §"Candidate deletion list" implies `/team` might consume blocks and need a precursor PR.** Verification returns empty. **Resolution:** no precursor PR; brief §Design Decisions §3.

6. **Spec acceptance criterion §14 ("the existing `apps/dashboard/src/app/(auth)/[agentKey]/agent-home-client.tsx` and the `components/agent-home/*-block.tsx` files are deleted after zero-reference verification").** The `agent-home-client.tsx` half is already done; the block-deletion half is what A.6 ships. **Resolution:** A.6 satisfies the second half; the first half is recorded as already-shipped.

If any of these resolutions conflict with the spec's intent at a deeper reading, the spec wins and the conflicting text here is wrong — re-open the brief.
