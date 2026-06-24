# E4b (WorkTrace/ExecutionTrace -> OTel GenAI-span projection) — build-loop state (scratch, uncommitted)

Durable record: `project_ai_infra_uplift_state` + backlog `.claude/ai-infra-uplift-backlog.md` (E4 line) + `.claude/ai-infra-uplift-epics-E1-E5-decomposition.md` (E4 a/b/c).
Research finding: f21 (one-directional WorkTrace -> OTel GenAI spans). Depends on S6a (DONE: `findByWorkUnitId`).

Goal: a flag-gated, read-only, ONE-DIRECTIONAL projection of a work unit's tool-call trajectory into OTel GenAI spans (parent work-unit span -> execution spans -> tool spans), using the EXISTING core Tracer. WorkTrace stays canonical; OTel is a read-only projection, NEVER a second source of truth.
Authority: AUTONOMOUS-WITH-GUARDRAILS. Pure core projection + tests + a thin apps read = NOT a stop-glob -> MERGE CLEAN after independent review (0 sev>=warn, all required CI green). SURFACE iff: a NEW env var (env-allowlist glob), an apps bootstrap change touching send/auth, or any WorkTrace canonical-write / governance-text edit.
Task-size: standard (one bounded PR).
Base: origin/main @ 41fc94bac (local HEAD == origin/main). Worktree: `.claude/worktrees/ai-e4b-otel-spans`. Three-dot diffs.

## ORIENT brief (verify-first, all tool/file-backed)

- GAP REAL: no WorkTrace->span projection anywhere (telemetry barrel `packages/core/src/telemetry/index.ts:1` exports only Tracer/metrics). 2 `startSpan` callers (`orchestrator/execution-manager.ts:92`, `propose-pipeline.ts:81`), both 2-param -> optional 3rd param is back-compat.
- OTel infra EXISTS (do NOT rebuild): `tracing.ts` (Tracer iface + `createOTelTracer` adapter + Noop fallback); `apps/api/src/telemetry/otel-init.ts` bootstraps SDK, gated on `OTEL_EXPORTER_OTLP_ENDPOINT` (apps/chat has NO otel-init). `@opentelemetry/*` in root pkg.
- `ToolCallRecord` (`skill-runtime/types.ts:133-140`): `{toolId, operation, params:unknown, result:ToolResult, durationMs:number, governanceDecision:GovernanceOutcome}`. Core-owned; == S6b drift-guarded `RecordedCall`.
- `findByWorkUnitId(orgId, workUnitId): Promise<ExecutionTraceInput[]>` ordered createdAt asc; each row: `toolCalls`, `governanceDecisions`, `tokenUsage`(aggregate: input/output/cacheRead/cacheCreation/costUsd/model), `turnCount`, `durationMs`, `status`, organizationId, deploymentId, skillSlug, workUnitId, sessionId.
- WorkTrace (`platform/work-trace.ts:6-109`): workUnitId, organizationId, deploymentId, intent, mode, governanceOutcome, riskScore, outcome, durationMs, timestamps -> parent-span attrs.
- NO per-individual-LLM-call data persisted (only aggregate tokenUsage + turnCount). => hierarchy = work-unit -> execution (per ExecutionTrace, aggregate LLM attrs) -> tool (per ToolCallRecord). Per-turn LLM spans = DEFERRED (no data source); documented, not fabricated.
- Env: reuse `OTEL_EXPORTER_OTLP_ENDPOINT` (already in `scripts/env-allowlist.local-readiness.json:101-102`). NO new env var.
- semconv GenAI consts not pinned -> use `gen_ai.*` string literals (otel-init already falls back to literals).

## Design (FRAME) — LOCKED (brainstorming, autonomous; doctrine-checked)

**Approaches weighed:** (1) 2-level tree work-unit->tool [rejected: no home for LLM/token attrs, loses execution grouping]; (2) flat spans + parent-id attributes [rejected: not a real OTel tree, the prompt wants a tree]; (3) **3-level real tree via a minimal Tracer parenting extension [CHOSEN]**.

**(a) Hierarchy (3 levels, justified by data that ACTUALLY exists):**

```
work_unit span (1, WorkTrace-summary attrs)            gen_ai.operation.name=invoke_agent
 └─ execution span (N, one per ExecutionTrace row)     gen_ai.operation.name=chat  [the honest GenAI agent-invocation span]
     └─ tool span (M, one per ToolCallRecord)          gen_ai.operation.name=execute_tool
```

