# ai-infra-uplift S1 (call-layer hardening) loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note reference_ai_landscape_research_2026_06.md (+ ai-infra-uplift-backlog.md S1).

## >>> RESUME HERE (PAUSED 2026-06-19 mid-EXECUTE; user restarting machine) <<<

Trigger word "fetch" -> read THIS file, then continue from "Remaining work" below.

- Worktree: `/Users/jasonli/switchboard/.claude/worktrees/ai-calllayer-hardening` Branch: `feat/ai-calllayer-hardening` Base: origin/main @ b432c0acf
- All edits are saved to DISK in the worktree (survive restart; nothing committed yet — `git diff origin/main...HEAD` is empty, work is in the working tree).
- ENV gotcha already resolved this session: worktree:init skipped Prisma (DB down). Ran `pnpm install` + `pnpm db:generate` + full `pnpm build`. Baseline `pnpm typecheck` = 21/21 GREEN. If a fresh session sees implicit-`any`/Prisma errors, re-run `pnpm db:generate` from the worktree (NOT a real bug).
- First step on resume: `cd` to the worktree; confirm `git branch --show-current` = feat/ai-calllayer-hardening; re-fetch origin/main + re-check the 6 already-edited files didn't get clobbered (`git status --short`).

Goal: NON-governance Claude call-layer hardening — (1) per-call prompt-cache effectiveness telemetry + zero-read alert; (2) deterministic tool-manifest ordering (sort by name) so a reorder can't bust the cached prefix; (3) model-generation-aware sampling params (omit temperature/top_p/top_k for 4.7+ ids; no-op on 4.6).
Authority: AUTONOMOUS-WITH-GUARDRAILS (skip FRAME if mechanical; TDD RED proof; full VERIFY; independent non-self-graded review; merge only if no stop-glob + clean review, else SURFACE).
Task-size: standard. Base: origin/main @ b432c0acf baseline_sha: b432c0acf
merge_safety: stop-glob touched=NO (telemetry/adapters/router/reports + api+chat metric factories; governance classifier EXCLUDED=S2; no env/route allowlist; no new env var; apps/chat metric file is NOT a _send_ path) independent_review=SHIP (opus, fresh-context, zero >=warn; 1 nit=unreachable NaN guard, declined)

## DONE so far (GREEN, on disk in worktree)

- C3 predicate: `modelSupportsSamplingParams()` + internal `parseClaudeGeneration()` in `packages/core/src/model-router.ts`. Test `src/__tests__/model-router.test.ts` GREEN (29/29). RED was proven first.
- C1 telemetry primitive: `recordLlmCacheEffectiveness()` + `type LlmCacheOutcome` + `llmCacheCallsTotal: Counter` in `packages/core/src/telemetry/metrics.ts` (interface + createInMemoryMetrics). Field also added to BOTH `createPromMetrics()`: `apps/api/src/metrics.ts` + `apps/chat/src/bootstrap/metrics.ts`. Test `src/telemetry/__tests__/metrics.test.ts` GREEN (11/11). RED proven first.
- C2 + tool-adapter wiring TESTS WRITTEN + RED-confirmed (4 fail for the right reason) in `src/skill-runtime/__tests__/anthropic-tool-adapter.test.ts` (added: deterministic-ordering describe, sampling-param describe, cache-recording describe; added file-level beforeEach stubbing console.warn; imports orderToolsForCache + createInMemoryMetrics/setMetrics). 30 pass / 4 RED. IMPL NOT YET WRITTEN.

## REMAINING WORK (apply in order; each is fully designed below — do NOT re-derive)

### R1 — IMPLEMENT tool adapter `packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts` -> turns the 4 RED tests GREEN

Add imports (top, after the llm-types import):
import { modelSupportsSamplingParams } from "../../model-router.js";
import { recordLlmCacheEffectiveness } from "../../telemetry/metrics.js";
Add exported helper (place before `export class AnthropicToolAdapter`):
/\*\* Order tools deterministically by ENCODED wire name so the cached tool-defs

- prefix is byte-stable across boots (caching is a strict byte prefix match; a
- varying order silently busts it). Sorts a COPY. Exported for the test. \*/
  export function orderToolsForCache(tools: LLMToolDefinition[]): LLMToolDefinition[] {
  return [...tools].sort((a, b) => {
  const ea = encodeToolName(a.name);
  const eb = encodeToolName(b.name);
  return ea < eb ? -1 : ea > eb ? 1 : 0;
  });
  }
  In `chatWithTools`, near top of method add: `const model = params.profile?.model ?? DEFAULT_MODEL;`
  Replace the `params.tools.map((t, i) => ...)` block (currently maps params.tools in input order, cache_control on last) with an ordered copy: `const orderedTools = orderToolsForCache(params.tools);` then map `orderedTools` (use `orderedTools.length` and `i === orderedTools.length - 1` for the cache_control breakpoint).
  In the `messages.create` body: `model: params.profile?.model ?? DEFAULT_MODEL,` -> `model,`; and replace `temperature: params.profile?.temperature ?? DEFAULT_TEMPERATURE,` with:
  ...(modelSupportsSamplingParams(model)
  ? { temperature: params.profile?.temperature ?? DEFAULT_TEMPERATURE }
  : {}),
  Right AFTER `const response = await this.client.messages.create(...)`, add:
  recordLlmCacheEffectiveness({
  model,
  cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
  cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
  });
  In the return object: `model: params.profile?.model ?? DEFAULT_MODEL,` -> `model,`.
  VERIFY: `pnpm --filter @switchboard/core exec vitest run src/skill-runtime/__tests__/anthropic-tool-adapter.test.ts` -> expect 34/34 GREEN.

