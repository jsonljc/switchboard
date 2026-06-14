# Local calendar reschedule/cancel hardening (F12 follow-up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two F12 follow-up findings in `buildLocalStore` — the local-calendar `reschedule` double-book race (no advisory lock / no overlap check) and the `reschedule` + `cancel` cross-org IDOR (writes not scoped to the bound org).

**Architecture:** Mirror the already-correct durable `PrismaBookingStore`. Reuse the shared `acquireBookingLock(tx, orgId)` helper (owns the `::int4` cast). Wrap `reschedule` in an interactive transaction (lock → org-scoped overlap excluding self → `updateMany` → `count===0` guard). Org-scope `cancel` with a `count===0` guard. The store closure already closes over `orgId`, so the `packages/core` `LocalBookingStore` interface is unchanged and core stays db-free.

**Tech Stack:** TypeScript (ESM), Prisma, Vitest, Postgres advisory locks.

---

## File Structure

- Modify: `apps/api/src/bootstrap/calendar-provider-factory.ts` — `buildLocalStore.reschedule` (lines ~255-266) and `.cancel` (lines ~249-254). `acquireBookingLock` and `Prisma` are already imported.
- Modify (test): `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts` — add two `describe` blocks (mocked-Prisma, always-on).
- Modify (test): `apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts` — add two `describe.skipIf` blocks (gated real-Postgres).

