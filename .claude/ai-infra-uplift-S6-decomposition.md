# S6 (Trajectory grading on WorkTrace) — VERIFY-FIRST outcome: DECOMPOSE + BLOCK

Date 2026-06-20. Disposition: **[B] blocked** — the verify-first precondition fails, so the gate cannot be built without a prerequisite. Raised per the backlog's explicit S6 rule ("FIRST verify WorkTrace is queryable as an ordered tool-call step sequence per work unit ... if not: decompose (add the query surface first); do not force it") + the build-loop "non-trivial schema/data migration risk" STOP condition. No worktree created (ORIENTed read-only).

## Verify-first verdict: NO (with evidence)

- `WorkTrace` (`packages/core/src/platform/work-trace.ts:6-109`) has NO steps/toolCalls field — it is a governance/outcome record, not a step trace.
- The ordered tool-call sequence (tool id + operation + full args + governanceDecision, ordered by array position = LLM turn order) is built in `SkillExecutorImpl.execute()` as `ToolCallRecord[]` (`skill-executor.ts:310, 604-611`) and persisted into a SEPARATE entity `ExecutionTrace.toolCalls Json` (`packages/db/prisma/schema.prisma:~852`, via `trace-persistence-hook.ts:83`).
- `ExecutionTrace` has `sessionId` + `deploymentId` but **NO `workUnitId`** and no FK to `WorkTrace`. There is no `findByWorkUnitId` on the execution-trace store. So: not joinable per work unit.
- No golden trajectory fixtures exist (the oracle in `evals/alex-conversation/oracle.ts` checks tool SET membership only — not ordered sequence, not argument values; runs on in-process mock calls, not DB rows). Capturing real golden trajectories needs a live model run (blocked: CI ANTHROPIC_API_KEY is 401 repo-wide).

## Why not force it

A meaningful trajectory gate needs ACTUAL ordered tool-call trajectories (per work unit) to assert Tool/Argument Correctness against. Today there is no source: (a) no WorkTrace query surface, (b) no recorded golden trajectories, (c) live capture blocked by the invalid key. Building the gate over hand-authored "expected" trajectories alone would be circular (testing the assertions against self-authored fixtures, catching no real regression). And the prerequisite (a) is a canonical-persistence schema migration — high stakes, a build-loop STOP condition, unvalidatable locally (Postgres down -> hand-written migration, CI-only drift check), and with NO consumer until the gate lands.

## Decomposition (resume when prioritized)

- **6a — query surface (prerequisite; SURFACE: prisma/migrations stop-glob + migration risk).** Make the ordered tool-call sequence queryable per work unit. DESIGN FORK (needs a decision):
  - (i) Add `workUnitId String?` (+ index) to `ExecutionTrace`; populate it in `TracePersistenceHook.afterSkill` (VERIFY the hook has the workUnitId in scope — if not, thread it through, a wider change); add `findByWorkUnitId` returning the ordered `ToolCallRecord[]`. Natural FK; one nullable column.
  - (ii) Embed a compact ordered tool-call summary on `WorkTrace` at build time (new column, or reuse the opaque `executionOutputs` JSON to avoid a migration). Makes WorkTrace itself the trace artifact (matches f7's "WorkTrace as the trace artifact"), but overloads executionOutputs / adds a column, and depends on the builder having the sequence.
  - Recommend (i) for a clean FK; decide (i) vs (ii) before building.
- **6b — the deterministic gate (the f7 value; eval-gate, likely [AUTO] if no stop-glob).** Once 6a exists OR golden trajectories are recorded: a deterministic (no-LLM, no-key) CI eval asserting Tool Correctness (the recorded sequence's tools are the expected/allowed ones, in order) + Argument Correctness (args conform to the tool schema / expected shape) on the per-work-unit sequence. Follow the `evals/governance-decision/` deterministic template (JSONL fixtures + run-eval.ts + ci.yml job + package.json script). Needs a source of ACTUAL trajectories (persisted via 6a, or golden recordings) — not hand-authored expectations alone.
- **Blocking notes:** 6a is gated on a design decision + (likely) a Postgres-validated migration; 6b is gated on 6a (or recorded golden trajectories) + a trajectory source. The whole item is also softly gated by the 401 CI key if real trajectories are to be captured.

## Recommendation (user)

Decide the 6a design fork (FK on ExecutionTrace vs embed-on-WorkTrace) and whether the trajectory source is persisted-real-runs (needs 6a + the key) or committed golden recordings. Then 6a is a focused schema slice and 6b a clean deterministic gate.
