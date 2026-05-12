# Phase 3a — Deferred Hook Wirings

**Parent:** [`docs/superpowers/plans/2026-05-12-alex-medspa-phase-3a-mechanical-lifecycle.md`](../plans/2026-05-12-alex-medspa-phase-3a-mechanical-lifecycle.md)
**Status:** Open. Captured 2026-05-12 from `apps/api/src/bootstrap/lifecycle.ts:14-130`.

Phase 3a landed the mechanical conversation lifecycle layer (writer, attributor, snapshot/transition stores, stalled-sweep cron) plus a complete `bootstrapLifecycle` IoC surface with five `registerXHook` seams. The seams are _invoked_ in bootstrap but no producer fires four of them today; the fifth (5a) has a producer constructor option that no caller passes a real registrar to — the producer mechanism exists, only the wiring is missing, but the wiring itself is still a multi-file change (see 5a sketch below). The cron (`stalled-sweep`) is the only real producer wired in 3a.

Each item below is a candidate follow-up PR. The "Why deferred" lines preserve the context that lives in `apps/api/src/bootstrap/lifecycle.ts` so future work doesn't have to re-derive it.

---

## 5a — verdict-write subscription

**Seat:** `apps/api/src/bootstrap/lifecycle.ts:88-96`
**Wiring target:** `apps/api/src/bootstrap/skill-mode.ts:107` (`new PrismaGovernanceVerdictStore(...)`), `apps/chat/src/gateway/gateway-bridge.ts:120`

**Why deferred:** `PrismaGovernanceVerdictStore` already exposes an `onWrite` constructor option, but no caller (skill-mode bootstrap or chat gateway bridge) currently passes a real registrar from `app.ts` down to the store constructor. The handler is registered; the producer call site is missing.

**Smallest viable PR:** thread the `registerVerdictWriteHook` registrar from `bootstrapLifecycle` through `app.ts` into the two `PrismaGovernanceVerdictStore` instantiations, then wire each store's `onWrite` callback to invoke the registrar's callback.

---

## 5b — booking-created subscription

**Seat:** `apps/api/src/bootstrap/lifecycle.ts:98-106`
**Wiring target:** `packages/core/src/skill-runtime/tools/calendar-book.ts:187`

**Why deferred:** The only `bookingStore.create` call lives in the calendar-book tool, which does not have `conversationThreadId` in scope. Real wiring requires either (a) propagating `conversationThreadId` down to the tool boundary, or (b) a thread-by-`(contactId, organizationId)` lookup at the call site. Both cross package layers and warrant their own design discussion.

**Smallest viable PR:** add a thread lookup in `calendar-book.ts` keyed on `(contactId, organizationId)` (returning the most recent open thread, or null), and invoke the booking-created hook with the resolved threadId. Cheaper than propagating thread context end-to-end.

---

## 5c — inbound-message subscription

**Seat:** `apps/api/src/bootstrap/lifecycle.ts:108-118`
**Wiring target:** `apps/chat/src/gateway/gateway-conversation-store.ts` (`addMessage` / `persistInboundMessage`)

**Why deferred:** The chat gateway persists inbound messages, but the persistence functions do not currently expose a callback option to fire after a write commits. The bootstrap registrar wires the handler but no producer fires it.

**Smallest viable PR:** add an `onInboundMessage` callback option to `gateway-conversation-store.ts` `addMessage` (or the dedicated inbound entry point if `addMessage` is overloaded), and wire it through chat-app bootstrap to the `registerInboundMessageHook` seat.

---

## 5d — operator-takeover subscription

**Seat:** `apps/api/src/bootstrap/lifecycle.ts:120-128`
**Wiring target:** Does not exist yet.

**Why deferred:** No producer seat exists in the codebase. There is no API endpoint, no `assignedOperatorId` column on `ConversationThread`, and no actor-role on `ConversationMessage` that would let us detect operator authorship. Real wiring requires either:

1. A schema migration adding `assignedOperatorId` (or equivalent) to `ConversationThread`, plus a dashboard route that flips it; **or**
2. An explicit "operator took over" event surface (likely in the dashboard approval flow) that emits an `OperatorTakeoverEvent`.

**Smallest viable PR:** option 2 is lighter if the dashboard already has a takeover-style action (e.g., approving an escalated thread for human handling). Audit the approvals UI first. If no takeover surface exists there, fall back to option 1 (schema migration) and treat it as a Phase 3b/4 prerequisite rather than a 3a follow-up.

---

## 5e — thread-first-observation subscription

**Seat:** `apps/api/src/bootstrap/lifecycle.ts:130-140`
**Wiring target:** `apps/chat/src/gateway/gateway-conversation-store.ts` (`getOrCreateBySession`)

**Why deferred:** The brand-new-thread branch of `getOrCreateBySession` does not currently expose a callback. The bootstrap registrar wires the handler but no producer fires it. Symmetric with 5c.

**Smallest viable PR:** add an `onThreadCreated` callback option to `getOrCreateBySession` that fires only on the create branch (not the get branch), wired through chat-app bootstrap to `registerThreadInitHook`.

---

## Notes

- The Phase 3a unit tests already assert that all five registrars are invoked by `bootstrapLifecycle`, so the eventual wiring PRs cannot regress the registration step silently. New tests will be needed on the producer side.
- The `lifecycleTagging.mechanical` feature flag gates the entire layer (default off). Wiring PRs do not need to flag-gate again at the seat — the flag is read inside each `onX` handler.
- Ordering: 5a and 5e are the most self-contained (small callback additions). 5b and 5d require cross-cutting design.
- Revisit trigger: when Phase 3b (qualification signals) lands. 3b promotes the lifecycle layer from "tagging only" to "input into recommendation generation," at which point 5a (verdict-write) and 5c (inbound-message) become materially more valuable and the cost of leaving them deferred grows.
