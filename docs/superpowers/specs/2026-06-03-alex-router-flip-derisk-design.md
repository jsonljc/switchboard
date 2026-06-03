# Alex Router-Flip De-Risk — Design (freeze-gate bullets 3–5)

**Date:** 2026-06-03
**Branch:** `feat/alex-router-flip-derisk`
**Audit:** `docs/audits/2026-06-02-alex-improvement-audit/` (execution-plan freeze gate, findings T2.6 / T2.9 / T2.3)
**Predecessor:** PR #843 (freeze-gate classifier-half: confidence floor + escalation narrowing + self-disclosed-minor) — MERGED, squash `e8bf6712`.

## 1. Why this slice

The execution-plan's **freeze gate** has five bullets. Bullets 1–2 (claim-classifier confidence floor + over-escalation narrowing + self-disclosed-minor) shipped in #843. This slice is **bullets 3–5** — the work that makes flipping `ALEX_MODEL_ROUTER_ENABLED=true` **safe and observable**:

- **T2.6 — per-conversation cost/latency + cache telemetry** (the named _lead_ prerequisite): "the prerequisite to validate the router flip and lock the baseline against real traffic."
- **T2.9 — re-key model tiering on conversation depth + a router-ON eval variant**: today the tier is keyed on the wrong counter, so flipping the router on would route nearly every real reply to Haiku, invisibly.
- **T2.3 — timeout/abort of in-flight calls + explicit retries; reconsider the 30s budget** (adjacent reliability/cost).

This slice **does not flip** `ALEX_MODEL_ROUTER_ENABLED` (it stays default-OFF; that flip, and the classifier `off→enforce` flip, remain ops/user-controlled and gated on the eval bakes). It de-risks the flip.

## 2. Verify-first findings (live `origin/main`, 2026-06-03)

Confirmed against the worktree off `origin/main` (`e4c4d44a`) via a six-agent live-code fan-out:

- Prerequisite stack all merged: PR-0 #833, PR-A #799, PR-B #838, freeze-gate #843.
- T2.6 / T2.9 / T2.3 are all **still open** — no concurrent session has shipped router/telemetry/timeout work (the active worktrees are riley / aesthetic / el1 / meet-your-team / meta-page-id — all disjoint from the Alex skill-runtime).
- The candidate file:lines in the audit are accurate (modulo small drift). The Anthropic SDK is pinned to **`0.91.1`** (root pnpm override), which supports per-request `{ signal, timeout, maxRetries }`.

### 2a. A landmine the audit's literal instruction would step on (LOAD-BEARING)

The audit frames T2.6 as "wire the hook + `skill-executor` never calls `runAfterSkillHooks`." **`SkillExecutorImpl.execute()` genuinely never calls `runAfterSkillHooks`** (confirmed: the import block omits it; `git log -S runAfterSkillHooks` on that file is empty — it was never there). The only caller is `BatchSkillHandler`, which is **itself dead code** (`createBatchExecutorFunction` is never invoked).

But four **live-registered** hooks implement `afterSkill`: `DeterministicSafetyGateHook`, `PdpaConsentGateHook`, `WhatsAppWindowGateHook`, `ClaimClassifierHook`. **Naively wiring `runAfterSkillHooks(this.hooks, …)` would simultaneously activate four governance gates that have never run on the live path** — a dangerous, out-of-scope behavior change.

Two facts bound the blast radius and shape the design:

