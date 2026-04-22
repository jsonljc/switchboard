# Skill Runtime Unification — Design Spec

**Date:** 2026-04-16
**Status:** Draft
**Scope:** Bridge existing runtime primitives (ModelRouter, interceptor chain, deployment config) into skill execution

---

## Problem

Switchboard has a split architecture. The agent/orchestrator execution path has:

- **ModelRouter** — tier-based model selection with context-aware resolution and fallback
- **CartridgeInterceptor** — pluggable lifecycle hooks (beforeEnrich, beforeExecute, afterExecute)
- **Deployment config** — DB fields for trust level, governance settings, circuit breaker thresholds, write limits

The skill execution path has none of these. It hardcodes a single model (`claude-sonnet-4-5-20250514`), has no hook points, and ignores deployment settings. The executor loop interleaves budget enforcement, LLM calling, governance decisions, tool execution, and trace assembly in one 130-line function with no seams.

This means the place where most real work happens — skills handling leads, CRM writes, ad diagnostics, outbound messages — is the least governable part of the system.

## Goal

Make skill execution obey the same runtime controls as agent/orchestrator execution.

Three bridges:

1. ModelRouter → ToolCallingAdapter / skill executor
2. Interceptor chain → skill lifecycle
3. Deployment config → runtime behavior selection

The work is unification, not invention. Every primitive already exists somewhere in the codebase.

## Non-Goals

- BizAI-style YAML inheritance, interpolation, or config DSL
- Subagent-as-tool orchestration
- Full runtime rewrite
- Parallel knowledge prefetch (OmniSearch-style)
- Dynamic hook registration from config (hooks remain code-registered at bootstrap)

---

## Phase 1: Router Bridge

### Principle

Skills express capability need, runtime resolves the concrete model. Skills never name models.

### Current State

- `AnthropicToolCallingAdapter` hardcodes `DEFAULT_MODEL = "claude-sonnet-4-5-20250514"` — every skill, every turn, every deployment uses the same model
- `ModelRouter` exists in `packages/core/src/model-router.ts` with `resolve()` and `resolveTier()` but is not imported anywhere in `skill-runtime/`
- `TierContext` already captures the right signals (message index, tool count, high-risk tools, previous turn state, escalation)

### Changes

**1. Extend `ToolCallingAdapter` interface**

Add an optional `profile?: ResolvedModelProfile` to `chatWithTools` params:

```typescript
// Derived from ModelConfig to avoid type drift:
// Pick<ModelConfig, 'maxTokens' | 'temperature' | 'timeoutMs'> & { model: string }
interface ResolvedModelProfile {
  model: string; // concrete model ID (from ModelConfig.modelId)
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}
```

The adapter uses the profile if provided, falls back to its default if not. Backward-compatible.

**2. Inject `ModelRouter` into `SkillExecutorImpl`**

Constructor gains `private router: ModelRouter`. If not provided (tests, legacy paths), current hardcoded behavior is preserved.

**3. `SkillTierContextBuilder` — extract routing logic from executor**

A small helper that maps raw execution facts into `TierContext`:

| Execution fact                                               | TierContext field                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `turnCount`                                                  | `messageIndex`                                                                           |
| Number of declared tools                                     | `toolCount`                                                                              |
| Any declared tool has tier `external_write` or `destructive` | `hasHighRiskTools` (conservative coarse prior — declared capability, not current intent) |
| Previous turn contained tool_use blocks                      | `previousTurnUsedTools` (complexity signal, not risk signal)                             |
| Previous turn got `require-approval` or `deny`               | `previousTurnEscalated` (risk/recovery signal — carries more weight than tool use)       |
| Skill frontmatter `minimumModelTier`                         | `modelFloor`                                                                             |

The builder is tested independently from the executor.

**4. Skill frontmatter gains optional `minimumModelTier`**

Valid values: `"default" | "premium" | "critical"`. This is a floor, not a selection — the router can still upgrade based on context. Most skills omit it (defaults to `"default"`). Ad-optimizer might set `"premium"`.

