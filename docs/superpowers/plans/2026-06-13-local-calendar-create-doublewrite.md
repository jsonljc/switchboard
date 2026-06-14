# Local-calendar create-path double-write fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the durable `PrismaBookingStore.create` the single writer for a no-PMS (`LocalCalendarProvider`) org so `booking.create` stops double-writing/self-conflicting, and surface a genuine slot clash as retryable `SLOT_TAKEN`.

**Architecture:** Mirror #1018's "durable store = single writer". `LocalCalendarProvider.createBooking` mints a `local-<uuid>` calendar handle and returns WITHOUT a DB write (like `GoogleCalendarAdapter.createBooking`). The existing step-1 durable insert (F12-guarded) owns the row; step 3 confirms it and stamps the handle. The booking-confirmation email moves to an optional `notifyBookingConfirmed` provider hook the tool calls AFTER the durable confirm commits.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo), Prisma/Postgres, Vitest. Layers: schemas -> core -> db -> apps/api.

**Red evidence already captured:** A throwaway probe drove the real tool through a real `LocalCalendarProvider` + `PrismaBookingStore` against Postgres and observed the current bug: `{ status: "error", code: "BOOKING_FAILURE", failureType: "provider_error", retryable: false }` with one `failed` row. The Task 6 gated e2e codifies the green state.

**Gates (run before PR):** `pnpm --filter @switchboard/db test` , `pnpm --filter @switchboard/core test` , `pnpm --filter @switchboard/api test` , `pnpm typecheck` , `pnpm arch:check` , `pnpm format:check` , `pnpm lint`. Gated e2e: `RUN_DB_INTEGRATION=1 node --env-file=.env node_modules/vitest/vitest.mjs run apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts`.

**No em-dashes** in code, comments, or docs.

---

### Task 1: schemas - optional `notifyBookingConfirmed` contract

**Files:**

- Modify: `packages/schemas/src/calendar.ts`

This is a type-only, additive contract change (no runtime behavior). Consumers in Tasks 2 and 3 exercise it; the gate is `pnpm typecheck`.

- [ ] **Step 1: Add the notification type + optional method**

In `packages/schemas/src/calendar.ts`, add the `BookingConfirmedNotification` interface immediately before `export interface CalendarProvider {`:

```ts
export interface BookingConfirmedNotification {
  bookingId: string;
  attendeeEmail: string | null;
  attendeeName: string | null;
  service: string;
  startsAt: string;
  endsAt: string;
}
```

Then add this optional method to `CalendarProvider` (after `getBooking(...)`, before `healthCheck(...)`):

```ts
  /**
   * Optional post-confirmation notification hook. The booking tool calls this AFTER the durable
   * confirm transaction commits, so a confirmation is only ever sent for a booking that truly
   * persisted. Providers that notify the attendee natively during createBooking (e.g. Google
   * Calendar invites) omit it. Best-effort: implementations must not throw.
   */
  notifyBookingConfirmed?(notification: BookingConfirmedNotification): Promise<void>;
```

- [ ] **Step 2: Build schemas + typecheck**

Run: `pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/schemas typecheck`
Expected: PASS (additive change).

- [ ] **Step 3: Commit**

```bash
git add packages/schemas/src/calendar.ts
git commit -m "feat(schemas): add optional notifyBookingConfirmed to CalendarProvider"
```

---

### Task 2: core - `LocalCalendarProvider` becomes a single-writer mint + post-confirm notifier

**Files:**

- Modify: `packages/core/src/calendar/local-calendar-provider.ts`
- Test: `packages/core/src/calendar/local-calendar-provider.test.ts`

- [ ] **Step 1: Rewrite the provider unit tests (red)**

In `local-calendar-provider.test.ts`:

(a) Slim BOTH store-stub helpers (`makeBookingStore` near line 19 and `makeStoreForEmailTests` near line 376) to exactly the new interface:

```ts
function makeBookingStore() {
  return {
    findOverlapping: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
  };
}
```

```ts
function makeStoreForEmailTests() {
  return {
    findOverlapping: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
  };
}
```

(b) Replace the entire `describe("createBooking", ...)` block (the two tests asserting `store.createInTransaction` was called / SLOT_CONFLICT) with:

