# Agent Infrastructure Parity — Design Spec

> Context: Comparative analysis of Switchboard's agent infrastructure (Alex, Riley) against Meta's BizAI stack identified four gaps. The existing foundation is stronger than initially assessed — conversation lifecycle tracking, conversion event bus, CompoundingService with LLM-driven fact extraction, DeploymentMemory with statistical accumulation, and a 3-tier model router are all shipped. These PRs activate dormant capabilities and close the remaining gaps.

> Governance posture: Switchboard's governance layer (policy engine, audit ledger, approval workflows) is retained as-is but is not the selling point for the target market (beauty spa / aesthetic clinic SMBs). The differentiator is vertical intelligence, memory that compounds, and a conversion loop that gets smarter every week. These PRs invest in that direction.

---

## PR Sequence

Ship in dependency order. PR-1 and PR-2 are mechanical (no design decisions). PR-3 and PR-4 involve real decisions and are scoped conservatively.

| PR    | Title                                                                                  | Depends on | Risk          |
| ----- | -------------------------------------------------------------------------------------- | ---------- | ------------- |
| PR-1  | Wire knowledgeStore into ConversationCompoundingService                                | None       | Low-to-medium |
| PR-2  | Parallel safe tool calls in skill executor                                             | None       | Medium        |
| PR-3  | Outcome-informed context injection (write + read sides)                                | PR-1       | Medium        |
| PR-4  | Provider-agnostic tool-calling adapter boundary (type boundary only — no fallback)     | None       | Low-to-medium |
| PR-4B | Fallback router + retryable-error consumption + agent-runtime adapter migration (deferred) | PR-4   | Medium        |

---

## PR-1: Wire knowledgeStore into ConversationCompoundingService

### Goal

Activate the existing learned-FAQ promotion path by passing `knowledgeStore` into `ConversationCompoundingService` from the gateway bridge.

### What changes

- Update `gateway-bridge.ts` or equivalent composition root to inject `knowledgeStore`.
- Do not change FAQ promotion thresholds.
- Do not change draft review behavior.
- Do not change agent prompt behavior yet.

### Expected effect

When repeated customer questions cross the existing promotion threshold, the system can create learned `KnowledgeChunk` drafts instead of silently skipping promotion.

### Scope guard

This PR only activates an existing path. It does not make Alex automatically change behavior based on outcomes, and it does not introduce autonomous learning.

### Risk

Low-to-medium. The code path exists, but turning it on may reveal data-shape or duplicate-writing issues in production-like flows.

### Tests

- Constructor/wiring test proving `ConversationCompoundingService` receives `knowledgeStore`.
- Integration test where repeated FAQ observations trigger learned knowledge draft creation.
- Regression test where missing/disabled `knowledgeStore` still fails gracefully.
- Assert created learned chunks remain draft/pending, not automatically trusted/live.

---

## PR-2: Parallel safe tool calls in skill executor

### Goal

Reduce latency by executing independent, non-mutating tool calls from the same LLM turn concurrently, while preserving governance, ordering, and budget correctness.

### What changes

- Refactor same-turn tool execution to support parallel execution.
- Preserve tool result ordering in message history to match the original `tool_use` block order.
- Preserve per-tool governance checks and after-hooks.
- Keep budget accounting deterministic under concurrency.
- Only parallelize tools that are safe to run concurrently.

### Concurrency rule

- Read-only tools (`effectCategory: "read"`) may run in parallel.
- Mutating tools (`write`, `external_send`, `external_mutation`, `irreversible`) should remain serialized unless explicitly marked as concurrency-safe.
- Mixed batches should use a safe scheduler:
  - Run read-only tools in parallel.
  - Serialize mutating tools.
  - Preserve final result order before sending back to the LLM.

### Scheduler invariant

Every tool call must reserve budget before execution starts, not after it completes.

### Scope guard

This PR does not add sub-agent spawning, multi-agent orchestration, speculative execution, or new tool selection behavior. It only changes execution scheduling for tool calls the LLM already requested in one turn.

### Risk

