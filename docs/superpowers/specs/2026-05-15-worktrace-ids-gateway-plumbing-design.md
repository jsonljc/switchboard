# workTraceIds Gateway Plumbing — Design Spec

**Date:** 2026-05-15
**Series:** agent-infra-parity carry-debt (PR-3.1.b)
**Type:** Refactor / data-flow bug fix
**Status:** Draft — awaiting user review before plan

## Summary

The `ConversationLifecycleTracker` does not record the WorkTrace ID produced by each assistant turn, so `ConversationEndEvent.workTraceIds` is silently `undefined` in production. `resolveBookingAttribution` then skips strong-tier matching unconditionally; every outcome attribution in production reads `attributionTier="fallback"`. This spec closes the carry-debt by plumbing `workTraceId` from `PlatformIngress.submit()` through the gateway's `onMessageRecorded` callback and into an accumulator on `ActiveSession`, then surfacing the matched ID through `BookingAttribution` so the evidence row's back-reference column is populated instead of `null`.

## Problem statement

PR-3.1 (booking-backed outcome attribution, #473) and PR-3.2a–e (canonical key, two-stage merge, pattern IDs in WorkTrace, decay cron, pilot-mode surfacing, #481–#501) shipped on the assumption that conversations would surface their `workTraceIds` to the compounding service. They don't.

**Evidence the path is broken:**

- `packages/core/src/channel-gateway/conversation-lifecycle.ts:40-49` — `ActiveSession` tracks `messages: Array<{ role, content }>` but has no `workTraceIds` field.
- `packages/core/src/channel-gateway/conversation-lifecycle.ts:119-144` — `fireEnd()` builds `ConversationEndEvent` from session fields. The event interface declares `workTraceIds?: string[]` at line 18, but `fireEnd()` never populates it.
- `packages/core/src/memory/booking-attribution.ts:46-47` — `resolveBookingAttribution` reads `event.workTraceIds && event.workTraceIds.length > 0`. Always falsy at runtime → strong tier skipped → falls through to fallback.
- `packages/core/src/memory/compounding-service.ts:285-290` — Comment in production code:

  ```ts
  // workTraceId back-reference is intentionally null in PR-3.2a:
  // BookingAttribution shape is { tier, bookingId? } only. The
  // carry-debt PR-3.1.b that plumbs workTraceIds at the gateway
  // can widen BookingAttribution to surface it and backfill this
  // field — the column is nullable to allow progression.
  workTraceId: null,
  ```

  This spec is that PR-3.1.b.

**Impact:** The 5-PR PR-3.2 investment in canonical-key-based outcome attribution silently ships with its keystone disabled. Every `outcomePatternsExtracted` metric in production is tagged `attributionTier="fallback"`, not `"strong"`. Booking-attributed pattern learning never enters the strong path.

## Goals

1. Populate `ConversationEndEvent.workTraceIds` with the WorkTrace IDs produced by each assistant turn in the session, in chronological order.
2. Surface the matched `workTraceId` on `BookingAttribution` so `DeploymentMemoryEvidence.workTraceId` is populated on the strong-tier path (replacing the explicit `null` literal).
3. Preserve existing fallback-tier behavior end-to-end. The fix activates a previously-dead branch; it does not change the fallback branch.

## Non-goals

- No schema migration. `DeploymentMemoryEvidence.workTraceId` is already a nullable column (PR-3.2a made it so anticipating this spec).
- No per-message workTraceId tracking on the `messages` array. Trace IDs are metadata; they must NOT leak into summarization prompts (which read `event.messages`).
- No prom-client camelCase/snake_case label cleanup. That is a separate PR-3.2 plan carry-debt, tracked separately.
- No `BookingAttribution` discriminated-union refactor. The widening is a single optional field, not a type-shape change.

## Design

### Architecture

The fix threads a single optional `workTraceId` field through three existing layers — no new classes, no new modules.

```
PlatformIngress.submit()        // returns ExecutionResult.traceId
        │
        ▼
ChannelGateway (assistant turn after submit returns ok=true):
    onMessageRecorded({ ..., workTraceId: result.traceId })
        │
        ▼
apps/chat/src/gateway/gateway-bridge.ts:
    lifecycleTracker.recordMessage({ ..., workTraceId: info.workTraceId })
        │
        ▼
ConversationLifecycleTracker (in core):
    session.workTraceIds.push(workTraceId)   // accumulate, preserve order
        │
        ▼ (on inactivity timeout or explicit close)
fireEnd() builds ConversationEndEvent:
    workTraceIds: session.workTraceIds.length > 0 ? session.workTraceIds : undefined
        │
        ▼
ConversationCompoundingService.processConversationEnd(event)
        │
        ▼
resolveBookingAttribution(store, event)
        │ (strong tier: store.findByWorkTraceIds(...) returns { id, workTraceId })
        ▼
    returns { tier: "strong", bookingId, workTraceId }
        │
        ▼
evidenceStore.recordEvidence({ ..., workTraceId: attribution.workTraceId ?? null })
```

User-turn messages don't carry a `workTraceId` (correct — user turns don't produce work traces). The accumulator only grows on assistant turns.

