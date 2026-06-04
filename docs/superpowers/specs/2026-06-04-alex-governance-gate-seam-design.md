# Alex Governance `afterSkill` Seam — Wire It + Make The Eval See It — Design Spec

**Date:** 2026-06-04
**Status:** Draft for review
**Source:** The 🔴 SURFACED FINDING of PR #859 (router-flip de-risk, squash `ec3e852a`, merged 2026-06-03). See `docs/audits/2026-06-02-alex-improvement-audit/{findings.md,execution-plan.md}` (freeze gate + leverage tier) and the memory topic `project_agent_improvement_next.md`.
**Scope:** `packages/core` (skill-runtime executor + the WhatsApp gate) + `evals/alex-conversation` (governance-awareness). No schema, no migration, no seed, no dashboard, no metrics. Branches off `main` @ `40db8929`.

---

## 0. Scope & non-goals

This is **PR1 of a two-PR activation**. It **arms** the dormant governance seam byte-identically and makes the green eval able to see it. It does **not** seed any config, so prod behaviour is unchanged at merge. The actual observe-mode rollout is **PR2 (deferred, specified in §7)**.

**In scope (PR1).**

1. **Wire the seam.** Call `runAfterSkillHooks(this.hooks, hookCtx, result)` in the live `SkillExecutorImpl.execute()` at the afterSkill point — immediately after the `result` is assembled and **before** the fire-and-forget execution-trace recorder, so a gate's in-place `result.response` mutation is reflected in both the returned reply and the persisted trace.
2. **WhatsApp gate missing-safe fix (the merge-blocker).** `WhatsAppWindowGateHook` currently maps `status:"missing"` → `null` → an **unconditional `result.response = ""` blank on every channel**. Fix it to treat `missing` (and "resolved-but-no `whatsappWindow` block") as a clean no-op, matching the three sibling gates. Without this, wiring the seam blanks every Alex reply in prod.
3. **Call-site fail-closed.** Do **not** swallow a gate throw: let it propagate to the turn's error path so skill-mode emits the neutral fallback (the lead never sees ungated text). Also refresh `result.trace.responseSummary` post-gate so the canonical WorkTrace summary never records pre-block text. (Both hardened per the adversarial review — see §2.)
4. **The keystone — make the eval governance-aware.** Thread an optional governed-hooks capability into `evals/alex-conversation/run-conversation.ts` (default OFF, so the baseline is byte-identical) and add a **deterministic governed live-path integration test** in the BLOCKING eval vitest step that proves a real gate fires through the real executor — and **goes red when the seam is wired out**.
5. **Core executor unit test** proving `execute()` now invokes `runAfterSkillHooks` (a hook's `afterSkill` runs on a successful turn).

**Explicitly OUT of scope (→ PR2, §7).**

- **Seeding a `governanceConfig`** on the medspa pilot deployment (observe mode). PR1 ships zero seed → all four gates no-op → prod byte-identical.
- **PDPA observe-gating.** The PDPA revoked-race block path (`pdpa-consent-gate.ts:134-162`) mutates `result.response` even in observe mode. This is invisible at merge (no seed → `status:"missing"` returns at line 48 before reaching it) and only matters once observe is seeded — so it lands with the seed in PR2.
- **Claim-classifier observe-latency.** In observe mode the claim-classifier issues a synchronous Haiku call per claim-bearing sentence; since `runAfterSkillHooks` is awaited before the reply returns, that adds latency to every lead reply. The await-vs-fire-and-forget-per-mode decision is a PR2 design item.
- **The `off → enforce` flip.** Stays ops-controlled, gated on the observe-mode bake (like `ALEX_MODEL_ROUTER_ENABLED`).
- **The medical red-flag Slice 2 / `ContraindicationGateHook`.** A _different_ seam — it scans the inbound LEAD message and needs a new hook phase that sees inbound messages. These four gates scan Alex's OUTPUT reply. Out of scope; remains deferred.
- **New metrics / counters.** PR1 reuses #859's telemetry (`ExecutionTrace` + `switchboard_skill_llm_*`) and the gates' existing `GovernanceVerdict` writes. No new registry, no new counter.

---

## 1. Problem (verified 2026-06-04 against `origin/main` @ `40db8929`)

**The four governance `afterSkill` gates never fire on the live Alex path.** `SkillExecutorImpl.execute()` (`packages/core/src/skill-runtime/skill-executor.ts`) calls `runBeforeLlmCallHooks`, `runAfterLlmCallHooks`, `runBeforeToolCallHooks`, `runAfterToolCallHooks` — but **never `runAfterSkillHooks`** (verified: the import block at `:47-52` omits it). The only caller of `runAfterSkillHooks` is `BatchSkillHandler.executeBatch()` (`batch-skill-handler.ts:156`), which is **dead code** — `BatchSkillHandler` is constructed only in its own test; grep for `new BatchSkillHandler` / `createBatchExecutorFunction` across `apps/**` returns zero hits.

The four gates are registered in the live `hooks` array (`apps/api/src/bootstrap/skill-mode.ts:561-567`) and each implements **only** `afterSkill`:

- `DeterministicSafetyGateHook` — banned-phrase scan → block + handoff (enforce) / log (observe).
- `ClaimClassifierHook` — per-sentence claim classification → escalate (handoff) or rewrite (enforce) / log (observe).
- `PdpaConsentGateHook` — consent-revoked defense-in-depth block + disclosure detection.
- `WhatsAppWindowGateHook` — 24h-window template substitution / block.

Because `runAfterSkillHooks` is never called, **all four are inert**, and #843's claim-classifier confidence floor (the entire output-claim safety layer) has **zero live effect today**.

**Doubly dormant.** Even with the seam wired, every gate early-returns because **no deployment seeds a `governanceConfig`** (verified: zero producers in `packages/db/prisma/seed*`; the only repo references are the resolver test). The `governanceConfig` JSONB column already exists on `AgentDeployment` (`schema.prisma:1073`, added by migration `20260511014108`) and is read-only in prod today (`createAgentDeploymentGovernanceResolver` + one lifecycle-cron `select`).

**The green eval is structurally blind to all of this.** `evals/alex-conversation/run-conversation.ts:274` builds the executor `new SkillExecutorImpl(adapter, tools, undefined, [])` — empty hooks, ungoverned. So a gate regression cannot red the eval. This is the exact "built-but-unwired / green eval can't see live seams" anti-pattern the audit's durable invariant targets: _"If a capability is advertised, seeded, exported, or tested, there must be at least one production-path integration test proving it runs on the live path."_

**The landmine (the reason this is a careful change, not a one-liner).** Wiring `runAfterSkillHooks(this.hooks, …)` is byte-identical for **three** gates — `DeterministicSafetyGateHook` (`:96`), `ClaimClassifierHook` (`:67`), `PdpaConsentGateHook` (`:48`) all `if (resolution.status === "missing") return;`. But `WhatsAppWindowGateHook` does **not**: its `resolveConfig` (`whatsapp-window-gate.ts:263-284`) returns `null` for any non-`resolved` status (including `missing`), and `afterSkill` (`:66-79`) then **blanks `result.response = ""` unconditionally, on every channel**, before the `channel !== "whatsapp"` guard at `:102` can protect a non-WhatsApp lead. So wiring the seam _as-is_ would erase every Alex reply in production. This gate must be made missing-safe in the same PR as the seam.

---

## 2. The seam (`skill-executor.ts`)

`runAfterSkillHooks` (`hook-runner.ts:77-87`) iterates `hooks` in registration order, sequentially awaited, with **no return value and no short-circuit** — each `afterSkill(ctx, result)` composes by mutating `result.response` in place. The runner has no per-hook try/catch (unlike `runOnErrorHooks`).

**Insertion point.** In the success-return block, `result` is fully assembled at `skill-executor.ts:431-462`; the fire-and-forget `executionTraceHook` reads that same `result` by reference at `:464-476`; `return result` is at `:478`. The hook context `hookCtx` is already built at `:293-302`.

Insert **between line 462 and line 464**:

```ts
// Governance afterSkill gates (banned-phrase / claim / PDPA / WhatsApp-window).
// Wired here — AFTER result assembly, BEFORE the isolated trace recorder — so any
// in-place result.response mutation (enforce-mode block/rewrite/handoff) is reflected
// in the returned reply AND every downstream trace consumer, preserving the
// "trace never sees pre-block unsafe text" invariant the bootstrap relies on.
//
// FAIL-CLOSED: deliberately NOT wrapped in a swallowing try/catch. An unexpected gate
// throw propagates to the turn's error path (the method catch re-throws), so skill-mode
// emits the neutral fallback and the lead NEVER receives ungated text. The gates already
// fail CLOSED internally (posture cache) for the resolver-unavailable case, so an escaping
// throw is a genuine logic bug and failing the turn is the safe response. Inert in prod
// today (no governanceConfig seeded → every gate early-returns).
await runAfterSkillHooks(this.hooks, hookCtx, result);

// Keep the canonical WorkTrace summary consistent with any in-place gate mutation:
// skill-mode persists result.trace.responseSummary (stamped pre-gate above). No-op when
// no gate mutated.
result.trace.responseSummary = result.response.slice(0, 500);
```

Add `runAfterSkillHooks` to the import block at `:47-52`.

**Ordering rationale.** Placing the runner before the trace recorder (which is fire-and-forget but captures `result` synchronously) preserves the bootstrap invariant documented at `skill-mode.ts:365-377` and `deterministic-safety-gate.ts:62-73` ("trace store never sees pre-block unsafe text"). #859 moved the trace recorder out of the `hooks` array into the isolated 8th constructor arg, so that invariant now depends on _call order in `execute()`_ rather than array order — this is the correct place to honour it. The `responseSummary` refresh closes a second leak of the same invariant: `skill-mode.ts:96` persists `result.trace.responseSummary` into the canonical WorkTrace, and it was stamped from the pre-gate text (surfaced by the adversarial review).

**Fail-closed (revised per adversarial review).** The seam is **not** wrapped in a swallowing try/catch. A swallow would leak pre-block text if a gate threw mid-decision in enforce mode (e.g. after deciding to block but before mutating `result.response`). Letting the throw propagate routes it to skill-mode's neutral fallback — the lead never sees ungated text. This is byte-identical at merge (no seed → no throw) and the safe default for the PR2 observe/enforce rollout; an escaping throw is a genuine logic bug (the gates already handle expected store/resolver failures internally), so failing the turn loudly is correct.

**File-size note.** `skill-executor.ts` carries a `/* eslint-disable max-lines */` legacy-debt marker (`:1`); this change brings it to 679 lines. The marker suppresses both the eslint `max-lines` error and the `arch:check` raw-line error (verified `pnpm arch:check` reports no error-level issues); both #859 reviewers accepted the marker over a structural split. No new split here.

---

## 3. WhatsApp gate missing-safe fix (`whatsapp-window-gate.ts`)

**Today (`:263-284`):** `resolveConfig` returns `WhatsAppWindowGateConfig | null`; `null` means _both_ "no config / off" _and_ "resolver threw". `afterSkill` (`:66-79`) treats `null` as fail-closed and blanks the reply.

**The conflation is the bug.** The three sibling gates distinguish the resolver's discriminated union: `status:"missing"` → clean no-op; `status:"error"` → fail-closed only if the posture cache holds an `enforce` posture; resolver throw → posture-cache fallback. The WhatsApp gate collapses all non-`resolved` into `null`.

**Fix.** Make `resolveConfig` return a three-state result so `afterSkill` can mirror the siblings:

```ts
type WhatsAppConfigResolution =
  | { kind: "off" } // missing, or resolved-without-whatsappWindow → no-op
  | { kind: "config"; config: WhatsAppWindowGateConfig }
  | { kind: "unavailable" }; // resolver error / throw with no usable cached posture
```

- `resolution.status === "missing"` → `{ kind: "off" }`.
- `resolution.status === "resolved"` but no `raw.whatsappWindow` block → `{ kind: "off" }` (a deployment with a governanceConfig that omits the WhatsApp block must not be blanked).
- `resolution.status === "resolved"` with a block → `{ kind: "config", config }` (and `postureCache.remember`).
- `resolution.status === "error"` or a thrown resolver → consult `postureCache.lastKnown`; a cached posture → `{ kind: "config", config: cached }`; otherwise `{ kind: "unavailable" }`.

`afterSkill`:

- `{ kind: "off" }` → `return` immediately. **No verdict, no mutation.** This is the byte-identical no-op for today's unseeded state.
- `{ kind: "config" }` → existing logic unchanged (flag check, channel check, window logic).
- `{ kind: "unavailable" }` → **preserve the gate's existing deliberate fail-closed behaviour** (the "1c precedent"): emit a `governance_unavailable` verdict and blank `result.response`. This path now fires **only** for a genuine resolver error/throw with no cached posture — never for an unconfigured (`missing`) deployment. (This is the conservative choice: it keeps the existing fail-closed tests green and respects the WhatsApp gate author's deliberate hard-block-on-unavailable posture, while the `off` carve-out removes the never-configured blank.)