Medium. Main risks are race conditions in mutation budgets, duplicated writes, inconsistent governance decisions, and out-of-order tool results. The implementation should prefer a concurrency-aware scheduler over a blanket `Promise.all()`.

### Tests

- Unit test: multiple read-only tool calls execute concurrently.
- Unit test: tool results are returned in original positional order even when completion order differs.
- Unit test: mutating tools are serialized, not raced.
- Unit test: mixed read/write batch executes safely.
- Unit test: budget limits are enforced correctly under concurrent execution.
- Regression test: single tool call behavior unchanged.
- Regression test: failed tool call does not drop successful sibling tool results unless existing behavior requires full-turn failure.

---

## PR-3: Outcome-informed context injection

### Goal

Use successful conversation outcomes to give Alex better context in future conversations, without changing retrieval ranking or forcing behavior.

### What changes

- When the LLM summarization outcome is `booked`, extract pattern candidates from the existing `processConversationEnd` LLM extraction call (no second LLM call) and write them into `DeploymentMemory` with `category: "pattern"` via the existing `findByCategory` → similarity → `incrementConfidence`/`create` path (the same shape `trackQuestion` uses for FAQ promotion). Reuse the existing `sourceCount`/`confidence` accumulation path so promotion thresholds match the rest of the memory system. Note: trigger gating reads `summarization.outcome` (the LLM-inferred outcome), not `ConversationEndEvent.endReason` (the lifecycle reason — different field).
- At skill execution time, inject only high-confidence, relevant patterns into Alex's context with provenance, confidence, and freshness metadata.
- Keep the injected context advisory, not mandatory.
- `ContextBuilder` is a stateful service, not a per-call store. Inject it through a new `SkillServices` slot, separate from `SkillStores`. Do not place it on the `stores` map.
- The Alex builder always provides `OUTCOME_PATTERNS` as a string parameter (empty string when no patterns surface). The current `interpolate()` template engine only supports plain `{{PARAM}}` substitution — do not introduce Mustache section syntax. The builder owns escaping pattern text so attacker-controlled pattern content cannot inject prompt directives.

The write path is the missing half of the memory loop. Without it, the `category: "pattern"` filter in `ContextBuilder` returns the empty set and the entire PR is a runtime no-op.

### Examples of injected patterns

- "Customers often ask about downtime before booking this treatment."
- "Price-sensitive leads convert better when package options are explained early."
- "Customers who mention acne scars usually ask about expected number of sessions."
- "Morning appointment preference appears frequently among booked leads."

### Context priority order

Outcome-informed patterns are advisory and must never override higher-priority context.

Priority order:

1. Safety / regulatory policy
2. Current business facts and operator corrections
3. Customer-specific known preferences
4. Outcome-informed booked-outcome patterns
5. Generic skill instructions

### What should NOT happen

- Do not auto-boost RAG chunks yet.
- Do not rewrite core skill instructions.
- Do not force Alex to copy previous booked-outcome phrases.
- Do not optimize only for bookings at the expense of safety, accuracy, or customer fit.
- Do not inject customer-specific facts into unrelated conversations.

### Scope guard

This PR introduces outcome-aware context only. It does not create autonomous RL, retrieval re-ranking, or automatic behavior policy changes.

### Confidence threshold

Use the existing `DeploymentMemory` confidence formula: `min(0.95, 0.5 + 0.15 * ln(sourceCount))`. A pattern must have 3+ source conversations and 0.66+ confidence to be injected into skill context. These are the existing surfacing thresholds — do not invent new ones.

### Risk

Medium. The main risk is overfitting from weak signals, so only patterns that cross the existing confidence threshold should be surfaced.

### Freshness contract

`ContextBuilderDeploymentMemoryStore.listHighConfidence` must return `lastSeenAt` on every entry. Ordering of the returned list must remain the same as today (confidence/sourceCount-based); adding the field must not change sort order. Synthesizing `lastSeenAt = new Date()` at read time is not acceptable — freshness signals must reflect the actual `DeploymentMemory.lastSeenAt` column already populated by the existing memory write path.

### Tests

