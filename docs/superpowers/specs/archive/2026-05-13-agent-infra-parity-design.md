# Agent Infrastructure Parity — Design Spec

> Context: Comparative analysis of Switchboard's agent infrastructure (Alex, Riley) against Meta's BizAI stack identified four gaps. The existing foundation is stronger than initially assessed — conversation lifecycle tracking, conversion event bus, CompoundingService with LLM-driven fact extraction, DeploymentMemory with statistical accumulation, and a 3-tier model router are all shipped. These PRs activate dormant capabilities and close the remaining gaps.

> Governance posture: Switchboard's governance layer (policy engine, audit ledger, approval workflows) is retained as-is but is not the selling point for the target market (beauty spa / aesthetic clinic SMBs). The differentiator is vertical intelligence, memory that compounds, and a conversion loop that gets smarter every week. These PRs invest in that direction.

---

## PR Sequence

Ship in dependency order. PR-1 is mechanical (no design decisions). PR-3 and PR-4 involve real decisions and are scoped conservatively. PR-2 was scoped as mechanical but deferred — see the PR-2 section below for the deferral rationale.

| PR     | Title                                                                                                                                                                                                     | Depends on | Risk          | Status   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------- | -------- |
| PR-1   | Wire knowledgeStore into ConversationCompoundingService                                                                                                                                                   | None       | Low-to-medium | Shipped  |
| PR-2   | Parallel safe tool calls in skill executor                                                                                                                                                                | None       | Medium        | Deferred |
| PR-3   | Outcome-informed context injection (write + read sides)                                                                                                                                                   | PR-1       | Medium        | Shipped  |
| PR-3.1 | Signal upgrade: booking-backed outcome attribution + bookingId propagation fix + C1 metrics                                                                                                               | PR-3       | Medium        | Shipped  |
| PR-3.2 | Learning-quality controls: canonical keys, two-stage merge, decay cron, pattern IDs in trace, pilot thresholds — see [`2026-05-14-agent-infra-pr3.2-design.md`](./2026-05-14-agent-infra-pr3.2-design.md) | PR-3.1     | Medium-high   | Shipped  |
| PR-4   | Provider-neutral executor boundary, no fallback                                                                                                                                                           | None       | Low-to-medium | Shipped  |
| PR-4B  | Fallback router + retryable-error consumption + agent-runtime adapter migration                                                                                                                           | PR-4       | Medium        | Deferred |

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

> **Status: Deferred (as of 2026-05-15).** The design below was preserved through code review and a full task decomposition in the implementation plan, but the implementation never landed. The skill executor at `packages/core/src/skill-runtime/skill-executor.ts` still serializes tool calls sequentially (`for (const toolUse of toolUseBlocks)`). Deferral was driven by launch-priority pressure on the memory-loop work (PR-3 / PR-3.1 / PR-3.2) and the provider-neutral boundary (PR-4); latency from serialized read-only tool calls has not been observed as a pilot-scale bottleneck. Pick this up when (a) Alex's tool repertoire grows past the current handful of mostly-serialized writes, or (b) tail latency on read-heavy turns becomes a measurable complaint.

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
- Repeated booked observations increment `sourceCount` via the existing `findByCategory` → similarity → `incrementConfidence` path; they do not create duplicate entries.
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

## PR-3.1: Signal upgrade — booking-backed outcome attribution

> Added 2026-05-14 after a post-PR-3 architectural review. PR-3 ships the plumbing (pattern write path, ContextBuilder injection, Alex parameter, escaping). PR-3.1 makes the loop trustworthy by replacing the LLM verdict with hard booking evidence, fixing two silently-broken adjacent paths, and adding the minimum metrics needed to observe whether the loop is producing signal at all.

### Goal

Stop treating `summarization.outcome === "booked"` as the source of truth for whether a conversation booked. Gate outcome-pattern extraction on actual `Booking` evidence instead.

### What changes

**1. Booking-backed outcome attribution in `ConversationCompoundingService.processConversationEnd`.**

Before the existing `shouldExtractOutcomePatterns(summarization.outcome)` check, resolve booking attribution using a two-tier policy:

1. **Strong attribution.** A `Booking` row whose `workTraceId` links to a tool execution that ran during this conversation. Preferred when the work-trace linkage is available end-to-end.
2. **Fallback attribution.** If work-trace linkage is unavailable, look up a `Booking` for the same `organizationId + contactId` created in the post-conversation window — `conversation end` to `conversation end + 24h`. The pre-conversation half of the window is intentionally excluded: bookings before the conversation ended are more likely caused by an earlier touchpoint, and the post-conversation direction is the cleaner causal signal. (Per-deployment scoping is not enforced at this query: neither `Booking` nor `Contact` carries a `deploymentId` column today. A single contact rarely converses with multiple deployments inside one organization, so the contact filter is sufficient in practice. If multi-deployment-per-contact becomes common, a schema migration to add `Booking.deploymentId` would be a separate PR.)

