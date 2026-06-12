# F12: Local-calendar booking double-book fix (design)

Date: 2026-06-12
Branch: `fix/local-calendar-doublebook`
Source finding: `docs/audits/2026-06-10-security-audit/11-tickets.md` (F12), `…/08-data-integrity.md`
Severity: MEDIUM (data-integrity / bookings / race-condition)

## Problem

For a clinic configured with business hours but no Google Calendar connected (a real pilot
setup), the calendar provider resolves to `LocalCalendarProvider`, whose persistence runs
through `buildLocalStore(...).createInTransaction` in
`apps/api/src/bootstrap/calendar-provider-factory.ts`.

That method does an overlap `findMany` then a `create` inside a `$transaction` with **no
advisory lock** (factory lines ~175-208). At PostgreSQL READ COMMITTED isolation, two
concurrent transactions each run the overlap check, each see no conflict, and both insert.
Result: the same physical slot is booked for two different patients.

The active-booking PARTIAL-unique index
(`Booking_org_contact_service_start_active_key` on
`(organizationId, contactId, service, startsAt) WHERE status NOT IN ('failed','cancelled')`)
does **not** catch this: two different patients have different `contactId`, so the unique
tuple differs. The only thing that can serialize two different-patient bookings for the same
slot is an advisory lock plus the overlap check, which the local path lacks.

## Context (verified against current code)

`packages/core/src/skill-runtime/tools/calendar-book.ts` runs a two-write flow:

1. Step 1 (line 272): `deps.bookingStore.create(...)` is `PrismaBookingStore.create`
   (wired in `skill-mode.ts:155`), which **already** takes
   `pg_advisory_xact_lock(BOOKING_LOCK_NS, hashtext(orgId))` as its first statement, then the
   overlap check, then inserts a `pending_confirmation` row.
2. Step 2 (line 321): `provider.createBooking(...)`; for the local provider this calls
   `LocalCalendarProvider.createBooking` then `buildLocalStore.createInTransaction`, the
   **unlocked** insert (a second, `confirmed` row).
3. Step 3 (line 357): updates the step-1 row to `confirmed` + `calendarEventId`.

Because the step-1 `PrismaBookingStore.create` is already lock-serialized, two concurrent
bookings through `calendar-book` are gated there (the loser gets `SLOT_TAKEN`). But the local
persistence path itself, `buildLocalStore.createInTransaction`, is unprotected. The fix makes
that path race-safe in its own right, which is both defense-in-depth today and correct if the
redundant two-write is ever consolidated onto the provider path (tracked separately as F13,
out of scope here).

The Layer-3 core provider `packages/core/src/calendar/local-calendar-provider.ts` simply calls
the injected `LocalBookingStore.createInTransaction`. It must stay db-free, so the bug and the
fix are **not** there.

## Decision: Approach B (add the advisory lock to `buildLocalStore`)

The ticket offered two approaches:

- **(A) Delegate to `PrismaBookingStore.create`**: route local persistence through the
  already-locked store so there is one locked insert path.
- **(B) Add the same advisory lock + overlap guard to `buildLocalStore.createInTransaction`.**

**Chosen: B.** Approach A is unworkable here, for three independent reasons verified against
the code:

1. **Self-conflict in the two-write flow.** `calendar-book` step 1 already inserts a
   `pending_confirmation` row via `PrismaBookingStore.create`. If step 2 (`buildLocalStore`)
   also called `PrismaBookingStore.create`, it would take the lock, run its overlap check, and
   find step 1's own live row for the same slot, throwing `BookingSlotConflictError` on
   **every** local booking.
2. **Contract mismatch.** `PrismaBookingStore.create` hardcodes `status: "pending_confirmation"`
   and does not accept or persist `calendarEventId`. The local provider needs
   `status: "confirmed"` and stores a generated `local-<uuid>` event id. Delegating would force
   widening `PrismaBookingStore`'s contract, exactly the fallback condition the ticket names.
3. **Error semantics.** `PrismaBookingStore` throws `BookingSlotConflictError` (carries
   `code: "SLOT_CONFLICT"`); the local path throws `new Error("SLOT_CONFLICT")`, which the
   `LocalCalendarProvider` propagates and existing tests assert. Switching the type is an
   unnecessary behavior change for this fix.

