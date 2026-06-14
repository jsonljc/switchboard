# Local-calendar create-path double-write fix (design)

Date: 2026-06-13
Branch: `fix/local-calendar-create-doublewrite`
Pairs with: F12 #1008 (advisory lock), #1010 (reschedule/cancel lock + IDOR), #1018 (reschedule seam, "durable store = single writer")

## Problem

For a no-PMS org (`LocalCalendarProvider`), the `booking.create` skill-runtime tool double-writes
the `Booking` table and self-conflicts on every booking. This is the create leg of the same no-PMS
booking loop whose reschedule leg #1018 just fixed, and it is the entry of the revenue-loop wedge
([[project_receipted_bookings_architecture]]): reschedule is moot if a lead cannot create a booking
in the first place.

### Confirmed behavior (observed, not assumed)

Driving the real `booking.create` tool through a real `LocalCalendarProvider` + real
`PrismaBookingStore` against Postgres (the way #1018 confirmed its seam):

```
result = { status: "error", code: "BOOKING_FAILURE",
           failureType: "provider_error", retryable: false }
rows   = 1 [{ status: "failed", calendarEventId: null }]
```

Every local booking fails with a NON-retryable `BOOKING_FAILURE`, the durable row is marked
`failed`, and a human escalation is opened.

### Root cause

`packages/core/src/skill-runtime/tools/calendar-book.ts` `booking.create` runs, in order:

1. `deps.bookingStore.create(...)` -> durable `PrismaBookingStore.create` inserts a row with status
   `pending_confirmation` (F12 #1008: per-org advisory lock via the shared `acquireBookingLock`
   `::int4` cast, half-open org-wide overlap, single insert).
2. `provider.createBooking(...)`. For a LOCAL org this is `LocalCalendarProvider.createBooking` ->
   `buildLocalStore.createInTransaction` (apps/api), which runs its OWN org-wide overlap
   `findMany(status notIn [cancelled, failed])` and then inserts a SECOND row.
3. A confirm transaction that updates the step-1 row to `confirmed` + stamps `calendarEventId`,
   writes the `booked` outbox event, mints the `CalendarReceipt`, and advances the opportunity stage.

The step-2 overlap check matches the step-1 row the tool itself just inserted, so it throws raw
`Error("SLOT_CONFLICT")`. The tool's step-2 catch classifies any provider throw as
`provider_error` and returns non-retryable `BOOKING_FAILURE` (the failure handler then marks the
step-1 row `failed`). Two writers (`PrismaBookingStore.create` and `createInTransaction`) target the
same `Booking` table; the second writer reads the first writer's row and aborts.

It is latent because the LOCAL path has never been exercised end-to-end in production (only
Noop-proven + Google-tested), consistent with the broader "shipped-but-production-INERT" theme.

## Architecture decision: durable store is the single writer

Same resolution shape as #1018. For a `LocalCalendarProvider` org the DB `Booking` row IS the
calendar, so exactly one writer should own it. We make the durable `PrismaBookingStore.create`
(step 1, already F12-guarded) the SOLE writer, and `LocalCalendarProvider.createBooking` mints +
returns a `local-<uuid>` calendarEventId WITHOUT inserting a second row. This mirrors
`GoogleCalendarAdapter.createBooking`, which creates the EXTERNAL event and returns its id but writes
no DB row. Step 3 then confirms the step-1 row and stamps that `local-<uuid>`. A genuine slot clash
now surfaces at step 1 as the typed `BookingSlotConflictError`, which the tool's existing catch maps
to the retryable `SLOT_TAKEN` re-offer (instead of a raw `BOOKING_FAILURE`).

Alternatives weighed:

- Invert: make the provider's `createInTransaction` the single writer and skip the durable
  `PrismaBookingStore.create` for local orgs. REJECTED: inverts #1018's principle; the rest of the
  tool (step-3 confirm-by-id, receipt, outbox, stage advance) operates on the durable row by
  `booking.id`, and the reschedule/cancel legs already treat the durable store as canonical. This
  would fork local vs google and re-key everything downstream.
- De-conflict only: make `createInTransaction`'s overlap exclude the step-1 row. REJECTED: still two
  rows (double-write persists), and the second row's id diverges from the canonical durable row. A
  band-aid, not the root fix.

## Email coupling resolution: notify after the durable confirm

`LocalCalendarProvider.createBooking` currently sends the RESEND-gated booking-confirmation email
(and `onSendFailure` escalation) using the `createInTransaction` row id. Once the provider stops
inserting, that id no longer exists inside the provider, so the email must move.

Decision: add an OPTIONAL `notifyBookingConfirmed(notification)` method to the `CalendarProvider`
contract. The tool calls it in the step-3 SUCCESS path, AFTER the durable confirm transaction
commits, keyed on the durable `booking.id`. `LocalCalendarProvider` implements it (the existing
RESEND-gated, best-effort send with `onSendFailure` moves here unchanged in substance).
`GoogleCalendarAdapter` and `NoopCalendarProvider` do NOT implement it (Google notifies attendees
natively during `createBooking`), so the Google path is unchanged and existing `CalendarProvider`
stubs keep compiling (the method is optional).

Why post-confirm rather than inside `createBooking` (which would be fewer lines):
`LocalCalendarProvider.cancelBooking` is a no-op (#1018), so a pre-confirm email could NOT be
compensated the way Google's native invite is (Google's orphan-event compensation `events.delete`
retracts the invite when the confirm transaction fails). Firing the email only after the durable
confirm commits makes Local's notification safety EQUIVALENT to Google's, and as a bonus the email
now references the canonical durable booking id (today it references the duplicate row's id). The
send stays best-effort: a notification failure never fails the already-confirmed booking, and the
tool wraps the call defensively so a throwing provider impl cannot.

Alternatives weighed:

- Keep email in `createBooking`, pass the durable id via `CreateBookingInput.bookingId`. REJECTED:
  fires pre-confirm and cannot be compensated for Local (see above).
- Move the email into the tool for all providers. REJECTED: the confirmation email is Local-specific
  (Google notifies natively); doing it in the tool would double-notify Google or force the tool to
  special-case the provider type, breaking the provider abstraction.

## `createInTransaction` removal + F12 invariant preservation

`createInTransaction`'s only caller was `LocalCalendarProvider.createBooking`, so it becomes dead
code. Remove it from the `LocalBookingStore` interface (which slims to `{ findOverlapping, findById }`)
and from `buildLocalStore`; drop the now-unused `acquireBookingLock`/`Prisma` imports in the factory;
update the stale `acquireBookingLock` doc comment that names "the local calendar provider's store" as
a lock site.

The F12 create concurrency invariant (per-org advisory lock with the `::int4` cast, half-open
org-wide overlap, single insert) is preserved by `PrismaBookingStore.create`, the surviving single
writer, which is ALREADY proven by:

- a mocked-Prisma unit test (`packages/db/.../prisma-booking-store.test.ts`: `acquireBookingLock`
  `::int4` cast assertion + `PrismaBookingStore.create overlap guard`), and
- a real-PG concurrency integration test (#1018's companion proof in
  `calendar-provider-factory.integration.test.ts`: N concurrent same-slot bookings -> exactly one
  row).

The one assertion the removed `createInTransaction` unit proof had that the durable unit test lacks
is the lock -> overlap -> insert ORDER; that single assertion migrates into the durable store's unit
test. Then the redundant `createInTransaction` unit + integration proofs are deleted.

## Test plan (two-part, mirrors #1008/#1018)

CI-safe mocked-Prisma unit proofs (run in CI) + a gated real-Postgres proof
(`describe.skipIf(!DATABASE_URL || RUN_DB_INTEGRATION !== "1")`).

1. `prisma-booking-store.test.ts` (db, mocked): add lock -> overlap -> insert ORDER assertion to the
   existing create test.
2. `calendar-provider-factory.test.ts` (api, mocked): delete the `createInTransaction` advisory-lock
   unit proof (migrated to #1).
3. `calendar-provider-factory.integration.test.ts` (api, gated real PG):
   - delete the `createInTransaction` concurrency proof (covered by the existing
     `PrismaBookingStore.create` concurrency proof);
   - migrate the reschedule e2e seed calls from `localStore.createInTransaction` to `durable.create`;
   - ADD the bug-fix proof: drive the real `booking.create` tool through a real
     `LocalCalendarProvider` + real `PrismaBookingStore`. Assert (a) success yields EXACTLY ONE row,
     `confirmed`, with a `local-<uuid>` `calendarEventId`; (b) a genuine same-slot clash (different
     patient) returns retryable `SLOT_TAKEN` (not `BOOKING_FAILURE`), leaves no orphan, and the first
     booking's single row is untouched.
4. `local-calendar-provider.test.ts` (core, mocked): `createBooking` mints `local-<uuid>` + returns
   without any store write; the email assertions move to `notifyBookingConfirmed` (best-effort +
   `onSendFailure`, keyed on the passed durable id); slim the `LocalBookingStore` stubs and the
   org-scope literal to `{ findOverlapping, findById }`.
5. `calendar-book.test.ts` (core, mocked): add a test that `notifyBookingConfirmed` is invoked after a
   successful confirm with the durable `booking.id` + correct payload, and that a throw from it does
   NOT fail the confirmed booking (still returns success).
6. `receipt-tier.test.ts` (api): slim the fake store to `{ findOverlapping, findById }`.

## Scope

In scope: create-path double-write/keying correctness for the LOCAL provider only. Preserve #1018's
reschedule/cancel fix and the #1008 lock.

Out of scope (note as future, do NOT fold in): `findById`/`getBooking` reads are not org-scoped
(read-side IDOR, not reachable cross-org in the current org-scoped flow). This is the same item #1018
deferred, already noted in the `CalendarProvider` interface comment.

## Files touched

- `packages/schemas/src/calendar.ts`: optional `notifyBookingConfirmed?` + `BookingConfirmedNotification`.
- `packages/core/src/calendar/local-calendar-provider.ts`: `createBooking` no store write; add
  `notifyBookingConfirmed`; slim `LocalBookingStore`.
- `packages/core/src/skill-runtime/tools/calendar-book.ts`: call `provider.notifyBookingConfirmed?`
  best-effort after the confirm tx commits.
- `apps/api/src/bootstrap/calendar-provider-factory.ts`: drop `createInTransaction` from
  `buildLocalStore`; drop unused imports.
- `packages/db/src/stores/prisma-booking-store.ts`: update stale `acquireBookingLock` doc comment.
- Tests per the test plan above.

No migration (no schema change).