### Component changes

| Layer | File | Change |
|---|---|---|
| Gateway config type | `packages/core/src/channel-gateway/types.ts:69-77` | Add optional `workTraceId?: string` to `onMessageRecorded`'s info parameter |
| Assistant turn dispatch | `packages/core/src/channel-gateway/channel-gateway.ts:67-75` | Pass `workTraceId: response.result.traceId` |
| User turn dispatch | `packages/core/src/channel-gateway/channel-gateway.ts:140-148` | Unchanged |
| Lifecycle tracker input | `packages/core/src/channel-gateway/conversation-lifecycle.ts:29-38` (`RecordMessageInput`) | Add optional `workTraceId?: string` |
| Lifecycle tracker state | `packages/core/src/channel-gateway/conversation-lifecycle.ts:40-49` (`ActiveSession`) | Add `workTraceIds: string[]` (initialized to `[]` on session creation) |
| Lifecycle accumulator | `packages/core/src/channel-gateway/conversation-lifecycle.ts:66-90` (`recordMessage`) | Push `input.workTraceId` to the accumulator when present (no dedupe, preserve insertion order) |
| Lifecycle emission | `packages/core/src/channel-gateway/conversation-lifecycle.ts:119-144` (`fireEnd`) | Set `event.workTraceIds = session.workTraceIds.length > 0 ? session.workTraceIds : undefined` |
| Bridge forwarder | `apps/chat/src/gateway/gateway-bridge.ts:255-266` | Forward `info.workTraceId` to `lifecycleTracker.recordMessage(...)` |
| Attribution return type | `packages/core/src/memory/booking-attribution.ts:14-17` (`BookingAttribution`) | Add `workTraceId?: string` |
| Attribution resolver | `packages/core/src/memory/booking-attribution.ts:46-53` | On strong-tier hit, return `workTraceId: strong[0].workTraceId ?? undefined` |
| Evidence write site | `packages/core/src/memory/compounding-service.ts:285-290` | Replace `workTraceId: null` with `workTraceId: attribution.workTraceId ?? null`. Delete the carry-debt comment. |

### Data shapes

**`workTraceIds` field on `ConversationEndEvent`:**
- Type: `string[] | undefined` (existing — declared at `conversation-lifecycle.ts:18`)
- Emission rule: **`undefined` when empty, non-empty array when present.** Never `[]`. This preserves backward compatibility with the dozen existing test fixtures that set `workTraceIds: undefined` explicitly or omit the field.
- Ordering: **chronological by message receipt.** No dedupe — if two assistant turns share a trace (vanishingly rare), both entries are preserved. Order matters for debuggability ("which trace produced which turn").

**`workTraceId` field on `BookingAttribution`:**
- Type: `string | undefined`
- Populated only on `tier: "strong"`. `tier: "fallback"` and `tier: "none"` return `workTraceId: undefined` (fallback rows came from contact+window match, not a workTrace).
- The compounding service writes `attribution.workTraceId ?? null` to the Prisma column (the column is `String? @db.VarChar(...)` nullable).

### Error handling

- **Submit fails.** `channel-gateway.ts:77-79` already handles `response.ok === false` — sends an error message, does not call `onMessageRecorded`. No `workTraceId` is recorded for the failed turn. ✓
- **`response.result.traceId` undefined.** `ExecutionResult.traceId` is required in the schema today; if a future change makes it optional, `onMessageRecorded({ ..., workTraceId: undefined })` flows through correctly — `recordMessage` skips the accumulator push when undefined.
- **Caller forgets to pass `workTraceId`.** Optional at every layer. Existing callers that don't pass it continue to work. The lifecycle tracker simply accumulates nothing, and `fireEnd()` emits `workTraceIds: undefined` — exactly today's behavior. Backward-compatible.

### Testing

**New unit tests in `packages/core/src/__tests__/conversation-lifecycle.test.ts`:**

