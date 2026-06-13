# Local calendar store: reschedule/cancel hardening (F12 follow-up)

Date: 2026-06-13
Branch: `fix/local-reschedule-hardening`
Status: design decision (abbreviated brainstorming — this slice mirrors an existing pattern)

## Problem

`buildLocalStore` in `apps/api/src/bootstrap/calendar-provider-factory.ts` is constructed
per-org and closes over `orgId`. PR #1008 hardened its `createInTransaction` path (per-org
advisory lock via the shared `acquireBookingLock` helper + half-open overlap check +
`ORGANIZATION_MISMATCH` guard). Two sibling methods on the same store were left bare:

- **Finding A (data-integrity / race).** `reschedule` does a bare
  `prismaClient.booking.update({ where: { id } })` with **no advisory lock and no overlap
  check**. Two concurrent reschedules (or a reschedule racing a create) can place two LIVE
  bookings on the same org slot.
- **Finding B (tenant-isolation / IDOR).** `reschedule` **and** `cancel` update by booking
  `id` with **no `organizationId` filter**. The store is bound to one org, but a `bookingId`
  from another org (forged/guessed) would reschedule or cancel that org's booking. The
  create-path `ORGANIZATION_MISMATCH` guard does not cover these.

Reference implementation that already does it right: `PrismaBookingStore.reschedule(orgId,
bookingId, slot)` and `.cancel(orgId, bookingId)` in
`packages/db/src/stores/prisma-booking-store.ts`.

## Decision

One focused PR. Fix both findings in the same edit (they live in the same two methods;
touching the functions twice is worse). Mirror the durable `PrismaBookingStore`, reusing the
shared `acquireBookingLock(tx, orgId)` helper (it owns the mandatory `::int4` cast — do **not**
re-add a raw `pg_advisory_xact_lock` or re-introduce `BOOKING_LOCK_NS` here).

### `reschedule(bookingId, newSlot)` — lock + overlap + org-scope + count guard

Wrap in an interactive `$transaction(async (tx) => …)`:

1. `await acquireBookingLock(tx, orgId)` — serialize check-then-move per org. Held to commit.
2. Overlap `findMany` scoped to `organizationId: orgId`, **excluding the booking being moved**
   (`id: { not: bookingId }`), half-open (`startsAt < endEnd && endsAt > newStart`),
   `status notIn ["cancelled", "failed"]`, `take: 1`. If a row exists → `throw new
   Error("SLOT_CONFLICT")` (the local-store convention, matching the sibling create path; the
   durable store's typed `BookingSlotConflictError` is intentionally not imported here).
3. `tx.booking.updateMany({ where: { id: bookingId, organizationId: orgId }, data: {
   startsAt, endsAt, rescheduleCount: { increment: 1 } } })`. `updateMany` drops Prisma's
   P2025 not-found throw, so guard: `if (result.count === 0) throw new
   Error("BOOKING_NOT_FOUND")` — a missing or cross-org id rejects instead of silently
   no-op'ing.
4. Return `{ id: bookingId }` (the id is already known; no extra read needed to honor the
   existing `Promise<{ id }>` contract).

### `cancel(bookingId)` — org-scope + count guard only

A cancel cannot create a slot conflict, so no lock/overlap (design fork #5). Single statement:
`prismaClient.booking.updateMany({ where: { id: bookingId, organizationId: orgId }, data: {
status: "cancelled" } })`; `if (result.count === 0) throw new Error("BOOKING_NOT_FOUND")`.
Returns `void`.

### Deliberately preserved / out of scope

- **Interface unchanged.** `LocalBookingStore` in `packages/core` keeps
  `cancel(bookingId): Promise<void>` and `reschedule(bookingId, newSlot): Promise<{ id }>`.
  Org-scoping uses the closed-over `orgId`, so `packages/core/**` stays db-free.
- **Write shape unchanged** beyond the guard mechanics: reschedule still writes only
  `startsAt`/`endsAt`/`rescheduleCount++`. Not adding `rescheduledAt` (the durable store sets
  it, but the local `findById` maps it to `null` anyway, and it is unrelated to the two
  findings — keep the diff minimal).
- **Do not touch** `createInTransaction` (shipped in #1008, squash `2a310d7e`).
- The pre-existing `calendarEventId`-vs-row-`id` keying in the skill-runtime production path
  and the create-path `ORGANIZATION_MISMATCH` guard are orthogonal; the fix is behavior-
  preserving on `where: { id }` and correct regardless of which id flows in.
- No new audit findings folded in (F1/F5/F13/F14/F15). No migration (no schema change).

## Error contract

No caller pattern-matches the local store's not-found error (verified: the skill-runtime
reschedule/cancel tools catch and map to `RESCHEDULE_FAILURE`/`CANCEL_FAILURE`; only the
*durable* store's `BookingSlotConflictError` is special-cased, and that path is unchanged).
The old code threw Prisma P2025 on a missing id — a throw — so `Error("BOOKING_NOT_FOUND")`
preserves the throw-on-missing control flow while newly rejecting the cross-org case the old
code silently performed.

## Testing (two-part, mirrors #1008)

1. **CI-safe mocked-Prisma unit tests** (`calendar-provider-factory.test.ts`, always-on):
   - reschedule takes `acquireBookingLock` (asserts `pg_advisory_xact_lock` + `::int4` +
     `920_001` + orgId) **before** the overlap check and update (invocation order).
   - reschedule overlap check is org-scoped and excludes self (`id: { not }`); update is
     scoped to `{ id, organizationId: orgId }`.
   - reschedule throws `SLOT_CONFLICT` (no update) when an overlap exists; lock taken first.
   - reschedule and cancel throw `BOOKING_NOT_FOUND` when `updateMany` returns `count: 0`.
   - reschedule returns `{ id: bookingId }`; cancel resolves `void` on `count: 1`.
2. **Gated real-Postgres integration tests**
   (`calendar-provider-factory.integration.test.ts`, `skipIf(!DATABASE_URL ||
   RUN_DB_INTEGRATION !== "1")`):
   - Two concurrent reschedules of two different bookings onto the same free slot for one org
     → exactly one success + one `SLOT_CONFLICT`; the target slot is held by exactly one
     booking (not double-held); the loser is unchanged at its original slot.
   - A reschedule **and** a cancel issued from a store bound to org-B against a booking owned
     by org-A → both reject (`BOOKING_NOT_FOUND`); org-A's row is byte-for-byte untouched
     (slot + status unchanged).

## Doc handling

This design + the implementation plan are committed on the feature branch under
`docs/superpowers/` to drive the pipeline and anchor `$APPROVED_SHA` for diff-discipline.
They describe exactly this branch's feature (the branch-relevance hook keys on slug, so it
will not warn), and `docs/superpowers/{specs,plans}` is the repo's canonical home for them.