`minimumModelTier` must not exceed the deployment's `allowedModelTiers` (Phase 3). Invalid combinations fail fast at bootstrap, not at runtime.

**5. Model resolution happens once per LLM call/turn**

No mid-response model switching. Each iteration of the executor loop resolves a `ResolvedModelProfile` before calling the adapter. The profile may differ between turns within the same skill execution (e.g., first turn uses default, second turn after tool use escalates to premium).

### Files Changed

| File                                          | Change                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `skill-runtime/tool-calling-adapter.ts`       | Add `profile?: ResolvedModelProfile` to params, use when provided                  |
| `skill-runtime/skill-executor.ts`             | Accept `ModelRouter`, call `SkillTierContextBuilder` + `router.resolve()` per turn |
| `skill-runtime/skill-tier-context-builder.ts` | **New file** — maps execution facts to `TierContext`                               |
| `skill-runtime/types.ts`                      | Add `ResolvedModelProfile`, `minimumModelTier` to `SkillDefinition`                |
| `skill-runtime/skill-loader.ts`               | Parse `minimumModelTier` from frontmatter (optional, validated against ModelSlot)  |

### Success Condition

A skill run can use different models depending on task context. No skill directly names a concrete model. Existing behavior preserved when router is not provided.

---

## Phase 2: Skill Lifecycle Hooks

### Principle

Create official attachment points so cross-cutting concerns are pluggable, not inline.

### Current State

The executor loop (`skill-executor.ts:46-175`) interleaves five concerns with no seams:

1. Budget enforcement (token count, turn count, runtime timeout)
2. LLM calling
3. Response parsing
4. Governance decisions per tool
5. Tool execution + trace assembly

The handler (`skill-handler.ts`) has its own inline pre-checks (circuit breaker, blast radius, error trace persistence, outcome linking) that would need duplication in any second handler (e.g., `BatchSkillHandler`).

### Hook Interface

```typescript
interface SkillHook {
  /** Name for logging and ordering. */
  name: string;

  // Outer lifecycle — called by handler
  beforeSkill?(ctx: SkillHookContext): Promise<HookResult>;
  afterSkill?(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void>;

  // Inner loop — called by executor per turn
  // beforeLlmCall returns LlmHookResult, not just LlmCallContext, so that
  // budget enforcement hooks can abort the LLM call via proceed: false
  // rather than throwing exceptions. This keeps the abort pattern consistent
  // with beforeToolCall.
  beforeLlmCall?(ctx: LlmCallContext): Promise<LlmHookResult>;
  afterLlmCall?(ctx: LlmCallContext, response: LlmResponse): Promise<void>;
  beforeToolCall?(ctx: ToolCallContext): Promise<HookResult>;
  afterToolCall?(ctx: ToolCallContext, result: unknown): Promise<void>;

  // Error handling
  onError?(ctx: SkillHookContext, error: Error): Promise<void>;
}

interface HookResult {
  proceed: boolean;
  reason?: string;
}

// LlmHookResult extends HookResult with optional context mutation
interface LlmHookResult extends HookResult {
  ctx?: LlmCallContext; // mutated context (e.g., updated profile)
}
```

Hooks run in registration order. A `beforeSkill` or `beforeToolCall` returning `{ proceed: false }` short-circuits — no further hooks run, execution stops with a clear reason. This mirrors `CartridgeInterceptor.beforeExecute`.

`beforeToolCall` is the most important hook for Switchboard. It is where governance decisions, write guards, and approval escalation live. Most of the real risk in the system — CRM writes, ad mutations, outbound messages — passes through this point.

### Extraction Plan