Approach B is the smaller, correct change. Its one drawback (two copies of the lock+overlap
logic, a drift risk a reviewer would flag) is mitigated by sharing the **namespace constant**:
we export `BOOKING_LOCK_NS` from `@switchboard/db` so both paths lock on the same
`(namespace, hashtext(orgId))` and cannot silently diverge.

## The change

1. **`packages/db`**: export the existing `BOOKING_LOCK_NS` constant (currently private in
   `prisma-booking-store.ts`) and re-export it from the package index, giving a single source
   of truth for the lock namespace.

2. **`apps/api/src/bootstrap/calendar-provider-factory.ts`**:
   - import `{ BOOKING_LOCK_NS }` from `@switchboard/db` (apps/api is Layer 5, so this is
     allowed);
   - inside `buildLocalStore(...).createInTransaction`, issue
     `await tx.$executeRaw\`SELECT pg_advisory_xact_lock(${BOOKING_LOCK_NS}, hashtext(${input.organizationId}))\``as the **first** statement in the`$transaction`, before the overlap `findMany`. The lock
     is held until the transaction commits, serializing concurrent same-org bookings;
   - keep the existing overlap `findMany` + `create` + `throw new Error("SLOT_CONFLICT")`
     unchanged (semantics preserved, only serialization added);
   - **export** `buildLocalStore` so the new tests can construct it directly with a mocked or
     real Prisma client.

No schema change and no migration: the lock primitive and the partial-unique index already
exist. We are only making the local path _use_ the lock.

The core provider and all of `packages/core/**` are untouched (db-free invariant preserved).

## Testing (two-part split)

CI has no Postgres and db-layer tests mock Prisma, so the proof splits in two:

- **(a) CI-safe unit proof (mocked Prisma)** in
  `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts`. Construct
  `buildLocalStore(mockPrisma, orgId)`, call `createInTransaction`, and assert via mock
  invocation order that `tx.$executeRaw` issued the `pg_advisory_xact_lock` (with
  `BOOKING_LOCK_NS` and the org id) **before** the overlap `findMany` and the `create`.
  Mirrors `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`
  ("inserts … after taking the advisory lock"). This is the deterministic regression gate.

- **(b) Real-Postgres concurrency proof (the done-when)** in a new
  `apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts`, gated
  `describe.skipIf(!process.env["DATABASE_URL"])` so it never blocks CI. Build
  `buildLocalStore` against a real `PrismaClient`, fire two `createInTransaction` for the same
  slot but **different** `contactId` (two patients) via `Promise.all`, and assert exactly one
  resolves and one rejects with `SLOT_CONFLICT`, with exactly one surviving `Booking` row.
  Different contacts ensure the partial-unique index is not what fires, proving the advisory
  lock is the guard. Booking has no FK constraints, so the test uses free-string org/contact
  ids and cleans up with `deleteMany`.

TDD order: write the mocked unit proof first and watch it fail (no lock issued), then implement
the lock and watch it pass. Then add the gated concurrency proof and demonstrate it red (both
insert, double-book) against the unlocked code, green (one conflict) after the lock.

## Gates before PR

`pnpm --filter @switchboard/db test`, `pnpm --filter @switchboard/api test`, `pnpm typecheck`,
`pnpm arch:check`, `pnpm format:check`. No `db:check-drift` needed (no schema change).

## Out of scope

- F13 (creative-job two-write), F14 (Meta token-refresh alert), F15 (consent decision).
- The `calendar-book` redundant two-write itself (the second `confirmed` row). This fix only
  makes the local persistence path race-safe; consolidating the two writes is a separate
  concern.
- The Google Calendar provider path (F12 is the local / no-PMS provider only).

## Done when

Two simultaneous local-calendar bookings for the same slot result in exactly one success and
one `SLOT_CONFLICT`, demonstrated by the gated concurrency test against a live Postgres, with
the mocked unit proof guarding the lock-before-check ordering in CI.

## Review amendments (2026-06-12)

Adopted from a plan review before execution:

1. **Single org source of truth.** `buildLocalStore` is constructed per org (closed-over
   `orgId`), but the existing `createInTransaction` keyed its overlap check and insert off the
   caller-supplied `input.organizationId`. To stop the lock, overlap check, and insert from ever
   keying off different orgs, `createInTransaction` now rejects a mismatched payload with
   `ORGANIZATION_MISMATCH` and uses the closed-over `orgId` for the lock, the overlap query, and
   the insert.
