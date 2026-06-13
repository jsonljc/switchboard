# Local-calendar reschedule/cancel identifier seam — design

Date: 2026-06-13
Branch: `fix/local-calendar-event-id`
Status: self-approved (autonomous slice; resolves the F12 #1010 reschedule/cancel follow-up)

## Problem

For a no-PMS org (LocalCalendarProvider), `calendar.reschedule` fails for every booking:
the appointment never moves and the lead silently dead-ends into a human escalation. The
no-PMS WhatsApp booking loop is the revenue-loop wedge, so a lead who asks to move an
appointment must be able to, not get bounced to a human.

### Mechanism (verified against `5cb128fb`)

The reschedule tool (`packages/core/src/skill-runtime/tools/calendar-reschedule.ts`) does, in order:

1. `provider.rescheduleBooking(target.calendarEventId, newSlot)` — runs FIRST
2. `bookingStore.reschedule(orgId, target.id, {...})` — durable, keyed by row `id`

`LocalCalendarProvider.createBooking` mints `calendarEventId = local-<uuid>`, which is
DISTINCT from the Booking row's cuid `id`. `LocalCalendarProvider.rescheduleBooking`
forwards its argument straight to `store.findById` / `store.reschedule`, which key on the
row `id`. So step 1 is handed a `calendarEventId` and looks it up as a row `id`, matches
zero rows, and (post-#1010) throws `BOOKING_NOT_FOUND`. The tool's catch reverts and
returns `RESCHEDULE_FAILURE`, so step 2 (the durable move that is correctly keyed by row
`id`) NEVER runs.

`#1010` did not cause this; it made a latent break observable (pre-#1010 the same path
threw `P2025`, yielding the same `RESCHEDULE_FAILURE`).

Cancel has the same keying mismatch, but is functionally OK today because the durable cancel
runs FIRST (keyed by row `id`) and the provider's local cancel runs best-effort second and
its throw is swallowed. It is worth fixing for correctness and log-noise.

### Sibling defect (same root)

When a genuine slot clash occurs, the local store throws a plain `Error("SLOT_CONFLICT")`
with no `.code`. `isBookingSlotConflictError` (`packages/schemas/src/calendar.ts`) matches on
`.code === "SLOT_CONFLICT"`, so a local-store conflict is NOT mapped to the retryable
`SLOT_TAKEN` outcome; a real clash would escalate instead of being re-offered. The durable
`PrismaBookingStore.reschedule` throws the TYPED `BookingSlotConflictError` (which has
`.code`), so routing the real conflict through it fixes this for free.

## Root cause: a double-write seam

For a LocalCalendarProvider org the DB `Booking` row IS the calendar. Yet BOTH
`provider.rescheduleBooking` (backed by `buildLocalStore`, in `apps/api`) AND the durable
`bookingStore.reschedule` (`PrismaBookingStore`, in `packages/db`) write to the same
`booking` table — a double-write keyed by different identifiers (`calendarEventId` vs row
`id`).

This contrasts with the Google provider, where the two writes target DIFFERENT systems:
`provider.rescheduleBooking` patches the external Google Calendar event (necessary), and the
durable store moves the DB row (necessary). For Google the writes are complementary; for
Local they are redundant.

The `CalendarProvider` interface parameter is named `bookingId` but is semantically the
`calendarEventId` (the provider's own handle, the value returned as `Booking.calendarEventId`
from `createBooking`). The caller correctly passes `target.calendarEventId`; Google correctly
treats it as the external event id; only the Local provider mis-treats it as a durable row id.

Because `packages/core` (where the providers live) cannot import `packages/db` (where
`PrismaBookingStore` lives) — a hard dependency-layer rule — the two writers can only be
coordinated at the `apps/api` caller layer. Any single-writer resolution therefore has to act
on the provider side, not by having the provider call the durable store.

## Approaches considered

### (a) Resolve-then-act — local store keys on `calendarEventId`

Make `LocalCalendarProvider.rescheduleBooking/cancelBooking` resolve `calendarEventId` -> row
and have the local store key on `calendarEventId`.

Rejected. It makes step 1 succeed, but the tool then ALSO runs step 2 (the durable write)
unconditionally — the tool cannot distinguish a Local from a Google provider. Result: the
booking row is written twice and `rescheduleCount` is incremented TWICE per reschedule, a new
correctness regression. It also leaves the conflict detected by step 1 (the local store's
untyped `Error("SLOT_CONFLICT")`), so the sibling defect is NOT fixed. This entrenches the
double-write rather than removing it.

### (b)/(c) Durable store is the single writer — CHOSEN

Recognize that for a local (DB-backed) calendar there is no separate external calendar to
mutate, so `LocalCalendarProvider.rescheduleBooking/cancelBooking` should perform NO durable
write. The caller's durable `PrismaBookingStore` — already wired as `deps.bookingStore`
(`skill-mode.ts:158`, `new PrismaBookingStore(...)`), already org-scoped, advisory-locked,
overlap-guarded, `count===0`-guarded, and already throwing the typed `BookingSlotConflictError`
— becomes the single writer that actually executes.

Effects:

- Step 1 becomes a no-op for Local; step 2 (durable, keyed by row `id`) runs and moves the
  booking. Reschedule works.
- The conflict now surfaces from `PrismaBookingStore` as the typed `BookingSlotConflictError`,
  so `isBookingSlotConflictError` maps it to retryable `SLOT_TAKEN`. Sibling defect fixed.
- No double-write, no `rescheduleCount` double-count.
- Google is untouched: its `rescheduleBooking/cancelBooking` still patch/delete the external
  event; the durable row move is the same second write it always was.
- The tool's best-effort revert (`provider.rescheduleBooking(..., originalSlot)`) becomes a
  harmless no-op for Local (nothing external moved), and still reverts Google.
- This is symmetric with the create path, which already treats `deps.bookingStore.create`
  (durable `PrismaBookingStore`) as the authoritative write and the provider call as the
  calendar mirror.

## Chosen design

1. `LocalCalendarProvider.rescheduleBooking(eventId, newSlot)` becomes a no-op move: it
   performs no store write and returns a sparse `Booking` reflecting the requested slot
   (mirroring `GoogleCalendarAdapter.rescheduleBooking`, which already returns a sparse
   `Booking`; the caller discards the return). Documented: the durable booking store owns the
   row mutation; a local calendar has no external event to patch.

2. `LocalCalendarProvider.cancelBooking(eventId)` becomes a no-op: the durable
   `PrismaBookingStore.cancel` (tool step 1, runs first) is the single writer; there is no
   external event to delete. Removes today's swallowed `BOOKING_NOT_FOUND` log-noise.

3. Remove the now-dead `reschedule` and `cancel` from the `LocalBookingStore` interface and
   from `buildLocalStore` (`apps/api/src/bootstrap/calendar-provider-factory.ts`). They have no
   remaining caller once the provider methods are no-ops. `findOverlapping`,
   `createInTransaction`, and `findById` remain (used by `listAvailableSlots`, `createBooking`,
   and `getBooking` respectively). The create path (`createInTransaction`) is untouched.

4. Add a doc comment to the `CalendarProvider` interface clarifying that `rescheduleBooking`
   and `cancelBooking` receive the `calendarEventId` (the value returned as
   `Booking.calendarEventId` from `createBooking`), NOT the durable row id. This documents the
   contract that the Local provider previously violated, without churning signatures (param
   names in a TS interface do not bind call sites).

`getBooking` and `findById` keep keying on the row `id` — read-side keying is explicitly out of
scope (see below).

## F12 invariants — where they live after this change

The F12 reschedule/cancel guarantees are NOT lost. They were being enforced (redundantly) on a
code path that production never reached (`buildLocalStore.reschedule/cancel`). They remain
enforced on the path that ALWAYS runs, `PrismaBookingStore.reschedule/cancel`:

- per-org advisory lock via the shared `acquireBookingLock` (the `::int4` cast),
- half-open overlap excluding the booking being moved,
- org-scoped `updateMany` + `count===0` guard (rejects a missing or cross-org id),
- typed `BookingSlotConflictError` -> retryable `SLOT_TAKEN`.

`PrismaBookingStore.reschedule/cancel` already has mocked unit coverage for all of these
(`packages/db/src/stores/__tests__/prisma-booking-store.test.ts:331/361/370/384`). To preserve
the real-Postgres PROOF strength that the deleted `buildLocalStore` integration tests provided,
this slice adds the equivalent gated integration coverage on the live path (see Testing).

## Testing

Two-part, mirroring #1010:

A. CI-safe mocked unit proofs (run in CI, no Postgres):

- `LocalCalendarProvider.rescheduleBooking/cancelBooking` are no-ops: they do NOT call the
  store, return the expected shape. (`local-calendar-provider.test.ts`)
- The reschedule tool, given a Local-style provider whose `rescheduleBooking` is a no-op and
  a durable store that moves the row, returns success; and when the durable store throws the
  typed `BookingSlotConflictError`, the tool returns retryable `SLOT_TAKEN` (not
  `RESCHEDULE_FAILURE`). (`calendar-reschedule.test.ts`)

B. Gated real-Postgres proofs (`describe.skipIf(!DATABASE_URL || RUN_DB_INTEGRATION !== "1")`,
mirroring `calendar-provider-factory.integration.test.ts`):

- End-to-end: create a local booking (via `buildLocalStore.createInTransaction`, so
  `calendarEventId = local-<uuid>` and `id` is the cuid), drive it through the reschedule
  TOOL wired exactly as production (a real `LocalCalendarProvider` + a real
  `PrismaBookingStore` as `deps.bookingStore`), assert the row actually moved and
  `rescheduleCount === 1` (proves single write, no double-count). Then create a second
  booking at the target slot, attempt the reschedule onto it, assert the tool returns
  retryable `SLOT_TAKEN` and the loser row is untouched.
- Replace the deleted `buildLocalStore.reschedule/cancel` integration proofs with the
  equivalent on `PrismaBookingStore`: two concurrent reschedules onto one slot yield exactly
  one success + one typed conflict (advisory lock holds); and cross-org isolation (org-B
  cannot reschedule or cancel org-A's row; org-A still can).

Delete the dead `buildLocalStore.reschedule/cancel` unit tests
(`calendar-provider-factory.test.ts:310-427`) and the dead integration describes; trim the now
non-existent `reschedule`/`cancel` keys from `LocalBookingStore` mock literals in
`local-calendar-provider.test.ts`.

## Scope

In: reschedule + cancel identifier/keying correctness for the Local provider; surfacing a coded
conflict so a genuine clash is re-offered retryably; preserving every F12 guarantee on the live
durable path; keeping Google and the #1010 create path (`createInTransaction`) unchanged.

Out (note as future, do NOT fold in):

- `findById`/`getBooking` reads are not org-scoped (read-side IDOR). Not reachable cross-org in
  the current org-scoped flow; a separate hardening slice.
- The create path also double-writes for Local (the durable `bookingStore.create` row plus the
  `createInTransaction` row). Same root smell, explicitly preserved here per scope; a separate
  slice.

## Risks

- Deleting the #1010 `buildLocalStore.reschedule/cancel` tests could read as regressing F12.
  Mitigation: the invariants move to the path that actually runs, with equivalent unit + gated
  integration coverage added on `PrismaBookingStore`, and the PR explains this explicitly.
- A future caller of `LocalCalendarProvider.rescheduleBooking/cancelBooking` outside the durable
  flow would get a silent no-op. Mitigation: the methods are documented as no-ops; the
  `CalendarProvider` contract doc clarifies the identifier; there is no such caller today (the
  factory is the only constructor and always pairs it with the durable store).