1. **Today those gates would no-op anyway** — no deployment seeds a `governanceConfig`, so every gate early-returns on `status:"missing"`/`mode:"off"`. So this is a **latent activation seam, not an active safety regression**. (Consequence worth flagging: **#843's claim-classifier confidence floor has zero live effect today** — both because `afterSkill` never fires and because the mode is `off`/unseeded.)
2. The executor already has a clean **isolated-hook template**: `qualificationEvaluationHook` is a _separate_ constructor arg (7th positional), invoked explicitly at the success-return with a `.catch()` log-and-swallow — **not** in the `hooks` array, so it cannot activate the governance gates.

**Design consequence:** we wire telemetry via the `qualificationEvaluationHook` template (a dedicated executor arg), **not** via `runAfterSkillHooks`. The governance `afterSkill` gates stay exactly as dormant as today (governance behavior byte-identical). The dormant-gates finding is **surfaced as a separate high-priority follow-up** (§6), not fixed here.

### 2b. The telemetry sink

`TracePersistenceHook` persists a `SkillExecutionTrace` to the `ExecutionTrace` table via `PrismaExecutionTraceStore`. That table has the right columns (`tokenUsage Json`, `durationMs`, `turnCount`, `writeCount`, indexed by deployment/org/session) and read endpoints already exist (`apps/api/src/routes/marketplace.ts` GET `/deployments/:id/traces`, `/traces/:traceId`). It is currently **write-only/dead** (its only writer is the never-instantiated hook; the dashboard `useTraces` hook has no render consumer). The canonical _live_ trace is `WorkTrace` (a governance record, no token/cost/cache columns).

We persist to **`ExecutionTrace` via `TracePersistenceHook`** (the acceptance names this hook; it is the purpose-built per-execution telemetry table, cleanly separate from `WorkTrace`'s governance record, and queryable via the existing API endpoints). To avoid reviving a purely write-only surface and to make the flip observable **in real time against real traffic**, we **also emit a focused set of Prometheus counters** (the established dual-prom `getMetrics()` pattern) — these feed existing alerting/dashboards and make the per-model tier distribution graphable the moment the flag flips.

## 3. Scope

**In scope (one branch, squash PR to `main`, no auto-merge):**

- T2.6 telemetry: capture cache tokens in the adapter; carry the actual model + cache tokens up; wire `TracePersistenceHook` via the isolated-hook template (success + error paths); persist cost + cache + model in the trace; emit aggregate Prom counters; keep the 64k budget on full-price tokens.
- T2.9 tiering: re-key the model tier on **conversation depth** instead of the intra-invocation LLM-loop counter, composing with the #784 stage-raise (only ever raises); add a **router-ON eval variant** that makes a bad Haiku downgrade fail the test.
- T2.3 reliability: abort the in-flight Anthropic call on the deadline (stop the token-burn leak); pass `profile.timeoutMs` as the per-request SDK timeout; set explicit `maxRetries`; add a per-call timeout and lift the 30s whole-conversation budget; raise the router's per-tier timeouts off the Haiku-shaped 8s default.

**Out of scope (explicitly):**

- Flipping `ALEX_MODEL_ROUTER_ENABLED` or the classifier `off→enforce` (ops/user-controlled, gated on eval bakes).
- Activating the dormant `afterSkill` governance gates (§6 — needs its own governance slice with eval coverage + `governanceConfig` seeding + calibration).
- A dashboard render surface for `ExecutionTrace` (the API query endpoint + Prom counters are the consumers; a UI is a separate UX decision).

**Non-goal / invariant:** with `ALEX_MODEL_ROUTER_ENABLED` OFF, **model selection is byte-identical to today** (Alex still runs Sonnet-4.6 via the adapter default). The telemetry and timeout/abort changes _do_ take effect on the live path with the flag off — that is intended (telemetry must collect real-traffic data _before_ the flip; the timeout leak is a current prod bug). Neither changes the text a lead receives on a successful turn.

## 4. Design per concern

### T2.6 — Telemetry (lead)

**4.6.1 Capture cache tokens (the dropped data).**
`anthropic-tool-adapter.ts` reads only `input_tokens`/`output_tokens` (drops `cache_read_input_tokens`/`cache_creation_input_tokens`). Extend the usage read:

```ts
usage: {
  inputTokens: response.usage.input_tokens,
  outputTokens: response.usage.output_tokens,
  cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,        // SDK field is number|null
  cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
},
```

Also surface the **actual model** the adapter called, so telemetry can show the tier distribution regardless of the router flag: add `model: params.profile?.model ?? DEFAULT_MODEL` to the `LLMResponse`.

**4.6.2 Extend the usage/response/result types (all new fields OPTIONAL → no caller breaks).**

- `LLMUsage` (`llm-types.ts:39`): `+ cacheReadTokens?: number; cacheCreationTokens?: number`.
- `LLMResponse` (`llm-types.ts`): `+ model?: string`.
- `LlmResponse.usage` (the hook-facing inline type, `types.ts:243`): same optional cache fields.
- `SkillExecutionResult.tokenUsage` (`types.ts:107`) and `SkillExecutionTrace.tokenUsage` (`types.ts:168`) and the db store's `tokenUsage` (`prisma-execution-trace-store.ts:17`): `+ cacheRead?: number; cacheCreation?: number`. (The DB column is JSON `as never` → **no migration**.)
- `SkillExecutionResult.trace` / `SkillExecutionTrace`: `+ model?: string`, `+ costUsd?: number` (the per-execution model + computed cost). JSON-backed → no migration.

**4.6.3 Accumulate in the executor.** Alongside `totalInputTokens`/`totalOutputTokens`, add `totalCacheReadTokens`/`totalCacheCreationTokens`; sum each turn's `response.usage.cache*Tokens ?? 0`; record the final turn's `response.model` as the representative model. Thread cache totals + model + cost into the returned `tokenUsage`/`trace`.

**4.6.4 Cost.** Extend `computeTokenCostUSD` (`telemetry/llm-costs.ts`) with a cache-read rate (~0.1× input) and cache-write rate (~1.25× input) per Anthropic pricing, and compute per-execution `costUsd` from the accumulated tokens + model. Persist it on the trace and emit it as a counter.

**4.6.5 Budget — keep on full-price tokens (the actual correct behavior).**
_Premise correction:_ the audit says "the 64k budget overcounts cached tokens." Verified against the SDK: `input_tokens` **already excludes** cached tokens (cache reads/creations are reported in separate fields), so there is **no current double-count**. The real hazard is _forward-looking_: once we capture `cache_read`, folding it into the hard budget at full weight _would_ falsely throttle (a ~8k cached system+tools prefix re-read every turn is nearly free but would exhaust a 64k budget fast). **Decision:** the hard budget stays on `input + output` (full-price, cache-excluded), made explicit via a named `billableTokens` local + comment, applied identically in the inline executor check (`skill-executor.ts:280`) **and** `budget-enforcement-hook.ts:22`. Cache tokens are captured for telemetry only. No knob.

**4.6.6 Wire the hook via the isolated-hook template (NOT `runAfterSkillHooks`).**

- Refactor `TracePersistenceHook` to mint its `traceId` **per `afterSkill`/`onError` invocation** (today it mints once in the constructor → a bootstrap singleton would write every row with the same primary key → silent collisions). Remove the now-dead instance `traceId` + `getTraceId()` (only consumer is the unregistered, dead `OutcomeLinkingHook`, which takes `getTraceId` as its own constructor param — unaffected).
- Add an **8th optional constructor arg** to `SkillExecutorImpl`, `executionTraceHook?: ExecutionTraceRecorder` (a dedicated structural interface — `afterSkill(ctx, result)` + `onError(ctx, error, partial?)` — so it cannot be confused with the governance `hooks` array). Build a `SkillHookContext` once in `execute()` (all fields available from `params`/`requestCtx`). Wrap the turn loop in a try/catch keyed on that context: on the success return, **fire-and-forget** the recorder (`void this.executionTraceHook?.afterSkill(hookCtx, result).catch(log-and-swallow)`, NOT awaited) and return immediately; on a thrown error, build an `ExecutionTracePartial` from the in-scope accumulators (burned tokens incl. cache, `durationMs`, `turnCount`, `model`), fire-and-forget `onError(hookCtx, err, partial)`, then re-throw the **original** error immediately. _(Review-incorporated: fire-and-forget so a slow `ExecutionTrace` DB write never delays the lead-visible reply; the error-path `partial` so a budget-busting turn records its real burned tokens/cost, not a zero fallback. apps/api is a long-running Fastify server, so the floating promise settles safely.)_ Telemetry failure must never change the lead-visible response.
- Bootstrap (`apps/api/src/bootstrap/skill-mode.ts`): construct `new PrismaExecutionTraceStore(prisma)` + `new TracePersistenceHook(store, { trigger: "chat_message", inputParametersHash })` and pass it as the new arg to the **live** executor (the simulation executor may omit it). Reuse the existing `work-trace-hash` helper for `inputParametersHash`.

**4.6.7 Aggregate Prom counters (the real-time consumable).** Add to `SwitchboardMetrics` (core) + `createInMemoryMetrics()` + **both** `apps/api/src/metrics.ts` and `apps/chat/src/bootstrap/metrics.ts` (dual-prom; keep in sync):

- `skillLlmTokensTotal` (Counter, labels `{ model, kind: "input"|"output"|"cache_read"|"cache_creation" }`) — lets a dashboard compute cache-hit-rate and total throughput per model.
- `skillLlmCostUsdTotal` (Counter, labels `{ model }`) — per-model spend.
- (Latency already has `executionLatencyMs`; reuse it rather than duplicate.)
  Emit once per execution from the **telemetry-hook seam** (`TracePersistenceHook.afterSkill`/`onError`), co-located with persistence — it has `result.tokenUsage` (incl. cache), `result.trace.model`, `result.trace.costUsd`, and `durationMs`. Emitting at the hook (rather than the executor body) scopes emission to the live executor (the sim/eval executors carry no trace hook) and keeps the executor free of metrics concerns. The `{ model }` label is what makes the **Haiku-downgrade visible in production** the moment the flag flips — the runtime complement to the eval variant (§T2.9) that makes it visible pre-flip.

### T2.9 — Re-key tiering on conversation depth + router-ON eval variant

**4.9.1 The bug.** `resolveProfile` feeds `buildTierContext({ turnCount: turnCount - 1, … })` where `turnCount` is the **intra-invocation LLM-loop counter** (resets to 0 every `execute()` = every inbound message). `buildTierContext` maps it to `TierContext.messageIndex`; `resolveTier`'s first rule is `messageIndex === 0 → "default"` (Haiku). So on the first (usually only) LLM call of _every_ message, `messageIndex === 0 → Haiku`, regardless of conversation depth. Flipping the router on dumps nearly every real sales reply to Haiku.

**4.9.2 The signal to swap to.** `SkillExecutionParams.messages` (`types.ts:87`) is the full filtered user+assistant transcript (populated from `workUnit.parameters.conversation.messages`, sourced from the channel-gateway's `history.slice(-30)` + the current turn; bounded ≤31). `params.messages.length` ≈ **conversation depth**, available in `resolveProfile` (it receives full `params`). Derive it **once per `execute()`** (mirroring `deriveCurrentStage`), inside the `this.router` guard, from the immutable `params.messages` — **never** the executor-local `messages` array (which grows during the tool loop and would re-introduce the contamination).

**4.9.3 The re-keyed `resolveTier` (intention-revealing; composes via `maxSlot`).** Rename `TierContext.messageIndex` → `conversationDepth`; `TierContextInput.turnCount` → `conversationDepth`:

```ts
resolveTier(ctx): ModelSlot {
  let slot: ModelSlot;
  if (ctx.previousTurnEscalated) slot = "critical";          // escalation → Opus, any depth
  else if (ctx.previousTurnUsedTools) slot = "premium";      // processing a tool result → Sonnet
  else if (ctx.conversationDepth <= 1) slot = "default";     // first-contact greeting → Haiku
  else if (ctx.toolCount === 0) slot = "default";            // tool-less skill → Haiku even when deep
  else slot = "premium";                                     // engaged, tool-bearing conversation → Sonnet
  const stageSlot = this.stageToSlot(ctx.currentStage);
  if (stageSlot) slot = this.maxSlot(slot, stageSlot);       // #784 stage-raise (only raises)
  return this.applyFloor(slot, ctx.modelFloor);
}
```

`previousTurnUsedTools`/`previousTurnEscalated` remain loop-derived (they are genuinely about intra-`execute()` state). Only the **baseline** is re-keyed onto conversation depth. The "only ever raises" property is preserved (depth enters before the `maxSlot` stage merge; escalation/floor still raise). Result: greetings → Haiku, engaged Alex turns → Sonnet, fear/escalation → Opus.

**4.9.4 Update the locked unit tests.** `packages/core/src/__tests__/model-router-tier.test.ts` asserts behavior on `messageIndex` — re-express in `conversationDepth` terms; keep the stage-never-lowers + floor assertions; add a "deep neutral turn → premium, not default" case.

**4.9.5 Router-ON eval variant (the visibility guarantee).** New deterministic test `evals/alex-conversation/__tests__/router-tier.test.ts`. The bug lives in `resolveProfile`'s `turnCount-1` mapping, which a raw `resolveTier` unit test cannot reach — so the test drives the **full `SkillExecutorImpl` with the router ON and a fake recording adapter** (no network) that captures `params.profile?.model` per call and returns a minimal `end_turn` response:

- Load Alex's real tool map + skill (production shape: 4 tools, no `minimumModelTier`).
- **Deep but neutral-worded** turn (long `messages`, final user message with no price/trust/timing/fear keyword) → assert recorded model is **NOT** `claude-haiku-4-5-20251001`. **Fails today** (mis-key → Haiku); **passes after** the depth re-key. This is the test that catches a bad downgrade.
- **Objection** turn → `claude-sonnet-4-6`; **fear** turn → `claude-opus-4-6` (rescued by `currentStage` — passes before and after; pins the high-stakes path).
- No `ci.yml` change: imports only `@switchboard/core` (already built in all four eval jobs). Touches no baseline / prompt-hash (the deterministic `__tests__` step never invokes `run-eval.ts main()`).

### T2.3 — Timeout / abort / retries

**4.3.1 The leak.** `skill-executor.ts:254-275` does `Promise.race([chatWithTools(...), timeoutPromise])` with **no AbortSignal**. When the timeout arm rejects, the in-flight `messages.create` keeps running — full output-token burn (plus up to 2 silent SDK retries) for a reply nobody reads.

**4.3.2 Abort the in-flight call.** Thread an `AbortController` from the executor's per-call deadline into the adapter, mirroring the in-repo gold standard (`governance/classifier/run-classifier.ts:34` + `anthropic-classifier.ts:88`):

- Add `signal?: AbortSignal` to the provider-neutral `chatWithTools` param type (`llm-types.ts`) and the adapter method.
- Adapter passes the SDK second arg: `client.messages.create(body, { signal: params.signal, timeout: params.profile?.timeoutMs, maxRetries: 1 })`.
- Executor: `const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), perCallMs); … chatWithTools({ …, signal: ctrl.signal }); … finally clearTimeout(timer)`. Keep the `Promise.race` as a **backstop** (so a non-cooperative adapter — e.g. the existing test mock that ignores the signal — still unblocks `execute()`), but the abort is what stops the burn. On `AbortError`/timeout → throw `SkillExecutionBudgetError` (preserves the existing `"enforces runtime timeout"` test).

**4.3.3 Pass `profile.timeoutMs`.** Currently plumbed (router → profile → adapter param type) but dropped at the call site. Pass it as the SDK `timeout`. When the router is OFF (`profile` undefined), the executor's AbortController deadline (a per-call default) still bounds the call — so the abort works regardless of the flag.

**4.3.4 Budget split (modes-not-knobs principled defaults).**

- Add `maxLlmCallMs` (per-LLM-call) to `SkillRuntimePolicy`, default **30_000**. Each call's abort deadline = `min(profile?.timeoutMs ?? maxLlmCallMs, remainingWholeConversationMs)`.
- Raise `maxRuntimeMs` (whole-conversation) **30_000 → 120_000**. Rationale: the live model is Sonnet (router off); a legitimate multi-tool booking (`maxLlmTurns: 6`, `maxToolCalls: 5`, each Sonnet tool-turn ~3–8s + external calendar I/O) routinely exceeds 30s and is killed today. The per-call abort (≤30s) keeps any single hung call bounded, so the larger whole-conversation ceiling does not weaken runaway protection (the loop is already bounded by turn/tool caps).
- Raise the router's per-tier `timeoutMs` off the Haiku-shaped 8s `DEFAULT_TIMEOUT_MS`: default(Haiku) 15s, premium(Sonnet) 25s, critical(Opus) 30s. These only take effect when the router is ON.

**4.3.5 Explicit retries.** Set `maxRetries: 1` on the per-request options (one bounded retry for a transient 429/529/500, terminated by the abort deadline) instead of the silent SDK default of 2. PR-A's raw-error fallback already turns a failed turn into a neutral lead-facing message.

**4.3.6 The live-path abort test (acceptance-required).** A test that proves the **in-flight call is actually aborted**, not merely that the outer race resolves: a fake adapter that awaits its `signal` and records `signal.aborted` (or throws `AbortError` when aborted); assert the signal fires on deadline. The existing 35s-mock timeout test continues to pass via the race backstop.

## 5. Testing strategy (production-path-integration-test invariant)

Every capability touched gets a live-path-faithful test:

- **Telemetry wired (not unwired):** a test that drives `SkillExecutorImpl.execute()` with a stub trace hook and asserts `afterSkill` is invoked with the real `tokenUsage` (incl. cache fields) + model + cost on success, and `onError` on a thrown budget error — and that a throwing trace hook does **not** change the returned response (isolation). Mirrors the `qualificationEvaluationHook` test seam.
- **Cache capture:** adapter test asserting `cache_read_input_tokens`/`cache_creation_input_tokens` flow into `LLMUsage`; executor test asserting they accumulate and reach `tokenUsage` without inflating the hard budget.
- **Tier re-key:** the router-ON eval variant (§4.9.5) + updated `model-router-tier.test.ts`.
- **Abort:** the in-flight-abort test (§4.3.6) + an assertion that `profile.timeoutMs` reaches the adapter's request options.
- **Budget unchanged semantics:** a test pinning that a turn whose `cache_read` is large but `input+output` is under budget does **not** trip `SkillExecutionBudgetError`.

Gate locally (CI is not the first signal): `pnpm build && pnpm typecheck && pnpm test && pnpm format:check && pnpm lint`, plus `pnpm --filter @switchboard/eval-alex-conversation typecheck` (evals **are** in `turbo typecheck` now — 14 packages — but run the per-eval typecheck too) and the shared eval vitest (`pnpm exec vitest run --config evals/vitest.config.ts`). Pre-existing noise (not ours): apps/chat `gateway-bridge-attribution` flakes under full-suite load; db `pg_advisory`/ledger/greeting tests fail locally without Postgres (CI mocks Prisma).

## 6. Surfaced finding (NOT fixed here) — dormant `afterSkill` governance gates

`DeterministicSafetyGateHook`, `PdpaConsentGateHook`, `WhatsAppWindowGateHook`, and `ClaimClassifierHook` are registered as `afterSkill` hooks but **never execute on the live path** (no `runAfterSkillHooks` call; the only caller, `BatchSkillHandler`, is unwired dead code). They additionally no-op today because no deployment seeds a `governanceConfig`. **Net: #843's claim-classifier confidence floor has zero live effect today.**

This is a **latent activation seam**, not an active regression (no config → nothing to gate). Fixing it properly is a **dedicated governance slice**, not a telemetry change, because: the conversation eval runs **ungoverned** (`[]` hooks) so it cannot validate gate behavior; the gates have never run live (unknown blast radius — banned-phrase rewrites, consent blocks); the claim-classifier flip is meant to be a deliberate, monitored ops change; and it needs `governanceConfig` seeding + calibration + rollout. **It also needs exactly the per-conversation telemetry this slice builds** to validate gate behavior against real traffic — so telemetry-first is the correct ordering. Recommended as the **next high-priority slice** after this one.

## 7. Risks & mitigations

| Risk                                                   | Mitigation                                                                                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Telemetry hook accidentally activates governance gates | Use the isolated `qualificationEvaluationHook` template (separate arg), **not** `runAfterSkillHooks`. Governance `afterSkill` stays dormant; verified by a test asserting the governance hooks array is unchanged. |
| Bootstrap-singleton trace hook collides primary keys   | Mint `traceId` per `afterSkill`/`onError` invocation; test two executions → two distinct trace ids.                                                                                                                |
| Telemetry failure breaks a live turn                   | Invoke with `.catch()` log-and-swallow; test a throwing trace hook leaves the response intact.                                                                                                                     |
| Cache tokens inflate the budget                        | Hard budget stays on `input+output` (named `billableTokens`); test a large-`cache_read` turn does not trip the budget.                                                                                             |
| Raising `maxRuntimeMs` weakens runaway protection      | Per-call abort (≤30s) bounds any single call; loop bounded by `maxLlmTurns`/`maxToolCalls`.                                                                                                                        |
| Depth re-key lowers a high-stakes turn                 | Depth enters before the `maxSlot` stage-raise + floor; eval variant asserts fear→Opus / objection→Sonnet still hold.                                                                                               |
| Eval variant silently passes                           | It drives the real `resolveProfile` keying via a recording adapter and asserts NOT-Haiku on a deep turn — fails today, passes after the fix.                                                                       |
| Prod model selection changes with flag off             | All tier logic stays behind `if (!this.router) return undefined`; router-OFF path untouched (test pins it).                                                                                                        |

## 8. Rollout

- `ALEX_MODEL_ROUTER_ENABLED` stays default-OFF → **model selection byte-identical**. The router/tier changes are inert until an ops flip.
- Telemetry + timeout/abort take effect on the live path immediately on merge (intended): per-conversation `ExecutionTrace` rows + Prom counters start populating (so the flip can be validated against real traffic), and the token-burn leak is closed.
- No Prisma migration (all new persistence rides existing JSON columns).
- After merge + a period of real-traffic telemetry, ops can flip `ALEX_MODEL_ROUTER_ENABLED=true` with the per-model counters + ExecutionTrace as the validation surface, and the eval variant as the pre-flip guard.

## 9. Deferred (documented, not dropped)

- Activating the dormant `afterSkill` governance gates (§6) — next slice.
- A dashboard render surface for `ExecutionTrace` / per-model cost dashboards (UX decision).
- Per-tier cost dashboards / alerts beyond the raw counters.
- Folding cache counts into the Redis token-usage ingestion path (`apps/api/src/routes/token-usage.ts`) — separate path, not on the executor seam.
- **Per-tool-op execution deadline (PRE-EXISTING gap, not introduced here).** The runtime budget (`maxRuntimeMs`) is only checked _before each LLM call_, not around tool execution — a slow external tool op can run past the whole-conversation budget before the next LLM-call check catches it. This predates this slice (the original 30s code had the same shape); raising `maxRuntimeMs` to 120s does not worsen it (individual tool ops carry their own I/O timeouts, and `maxLlmTurns`/`maxToolCalls` bound the loop). A per-tool deadline is a separate reliability slice.
- **`LlmResponse.usage` (the `afterLlmCall` hook type) deliberately omits cache fields.** `LLMUsage` carries them; the hook-facing inline type does not, since no `afterLlmCall` hook consumes cache tokens today (YAGNI). Add them when a real consumer appears.