| Current inline code                                                | Becomes                 | Hook method      |
| ------------------------------------------------------------------ | ----------------------- | ---------------- |
| Circuit breaker check (handler:50-56)                              | `CircuitBreakerHook`    | `beforeSkill`    |
| Blast radius limiter (handler:58-64)                               | `BlastRadiusHook`       | `beforeSkill`    |
| Budget enforcement: tokens, turns, timeout (executor:46-53, 73-77) | `BudgetEnforcementHook` | `beforeLlmCall`  |
| Governance decision per tool (executor:126-139)                    | `GovernanceHook`        | `beforeToolCall` |
| Governance log assembly (executor:131-139)                         | `GovernanceHook`        | `afterToolCall`  |
| Trace persistence (handler:156-183)                                | `TracePersistenceHook`  | `afterSkill`     |
| Outcome linking (handler:178-183)                                  | `OutcomeLinkingHook`    | `afterSkill`     |
| Error trace persistence (handler:122-153)                          | `TracePersistenceHook`  | `onError`        |

### Post-Extraction Executor Shape

After extraction, the executor loop should be approximately:

```
while (turnCount < policy.maxLlmTurns):
  ctx = buildLlmCallContext(turnCount, ...)
  ctx = await runHooks("beforeLlmCall", ctx)       // budget check, profile resolution
  response = await adapter.chatWithTools(ctx)
  await runHooks("afterLlmCall", ctx, response)    // telemetry, logging

  if response is end_turn: break

  for each tool_use block:
    toolCtx = buildToolCallContext(toolUse)
    result = await runHooks("beforeToolCall", toolCtx)  // governance gate
    if !result.proceed: record denial, continue
    observation = await tool.execute(toolUse.input)
    await runHooks("afterToolCall", toolCtx, observation) // governance log, trace

  append tool results to messages
```

The loop becomes a skeleton that delegates to hooks for policy. Target: ~40 lines.

### Hook Registration

Hooks are composed at bootstrap in `apps/api` when creating a `SkillHandler`. Not via config — that is a future extension point (not in scope for this SP).

```typescript
const hooks: SkillHook[] = [
  new CircuitBreakerHook(circuitBreaker),
  new BlastRadiusHook(blastRadiusLimiter),
  new BudgetEnforcementHook(), // reads limits from SkillRuntimePolicy
  new GovernanceHook(),
  new TracePersistenceHook(traceStore),
  new OutcomeLinkingHook(outcomeLinker),
];
```

`BatchSkillHandler` reuses the same hooks without duplication. Note: `BatchSkillHandler`'s post-execution write routing (which iterates `proposedWrites` and routes each through governance sequentially) is a batch-specific orchestration concern, not a shared lifecycle hook. It remains inline in the batch handler.

### Files Changed

| File                                             | Change                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `skill-runtime/types.ts`                         | Add `SkillHook`, `HookResult`, `SkillHookContext`, `LlmCallContext`, `ToolCallContext`      |
| `skill-runtime/skill-executor.ts`                | Accept `hooks: SkillHook[]`, replace inline logic with hook calls, reduce loop to ~40 lines |
| `skill-runtime/skill-handler.ts`                 | Accept `hooks: SkillHook[]`, remove inline circuit breaker / blast radius / trace logic     |
| `skill-runtime/hooks/circuit-breaker-hook.ts`    | **New** — extracted from handler                                                            |
| `skill-runtime/hooks/blast-radius-hook.ts`       | **New** — extracted from handler                                                            |
| `skill-runtime/hooks/budget-enforcement-hook.ts` | **New** — extracted from executor                                                           |
| `skill-runtime/hooks/governance-hook.ts`         | **New** — extracted from executor                                                           |
| `skill-runtime/hooks/trace-persistence-hook.ts`  | **New** — extracted from handler                                                            |
| `skill-runtime/hooks/outcome-linking-hook.ts`    | **New** — extracted from handler                                                            |

### Success Condition

Logging, budget, policy, and tracing can be added or removed without editing executor core logic. `BatchSkillHandler` shares the same hook chain as `SkillHandler`.

---

## Phase 3: Runtime Policy from Deployment Config

### Principle

Make existing deployment DB fields operative. Changing a deployment's settings changes skill behavior without code edits.

### Current State