**Net effect.** With no config seeded, the WhatsApp gate becomes a clean no-op exactly like the other three → wiring the seam is byte-identical across all four gates. The genuine resolver-error fail-closed path is preserved unchanged.

**Tests.** Unit tests asserting: (a) `status:"missing"` → `result.response` unchanged, no `verdictStore.save`; (b) resolved-without-`whatsappWindow` → unchanged, no save; (c) resolver throw with a cached enforce posture → uses the cache (allow inside window); (d) resolver throw with no cached posture → **fail-closed blank** + `governance_unavailable` verdict (the existing test, strengthened to assert the blank). All existing inside/outside-window, mode/flag, and fail-closed tests pass unchanged.

---

## 4. The keystone — eval governance-awareness (`evals/alex-conversation`)

**Why a dedicated deterministic test, not a baseline change.** The alex-conversation oracle and deterministic gate key on **tool calls** (`outcome.toolCalls`, `ALEX_ALLOWED_TOOL_IDS`); a governance gate acts by **mutating `result.response`** (rewrite/handoff), never by calling the `escalate` tool. So the existing baseline scenarios cannot see a gate via the oracle — only the non-deterministic judge would notice the changed text. The faithful, blocking signal is a **co-located deterministic `__tests__` test** that drives the real executor with real gates and asserts on the post-gate `result.response` — the same pattern as #833's `live-path-faithfulness.test.ts` and PR-B's `booking-fixtures-bite.test.ts`. This runs in the BLOCKING eval vitest step (no API key, deterministic).