```ts
describe("createBooking", () => {
  it("mints a local- prefixed calendarEventId and writes no DB row (durable store is the single writer)", async () => {
    const result = await provider.createBooking({
      contactId: "c1",
      organizationId: "org1",
      slot: {
        start: "2026-04-27T09:00:00+08:00",
        end: "2026-04-27T09:30:00+08:00",
        calendarId: "local",
        available: true,
      },
      service: "consultation",
      createdByType: "agent",
    });
    expect(result.calendarEventId).toMatch(/^local-/);
    expect(result.status).toBe("confirmed");
    expect(result.startsAt).toBe("2026-04-27T09:00:00+08:00");
    // No store write: this provider only mints the calendar handle.
    expect(store.findOverlapping).not.toHaveBeenCalled();
    expect(store.findById).not.toHaveBeenCalled();
  });
});
```

(c) Replace the entire `describe("email confirmation", ...)` block AND the trailing `describe("LocalCalendarProvider emailSender wiring", ...)` block (every test that drove the email through `createBooking`) with a single `notifyBookingConfirmed` suite. The email now fires from `notifyBookingConfirmed`, keyed on the durable booking id passed in the notification:

```ts
describe("notifyBookingConfirmed (post-confirm email)", () => {
  const notification = {
    bookingId: "bk-durable-1",
    attendeeEmail: "sarah@example.com",
    attendeeName: "Sarah",
    service: "consultation",
    startsAt: "2026-04-27T09:00:00+08:00",
    endsAt: "2026-04-27T09:30:00+08:00",
  };

  it("sends the RESEND email keyed on the durable booking id when attendeeEmail is set", async () => {
    const emailSender = vi.fn().mockResolvedValue(undefined);
    const p = new LocalCalendarProvider({
      businessHours: BUSINESS_HOURS,
      bookingStore: makeBookingStore(),
      emailSender,
    });
    await p.notifyBookingConfirmed(notification);
    expect(emailSender).toHaveBeenCalledTimes(1);
    expect(emailSender).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "sarah@example.com",
        attendeeName: "Sarah",
        service: "consultation",
        startsAt: "2026-04-27T09:00:00+08:00",
        endsAt: "2026-04-27T09:30:00+08:00",
        bookingId: "bk-durable-1",
      }),
    );
  });

  it("does not send when attendeeEmail is null", async () => {
    const emailSender = vi.fn();
    const p = new LocalCalendarProvider({
      businessHours: BUSINESS_HOURS,
      bookingStore: makeBookingStore(),
      emailSender,
    });
    await p.notifyBookingConfirmed({ ...notification, attendeeEmail: null });
    expect(emailSender).not.toHaveBeenCalled();
  });

  it("does not throw and calls onSendFailure when the sender fails (best-effort)", async () => {
    const emailSender = vi.fn().mockRejectedValue(new Error("SMTP down"));
    const onSendFailure = vi.fn();
    const p = new LocalCalendarProvider({
      businessHours: BUSINESS_HOURS,
      bookingStore: makeBookingStore(),
      emailSender,
      onSendFailure,
    });
    await expect(p.notifyBookingConfirmed(notification)).resolves.toBeUndefined();
    expect(onSendFailure).toHaveBeenCalledWith({ bookingId: "bk-durable-1", error: "SMTP down" });
  });

  it("no-ops without an emailSender (backwards compatible)", async () => {
    await expect(provider.notifyBookingConfirmed(notification)).resolves.toBeUndefined();
  });
});
```

(d) In the `describe("LocalCalendarProvider listAvailableSlots org scoping", ...)` block near line 350, slim the typed store literal to the new interface:

```ts
const store: LocalBookingStoreOrgScope = {
  findOverlapping,
  findById: viOrgScope.fn(),
};
```

- [ ] **Step 2: Run the provider tests to verify they fail**

Run: `pnpm --filter @switchboard/core test -- local-calendar-provider`
Expected: FAIL (createBooking still writes via `createInTransaction`; `notifyBookingConfirmed` does not exist; `LocalBookingStore` still requires `createInTransaction`).

