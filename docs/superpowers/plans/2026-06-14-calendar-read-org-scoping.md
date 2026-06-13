# Calendar booking read-side org-scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org-scope the two un-scoped calendar booking read paths (`buildLocalStore.findById` and `PrismaBookingStore.findById`) so a read by a known booking id cannot cross a tenant boundary, completing the F12 calendar booking family (create + reschedule + cancel + read-scoping).

**Architecture:** Two independent reads gain an org filter. Fix A scopes `buildLocalStore.findById` (api) through the org id already closed over the per-org store, with no interface change. Fix B scopes the durable `PrismaBookingStore.findById` (db) by adding an `organizationId` parameter, threaded from its two consumers (`BookingFailureHandler` in core and the `deposit-link` wiring in api), both of which already hold the org id. The shared `CalendarProvider.getBooking` signature is intentionally left alone (zero production callers; the per-org store already scopes the read).

**Tech Stack:** TypeScript, Prisma, Vitest, pnpm + Turborepo.

---

## File Structure

- `apps/api/src/bootstrap/calendar-provider-factory.ts` - Fix A: `buildLocalStore.findById` uses `findFirst` scoped to the closed-over `orgId`.
- `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts` - Fix A CI-safe unit proof.
- `packages/schemas/src/calendar.ts` - retire the "out-of-scope" comment on `getBooking`.
- `packages/db/src/stores/prisma-booking-store.ts` - Fix B: `findById(organizationId, bookingId)` via `findFirst`.
- `packages/db/src/stores/__tests__/prisma-booking-store.test.ts` - Fix B CI-safe db unit proof.
- `packages/core/src/skill-runtime/tools/booking-failure-handler.ts` - consumer 1: thread `orgId`.
- `packages/core/src/skill-runtime/tools/booking-failure-handler.test.ts` - assert `orgId` threaded.
- `apps/api/src/bootstrap/skill-mode.ts` - wiring: failure-handler adapter + deposit `findBookingById`.
- `apps/api/src/bootstrap/deposit-link-wiring.ts` - consumer 2: thread `orgId`, keep tenant check as defense-in-depth.
- `apps/api/src/bootstrap/__tests__/deposit-link-wiring.test.ts` - update call-arg assertion.
- `apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts` - gated real-PG read-scoping proof.

---

## Task 1: Fix A - org-scope `buildLocalStore.findById` (api) + retire schema comment

**Files:**