Per-individual-LLM-CALL (per-turn) spans = DEFERRED: NO data source (only aggregate `tokenUsage`+`turnCount` per ExecutionTrace persisted). Each ExecutionTrace IS one tool-calling LLM conversation -> the execution span is the honest agent/chat span; `turnCount` recorded as an attribute (count visible without fabricating per-turn spans). Documented, NOT fabricated.

**GenAI attribute mapping (string literals; semconv not pinned):**

- work_unit: `gen_ai.system`=switchboard, `gen_ai.operation.name`=invoke_agent, `switchboard.work_unit.id/organization.id/deployment.id/intent/governance.outcome/work.outcome/risk_score/duration_ms`. status ERROR if governanceOutcome=deny or outcome=failure.
- execution: `gen_ai.operation.name`=chat, `gen_ai.request.model`=tokenUsage.model, `gen_ai.usage.input_tokens/output_tokens`, `switchboard.skill.slug/version/turn_count/session.id/duration_ms/execution.status`. status from row status.
- tool: `gen_ai.operation.name`=execute_tool, `gen_ai.tool.name`=toolId, `switchboard.tool.operation/duration_ms/result_status`, `switchboard.governance.decision`=governanceDecision (the governance attr the prompt asked for). status from result.status / deny.
- **params: deliberately NOT exported as raw values** (PII/secret leak to an external OTLP collector — deposit amounts, contact details). Record `switchboard.tool.params_present`(bool) only. Privacy-preserving deviation from the prompt's "params->input"; documented.
- numeric attrs guarded by `Number.isFinite` (NaN-blind lesson); malformed toolCall -> `switchboard.tool.malformed=true` fail-SOFT (telemetry must never crash a read path).

**(b) Trigger + one-directionality:**

- Core pure fn `projectWorkUnitSpans(input: WorkUnitSpanInput, tracer: Tracer): void` in `packages/core/src/telemetry/work-unit-spans.ts`. NO store/db/network param -> structurally cannot write back. Tracer is the ONLY (write-only-to-telemetry) sink, injected (S7/S6b pure-fn+injected-dep pattern). Imports `Tracer`/`Span`+`ToolCallRecord` from core only; NO db import (import-closure pinned, like S7). Returns void; never returns the input or a canonical artifact.
- The Tracer parenting extension (the ONE genuine interface change): `Tracer.startSpan(name, attributes?, parent?: Span): Span` (optional 3rd param; both existing 2-param callers unaffected; NoopTracer ignores it). `createOTelTracer` gains an OPTIONAL injected context helper (`{active(), with(ctx,span)}`) + a WeakMap wrapper-Span->raw-OTel-span so a child is created under the parent's OTel context; degrades to flat if the helper is absent (never throws). `otel-init.ts` injects `{active: ()=>otelApi.context.active(), with: (ctx,s)=>otelApi.trace.setSpan(ctx,s)}`. **This must be HONORED end-to-end or the prod tree is flat while fake-tracer tests green (the stored!=enforced trap) -> a fake-otelTracer adapter-parenting test pins it.**
- Apps (Layer 5): pure mapper `mapExecutionTracesToSpanInput(traces: ExecutionTraceInput[], workTrace?): WorkUnitSpanInput` (does the `unknown[]->ToolCallRecord[]` narrowing) + a thin flag-gated exporter `exportWorkUnitSpans(deps, orgId, workUnitId)` (gate -> findByWorkUnitId -> map -> project). The LIVE TRIGGER (route/hook/bootstrap call) is E4c, NOT here. Parent attrs sourced from ExecutionTrace rows (org/deployment/skill/status/duration all present); optional WorkTrace enrichment (intent/governanceOutcome/risk) if a per-workUnitId WorkTrace read is cheaply available (confirm at EXECUTE; default = ExecutionTrace-sourced).

**(c) Flag/env gating:** reuse `OTEL_EXPORTER_OTLP_ENDPOINT` (already allowlisted) — exporter early-returns when unset (skips the DB hit; tracer is Noop anyway). **NO new env var -> no env-allowlist stop-glob.**