**4a. Harness capability (default OFF → baseline byte-identical).** Thread the executor's hooks through `run-conversation.ts`'s `buildExecutor` so a caller (a test) can supply a governed hooks array. Default stays `[]` (ungoverned). The production default-resolver returns `status:"missing"` for the eval's synthetic deployment, so even a governed harness run with no seeded config is a pass-through — `skillContentHash` is metadata-only and never gates (`score.ts` reads only `deterministicPass` / `semanticHardRulePass` / `judgeScore`), so **no baselined number moves and no baseline re-capture is needed**.

**4b. The bite test — `evals/alex-conversation/__tests__/governed-live-path.test.ts`.** Anchored on `DeterministicSafetyGateHook` (deterministic, no LLM stub required, observe/enforce both fully built). The test:

1. Builds the **real** `SkillExecutorImpl` with the **real** `DeterministicSafetyGateHook` (in-memory fakes for `verdictStore` / `handoffStore` / `conversationStore`; a banned-phrase loader returning a fixed phrase; a resolver returning a seeded `deterministicGate.mode:"enforce"` config; an `InMemoryGovernancePostureCache` from core), plus a **stub adapter** whose reply contains the banned phrase.
2. Runs a turn and asserts the gate **fired**: `result.response` is the handoff text (not the banned phrase), and a `block` verdict was saved.
3. **Bite assertion:** builds the same executor with `[]` hooks (the "wired out" control) and the **same** banned-phrase input, and asserts `result.response` still contains the banned phrase (gate did NOT fire). This proves the test goes **red** if the seam is removed or the gate is dropped from the array.
4. **Seam assertion (belt-and-braces):** a variant that registers a trivial recording hook (`afterSkill` sets a flag) and asserts the flag is set after `execute()` — proving `runAfterSkillHooks` is actually invoked by the executor (not just that the gate class works in isolation).

