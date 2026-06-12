# F5: Structured Alex booking outcome (close the booking to outcome ledger)

Status: design
Date: 2026-06-11
Audit: `docs/audits/2026-06-10-alex-capability-audit/README.md` finding F5 (Wave 1, item 6)
Branch: `feat/alex-booking-outcome`

## 1. Problem

The north-star revenue loop (audit section 5) is: Riley reallocates spend, leads
arrive, **Alex** converts and books, booking outcomes feed attribution and
learning, Mira refreshes creative on winners, Riley reallocates.

The booking **value** leg is genuinely closed: a successful
`calendar-book.booking.create` emits a `booked` outbox event, which becomes a
`ConversionRecord` (carrying `bookingId`, `value`, `sourceCampaignId`,
`agentDeploymentId`), which feeds Riley's `trueRoas`. That part works and is not
touched here.

What is missing (F5) is the **per-action outcome ledger** the cockpit and Riley
attribution would join on to say "Alex converted this lead, here is the trace and
the revenue." Two concrete gaps, both verified against current `origin/main`
(`cbefaf20`):

1. **No booking branch.** `OutcomeLinker` (`packages/core/src/skill-runtime/outcome-linker.ts`)
   only maps `crm-write/stage.update` to the ad-hoc string `stage_<x>` and
   `crm-write/activity.log` opt-out to `opt_out`. There is no branch that links a
   successful booking to a typed outcome.

2. **The producer is not energized.** `OutcomeLinker` / `OutcomeLinkingHook` are
   **dead code**: the only construction site is `outcome-linker.test.ts`. The hook
   is absent from the runtime hook list (`apps/api/src/bootstrap/skill-mode.ts:596-601`),
   so `ExecutionTrace.linkedOutcome*` is **always NULL** in production today, even
   for stage updates and opt-outs. Shipping only a booking branch would add an
   inert producer (the "assembled, not energized" trap the audit repeatedly flags).

Net: `ExecutionTrace` for an Alex booking turn carries `linkedOutcome* = NULL`, and
nothing ties the trace to the booking outcome in a typed, joinable way.

## 2. Goal / done when

A successful Alex booking writes a structured, typed, idempotent outcome onto the
canonical WorkTrace (`ExecutionTrace`), and a shipped read-model join surfaces
"Alex converted this lead, here is the trace and the revenue" where today it
surfaces nothing. Proven by a producer to consumer test. Typecheck and tests
green. No schema migration (verified: the value `booked` already exists in
`InteractionOutcomeSchema`; no new column is needed).

## 3. Verified substrate

- `ExecutionTrace` (`schema.prisma`) has `linkedOutcomeId/Type/Result` (all
  `String?`). Its `id` is a fresh `createId()` cuid (trace-persistence-hook.ts:69),
  **not** `workUnitId`. So `Booking.workTraceId != ExecutionTrace.id`; the join
  must go trace to booking via `linkedOutcomeId = bookingId` (which it does).
- `Booking` carries `workTraceId`, `contactId`, `opportunityId`, `service`,
  `startsAt`, `status`.
- `ConversionRecord` carries `bookingId` (indexed), `value`, `sourceCampaignId`,
  `sourceAdId`, `agentDeploymentId`, `occurredAt`, `type` (`booked`). It is written
  async via outbox processing, so it may not exist yet when the trace is written
  (the revenue leg is a left join, honest absence until settled).
- `calendar-book.booking.create` returns `ok({ bookingId, ... }, { entityState: {
bookingId, status: "confirmed" } })` on success; `ToolResult.status === "success"`
  is the clean success discriminator (failures are `error`/`denied`).