- [ ] **Step 3: Implement the provider change**

In `local-calendar-provider.ts`:

(a) Add `BookingConfirmedNotification` to the schemas import (the `import type { ... } from "@switchboard/schemas";` block):

```ts
  BookingConfirmedNotification,
```

(b) Slim the `LocalBookingStore` interface to exactly:

```ts
export interface LocalBookingStore {
  findOverlapping(startsAt: Date, endsAt: Date): Promise<Array<{ startsAt: Date; endsAt: Date }>>;
  findById(bookingId: string): Promise<Booking | null>;
}
```

(c) Replace the entire `async createBooking(...)` method body with a mint-and-return (no store write, no email):

```ts
  async createBooking(input: CreateBookingInput): Promise<Booking> {
    // The durable PrismaBookingStore.create (the booking tool's step 1, advisory-locked +
    // overlap-guarded, F12) is the single writer for a local org. This provider only mints the
    // calendar handle and returns, mirroring GoogleCalendarAdapter.createBooking which creates the
    // EXTERNAL event and returns its id but writes no DB row. The confirmation email is sent by
    // notifyBookingConfirmed AFTER the durable confirm commits (cancelBooking is a no-op here, so a
    // pre-confirm email could not be compensated the way Google's native invite is).
    const calendarEventId = `local-${randomUUID()}`;
    return {
      id: "",
      contactId: input.contactId,
      organizationId: input.organizationId,
      opportunityId: input.opportunityId ?? null,
      service: input.service,
      status: "confirmed",
      calendarEventId,
      attendeeName: input.attendeeName ?? null,
      attendeeEmail: input.attendeeEmail ?? null,
      notes: input.notes ?? null,
      createdByType: input.createdByType ?? "agent",
      sourceChannel: input.sourceChannel ?? null,
      workTraceId: input.workTraceId ?? null,
      rescheduledAt: null,
      rescheduleCount: 0,
      startsAt: input.slot.start,
      endsAt: input.slot.end,
      timezone: this.businessHours.timezone,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
```

(d) Add the `notifyBookingConfirmed` method (place it directly after `createBooking`):

```ts
  async notifyBookingConfirmed(notification: BookingConfirmedNotification): Promise<void> {
    // Best-effort, RESEND-gated. Called by the booking tool AFTER the durable confirm commits,
    // keyed on the durable booking id (the canonical row reference shown to the customer).
    if (!this.emailSender || !notification.attendeeEmail) return;
    try {
      await this.emailSender({
        to: notification.attendeeEmail,
        attendeeName: notification.attendeeName ?? null,
        service: notification.service,
        startsAt: notification.startsAt,
        endsAt: notification.endsAt,
        bookingId: notification.bookingId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[LocalCalendarProvider] Email confirmation failed: ${msg}`);
      if (this.onSendFailure) {
        this.onSendFailure({ bookingId: notification.bookingId, error: msg });
      }
    }
  }