Only conversations with booking-backed attribution may write `category: "pattern"` outcome memories. The fallback path is treated as weaker evidence and must be observable separately (see metrics below).

The existing summarization LLM call may still provide candidate pattern phrasing as input to the extraction prompt, but it is no longer the authority for whether the outcome was booked.

**2. Persist `bookingId` on `ConversionRecord`.**

`calendar-book.booking.create` writes a `Booking` row and emits a `"booked"` `OutboxEvent` carrying `bookingId` in `metadata`. `OutboxPublisher` already passes `metadata` through to the emitted `ConversionEvent` (verified by `packages/core/src/events/outbox-publisher.test.ts:110-123`) — so `event.metadata.bookingId` is reachable downstream. The gap is at the store: `PrismaConversionRecordStore.record()` (`packages/db/src/stores/prisma-conversion-record-store.ts:49-67`) does not extract `bookingId` from `event.metadata` to populate the dedicated indexed `ConversionRecord.bookingId` column, even though the column exists (`packages/db/prisma/schema.prisma:1845-1865`).

PR-3.1 closes this gap so `bookingId` is queryable as a first-class indexed column, not only as JSON metadata. The booking-backed attribution query benefits from this directly; the column has been silently unused otherwise.

**3. Filter `category: "pattern"` out of `learnedFacts` in `ContextBuilder`.**

PR-3 added `outcomePatternContext` to `BuiltContext` but did not change the generic `learnedFacts` projection, which iterates every high-confidence memory unfiltered. After PR-3, pattern-category rows therefore appear twice in skill context: once as advisory `outcomePatternContext` (correctly), and once as a "learned fact" (incorrectly — patterns are not facts and were never meant to flow through that channel). PR-3.1 fixes the leak: `learnedFacts` projection skips `m.category === "pattern"`, leaving patterns to flow only through `outcomePatternContext` where their advisory framing and provenance metadata are preserved.

**4. Defensive parsing of LLM-returned `extraction.patterns`.**

PR-3's `processConversationEnd` trusts `extraction.patterns` as-returned by `JSON.parse(raw)`. Because patterns become durable memory and (after PR-3.1) injected prompt context for future conversations, defensive parsing is required: filter to entries that are actually strings, cap the array length, and cap per-pattern character length. This bounds prompt-injection surface, prevents accidental memory bloat from a malformed LLM response, and pairs with the existing `escapePromptText` sentinel-stripping in `outcome-pattern-extractor.ts`.

**5. C1 observability: minimum metrics to falsify the loop.**

Add Prometheus counters and one histogram to `SwitchboardMetrics` in `packages/core/src/telemetry/metrics.ts`, wired in `apps/api/src/metrics.ts`:

- `switchboard_outcome_patterns_extracted_total{deployment_id, attribution_tier}` — incremented per pattern at `trackPattern` entry, labeled `strong` or `fallback`.
- `switchboard_outcome_patterns_merged_total{deployment_id}` — incremented when an extracted pattern hits the similarity threshold against an existing entry and increments confidence.
- `switchboard_outcome_patterns_created_total{deployment_id}` — incremented when an extracted pattern does not match and a new row is created.
- `switchboard_outcome_patterns_surfaced_total{deployment_id}` — incremented by `ContextBuilder` each time at least one pattern is injected into a skill execution.
- `switchboard_outcome_pattern_confidence` — histogram observed at write time on the post-increment confidence value, default latency buckets replaced with a 0.0–1.0 distribution.

No conversion-lift metric in this PR. Lift measurement requires a settled extraction baseline and is deferred to PR-3.2 or later.

### Scope guard

- No changes to pattern surfacing thresholds (`SURFACING_THRESHOLD` stays as-is).
- No changes to similarity threshold or merge behavior.
- No decay execution wiring (deferred to PR-3.2).
- No canonicalization job (deferred to PR-3.2).
- No conversion-lift measurement (deferred).
- No changes to Alex prompt template.

### Confidence threshold

Unchanged from PR-3.

### Risk

Medium. The main risks are (a) the booking-attribution query becoming an N+1 against `processConversationEnd` and (b) the fallback window incorrectly attributing bookings caused by earlier or unrelated touchpoints. Mitigation: attribution-tier label on the metric so fallback contribution is visible, and a single indexed query on `(organizationId, contactId, createdAt)` per conversation end.

### Tests