2. **Deterministic green, reliable red.** The committed concurrency test fires N (8) concurrent
   same-slot bookings and asserts exactly one success. The throwaway red demonstration removes
   the lock and inserts a `pg_sleep` between the overlap check and the insert so the race window
   is hit reliably, not probabilistically.
3. **Explicit integration opt-in.** Because the concurrency test writes and deletes real rows,
   it is gated on `DATABASE_URL` **and** `RUN_DB_INTEGRATION=1`, not `DATABASE_URL` alone, to
   prevent accidental runs against the wrong database.
4. **No foreign keys.** Verified against the live schema: `Booking` has no foreign keys
   (outgoing or incoming), so the test uses free-string org/contact ids and needs no seeding.
5. **Org-source unit coverage.** A unit test builds the store with one org and submits a
   different payload org, asserting `ORGANIZATION_MISMATCH` and that no lock, overlap, or insert
   runs.

Tradeoff (not a blocker): the per-org advisory lock serializes all local bookings for an org,
not just the same slot. This matches `PrismaBookingStore`'s existing semantics and is fine for
clinic booking volume; a finer per-resource lock is future work if a single org ever needs high
concurrent throughput across independent practitioners or rooms.

## Execution discovery: the booking advisory lock never worked against real Postgres

While running the real-Postgres concurrency proof, every booking failed with Postgres error
`42883`: `function pg_advisory_xact_lock(bigint, integer) does not exist`. Prisma sends a JS
number parameter as `bigint`, and `hashtext()` returns `integer`, so the two-key call resolved
to `pg_advisory_xact_lock(bigint, integer)`, which is not a real signature (the two-key form is
`(int4, int4)`). The fix is a one-token `::int4` cast on the namespace argument.

Crucially, this was not unique to the new local path: `PrismaBookingStore.create` and
`PrismaBookingStore.reschedule` use the identical pattern and throw the same error against real
Postgres (verified empirically). Their unit tests mock `$executeRaw`, and the booking write path
is otherwise Noop-proven, so the lock had never actually executed against a live database. The
prior audit's "double-booking is prevented on the main path" rested on a static read; in fact
the durable booking lock has never functioned.

Because F12's whole point is making the booking advisory lock serialize, and because this fix
exports a shared `BOOKING_LOCK_NS` so the local path and the durable store lock on the same key
(only meaningful if both actually acquire the lock), the `::int4` cast is applied uniformly to
all three booking-lock sites: `buildLocalStore.createInTransaction`, `PrismaBookingStore.create`,
and `PrismaBookingStore.reschedule`. Both the local path and `PrismaBookingStore.create` now have
gated real-Postgres concurrency proofs (one success, N-1 `SLOT_CONFLICT`, one row). This stays
within the F12 booking-lock mechanism and does not fold in the unrelated F13/F14/F15 findings.

## Code review outcome

A high-effort `/code-review` pass drove two changes:

- The `::int4` cast was a bandaid replicated at three call sites with nothing stopping a fourth
  from omitting it and hitting `42883` again, and the always-on (mocked) unit suite never
  asserted the cast (only the gated real-Postgres test did, and that never runs in CI). Both are
  fixed by extracting a single `acquireBookingLock(tx, organizationId)` helper in `packages/db`
  that owns the cast; all three sites lock through it, and the mocked unit tests now assert the
  `::int4` cast so a regression is caught in CI. `BOOKING_LOCK_NS` is no longer exported; the
  helper is the only lock API.

Two real findings were left as follow-ups because they are outside F12's create-path race and
are pre-existing (not introduced here); they are flagged in the PR and the security-audit note:

- `buildLocalStore.reschedule` does a bare `booking.update` with no advisory lock and no overlap
  check, so the local reschedule path can still land two bookings on one slot.
- `buildLocalStore.reschedule` and `buildLocalStore.cancel` update by booking id with no
  `organizationId` filter, a cross-org write (IDOR) risk that the new create-path
  `ORGANIZATION_MISMATCH` guard does not cover. This is a tenant-isolation finding that warrants
  its own security review rather than a drive-by fix.
