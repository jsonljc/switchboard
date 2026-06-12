# F12 Local-Calendar Double-Book Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local (no-Google) calendar booking insert race-safe so two simultaneous bookings for the same slot produce exactly one success and one `SLOT_CONFLICT`.

**Architecture:** Add the existing per-org `pg_advisory_xact_lock(BOOKING_LOCK_NS, hashtext(orgId))` as the first statement inside `buildLocalStore(...).createInTransaction` (Approach B). Share the lock namespace constant by exporting `BOOKING_LOCK_NS` from `@switchboard/db`. No schema change: the lock primitive and the active-booking partial-unique index already exist; we only make the local path use them.

**Tech Stack:** TypeScript ESM, Prisma (PostgreSQL), Vitest, pnpm + Turborepo.

---

## Why Approach B (not A)

Routing `buildLocalStore` through `PrismaBookingStore.create` (Approach A) is unworkable: `calendar-book.ts` already inserts a `pending_confirmation` row via `PrismaBookingStore.create` (step 1, line 272) before calling the provider (step 2, line 321). A second `PrismaBookingStore.create` would take the lock, run its overlap check, find step 1's own live row, and throw on every local booking. It also hardcodes `status: "pending_confirmation"` and drops `calendarEventId`, and throws a different error type. Approach B adds the lock in place and changes nothing else. See the design spec: `docs/superpowers/specs/2026-06-12-local-calendar-doublebook-design.md`.

## File Structure

- `packages/db/src/stores/prisma-booking-store.ts` (modify): export the existing `BOOKING_LOCK_NS` constant.
- `packages/db/src/index.ts` (modify): re-export `BOOKING_LOCK_NS` from the package root.
- `packages/db/src/stores/__tests__/prisma-booking-store.test.ts` (modify): pin the exported value.
- `apps/api/src/bootstrap/calendar-provider-factory.ts` (modify): import `BOOKING_LOCK_NS`, export `buildLocalStore`, issue the advisory lock as the first statement in `createInTransaction`.
- `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts` (modify): mocked unit proof that the lock precedes the overlap check and insert.
- `apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts` (create): gated real-Postgres concurrency proof (the done-when).

---

## Task 1: Export the booking-lock namespace from `@switchboard/db`

**Files:**

- Modify: `packages/db/src/stores/prisma-booking-store.ts:23`
- Modify: `packages/db/src/index.ts:102`
- Test: `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`

- [ ] **Step 1: Make the constant exported**

In `packages/db/src/stores/prisma-booking-store.ts`, change line 23 from:

```ts
const BOOKING_LOCK_NS = 920_001;
```

to:

```ts
export const BOOKING_LOCK_NS = 920_001;
```

- [ ] **Step 2: Re-export from the package root**

In `packages/db/src/index.ts`, change line 102 from:

```ts
export { PrismaBookingStore } from "./stores/prisma-booking-store.js";
```

to:

```ts
export { PrismaBookingStore, BOOKING_LOCK_NS } from "./stores/prisma-booking-store.js";
```

- [ ] **Step 3: Pin the exported value in the db test**

In `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`, update the import on line 4 to add `BOOKING_LOCK_NS`:

```ts
import { PrismaBookingStore, BOOKING_LOCK_NS } from "../prisma-booking-store.js";
```

Then add this test inside the top-level `describe("PrismaBookingStore", ...)` block (after the existing `"creates a booking ..."` test):

```ts
it("exports a stable advisory-lock namespace (shared with the local calendar path)", () => {
  expect(BOOKING_LOCK_NS).toBe(920_001);
});
```

- [ ] **Step 4: Build db and run its tests**

Run: `pnpm --filter @switchboard/db build && pnpm --filter @switchboard/db test`
Expected: build succeeds; all db tests PASS (including the new namespace assertion).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-booking-store.ts packages/db/src/index.ts packages/db/src/stores/__tests__/prisma-booking-store.test.ts
git commit -m "refactor(db): export BOOKING_LOCK_NS for the local calendar booking path"
```

---

## Task 2: Advisory-lock `buildLocalStore.createInTransaction` (mocked unit proof)

**Files:**

- Modify: `apps/api/src/bootstrap/calendar-provider-factory.ts`
- Test: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts`

- [ ] **Step 1: Write the failing unit tests**

In `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts`, extend the first import line to add `buildLocalStore`:

```ts
import { createCalendarProviderFactory, buildLocalStore } from "../calendar-provider-factory.js";
```

Add a `BOOKING_LOCK_NS` import below the existing imports:

```ts
import { BOOKING_LOCK_NS } from "@switchboard/db";
```

Append this describe block to the end of the file:

```ts
describe("buildLocalStore.createInTransaction: advisory lock (F12)", () => {
  function makeTxPrisma() {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      booking: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: "bk_new" }),
      },
    };
    const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    return { prisma, tx };
  }

  const input = {
    organizationId: "org-1",
    contactId: "ct-1",
    service: "consultation",
    startsAt: new Date("2026-06-20T02:00:00Z"),
    endsAt: new Date("2026-06-20T03:00:00Z"),
    timezone: "Asia/Singapore",
    status: "confirmed",
    calendarEventId: "local-evt-1",
    createdByType: "agent",
  };

  it("takes pg_advisory_xact_lock(BOOKING_LOCK_NS, hashtext(orgId)) before the overlap check and insert", async () => {
    const { prisma, tx } = makeTxPrisma();
    const store = buildLocalStore(prisma as never, "org-1");

    await store.createInTransaction(input);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((strings as string[]).join("?")).toContain("pg_advisory_xact_lock");
    expect(values).toContain(BOOKING_LOCK_NS);
    expect(values).toContain("org-1");

    const lockOrder = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const findOrder = (tx.booking.findMany as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    const createOrder = (tx.booking.create as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(findOrder);
    expect(findOrder).toBeLessThan(createOrder);
  });

  it("throws SLOT_CONFLICT without inserting when an overlap exists, lock still taken first", async () => {
    const { prisma, tx } = makeTxPrisma();
    (tx.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "existing" }]);
    const store = buildLocalStore(prisma as never, "org-1");

    await expect(store.createInTransaction(input)).rejects.toThrow("SLOT_CONFLICT");
    expect(tx.booking.create).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const lockOrder = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const findOrder = (tx.booking.findMany as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(findOrder);
  });
});
```

- [ ] **Step 2: Export `buildLocalStore` only (no lock yet), to surface the real red**

In `apps/api/src/bootstrap/calendar-provider-factory.ts`, change the declaration on line 146 from:

```ts
function buildLocalStore(prismaClient: PrismaClient, orgId: string) {
```

to:

```ts
export function buildLocalStore(prismaClient: PrismaClient, orgId: string) {
```

- [ ] **Step 3: Run the unit tests to verify they fail on the missing lock**

Run: `pnpm --filter @switchboard/api test calendar-provider-factory.test`
Expected: FAIL. The new tests fail with `expected "$executeRaw" to be called 1 times, but got 0 times` (the lock is not issued yet). The existing factory tests still PASS.

- [ ] **Step 4: Add the advisory lock**

In `apps/api/src/bootstrap/calendar-provider-factory.ts`, add this import near the top, immediately after the existing `import type { PrismaClient, Prisma } from "@switchboard/db";` line:

```ts
import { BOOKING_LOCK_NS } from "@switchboard/db";
```

Then, inside `createInTransaction`, add the lock as the first statement in the `$transaction` callback. Change:

```ts
      return prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        const conflicts = await tx.booking.findMany({
```

to:

```ts
      return prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        // Serialize check-then-insert per org so two concurrent leads cannot both pass
        // the overlap check and double-book the same physical slot (F12). Mirrors
        // PrismaBookingStore.create and shares BOOKING_LOCK_NS, so the local path and
        // the durable store lock on the same key. Held until the transaction commits.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOKING_LOCK_NS}, hashtext(${input.organizationId}))`;
        const conflicts = await tx.booking.findMany({
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `pnpm --filter @switchboard/api test calendar-provider-factory.test`
Expected: PASS (all tests in the file, new and existing).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bootstrap/calendar-provider-factory.ts apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts
git commit -m "fix(api): advisory-lock the local calendar booking insert (F12)"
```

---

## Task 3: Real-Postgres concurrency proof (the done-when)

**Files:**

- Create: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts`

- [ ] **Step 1: Write the gated concurrency test**

Create `apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@switchboard/db";
import { buildLocalStore } from "../calendar-provider-factory.js";

// Real-Postgres concurrency proof for F12: two simultaneous local-calendar bookings
// for the same slot but different patients must yield exactly one success and one
// SLOT_CONFLICT, leaving exactly one Booking row. Different contactIds ensure the
// active-booking partial-unique index is not what fires; the advisory lock is.
// Gated on DATABASE_URL so CI (no Postgres) skips it and it never blocks a merge.
describe.skipIf(!process.env["DATABASE_URL"])(
  "buildLocalStore.createInTransaction concurrency (integration, F12)",
  () => {
    it("two concurrent same-slot bookings for different patients yield one success and one SLOT_CONFLICT", async () => {
      const prisma = new PrismaClient();
      const orgId = `f12-it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const store = buildLocalStore(prisma, orgId);

      const startsAt = new Date("2026-09-01T02:00:00.000Z");
      const endsAt = new Date("2026-09-01T03:00:00.000Z");

      const bookFor = (contactId: string, suffix: string) =>
        store.createInTransaction({
          organizationId: orgId,
          contactId,
          service: "consultation",
          startsAt,
          endsAt,
          timezone: "Asia/Singapore",
          status: "confirmed",
          calendarEventId: `local-${suffix}`,
          createdByType: "agent",
        });

      try {
        const results = await Promise.allSettled([
          bookFor("patient-A", "a"),
          bookFor("patient-B", "b"),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        const reason = (rejected[0] as PromiseRejectedResult).reason as Error;
        expect(reason).toBeInstanceOf(Error);
        expect(reason.message).toBe("SLOT_CONFLICT");

        const rows = await prisma.booking.findMany({ where: { organizationId: orgId } });
        expect(rows).toHaveLength(1);
      } finally {
        await prisma.booking.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.$disconnect();
      }
    });
  },
);
```

- [ ] **Step 2: Run the concurrency test against the worktree DB (expect green)**

Run (from the worktree root):

```bash
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')" \
  pnpm --filter @switchboard/api exec vitest run src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts
```

Expected: PASS (1 test). One booking succeeds, one rejects with `SLOT_CONFLICT`, one row remains.

- [ ] **Step 3: Demonstrate the lock is load-bearing (throwaway red)**

Temporarily comment out the `await tx.$executeRaw\`SELECT pg_advisory_xact_lock(...)\``line in`calendar-provider-factory.ts`, re-run the command from Step 2, and confirm it now FAILS (typically both bookings succeed, two rows: a double-book). Then restore the line and re-run to confirm green again. Do not commit the commented-out state.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts
git commit -m "test(api): postgres concurrency proof for local booking lock (F12)"
```

---

## Task 4: Verification gates

- [ ] **Step 1: Run the focused package tests**

Run: `pnpm --filter @switchboard/db test && pnpm --filter @switchboard/api test`
Expected: all PASS. (The integration test self-skips here unless DATABASE_URL is exported, which is correct for the default run.)

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. If it reports a missing `BOOKING_LOCK_NS` export from `@switchboard/db`, run `pnpm --filter @switchboard/db build` then re-run (stale dist).

- [ ] **Step 3: Architecture line-count gate**

Run: `pnpm arch:check`
Expected: PASS (no file over 600 raw lines; the factory remains well under).

- [ ] **Step 4: Format check**

Run: `pnpm format:check`
Expected: PASS. If it reports diffs, run `pnpm format` (or `prettier --write` on the touched files) and amend.

- [ ] **Step 5: Plan the commit history is focused**

Run: `git log --oneline origin/main..HEAD`
Expected: spec doc, plan doc, db export, factory fix, integration test. Nothing unrelated.

---

## Self-Review (completed against the spec)

- **Spec coverage:** db export (Task 1) + factory lock (Task 2) + mocked proof (Task 2) + gated concurrency proof (Task 3) + gates (Task 4) cover every section of the spec. Approach B rationale carried into the plan header.
- **Placeholder scan:** none. Every code and command step is concrete.
- **Type consistency:** `buildLocalStore(prismaClient, orgId)` signature is reused identically in both tests; the `input` shape matches the `createInTransaction` parameter (required fields organizationId, contactId, service, startsAt, endsAt, timezone, status, calendarEventId, createdByType). `BOOKING_LOCK_NS` is the same symbol exported in Task 1 and asserted in Task 2. The thrown value is `Error("SLOT_CONFLICT")` in both the implementation and both tests.
- **No migration:** confirmed; the lock primitive and partial-unique index already exist in the shared DB.