**Layer + stop-glob check:** core fn Layer-3 clean (no db); apps mapper/exporter Layer-5. NO stop-glob in the planned file set (tracing.ts, work-unit-spans.ts, telemetry/index.ts, otel-init.ts[telemetry bootstrap, NOT send/auth], apps work-unit-span-export.ts, tests). No prisma/auth/billing/consent/credential/governance/send/route/env-allowlist. -> [AUTO] eligible (conditional on clean review + green CI + high confidence; else downgrade to SURFACE).

**Testing (determinism: in-memory, no OTLP/DB/key):** `RecordingTracer` double records `{name,attributes,parentId,status,ended}` -> assert full tree+attrs+order+all-ended; one-directionality (deep-freeze input, no-throw/no-mutation + no-db-import closure); adapter parenting (fake otelTracer+fake ctx helpers); apps mapper+seam (realistic findByWorkUnitId row -> map -> project -> tree).

Plan: `.claude/ai-infra-uplift-E4b-plan.md` (4 TDD tasks). baseline_sha: 41fc94bac (worktree HEAD, off origin/main).

| step | done-condition (test/cmd)                                                                                                                                  | RED proof                                                          | status | evidence                                                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | Tracer `parent?` + OTel adapter honors it (WeakMap+contextBridge) + otel-init injects bridge; `--filter core test -- tracing.test.ts` + core/api typecheck | adapter-parenting fake test: child started with parent-derived ctx | DONE   | commit 23bcf05c0; RED=`bridge.with` called 0x (old adapter dropped parent); GREEN=3/3 tracing tests + core+api typecheck clean                             |
| T2   | `projectWorkUnitSpans` emits parented work-unit->execution->tool tree; barrel export; `--filter core test -- work-unit-spans.test.ts`                      | RecordingTracer tree assertion fails (module absent)               | DONE   | commit 9b4c6a0f7; RED=module not found; GREEN=2/2 tree tests (1+2+3 spans all ended; empty case), typecheck+build clean                                    |
| T3   | GenAI attrs + status + Number.isFinite guards + params-scrub + malformed fail-soft + no-db-import + deep-freeze read-only                                  | attr/status/guard asserts fail on T2 stub                          | DONE   | commit 16471cd71; RED=params_present/status undefined; GREEN=9/9 in-file, full core 4357 pass, typecheck+build clean                                       |
| T4   | apps mapper (unknown[]->ToolCallRecord[]) + flag-gated exporter (reads `wt.trace.*`, tenant-guard) + seam test; `--filter api test`                        | seam map->project tree fails (module absent)                       | DONE   | commit 9c2341afa; RED=module not found; GREEN=5/5 incl. enrichment-lands(intent=book_appt)/absent-on-mismatch + seam tree + flag-gate; api typecheck clean |

gate_results (pre-rebase, full suite): typecheck=PASS(22/22) test=PASS(core 4357 + api 2282; full pnpm test skipped=PG-down env, slice touches 0 db code) lint=PASS(0 err) format=PASS arch=PASS verify-fast=PASS(6/6, no env/route debt) build=PASS(10/10) security=PASS(audit; pre-existing ignored GHSAs) review=SHIP(0 sev>=warn; 2 optional NITs)
merge_safety: stop-glob touched=NO (8 files all under telemetry/; reuses OTEL_EXPORTER_OTLP_ENDPOINT (allowlisted); no prisma/auth/governance/send/route/env-allowlist) -> [AUTO] eligible. independent_review=SHIP (fresh-context opus: AC1-6 all PASS incl. parenting honored end-to-end + one-directionality + nested wt.trace.\* tenant guard; compiled an assignability probe vs the REAL Prisma stores -> E4c wires clean). NONE of the SURFACE conditions fired.

## DONE — MERGED to main `a49f97cbe` (PR #1213, squash; terminal + closed). 8 files +878/-26.

[AUTO]-merged per authority (MERGE CLEAN; no SURFACE condition fired, no merge-stop glob). All required GitHub checks GREEN (typecheck 2m45s / lint 1m59s / test 11m4s real-DB / security 46s) + architecture/CodeQL/docker/6 evals. Independent fresh-context opus review = SHIP (0 sev>=warn). Pre-merge: rebased onto d6bb02ba6 then merged onto 103237a5a (main advanced twice during the loop, ZERO telemetry overlap both times). Teardown done: local main ff'd, worktree+local branch removed, remote auto-deleted.

