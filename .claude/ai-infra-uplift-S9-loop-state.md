# ai-infra-uplift S9 (long-loop context safety) loop — scratch, uncommitted

Durable record: ai-infra-uplift-backlog.md S9 + research f9/f10.

## >>> RESUME POINT <<<

ORIENT done (feasibility: SINGLE bounded testable SURFACE slice). Design LOCKED below. Worktree `.claude/worktrees/ai-long-loop-safety` branch `feat/ai-long-loop-safety`.
Disposition: SURFACE (governance-injector.ts trips `**/*governance*` stop-glob). Mark [S].

Goal (f9/f10): for long multi-turn skill loops, (a) re-state the hardest safety rules in a SHORT reminder near the END of context (recency), and (b) instrument context fill. The MECHANISM is deterministic + testable; the EFFICACY (does recency improve adherence?) is eval-gated (key 401) so rely on the mechanism test + reasoned design (note in PR).
Task-size: standard (one bounded PR; ~4-5 files).

## Ground truth (ORIENT, file:line)

- Skill loop: `skill-executor.ts:332-631` plain `while (turnCount < policy.maxLlmTurns)`. System assembled ONCE before loop: line 279-281 `system = interpolated + "\n\n" + getGovernanceConstraints()`, passed unchanged every turn via callAdapterWithDeadline (367-370). After a tool_use: `messages.push({role:"assistant", content: response.content})` then `messages.push({role:"user", content: toolResults})` -> next turn re-calls. The tool-results user turn is the LAST message before the next model call = the true end of context.
- Hardest-rules text: `governance-injector.ts:1-16` `GOVERNANCE_CONSTRAINTS` ("MANDATORY RULES" — 8 bullets: never claim human, no financial promises, no disparage, offer escalation, no other-customer info, respect opt-out, no fabrication, no pressure; + a TOOL OUTPUT HANDLING structural part). Re-state a CONDENSED subset of the 8 MANDATORY bullets (exclude TOOL OUTPUT HANDLING). `getGovernanceConstraints()` is the existing accessor.
- DeterministicSafetyGateHook is POST-output only (no in-prompt text). The only in-prompt safety text is GOVERNANCE_CONSTRAINTS.
- Token accounting: `skill-executor.ts:311-315` totalInputTokens/totalOutputTokens accumulate; budget check 381-385 `billableTokens = in+out; if > policy.maxTotalTokens throw SkillExecutionBudgetError`. `maxTotalTokens: 64_000` (types.ts:349 DEFAULT_SKILL_RUNTIME_POLICY). No other context-window literal.
- Metrics: `metrics.ts:56-76` Counter-based (skillLlmTokensTotal{model,kind}, llmCacheCallsTotal{model,outcome}). CHECK if a Histogram/Gauge type exists; if only Counter, record context-fill as a Counter near-limit signal.
- Encoder ALREADY handles mixed blocks: `anthropic-tool-adapter.ts:~100-112 encodeOutgoingContent` types `content` internally as `Array<LLMContentBlock | LLMToolResultBlock>` and maps text/tool_use/tool_result (throws on unknown). Only the `LLMMessage.content` TYPE (llm-types.ts:26-29 `string | LLMContentBlock[] | LLMToolResultBlock[]`) forbids a mixed [tool_result, text] array at the push site.
- No existing recency/reminder injection anywhere.

## DESIGN (LOCKED)

1. `governance-injector.ts`: add `export function getSafetyRecencyReminder(): string` — a SHORT (~6-8 line) re-statement of the hardest MANDATORY rules (condensed; not the full block, not TOOL OUTPUT HANDLING). Prefix like "REMINDER (still in effect): ...". (Trips governance stop-glob -> SURFACE.)
2. `llm-types.ts`: broaden `LLMMessage.content` to allow a mixed array. Cleanest: `string | ReadonlyArray<LLMContentBlock | LLMToolResultBlock>` (existing LLMContentBlock[]/LLMToolResultBlock[] are assignable -> backward-compatible). VERIFY no consumer narrows in a way that breaks (typecheck across core/api/chat). If broadening is too broad, instead ADD a member `| Array<LLMTextBlock | LLMToolResultBlock>`.
3. `skill-executor.ts`: when pushing the tool-results turn for a CONTINUING loop (i.e. the model will be called again), append the reminder as a trailing text block: `content: [...toolResults, { type: "text", text: getSafetyRecencyReminder() }]`. This puts the hardest rules at the true end of context every continuation (recency), API-correct (text + tool_result in one user turn is valid). Inject on every tool-results continuation (short reminder, negligible vs 64k budget) OR gate on turnCount>=2 if a reviewer prefers "long only" — decide at impl; default every continuation.
4. Context-fill instrument: add a metric to `metrics.ts` + emit in `skill-executor.ts` after the budget check (385). Prefer a fill-ratio gauge `skillContextFillRatio{model}` if a Gauge/Histogram exists; ELSE a Counter `skillContextNearLimitTotal{model}` incremented when `billableTokens / maxTotalTokens >= 0.8` (a "context filling up" alert signal). Record per turn (or at loop end with the max ratio). Keep it side-effect-only.

## TDD plan (RED first)

- S9.1 governance-injector.test: getSafetyRecencyReminder returns the condensed hardest rules (contains "human"/"opt-out"/"financial"; excludes TOOL OUTPUT HANDLING); is shorter than the full GOVERNANCE_CONSTRAINTS.
- S9.2 skill-executor (or adapter) test: a 2-turn loop (tool_use then end_turn) -> the SECOND call's messages include a user turn whose content has the reminder text block appended after the tool_result(s); a 1-turn loop (immediate end_turn) -> NO reminder injected. (Assert via the adapter mock's received messages.)
- S9.3 adapter encode test: a user turn with [tool_result, text] encodes both blocks (if not already covered by an existing encode test).
- S9.4 metrics test: the context-fill instrument records (near-limit increment when ratio>=0.8, or the gauge observes the ratio).
- Confirm no existing skill-executor/adapter test breaks from the content-type broadening.

## VERIFY gates (delegate)

typecheck; `--filter @switchboard/core test`; (api/chat if the content-type broadening touches them); lint; format:check; arch:check; verify-fast; build. NO db/schema. NO new env var. Eval = mechanism is deterministic; efficacy eval-gated (key 401) -> rely on mechanism tests + reasoned design + CI eval (non-regression: the reminder is additive safety text, must not change tool/decision outputs). Independent fresh-context opus review (diff + criteria + lessons: feedback_skill_runtime_two_constraint_regimes, feedback_inngest_step_state_json_only [N/A], feedback_no_em_dashes [reminder copy]). KEY review focus: the mixed-content broadening doesn't break the tool-call protocol/encoder; the reminder is additive (no behavior change to tool selection); recency injection is API-correct.

## CONVERGE

SURFACE (governance-injector stop-glob). PR notes: mechanism delivered + tested; efficacy is eval-gated (key 401) so not live-validated; reminder is additive safety text (non-regression). Mark backlog S9 [S]. Then ALL S-slices done -> proceed to decompose epics E1-E5 (mark each [D], write decomposition to scratch), then FINAL summary.

## Log

- 2026-06-20: ORIENT (Explore) done, feasibility = bounded SURFACE slice. Design locked. Next: EXECUTE in fresh worktree (verify the LLMMessage.content broadening typechecks across consumers first).