1. **Accumulator captures workTraceIds across multiple assistant turns** — record three messages (user, assistant w/ trace-A, user, assistant w/ trace-B), close session, assert event.workTraceIds is `["trace-A", "trace-B"]`.
2. **Order preservation across distinct traces** — assistant turns with `trace-X`, `trace-Y`, `trace-Z` in that order; event.workTraceIds is `["trace-X", "trace-Y", "trace-Z"]`. **No dedupe, order matters** (per user-requested guardrail).
3. **No traces → event.workTraceIds is undefined (not `[]`)** — record user-only messages, close session, assert `event.workTraceIds === undefined`. Pins the "never emit empty array" rule (user-requested refinement).
4. **Caller omits workTraceId on a turn → accumulator skips that turn** — record three messages where the middle assistant turn has no `workTraceId` (e.g. an early call site not yet plumbed); event.workTraceIds contains only the two turns that did carry traces, in order. Pins forward compatibility while call sites are migrated.

**Existing `booking-attribution.test.ts` updates:**

- The fixture at top of file already mocks `findByWorkTraceIds` returning `[{ id, workTraceId: "wt-B" }]` (test inspected at session time). Add an assertion that the resolved strong-tier result includes `workTraceId: "wt-B"`.

**New integration tests in `apps/chat/src/gateway/__tests__/gateway-bridge-attribution.test.ts`:**

- **Assistant turn (positive)** — gateway processes a successful submit → `info.workTraceId` from `onMessageRecorded` is forwarded to `lifecycleTracker.recordMessage` → conversation ends → `ConversationEndEvent.workTraceIds` reaches the compounding service with the trace ID intact.
- **User turn (negative invariant, reviewer-requested)** — gateway processes an inbound user message → `onMessageRecorded` fires with `role: "user"` and `info.workTraceId` is `undefined`. This pins the invariant that user turns are text events, assistant turns are execution events. Without this assertion, a future regression could silently start populating `workTraceId` on user turns — and `ActiveSession.workTraceIds` would start accumulating stale/wrong IDs without any test failing.

**`compounding-service.test.ts` updates:**

- Strong-tier path: assert the recorded evidence row's `workTraceId` field matches the `attribution.workTraceId` (not `null`). Fallback path: `workTraceId` is `null` (unchanged).

### Migration & rollout

- **No schema migration.** `DeploymentMemoryEvidence.workTraceId` is nullable; existing rows stay `null`; new strong-tier rows start carrying real values.
- **Feature flag: none required.** The change activates a previously-dead branch — it cannot regress fallback behavior because the fallback branch is untouched.
- **Backward compatibility:** every new field is optional. Test fixtures with `workTraceIds: undefined` compile and pass unchanged. Existing callers of `onMessageRecorded` / `recordMessage` that don't pass `workTraceId` keep working.

### Verification

Before merge:

- `pnpm typecheck` clean across 18 packages
- `pnpm --filter @switchboard/core test` passes (existing 3143 + 4 new tests above)
- `pnpm --filter @switchboard/chat test` passes (existing 280 + 1 integration test above)
- `pnpm --filter @switchboard/dashboard build` clean (per dashboard-build-not-in-CI doctrine, even though no dashboard files are touched)

After merge (production observability):

- Monitor `outcomePatternsExtracted` metric — `attributionTier="strong"` should start appearing where it was 0%.
- Monitor `outcomePatternsMerged` and `outcomePatternsCreated` series for cohort-rate changes (the strong tier may produce different pattern-merge behavior than fallback, since the booking match is more precise).
- New `DeploymentMemoryEvidence` rows on strong-tier should have `workTraceId IS NOT NULL`; verify in DB after first week.

## Out of scope (separate work)

- **prom-client camelCase vs snake_case label convention** — second PR-3.2 plan carry-debt; observability cleanup, separate PR.
- **`workTraceIds` deduplication policy** — if a future scaling concern surfaces (very long conversations producing thousands of entries), this can be revisited. Today's sessions cap at the 30-min inactivity window; realistic max is dozens of turns.
- **Strong-tier multi-booking deterministic order** — `BookingAttributionStore.findByWorkTraceIds` already specifies "MUST return rows ordered by createdAt ASC" (interface comment at `booking-attribution.ts:26`). The resolver's "first row wins" is unchanged.

## Risks

- **Risk: per-turn workTraceId leakage into summarization prompts.** Mitigation: the accumulator is a separate `workTraceIds: string[]` field on `ActiveSession`, never inlined into `ActiveSession.messages[]`. The summarization prompt reads `event.messages` (text only). ✓ Audited.
- **Risk: a stale `traceId` is reused across sessions.** Not possible — each `PlatformIngress.submit()` call produces a fresh trace; the gateway captures it once at response time and never re-emits.
- **Risk: backward-compat break in test fixtures.** Mitigated by emitting `undefined` (not `[]`) when empty. All existing fixtures set `workTraceIds: undefined` explicitly or omit the field; both compile under `string[] | undefined`.

## Open questions

None. The user has confirmed (a) include the `BookingAttribution` widening in this PR, (b) emit `undefined` not `[]` for empty accumulators, (c) preserve insertion order with no dedupe.
