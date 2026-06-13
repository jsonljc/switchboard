# Local-calendar reschedule/cancel identifier seam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `calendar.reschedule` (and `calendar.cancel`) work for no-PMS (LocalCalendarProvider) orgs by making the durable `PrismaBookingStore` the single writer, so the booking row actually moves and a genuine clash is re-offered retryably.

**Architecture:** For a local (DB-backed) calendar the durable `Booking` row IS the calendar; the provider has no separate external event to mutate. Make `LocalCalendarProvider.rescheduleBooking/cancelBooking` no-ops so the caller's already-wired durable `PrismaBookingStore` (advisory-locked, overlap-guarded, org-scoped, typed-conflict) is the sole writer. Remove the now-dead `buildLocalStore.reschedule/cancel` and migrate their F12 proof to the live path. Google is untouched.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo), Vitest, Prisma/Postgres, Zod.

See spec: `docs/superpowers/specs/2026-06-13-local-calendar-reschedule-identifier-seam-design.md`

---

## File Structure

- `packages/schemas/src/calendar.ts` — Modify: doc-comment the `CalendarProvider` reschedule/cancel identifier contract.
- `packages/core/src/calendar/local-calendar-provider.ts` — Modify: `rescheduleBooking`/`cancelBooking` become no-ops; remove `reschedule`/`cancel` from `LocalBookingStore`.
- `packages/core/src/calendar/local-calendar-provider.test.ts` — Modify: add no-op behavior tests; trim the directly-typed `LocalBookingStore` mock literal.
- `packages/core/src/skill-runtime/tools/index.ts` + `packages/core/src/skill-runtime/index.ts` — Modify: export `buildRescheduleOperations` + `CalendarRescheduleDeps` (for the api integration proof).
- `apps/api/src/bootstrap/calendar-provider-factory.ts` — Modify: remove `reschedule`/`cancel` from `buildLocalStore`.
- `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts` — Modify: delete the dead `buildLocalStore.reschedule`/`.cancel` unit describes.
- `apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts` — Modify: delete the dead `buildLocalStore` reschedule/cancel integration describes; add `PrismaBookingStore.reschedule` concurrency + cross-org describes; add the end-to-end tool reschedule describe.

The reschedule tool (`calendar-reschedule.ts`) and its existing tests are UNCHANGED — they already orchestrate provider-then-durable and map the typed conflict to `SLOT_TAKEN`. The fix is in the provider + store wiring beneath them.

---

## Task 1: Scaffolding — document the contract + export the reschedule builder

No behavior change; verified by typecheck/build. Done first so the integration test (Task 4) can import the builder.

**Files:**

- Modify: `packages/schemas/src/calendar.ts:92-99`
- Modify: `packages/core/src/skill-runtime/tools/index.ts`
- Modify: `packages/core/src/skill-runtime/index.ts:33-51`

- [ ] **Step 1: Doc-comment the CalendarProvider identifier contract**

In `packages/schemas/src/calendar.ts`, replace the `CalendarProvider` interface (lines 92-99) with:

```ts
export interface CalendarProvider {
  listAvailableSlots(query: SlotQuery): Promise<TimeSlot[]>;
  createBooking(input: CreateBookingInput): Promise<Booking>;
  // `eventId` is the provider's own calendar handle: the value returned as
  // `Booking.calendarEventId` from `createBooking` (a Google event id, or the local
  // provider's `local-<uuid>`), NOT the durable Booking row id. Callers pass
  // `booking.calendarEventId`; the durable row mutation is owned by the booking store.
  cancelBooking(eventId: string, reason?: string): Promise<void>;
  rescheduleBooking(eventId: string, newSlot: TimeSlot): Promise<Booking>;
  getBooking(eventId: string): Promise<Booking | null>;
  healthCheck(): Promise<CalendarHealthCheck>;
}
```

- [ ] **Step 2: Export the reschedule builder from the tools barrel**

In `packages/core/src/skill-runtime/tools/index.ts`, append:

```ts
export { buildRescheduleOperations } from "./calendar-reschedule.js";
export type { CalendarRescheduleDeps } from "./calendar-reschedule.js";
```

- [ ] **Step 3: Re-export through the skill-runtime barrel**

