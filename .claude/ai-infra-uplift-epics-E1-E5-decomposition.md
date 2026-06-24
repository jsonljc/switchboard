# AI-infra uplift — deferred epics E1-E5 decomposition (scratch, uncommitted)

Per the build-loop [DEFER-EPIC] rule: each is multi-slice; STOPPED + decomposed here, marked [D] in the backlog. Do NOT build without a human go-ahead (each is L-effort and/or beta-API / cross-layer-architecture). Grounded in the codebase facts learned across S1-S9 + the research doc (f1, f5, f6, f11, f21).

---

## E1 — Durable mid-loop approval parking (f6). L-effort.

GOAL: let the skill tool loop SUSPEND mid-tool-call when governance returns `pending_approval`, persist its state, and RESUME after a human approves, instead of the current synchronous loop that cannot park-and-resume.
GROUND TRUTH: `skill-executor.ts` `execute()` is a synchronous `while (turnCount < maxLlmTurns)` loop; `GovernanceHook` (beforeToolCall) can return `pending_approval` but the loop has no suspend/resume — it just substitutes a pending result and continues. The creative-pipeline ALREADY does durable pause/resume via Inngest `waitForEvent` (creative-job-runner). KEY CONSTRAINT: core (Layer 3) cannot import Inngest (Layer 2) — so this is a NEW architectural integration, not a config flip. Inngest step state is JSON-only (class instances lose methods on replay — feedback_inngest_step_state_json_only); the skill-runtime has TWO constraint regimes and governance constraints don't reach the executor (feedback_skill_runtime_two_constraint_regimes), and mid-loop approval parking is currently unrepresentable.
DECOMPOSITION:

- E1a (design + spec, land on main): the durable-execution model for the skill loop — where the suspend boundary is (beforeToolCall pending_approval), what state must serialize (messages, toolCallRecords, turnCount, profile, budget counters — all JSON-safe; no class instances), the resume trigger (approval event), and the layer bridge (an apps/api Inngest function drives a core executor that exposes a resumable step interface, NOT core importing Inngest). Idempotency keys on money/mutating tools must survive resume (durable steps give exactly-once STEP, not exactly-once vs external APIs).
- E1b: make the executor state serializable + add a resumable entry point (execute-from-checkpoint) in core, pure (no Inngest).
- E1c: the apps/api Inngest wrapper that persists the checkpoint on pending_approval, waitForEvent(approval), and resumes via E1b.
- E1d: wire the approval event to emit the resume signal; e2e test the park->approve->resume path.
  BLOCKERS: cross-layer architecture; durable-execution semantics; high-stakes (money tools across a suspend). Needs design sign-off.

---

## E2 — Context editing (`clear_tool_uses`) (f1). Beta.

GOAL: for long loops, use Anthropic context editing (`clear_tool_uses_20250919`) to drop stale tool_use/tool_result blocks from context instead of the current hard-throw at the token budget.
GROUND TRUTH: `skill-executor.ts:382` hard-throws `SkillExecutionBudgetError` when billableTokens > maxTotalTokens (64k). S9 just added `skillContextFillRatio` instrumentation — the precursor signal for WHEN to clear. The call layer is `anthropic-tool-adapter.ts`. KEY CONSTRAINT: it is a BETA API; and clearing tool uses INVALIDATES the cached prefix (the cache-invalidation tradeoff) — must weigh against S1's prompt-cache work. Also the client-side memory tool (`memory_20250818`) is the paired feature.
DECOMPOSITION:

- E2a (design): the clear policy — when to clear (driven by skillContextFillRatio crossing a threshold), what to preserve (recent turns + the S9 safety reminder + the system prefix), and the cache tradeoff (clearing busts the cache, so clear in batches, not every turn).
- E2b: thread `context_management: {edits:[{type:"clear_tool_uses_...", ...}]}` into the tool-adapter messages.create behind a default-off flag (flag-gated-control + producer-population lessons); generation/beta-gate it.
- E2c: replace the hard-throw with clear-then-continue when editing is enabled (keep the hard-throw as the backstop).
  BLOCKERS: beta API (stability); cache-invalidation vs S1; needs eval validation (needs a live key — currently 401).

---

## E3 — Tool search (`defer_loading`) (f11).

GOAL: when the tool surface outgrows the context budget, let the model search/load tool definitions on demand (`defer_loading`) instead of sending every tool definition every call.
GROUND TRUTH: `anthropic-tool-adapter.ts` builds the full tool manifest each call; S1 added deterministic ordering + a `cache_control` breakpoint on the LAST tool. KEY CONSTRAINT: `defer_loading` CANNOT combine with `cache_control` on the SAME tool, and at least one tool must stay non-deferred — so it directly conflicts with S1's cache breakpoint placement and must be reconciled. Only worth it once the tool count is large (today the per-skill tool set is small).
DECOMPOSITION:

- E3a (trigger analysis): measure tool-definition token weight; confirm it's actually a budget problem (it may not be yet — defer until the tool surface is large; this is a "watch/adopt when triggered" P2 item).
- E3b: split tools into deferred vs non-deferred sets; move the cache_control breakpoint to a non-deferred tool; mark the rest defer_loading.
- E3c: verify cache effectiveness (the S1 recordLlmCacheEffectiveness signal) doesn't regress.
  BLOCKERS: conflicts with S1 caching; only triggered at scale (likely premature now).

---