```

- [ ] **Step 4: Run the provider tests to verify they pass**

Run: `pnpm --filter @switchboard/core build && pnpm --filter @switchboard/core test -- local-calendar-provider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/calendar/local-calendar-provider.ts packages/core/src/calendar/local-calendar-provider.test.ts
git commit -m "fix(calendar): local createBooking mints handle without a second DB write"
```

---

### Task 3: core - booking tool fires `notifyBookingConfirmed` after the durable confirm

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts`
- Test: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`

- [ ] **Step 1: Add the failing tool tests (red)**

In `calendar-book.test.ts`, add `notifyBookingConfirmed: vi.fn().mockResolvedValue(undefined)` to the `makeCalendarProvider()` factory (near line 12) so the default provider exposes the hook:

```ts
function makeCalendarProvider() {
  return {
    listAvailableSlots: vi.fn(),
    createBooking: vi.fn(),
    cancelBooking: vi.fn().mockResolvedValue(undefined),
    notifyBookingConfirmed: vi.fn().mockResolvedValue(undefined),
  };
}
```

Then add a new describe block at the end of the top-level `describe("createCalendarBookToolFactory", ...)` (before its closing `});`):

```ts
describe("booking.create post-confirm notification", () => {
  const validInput = {
    service: "consultation",
    slotStart: "2026-04-20T10:00:00+08:00",
    slotEnd: "2026-04-20T10:30:00+08:00",
    calendarId: "primary",
  };

  it("calls notifyBookingConfirmed with the durable booking id + attendee after a successful confirm", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_1" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "local-xyz" });

    const result = await tool.operations["booking.create"]!.execute(validInput);

    expect(result.status).toBe("success");
    expect(calendarProvider.notifyBookingConfirmed).toHaveBeenCalledWith({
      bookingId: "bk_1",
      attendeeEmail: "jane@example.com",
      attendeeName: "Jane Tan",
      service: "consultation",
      startsAt: "2026-04-20T10:00:00+08:00",
      endsAt: "2026-04-20T10:30:00+08:00",
    });
  });

  it("does NOT fail the confirmed booking when notifyBookingConfirmed throws (best-effort)", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_1" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "local-xyz" });
    calendarProvider.notifyBookingConfirmed.mockRejectedValue(new Error("resend 500"));

    const result = await tool.operations["booking.create"]!.execute(validInput);

    expect(result.status).toBe("success");
    expect(result.data?.status).toBe("confirmed");
  });
});
```

- [ ] **Step 2: Run the tool tests to verify they fail**

Run: `pnpm --filter @switchboard/core test -- calendar-book`
Expected: FAIL (`notifyBookingConfirmed` is never called by the tool).

- [ ] **Step 3: Implement the post-confirm call**

In `calendar-book.ts`, in `booking.create`, after the confirm-transaction `try/catch` block and after the existing metrics lines:

```ts
getMetrics().bookingConfirmed.inc({ orgId });
if (stageAdvanced) getMetrics().bookingStageAdvanced.inc({ orgId });
```

insert this block immediately before `return ok(` :

```ts
// Post-confirm notification (best-effort). The booking is already durably confirmed; a
// notification failure must never fail it. The local provider sends its RESEND-gated
// email here, after the durable commit, because its cancelBooking is a no-op and a
// pre-confirm email could not be compensated. Google notifies natively during
// createBooking and omits this hook.
if (provider.notifyBookingConfirmed) {
  try {
    await provider.notifyBookingConfirmed({
      bookingId: booking.id,
      attendeeEmail,
      attendeeName,
      service: input.service,
      startsAt: input.slotStart,
      endsAt: input.slotEnd,
    });
  } catch (notifyErr) {
    console.warn("[calendar-book] booking-confirmation notification failed", notifyErr);
  }
}
```

- [ ] **Step 4: Run the tool tests to verify they pass**

Run: `pnpm --filter @switchboard/core build && pnpm --filter @switchboard/core test -- calendar-book`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/tools/calendar-book.ts packages/core/src/skill-runtime/tools/calendar-book.test.ts
git commit -m "fix(calendar): notify booking confirmation after the durable confirm commits"
```

---

### Task 4: db - migrate the F12 lock-order proof onto the live create path

**Files:**

- Test: `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`

- [ ] **Step 1: Add the lock -> overlap -> insert order assertion**

In `prisma-booking-store.test.ts`, in the test `"inserts when no live overlap exists, after taking the advisory lock"` (inside `describe("PrismaBookingStore.create overlap guard", ...)`), append before its closing `});`:

```ts
// Order proof migrated from the removed buildLocalStore.createInTransaction unit test: the
// advisory lock is taken BEFORE the overlap check, which runs BEFORE the insert.
const lockOrder = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
const findOrder = (tx.booking.findFirst as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
const createOrder = (tx.booking.create as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
expect(lockOrder).toBeLessThan(findOrder);
expect(findOrder).toBeLessThan(createOrder);
```

- [ ] **Step 2: Run the db test to verify it passes**

Run: `pnpm --filter @switchboard/db test -- prisma-booking-store`
Expected: PASS (the durable create already locks-then-checks-then-inserts; this pins the order on the live path).

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/stores/__tests__/prisma-booking-store.test.ts
git commit -m "test(db): pin lock-before-overlap-before-insert order on PrismaBookingStore.create"
```

---

### Task 5: apps/api - remove dead `createInTransaction`, update comment, migrate proofs, add e2e

**Files:**

- Modify: `apps/api/src/bootstrap/calendar-provider-factory.ts`
- Modify: `packages/db/src/stores/prisma-booking-store.ts`
- Test: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts`
- Test: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts`
- Test: `apps/api/src/bootstrap/__tests__/receipt-tier.test.ts`

- [ ] **Step 1: Remove `createInTransaction` from `buildLocalStore` + drop unused imports**

In `calendar-provider-factory.ts`:

(a) Change the first import line from:

```ts
import { type PrismaClient, type Prisma, acquireBookingLock } from "@switchboard/db";
```

to:

```ts
import { type PrismaClient } from "@switchboard/db";
```

(b) Delete the entire `createInTransaction: async (input: { ... }) => { ... },` property from the object returned by `buildLocalStore` (the block that calls `acquireBookingLock` + `tx.booking.findMany` + `tx.booking.create`). `buildLocalStore` must return exactly `{ findOverlapping, findById }`.

- [ ] **Step 2: Update the stale lock comment in the durable store**

In `prisma-booking-store.ts`, in the `acquireBookingLock` doc comment, change:

```
 * integer)` does not exist (Postgres error 42883). Every booking write path
 * (PrismaBookingStore.create / reschedule and the local calendar provider's store) locks
 * through here so no call site can reintroduce that bug or drift from this namespace (F12).
```

