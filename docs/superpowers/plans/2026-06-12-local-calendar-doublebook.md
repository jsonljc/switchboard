# F12 Local-Calendar Double-Book Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local (no-Google) calendar booking insert race-safe so two simultaneous bookings for the same slot produce exactly one success and one `SLOT_CONFLICT`.

**Architecture:** Add the existing per-org `pg_advisory_xact_lock(BOOKING_LOCK_NS, hashtext(orgId))` as the first statement inside `buildLocalStore(...).createInTransaction` (Approach B), keying the lock, overlap check, and insert all off the store's bound `orgId`. Share the lock namespace constant by exporting `BOOKING_LOCK_NS` from `@switchboard/db`. No schema change: the lock primitive and the active-booking partial-unique index already exist; we only make the local path use them.

**Tech Stack:** TypeScript ESM, Prisma (PostgreSQL), Vitest, pnpm + Turborepo.

---

## Why Approach B (not A)

Routing `buildLocalStore` through `PrismaBookingStore.create` (Approach A) is unworkable: `calendar-book.ts` already inserts a `pending_confirmation` row via `PrismaBookingStore.create` (step 1, line 272) before calling the provider (step 2, line 321). A second `PrismaBookingStore.create` would take the lock, run its overlap check, find step 1's own live row, and throw on every local booking. It also hardcodes `status: "pending_confirmation"` and drops `calendarEventId`, and throws a different error type. Approach B adds the lock in place and changes nothing else. See the design spec: `docs/superpowers/specs/2026-06-12-local-calendar-doublebook-design.md`.

## File Structure

