# Calendar booking read-side org-scoping (F12 read-scoping leg)

Date: 2026-06-14
Branch: fix/calendar-read-org-scope
Lineage: F12 calendar booking family (#1008 lock, #1010 reschedule/cancel lock+IDOR, #1018 reschedule seam, #1026 create seam). This is the last open leg: read-side org-scoping, deferred as "out of scope" by #1010/#1018/#1026.

## Problem

Two booking READ paths key by booking id with no organization filter, even though the
owning org id is in scope at both call sites. Every other booking read is org-scoped; these
two are the outliers.

1. `buildLocalStore.findById(bookingId)` (`apps/api/src/bootstrap/calendar-provider-factory.ts`)
   does `prismaClient.booking.findUnique({ where: { id: bookingId } })`. The store is built
   per-org with a closed-over `orgId` (its sibling `findOverlapping` already filters on it), so
   the org id is right there, unused. `LocalCalendarProvider.getBooking(bookingId)` delegates to
   this store, so a `getBooking` by a known row id can read any org's booking.

2. `PrismaBookingStore.findById(bookingId)` (`packages/db/src/stores/prisma-booking-store.ts`)
   does `findUnique({ where: { id: bookingId } })`. It is the lone un-scoped read on a store whose
   eight other reads (`confirm`, `findBySlot`, `findUpcomingByContact`, `reschedule`, `cancel`,
   `listByDate`, `countConfirmed`, `countExcludingStatuses`) are all org-scoped. (`findUpcomingConfirmed`
   is intentionally cross-org for the reminder cron and stays as-is.)

### Reachability (this is latent, not a live exploit)

- `getBooking` has zero production callers (only the three provider implementations and tests).
  Confirmed by grep across the repo.
- `PrismaBookingStore.findById` has exactly two production consumers, both already defended:
  - `BookingFailureHandler` (`packages/core/.../booking-failure-handler.ts`) reads it only for an
    idempotency check (`status === "failed"`), and is always called with the booking the calendar
    tool just created for `ctx.orgId`. The booking id is never attacker-controlled cross-org.
  - The `deposit-link` tool wiring (`apps/api/src/bootstrap/deposit-link-wiring.ts`) already
    fetches by id and then post-filters `booking.organizationId !== orgId -> null`, so its own
    isolation does not depend on the store.

So nothing is reachable cross-org in the current flow. This slice is defense-in-depth plus
consistency hardening, mirroring how #1010 org-scoped the write path. Its value is removing the
lone footgun (a future caller of `PrismaBookingStore.findById` would reasonably assume it is
org-scoped like its siblings and silently reintroduce a live IDOR) and completing the tracked F12
read-scoping leg honestly.

## The architectural decision: how deep to scope

Three options were weighed.

- Minimal: org-scope only `buildLocalStore.findById`. Rejected as the sole fix because it leaves
  `PrismaBookingStore.findById` (the finding's second named store) un-scoped, so the F12
  "read-scoping" leg would be only half-closed and the durable store would keep its lone outlier.
- Thorough/consistent (CHOSEN): org-scope BOTH reads. `buildLocalStore.findById` via the
  closed-over org id (no interface change), and `PrismaBookingStore.findById` by adding an
  `organizationId` parameter threaded from its two consumers, which both already hold the org id.
  This makes the durable store uniformly org-scoped and retires the documented "org-UNAWARE" smell.
- Change the shared `CalendarProvider.getBooking(bookingId)` signature to take `orgId`. Rejected:
  `getBooking` has zero production callers, so this would churn three implementations (noop, google,
  local) plus about five test references for no benefit. The per-org local store already scopes the
  read in the Minimal change; noop and google `getBooking` return null regardless. Smallest change
  that genuinely closes the hole wins.

The chosen depth is the smallest change that closes both named reads without a fragile special
case. Leaving one un-scoped read among eight scoped siblings is itself the fragile special case.

## Design

### Fix A: `buildLocalStore.findById` (apps/api)

Change the read to use the closed-over `orgId`:

```
findById: async (bookingId: string) => {
  const row = await prismaClient.booking.findFirst({
    where: { id: bookingId, organizationId: orgId },
  });
  if (!row) return null;
  // ...existing mapping unchanged...
}
```

A read for an id that belongs to another org (or no row) returns `null`. No throw: this is a read,
so the `updateMany count === 0` abort pattern from the write path does not apply. The
`LocalCalendarProvider` and the `CalendarProvider.getBooking` interface are untouched; the org id
lives in the store closure, exactly as `findOverlapping` already uses it.

### Fix B: `PrismaBookingStore.findById` (packages/db) + its two consumers

Store:

```
async findById(organizationId: string, bookingId: string) {
  return this.prisma.booking.findFirst({ where: { id: bookingId, organizationId } });
}
```

Parameter order is `(organizationId, bookingId)`, matching this store's own convention
(`confirm`, `markFailed`, `reschedule`, `cancel` all take org first). Return type is unchanged
(`Booking | null`).

Consumer 1, `BookingFailureHandler` (`packages/core`):

- `BookingStoreSubset.findById(orgId: string, bookingId: string)` gains the org param.
- The call site passes `input.orgId` (already on `BookingFailureInput`):
  `await this.deps.bookingStore.findById(input.orgId, input.bookingId)`.
- The wiring adapter (`apps/api/src/bootstrap/skill-mode.ts`) forwards both args to the real store.
- No production behavior change: the handler is always called with the org of the booking the tool
  just created, so the org-scoped read returns the same row as before.

Consumer 2, the `deposit-link` wiring (`apps/api/src/bootstrap/deposit-link-wiring.ts`):

- The injected `findBookingById` contract becomes `(orgId, bookingId)`; `skill-mode.ts` updates its
  one-line lambda to `(orgId, bookingId) => bookingStore.findById(orgId, bookingId)`.
- The wiring's existing post-fetch `booking.organizationId !== orgId -> null` check is KEPT as
  explicit defense-in-depth so the deposit tool's tenant isolation never silently depends on the
  store's query shape. The "org-UNAWARE" comment is updated to say the store is now org-scoped and
  this check is a redundant second barrier. The `deposit-link` tool's own `BookingLookup` contract
  is already `findById(orgId, bookingId)` and does not change.

Out of scope (noted, not changed): the `BookingFailureHandler` write (`tx.booking.update` by id)
is a write, not a read; the task scopes this slice to reads, and that id is the tool's own freshly
created booking, never attacker-reachable cross-org. The intentionally cross-org cron read
`findUpcomingConfirmed` is left as-is. No schema change, no migration.

### Comment retirement

`packages/schemas/src/calendar.ts`: the `CalendarProvider` block carries a note that "`getBooking`
still keys by the durable row id on the local provider; aligning its read-side keying is tracked as
separate out-of-scope work." This work is now done, so that sentence is removed (the rest of the
`eventId`-vs-row-id comment stays).

## Testing

Mirror the prior F12 slices: CI-safe mocked-Prisma unit proofs that run in CI, plus gated real-PG
proofs that need both `DATABASE_URL` and `RUN_DB_INTEGRATION=1` (they never block CI).

CI-safe unit proofs (run in `pnpm test`):

- `calendar-provider-factory.test.ts` (api): new block proving `buildLocalStore(prisma, "org-A").findById("bk_1")`
  calls `booking.findFirst({ where: { id: "bk_1", organizationId: "org-A" } })`, maps the row when
  found, and returns `null` when `findFirst` returns null (cross-org / not found).
- `prisma-booking-store.test.ts` (db): rewrite the existing `findById` test to call
  `store.findById("org_1", "bk_1")`, assert the org-scoped `findFirst` where-clause, and add a
  cross-org -> null case.
- `booking-failure-handler.test.ts` (core): assert `findById` is called with `("org_1", "bk_1")`
  (use `toHaveBeenCalledWith`, not `.mock.calls` indexing, to avoid the untyped-`vi.fn` TS2493 build trap).
- `deposit-link-wiring.test.ts` (api): update the org-isolation test's call assertion to
  `("org_1", "bk_1")`; the post-fetch isolation behavior and its assertions stay.

Gated real-PG proofs (added to `calendar-provider-factory.integration.test.ts`, the existing home of
the F12 `describe.skipIf(!DB_INTEGRATION_ENABLED)` proofs): seed a booking for org A, then assert a
read keyed to org B returns null while org A still reads it, for BOTH `buildLocalStore(prisma, orgB).findById(id)`
and `new PrismaBookingStore(prisma).findById(orgB, id)`. Run locally with
`RUN_DB_INTEGRATION=1 node --env-file=.env node_modules/vitest/vitest.mjs run <file>` (the
`DATABASE_URL` contains an `&`; always use `--env-file`, never a naive `source`).

## Gates

`pnpm --filter @switchboard/api test`, `--filter @switchboard/core test`, `--filter @switchboard/db test`,
`pnpm typecheck`, `pnpm arch:check`, `pnpm format:check`, `pnpm lint` (0 errors). Required CI:
typecheck, lint, test, security. A store-signature tightening can red app-level spies that pass
typecheck, so the api suite is a required gate here, not just db/core.

## Blast radius

Source: `calendar-provider-factory.ts`, `prisma-booking-store.ts`, `booking-failure-handler.ts`,
`skill-mode.ts`, `deposit-link-wiring.ts`, `calendar.ts` (comment only). Tests: the four CI-safe
files above plus the integration file. No other caller of `PrismaBookingStore.findById` or
`getBooking` exists (verified: `app.ts`, `inngest.ts`, `dashboard-overview.ts` use other booking
methods; typecheck confirms).
