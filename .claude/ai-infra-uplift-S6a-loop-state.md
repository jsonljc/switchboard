# S6a (ExecutionTrace workUnitId query surface) — build-loop state (scratch, uncommitted)

Durable record: `project_ai_infra_uplift_state` + backlog `.claude/ai-infra-uplift-backlog.md` (S6 line).
Parent decomposition: `.claude/ai-infra-uplift-S6-decomposition.md` (6a/6b split + design fork).

Goal: make the ordered per-work-unit tool-call sequence QUERYABLE (the S6 verify-first prerequisite, "6a").
Authority: AUTONOMOUS-WITH-GUARDRAILS, but **prisma/migrations stop-glob is touched -> SURFACE-before-merge** (human merge call).
Task-size: standard (one bounded PR).
Base: origin/main @ 559628a5b (worktree `feat/ai-s6a-trace-workunit-query`; includes #1194). Use three-dot diffs.

## VERIFY-FIRST verdict: NO — not queryable per work unit (re-confirmed on current main, not the note)

- `WorkTrace` (`packages/core/src/platform/work-trace.ts:6-109`) = governance/outcome record; NO ordered tool-call steps (opaque `executionOutputs?` JSON only).
- `ExecutionTrace` (`packages/db/prisma/schema.prisma:841-874`) holds the ordered `toolCalls Json` + a separate `governanceDecisions Json`, indexed by `sessionId` — but has **NO `workUnitId`** and no FK to WorkTrace -> not joinable per work unit.
- `PrismaExecutionTraceStore` (`packages/db/src/stores/prisma-execution-trace-store.ts`) has listByDeployment/findById/linkOutcome/countRecentFailures/countWritesInWindow — **no `findByWorkUnitId`**.
- NEW (decides the fork): `workUnitId` IS already in scope at the executor->hook seam. `skill-executor.ts` builds `hookCtx: SkillHookContext` from `params`/`requestCtx`, both carrying `workUnitId` (already threaded for delegation lineage: `SkillExecutionParams.workUnitId`, `SkillRequestContext.workUnitId`). So populating it is a one-line additive change, NOT the "wider change" the decomposition feared.

## Design decision (brainstorming output — fork RESOLVED to option (i))

**Option (i): add `workUnitId String?` FK column on `ExecutionTrace`, populate at the trace hook, add `findByWorkUnitId`.** Chosen.

- Cheap + additive: workUnitId already in scope (verified); one nullable column; one-line hookCtx + one-line trace population; one new store query method.
- Natural FK; matches "ExecutionTrace as the trace artifact" (it already owns the ordered `toolCalls`).
- **Option (ii) [embed an ordered summary on WorkTrace] REJECTED:** WorkTrace is the canonical, sealed/locked/content-hashed governance entity (`work-trace-lock.ts`, `hashInputVersion`); overloading it with tool-call data is higher-stakes, AND its builder does not hold the ordered sequence (built in the executor, not at WorkTrace finalization) -> would need MORE plumbing through a MORE sensitive entity for no benefit.
- Scope guard: this slice is 6a ONLY (the query surface). The deterministic grader/gate is 6b (next slice; now has a real trajectory source once 6a merges, or golden fixtures meanwhile). Do NOT build the grader here.

## Why 6a first (not 6b): the f7 value needs a real trajectory source

6b graded over hand-authored fixtures alone is grader-correctness only (the decomposition's "circular" caveat). The actual f7 capability — catch "right action but bypassed an approval gate" / "fixed in N consumers, missed in N+1" on REAL trajectories — needs real per-work-unit trajectories queryable. 6a is that prerequisite. It also unblocks E4 (OTel spans depend on S6a). Prompt-directed sequence: build 6a first as its own slice, then 6b.

## Steps (TDD-shaped; RED proof is a hard done-condition)

| #   | step                                                                                                                                                                                 | done-condition (test/cmd)                                                                                                                                                           | RED proof                                                   | status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------ |
| 1   | schema + hand-written migration; `workUnitId String?` + `@@index([organizationId, workUnitId])` on ExecutionTrace; `pnpm db:generate`                                                | generated client type includes `workUnitId`; migration SQL matches schema (index name <=63 chars); typecheck of db store referencing the field compiles                             | store test in step 3 cannot compile/pass without the column | todo   |
| 2   | core threading: `workUnitId?` on `SkillExecutionTrace` + `SkillHookContext`; hookCtx `workUnitId: requestCtx.workUnitId`; trace `workUnitId: ctx.workUnitId` in afterSkill + onError | RED test: TracePersistenceHook.afterSkill(ctx w/ workUnitId) calls traceStore.create with workUnitId; executor passes workUnitId into hookCtx (pin the executor->recorder seam)     | test fails: field absent / not forwarded                    | todo   |
| 3   | store: `workUnitId?` on local `ExecutionTraceInput` mirror + map in `create`; add `findByWorkUnitId(orgId, workUnitId): Promise<ExecutionTraceInput[]>` ordered createdAt asc        | RED test (mocked Prisma, mirror prisma-execution-trace-store.test.ts): create passes workUnitId; findByWorkUnitId queries {organizationId, workUnitId} ordered asc and returns rows | method/field absent -> fail                                 | todo   |
| 4   | VERIFY + SURFACE                                                                                                                                                                     | gates green; independent review 0 sev>=warn; three-dot diff proves criteria; open PR; SURFACE (prisma glob)                                                                         | n/a                                                         | todo   |

## Acceptance criteria

- AC1: ExecutionTrace has a nullable `workUnitId` + index; hand-written migration present and consistent (CI drift-validates).
- AC2: a persisted skill-execution trace carries the work unit's id (afterSkill + onError both populate it); the executor->recorder seam is pinned by a test.
- AC3: `findByWorkUnitId(orgId, workUnitId)` returns the matching traces ordered chronologically; each row's `toolCalls` is the ordered ToolCallRecord[] sequence. Org-scoped (multi-tenant safety).
- AC4: purely additive — existing creates/reads unaffected (workUnitId optional/nullable); all required gates green; independent review clean.

gate_results: typecheck=PASS test=PASS(core 4345/0, api 2258/0, db-mocked 13/13; db integration suites = known pg_advisory PG-down flake) lint=PASS(0 err) format=PASS arch=PASS verify-fast=PASS build=PASS review=SHIP(0>=warn) (db:check-drift skipped: PG down, CI validates)
merge_safety: stop-glob touched=YES (prisma/migrations) -> SURFACED PR #1196 (no auto-merge). independent_review=SHIP (fresh-context opus; producer LIVE @ skill-mode.ts:95, seam core<->db<->api holds, single-writer, migration faithful).

## DONE — MERGED to main `186856219` (PR #1196, squash; terminal + closed). All 4 steps complete; 9 files +135.

User-authorized merge after a 2-reviewer deep review (architecture + correctness = both ship). All 4 required CI checks GREEN (typecheck/lint/security + real-DB `test`). Teardown done: local main ff'd, worktree + local/remote branch removed, no dangling stash. **S6b (the deterministic Tool/Argument-correctness gate) is the next slice** — consumes `findByWorkUnitId`; follow `evals/governance-decision/` template; also unblocks E4.

## Log

- 2026-06-20: ORIENT+FRAME+PLAN. Verify-first re-confirmed NO on current main; fork resolved to (i) (workUnitId in scope at hook -> cheap). Worktree off 559628a5b. -> EXECUTE.
- 2026-06-20: EXECUTE done (steps 1-3 TDD, RED proofs captured: hook undefined->wu_success, executor seam undefined->wu_exec, store create+findByWorkUnitId). VERIFY: gates GREEN, independent review SHIP. Producer verified live. Base undiverged. SURFACED -> PR #1196. STOP (prisma stop-glob; human merge).
- 2026-06-20 (deep review round, user-requested): 2 fresh-context opus reviewers (architecture-alignment + correctness/works-as-intended) = BOTH "Yes/ready to merge", zero Critical/Important. Architecture: no layer violation/cycle; ExecutionTrace is the right home (child->parent FK doesn't muddy WorkTrace-canonical); get*/find* naming fine. Correctness: C1-C4 confirmed; delegation attribution verified CORRECT (child gets fresh workUnit.id via normalizeWorkUnit -> own trace). Migration validated drift-faithful via no-DB `prisma migrate diff --from-empty` (index name + column type + order match Prisma canonical exactly). origin/main re-diverged 559628a5b->0732c3d5 (concurrent sessions) but added NO migration -> no conflict, mine sorts last; three-dot diff clean. Applied ONE hardening from review: pinned `findByWorkUnitId` returns governanceDecisions (not just toolCalls) for the 6b consumer (commit 02568f8fc). Skipped optional nits (onError seam test = transitively covered; mirror/naming comments = db-side comment already suffices). PR head now 02568f8fc.