## E4 — OTel GenAI spans derived one-directionally from WorkTrace (f21).

GOAL: emit OpenTelemetry GenAI spans for LLM calls / tool calls, derived ONE-DIRECTIONALLY from WorkTrace (WorkTrace stays canonical; OTel is a read-only projection).
GROUND TRUTH: WorkTrace (`platform/work-trace.ts`) is the canonical record (governance/outcome); ExecutionTrace.toolCalls holds the tool sequence (see S6 decomposition). Telemetry today is Prom counters/histograms (`telemetry/metrics.ts`). KEY CONSTRAINT: must be one-directional (derive spans FROM WorkTrace/ExecutionTrace; never let OTel become a second source of truth). Follow-on to the S6 trajectory work (the queryable ordered tool-call sequence).
DECOMPOSITION:

- E4a: DONE — satisfied by S6a (`findByWorkUnitId`, the ordered per-work-unit tool-call query surface).
- E4b: DONE/MERGED 2026-06-21 PR #1213 (`a49f97cbe`) — pure core `projectWorkUnitSpans` (work-unit->execution->tool parented GenAI-span tree, read-only/one-directional) + `Tracer.startSpan(...,parent?)` honored in the OTel adapter + thin flag-gated apps exporter (reuses `OTEL_EXPORTER_OTLP_ENDPOINT`). Two independent opus reviews SHIP; a deep post-merge review verified parenting against the real OTel SDK source.
- E4c **SLICE 1 (the timeline/quality fix) DONE/MERGED 2026-06-21 — PR #1220 (squash `3e6031623`):** all three E4b deep-review follow-ups below are SHIPPED (span timing + SpanKind; cache/cost attrs; the minor guards + barrel re-export + provider). Honest timing model: work-unit = REAL requestedAt/completedAt; execution/tool = DERIVED/sequential-packed, marked `switchboard.timing.synthetic=true`; missing anchors degrade. Telemetry-only [AUTO]; TDD; all required CI green; independent opus review SHIP. State: `.claude/ai-infra-uplift-E4c-loop-state.md`. **SLICE 2 (the LIVE TRIGGER — call `exportWorkUnitSpans` after a work unit completes + a real OTLP export + any dedicated enable-flag) REMAINS = SURFACE** (touches ingress submit path / env-allowlist); design fork + safety in `.claude/ai-infra-uplift-E4c-slice2-plan.md`.
- E4c follow-ups carried from E4b (NOW SHIPPED in slice 1):
  - (Important) **Span timing + SpanKind**: E4b emits a structurally-correct but TEMPORALLY-FLAT tree (spans created+ended at projection time -> ~0ms wall-clock; a Jaeger/Tempo waterfall is unusable). The structural + governance value is delivered; the timeline is not. Fix = extend `Tracer.startSpan` with `options?: { startTime?; kind? }` + `Span.end(endTime?)`, then synthesize start/end offsets from the persisted `durationMs` (parent T0; lay executions/tool-calls relative). This needs the interface change + a live backend to validate -> belongs here, not E4b.
  - (Important) **Cache/cost attributes dropped**: the E4b mapper omits `tokenUsage.cacheRead/cacheCreation/costUsd`. Widen `ExecutionTraceRow.tokenUsage` + add `gen_ai.usage.cache_read_input_tokens`/`cache_creation_input_tokens` on the exec span (semconv 1.40.0 has them). High value given S1's cache-effectiveness work.
  - (Minor) guard the root `switchboard.work_unit.id` with `setIfString` (the one unguarded always-set attr); re-export `OTelContextBridge` from the core telemetry barrel; consider `gen_ai.system="anthropic"`/`gen_ai.provider.name` on the exec span; optional explicit SpanKind.
    BLOCKERS: new env var (-> env-allowlist stop-glob -> SURFACE); the live-trigger placement (where to call exportWorkUnitSpans); a real OTLP collector to validate the timeline end-to-end. E4c is its own build-loop slice.

---

## E5 — Native citations for provenance (f5).

GOAL: use Anthropic native citations so model claims carry provenance (the receipt/north-star), e.g. for the proof-quality / report surfaces.
GROUND TRUTH: the report LLM call is `reports/pull-quote-generator.ts` (single call); structured-output extraction is `structured-output.ts`. KEY CONSTRAINT: native citations are INCOMPATIBLE with structured outputs per call (choose one per call) — and S5 just adopted strict/structured tool schemas, so citations can only go where structured output is NOT used. Scope to the provenance-critical surfaces (report narrative / receipts), not the tool/decision path.
DECOMPOSITION:

- E5a (surface selection): identify the provenance-critical generation surfaces that do NOT need structured output (likely the report narrative, not the classifier/tools).
- E5b: enable `citations` on those calls with document sources; thread the returned citation spans into the report/receipt.
- E5c: surface citations in the dashboard report UI.
  BLOCKERS: incompatible with structured outputs (mutually exclusive per call); needs a citation-bearing source corpus; UI work.

---

## Cross-cutting note

E2/E5 need live-API/eval validation (blocked by the 401 CI ANTHROPIC_API_KEY, same as S5/S7/S9 efficacy). E4 depends on S6a (the WorkTrace query surface). E1 is the heaviest (cross-layer durable execution). All are correctly DEFERRED; none is a single bounded PR. Recommend prioritizing by leverage: S6a+E4 (observability), then E1 (approval parking) after a design sign-off.