`AgentDeployment` carries `trustLevel`, `governanceSettings`, `circuitBreakerThreshold`, `maxWritesPerHour`, `inputConfig`, and `spendApprovalThreshold`. These are stored but either ignored by the skill runtime or wired manually in the handler. There is no unified policy object.

The executor hardcodes budget constants: `MAX_TOOL_CALLS = 5`, `MAX_LLM_TURNS = 6`, `MAX_TOTAL_TOKENS = 64_000`, `MAX_RUNTIME_MS = 30_000`.

**DB trust level mapping:** The deployment `trustLevel` field stores strings like `"observe"`, `"guarded"`, etc. (governance profile names). The skill governance system uses `"supervised" | "guided" | "autonomous"`. The `SkillRuntimePolicyResolver` maps between these: `observe` → `autonomous`, `guarded` → `guided`, `strict` → `supervised`, `locked` → `supervised`. This mapping already exists conceptually in `identity/governance-presets.ts`.

**Missing DB field:** `allowedModelTiers` does not currently exist on `AgentDeployment`. Phase 3 adds a Prisma migration to add `allowedModelTiers String[] @default([])` to the model. An empty array means "use system defaults" (all tiers allowed).

### SkillRuntimePolicy Type

```typescript
interface SkillRuntimePolicy {
  // Model routing
  allowedModelTiers: ModelSlot[]; // e.g. ["default", "premium"] — ceiling
  minimumModelTier?: ModelSlot; // floor override from deployment

  // Budget limits (per-execution caps)
  maxToolCalls: number; // default: 5
  maxLlmTurns: number; // default: 6
  maxTotalTokens: number; // default: 64_000
  maxRuntimeMs: number; // default: 30_000
  maxWritesPerExecution: number; // default: 5 (new constraint, per-run ceiling)

  // Rate limits (sliding window, from DB)
  maxWritesPerHour: number; // default: 20 (from deployment.maxWritesPerHour)

  // Governance
  trustLevel: TrustLevel; // mapped from deployment trust level string
  writeApprovalRequired: boolean; // force all writes through approval

  // Safety
  circuitBreakerThreshold: number; // default: 5 (consecutive failures before tripping)
  maxConcurrentExecutions: number; // default: 3 (concurrent skill runs per deployment)
}
```

### Merge Order

```
System defaults → deployment DB fields → skill frontmatter minimumModelTier (floor only)
```

- Platform sets the safe baseline
- Deployment can tighten (fewer allowed tiers, lower budgets, stricter approval) but never exceed system defaults
- Skill can express a minimum capability need but cannot override platform safety
- Invalid combinations (e.g., `minimumModelTier: "critical"` when deployment allows only `["default", "premium"]`) fail fast at bootstrap with a clear error

### SkillRuntimePolicyResolver

Reads a deployment record and produces a `SkillRuntimePolicy`:

```typescript
class SkillRuntimePolicyResolver {
  resolve(deployment: AgentDeployment, skill: SkillDefinition): SkillRuntimePolicy {
    // Start from system defaults
    // Override with deployment fields where present
    // Apply skill minimumModelTier as floor
    // Validate: minimumModelTier ∈ allowedModelTiers
    // Return frozen policy object
  }
}
```

### What Gets Replaced

| Current hardcoded constant               | Replaced by                      |
| ---------------------------------------- | -------------------------------- |
| `MAX_TOOL_CALLS = 5`                     | `policy.maxToolCalls`            |
| `MAX_LLM_TURNS = 6`                      | `policy.maxLlmTurns`             |
| `MAX_TOTAL_TOKENS = 64_000`              | `policy.maxTotalTokens`          |
| `MAX_RUNTIME_MS = 30_000`                | `policy.maxRuntimeMs`            |
| Circuit breaker threshold in handler     | `policy.circuitBreakerThreshold` |
| Blast radius concurrent limit in handler | `policy.maxConcurrentExecutions` |
| `maxWritesPerHour` wired manually        | `policy.maxWritesPerHour`        |