In `packages/core/src/skill-runtime/index.ts`, add `buildRescheduleOperations,` to the value re-export block ending at line 41 (`} from "./tools/index.js";`), and add `CalendarRescheduleDeps,` to the type re-export block ending at line 51.

- [ ] **Step 4: Typecheck + build core**

Run: `pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/core build && pnpm typecheck`
Expected: PASS (no behavior change; new exports resolve).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/calendar.ts packages/core/src/skill-runtime/tools/index.ts packages/core/src/skill-runtime/index.ts
git commit -m "refactor(calendar): document provider eventId contract; export reschedule builder"
```

---

## Task 2: LocalCalendarProvider reschedule/cancel become no-ops

**Files:**

- Modify: `packages/core/src/calendar/local-calendar-provider.ts:150-182`
- Test: `packages/core/src/calendar/local-calendar-provider.test.ts`

- [ ] **Step 1: Write the failing no-op tests**

In `packages/core/src/calendar/local-calendar-provider.test.ts`, add this describe inside the top-level `describe("LocalCalendarProvider", ...)` block (after the `getBooking` describe, around line 150):

```ts
describe("reschedule/cancel are no-ops (durable store owns the row)", () => {
  it("rescheduleBooking does not write to the store and echoes the new slot + eventId", async () => {
    const result = await provider.rescheduleBooking("local-evt-123", {
      start: "2026-09-01T02:00:00.000Z",
      end: "2026-09-01T03:00:00.000Z",
      calendarId: "local",
      available: true,
    });
    expect(store.reschedule).not.toHaveBeenCalled();
    expect(store.findById).not.toHaveBeenCalled();
    expect(result.calendarEventId).toBe("local-evt-123");
    expect(result.startsAt).toBe("2026-09-01T02:00:00.000Z");
    expect(result.endsAt).toBe("2026-09-01T03:00:00.000Z");
    expect(result.status).toBe("confirmed");
  });

  it("cancelBooking does not write to the store and resolves void", async () => {
    await expect(provider.cancelBooking("local-evt-123")).resolves.toBeUndefined();
    expect(store.cancel).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @switchboard/core test -- local-calendar-provider`
Expected: FAIL — today `rescheduleBooking` calls `store.findById`/`store.reschedule` and `cancelBooking` calls `store.cancel`, so the `not.toHaveBeenCalled()` assertions fail.

- [ ] **Step 3: Implement the no-ops**

In `packages/core/src/calendar/local-calendar-provider.ts`, replace `cancelBooking` + `rescheduleBooking` (lines 150-182) with:

```ts
  async cancelBooking(_calendarEventId: string, _reason?: string): Promise<void> {
    // No-op. The durable booking store (PrismaBookingStore.cancel, org-scoped +
    // count===0 guarded) is the single writer that cancels the row, and runs as the
    // caller's FIRST step. A local (DB-backed) calendar has no external event to delete,
    // so there is nothing to do here.
  }

  async rescheduleBooking(calendarEventId: string, newSlot: TimeSlot): Promise<Booking> {
    // No-op move. For a local (DB-backed) calendar there is no external event to patch:
    // the durable booking store (PrismaBookingStore.reschedule, advisory-locked +
    // overlap-guarded + org-scoped, throwing the typed BookingSlotConflictError) owns the
    // row mutation and runs as the caller's second step. Return a sparse Booking echoing
    // the requested slot, mirroring GoogleCalendarAdapter.rescheduleBooking; the caller
    // (calendar-reschedule tool) discards this return and treats the durable write as
    // authoritative.
    return {
      id: "",
      contactId: "",
      organizationId: "",
      service: "",
      status: "confirmed",
      calendarEventId,
      attendeeName: null,
      attendeeEmail: null,
      notes: null,
      createdByType: "agent",
      sourceChannel: null,
      workTraceId: null,
      opportunityId: null,
      startsAt: newSlot.start,
      endsAt: newSlot.end,
      timezone: this.businessHours.timezone,
      rescheduleCount: 0,
      rescheduledAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @switchboard/core test -- local-calendar-provider`
Expected: PASS (new no-op tests + all existing LocalCalendarProvider tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/calendar/local-calendar-provider.ts packages/core/src/calendar/local-calendar-provider.test.ts
git commit -m "fix(calendar): make LocalCalendarProvider reschedule/cancel no-ops (durable store is the writer)"
```

---

## Task 3: Remove the now-dead local-store reschedule/cancel

`buildLocalStore.reschedule/cancel` and `LocalBookingStore.reschedule/cancel` have no caller once the provider methods are no-ops. Remove them; the F12 invariants live on `PrismaBookingStore` (proven in Task 4).

**Files:**

- Modify: `packages/core/src/calendar/local-calendar-provider.ts:24-45` (interface)
- Modify: `apps/api/src/bootstrap/calendar-provider-factory.ts:249-305`
- Modify: `packages/core/src/calendar/local-calendar-provider.test.ts` (one typed literal)
- Modify: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts:310-427` (delete)

- [ ] **Step 1: Slim the LocalBookingStore interface**

In `packages/core/src/calendar/local-calendar-provider.ts`, remove the `cancel` and `reschedule` members from the `LocalBookingStore` interface (lines 43-44), leaving:

```ts
export interface LocalBookingStore {
  findOverlapping(startsAt: Date, endsAt: Date): Promise<Array<{ startsAt: Date; endsAt: Date }>>;
  createInTransaction(input: {
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
  }): Promise<{ id: string }>;
  findById(bookingId: string): Promise<Booking | null>;
}
```

- [ ] **Step 2: Remove reschedule/cancel from buildLocalStore**

In `apps/api/src/bootstrap/calendar-provider-factory.ts`, delete the `cancel:` (lines 249-261) and `reschedule:` (lines 262-305) properties from the object returned by `buildLocalStore`. The returned object keeps `findOverlapping`, `createInTransaction`, and `findById` only. (The closing `};` of the return object and the function stays.)

- [ ] **Step 3: Trim the directly-typed mock literal in the provider test**

In `packages/core/src/calendar/local-calendar-provider.test.ts`, the object literal explicitly typed `LocalBookingStoreOrgScope` (around line 328) will fail the excess-property check. Remove its `cancel` and `reschedule` keys:

```ts
const store: LocalBookingStoreOrgScope = {
  findOverlapping,
  createInTransaction: viOrgScope.fn(),
  findById: viOrgScope.fn(),
};
```

(Leave `makeBookingStore()` and `makeStoreForEmailTests()` as-is: their returns are inferred, not directly typed, so their `reschedule`/`cancel` `vi.fn()`s are allowed extras — and Task 2's no-op test asserts those mocks are NOT called, which documents the no-op.)

- [ ] **Step 4: Delete the dead buildLocalStore reschedule/cancel unit tests**

In `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts`, delete the entire `describe("buildLocalStore.reschedule: advisory lock + org scope (F12 follow-up)", ...)` block (lines 310-393) and the entire `describe("buildLocalStore.cancel: org scope (F12 follow-up)", ...)` block (lines 395-427). Keep the `buildLocalStore.createInTransaction` describe (lines 217-308).

- [ ] **Step 5: Typecheck + run both affected unit suites**

Run: `pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/core build && pnpm typecheck && pnpm --filter @switchboard/core test -- local-calendar-provider && pnpm --filter @switchboard/api test -- calendar-provider-factory.test`
Expected: PASS. Typecheck has no references to the removed `LocalBookingStore.reschedule/cancel`; the create-path tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/calendar/local-calendar-provider.ts packages/core/src/calendar/local-calendar-provider.test.ts apps/api/src/bootstrap/calendar-provider-factory.ts apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts
git commit -m "refactor(calendar): drop dead local-store reschedule/cancel (durable store owns it)"
```

---

## Task 4: Gated real-Postgres proofs (migrate F12 + end-to-end)

Replace the deleted `buildLocalStore` reschedule/cancel integration proofs with equivalents on the live `PrismaBookingStore`, and add the end-to-end tool reschedule proof. All gated behind `DATABASE_URL` + `RUN_DB_INTEGRATION=1` (skipped in CI).

**Files:**

- Modify: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts`

- [ ] **Step 1: Delete the dead buildLocalStore reschedule/cancel integration describes**

In `apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts`, delete the `describe.skipIf(...)("buildLocalStore.reschedule concurrency (integration, F12 follow-up)", ...)` block (lines 118-190) and the `describe.skipIf(...)("buildLocalStore reschedule/cancel cross-org isolation (integration, F12 follow-up)", ...)` block (lines 192-246). Keep the two `createInTransaction`/`PrismaBookingStore.create` concurrency describes.

- [ ] **Step 2: Add imports + a shared businessHours constant**

At the top of the file, extend the existing import and add the provider/tool imports + a constant:

```ts
import { PrismaClient, PrismaBookingStore } from "@switchboard/db";
import { buildLocalStore } from "../calendar-provider-factory.js";
import { LocalCalendarProvider } from "@switchboard/core/calendar";
import { buildRescheduleOperations } from "@switchboard/core/skill-runtime";
import type { BusinessHoursConfig } from "@switchboard/schemas";

const BUSINESS_HOURS: BusinessHoursConfig = {
  timezone: "Asia/Singapore",
  days: [
    { day: 1, open: "00:00", close: "23:59" },
    { day: 2, open: "00:00", close: "23:59" },
    { day: 3, open: "00:00", close: "23:59" },
    { day: 4, open: "00:00", close: "23:59" },
    { day: 5, open: "00:00", close: "23:59" },
  ],
  defaultDurationMinutes: 60,
  bufferMinutes: 0,
  slotIncrementMinutes: 60,
};
```

(`vitest` `describe`/`it`/`expect` and the `DB_INTEGRATION_ENABLED` constant already exist at the top of the file; reuse them.)

- [ ] **Step 3: Add the PrismaBookingStore F12 reschedule concurrency + cross-org describes**

Append:

```ts
// Migrated from the deleted buildLocalStore reschedule proofs: the F12 reschedule guarantees
// now live on the durable PrismaBookingStore, which is the store that actually runs in
// production (skill-mode.ts wires `new PrismaBookingStore(...)` as the reschedule tool's
// bookingStore). Two concurrent reschedules onto one slot: the advisory lock serializes them,
// exactly one wins and the other gets the TYPED conflict; the loser stays put.
describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "PrismaBookingStore.reschedule concurrency (integration, F12 on the live path)",
  () => {
    it("two concurrent reschedules onto one slot yield exactly one success + one typed conflict", async () => {
      const prisma = new PrismaClient();
      const store = new PrismaBookingStore(prisma);
      const orgId = `f12pr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const slotA = {
        startsAt: new Date("2026-10-05T02:00:00.000Z"),
        endsAt: new Date("2026-10-05T03:00:00.000Z"),
      };
      const slotB = {
        startsAt: new Date("2026-10-05T04:00:00.000Z"),
        endsAt: new Date("2026-10-05T05:00:00.000Z"),
      };
      const target = {
        startsAt: new Date("2026-10-05T06:00:00.000Z"),
        endsAt: new Date("2026-10-05T07:00:00.000Z"),
      };

      try {
        const a = await store.create({
          organizationId: orgId,
          contactId: "p1",
          service: "consultation",
          ...slotA,
        });
        const b = await store.create({
          organizationId: orgId,
          contactId: "p2",
          service: "consultation",
          ...slotB,
        });

        const results = await Promise.allSettled([
          store.reschedule(orgId, a.id, target),
          store.reschedule(orgId, b.id, target),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        const reason = (rejected[0] as PromiseRejectedResult).reason as { code?: string };
        expect(reason.code).toBe("SLOT_CONFLICT");

        const inTarget = await prisma.booking.findMany({
          where: {
            organizationId: orgId,
            status: { notIn: ["cancelled", "failed"] },
            startsAt: { lt: target.endsAt },
            endsAt: { gt: target.startsAt },
          },
        });
        expect(inTarget).toHaveLength(1);
        expect(inTarget[0]!.rescheduleCount).toBe(1);

        const all = await prisma.booking.findMany({ where: { organizationId: orgId } });
        const losers = all.filter(
          (r) => r.startsAt.toISOString() !== target.startsAt.toISOString(),
        );
        expect(losers).toHaveLength(1);
        expect(losers[0]!.rescheduleCount).toBe(0);
      } finally {
        await prisma.booking.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.$disconnect();
      }
    });
  },
);

// Migrated cross-org IDOR proof: a reschedule/cancel for the wrong org rejects (count===0
// guard), not a silent no-op, and the row stays untouched; the owning org can still act.
describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "PrismaBookingStore reschedule/cancel cross-org isolation (integration, F12 on the live path)",
  () => {
    it("org-B cannot reschedule or cancel org-A's booking; org-A still can", async () => {
      const prisma = new PrismaClient();
      const store = new PrismaBookingStore(prisma);
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const orgA = `f12px-a-${suffix}`;
      const orgB = `f12px-b-${suffix}`;

      const slot = {
        startsAt: new Date("2026-10-07T02:00:00.000Z"),
        endsAt: new Date("2026-10-07T03:00:00.000Z"),
      };
      const newSlot = {
        startsAt: new Date("2026-10-07T08:00:00.000Z"),
        endsAt: new Date("2026-10-07T09:00:00.000Z"),
      };

      try {
        const a = await store.create({
          organizationId: orgA,
          contactId: "pa",
          service: "consultation",
          ...slot,
        });

        await expect(store.reschedule(orgB, a.id, newSlot)).rejects.toThrow();
        await expect(store.cancel(orgB, a.id)).rejects.toThrow();

        const row = await prisma.booking.findUnique({ where: { id: a.id } });
        expect(row!.startsAt.toISOString()).toBe(slot.startsAt.toISOString());
        expect(row!.rescheduleCount).toBe(0);
        expect(row!.status).not.toBe("cancelled");

        const moved = await store.reschedule(orgA, a.id, newSlot);
        expect(moved.id).toBe(a.id);
        const after = await prisma.booking.findUnique({ where: { id: a.id } });
        expect(after!.startsAt.toISOString()).toBe(newSlot.startsAt.toISOString());
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

- [ ] **Step 4: Add the end-to-end tool reschedule proof (the bug-fix proof)**

Append:

```ts
// THE BUG-FIX PROOF: drive the reschedule TOOL exactly as production wires it for a no-PMS org
// (a real LocalCalendarProvider whose rescheduleBooking is a no-op, plus a real
// PrismaBookingStore as the durable bookingStore). Before this slice the provider threw
// BOOKING_NOT_FOUND on the calendarEventId and the durable move never ran; now the row moves
// once (no double-count) and a genuine clash is re-offered retryably instead of escalating.
describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "calendar.reschedule end-to-end for a local provider (integration)",
  () => {
    function wire(prisma: PrismaClient, orgId: string, contactId: string) {
      const localStore = buildLocalStore(prisma, orgId);
      const durable = new PrismaBookingStore(prisma);
      const ops = buildRescheduleOperations({ orgId, contactId } as never, {
        calendarProviderFactory: async () =>
          new LocalCalendarProvider({ businessHours: BUSINESS_HOURS, bookingStore: localStore }),
        isCalendarProviderConfigured: () => true,
        bookingStore: durable,
      });
      return { localStore, ops };
    }

    it("moves the booking row exactly once via the durable store", async () => {
      const prisma = new PrismaClient();
      const orgId = `f12e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const contactId = "patient-e2e";
      const { localStore, ops } = wire(prisma, orgId, contactId);
      try {
        const created = await localStore.createInTransaction({
          organizationId: orgId,
          contactId,
          service: "consultation",
          startsAt: new Date("2026-11-01T02:00:00.000Z"),
          endsAt: new Date("2026-11-01T03:00:00.000Z"),
          timezone: "Asia/Singapore",
          status: "confirmed",
          calendarEventId: "local-e2e-1",
          createdByType: "agent",
        });

        const res = await ops["booking.reschedule"]!.execute({
          slotStart: "2026-11-01T06:00:00.000Z",
          slotEnd: "2026-11-01T07:00:00.000Z",
          calendarId: "local",
        });

        expect(res.status).toBe("success");
        const row = await prisma.booking.findUnique({ where: { id: created.id } });
        expect(row!.startsAt.toISOString()).toBe("2026-11-01T06:00:00.000Z");
        expect(row!.endsAt.toISOString()).toBe("2026-11-01T07:00:00.000Z");
        // Single write: no double-increment from a redundant provider write.
        expect(row!.rescheduleCount).toBe(1);
      } finally {
        await prisma.booking.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.$disconnect();
      }
    });

    it("returns retryable SLOT_TAKEN and leaves the booking put when the target is held", async () => {
      const prisma = new PrismaClient();
      const orgId = `f12e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const contactId = "patient-mover";
      const { localStore, ops } = wire(prisma, orgId, contactId);
      try {
        const mover = await localStore.createInTransaction({
          organizationId: orgId,
          contactId,
          service: "consultation",
          startsAt: new Date("2026-11-03T02:00:00.000Z"),
          endsAt: new Date("2026-11-03T03:00:00.000Z"),
          timezone: "Asia/Singapore",
          status: "confirmed",
          calendarEventId: "local-mover",
          createdByType: "agent",
        });
        // A different patient already holds the target slot.
        await localStore.createInTransaction({
          organizationId: orgId,
          contactId: "patient-holder",
          service: "consultation",
          startsAt: new Date("2026-11-03T06:00:00.000Z"),
          endsAt: new Date("2026-11-03T07:00:00.000Z"),
          timezone: "Asia/Singapore",
          status: "confirmed",
          calendarEventId: "local-holder",
          createdByType: "agent",
        });

        const res = await ops["booking.reschedule"]!.execute({
          slotStart: "2026-11-03T06:00:00.000Z",
          slotEnd: "2026-11-03T07:00:00.000Z",
          calendarId: "local",
        });

        expect(res.status).toBe("error");
        expect(res.error?.code).toBe("SLOT_TAKEN");
        expect(res.error?.retryable).toBe(true);
        // The mover's booking is untouched at its original slot.
        const row = await prisma.booking.findUnique({ where: { id: mover.id } });
        expect(row!.startsAt.toISOString()).toBe("2026-11-03T02:00:00.000Z");
        expect(row!.rescheduleCount).toBe(0);
      } finally {
        await prisma.booking.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.$disconnect();
      }
    });
  },
);
```

- [ ] **Step 5: Run the gated integration suite against real Postgres**

Run (loads `DATABASE_URL` from root `.env`; the URL contains `&` so use `--env-file`, not `source`):

```bash
RUN_DB_INTEGRATION=1 node --env-file=.env node_modules/.bin/vitest run --root apps/api src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts
```

Expected: PASS — the create concurrency tests, the two migrated PrismaBookingStore F12 tests, and both end-to-end reschedule tests all run and pass. (If the binary path differs, use `pnpm --filter @switchboard/api exec vitest run ...` with the same env prefix.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts
git commit -m "test(calendar): migrate F12 reschedule/cancel proofs to live path + e2e local reschedule"
```

---

## Task 5: Full gate sweep

**Files:** none (verification only).

- [ ] **Step 1: Build, then run every required gate**

Run:

```bash
pnpm build
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/api test
pnpm --filter @switchboard/db test
pnpm typecheck
pnpm arch:check
pnpm format:check
```

Expected: all PASS. Pre-existing DB-integration suites (ledger/work-trace/greeting) may fail only against a dirty shared local DB; confirm the NEW tests pass and the required CI jobs (typecheck/lint/test/security) are green on the PR. If `format:check` flags files, run `pnpm format` and amend.

- [ ] **Step 2: Final verification commit (if format changed anything)**

```bash
git add -A && git commit -m "chore(calendar): formatting" || echo "nothing to format"
```

---

## Self-Review

**Spec coverage:**

- Reschedule works for local orgs -> Task 2 (no-op) + Task 4 e2e proof. ✓
- Cancel keying correctness/log-noise -> Task 2 (cancel no-op). ✓
- Coded conflict -> retryable SLOT_TAKEN -> durable PrismaBookingStore (Task 4 e2e SLOT_TAKEN test; existing tool unit test already covers the mapping). ✓
- F12 preserved on the live path -> Task 4 PrismaBookingStore concurrency + cross-org describes; existing prisma-booking-store.test.ts unit coverage. ✓
- Google unchanged -> no edit to google-calendar-adapter.ts; interface doc-only. ✓
- Create path untouched -> `createInTransaction` + its tests kept (Task 3 Step 4 keeps the create describe). ✓
- Out-of-scope (read IDOR, create double-write) -> not touched; recorded in spec. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; deletions reference exact line ranges. ✓

**Type consistency:** `buildRescheduleOperations(ctx, deps)` with `deps.bookingStore` = a `PrismaBookingStore` (has `findUpcomingByContact`/`reschedule`/`cancel` matching `CalendarRescheduleDeps`); `LocalBookingStore` slimmed to `findOverlapping`/`createInTransaction`/`findById`; no-op `rescheduleBooking` returns a full `Booking` per `BookingSchema`. ✓