to:

```
 * integer)` does not exist (Postgres error 42883). Every durable booking write path
 * (PrismaBookingStore.create / reschedule) locks through here so no call site can reintroduce
 * that bug or drift from this namespace (F12).
```

- [ ] **Step 3: Delete the migrated factory unit proof**

In `calendar-provider-factory.test.ts`, delete the entire `describe("buildLocalStore.createInTransaction: advisory lock (F12)", () => { ... });` block (its lock/overlap/order assertions now live on `PrismaBookingStore.create` from Task 4).

- [ ] **Step 4: Slim the receipt-tier fake store**

In `receipt-tier.test.ts`, replace `makeBookingStore` with:

```ts
function makeBookingStore() {
  return {
    findOverlapping: async () => [],
    findById: async () => null,
  };
}
```

- [ ] **Step 5: Migrate the integration test (delete dead proof, migrate seeds, add e2e)**

In `calendar-provider-factory.integration.test.ts`:

(a) Delete the entire `describe.skipIf(!DB_INTEGRATION_ENABLED)("buildLocalStore.createInTransaction concurrency (integration, F12)", () => { ... });` block (covered by the existing `PrismaBookingStore.create concurrency` proof just below it).

(b) Update the reschedule e2e `wire` helper to also return the durable store, and migrate the three `localStore.createInTransaction({...})` seed calls to the real create+confirm flow. Change `wire`'s return to:

```ts
return { localStore, durable, ops };
```

and each seed of the form:

```ts
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
```

becomes (durable single-writer create, then confirm, mirroring production):

```ts
const created = await durable.create({
  organizationId: orgId,
  contactId,
  service: "consultation",
  startsAt: new Date("2026-11-01T02:00:00.000Z"),
  endsAt: new Date("2026-11-01T03:00:00.000Z"),
});
await durable.confirm(orgId, created.id, "local-e2e-1");
```

Apply the same transform to the `mover` seed (slot `2026-11-03T02:00`, eventId `local-mover`) and the `patient-holder` seed (slot `2026-11-03T06:00`, eventId `local-holder`), each destructuring the `durable` from `wire(...)`. The `patient-holder` seed has no captured variable; keep it as a bare `const holder = await durable.create({...}); await durable.confirm(orgId, holder.id, "local-holder");`.

(c) Add the new bug-fix e2e at the end of the file (the create-tool capstone). Add these imports to the top import group:

```ts
import {
  createCalendarBookToolFactory,
  BookingFailureHandler,
} from "@switchboard/core/skill-runtime";
import { isNoopCalendarProvider } from "../noop-calendar-provider.js";
import { receiptTierForCalendarProvider } from "../receipt-tier.js";
```

(the existing `import { buildRescheduleOperations } from "@switchboard/core/skill-runtime";` line may be merged into the new import or left as-is). Then append:

```ts
// THE CREATE BUG-FIX PROOF: drive the real booking.create tool exactly as production wires it for a
// no-PMS org (a real LocalCalendarProvider that mints a local-<uuid> without a DB write, plus a real
// PrismaBookingStore as the durable single writer). Before this slice the provider inserted a SECOND
// row whose org-wide overlap matched the durable step-1 row and threw, so every local booking died
// with a non-retryable BOOKING_FAILURE and a failed orphan. Now exactly one confirmed row persists,
// and a genuine clash is re-offered retryably instead of escalating.
describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "calendar.booking.create end-to-end for a local provider (integration)",
  () => {
    function wireCreate(prisma: PrismaClient, orgId: string, contactId: string) {
      const localStore = buildLocalStore(prisma, orgId);
      const provider = new LocalCalendarProvider({
        businessHours: BUSINESS_HOURS,
        bookingStore: localStore,
      });
      const durable = new PrismaBookingStore(prisma);
      const factory = createCalendarBookToolFactory({
        calendarProviderFactory: async () => provider,
        isCalendarProviderConfigured: (p) => !isNoopCalendarProvider(p),
        bookingStore: durable as never,
        contactStore: {
          findById: async () => ({
            name: "E2E Patient",
            email: null,
            phone: null,
            attribution: null,
          }),
        } as never,
        opportunityStore: {
          findActiveByContact: async () => null,
          create: async () => ({ id: `opp-${orgId}` }),
        } as never,
        runTransaction: ((fn: (tx: unknown) => Promise<unknown>) =>
          prisma.$transaction((tx) =>
            fn({
              booking: tx.booking,
              outboxEvent: tx.outboxEvent,
              opportunity: tx.opportunity,
              receipt: tx.receipt,
            }),
          )) as never,
        // Must never run in these paths: a clash aborts at the durable create (step 1), and the
        // happy path confirms cleanly. A throw here surfaces an unexpected failure-handler hop.
        failureHandler: {
          handle: async () => {
            throw new Error("failureHandler must not be called on the create happy/clash path");
          },
        } as never,
        defaultCurrency: "SGD",
        receiptTierForProvider: receiptTierForCalendarProvider,
        isProduction: false,
      });
      return factory({ sessionId: "s", orgId, deploymentId: "d", contactId } as never);
    }

    async function cleanup(prisma: PrismaClient, orgId: string) {
      const rows = await prisma.booking.findMany({
        where: { organizationId: orgId },
        select: { id: true },
      });
      const bookedEventIds = rows.map((r) => `evt_booked_${r.id}`);
      await prisma.outboxEvent
        .deleteMany({ where: { eventId: { in: bookedEventIds } } })
        .catch(() => {});
      await prisma.receipt.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma.booking.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    }

    it("persists exactly one confirmed booking with a local- calendarEventId", async () => {
      const prisma = new PrismaClient();
      const orgId = `e2ec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tool = wireCreate(prisma, orgId, "patient-create");
      try {
        const result = await tool.operations["booking.create"]!.execute({
          service: "consultation",
          slotStart: "2026-12-01T02:00:00.000Z",
          slotEnd: "2026-12-01T03:00:00.000Z",
          calendarId: "local",
        });

        expect(result.status).toBe("success");
        expect(result.data?.status).toBe("confirmed");
        expect(String(result.data?.calendarEventId)).toMatch(/^local-/);

        const rows = await prisma.booking.findMany({ where: { organizationId: orgId } });
        expect(rows).toHaveLength(1);
        expect(rows[0]!.status).toBe("confirmed");
        expect(rows[0]!.calendarEventId).toMatch(/^local-/);
      } finally {
        await cleanup(prisma, orgId);
        await prisma.$disconnect();
      }
    });

    it("returns retryable SLOT_TAKEN (no orphan) when the slot is already held", async () => {
      const prisma = new PrismaClient();
      const orgId = `e2ec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const slot = { slotStart: "2026-12-03T02:00:00.000Z", slotEnd: "2026-12-03T03:00:00.000Z" };
      const first = wireCreate(prisma, orgId, "patient-first");
      const second = wireCreate(prisma, orgId, "patient-second");
      try {
        const ok = await first.operations["booking.create"]!.execute({
          service: "consultation",
          calendarId: "local",
          ...slot,
        });
        expect(ok.status).toBe("success");

        const clash = await second.operations["booking.create"]!.execute({
          service: "consultation",
          calendarId: "local",
          ...slot,
        });
        expect(clash.status).toBe("error");
        expect(clash.error?.code).toBe("SLOT_TAKEN");
        expect(clash.error?.retryable).toBe(true);

        // The clash aborted at the durable create: no second row, no orphan.
        const rows = await prisma.booking.findMany({ where: { organizationId: orgId } });
        expect(rows).toHaveLength(1);
        expect(rows[0]!.status).toBe("confirmed");
      } finally {
        await cleanup(prisma, orgId);
        await prisma.$disconnect();
      }
    });
  },
);
```

- [ ] **Step 6: Typecheck + run the api unit tests (mocked) to verify they pass**

Run: `pnpm --filter @switchboard/db build && pnpm --filter @switchboard/core build && pnpm --filter @switchboard/api typecheck && pnpm --filter @switchboard/api test -- calendar-provider-factory.test receipt-tier`
Expected: PASS (no remaining `createInTransaction` references; mocked suites green).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/bootstrap/calendar-provider-factory.ts packages/db/src/stores/prisma-booking-store.ts apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts apps/api/src/bootstrap/__tests__/receipt-tier.test.ts
git commit -m "fix(calendar): remove dead local createInTransaction; durable store is sole writer"
```

