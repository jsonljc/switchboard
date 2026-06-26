# Stalled `pending_confirmation` booking reaper (A8b-2 / rank-18)

Status: design approved (self-directed; SURFACE-before-merge for human sign-off)
Date: 2026-06-26
Workstream: all-agents fix-plan (`docs/superpowers/plans/2026-06-20-all-agents-fix-plan.md`, A8 rank-18)

## Problem

`PrismaBookingStore.create()` persists a booking as `pending_confirmation` _before_ the
external calendar mutation, and the slot-overlap predicate counts that row as occupying:

```
status: { notIn: ["failed", "cancelled"] }   // prisma-booking-store.ts:59 (create), :154 (reschedule)
```

The only writers that move a row _out_ of `pending_confirmation` are `confirm()` →
`confirmed`, `markFailed()` → `failed`, and the calendar-book confirm/failure paths. On the
error paths, the single thing that writes a terminal `failed` status is
`BookingFailureHandler.handle()`, which runs its own `runTransaction`
(`booking.update` + `escalationRecord.create` + `outboxEvent.create`,
`booking-failure-handler.ts:88-137`). It is invoked _inside_ the catch blocks at
`calendar-book.ts:299` (provider error) and `:423` (confirm-tx failure).

**The gap:** if that failure-handler transaction itself throws (DB hiccup, escalation/outbox
write error, connection drop) - or the process dies anywhere between `create()` and a terminal
write - the row is stranded `pending_confirmation` with **no terminal status, no metric, and no
reaper**. Because `pending_confirmation` is in the "occupying" set, that stranded row
**permanently blocks its physical slot**: every future `create()` for the slot throws
`BookingSlotConflictError`, and the lead is told "that time was just taken" forever. The
failure is silent (no counter, no alert).

This is the same failure class the stranded idempotency-claim reaper (EV-2/SPINE-2) already
addresses for `running` WorkTrace claims: a process death / throw between a pre-write and its
terminalization leaves an orphan that blocks a resource forever.

## Design options considered

**(a) Reaper cron (chosen).** A bounded, hourly sweep ages `pending_confirmation` rows older
than a TTL to the terminal `failed` status, emits a counter per reaped row, and raises one
operator alert per run. Mirrors `stranded-claim-reaper.ts` end-to-end. Closes _every_
stranding cause (handler throw, process death, anything), terminalizes the row (clean
reporting), and releases the slot (`failed` is already excluded from every active/overlap
predicate). Cost: a core orchestrator + a db store method + a thin Inngest cron in apps/api +
one counter across the 3 metrics registries + tests. It is a **direct row-mutation cron, not a
governed auto-exec intent** - reapers (`stranded-claim-reaper`, `lifecycle-stalled-sweep`)
mutate infrastructure rows directly and do not pass through `PlatformIngress.submit()`.

**(b) DB overlap-TTL.** Exclude `pending_confirmation` older than N minutes from the overlap
predicate so stale pendings stop blocking new bookings. Cheapest (a predicate edit, no cron),
but leaves the zombie row forever (reporting debt: `countExcludingStatuses`, pending views, the
partial-unique active index all still count it) and must be applied consistently to multiple
predicates. **Dominated by (a)**, which both releases the slot and terminalizes the row.

**(c) Failure-handler hardening.** Make the confirm-failure path infallible so a terminal
status is always written. Narrows the common (handler-throws) window but **cannot** catch
process death, and edits the hot booking path (eval-blind: the alex-conversation eval uses
mock tools). Insufficient alone.

## Decision

Implement **(a)**, reaping to the existing terminal **`failed`** status. Rationale:

- It is the _complete_ backstop - it catches every stranding cause, which (c) cannot.
- Reaping to `failed` (not a new `expired`/`abandoned` status) gives slot-release and clean
  reporting for free with **zero cross-slice seam risk**: `failed` is already excluded from
  every active/overlap predicate (`:59/:126/:154/:247/:388`) and understood by all
  reporting/counts. A new status would force touching all five predicates, the `BookingStatus`
  enum, and reporting - the exact cross-slice trap to avoid - for no benefit. The new
  `bookingStalledReaped` counter + per-row forensic log + per-run operator alert supply the
  distinct "reaped-by-timeout vs explicitly-failed" observability.
- No hot-path edit (calendar-book / booking-failure-handler untouched) → no eval-blindness
  exposure, minimal blast radius, one focused PR. Handler hardening (c) is noted as deferred
  defense-in-depth; it is unnecessary for correctness once the backstop exists, and would only
  shrink the ≤(TTL+cron-interval) stranding window for the handler-throw case.

## Architecture

Three layers, mirroring the stranded-claim reaper:

1. **db - `PrismaBookingStore` (new methods).**
   - `findStalledPending(olderThan: Date, limit: number)` → bounded, cross-org scan of
     `status = "pending_confirmation" AND createdAt < olderThan`, ordered `createdAt asc`,
     `take: limit`, selecting `{ id, organizationId, createdAt }`. Runs on `@@index([status])`
     / `@@index([organizationId, createdAt])`. Cross-org by design (a system sweep, like
     `findUpcomingConfirmed`), bounded so a backlog cannot blow up the result set.
   - `reapStalledPending(organizationId, bookingId)` → race-safe compare-and-set:
     `updateMany where { id, organizationId, status: "pending_confirmation" } data { status: "failed" }`,
     returning `{ count }`. The `status` predicate is the race guard: if a concurrent
     `confirm()`/`markFailed()` already moved the row, `count === 0` (a benign race), never a
     wrong overwrite. Org + booking scoped (F12 / IDOR rule).