No new files. No migration (no schema change). Do **not** touch `createInTransaction` (shipped #1008).

---

## Task 1: reschedule — advisory lock + overlap + org-scope + count guard

**Files:**
- Modify: `apps/api/src/bootstrap/calendar-provider-factory.ts:255-266`
- Test: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Append to `calendar-provider-factory.test.ts`:

```ts
describe("buildLocalStore.reschedule: advisory lock + org scope (F12 follow-up)", () => {
  function makeTxPrisma() {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      booking: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    return { prisma, tx };
  }

  const STORE_ORG = "org-from-store";
  const BOOKING_ID = "bk-1";
  const newSlot = { start: "2026-06-20T04:00:00Z", end: "2026-06-20T05:00:00Z" };

  it("takes pg_advisory_xact_lock(::int4) before the overlap check and update", async () => {
    const { prisma, tx } = makeTxPrisma();
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await store.reschedule(BOOKING_ID, newSlot);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const lockSql = (strings as string[]).join("?");
    expect(lockSql).toContain("pg_advisory_xact_lock");
    expect(lockSql).toContain("::int4");
    expect(values).toContain(920_001);
    expect(values).toContain(STORE_ORG);

    const lockOrder = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const findOrder = (tx.booking.findMany as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    const updateOrder = (tx.booking.updateMany as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(findOrder);
    expect(findOrder).toBeLessThan(updateOrder);
  });

  it("scopes the overlap check to the bound org and excludes the booking being moved", async () => {
    const { prisma, tx } = makeTxPrisma();
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await store.reschedule(BOOKING_ID, newSlot);

    const overlapWhere = (tx.booking.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0].where;
    expect(overlapWhere.organizationId).toBe(STORE_ORG);
    expect(overlapWhere.id).toEqual({ not: BOOKING_ID });
  });

  it("scopes the update to the bound org (IDOR guard), increments count, returns { id }", async () => {
    const { prisma, tx } = makeTxPrisma();
    const store = buildLocalStore(prisma as never, STORE_ORG);

    const result = await store.reschedule(BOOKING_ID, newSlot);

    const updateArgs = (tx.booking.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(updateArgs.where).toEqual({ id: BOOKING_ID, organizationId: STORE_ORG });
    expect(updateArgs.data.rescheduleCount).toEqual({ increment: 1 });
    expect(result).toEqual({ id: BOOKING_ID });
  });

  it("throws SLOT_CONFLICT without updating when an overlap exists, lock still taken first", async () => {
    const { prisma, tx } = makeTxPrisma();
    (tx.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "other" }]);
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await expect(store.reschedule(BOOKING_ID, newSlot)).rejects.toThrow("SLOT_CONFLICT");
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    const lockOrder = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const findOrder = (tx.booking.findMany as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(findOrder);
  });

  it("throws BOOKING_NOT_FOUND when updateMany matches no row (missing or cross-org id)", async () => {
    const { prisma, tx } = makeTxPrisma();
    (tx.booking.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await expect(store.reschedule(BOOKING_ID, newSlot)).rejects.toThrow("BOOKING_NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/api test calendar-provider-factory.test`
Expected: the 5 new reschedule tests FAIL (current `reschedule` does a bare `booking.update` — no `$executeRaw`, no `findMany`, no `updateMany`).

- [ ] **Step 3: Implement the hardened reschedule**

Replace the `reschedule:` method body (currently a bare `prismaClient.booking.update`):

```ts
    reschedule: async (bookingId: string, newSlot: { start: string; end: string }) => {
      const startsAt = new Date(newSlot.start);
      const endsAt = new Date(newSlot.end);
      return prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        // Serialize check-then-move per org (mirrors createInTransaction and the durable
        // PrismaBookingStore.reschedule) so a reschedule cannot land on a slot another LIVE
        // booking already holds. The shared acquireBookingLock helper owns the ::int4 cast;
        // held until the transaction commits.
        await acquireBookingLock(tx, orgId);
        // Org-scoped, half-open overlap excluding the booking being moved so a no-op or
        // shrink reschedule does not self-conflict.
        const conflicts = await tx.booking.findMany({
          where: {
            organizationId: orgId,
            id: { not: bookingId },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
            status: { notIn: ["cancelled", "failed"] },
          },
          select: { id: true },
          take: 1,
        });
        if (conflicts.length > 0) {
          throw new Error("SLOT_CONFLICT");
        }
        // Org-scope the move. updateMany drops Prisma's P2025 not-found throw, so the
        // count===0 guard rejects a missing or cross-org id instead of silently no-op'ing (F12).
        const result = await tx.booking.updateMany({
          where: { id: bookingId, organizationId: orgId },
          data: {
            startsAt,
            endsAt,
            rescheduleCount: { increment: 1 },
          },
        });
        if (result.count === 0) {
          throw new Error("BOOKING_NOT_FOUND");
        }
        return { id: bookingId };
      });
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/api test calendar-provider-factory.test`
Expected: all reschedule tests PASS (and the existing create/factory tests still PASS).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/calendar-provider-factory.ts \
        apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts
git commit -m "fix(api): lock and org-scope local calendar reschedule (F12 follow-up)"
```

---

## Task 2: cancel — org-scope + count guard

**Files:**
- Modify: `apps/api/src/bootstrap/calendar-provider-factory.ts:249-254`
- Test: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Append to `calendar-provider-factory.test.ts`:

```ts
describe("buildLocalStore.cancel: org scope (F12 follow-up)", () => {
  const STORE_ORG = "org-from-store";
  const BOOKING_ID = "bk-1";

  function makePrisma(count: number) {
    return { booking: { updateMany: vi.fn().mockResolvedValue({ count }) } };
  }

  it("scopes the cancel update to the bound org (IDOR guard)", async () => {
    const prisma = makePrisma(1);
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await store.cancel(BOOKING_ID);

    const updateArgs = (prisma.booking.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(updateArgs.where).toEqual({ id: BOOKING_ID, organizationId: STORE_ORG });
    expect(updateArgs.data).toEqual({ status: "cancelled" });
  });

  it("throws BOOKING_NOT_FOUND when updateMany matches no row (missing or cross-org id)", async () => {
    const prisma = makePrisma(0);
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await expect(store.cancel(BOOKING_ID)).rejects.toThrow("BOOKING_NOT_FOUND");
  });

  it("resolves void on success", async () => {
    const prisma = makePrisma(1);
    const store = buildLocalStore(prisma as never, STORE_ORG);

    await expect(store.cancel(BOOKING_ID)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/api test calendar-provider-factory.test`
Expected: the 3 new cancel tests FAIL (current `cancel` calls `booking.update`, not `updateMany`, and never throws on no-match).

- [ ] **Step 3: Implement the hardened cancel**

Replace the `cancel:` method body:

```ts
    cancel: async (bookingId: string) => {
      // Org-scope the cancel so a forged/guessed bookingId from another org cannot cancel
      // that org's booking (F12). A cancel cannot create a slot conflict, so no lock/overlap.
      // updateMany drops Prisma's P2025 not-found throw, so the count===0 guard rejects a
      // missing or cross-org id instead of silently no-op'ing.
      const result = await prismaClient.booking.updateMany({
        where: { id: bookingId, organizationId: orgId },
        data: { status: "cancelled" },
      });
      if (result.count === 0) {
        throw new Error("BOOKING_NOT_FOUND");
      }
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/api test calendar-provider-factory.test`
Expected: all unit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/calendar-provider-factory.ts \
        apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts
git commit -m "fix(api): org-scope local calendar cancel (F12 follow-up)"
```

---

## Task 3: Gated real-Postgres integration proofs

**Files:**
- Test: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts`

- [ ] **Step 1: Append the two gated describe blocks**

The file already defines `DB_INTEGRATION_ENABLED` and imports `PrismaClient`/`buildLocalStore`. Append:

```ts
// Finding A (race): two concurrent reschedules of two different bookings onto the SAME free
// slot for one org. The advisory lock serializes them; exactly one wins and the other gets
// SLOT_CONFLICT, so the target slot is never double-held and the loser stays put.
describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "buildLocalStore.reschedule concurrency (integration, F12 follow-up)",
  () => {
    it("two concurrent reschedules onto one slot yield exactly one success + one SLOT_CONFLICT", async () => {
      const prisma = new PrismaClient();
      const orgId = `f12r-it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const store = buildLocalStore(prisma, orgId);

      const slotA = { start: "2026-09-05T02:00:00.000Z", end: "2026-09-05T03:00:00.000Z" };
      const slotB = { start: "2026-09-05T04:00:00.000Z", end: "2026-09-05T05:00:00.000Z" };
      const target = { start: "2026-09-05T06:00:00.000Z", end: "2026-09-05T07:00:00.000Z" };

      const mk = (n: number, slot: { start: string; end: string }) =>
        store.createInTransaction({
          organizationId: orgId,
          contactId: `patient-${n}`,
          service: "consultation",
          startsAt: new Date(slot.start),
          endsAt: new Date(slot.end),
          timezone: "Asia/Singapore",
          status: "confirmed",
          calendarEventId: `local-${n}`,
          createdByType: "agent",
        });

      try {
        const a = await mk(1, slotA);
        const b = await mk(2, slotB);

        const results = await Promise.allSettled([
          store.reschedule(a.id, target),
          store.reschedule(b.id, target),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        const reason = (rejected[0] as PromiseRejectedResult).reason as Error;
        expect(reason).toBeInstanceOf(Error);
        expect(reason.message).toBe("SLOT_CONFLICT");

        // The target slot is held by exactly one LIVE booking (not double-held).
        const inTarget = await prisma.booking.findMany({
          where: {
            organizationId: orgId,
            status: { notIn: ["cancelled", "failed"] },
            startsAt: { lt: new Date(target.end) },
            endsAt: { gt: new Date(target.start) },
          },
        });
        expect(inTarget).toHaveLength(1);

        // The loser is byte-for-byte unchanged at its original slot.
        const all = await prisma.booking.findMany({ where: { organizationId: orgId } });
        expect(all).toHaveLength(2);
        const winners = all.filter((r) => r.startsAt.toISOString() === target.start);
        const losers = all.filter((r) => r.startsAt.toISOString() !== target.start);
        expect(winners).toHaveLength(1);
        expect(winners[0]!.rescheduleCount).toBe(1);
        expect(losers).toHaveLength(1);
        expect(losers[0]!.rescheduleCount).toBe(0);
        expect([slotA.start, slotB.start]).toContain(losers[0]!.startsAt.toISOString());
      } finally {
        await prisma.booking.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.$disconnect();
      }
    });
  },
);

// Finding B (IDOR): a store bound to org-B must not reschedule or cancel org-A's booking.
// Both reject (BOOKING_NOT_FOUND, not a silent no-op) and org-A's row stays untouched; org-A
// can still reschedule it, proving the guard is org-scoping, not a freeze.
describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "buildLocalStore reschedule/cancel cross-org isolation (integration, F12 follow-up)",
  () => {
    it("org-B cannot reschedule or cancel org-A's booking; org-A's row is untouched", async () => {
      const prisma = new PrismaClient();
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const orgA = `f12x-a-${suffix}`;
      const orgB = `f12x-b-${suffix}`;
      const storeA = buildLocalStore(prisma, orgA);
      const storeB = buildLocalStore(prisma, orgB);

      const slot = { start: "2026-09-07T02:00:00.000Z", end: "2026-09-07T03:00:00.000Z" };
      const newSlot = { start: "2026-09-07T08:00:00.000Z", end: "2026-09-07T09:00:00.000Z" };

      try {
        const created = await storeA.createInTransaction({
          organizationId: orgA,
          contactId: "patient-a",
          service: "consultation",
          startsAt: new Date(slot.start),
          endsAt: new Date(slot.end),
          timezone: "Asia/Singapore",
          status: "confirmed",
          calendarEventId: "local-a",
          createdByType: "agent",
        });

        await expect(storeB.reschedule(created.id, newSlot)).rejects.toThrow("BOOKING_NOT_FOUND");
        await expect(storeB.cancel(created.id)).rejects.toThrow("BOOKING_NOT_FOUND");

        const row = await prisma.booking.findUnique({ where: { id: created.id } });
        expect(row).not.toBeNull();
        expect(row!.startsAt.toISOString()).toBe(slot.start);
        expect(row!.endsAt.toISOString()).toBe(slot.end);
        expect(row!.status).toBe("confirmed");
        expect(row!.rescheduleCount).toBe(0);

        // org-A can still reschedule its own booking (guard is org-scoping, not a freeze).
        const moved = await storeA.reschedule(created.id, newSlot);
        expect(moved).toEqual({ id: created.id });
        const after = await prisma.booking.findUnique({ where: { id: created.id } });
        expect(after!.startsAt.toISOString()).toBe(newSlot.start);
        expect(after!.rescheduleCount).toBe(1);
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

- [ ] **Step 2: Run the gated integration tests locally against Postgres**

Load `DATABASE_URL` from the worktree root `.env` (mind the `&` in the URL — do not naive-`source`), and opt in:

Run:
```bash
DATABASE_URL="$(node -e 'require("dotenv").config();process.stdout.write(process.env.DATABASE_URL||"")' 2>/dev/null || node --env-file=.env -e 'process.stdout.write(process.env.DATABASE_URL)')" \
RUN_DB_INTEGRATION=1 \
pnpm --filter @switchboard/api test calendar-provider-factory.integration
```
Expected: the two new F12-follow-up integration tests PASS (alongside the existing #1008 create/lock-cast integration tests). If the env wiring above is awkward, extract `DATABASE_URL` however is reliable in this shell and export it inline — the only requirement is that `process.env.DATABASE_URL` and `RUN_DB_INTEGRATION=1` are both set.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts
git commit -m "test(api): real-postgres proofs for local reschedule race + cross-org IDOR (F12 follow-up)"
```

---

## Task 4: Full gate sweep

**Files:** none (verification only).

- [ ] **Step 1: Format check**

Run: `pnpm format:check`
Expected: PASS. If it reports the edited files, run `pnpm format` (or `prettier --write`) on them and amend the relevant commit.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (If it reports stale missing exports from `@switchboard/db`/`core`, run `pnpm reset` then retry — the build already ran clean here, so this is unlikely.)

- [ ] **Step 3: Arch check**

Run: `pnpm arch:check`
Expected: PASS (no file crosses 600 lines; `calendar-provider-factory.ts` stays well under).

- [ ] **Step 4: api + db package tests (CI-safe subset, no DB opt-in)**

Run: `pnpm --filter @switchboard/api test` then `pnpm --filter @switchboard/db test`
Expected: PASS. The gated DB-integration blocks self-skip without `RUN_DB_INTEGRATION=1`. Pre-existing DB-integration suites (ledger/work-trace/greeting) may red against a dirty shared DB locally — confirm only that the new calendar tests and the rest of the api/db unit suites pass; CI runs the full suite against a fresh seeded Postgres.

- [ ] **Step 5: Confirm the diff matches the plan (diff-discipline)**

Run: `git diff "$APPROVED_SHA"...HEAD -- apps/api/src/bootstrap/calendar-provider-factory.ts`
Expected: only `reschedule` and `cancel` changed; `createInTransaction`, `findOverlapping`, `findById`, and the factory/resolver untouched.

---

## Self-Review

- **Spec coverage:** Finding A → Task 1 (lock+overlap) + Task 3 concurrency proof. Finding B → Task 1 (reschedule org-scope) + Task 2 (cancel org-scope) + Task 3 cross-org proof. Return contracts (`{ id }` / `void`) → Task 1/2 unit assertions. count===0 guard → Task 1/2. No-touch of create path → Task 4 Step 5. All covered.
- **Placeholders:** none — every code step shows full code; every run step shows the command + expected result.
- **Type consistency:** `reschedule(bookingId, { start, end })` → `Promise<{ id }>` and `cancel(bookingId)` → `Promise<void>` match the `LocalBookingStore` interface in `packages/core`. `updateMany` returns `{ count }`; `acquireBookingLock(tx, orgId)` matches the exported helper signature. Error strings (`SLOT_CONFLICT`, `BOOKING_NOT_FOUND`) are consistent across tasks.