- `TracePersistenceHook` is the **always-invoked** telemetry recorder (the
  executor's dedicated 8th arg, `skill-executor.ts:492`), run AFTER
  `runAfterSkillHooks` (line 479). It builds the trace from `result.toolCalls` and
  calls `store.create`, but never sets `linkedOutcome*`, and `store.create` does not
  map those columns.
- `skillSlug` for an Alex run is `"alex"` (`skills/alex/SKILL.md:3`); the booking
  tool is Alex-exclusive, so a booking outcome is Alex-attributed by construction.
- The learning leg already detects bookings: `compounding-service.ts:238-245`
  ("booking-backed gating supersedes summarization.outcome as the source of truth
  for whether a conversation booked").

## 4. Design decisions (resolved autonomously)

**D1: Carry the outcome as a typed `linkedOutcome` on `ExecutionTrace`, valued
with the `InteractionOutcome` enum (`booked`), not `RecommendationOutcome`.**
`RecommendationOutcome` is structurally a Riley artifact: it requires a
`recommendationId` (unique FK to `PendingActionRecord`, cascade delete) and its
attribution store only reads `sourceAgent:"riley"` recommendation records. An Alex
booking is a direct action with no `PendingActionRecord`, so writing a
`RecommendationOutcome` would mean fabricating a recommendation row. Wrong
semantics, heavy change. `ExecutionTrace.linkedOutcome*` is the existing per-action
outcome field, owned by the existing (if dead) `OutcomeLinker` whose evidence the
audit cites directly. Outcome shape: `{ id: bookingId, type: "booking", result:
"booked" }`. `result: "booked"` is the typed `InteractionOutcome` value.

**D2: Energize the producer through `TracePersistenceHook` (compute at create),
not by wiring the dead `OutcomeLinkingHook`.** The hook fires `afterSkill` via
`runAfterSkillHooks` (line 479), which runs BEFORE the recorder persists the trace
(line 492). So a hook calling the post-create `linkOutcome` updateMany would hit
`count === 0` (trace row absent), throw `StaleVersionError`, and silently lose the
outcome. Instead, `TracePersistenceHook` (already always invoked, already holds
`result.toolCalls`) derives the outcome and persists `linkedOutcome*` inline in the
single `trace.create`. This is atomic, idempotent, has no ordering or
`StaleVersionError` fragility, and energizes stage and opt-out linking too (a
latent-correct, benign improvement, since `linkedOutcome` writing is a wrapped
annotation).

**D3: Idempotency by construction.** The outcome is part of the single trace
`create`, keyed by the trace id; there is no separate write to double-fire. The
booking id is reused as `linkedOutcomeId` (no recompute, no second row). A booking
that fails or is retried produces no `entityState.bookingId`, so no outcome is
linked. (Honors the reuse-the-identity, no-double-write requirement.)

**D4: Ship the join read-model as the consumer (`PrismaBookingOutcomeLedgerStore`).**
The "outcome ledger the cockpit and Riley attribution would join on" is shipped as
an org-scoped db read-model that joins `ExecutionTrace` (where
`linkedOutcomeType = "booking"`) to `Booking` (by `id = linkedOutcomeId`) to
`ConversionRecord` (by `bookingId`), returning one `BookingOutcomeLedgerRow` per
Alex booking outcome: trace identity (`traceId`, `deploymentId`, `skillSlug`),
typed `outcome: "booked"`, the lead (`bookingId`, `contactId`, `service`,
`bookingStatus`, `bookedAt`), and revenue (`value`, `sourceCampaignId`,
`sourceAdId`, `occurredAt`; null until the conversion settles). Three org-scoped
queries assembled in TS (no Prisma relation exists between these models, since
`linkedOutcomeId` is a bare string), tenant-safe on every leg. This is the F4
pattern: ship the read with its producer, test from real producer output.

**D5: agentRole attribution via `skillSlug`.** The ledger surfaces the trace's
`skillSlug` (`"alex"`); booking outcomes are Alex-exclusive, so no fabricated
`agentRole` field is introduced. This satisfies "agentRole:alex / booked" honestly.

**D6: No migration.** `linkedOutcomeType` is widened from
`"opportunity" | "task" | "campaign"` to add `"booking"` as a TypeScript union only
(the DB column is `String?`). `booked` already exists in `InteractionOutcomeSchema`.
The ledger is read-only over existing tables. Confirmed: no schema change.

**D7: Deferred, documented.** (a) Wiring the ledger into the cockpit pipeline/wins
UI is F10 (explicitly out of scope here). The ledger is the consumer contract F10
will call. (b) Feeding Alex's booked-treatment/objection signals into Mira's brief
is a focused follow-up; the conversation learning loop already detects bookings
(`compounding-service.ts:238-245`), so this is enrichment, not a gap that blocks F5.

## 5. Components and data flow

Producer (write):

1. `deriveLinkedOutcome(toolCalls, traceId): LinkedOutcome | null` (pure function in
   `outcome-linker.ts`). Priority order: booking (highest, terminal), then
   stage.update, then opt-out. Booking branch: `toolId === "calendar-book" &&
operation === "booking.create" && result.status === "success" &&
entityState.bookingId` yields `{ id: bookingId, type: "booking", result:
"booked" }`.
2. `OutcomeLinker.linkFromToolCalls` refactored to delegate to
   `deriveLinkedOutcome` then call `linkOutcome` (preserves the class, its 6 tests,
   and the post-create updateMany path with its `count === 0` guard).
3. `TracePersistenceHook.afterSkill` calls `deriveLinkedOutcome(result.toolCalls,
trace.id)` and sets `linkedOutcomeId/Type/Result` on the trace before
   `store.create`.
4. `PrismaExecutionTraceStore.create` maps the three `linkedOutcome*` columns.
5. `SkillExecutionTrace.linkedOutcomeType` union widened to include `"booking"`.

Consumer (read / join): 6. `PrismaBookingOutcomeLedgerStore.listForOrg({ orgId, limit })` returns
`BookingOutcomeLedgerRow[]`, exported from `@switchboard/db`.

Flow: Alex books, `booking.create` succeeds, the turn ends, the executor's recorder
(`TracePersistenceHook`) derives `{booking, booked, bookingId}` and persists it on
the `ExecutionTrace`. Separately and asynchronously, the `booked` outbox event
becomes a `ConversionRecord`. The ledger read joins them by `bookingId`.

## 6. Consumer sweep (no swallow)

Readers of `linkedOutcomeType`/`linkedOutcomeResult`: the core type
(`SkillExecutionTrace`, widened here), the `ExecutionTraceInput` store interface
(`linkedOutcomeType?: string`, loose), the dashboard `marketplace-types.ts`
(`linkedOutcomeType?: string`, loose), and the marketplace traces API
(`GET /deployments/:id/traces`, returns the row verbatim). None branch on the
value, so the new `"booking"`/`"booked"` is not swallowed by any binary ternary
(honoring the dual-lifecycle and queued-outcome gotchas). The existing traces API
therefore lights up: Alex booking turns now return a typed booking outcome.

## 7. Testing (producer to consumer, TDD)

- `outcome-linker.test.ts`: extend with booking branch (links a successful booking
  to `{booking, booked, bookingId}`), booking-wins-over-stage priority, and no-link
  on a failed booking. Keep all 6 existing tests green.
- `trace-persistence-hook.test.ts`: a successful booking tool call yields an
  `ExecutionTrace` whose `linkedOutcome*` is persisted as the typed booking outcome
  (the energization proof); a non-outcome turn persists NULL.
- `prisma-booking-outcome-ledger-store.test.ts` (mocked Prisma, in
  `stores/__tests__/`): the join returns the booked row with trace + revenue from
  real producer-shaped rows; returns empty when `linkedOutcome*` is NULL (the
  today-state); revenue is null when no `ConversionRecord` exists yet; every query
  is org-scoped.
- The end-to-end producer to consumer assertion lives in the ledger store test:
  feed an `ExecutionTrace` carrying the exact `linkedOutcome*` that
  `TracePersistenceHook` would write, plus a matching `Booking` and
  `ConversionRecord`, and assert the join surfaces "Alex booked lead X, trace T,
  revenue V."

## 8. Scope

In: the producer (energized typed booking outcome on the WorkTrace) and the join
read-model + tests. Out: F8 (handoff isolation), F9 (NEXT_PUBLIC bracket), F10/F11
(cockpit chains, time-decay), Mira-brief signal feeding, any UI wiring, any new
mutating route, any migration, any rebuild of attribution (`ConversionRecord` and
`trueRoas` are reused as-is).

## 9. Invariants and risks

- DOCTRINE: `WorkTrace` (`ExecutionTrace`) stays canonical; no new mutating ingress
  path (the producer writes inside the existing telemetry recorder; the consumer is
  read-only). No new async path (no dead-letter needed).
- Risk: a turn that throws AFTER a successful booking takes the recorder's `onError`
  path (`toolCalls: []`), so the booking outcome annotation is skipped. Acceptable
  and pre-existing (the booking and its `ConversionRecord` still persist); noted, not
  fixed here.
- Risk: energizing stage/opt-out linking is a behavior change beyond the booking
  case. It is intentional, benign (a wrapped annotation), and corrects a latent gap;
  called out for the reviewer.