- Booked conversations write pattern-category memories; non-booked / lost / escalated conversations do not.
- Repeated booked observations increment `sourceCount` via the existing memory upsert path; they do not create duplicate entries.
- Low-confidence patterns are not injected.
- Injected patterns are relevant to the current treatment / service context.
- Stale outcome patterns are not injected if newer contradictory business facts exist (uses real `lastSeenAt`, not synthesized).
- Outcome patterns never override explicit operator corrections.
- Alex still respects policy, business facts, and operator corrections above outcome patterns.
- Builder renders `OUTCOME_PATTERNS: ""` cleanly when no patterns surface (template does not leak unrendered placeholders).
- `listHighConfidence` returns the same ordering as before `lastSeenAt` was added.

### Future (not this PR)

PR-3B: outcome-weighted retrieval, behind a feature flag. Only after inspecting real outcome signal quality.

---

## PR-4: Provider-agnostic tool-calling adapter boundary

### Goal

Decouple the skill executor from Anthropic-specific types by introducing a provider-neutral adapter boundary. **No behavior change.** Fallback routing is explicitly deferred to PR-4B.

### What changes

- Define a provider-agnostic `ToolCallingLLMAdapter` interface.
- Define a provider-neutral representation for:
  - Messages
  - Tool definitions
  - Tool calls
  - Tool results
  - Stop reasons
  - Usage/cost metadata
  - Retryable vs non-retryable errors (the type is defined; fallback routing that consumes it is PR-4B)
- Separate Anthropic-specific message/tool types from the core skill executor.
- Keep Anthropic as the only wired provider. Production traffic stays on Anthropic via the new adapter.
- Add one Anthropic concrete adapter and one test double adapter to prove the abstraction works.
- The skill-runtime adapter at `packages/core/src/skill-runtime/tool-calling-adapter.ts` keeps backward-compatible re-exports so existing callers don't break.

### Unknown-shape handling

Unknown stop reasons and unknown content block types must surface as **typed adapter errors at the adapter boundary**, not be silently coerced to text, empty text, or a "default" case. This keeps provider mismatches visible to the executor instead of hiding them in downstream logic.

### Explicitly out of scope (deferred to PR-4B)

- Fallback router that switches providers on failure.
- Feature flag gating fallback behavior.
- Runtime consumption of `isRetryableError` / `LLMError` shapes.
- Migration of `packages/core/src/agent-runtime/anthropic-adapter.ts` (the chat-reply path adapter, used by `ConversationCompoundingService`). PR-4 only touches the skill-runtime tool-calling path. The agent-runtime adapter remains Anthropic-coupled until PR-4B.

### What should NOT happen

- Do not silently change tool behavior between providers.
- Do not expose provider-specific response shapes beyond the adapter boundary.
- Do not assume all providers support identical tool-call semantics, streaming chunks, stop reasons, or tool result formats.
- Do not coerce unknown stop reasons or unknown content blocks into safe defaults — throw a typed adapter error so the executor sees the mismatch.

### Scope guard

This PR introduces the type boundary only. It does not optimize for model cost, change model selection behavior, route conversations to a second provider, or implement fallback routing.

### Risk

Medium. The main risk is creating a shallow abstraction that renames Anthropic concepts instead of creating a genuinely provider-neutral contract.

### Tests

- Anthropic remains the only wired provider.
- Tool-calling adapter interface runs through the provider-neutral executor path.
- Tool-use block translation round-trips faithfully (not just text-only responses).
- Tool result formatting remains stable across the adapter boundary.
- Unknown stop reasons surface as a typed adapter error, not silent default.
- Unknown content block types surface as a typed adapter error, not silent empty text.
- Existing Anthropic behavior is unchanged end-to-end.
- Contract test proving the skill executor imports no Anthropic SDK types.

### Future (not this PR)

PR-4B (deferred): wire fallback router that consumes `isRetryableError`, gate it behind a feature flag, define fallback triggers (timeout, 5xx, rate-limit, unavailable), and migrate `agent-runtime/anthropic-adapter.ts` to share the same neutral boundary. PR-4B picks a first real fallback provider (likely OpenAI for tool-calling quality).