2. **core - `reapStalledBookings` orchestrator** (`packages/core/src/platform/stalled-booking-reaper.ts`).
   Defines a narrow `StalledBookingReaperStore` interface (the two methods above; satisfied
   structurally by `PrismaBookingStore`, kept off any broad store interface so existing mocks
   need not stub it). Loop: scan → for each, `reapStalledPending`; `count === 1` →
   `reaped++` + `counter.inc({ orgId })` + per-row warn log; `count === 0` → `raced++` (benign);
   a thrown store error → `failed++` (the alarm case). One summary `OperatorAlerter` alert per
   run when `scanned > 0` (severity `critical` iff `failed > 0`, else `warning`), with a
   CAPPED note when `scanned >= limit`. Returns `{ scanned, reaped, raced, failed }`.
   Constants: `STALLED_BOOKING_MAX_AGE_MS = 30 * 60 * 1000`, `STALLED_BOOKING_REAP_LIMIT = 500`
   (mirrors the stranded-claim values).

3. **apps/api - `stalled-booking-reaper` Inngest cron** (`apps/api/src/services/cron/stalled-booking-reaper.ts`).
   Thin wiring: hourly trigger (`0 * * * *`), `retries: 2`, `makeOnFailureHandler` (riskCategory
   `high`, `alert: true` - a reaper that stops running means slots silently re-block). A null
   store (no Postgres wired) → no-op, never fabricating a run. Wired in
   `apps/api/src/bootstrap/inngest.ts` alongside `createStrandedClaimReaperCron`, injecting
   `getMetrics().bookingStalledReaped`, the `operatorAlerter`, and `app.bookingStore` (the real
   `PrismaBookingStore`), and added to the served `functions` list.

4. **metrics - `bookingStalledReaped` counter** added to all 3 registries:
   `packages/core/src/telemetry/metrics.ts` (`SwitchboardMetrics` interface + `InMemoryCounter`
   default), `apps/api/src/metrics.ts` (`PromCounter`), `apps/chat/src/bootstrap/metrics.ts`
   (`PromCounter`). Metric name `switchboard_booking_stalled_reaped_total`, label `["orgId"]`,
   mirroring `bookingConfirmed`/`bookingFailed`.

## TTL safety

A legitimate `pending_confirmation` resolves within a **single synchronous tool invocation**:
`create()` → `provider.createBooking()` (seconds, bounded by the provider timeout) → confirm /
markFailed. There is no async-park path that legitimately holds a booking in
`pending_confirmation` (async keyed workflows go `running → queued`, not pending-booking). A
30-minute TTL is therefore far beyond any legitimate in-flight confirm. Even a falsely-reaped
slow confirm resolves in the **safe direction** (slot released; the row terminalized to
`failed`). The compare-and-set on `status` guarantees at-most-one writer wins the
reaper-vs-confirm race.

## Non-goals / explicitly out of scope

- **External calendar-event cleanup.** A `pending_confirmation` row has `calendarEventId = null`
  (the id is written only atomically with `status = "confirmed"`), so the reaper has no provider
  handle and operates purely DB-side. Orphan-event compensation already exists best-effort at
  `calendar-book.ts:416`.
- **No per-row escalation.** A reaped stranded pending gets the counter + forensic log + the
  one-per-run summary alert - not an `escalationRecord` per row (that would be an alert storm on
  a mass-strand event; the stranded-claim reaper deliberately does the same).
- **No `confirm()` status guard.** `confirm()`'s unconditional `updateMany` could in theory
  resurrect a reaped row to `confirmed`, but only if a confirm runs >30 min after create -
  unreachable in the synchronous create→confirm flow. Out of scope; the large TTL is the
  mitigation.
- **No failure-handler hardening** (option c) in this PR - noted as deferred defense-in-depth.

## Testing (TDD)

- **db** (`prisma-booking-store.test.ts`, mocks Prisma): `findStalledPending` issues the
  `pending_confirmation` + `createdAt < cutoff` query bounded by `take`; `reapStalledPending`
  issues the status-guarded `updateMany` and returns the count (1 = reaped, 0 = raced).
- **core** (`stalled-booking-reaper.test.ts`, mirrors `stranded-claim-reaper.test.ts`): reaps
  each stale row (counter per row, one alert, org-scoped CAS); a `count === 0` row counts as
  `raced` and does not escalate; a thrown store update counts as `failed` and escalates the
  alert to `critical`; bounded scan emits the CAPPED note; empty scan does nothing (no alert).
- **apps/api** (`stalled-booking-reaper.test.ts`, mirrors the cron test): null store no-ops;
  a wired store runs the orchestrator under the Inngest `step`.

Acceptance (fix-plan rank-18): a stalled pending row is handled (aged to `failed`, slot
released) and a metric is emitted. `eval:alex-conversation` is unaffected (no booking-tool
change); the booking-tool change is covered by the unit tests above.