**E4 status now: E4a satisfied by S6a (findByWorkUnitId); E4b DONE (#1213); E4c REMAINS = the live trigger (route/hook/bootstrap call to `exportWorkUnitSpans`) — that is where a real OTLP export + any new env var would land (SURFACE then).** Reviewer compiled an assignability probe proving the REAL `PrismaWorkTraceStore`/`PrismaExecutionTraceStore` are assignable to `WorkUnitSpanExportDeps`, so E4c wires the real stores with no shape mismatch.

GOTCHA surfaced (durable): `WorkTraceStore.getByWorkUnitId(workUnitId)` is a GLOBAL no-org-scope `findUnique` returning nested `{ trace, integrity }` — a cross-tenant-leak hazard (same class as `getByIdempotencyKey`). Callers MUST read `result.trace.*` and tenant-guard on `result.trace.organizationId === orgId`. The plan-grade caught a flat-shape read that would have made the guard silently `undefined === orgId` (always-false) + enrichment inert.

## Deep post-merge review (user-requested, 2026-06-21): WORKS-AS-INTENDED + ARCHITECTURALLY-ALIGNED = YES; NO Critical.

Fresh-context opus reviewer verified parenting against the REAL `@opentelemetry/sdk-trace-base` source (parent captured at startSpan via `spanContext()`, so the tree nests correctly in prod, not just vs the fake), layer/one-directional/canonical invariants pinned, GenAI keys spec-exact (semconv 1.40.0), status/guards/privacy exhaustive vs the real unions, and E4c handoff types provably assignable to the real Prisma stores. Merged code is sound/correct/safe as-is. 3 Important FOLLOW-UPS, ALL recommended for E4c (recorded in the E4 decomposition): (1) temporal flatness -> spans ~0ms wall-clock, timeline view unusable until `Tracer` carries `startTime/endTime/kind` + synth offsets from `durationMs`; (2) mapper drops `tokenUsage.cacheRead/cacheCreation/costUsd` -> add `gen_ai.usage.cache_*_tokens`; (3) guard root `work_unit.id` with setIfString. Polish: barrel-export `OTelContextBridge`, `gen_ai.system=anthropic` on exec span, explicit SpanKind. NONE warrants reverting/hotfixing the merged slice; all fold into E4c where a live OTLP export validates the timeline.

## Log

- 2026-06-21: ORIENT done. Verify-first confirmed the gap is real + OTel infra exists; locked the 3-level hierarchy + no-new-env-var + the flat-Tracer parenting tension. -> FRAME (brainstorming).
- 2026-06-21: FRAME (brainstorming, autonomous) + PLAN (writing-plans) done -> 4 TDD tasks in the plan. Worktree `ai-e4b-otel-spans` off 41fc94bac; init hit the PG-down stale-Prisma artifact (api build TS7006 implicit-any on `tx`/etc.) -> fixed with `pnpm db:generate` + rebuild (10/10 GREEN, 0 errors). Confirmed NOT a main breakage.
- 2026-06-21: FAN-OUT PLAN GRADE (2 adversarial opus subagents). BOTH converged on 1 CRITICAL: `getByWorkUnitId` returns nested `{trace,integrity}` not flat -> exporter must read `wt.trace.*` (else enrichment silently never applies in prod while flat fakes green). REVISE round 1 applied: Task 4 reads `wt.trace.*` + `WorkTraceReadLike` dep type + seam tests now assert enrichment lands/absent via setTracer+RecordingTracer. All else PASS (OTel API verified @1.9.1; 2 back-compat startSpan callers; api **tests** glob ok; GenAI keys verbatim-correct; one-directionality/NaN/privacy/layer/stop-globs clean). -> EXECUTE.
- 2026-06-21: EXECUTE done (4 TDD tasks, each RED-proven then GREEN, committed: 23bcf05c0/9b4c6a0f7/16471cd71/9c2341afa). T1 opus (shared iface), T2-T4 sonnet (bounded impl). VERIFY: full gate suite ALL GREEN + independent fresh-context opus review = SHIP (0 sev>=warn). origin/main advanced 41fc94bac->d6bb02ba6 (other sessions, ZERO telemetry-path overlap) -> rebased clean onto d6bb02ba6 (now adb893c00); no prisma change on main so no db:generate. Re-running fast VERIFY subset on the rebased state, then PR + [AUTO] merge (authority: MERGE CLEAN, no SURFACE condition fired). -> CONVERGE.