### R2 — agent-runtime adapter `packages/core/src/agent-runtime/anthropic-adapter.ts` (TDD: write test RED first)

TEST first in `src/agent-runtime/__tests__/anthropic-adapter.test.ts`:
(a) update the shared `createMock` (lines ~5-7) resolved value to include usage so the new cache-recording emits populate (no warn) and reads cleanly:
usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 20 }
(b) add an omit-temp test (RED before impl):
it("omits temperature for a 4.7+ model id (forward-compat; avoids the hard-400)", async () => {
const adapter = createAnthropicAdapter("test-key");
await adapter.generateReply(makePrompt(), { slot: "critical", modelId: "claude-opus-4-8", maxTokens: 2048, temperature: 0.5, timeoutMs: 10000 });
const callArgs = createMock.mock.calls[0]![0];
expect("temperature" in callArgs).toBe(false);
});
(existing "uses modelConfig when provided" test, opus-4-6 temp 0.5, already covers the keep-temp-on-4.6 case.)
IMPL: add `import { modelSupportsSamplingParams } from "../model-router.js";` (already imports `type { ModelConfig }` from there) + `import { recordLlmCacheEffectiveness } from "../telemetry/metrics.js";`. In generateReply: `const model = modelConfig?.modelId ?? DEFAULT_MODEL;`, then build create as:
const response = await client.messages.create({
model,
max_tokens: modelConfig?.maxTokens ?? DEFAULT_MAX_TOKENS,
...(modelConfig?.temperature !== undefined && modelSupportsSamplingParams(model)
? { temperature: modelConfig.temperature }
: {}),
system: buildSystemContent(prompt),
messages,
});
recordLlmCacheEffectiveness({
model,
cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
cacheCreationTokens: response.usage?.cache_creation_input_tokens ?? 0,
});
(NOTE optional chaining `response.usage?.` — other agent-runtime test mocks may omit usage; `no-unnecessary-condition` is NOT enabled so it's lint-safe.)
VERIFY: `pnpm --filter @switchboard/core exec vitest run src/agent-runtime/__tests__/anthropic-adapter.test.ts` GREEN.

### R3 — pull-quote report client `packages/core/src/reports/pull-quote-generator.ts` (4th non-gov call site; same latent-400; completeness)

Add `import { modelSupportsSamplingParams } from "../model-router.js";`. In the narrow `AnthropicLikeCtor` type, relax `temperature: number;` -> `temperature?: number;`. In the create call replace `temperature: REPORT_LLM_TEMPERATURE,` with:
...(modelSupportsSamplingParams(REPORT_LLM_MODEL)
? { temperature: REPORT_LLM_TEMPERATURE }
: {}),
REPORT_LLM_MODEL = "claude-haiku-4-5-20251001" (4.5 -> supports -> temperature 0.4 STILL sent -> pure no-op). Confirm `src/reports/pull-quote-generator.test.ts` still GREEN (it inspects create.mock.calls[0][0] ~line 287). No new test required (omit-case unit-tested in model-router.test).

### R4 — VERIFY (delegate gate-run to a fresh subagent; return compact per-gate booleans + only failing excerpt)

Gates from worktree root: `pnpm typecheck`; `pnpm --filter @switchboard/core test`; `pnpm --filter @switchboard/api test`; `pnpm --filter @switchboard/chat test` (interface field forces api+chat); `pnpm lint`; `pnpm format:check`; `pnpm arch:check`; `CI=1 npx tsx scripts/local-verify-fast.ts`; `pnpm build`; `pnpm audit --audit-level=high`. NO db:check-drift (no schema). Evals eval:classifier + eval:alex-conversation = NON-REGRESSION: changes are provably behavior-neutral on 4.6 (temp identical, ordering semantically-neutral, telemetry side-effect-only) so eval RESULTS cannot regress — run only if ANTHROPIC_API_KEY available cheaply, else rely on reasoned non-regression + CI eval-classifier.
Then INDEPENDENT fresh-context review (subagent, model opus): hand ONLY `git diff origin/main...HEAD` + the acceptance criteria + lessons (feedback_anthropic_strict_tool_schema_no_minmax, feedback_model_routing_by_phase). NON-self-gradable. Triage findings via superpowers:receiving-code-review.

### R5 — CONVERGE

Pre-merge divergence re-check (re-fetch origin/main; `git diff origin/main...HEAD` clean-applies; `gh pr list` + `git worktree list`). Merge-stop glob recheck on the FINAL diff (expect NONE). AUTONOMOUS: if review zero findings>=warn + all gates green + no stop-glob -> commit (lowercase conventional subject, no em-dash, end with the Co-Authored-By trailer) + squash-merge. Else SURFACE the PR. Update ledger + ai-infra-uplift-backlog.md S1 -> [x] or [S]. Remove worktree after merge. Consider a feedback\_\*.md lesson if a durable gotcha emerged.

## Plan steps

| step                                                       | done-condition (test/cmd)           | RED proof                      | status          | evidence                                  |
| ---------------------------------------------------------- | ----------------------------------- | ------------------------------ | --------------- | ----------------------------------------- |
| S1.1 modelSupportsSamplingParams predicate                 | model-router.test truth table       | YES (TypeError not a function) | DONE            | vitest 29/29 GREEN                        |
| S1.4 recordLlmCacheEffectiveness + counter (core+api+chat) | metrics.test hit/populate/miss+warn | YES (spyOn undefined counter)  | DONE            | vitest 11/11 GREEN                        |
| S1.3 orderToolsForCache + wire                             | adapter test ordering/temp/cache    | YES (4 RED, inc 0 calls)       | DONE (R1)       | vitest 34/34 GREEN                        |
| S1.2 adapters+pull-quote omit temp for 4.7+                | adapter+agent+pull-quote tests      | YES (adapter+agent RED)        | DONE (R1/R2/R3) | tool 34/34, agent 10/10, pull-quote 19/19 |
| S1.5 agent-runtime + pull-quote cache+temp                 | agent/pull-quote tests              | YES (agent 2 RED)              | DONE (R2/R3)    | agent 10/10, pull-quote 19/19             |

gate_results (post-impl, post-rebase onto origin/main 75060567e): typecheck=21/21 test=core:4309pass/api:2237pass/chat:338pass lint=0err/82warn(preexisting) format=PASS arch=PASS verify-fast=6/6 build=10tasks security=audit-exit0(no new deps) eval=skipped(non-regression by construction) review=SHIP(opus,fresh-context,0>=warn)
carry_forward (<=150 words): SCOPE NOTE for reviewer/PR: slice named 3 files; I added (a) pull-quote-generator.ts (4th non-gov messages.create with temperature — same latent-400, fixed for completeness via shared predicate; no-op on its 4.5 model) and (b) api+chat createPromMetrics (FORCED by adding llmCacheCallsTotal to the SwitchboardMetrics interface — consumer-update lesson). EXCLUDE governance/classifier/anthropic-classifier.ts (=S2, governance stop-glob). C1 cache token TOTALS already existed via skillLlmTokensTotal{kind=cache_read|cache_creation} (per-execution); my add is the per-CALL effectiveness signal (hit/populate/miss + zero-read warn), the genuine gap from research f2. Independent review is MANDATORY + non-self-gradable.

## Log

- 2026-06-19: ORIENT complete. Base rebaselined 1f54bc7cf->b432c0acf (#1176, 0 target files). Worktree env fixed (Prisma generate). Baseline typecheck 21/21. Found 4th call site (pull-quote) + interface-consumer fan-out (api+chat). Scope mechanical -> skipped FRAME.
- 2026-06-19: EXECUTE. C3 predicate RED->GREEN (29/29). C1 telemetry RED->GREEN (11/11) incl api+chat factories. Adapter tests written + RED (4 fail). PAUSED before adapter impl at user request (machine restart). Resume at R1.
- 2026-06-20: RESUMED. R1 tool-adapter RED re-confirmed (4) -> impl -> GREEN (34/34). R2 agent-runtime TDD: wrote omit-temp + cache-recording tests RED (2) -> impl -> GREEN (10/10) [added the cache-recording assertion beyond the minimal design for TDD rigor]. R3 pull-quote forward-compat (behavior-neutral on Haiku 4.5) GREEN (19/19). Used non-optional response.usage in R2 (only consumer is the one updated mock; consistent with R1; lint-proof). Committed 810ba6c8.
- 2026-06-20: VERIFY (delegated): all required gates GREEN. Independent fresh-context review (opus, non-self-gradable) = SHIP, zero >=warn; sole nit = unreachable NaN guard on the telemetry counter, triaged via receiving-code-review and DECLINED (TS number-typed, both callers coerce ?? 0, NaN->miss is the safe/loud direction, no behavior change -> dead defensive code; differs from feedback_nan_blind_comparison_gates which is a SAFETY-floor pass). CONVERGE: divergence re-check clean (origin/main 75060567e=#1178 dashboard, zero file overlap); rebased onto it, fast re-verify GREEN. Next: push + PR + CI-gated squash-merge.
- 2026-06-20: CONVERGE DONE. Pushed; PR #1179 opened; ALL CI required checks GREEN (typecheck/lint/test(11m)/security/architecture/docker/secrets/CodeQL + 4 evals incl alex-conversation + claim-classifier). Squash-merged to main as fbee15839; remote branch auto-deleted. Backlog S1 -> [x]. SLICE COMPLETE. No new feedback\_\*.md lesson warranted (executed per design; the three-dot/parallel-merge + verify-actual-check-conclusions gotchas that fired were already-known lessons, handled correctly). Worktree teardown next.