This test imports only `@switchboard/core` + `@switchboard/schemas` (the gate, the executor, the posture cache, the config types) — both already built in all four eval CI jobs (`ci.yml:402/461/525/592`), and all four suites run in every job (`evals/vitest.config.ts`). **No CI wiring change needed.**

**4c. Classifier eval untouched.** The separate claim-classifier eval scores **labels** via `invoke-classifier.ts` calling the raw `classifier.classify`, which **bypasses** `ClaimClassifierHook` entirely; its prompt-hash gate covers only `CLASSIFIER_SYSTEM_PROMPT` + the claim-type enum (`prompt.ts:57-61`). Wiring the hook into the alex executor touches neither. Its CI path-filter explicitly excludes `skill-runtime` (`ci.yml:368-371`). Verified — no baseline or prompt-hash shift.

---

## 5. Core executor unit test (`packages/core`)

A co-located `skill-executor`-level test proving the seam: construct `SkillExecutorImpl` with a single recording `SkillHook` whose `afterSkill` captures the `result`, a stub adapter producing a normal reply, run `execute()`, and assert the hook's `afterSkill` was invoked with the final `result` (and that mutating `result.response` inside the hook changes the returned reply). A control with `[]` hooks asserts no mutation. This is the in-core regression guard that the seam stays wired (mirrors #859's bootstrap arg-wiring guard).