- Booked conversation with `workTraceId` linkage writes patterns under attribution tier `strong`.
- Booked conversation without `workTraceId` linkage but with a `Booking` in the post-conversation window writes patterns under attribution tier `fallback`.
- Booked conversation with no matching `Booking` in either tier writes no patterns, even if `summarization.outcome === "booked"`.
- LLM-classified-booked conversation with no real `Booking` row does **not** produce pattern memories. This is the regression test for the original signal.
- Non-booked outcomes (`lost`, `escalated`, `pending`) write no patterns.
- `Booking` outside the post-conversation window (before conversation end, or more than 24h after) does not attribute.
- `PrismaConversionRecordStore.record()` extracts `bookingId` from `event.metadata` and persists it to the dedicated `ConversionRecord.bookingId` column when present.
- A `ConversionRecord` written without `bookingId` in metadata leaves the column null (no false positives).
- Each metric increments on its trigger path and carries the documented labels.
- `attribution_tier` label is `strong` vs `fallback` and never `unknown`.
- `learnedFacts` returned by `ContextBuilder.build()` excludes `category: "pattern"` rows even when those rows would otherwise pass the high-confidence filter.
- The same pattern row appears in `outcomePatternContext` only — not duplicated as a `learnedFact`.
- `extraction.patterns` from a malformed LLM response (non-array, mixed types, oversized array, oversized string) is parsed defensively: non-strings dropped, array capped at 5 entries, each entry capped at 500 characters; no pattern memory is written from invalid input.

### Spec amendment note

This subsection supersedes the gating signal originally documented in PR-3:

> "Note: trigger gating reads `summarization.outcome` (the LLM-inferred outcome), not `ConversationEndEvent.endReason` (the lifecycle reason — different field)."

After PR-3.1, gating reads booking-backed attribution. `summarization.outcome` remains a side-channel for candidate pattern _phrasing_, not for _whether the conversation booked_.

### Release ordering

**Post-merge state (2026-05-14):** PR-3 merged to `main` as `f19758c8` (#461) without the feature flag this section originally recommended. Switchboard is pre-launch — no production WhatsApp/chat traffic is exercising `ConversationCompoundingService.processConversationEnd` yet (launch is gated by Meta App Review). The "no LLM-classified pattern rows in durable production memory" invariant therefore holds by accident: there is no production traffic.

**Binding requirement (still active):** PR-3.1 must merge and deploy before either of the following: (a) the WhatsApp webhook intake handles its first non-internal session in `gateway-bridge.ts`, or (b) Meta App Review approves the production app. Whichever comes first is the deadline. After that point, every LLM-classified-booked transcript persists a pattern row regardless of any subsequent PR-3.1 gate — the PR-3 write path is gated only on `summarization.outcome === "booked"` (the exact signal PR-3.1 is correcting), so once real conversations flow, the durable-memory damage starts and is not reversible by a later gate.

**One-time data hygiene at PR-3.1 deploy:** any `DeploymentMemory` rows with `category = "pattern"` written between PR-3's deploy and PR-3.1's deploy were created by the un-gated path. These rows are LLM-classified, not booking-backed, and should be purged at PR-3.1 deploy time. A single `DELETE FROM "DeploymentMemory" WHERE category = 'pattern' AND "createdAt" < <pr-3.1-deploy-time>` covers it; the post-deploy write path will re-populate against real booking evidence.

**Why the original guidance is preserved below:** the next two paragraphs document the reasoning that _would_ have driven the feature-flag approach if PR-3 had been held. Keep them as the rationale for the binding requirement above and as a record of how the gap was identified.

The PR-3 write path emits `category: "pattern"` memories gated only on `summarization.outcome === "booked"`, which is the exact signal PR-3.1 is correcting. Merging and deploying PR-3 into a live system would write durable LLM-classified booking patterns to production memory; those rows persist regardless of any subsequent PR-3.1 gate.

This reverses the earlier "ship PR-3 as-is and stack PR-3.1" plan documented in the PR sequence table above — that plan was correct on narrative clarity but wrong on durable-memory safety. Code-review verification (see `feedback_ship_clean_not_followup` memory: ship clean, don't defer) flagged the gap, but only after PR-3 had already merged; pre-launch state is what kept it harmless.

### Next (scoped separately as PR-3.2)

PR-3.2 closes the **compounding-quality** loop: canonical pattern keys, two-stage merge, lower pilot-scale surfacing thresholds (flagged), decay cron, and pattern IDs in prompt + trace for later falsifiability. Full design in [`2026-05-14-agent-infra-pr3.2-design.md`](./2026-05-14-agent-infra-pr3.2-design.md). The clean distinction: PR-3 + PR-3.1 make the loop **correct and trustworthy**; PR-3.2 makes the loop **useful at pilot scale** by preventing fragmentation from keeping `outcomePatternsSurfaced_total` flat while extraction/creation counters rise.

---

## PR-4: Provider-neutral executor boundary, no fallback

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