Note: `maxWritesPerExecution` is a new per-run constraint that does not exist today. `maxWritesPerHour` is the existing sliding-window rate limit from the DB. Both are needed — they protect against different failure modes (single runaway execution vs. sustained high write rate).

### Consistency Guarantee

After Phase 3, `SkillExecutorImpl` requires a `SkillRuntimePolicy` in its constructor. The hardcoded constants are removed. If someone tries to create an executor without a policy, they get a compile error. Consistency is structural, not optional.

### What `inputConfig` Is NOT

The `inputConfig` JSON field on `AgentDeployment` is a generic bag. It is not part of `SkillRuntimePolicy`. It stays out of the core policy object unless a clear contract for its contents is defined in a future SP.

### Future Extensions

**`writeApprovalRequired`:** Currently boolean. Switchboard may eventually need richer modes (approval only for external writes, approval above spend threshold, approval for destructive only). Boolean is correct for Phase 3. The type can evolve to a union/enum when the need is concrete.

**`spendApprovalThreshold`:** Intentionally excluded from `SkillRuntimePolicy` in Phase 3. It overlaps with the future richer write-approval modes and should be designed together with them, not bolted on as a separate field.

### Files Changed

| File                                             | Change                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `skill-runtime/types.ts`                         | Add `SkillRuntimePolicy` type                                      |
| `skill-runtime/skill-runtime-policy-resolver.ts` | **New** — reads deployment + skill, produces policy                |
| `skill-runtime/skill-executor.ts`                | Accept `policy: SkillRuntimePolicy`, replace hardcoded constants   |
| `skill-runtime/skill-handler.ts`                 | Accept `policy: SkillRuntimePolicy`, pass to hooks and executor    |
| `skill-runtime/hooks/budget-enforcement-hook.ts` | Read limits from policy instead of constants                       |
| `skill-runtime/hooks/circuit-breaker-hook.ts`    | Read threshold from policy                                         |
| `skill-runtime/hooks/blast-radius-hook.ts`       | Read max concurrent from policy                                    |
| `packages/db/prisma/schema.prisma`               | Add `allowedModelTiers String[] @default([])` to `AgentDeployment` |
| `packages/db/prisma/migrations/`                 | **New migration** for `allowedModelTiers` column                   |
| `apps/api/src/bootstrap/`                        | Resolve policy from deployment at handler construction time        |

### Success Condition

Changing deployment settings changes skill behavior without code edits. Every deployment runs the same skill differently within safe limits.

---

## Implementation Sequence

| Phase       | What                  | Depends On                            | Key Deliverable                                                                      |
| ----------- | --------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| **Phase 1** | Router bridge         | Nothing                               | `SkillTierContextBuilder`, `ResolvedModelProfile`, `minimumModelTier` in frontmatter |
| **Phase 2** | Skill lifecycle hooks | Phase 1 (hooks wrap model resolution) | `SkillHook` interface, 6 extracted hooks, ~40-line executor loop                     |
| **Phase 3** | Runtime policy        | Phase 2 (hooks consume policy)        | `SkillRuntimePolicy`, `SkillRuntimePolicyResolver`, compile-time enforcement         |

Each phase ships independently with zero breaking changes via default fallbacks.

---

## What Not To Do

- **No BizAI config DSL** — no YAML inheritance, runtime interpolation, base/override templating
- **No subagent orchestration** — skills don't share router/hooks/config yet; delegation would multiply inconsistency
- **No full runtime rewrite** — surgical refactor: identify seams, inject shared control points, preserve behavior, then widen capability
- **No speculative retry/middleware framework** — retry logic doesn't exist and shouldn't be designed ahead of need
- **No hook registration from config** — hooks are code-registered at bootstrap; config-driven composition is a future extension

## Architecture Narrative

The problem is not lack of architecture. The problem is split architecture. Switchboard already has a control plane, but only part of the system is plugged into it. The highest-leverage work is not invention — it is unification.

One-line summary: **Bridge existing runtime primitives into skill execution before building any new platform abstractions.**
