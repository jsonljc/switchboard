# ai-infra-uplift S4 (adaptive thinking + effort dial) loop — externalized state (scratch, uncommitted)

Durable record: ai-infra-uplift-backlog.md S4 + reference_ai_landscape_research_2026_06.md (f3).

## >>> RESUME POINT <<<

ORIENT + DESIGN complete (this file). If resuming: design is LOCKED below — do NOT re-derive. Go to EXECUTE.
Worktree to create (fresh, off origin/main): `.claude/worktrees/ai-adaptive-thinking` branch `feat/ai-adaptive-thinking`.

Goal: add adaptive-thinking (`thinking:{type:"adaptive",display:"summarized"}`) + native effort dial (`output_config:{effort}`) to the agent-runtime call layer, wired on the CRITICAL tier behind a default-off env flag, generation-gated so it is a no-op until the critical model bumps to 4.7+. Forward-compat infra (like S1's sampling guard). Authority: SURFACE (new env var trips the allowlist merge-stop glob).
Task-size: standard (one bounded PR, ~6 files).

## Ground truth (from ORIENT, file:line)

- Critical tier = `claude-opus-4-6` (gen 4.6) — model-router.ts SLOT_CONFIGS. 4.6 does NOT support adaptive thinking/effort (those are 4.7+; see f3 "after the model bump"). So feature is INERT today by design.
- SDK installed = 0.91.1 (decl ^0.82.0). Fully types `thinking:{type:"adaptive",display:"summarized"}` (ThinkingConfigAdaptive, messages.d.ts:977) + `output_config:{effort:'low'|'medium'|'high'|'xhigh'|'max'|null}` (OutputConfig, messages.d.ts:708). NO cast/bump needed.
- Agent-runtime adapter `packages/core/src/agent-runtime/anthropic-adapter.ts`: builds messages.create; gets full `ModelConfig` (slot-aware). DEFAULT_MODEL claude-sonnet-4-6. **BUG to fix:** line 66 `response.content[0]?.type === "text" ? ... : ""` reads only block[0]; with thinking enabled a thinking block is FIRST -> empty reply. Must find the text block.
- Skill-runtime adapter (anthropic-tool-adapter.ts) takes a `profile` WITHOUT slot -> NOT slot-aware -> OUT OF SCOPE for critical-tier wiring (in-scope narrowing; note in PR).
- model-router.ts: `ModelSlot = "default"|"premium"|"critical"|"embedding"`; ModelConfig{slot,modelId,maxTokens,temperature,timeoutMs,fallbackSlot?}; has parseClaudeGeneration + modelSupportsSamplingParams (S1). ModelRouter constructed via `new ModelRouter()` in apps/api/src/bootstrap/model-router-factory.ts (gated by ALEX_MODEL_ROUTER_ENABLED==="true").
- Flag pattern: read env at bootstrap (apps/api), thread as config into core (core stays env-free + testable). New env var MUST be added to scripts/env-allowlist.local-readiness.json `required_in_env_example` (+ .env.example) or check-env-completeness CI fails. (feedback_new_env_var_needs_allowlist)
- Evals (eval:alex-conversation, eval:classifier) need live ANTHROPIC_API_KEY + run on 4.6 -> CANNOT validate adaptive behavior here. Default-off path is byte-identical -> evals are NON-REGRESSION by construction (assert + rely on CI eval gate). Do NOT flip a default model.

## Approaches considered (brainstorming)

- A (CHOSEN): thread adaptive config through ModelConfig (router-owned), gate at adapter on generation. Slot-aware, core env-free, testable, fail-safe. Touches model-router + factory + adapter.
- B (rejected): adapter reads process.env directly -> wrong layer (core reading env), tests become env-dependent (vi.stubEnv masks bugs per feedback_next_public_dynamic_env_not_inlined sibling concern).
- C (rejected): generic capability on BOTH adapters + extend skill-runtime profile -> more surface; skill-runtime is slot-unaware and not the critical-tier consumer. YAGNI.

## DESIGN (LOCKED)

1. `packages/core/src/model-router.ts`:
   - `export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";`
   - `export function modelSupportsAdaptiveThinking(modelId: string): boolean` — sibling/complement of modelSupportsSamplingParams: parseClaudeGeneration; `!gen -> false` (fail-safe: never send a new-gen-only param to an unknown id, preserves current behavior); `family==="fable" -> true`; `major>4 -> true`; `major===4 && minor>=7 -> true`; else `false`. (4.6 -> false, 4.7/4.8/fable -> true, unknown -> false.)
   - ModelConfig gains `adaptiveThinking?: boolean;` + `effort?: ReasoningEffort;`.
   - ModelRouter constructor: `constructor(options?: { criticalAdaptiveThinking?: boolean; criticalEffort?: ReasoningEffort })` store on private fields. Where critical-slot ModelConfig is produced (resolve/resolveTier reading SLOT_CONFIGS.critical), merge `...(this.criticalAdaptiveThinking ? { adaptiveThinking: true, effort: this.criticalEffort ?? "high" } : {})`. ONLY the critical slot. (Confirm exact production site when implementing; likely a helper that clones SLOT_CONFIGS[slot].)
2. `apps/api/src/bootstrap/model-router-factory.ts`: `const adaptive = process.env.CRITICAL_ADAPTIVE_THINKING_ENABLED === "true";` pass `new ModelRouter({ criticalAdaptiveThinking: adaptive })`. (effort fixed at "high" default; no second env var — YAGNI.)
3. `packages/core/src/agent-runtime/anthropic-adapter.ts`:
   - In messages.create body add: `...(modelConfig?.adaptiveThinking && modelSupportsAdaptiveThinking(model) ? { thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: modelConfig.effort ?? "high" } } : {})`. (Composes with S1 temperature gate: on 4.7+, modelSupportsSamplingParams=false -> no temperature, modelSupportsAdaptiveThinking=true -> thinking sent. No conflict.)
   - Fix reply extraction: `const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";` (skip thinking blocks).
4. `scripts/env-allowlist.local-readiness.json` (+ `.env.example`): add `CRITICAL_ADAPTIVE_THINKING_ENABLED` to `required_in_env_example`.

## TDD plan (RED first each)

- S4.1 model-router.test: modelSupportsAdaptiveThinking truth table (opus-4-6 false; opus-4-8 true; sonnet-4-7 true; claude-fable-5 true; garbage false). RED: not-a-function.
- S4.2 model-router.test: `new ModelRouter({criticalAdaptiveThinking:true})` -> resolved CRITICAL config has adaptiveThinking===true + effort==="high"; resolved PREMIUM/DEFAULT config has adaptiveThinking undefined; `new ModelRouter()` (no opt) -> critical config adaptiveThinking undefined. RED: field missing. (Find the resolve API to get a critical config — likely resolveTier with escalation, or resolve with a stage.)
- S4.3 anthropic-adapter.test: with modelConfig {slot:critical, modelId:"claude-opus-4-8", adaptiveThinking:true, effort:"high"} -> body has thinking {type:"adaptive",display:"summarized"} + output_config {effort:"high"} AND NO temperature. RED: absent.
- S4.4 anthropic-adapter.test: with modelConfig {modelId:"claude-opus-4-6", adaptiveThinking:true} -> body has NO thinking/output_config (gen-gated) BUT temperature present (4.6). RED-ish (guards the gate). And adaptiveThinking falsy/undefined -> no thinking.
- S4.5 anthropic-adapter.test: response.content = [ {type:"thinking",...}, {type:"text",text:"hi"} ] -> generateReply returns reply "hi" (not ""). RED: current code returns "" (reads block[0]).
- Update shared adapter test mock `createMock` to include `usage` (already done in S1) — reuse.

## VERIFY gates (delegate)

typecheck; `--filter @switchboard/core test`; `--filter @switchboard/api test` (factory changed); lint; format:check; arch:check; `CI=1 npx tsx scripts/local-verify-fast.ts` (THIS catches the new env-var allowlist debt); build (api changed); NO db:check-drift. Eval = non-regression by construction (default-off byte-identical) + CI eval gate. Then independent fresh-context opus review (diff + criteria + lessons: feedback_new_env_var_needs_allowlist, feedback_safety_gate_needs_producer_population, feedback_model_routing_by_phase, feedback_anthropic_strict_tool_schema_no_minmax). Non-self-gradable.

## CONVERGE

SURFACE (new env var -> allowlist merge-stop glob). Open PR, mark backlog S4 [S], proceed to S5. Do NOT auto-merge.

## >>> OUTCOME 2026-06-20: STOPPED + DECOMPOSED (blocked on the 4.7+ model bump) <<<

EXECUTE was done on branch `feat/ai-adaptive-thinking` @ commit `6a7a2a933` (local only, NOT pushed; worktree torn down — the commit is preserved on the local branch for resume). The independent fresh-context opus review returned **CRITICAL / REVISE**, and verifying it exposed that S4 is genuinely multi-slice and blocked. Do NOT resume as a single PR.

WHY (verified ground truth):

- The implementation wired the AGENT-RUNTIME adapter (`generateReply`), but that is a DEAD PATH for the critical tier: its production callers (RuntimeLLMProvider context-builder.ts:82, chat gateway-bridge.ts:108) pass NO modelConfig, so the gate is always false.
- The REAL critical-tier path is the SKILL-RUNTIME tool loop: `SkillExecutorImpl.resolveProfile()` (skill-executor.ts:209-216) resolves the critical ModelConfig but builds a `ResolvedModelProfile` of only {model,maxTokens,temperature,timeoutMs}, DROPPING adaptiveThinking/effort, then calls `AnthropicToolAdapter.chatWithTools` (unmodified). So the flag is inert-forever (the "stored-but-never-wired illusion" lesson), not inert-until-bump.
- Correctly wiring the skill tool-loop with `display:"summarized"` (the backlog's operator-visible-reasoning ask) needs the THINKING-BLOCK LIFECYCLE: `LLMContentBlock` (llm-types.ts:16) has no thinking variant; the adapter THROWS `LLMAdapterShapeMismatchError` on unknown blocks (anthropic-tool-adapter.ts:221); and Anthropic REQUIRES thinking blocks (with signature) to round-trip in the assistant turn that used a tool, or the next request 400s. That is a core-contract change to the provider-neutral type system + encode/decode.
- UNTESTABLE now: adaptive thinking + effort are 4.7+ features; the critical slot is claude-opus-4-6 (4.6). S4's own acceptance criterion ("validate against eval:alex-conversation + eval:classifier") cannot be exercised until the critical model is 4.7+. Research roadmap item 6 explicitly says "after the model bump." Confidence in an unvalidatable model-behavior + tool-loop integration is LOW -> build-loop STOP condition.

DECOMPOSITION (resume after the critical slot bumps to a 4.7+ id):

- 4a (infra, bounded, but INERT alone -> do NOT ship standalone, it is an illusory control): the predicate `modelSupportsAdaptiveThinking` + `ReasoningEffort` + ModelConfig adaptiveThinking?/effort? + ModelRouter ctor option + factory flag CRITICAL_ADAPTIVE_THINKING_ENABLED + env allowlist/.env.example. This is what is on branch 6a7a2a933 (MINUS the dead-path agent-runtime emit). Ship ONLY bundled with 4b.
- 4b (the substantive slice; do at/after the bump): thread adaptiveThinking/effort through ResolvedModelProfile (types.ts) + resolveProfile (skill-executor.ts) + chatWithTools profile (llm-types.ts ToolCallingLLMAdapter + anthropic-tool-adapter.ts impl); emit thinking+output_config in AnthropicToolAdapter gated on profile.adaptiveThinking && modelSupportsAdaptiveThinking(model). DESIGN DECISION REQUIRED: `display:"summarized"` (backlog ask; needs the full thinking-block lifecycle above) vs `display:"omitted"` (no thinking blocks returned -> no round-trip, safe in the loop, but drops operator-visible reasoning). Validate on a live 4.7+ critical model.
- The standalone agent-runtime reply-extraction fix (find text block vs content[0]) is also inert today (no thinking on the default sonnet-4-6 path); fold it into 4b rather than shipping separately.

## Log

- 2026-06-20: ORIENT (Explore) + brainstorming design LOCKED. Found response-parser bug (line 66) as a required sub-fix. EXECUTE on branch feat/ai-adaptive-thinking @ 6a7a2a933 (model-router predicate+fields+ctor, agent-runtime emit+extraction, factory flag, env). Local gates GREEN (build/typecheck/core 4323/api 2240/lint 0-err/format/arch/verify-fast).
- 2026-06-20: Independent opus review = CRITICAL/REVISE (dead-path wiring). Verified: real path is skill-runtime tool loop; display:summarized needs thinking-block lifecycle (core-contract change); untestable on 4.6. STOPPED + decomposed (4a/4b), blocked on the 4.7+ model bump. Worktree torn down; branch kept locally for resume. Backlog S4 -> [B].