- `packages/db/src/stores/prisma-booking-store.ts` (modify): export the existing `BOOKING_LOCK_NS` constant.
- `packages/db/src/index.ts` (modify): re-export `BOOKING_LOCK_NS` from the package root.
- `packages/db/src/stores/__tests__/prisma-booking-store.test.ts` (modify): pin the exported value.
- `apps/api/src/bootstrap/calendar-provider-factory.ts` (modify): import `BOOKING_LOCK_NS`, export `buildLocalStore`, guard org mismatch, and issue the advisory lock as the first statement in `createInTransaction`, keyed off the store's `orgId`.
- `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts` (modify): mocked unit proof that the lock precedes the overlap check and insert, that all three key off the store org, and that a payload-org mismatch is rejected.
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

  const STORE_ORG = "org-from-store";

  const baseInput = {
    organizationId: STORE_ORG,
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
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await store.createInTransaction(baseInput);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((strings as string[]).join("?")).toContain("pg_advisory_xact_lock");
    expect(values).toContain(BOOKING_LOCK_NS);
    expect(values).toContain(STORE_ORG);

    const lockOrder = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const findOrder = (tx.booking.findMany as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    const createOrder = (tx.booking.create as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(findOrder);
    expect(findOrder).toBeLessThan(createOrder);
  });

  it("keys the lock, overlap check, and insert all off the store's bound org", async () => {
    const { prisma, tx } = makeTxPrisma();
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await store.createInTransaction(baseInput);

    const lockValues = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0]!.slice(1);
    expect(lockValues).toContain(STORE_ORG);
    const overlapWhere = (tx.booking.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0].where;
    expect(overlapWhere.organizationId).toBe(STORE_ORG);
    const createData = (tx.booking.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
    expect(createData.organizationId).toBe(STORE_ORG);
  });

  it("rejects ORGANIZATION_MISMATCH without locking or inserting when the payload org differs", async () => {
    const { prisma, tx } = makeTxPrisma();
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await expect(
      store.createInTransaction({ ...baseInput, organizationId: "org-from-input" }),
    ).rejects.toThrow("ORGANIZATION_MISMATCH");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it("throws SLOT_CONFLICT without inserting when an overlap exists, lock still taken first", async () => {
    const { prisma, tx } = makeTxPrisma();
    (tx.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "existing" }]);
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await expect(store.createInTransaction(baseInput)).rejects.toThrow("SLOT_CONFLICT");
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

to (add the test-scope comment too):

```ts
// Exported for the F12 focused unit + integration tests. This is not a public construction
// path; the calendar provider factory above is the only production caller.
export function buildLocalStore(prismaClient: PrismaClient, orgId: string) {
```

- [ ] **Step 3: Run the unit tests to verify they fail on the missing lock and guard**

Run: `pnpm --filter @switchboard/api test calendar-provider-factory.test`
Expected: FAIL. The lock-ordering tests fail with `expected "$executeRaw" to be called 1 times, but got 0 times`, and the mismatch test fails because `ORGANIZATION_MISMATCH` is never thrown. The existing factory tests still PASS.

- [ ] **Step 4: Add the import, the org guard, and the advisory lock**

In `apps/api/src/bootstrap/calendar-provider-factory.ts`, add this import immediately after the existing `import type { PrismaClient, Prisma } from "@switchboard/db";` line:

```ts
import { BOOKING_LOCK_NS } from "@switchboard/db";
```

Then replace the entire `createInTransaction` method body (the block from `createInTransaction: async (input: {` through its closing `},` at the original lines 159-209) with this version. The changes are: an `ORGANIZATION_MISMATCH` guard, the advisory lock as the first statement in the transaction, and keying the overlap check and insert off the store's `orgId` instead of `input.organizationId`.

```ts
    createInTransaction: async (input: {
      organizationId: string;
      contactId: string;
      opportunityId?: string | null;
      service: string;
      startsAt: Date;
      endsAt: Date;
      timezone: string;
      status: string;
      calendarEventId: string;
      attendeeName?: string | null;
      attendeeEmail?: string | null;
      createdByType: string;
      sourceChannel?: string | null;
      workTraceId?: string | null;
    }) => {
      // This store is bound to one org at construction. Refuse a payload whose org
      // disagrees so the advisory lock, overlap check, and insert can never key off
      // different orgs (F12).
      if (input.organizationId !== orgId) {
        throw new Error("ORGANIZATION_MISMATCH");
      }
      return prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        // Serialize check-then-insert per org so two concurrent leads cannot both pass
        // the overlap check and double-book the same physical slot (F12). Mirrors
        // PrismaBookingStore.create and shares BOOKING_LOCK_NS, so the local path and
        // the durable store lock on the same key. Held until the transaction commits.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOKING_LOCK_NS}, hashtext(${orgId}))`;
        const conflicts = await tx.booking.findMany({
          where: {
            organizationId: orgId,
            startsAt: { lt: input.endsAt },
            endsAt: { gt: input.startsAt },
            status: { notIn: ["cancelled", "failed"] },
          },
          select: { id: true },
          take: 1,
        });
        if (conflicts.length > 0) {
          throw new Error("SLOT_CONFLICT");
        }
        return tx.booking.create({
          data: {
            organizationId: orgId,
            contactId: input.contactId,
            opportunityId: input.opportunityId ?? null,
            service: input.service,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            timezone: input.timezone,
            status: input.status,
            calendarEventId: input.calendarEventId,
            attendeeName: input.attendeeName ?? null,
            attendeeEmail: input.attendeeEmail ?? null,
            createdByType: input.createdByType,
            sourceChannel: input.sourceChannel ?? null,
            workTraceId: input.workTraceId ?? null,
          },
          select: { id: true },
        });
      });
    },
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

// Real-Postgres concurrency proof for F12. Fires CONCURRENCY simultaneous local-calendar
// bookings for the SAME slot but DIFFERENT patients (different contactId). With the advisory
// lock, exactly one wins and the rest get SLOT_CONFLICT, leaving exactly one Booking row.
// Different contactIds ensure the active-booking partial-unique index is not what fires; the
// advisory lock is. Booking has no foreign keys (verified against the live schema), so
// free-string org/contact ids are safe and cleanup is a deleteMany.
//
// Double-gated: needs a real DATABASE_URL AND an explicit RUN_DB_INTEGRATION=1 opt-in, because
// it writes and deletes real rows. CI (no Postgres, no opt-in) skips it; it never blocks a merge.
const DB_INTEGRATION_ENABLED =
  !!process.env["DATABASE_URL"] && process.env["RUN_DB_INTEGRATION"] === "1";

describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "buildLocalStore.createInTransaction concurrency (integration, F12)",
  () => {
    it("N concurrent same-slot bookings for different patients yield exactly one success", async () => {
      const CONCURRENCY = 8;
      const prisma = new PrismaClient();
      const orgId = `f12-it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const store = buildLocalStore(prisma, orgId);

      const startsAt = new Date("2026-09-01T02:00:00.000Z");
      const endsAt = new Date("2026-09-01T03:00:00.000Z");

      const bookFor = (n: number) =>
        store.createInTransaction({
          organizationId: orgId,
          contactId: `patient-${n}`,
          service: "consultation",
          startsAt,
          endsAt,
          timezone: "Asia/Singapore",
          status: "confirmed",
          calendarEventId: `local-${n}`,
          createdByType: "agent",
        });

      try {
        const results = await Promise.allSettled(
          Array.from({ length: CONCURRENCY }, (_, n) => bookFor(n)),
        );

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(CONCURRENCY - 1);
        for (const r of rejected) {
          const reason = (r as PromiseRejectedResult).reason as Error;
          expect(reason).toBeInstanceOf(Error);
          expect(reason.message).toBe("SLOT_CONFLICT");
        }

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
RUN_DB_INTEGRATION=1 DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')" \
  pnpm --filter @switchboard/api exec vitest run src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts
```

Expected: PASS (1 test). Exactly one booking succeeds, seven reject with `SLOT_CONFLICT`, one row remains.

- [ ] **Step 3: Demonstrate the lock is load-bearing (throwaway red)**

To prove the test actually catches the race, make the race deterministic without the lock. Temporarily, in `calendar-provider-factory.ts`:

1. comment out the `await tx.$executeRaw\`SELECT pg_advisory_xact_lock(...)\`` line, and
2. insert `await tx.$executeRaw\`SELECT pg_sleep(0.05)\``between the overlap`findMany`and the`create` (this widens the check-then-insert window so all concurrent transactions interleave).

Re-run the command from Step 2 and confirm it FAILS (multiple successes and multiple rows: a double-book). Then remove the `pg_sleep` line and restore the advisory lock, and re-run to confirm green. Do not commit either throwaway change.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts
git commit -m "test(api): postgres concurrency proof for local booking lock (F12)"
```

---

## Task 4: Verification gates

- [ ] **Step 1: Run the focused package tests**

Run: `pnpm --filter @switchboard/db test && pnpm --filter @switchboard/api test`
Expected: all PASS. The integration test self-skips here (no `RUN_DB_INTEGRATION`), which is correct for the default run.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. If it reports a missing `BOOKING_LOCK_NS` export from `@switchboard/db`, run `pnpm --filter @switchboard/db build` then re-run (stale dist).

- [ ] **Step 3: Architecture line-count gate**

Run: `pnpm arch:check`
Expected: PASS (no file over 600 raw lines; the factory remains well under).

- [ ] **Step 4: Format check**

Run: `pnpm format:check`
Expected: PASS. If it reports diffs, run `pnpm format` (or `prettier --write` on the touched files) and amend.

- [ ] **Step 5: Confirm the commit history is focused**

Run: `git log --oneline origin/main..HEAD`
Expected: spec doc, plan doc, db export, factory fix, integration test. Nothing unrelated.

---

## Self-Review (completed against the spec)

- **Spec coverage:** db export (Task 1) + factory guard/lock (Task 2) + mocked proof incl. org-source + mismatch (Task 2) + gated concurrency proof (Task 3) + gates (Task 4) cover every section of the spec, including the five review amendments.
- **Placeholder scan:** none. Every code and command step is concrete.
- **Type consistency:** `buildLocalStore(prismaClient, orgId)` signature is reused identically in both tests; `baseInput` matches the `createInTransaction` parameter (required fields organizationId, contactId, service, startsAt, endsAt, timezone, status, calendarEventId, createdByType). `BOOKING_LOCK_NS` is the same symbol exported in Task 1 and asserted in Task 2. The thrown values are `Error("SLOT_CONFLICT")` and `Error("ORGANIZATION_MISMATCH")` in both the implementation and the tests. The lock, overlap `where`, and insert `data` all use the closed-over `orgId`.
- **No migration:** confirmed; the lock primitive and partial-unique index already exist in the shared DB, and `Booking` has no foreign keys.