---

## 6. Testing strategy (production-path-integration-test invariant)

Per the audit's durable invariant, every gate the seam activates gets a live-path test:

- **Unit layer:** the WhatsApp gate missing-safe cases (§3) + the existing safety/claim/PDPA gate unit suites (must stay green).
- **Live-path governed integration layer:** §4b (real executor + real safety gate, fires + bites) and §5 (executor invokes the runner).
- **Eval layer:** the default ungoverned run is byte-identical (baseline unmoved); the governed bite test runs in the blocking vitest step.

**Adversarial bar:** the bite test must demonstrably go red when (a) the `runAfterSkillHooks` call is removed from `execute()`, or (b) the safety gate is dropped from the hooks array. An independent red-team pass (codex `/codex:rescue`) on the diff confirms the seam actually bites and the WhatsApp fix has no missing-status hole.

---

## 7. PR2 — seed observe + activate (deferred, specified here)

Documented so the split is legible and PR2 is pre-scoped:

1. **Seed an observe-mode `governanceConfig`** on the medspa pilot `AgentDeployment` (org `org_demo`, the `alex-conversion` listing — `seed-marketplace.ts:707-769`, both the `update` and `create` blocks). Required fields `jurisdiction` + `clinicType` (no defaults); per-gate `mode:"observe"`. **No migration** (column exists). `pnpm db:check-drift` clean (seed-only).
2. **PDPA observe-gating:** gate the revoked-race block (`pdpa-consent-gate.ts:134-162`) on `consentConfig.mode === "enforce"` so observe is truly log-only.
3. **Claim-classifier observe latency:** decide await-vs-fire-and-forget for observe (a log-only classification must not add Haiku latency to every lead reply). Likely: observe verdict-writes go fire-and-forget; enforce stays awaited (it mutates the reply).
4. **Observe-mode resilience for the fail-closed seam.** The seam fails closed (§2): a gate logic-bug fails the turn to the neutral fallback. For the observe rollout, decide whether a purely-observational (log-only) gate bug should degrade a lead reply, or whether observe-mode gate execution should be isolated (e.g. per-gate try/catch that only swallows when `mode==="observe"`). The gates' expected store/resolver failures are already handled internally, so this concerns logic-bug resilience only.
5. **Bake then ops-controlled `off → enforce`** flip, validated against #859's telemetry (`ExecutionTrace` + `switchboard_skill_llm_*`) + the `GovernanceVerdict` store, mirroring the router-flag rollout discipline.

---

## 8. Coordination

Disjoint from every active worktree (verified `git worktree list` + `gh pr list` 2026-06-04): Riley (source-spend / control-plane / phase-a), Mira (publish-deadletter / roadmap), aesthetic-direction, paper-grain-canvas, work-trace-bypass-guard, and the dependabot/cux dashboard PRs. PR1 touches only `packages/core/src/skill-runtime/{skill-executor.ts, hooks/whatsapp-window-gate.ts}` + co-located tests and `evals/alex-conversation/{run-conversation.ts, __tests__/}`. No file overlap. `main` advances under us; re-verify before finishing.

---

## 9. Acceptance

1. `execute()` calls `runAfterSkillHooks` → the four gates RUN on the live path (proven by §5 + §4b real-executor tests, not mocked gates).
2. The alex-conversation eval is governance-aware: the §4b bite test reds when the seam is wired out; the default ungoverned run is byte-identical (baseline + classifier prompt-hash unshifted, verified not reset).
3. Gates default to a SAFE posture (no seed → off/missing) and lead-visible behaviour is **byte-identical at merge** across all four gates (WhatsApp fix closes the blank-on-missing hole).
4. No new metrics; #859's telemetry is the (PR2) observe validation surface.
5. Full local gate green: `pnpm build && typecheck && test && format:check && lint` + the four eval typechecks (noting pre-existing flakes: apps/chat gateway-bridge-attribution under full-suite load; db pg_advisory/ledger/greeting without Postgres).
6. Red-team/adversarial-verified to actually bite. PR to `main`, **NO auto-merge** (governance/safety change → human sign-off).
