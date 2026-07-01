# A20 — Mira measured-signal over the full cohort (P1-8)

Slice of `docs/superpowers/plans/2026-06-22-second-wave-fix-plan.md`.
Worktree: `.claude/worktrees/a20-mira-measured-cohort` Branch: `fix/mira-measured-cohort-a20`
baseline_sha: `cdce15525` (origin/main at start)

## Gap (CONFIRMED on main with tools)

- Producer `packages/core/src/creative-read-model/build-read-model.ts:80`: `rm.jobs = summaries.slice(0, visibleLimit ?? 5)`. `counts.inFlight/total/...` are computed over ALL `summaries` (full cohort), but there is NO measured count.
- Prod reader `packages/db/src/stores/prisma-mira-creative-read-model-reader.ts:18,30,34`: `FETCH_CAP = 200`, `take: 200`, passes all 200 rows to the builder. Worker calls `read(orgId,{now,timezone})` with NO `visibleLimit` -> defaults to 5 visible.
- Consumer `apps/api/src/services/cron/mira-self-brief.ts:155`: `const hasMeasured = model.jobs.some(j => j.performance?.delivery === "measured")` reads the VISIBLE 5, not the cohort. A measured job at cohort position 6..200 is invisible -> Mira wrongly skips `no_signal`.

## Fix (determined design, mirrors `inFlight`)

1. `types.ts`: add `measuredCount: number` to `MiraCreativeCounts` (homogeneous numeric count; documented as full-cohort, not reporting-grade).
2. `build-read-model.ts`: `const measuredCount = summaries.filter(s => s.performance?.delivery === "measured").length;` add to returned `counts`.
3. `mira-self-brief.ts`: inline dep type (line ~90) `counts: { inFlight: number; measuredCount: number }`; line 155 `const hasMeasured = model.counts.measuredCount > 0;`.

`measuredCount` (not `hasMeasured` boolean) chosen: MiraCreativeCounts is a bag of numeric counts; a lone boolean is a smell; the count is strictly more informative (cockpit "N measured") and the worker derives the boolean locally. Plan said "measuredCount/hasMeasured"; this satisfies the intent.

## Blast radius (typed MiraCreativeCounts / MiraCreativeReadModel literals — required field => must update)

BREAK (fix): build-read-model.ts (producer); build-read-model.test.ts (2 toEqual + new test); desk-model.test.ts:37 base const; metrics-mira.test.ts x3; mira.test.ts:15 emptyModel; mira-self-brief.ts inline type + line 155; mira-self-brief.test.ts (4 mocks + default makeDeps + new test).
SAFE (cast/loose — verify via tsc): mira.test.ts:176/309 (`as unknown as`); mira-skill-render.test.ts:44 (mockResolvedValue under outer SkillStores cast); revenue-proven-loop.test.ts:191 (`as unknown as`); skill-mode-governance.test.ts:188 (`counts: {}` loose vi.mock).

## TDD steps

- [ ] S1 RED (producer): build-read-model.test.ts — ">5 jobs, one measured at index 6 (outside visible 5) -> counts.measuredCount === 1 and rm.jobs (len 5) excludes it". A visible-slice impl yields 0 (discriminates). RED = field absent / 0.
- [ ] S1 GREEN: types.ts + build-read-model.ts (compute over full summaries). Fix the 2 existing toEqual assertions (+ measuredCount:0). `tsc --noEmit` core; rebuild core dist.
- [ ] S2 fix core typed literals: desk-model.test.ts:37, metrics-mira.test.ts x3, mira.test.ts:15. `pnpm --filter @switchboard/core test` green; `tsc --noEmit` core.
- [ ] S3 RED (consumer): mira-self-brief.test.ts — new test: readModel mock `jobs: []` (measured outside visible window) + `counts: { inFlight: 0, measuredCount: 1 }`, empty memory -> asserts proceeds to `{ jobId }` and `memoryReader.listHighConfidence` NOT called. RED on current `model.jobs.some` (returns no_signal).
- [ ] S3 GREEN: mira-self-brief.ts inline type + line 155. Update default makeDeps + 4 mocks for the required field. `pnpm --filter @switchboard/api test` (mira-self-brief) green; `tsc --noEmit` api.
- [ ] S4 gates: core+api tsc; full `pnpm test`; lint; format:check; arch:check; `CI=1 local-verify-fast`; `pnpm audit --audit-level=high`. (No decision-engine change -> no eval needed; Mira floor is the only behavior touched, covered by unit tests. Build only if app dist needed for tsc.)
- [ ] S5 independent fresh-context review (READ-ONLY Explore agent, diff-as-text). Triage. Re-run gates.
- [ ] S6 converge: NOT a merge-stop glob (creative-read-model + mira cron; no consent/auth/money/governance/sends). AUTO-MERGE if checks green + review clean + high confidence.

## OUTCOME — MERGED ✅ (2026-06-25)

PR #1281 squash `9d20704eb`. Auto-merged (NOT a merge-stop glob; independent Explore review CLEAN; all CI green incl. evals + security). Design revised from the plan sketch: added a single `measuredCount: number` (not a `hasMeasured` boolean) to MiraCreativeCounts, and dropped the now-dead `jobs` from the worker's structural read-model dep type (floor is fully count-based). Worktree removed, branch deleted, main ff-synced. Durable lesson -> feedback_floor_reads_windowed_projection_not_cohort.
NEXT: A22 (payments-webhook entitlement carve-out — MONEY merge-stop, WILL surface).

## Notes / backlog

- (none)