- Modify: `apps/api/src/bootstrap/calendar-provider-factory.ts:163-164`
- Modify: `packages/schemas/src/calendar.ts:129-131`
- Test: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts`

- [ ] **Step 1: Write the failing CI-safe unit test**

In `calendar-provider-factory.test.ts`, add `buildLocalStore` to the existing import from `"../calendar-provider-factory.js"`, then append:

```ts
describe("buildLocalStore.findById: org-scoping (read-side IDOR fix)", () => {
  function makeBookingPrisma(row: Record<string, unknown> | null) {
    return { booking: { findFirst: vi.fn(async () => row) } };
  }

  it("reads through findFirst scoped to the closed-over org id", async () => {
    const prisma = makeBookingPrisma({
      id: "bk_1",
      contactId: "ct_1",
      organizationId: "org-A",
      service: "consultation",
      status: "confirmed",
      startsAt: new Date("2026-04-20T10:00:00Z"),
      endsAt: new Date("2026-04-20T10:30:00Z"),
      createdAt: new Date("2026-04-19T00:00:00Z"),
      updatedAt: new Date("2026-04-19T00:00:00Z"),
    });
    const store = buildLocalStore(prisma as never, "org-A");

    const result = await store.findById("bk_1");

    expect(prisma.booking.findFirst).toHaveBeenCalledWith({
      where: { id: "bk_1", organizationId: "org-A" },
    });
    expect(result?.id).toBe("bk_1");
  });

  it("returns null for an id that belongs to another org (findFirst no-match)", async () => {
    const prisma = makeBookingPrisma(null);
    const store = buildLocalStore(prisma as never, "org-A");

    const result = await store.findById("bk-from-org-B");

    expect(result).toBeNull();
    expect(prisma.booking.findFirst).toHaveBeenCalledWith({
      where: { id: "bk-from-org-B", organizationId: "org-A" },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- src/bootstrap/__tests__/calendar-provider-factory.test.ts`
Expected: FAIL - the new tests error because the code calls `findUnique` (the `findFirst` mock is never called / the where-clause assertion fails).

- [ ] **Step 3: Implement Fix A**

In `calendar-provider-factory.ts`, change the `findById` read (currently lines 163-164):

```ts
    findById: async (bookingId: string) => {
      const row = await prismaClient.booking.findFirst({
        where: { id: bookingId, organizationId: orgId },
      });
      if (!row) return null;
```

(The rest of the mapping body is unchanged.)

- [ ] **Step 4: Retire the schema comment**

In `packages/schemas/src/calendar.ts`, replace the parenthetical (currently lines 129-131) so it no longer says "out-of-scope":

```ts
// Callers pass `booking.calendarEventId`; the durable row mutation is owned by the
// booking store. (`getBooking` keys by the durable row id and is org-scoped through the
// per-org local store and the org-scoped PrismaBookingStore.findById.)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/api test -- src/bootstrap/__tests__/calendar-provider-factory.test.ts`
Expected: PASS (the two new tests plus all pre-existing factory tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bootstrap/calendar-provider-factory.ts \
        apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts \
        packages/schemas/src/calendar.ts
git commit -m "fix(api): org-scope buildLocalStore.findById (calendar read IDOR, F12)"
```

---

## Task 2: Fix B - org-scope `PrismaBookingStore.findById` + thread orgId through both consumers (db + core + api)

This is one atomic cross-package signature change: the store, both consumers, and their tests land in a single green commit (a partial commit would not typecheck).

**Files:**

- Modify: `packages/db/src/stores/prisma-booking-store.ts:96-98`
- Test: `packages/db/src/stores/__tests__/prisma-booking-store.test.ts:129-137`
- Modify: `packages/core/src/skill-runtime/tools/booking-failure-handler.ts:23-25,67`
- Test: `packages/core/src/skill-runtime/tools/booking-failure-handler.test.ts:90-91`
- Modify: `apps/api/src/bootstrap/skill-mode.ts:271-276,379`
- Modify: `apps/api/src/bootstrap/deposit-link-wiring.ts:33-37,54-58`
- Test: `apps/api/src/bootstrap/__tests__/deposit-link-wiring.test.ts:63`

- [ ] **Step 1: Write the failing db unit test**

In `prisma-booking-store.test.ts`, replace the existing `it("finds a booking by id", ...)` (lines 129-137) with:

```ts
it("finds a booking by id scoped to the org (findFirst on id + organizationId)", async () => {
  (prisma.booking.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "bk_1",
    organizationId: "org_1",
    status: "confirmed",
  });

  const result = await store.findById("org_1", "bk_1");
  expect(result?.status).toBe("confirmed");
  expect(prisma.booking.findFirst).toHaveBeenCalledWith({
    where: { id: "bk_1", organizationId: "org_1" },
  });
});

it("findById returns null for an id in another org (no cross-org read)", async () => {
  (prisma.booking.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

  const result = await store.findById("org_other", "bk_1");
  expect(result).toBeNull();
  expect(prisma.booking.findFirst).toHaveBeenCalledWith({
    where: { id: "bk_1", organizationId: "org_other" },
  });
});
```

- [ ] **Step 2: Write the failing core assertion**

In `booking-failure-handler.test.ts`, in the first test (`it("marks booking as failed ...")`), add right after `expect(txHelper.fn).toHaveBeenCalledTimes(1);`:

```ts
// Read-side org-scoping: the idempotency lookup is keyed by org + booking id.
expect(bookingStore.findById).toHaveBeenCalledWith("org_1", "bk_1");
```

- [ ] **Step 3: Write the failing api (deposit) assertion**

In `deposit-link-wiring.test.ts`, in the org-isolation test, change the call assertion (line 63):

```ts
expect(findBookingById).toHaveBeenCalledWith("org_1", "bk_1");
```

- [ ] **Step 4: Run the three test files to verify they fail**

Run:

```bash
pnpm --filter @switchboard/db test -- src/stores/__tests__/prisma-booking-store.test.ts
pnpm --filter @switchboard/core test -- src/skill-runtime/tools/booking-failure-handler.test.ts
pnpm --filter @switchboard/api test -- src/bootstrap/__tests__/deposit-link-wiring.test.ts
```

Expected: each FAILS - the store still uses `findUnique(bookingId)`; the handler/wiring still call `findById` with one arg.

- [ ] **Step 5: Implement the db store change**

In `prisma-booking-store.ts`, replace `findById` (lines 96-98):

```ts
  async findById(organizationId: string, bookingId: string) {
    return this.prisma.booking.findFirst({ where: { id: bookingId, organizationId } });
  }
```

- [ ] **Step 6: Implement the core consumer change**

In `booking-failure-handler.ts`, change the subset interface (lines 23-25):

```ts
interface BookingStoreSubset {
  findById(orgId: string, bookingId: string): Promise<{ id: string; status: string } | null>;
}
```

and the call site (line 67):

```ts
const booking = await this.deps.bookingStore.findById(input.orgId, input.bookingId);
```

- [ ] **Step 7: Implement the api wiring changes**

In `skill-mode.ts`, the failure-handler adapter (lines 271-276):

```ts
    bookingStore: {
      findById: async (orgId: string, bookingId: string) => {
        const b = await bookingStore.findById(orgId, bookingId);
        return b ? { id: b.id, status: b.status } : null;
      },
    },
```

and the deposit `findBookingById` (line 379):

```ts
      findBookingById: (orgId: string, bookingId: string) =>
        bookingStore.findById(orgId, bookingId),
```

In `deposit-link-wiring.ts`, the dep comment + contract (lines 33-37):

```ts
/**
 * Resolves the durable booking row by id. `PrismaBookingStore.findById` is now org-scoped
 * (it takes orgId), so this lookup is keyed by org; the adapter below keeps an explicit
 * tenant check as a redundant second barrier (defense-in-depth).
 */
findBookingById: (orgId: string, bookingId: string) => Promise<BookingRow | null>;
```

and the adapter (lines 54-58):

```ts
    findById: async (orgId: string, bookingId: string) => {
      const booking = await deps.findBookingById(orgId, bookingId);
      // Defense-in-depth: the store is org-scoped, but keep an explicit tenant check so the
      // deposit tool's isolation never silently depends on the store query shape.
      if (!booking || booking.organizationId !== orgId) return null;
      return { id: booking.id, organizationId: booking.organizationId, status: booking.status };
    },
```

- [ ] **Step 8: Run the three test files + typecheck to verify green**

Run:

```bash
pnpm --filter @switchboard/db test -- src/stores/__tests__/prisma-booking-store.test.ts
pnpm --filter @switchboard/core test -- src/skill-runtime/tools/booking-failure-handler.test.ts
pnpm --filter @switchboard/api test -- src/bootstrap/__tests__/deposit-link-wiring.test.ts
pnpm typecheck
```

Expected: all three test files PASS; `pnpm typecheck` PASS (no other caller of `PrismaBookingStore.findById` exists, so nothing else breaks).

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/stores/prisma-booking-store.ts \
        packages/db/src/stores/__tests__/prisma-booking-store.test.ts \
        packages/core/src/skill-runtime/tools/booking-failure-handler.ts \
        packages/core/src/skill-runtime/tools/booking-failure-handler.test.ts \
        apps/api/src/bootstrap/skill-mode.ts \
        apps/api/src/bootstrap/deposit-link-wiring.ts \
        apps/api/src/bootstrap/__tests__/deposit-link-wiring.test.ts
git commit -m "fix(db): org-scope PrismaBookingStore.findById and thread orgId through consumers (F12)"
```

---

## Task 3: Gated real-PG read-scoping proof (integration)

**Files:**

- Test: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts`

- [ ] **Step 1: Add the gated cross-org read proof**

Append a new block (after the existing reschedule/cancel cross-org block). `buildLocalStore`, `PrismaBookingStore`, and `PrismaClient` are already imported:

```ts
// Read-side cross-org isolation (this slice, F12 read-scoping leg): a read keyed to the wrong org
// returns null for BOTH the per-org local store (buildLocalStore, the getBooking read path) and the
// durable PrismaBookingStore.findById; the owning org still reads the row. Mirrors the write-path proof.
describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "calendar booking read-side cross-org isolation (integration, F12 read-scoping)",
  () => {
    it("a findById keyed to another org returns null; the owning org still reads it", async () => {
      const prisma = new PrismaClient();
      const durable = new PrismaBookingStore(prisma);
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const orgA = `f12rd-a-${suffix}`;
      const orgB = `f12rd-b-${suffix}`;

      try {
        const a = await durable.create({
          organizationId: orgA,
          contactId: "pa",
          service: "consultation",
          startsAt: new Date("2026-10-09T02:00:00.000Z"),
          endsAt: new Date("2026-10-09T03:00:00.000Z"),
        });

        // Durable store: org B cannot read org A's booking; org A can.
        expect(await durable.findById(orgB, a.id)).toBeNull();
        expect((await durable.findById(orgA, a.id))?.id).toBe(a.id);

        // Per-org local store (the getBooking read path): org B's store returns null; org A's returns it.
        expect(await buildLocalStore(prisma, orgB).findById(a.id)).toBeNull();
        expect((await buildLocalStore(prisma, orgA).findById(a.id))?.id).toBe(a.id);
      } finally {
        await prisma.booking
          .deleteMany({ where: { organizationId: { in: [orgA, orgB] } } })
          .catch(() => {});
        await prisma.$disconnect();
      }
    });
  },
);
```

- [ ] **Step 2: Run the gated proof against real Postgres**

From the worktree root (the `DATABASE_URL` contains an `&`, so use `--env-file`, never `source`):

```bash
RUN_DB_INTEGRATION=1 node --env-file=.env node_modules/vitest/vitest.mjs run \
  apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts
```

Expected: the new read-scoping `it` PASSES (alongside the pre-existing F12 integration proofs). If vitest cannot resolve config from the root, run the same command from `apps/api` with `--env-file=../../.env` and the path relative to `apps/api`.

- [ ] **Step 3: Confirm CI still skips it (no opt-in)**

Run: `pnpm --filter @switchboard/api test -- src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts`
Expected: the integration blocks are SKIPPED (no `RUN_DB_INTEGRATION`), so the file passes with skipped suites.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts
git commit -m "test(api): gated real-PG proof for calendar booking read-side org-scoping (F12)"
```

---

## Task 4: Full gate sweep

**Files:** none (verification only; commit only if a formatter rewrites a file).

- [ ] **Step 1: Run the full required + local gates**

```bash
pnpm typecheck
pnpm --filter @switchboard/db test
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/api test
pnpm arch:check
pnpm format:check
pnpm lint
```

Expected: typecheck clean; the three package suites green (pre-existing pg-advisory / work-trace / ledger / greeting DB-integration flakes against a dirty shared local DB are not caused by this change - confirm the new tests pass and the booking/deposit suites are green); `arch:check` clean (no `.ts` file crosses 600 lines); `format:check` clean; `lint` 0 errors.

- [ ] **Step 2: If `format:check` flagged anything, fix and commit**

```bash
pnpm format
git add -A && git commit -m "chore: prettier format"
```

---

## Self-review notes

- Spec coverage: Fix A (Task 1), Fix B store + both consumers (Task 2), comment retirement (Task 1 Step 4), CI-safe proofs (Tasks 1-2), gated real-PG proof (Task 3), gates (Task 4). Option 3 (CalendarProvider.getBooking signature) deliberately not implemented, per the spec.
- Type consistency: `findById(organizationId, bookingId)` order is identical in the db store, the core `BookingStoreSubset`, the skill-mode adapter, the deposit `findBookingById`, and the deposit-link `BookingLookup` (already `(orgId, bookingId)`). Return type `Booking | null` unchanged.
- No production caller of `PrismaBookingStore.findById` exists beyond the two threaded consumers; `app.ts`/`inngest.ts`/`dashboard-overview.ts` use other booking methods. `pnpm typecheck` is the backstop.