---

### Task 6: Verify the real-Postgres e2e turns green + full gate sweep

**Files:** none (verification only).

- [ ] **Step 1: Run the gated e2e against Postgres (was red via the probe; now green)**

Run:

```bash
RUN_DB_INTEGRATION=1 node --env-file=.env node_modules/vitest/vitest.mjs run apps/api/src/bootstrap/__tests__/calendar-provider-factory.integration.test.ts
```

Expected: PASS, including `calendar.booking.create end-to-end for a local provider` (one confirmed row + `local-` id; clash -> retryable SLOT_TAKEN, one row) AND the migrated reschedule e2e (seeded via create+confirm). If the reschedule e2e fails on the seed change, read `packages/core/src/skill-runtime/tools/calendar-reschedule.ts` to confirm how it locates the booking and adjust the seed (status/calendarEventId) to match; do NOT change the reschedule tool.

- [ ] **Step 2: Full gate sweep**

Run each and confirm green:

```bash
pnpm --filter @switchboard/db test
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/api test
pnpm typecheck
pnpm arch:check
pnpm format:check
pnpm lint
```

Expected: PASS. Known-noise: pre-existing ledger/work-trace/greeting DB-integration suites can fail against a dirty shared local DB; confirm the calendar suites and the required jobs are green. If `format:check` flags files, run `pnpm format` and amend.

- [ ] **Step 3: No commit unless Step 2 required a format fix**

If `pnpm format` changed files:

```bash
git add -A
git commit -m "chore(calendar): formatting"
```

---

## Self-review

- Spec coverage: single-writer architecture (Tasks 2, 5), optional `notifyBookingConfirmed` + post-confirm email (Tasks 1, 2, 3), F12 invariant preserved + order proof migrated (Tasks 4, 5), `createInTransaction` removal + comment (Task 5), retryable SLOT_TAKEN via the durable typed error (proven in Task 5 e2e + existing tool unit test), test migration (Tasks 4, 5), real-PG proof (Task 6). Out-of-scope read IDOR is left untouched.
- Type consistency: `BookingConfirmedNotification` fields `{ bookingId, attendeeEmail, attendeeName, service, startsAt, endsAt }` are identical in schemas (Task 1), the provider method (Task 2), the tool call (Task 3), and the tool test (Task 3). `LocalBookingStore` is `{ findOverlapping, findById }` everywhere (Tasks 2, 5). `buildLocalStore` returns `{ findOverlapping, findById }` (Task 5).
- No placeholders: every code step shows the literal code.

```

```
