# Booking Lifecycle Integrity + Reschedule/Cancel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Alex's `booking.create` advance the funnel reliably, stop failed bookings from blocking re-book, guard against double-booking, brand-correct confirmation prose for parked/failed results, and add governed reschedule/cancel — with a regression net that bites.

**Architecture:** Layered bottom-up — `schemas` (shared error + stage constant) → `db` (partial-index migration, overlap-guarded `create`, reschedule/cancel/find methods) → `core` (counters, in-tx stage advance, slot-conflict mapping + orphan compensation, new reschedule/cancel operations on the `calendar-book` tool) → `apps/api` wiring → `skills/alex/SKILL.md` prose → `evals` fixtures. Booking stage-advance is co-committed inside the existing confirm transaction (idempotent, monotonic, no-throw). No new governance dial (pilots already run `autonomous`).

**Tech Stack:** TypeScript (ESM, `.js` import extensions), pnpm + Turborepo, Prisma/PostgreSQL, Vitest, Zod, prom-client metrics, the alex-conversation eval harness.

**Spec:** `docs/superpowers/specs/2026-06-03-booking-lifecycle-integrity-design.md`

**Conventions:** TDD (failing test first). Commit after each green task with a Conventional-Commit, **lowercase subject ≤100 chars**, ending `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Run `pnpm --filter <pkg> test` per package; `pnpm build` after lower-layer changes before testing dependents. **Known baseline noise to ignore:** `prisma-work-trace-store-integrity.test.ts` (pg_advisory flake); `Eval — Claim Classifier` RED on main (#631 bake). Each task subagent must read the cited files before editing — line numbers may drift.

---

## File Structure

| File                                                                             | Responsibility                                                                         | Tasks |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----- |
| `packages/schemas/src/calendar.ts`                                               | `BookingSlotConflictError` + `isBookingSlotConflictError` guard                        | 1     |
| `packages/schemas/src/lifecycle.ts`                                              | `STAGES_AT_OR_BEYOND_BOOKED` constant                                                  | 1     |
| `packages/db/prisma/schema.prisma`                                               | drop `Booking` `@@unique` (partial index lives in raw SQL)                             | 2     |
| `packages/db/prisma/migrations/<ts>_booking_partial_unique_active/migration.sql` | swap full unique → partial unique excluding failed/cancelled                           | 2     |
| `packages/db/src/stores/prisma-booking-store.ts`                                 | overlap-guarded `create`; `findUpcomingByContact`/`reschedule`/`cancel`                | 3,4   |
| `packages/core/src/telemetry/metrics.ts`                                         | 6 booking-lifecycle counters                                                           | 5     |
| `packages/core/src/skill-runtime/tools/calendar-book.ts`                         | in-tx stage advance; slot-conflict mapping; orphan compensation; spread reschedule ops | 6,7,8 |
| `packages/core/src/skill-runtime/tools/calendar-reschedule.ts`                   | `buildRescheduleOperations` (booking.reschedule + booking.cancel)                      | 8     |
| `apps/api/src/bootstrap/skill-mode.ts`                                           | expose `tx.opportunity`; wire reschedule/cancel deps                                   | 9     |
| `apps/api/src/metrics.ts`, `apps/chat/src/bootstrap/metrics.ts`                  | register new prom counters                                                             | 9     |
| `skills/alex/SKILL.md`                                                           | pending-approval confirmation branch + Phase-5 reschedule/cancel section               | 10    |
| `evals/alex-conversation/mock-tools.ts`                                          | stateful booking.create + reschedule/cancel mock ops                                   | 11    |
| `evals/alex-conversation/fixtures/*.jsonl`, `baseline.json`                      | duplicate-booking, cancel, governed-close fixtures + baseline                          | 11    |

---

## Task 1: schemas — shared slot-conflict error + stage constant

**Files:**

- Modify: `packages/schemas/src/calendar.ts` (after `CalendarProvider`, ~line 99)
- Modify: `packages/schemas/src/lifecycle.ts` (after `TERMINAL_OPPORTUNITY_STAGES`, ~line 22)
- Test: `packages/schemas/src/__tests__/calendar.test.ts` (create if absent), `packages/schemas/src/__tests__/lifecycle.test.ts` (create if absent)

- [ ] **Step 1: Write failing tests**

```ts
// packages/schemas/src/__tests__/calendar.test.ts
import { describe, it, expect } from "vitest";
import { BookingSlotConflictError, isBookingSlotConflictError } from "../calendar.js";

describe("BookingSlotConflictError", () => {
  it("carries the SLOT_CONFLICT code and the conflicting booking id", () => {
    const err = new BookingSlotConflictError("bk-1");
    expect(err.code).toBe("SLOT_CONFLICT");
    expect(err.conflictingBookingId).toBe("bk-1");
    expect(err).toBeInstanceOf(Error);
  });
  it("is detected structurally (cross-package safe)", () => {
    expect(isBookingSlotConflictError(new BookingSlotConflictError("x"))).toBe(true);
    expect(isBookingSlotConflictError({ code: "SLOT_CONFLICT" })).toBe(true);
    expect(isBookingSlotConflictError(new Error("nope"))).toBe(false);
    expect(isBookingSlotConflictError(null)).toBe(false);
  });
});
```

```ts
// packages/schemas/src/__tests__/lifecycle.test.ts  (add to existing if present)
import { describe, it, expect } from "vitest";
import { STAGES_AT_OR_BEYOND_BOOKED, OpportunityStageSchema } from "../lifecycle.js";
describe("STAGES_AT_OR_BEYOND_BOOKED", () => {
  it("contains booked and everything past it, all valid stages", () => {
    expect(STAGES_AT_OR_BEYOND_BOOKED).toEqual(["booked", "showed", "won", "lost"]);
    for (const s of STAGES_AT_OR_BEYOND_BOOKED) expect(OpportunityStageSchema.parse(s)).toBe(s);
  });
  it("excludes pre-booking stages", () => {
    for (const s of ["interested", "qualified", "quoted", "nurturing"])
      expect(STAGES_AT_OR_BEYOND_BOOKED).not.toContain(s);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @switchboard/schemas test` → fails (exports not defined).

- [ ] **Step 3: Implement**

```ts
// packages/schemas/src/calendar.ts — append after the CalendarProvider interface
/**
 * Thrown by the durable booking write when a NEW booking would overlap an
 * existing LIVE booking (status not in failed/cancelled) for the same org.
 * Detected structurally across the core/db package boundary via the `code`
 * field (mirrors the P2002 detection in calendar-book.ts), so an `instanceof`
 * mismatch between duplicate schema builds cannot silently swallow it.
 */
export class BookingSlotConflictError extends Error {
  readonly code = "SLOT_CONFLICT" as const;
  constructor(public readonly conflictingBookingId: string) {
    super("An overlapping booking already exists for this slot.");
    this.name = "BookingSlotConflictError";
  }
}

export function isBookingSlotConflictError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "SLOT_CONFLICT"
  );
}
```

```ts
// packages/schemas/src/lifecycle.ts — after TERMINAL_OPPORTUNITY_STAGES (line 22)
/**
 * Stages at or past "booked". A successful booking advances an opportunity to
 * "booked" ONLY if its current stage is not already one of these — the monotonic
 * guard that makes booking.create's stage advance idempotent and prevents a new
 * booking from downgrading a "showed"/"won" opportunity.
 */
export const STAGES_AT_OR_BEYOND_BOOKED: OpportunityStage[] = ["booked", "showed", "won", "lost"];
```

- [ ] **Step 4: Run, expect PASS**, then `pnpm --filter @switchboard/schemas build`.

- [ ] **Step 5: Commit** — `git commit -am "feat(schemas): add booking slot-conflict error + at-or-beyond-booked stages"`

---

## Task 2: db — partial unique index migration (T0.8: failed row no longer blocks re-book)

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (Booking model, remove the `@@unique` at ~line 1935)
- Create: `packages/db/prisma/migrations/<ts>_booking_partial_unique_active/migration.sql`

This task has **no vitest** (a unique-constraint change is DB-level; mocked Prisma can't enforce it). It is verified by `db:check-drift` + a direct psql check against the running local Postgres.

- [ ] **Step 1: Edit the schema** — in `model Booking`, DELETE the line `@@unique([organizationId, contactId, service, startsAt])` and replace it with a pointer comment (leave the columns un-`@@unique`'d, mirroring `CreatorIdentity`):

```prisma
  // Active-booking uniqueness is a PARTIAL unique index (status NOT IN failed/cancelled),
  // which Prisma 6 cannot express in-schema. It lives in raw SQL in migration
  // 20260603..._booking_partial_unique_active. Keep this comment in sync.
```

Keep the other `@@index` lines unchanged.

- [ ] **Step 2: Create the migration.** Pick a 14-digit UTC timestamp that sorts AFTER the latest existing migration (`20260603000000_creative_job_meta_publish`), e.g. `20260603120000`. Index name ≤63 chars.

```sql
-- packages/db/prisma/migrations/20260603120000_booking_partial_unique_active/migration.sql
-- T0.8: a failed/cancelled booking must not occupy the (org,contact,service,startsAt)
-- tuple, or it permanently blocks re-booking the same slot. Replace the plain unique
-- with a PARTIAL unique that only counts LIVE bookings. Mirrors the CreatorIdentity
-- partial-index pattern (20260428082529); Prisma 6 cannot express this in-schema.
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_organizationId_contactId_service_startsAt_key";

CREATE UNIQUE INDEX "Booking_org_contact_service_start_active_key"
  ON "Booking" ("organizationId", "contactId", "service", "startsAt")
  WHERE "status" NOT IN ('failed', 'cancelled');
```

- [ ] **Step 3: Apply + verify drift stays green.**

Run: `pnpm db:migrate` (applies via `prisma migrate deploy` against local PG; no TTY needed), then `pnpm db:check-drift`.
Expected: migrate applies cleanly; `check-drift` exits 0 (the partial index is invisible to the datamodel diff, and the schema no longer declares the dropped `@@unique`).

- [ ] **Step 4: Verify the behavior directly against PostgreSQL.**

Run (strip the `?connection_limit` query params from `DATABASE_URL` for psql):

```bash
DBU="$(awk -F= '/^DATABASE_URL=/{sub(/^DATABASE_URL=/,"");print;exit}' .env | tr -d "\"'")"; DBU="${DBU%%\?*}"
psql "$DBU" <<'SQL'
-- a failed row no longer blocks a fresh live row for the same tuple:
SELECT indexdef FROM pg_indexes WHERE indexname = 'Booking_org_contact_service_start_active_key';
SQL
```

Expected: the partial index exists with `WHERE ((status)::text <> ALL (ARRAY['failed','cancelled']))`. (Confirms the constraint shape; the calendar-book handler's P2002→DUPLICATE_BOOKING guard still fires for a LIVE duplicate.)

- [ ] **Step 5: Commit** — `git commit -am "fix(db): partial unique on active bookings so a failed row no longer blocks re-book"`

---

## Task 3: db — overlap guard on the durable write (T2.7: double-book → retryable re-offer)

**Files:**

- Modify: `packages/db/src/stores/prisma-booking-store.ts` (`create`, lines 23-42; add a module constant)
- Test: `packages/db/src/stores/__tests__/prisma-booking-store.test.ts` (create if absent; mirror the mocked-Prisma style of `prisma-workflow-store.test.ts`)

- [ ] **Step 1: Write failing tests** (mock `prisma.$transaction` to invoke the callback with a tx exposing `$executeRaw`, `booking.findFirst`, `booking.create`):

```ts
import { describe, it, expect, vi } from "vitest";
import { PrismaBookingStore } from "../prisma-booking-store.js";
import { isBookingSlotConflictError } from "@switchboard/schemas";

function makePrisma(overlapRow: { id: string } | null) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    booking: {
      findFirst: vi.fn().mockResolvedValue(overlapRow),
      create: vi.fn().mockResolvedValue({ id: "new-booking" }),
    },
  };
  const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { prisma, tx };
}

const baseInput = {
  organizationId: "org-1",
  contactId: "c-1",
  service: "botox",
  startsAt: new Date("2026-06-10T02:00:00Z"),
  endsAt: new Date("2026-06-10T03:00:00Z"),
};

describe("PrismaBookingStore.create overlap guard", () => {
  it("inserts when no live overlap exists, after taking the advisory lock", async () => {
    const { prisma, tx } = makePrisma(null);
    const store = new PrismaBookingStore(prisma as never);
    const row = await store.create(baseInput);
    expect(tx.$executeRaw).toHaveBeenCalled(); // advisory lock acquired
    expect(tx.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          status: { notIn: ["failed", "cancelled"] },
          startsAt: { lt: baseInput.endsAt },
          endsAt: { gt: baseInput.startsAt },
        }),
      }),
    );
    expect(tx.booking.create).toHaveBeenCalled();
    expect(row).toEqual({ id: "new-booking" });
  });

  it("throws BookingSlotConflictError (not insert) when a live booking overlaps", async () => {
    const { prisma, tx } = makePrisma({ id: "existing-bk" });
    const store = new PrismaBookingStore(prisma as never);
    await expect(store.create(baseInput)).rejects.toSatisfy(isBookingSlotConflictError);
    expect(tx.booking.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @switchboard/db test` → fails (current `create` is a bare insert, no findFirst/lock).

- [ ] **Step 3: Implement** — replace the body of `create` and add the lock-namespace constant + imports:

```ts
import { StaleVersionError } from "@switchboard/core";
import { BookingSlotConflictError } from "@switchboard/schemas";
import type { PrismaDbClient } from "../prisma-db.js";

// Advisory-lock namespace (first arg of the two-int pg_advisory_xact_lock form) for
// per-org booking serialization. Distinct from the audit-chain ledger lock (900_001).
const BOOKING_LOCK_NS = 920_001;
```

```ts
  async create(input: CreateBookingInput) {
    // Serialize the check-then-insert per org so two concurrent leads cannot both
    // pass the overlap check and double-book the same physical slot (T2.7). The
    // advisory lock is held until the tx commits; the half-open interval test
    // (existing.startsAt < new.endsAt AND existing.endsAt > new.startsAt) mirrors
    // the Local provider guard (calendar-provider-factory.ts) but on the LIVE write path.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOKING_LOCK_NS}, hashtext(${input.organizationId}))`;
      const overlap = await tx.booking.findFirst({
        where: {
          organizationId: input.organizationId,
          status: { notIn: ["failed", "cancelled"] },
          startsAt: { lt: input.endsAt },
          endsAt: { gt: input.startsAt },
        },
        select: { id: true },
      });
      if (overlap) throw new BookingSlotConflictError(overlap.id);
      return tx.booking.create({
        data: {
          organizationId: input.organizationId,
          contactId: input.contactId,
          opportunityId: input.opportunityId ?? null,
          service: input.service,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          timezone: input.timezone ?? "Asia/Singapore",
          status: "pending_confirmation",
          attendeeName: input.attendeeName ?? null,
          attendeeEmail: input.attendeeEmail ?? null,
          connectionId: input.connectionId ?? null,
          createdByType: input.createdByType ?? "agent",
          sourceChannel: input.sourceChannel ?? null,
          workTraceId: input.workTraceId ?? null,
        },
      });
    });
  }
```

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @switchboard/db test`.

- [ ] **Step 5: Commit** — `git commit -am "fix(db): overlap guard on booking create to prevent double-booking a slot"`

---

## Task 4: db — reschedule/cancel/find store methods (for T1.3)

**Files:**

- Modify: `packages/db/src/stores/prisma-booking-store.ts` (add 3 methods after `findBySlot`, ~line 67)
- Test: `packages/db/src/stores/__tests__/prisma-booking-store.test.ts` (extend Task 3's file)

- [ ] **Step 1: Write failing tests**

```ts
describe("PrismaBookingStore reschedule/cancel/find", () => {
  it("findUpcomingByContact filters out cancelled/failed/past, ordered asc, org-scoped", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "b1" }]);
    const store = new PrismaBookingStore({ booking: { findMany } } as never);
    const now = new Date("2026-06-10T00:00:00Z");
    await store.findUpcomingByContact("org-1", "c-1", now);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          contactId: "c-1",
          status: { notIn: ["cancelled", "failed"] },
          startsAt: { gte: now },
        },
        orderBy: { startsAt: "asc" },
      }),
    );
  });

  it("reschedule updates slot + increments rescheduleCount + sets rescheduledAt; throws if no row", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirstOrThrow = vi.fn().mockResolvedValue({ id: "b1", rescheduleCount: 1 });
    const store = new PrismaBookingStore({ booking: { updateMany, findFirstOrThrow } } as never);
    const s = new Date("2026-06-11T02:00:00Z");
    const e = new Date("2026-06-11T03:00:00Z");
    await store.reschedule("org-1", "b1", { startsAt: s, endsAt: e });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "b1", organizationId: "org-1" },
        data: expect.objectContaining({
          startsAt: s,
          endsAt: e,
          rescheduleCount: { increment: 1 },
        }),
      }),
    );
    const miss = new PrismaBookingStore({
      booking: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    } as never);
    await expect(miss.reschedule("org-1", "x", { startsAt: s, endsAt: e })).rejects.toThrow();
  });

  it("cancel sets status cancelled; throws if no row", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirstOrThrow = vi.fn().mockResolvedValue({ id: "b1", status: "cancelled" });
    const store = new PrismaBookingStore({ booking: { updateMany, findFirstOrThrow } } as never);
    await store.cancel("org-1", "b1");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "b1", organizationId: "org-1" },
      data: { status: "cancelled" },
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — methods don't exist.

- [ ] **Step 3: Implement** (after `findBySlot`):

```ts
  async findUpcomingByContact(orgId: string, contactId: string, now: Date = new Date()) {
    return this.prisma.booking.findMany({
      where: {
        organizationId: orgId,
        contactId,
        status: { notIn: ["cancelled", "failed"] },
        startsAt: { gte: now },
      },
      orderBy: { startsAt: "asc" },
      select: { id: true, calendarEventId: true, service: true, startsAt: true, endsAt: true, status: true },
    });
  }

  async reschedule(orgId: string, bookingId: string, slot: { startsAt: Date; endsAt: Date }) {
    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, organizationId: orgId },
      data: { startsAt: slot.startsAt, endsAt: slot.endsAt, rescheduleCount: { increment: 1 }, rescheduledAt: new Date() },
    });
    if (result.count === 0) throw new StaleVersionError(bookingId, -1, -1);
    return this.prisma.booking.findFirstOrThrow({ where: { id: bookingId, organizationId: orgId } });
  }

  async cancel(orgId: string, bookingId: string) {
    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, organizationId: orgId },
      data: { status: "cancelled" },
    });
    if (result.count === 0) throw new StaleVersionError(bookingId, -1, -1);
    return this.prisma.booking.findFirstOrThrow({ where: { id: bookingId, organizationId: orgId } });
  }
```

- [ ] **Step 4: Run, expect PASS**, then `pnpm --filter @switchboard/db build`.

- [ ] **Step 5: Commit** — `git commit -am "feat(db): findUpcomingByContact + reschedule + cancel booking-store methods"`

---

## Task 5: core — booking-lifecycle counters

**Files:**

- Modify: `packages/core/src/telemetry/metrics.ts` (interface + `createInMemoryMetrics`)
- Test: `packages/core/src/telemetry/__tests__/metrics.test.ts` (create/extend)

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { createInMemoryMetrics } from "../metrics.js";
describe("booking lifecycle counters", () => {
  it("exposes the 6 booking counters and they increment", () => {
    const m = createInMemoryMetrics();
    for (const c of [
      m.bookingConfirmed,
      m.bookingFailed,
      m.bookingStageAdvanced,
      m.bookingSlotConflict,
      m.bookingReschedule,
      m.bookingCancel,
    ]) {
      expect(c).toBeDefined();
      c.inc({ orgId: "o" });
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — counters not on the interface.

- [ ] **Step 3: Implement** — add to the `SwitchboardMetrics` interface (after `rawErrorFallback`) and to the `createInMemoryMetrics` return object:

```ts
// in interface SwitchboardMetrics:
bookingConfirmed: Counter;
bookingFailed: Counter;
bookingStageAdvanced: Counter;
bookingSlotConflict: Counter;
bookingReschedule: Counter;
bookingCancel: Counter;
```

```ts
  // in createInMemoryMetrics():
  bookingConfirmed: new InMemoryCounter(),
  bookingFailed: new InMemoryCounter(),
  bookingStageAdvanced: new InMemoryCounter(),
  bookingSlotConflict: new InMemoryCounter(),
  bookingReschedule: new InMemoryCounter(),
  bookingCancel: new InMemoryCounter(),
```

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @switchboard/core test -- metrics`. (Prom registration in apps is Task 9.)

- [ ] **Step 5: Commit** — `git commit -am "feat(core): add booking-lifecycle metric counters"`

---

## Task 6: core — booking.create advances the opportunity to booked (T0.6)

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts` (`TransactionFn` type lines 46-53; confirm-tx block lines 297-335; imports)
- Test: `packages/core/src/skill-runtime/tools/calendar-book.test.ts` (extend)

- [ ] **Step 1: Write failing test** (mock `runTransaction` to pass a tx with `booking.update`, `outboxEvent.create`, and `opportunity.updateMany` spies; assert stage advance with the monotonic guard, and that a `count:0` advance still returns booking success):

```ts
it("advances the opportunity to booked inside the confirm tx with a monotonic guard", async () => {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = {
    booking: { update: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    opportunity: { updateMany },
  };
  const deps = makeDeps({ runTransaction: (fn) => fn(tx) }); // existing test helper; add opportunity to tx
  const tool = createCalendarBookToolFactory(deps)(ctx);
  const res = await tool.operations["booking.create"].execute(validInput);
  expect(res.status).toBe("success");
  expect(updateMany).toHaveBeenCalledWith({
    where: {
      id: OPP_ID,
      organizationId: ORG_ID,
      stage: { notIn: ["booked", "showed", "won", "lost"] },
    },
    data: { stage: "booked" },
  });
});

it("does NOT surface a stage-write no-op as a booking failure", async () => {
  const tx = {
    booking: { update: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    opportunity: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // already booked → no-op
  };
  const deps = makeDeps({ runTransaction: (fn) => fn(tx) });
  const res =
    await createCalendarBookToolFactory(deps)(ctx).operations["booking.create"].execute(validInput);
  expect(res.status).toBe("success");
});
```

- [ ] **Step 2: Run, expect FAIL** — handler doesn't call `tx.opportunity.updateMany`.

- [ ] **Step 3: Implement.** Extend `TransactionFn` (lines 46-53) to add `opportunity`:

```ts
type TransactionFn = (
  fn: (tx: {
    booking: {
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    };
    outboxEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
    opportunity: {
      updateMany(args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }): Promise<{ count: number }>;
    };
  }) => Promise<unknown>,
) => Promise<unknown>;
```

Import the constant + metrics (metrics already imported at line 5):

```ts
import { SlotQuerySchema, STAGES_AT_OR_BEYOND_BOOKED } from "@switchboard/schemas";
```

Inside the confirm-tx callback (after the `outboxEvent.create`, still inside the `runTransaction` fn at ~line 334), add the stage advance; after the tx, emit counters:

```ts
// Deterministically advance the opportunity to "booked" in the SAME tx as the
// booking confirm. updateMany never throws on count:0, and the monotonic guard
// skips an already-booked/showed/won opp — so a stage no-op never fails the
// booking, and a confirmed booking always implies a booked opportunity.
await tx.opportunity.updateMany({
  where: { id: opportunityId, organizationId: orgId, stage: { notIn: STAGES_AT_OR_BEYOND_BOOKED } },
  data: { stage: "booked" },
});
```

After the `try { await deps.runTransaction(...) }` block succeeds (before the `return ok(...)`):

```ts
getMetrics().bookingConfirmed.inc({ orgId });
getMetrics().bookingStageAdvanced.inc({ orgId });
```

Note: `opportunityId` is `string | null`; it is non-null here (resolved/created at lines 211-224). Add a guard `if (opportunityId)` around the `updateMany` to satisfy the type, or assert non-null — prefer the `if (opportunityId)` guard inside the tx.

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @switchboard/core test -- calendar-book`.

- [ ] **Step 5: Commit** — `git commit -am "fix(core): booking.create advances the opportunity to booked in the confirm tx"`

---

## Task 7: core — slot-conflict → retryable re-offer + orphan-event compensation

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts` (catch at 239-260; confirm-failed catch at 336-350; imports)
- Test: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it("maps a BookingSlotConflictError to a retryable SLOT_TAKEN re-offer", async () => {
  const deps = makeDeps({
    bookingStore: {
      create: vi.fn().mockRejectedValue(new BookingSlotConflictError("bk-x")),
      findBySlot: vi.fn(),
    },
  });
  const res =
    await createCalendarBookToolFactory(deps)(ctx).operations["booking.create"].execute(validInput);
  expect(res.status).toBe("error");
  expect(res.error?.code).toBe("SLOT_TAKEN");
  expect(res.error?.retryable).toBe(true);
});

it("best-effort cancels the created calendar event when the confirm tx fails (no orphan)", async () => {
  const cancelBooking = vi.fn().mockResolvedValue(undefined);
  const deps = makeDeps({
    provider: {
      createBooking: vi.fn().mockResolvedValue({ calendarEventId: "evt-1" }),
      cancelBooking,
    },
    runTransaction: vi.fn().mockRejectedValue(new Error("db down")),
  });
  await createCalendarBookToolFactory(deps)(ctx).operations["booking.create"].execute(validInput);
  expect(cancelBooking).toHaveBeenCalledWith("evt-1");
});
```

- [ ] **Step 2: Run, expect FAIL**.

- [ ] **Step 3: Implement.** Add the import + a new branch at the TOP of the `create` catch (before `isPrismaUniqueConstraintError`):

```ts
import {
  SlotQuerySchema,
  STAGES_AT_OR_BEYOND_BOOKED,
  isBookingSlotConflictError,
} from "@switchboard/schemas";
```

```ts
          } catch (err) {
            if (isBookingSlotConflictError(err)) {
              getMetrics().bookingSlotConflict.inc({ orgId });
              return fail("SLOT_TAKEN", "That time was just taken.", {
                retryable: true,
                data: { failureType: "slot_conflict" },
                modelRemediation:
                  "Re-run calendar-book.slots.query and offer the lead the next available times. Do not claim the slot is booked.",
              });
            }
            if (isPrismaUniqueConstraintError(err)) {
              /* ... existing DUPLICATE_BOOKING branch unchanged ... */
            }
            throw err;
          }
```

In the confirm-failed catch (line 336), BEFORE `failureHandler.handle`, best-effort compensate the orphaned event:

```ts
          } catch (error) {
            // The provider event was created but the durable confirm failed: cancel the
            // orphaned calendar event best-effort so we don't leave a live, untracked slot.
            if (calendarResult.calendarEventId) {
              try {
                await provider.cancelBooking(calendarResult.calendarEventId);
              } catch (cancelErr) {
                console.warn("[calendar-book] orphan-event compensation failed", cancelErr);
              }
            }
            const failResult = await deps.failureHandler.handle({ /* ...unchanged... */ });
            getMetrics().bookingFailed.inc({ orgId, reason: "confirmation_failed" });
            return fail("BOOKING_FAILURE", failResult.message, { data: failResult as unknown as Record<string, unknown> });
          }
```

Also emit `getMetrics().bookingFailed.inc({ orgId, reason: "provider_error" })` in the provider-error catch (line 280), and `reason: "duplicate"` in the DUPLICATE_BOOKING branch.

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @switchboard/core test -- calendar-book`.

- [ ] **Step 5: Commit** — `git commit -am "fix(core): slot-conflict retryable re-offer + cancel orphaned calendar event on confirm failure"`

---

## Task 8: core — booking.reschedule + booking.cancel operations (T1.3)

**Files:**

- Create: `packages/core/src/skill-runtime/tools/calendar-reschedule.ts`
- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts` (extend `CalendarBookToolDeps`; spread the new operations into the factory's `operations` map)
- Test: `packages/core/src/skill-runtime/tools/calendar-reschedule.test.ts`

- [ ] **Step 1: Write failing tests** (resolution is from `ctx.contactId` only; 0/1/many handling; provider+store called):

```ts
import { describe, it, expect, vi } from "vitest";
import { buildRescheduleOperations } from "./calendar-reschedule.js";

const ctx = { orgId: "org-1", contactId: "c-1" } as never;
const upcoming = [
  {
    id: "b1",
    calendarEventId: "evt-1",
    service: "botox",
    startsAt: new Date("2026-06-12T02:00:00Z"),
    endsAt: new Date("2026-06-12T03:00:00Z"),
    status: "confirmed",
  },
];

function deps(over = {}) {
  return {
    calendarProviderFactory: vi.fn().mockResolvedValue({
      rescheduleBooking: vi.fn().mockResolvedValue({}),
      cancelBooking: vi.fn().mockResolvedValue(undefined),
    }),
    isCalendarProviderConfigured: () => true,
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue(upcoming),
      reschedule: vi.fn().mockResolvedValue({ id: "b1" }),
      cancel: vi.fn().mockResolvedValue({ id: "b1" }),
    },
    ...over,
  };
}

it("reschedule resolves the soonest booking from ctx.contactId and never reads a model contactId", async () => {
  const d = deps();
  const ops = buildRescheduleOperations(ctx, d as never);
  const res = await ops["booking.reschedule"].execute({
    slotStart: "2026-06-13T02:00:00Z",
    slotEnd: "2026-06-13T03:00:00Z",
    calendarId: "primary",
    contactId: "ATTACKER",
  });
  expect(d.bookingStore.findUpcomingByContact).toHaveBeenCalledWith("org-1", "c-1"); // trusted ctx, not "ATTACKER"
  expect(res.status).toBe("success");
});

it("returns NO_UPCOMING_BOOKING when the contact has none", async () => {
  const d = deps({
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue([]),
      reschedule: vi.fn(),
      cancel: vi.fn(),
    },
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"].execute({});
  expect(res.status).toBe("error");
  expect(res.error?.code).toBe("NO_UPCOMING_BOOKING");
});

it("cancel calls the provider with the calendarEventId then the store cancel", async () => {
  const d = deps();
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"].execute({});
  const provider = await d.calendarProviderFactory.mock.results[0].value;
  expect(provider.cancelBooking).toHaveBeenCalledWith("evt-1");
  expect(d.bookingStore.cancel).toHaveBeenCalledWith("org-1", "b1");
  expect(res.status).toBe("success");
});
```

- [ ] **Step 2: Run, expect FAIL** — module missing.

- [ ] **Step 3: Implement `calendar-reschedule.ts`.** Both ops `external_mutation`/`idempotent:false`. Resolve target from `ctx.contactId`; optional `service` narrow; operate on soonest. On provider/store failure return a `fail(...)` (do NOT use `failureHandler` — it would mark the booking `failed`).

```ts
import type { SkillTool, SkillRequestContext } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok, fail } from "../tool-result.js";
import { getMetrics } from "../../telemetry/metrics.js";
import type { CalendarProvider } from "@switchboard/schemas";

type UpcomingBooking = {
  id: string;
  calendarEventId: string | null;
  service: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
};

export interface CalendarRescheduleDeps {
  calendarProviderFactory: (orgId: string) => Promise<CalendarProvider>;
  isCalendarProviderConfigured: (p: CalendarProvider) => boolean;
  bookingStore: {
    findUpcomingByContact(orgId: string, contactId: string): Promise<UpcomingBooking[]>;
    reschedule(
      orgId: string,
      bookingId: string,
      slot: { startsAt: Date; endsAt: Date },
    ): Promise<unknown>;
    cancel(orgId: string, bookingId: string): Promise<unknown>;
  };
}

const NO_CONTACT = () =>
  fail("MISSING_CONTACT", "No contact is associated with this conversation.", {
    retryable: false,
    modelRemediation:
      "Escalate to the operator; do not change an appointment without an active contact.",
  });

function resolveTarget(bookings: UpcomingBooking[], service?: string): UpcomingBooking | undefined {
  const narrowed = service
    ? bookings.filter((b) => b.service.toLowerCase() === service.toLowerCase())
    : bookings;
  return (narrowed.length > 0 ? narrowed : bookings)[0]; // soonest (store returns startsAt asc)
}

export function buildRescheduleOperations(
  ctx: SkillRequestContext,
  deps: CalendarRescheduleDeps,
): SkillTool["operations"] {
  return {
    "booking.reschedule": {
      description:
        "Reschedule the contact's upcoming appointment to a new slot. The booking is resolved from the active contact — never pass a contactId.",
      effectCategory: "external_mutation" as const,
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          slotStart: { type: "string", description: "ISO 8601 new start" },
          slotEnd: { type: "string", description: "ISO 8601 new end" },
          calendarId: { type: "string" },
          service: {
            type: "string",
            description: "Optional: which service's appointment, if the lead has more than one",
          },
        },
        required: ["slotStart", "slotEnd", "calendarId"],
      },
      execute: async (params: unknown): Promise<ToolResult> => {
        const { orgId, contactId } = ctx;
        if (!contactId) return NO_CONTACT();
        const input = params as {
          slotStart: string;
          slotEnd: string;
          calendarId: string;
          service?: string;
        };
        const upcoming = await deps.bookingStore.findUpcomingByContact(orgId, contactId);
        const target = resolveTarget(upcoming, input.service);
        if (!target) {
          return fail("NO_UPCOMING_BOOKING", "I don't see an upcoming appointment to move.", {
            retryable: false,
            modelRemediation:
              "Tell the lead you don't see an upcoming booking and offer to book a new appointment.",
          });
        }
        const provider = await deps.calendarProviderFactory(orgId);
        if (!deps.isCalendarProviderConfigured(provider)) {
          return fail("CALENDAR_NOT_CONFIGURED", "Calendar is not configured.", {
            retryable: false,
          });
        }
        const newSlot = {
          start: input.slotStart,
          end: input.slotEnd,
          calendarId: input.calendarId,
          available: true,
        };
        try {
          if (target.calendarEventId)
            await provider.rescheduleBooking(target.calendarEventId, newSlot);
          await deps.bookingStore.reschedule(orgId, target.id, {
            startsAt: new Date(input.slotStart),
            endsAt: new Date(input.slotEnd),
          });
        } catch (err) {
          console.warn("[calendar-reschedule] reschedule failed", err);
          return fail("RESCHEDULE_FAILURE", "I couldn't move that appointment just now.", {
            retryable: false,
            modelRemediation: "Apologize and escalate so a human can adjust the appointment.",
          });
        }
        getMetrics().bookingReschedule.inc({ orgId });
        return ok({
          bookingId: target.id,
          status: "rescheduled",
          service: target.service,
          startsAt: input.slotStart,
          endsAt: input.slotEnd,
        });
      },
    },
    "booking.cancel": {
      description:
        "Cancel the contact's upcoming appointment. Resolved from the active contact — never pass a contactId.",
      effectCategory: "external_mutation" as const,
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          service: {
            type: "string",
            description: "Optional: which service's appointment, if more than one",
          },
          reason: { type: "string", description: "Optional short reason" },
        },
        required: [],
      },
      execute: async (params: unknown): Promise<ToolResult> => {
        const { orgId, contactId } = ctx;
        if (!contactId) return NO_CONTACT();
        const input = params as { service?: string };
        const upcoming = await deps.bookingStore.findUpcomingByContact(orgId, contactId);
        const target = resolveTarget(upcoming, input.service);
        if (!target) {
          return fail("NO_UPCOMING_BOOKING", "I don't see an upcoming appointment to cancel.", {
            retryable: false,
            modelRemediation: "Tell the lead you don't see an upcoming booking to cancel.",
          });
        }
        const provider = await deps.calendarProviderFactory(orgId);
        if (!deps.isCalendarProviderConfigured(provider)) {
          return fail("CALENDAR_NOT_CONFIGURED", "Calendar is not configured.", {
            retryable: false,
          });
        }
        try {
          if (target.calendarEventId) await provider.cancelBooking(target.calendarEventId);
          await deps.bookingStore.cancel(orgId, target.id);
        } catch (err) {
          console.warn("[calendar-reschedule] cancel failed", err);
          return fail("CANCEL_FAILURE", "I couldn't cancel that appointment just now.", {
            retryable: false,
            modelRemediation: "Apologize and escalate so a human can cancel the appointment.",
          });
        }
        getMetrics().bookingCancel.inc({ orgId });
        return ok({ bookingId: target.id, status: "cancelled", service: target.service });
      },
    },
  };
}
```

- [ ] **Step 4: Wire into the factory.** In `calendar-book.ts`: extend `CalendarBookToolDeps.bookingStore` subset to include `findUpcomingByContact`/`reschedule`/`cancel`; import `buildRescheduleOperations`; spread into `operations`:

```ts
    operations: {
      "slots.query": { /* ... */ },
      "booking.create": { /* ... */ },
      ...buildRescheduleOperations(ctx, deps),
    },
```

- [ ] **Step 5: Run, expect PASS** — `pnpm --filter @switchboard/core test -- calendar`. Confirm `calendar-book.ts` stays < 600 lines (extraction keeps it lean); run `pnpm --filter @switchboard/core build`.

- [ ] **Step 6: Commit** — `git commit -am "feat(core): governed booking.reschedule + booking.cancel resolved from trusted contact"`

---

## Task 9: apps/api wiring — expose tx.opportunity + reschedule deps + register prom counters

**Files:**

- Modify: `apps/api/src/bootstrap/skill-mode.ts` (calendar-book wiring lines 279-314)
- Modify: `apps/api/src/metrics.ts` and `apps/chat/src/bootstrap/metrics.ts` (register the 6 prom counters — mirror how `slotQueryZeroResult`/`rawErrorFallback` were added by PR-A)
- Test: extend `apps/api` calendar-book wiring test if present; otherwise rely on `pnpm typecheck` + the api metrics test.

- [ ] **Step 1: Expose `tx.opportunity` in `runTransaction`** (lines 301-311): add `opportunity: tx.opportunity` to the passed delegates and to the inline tx type:

```ts
    runTransaction: (fn) =>
      prismaClient.$transaction((tx) =>
        fn({ booking: tx.booking, outboxEvent: tx.outboxEvent, opportunity: tx.opportunity }),
      ),
```

(Update the inline `fn` parameter type to include `opportunity: { updateMany(args): Promise<{ count: number }> }`.)

- [ ] **Step 2: Extend the calendar-book `bookingStore` dep** so the reschedule ops get the new methods. The wired `bookingStore` is the real `PrismaBookingStore` (has `findUpcomingByContact`/`reschedule`/`cancel` from Task 4) — confirm they're passed through (they are, since `bookingStore` is the store instance). If the dep is a narrowed object, add the three method pass-throughs.

- [ ] **Step 3: Register prom counters.** In `apps/api/src/metrics.ts` and `apps/chat/src/bootstrap/metrics.ts`, add `new promClient.Counter(...)` for each of the 6 (names e.g. `switchboard_booking_confirmed_total`, labels `orgId`/`reason`), wired into the `SwitchboardMetrics` object passed to `setMetrics(...)`. Follow the existing `slotQueryZeroResult` registration exactly (per the dual-prom-constructor note — register in BOTH bootstraps).

- [ ] **Step 4: Verify** — `pnpm --filter @switchboard/api typecheck && pnpm --filter @switchboard/api test` and `pnpm --filter @switchboard/chat typecheck`. Expected: PASS (the api metrics test sees the new counters).

- [ ] **Step 5: Commit** — `git commit -am "feat(api): wire opportunity stage-advance tx + reschedule store + register booking counters"`

---

## Task 10: skills/alex/SKILL.md — pending-approval prose + Phase-5 reschedule/cancel

**Files:** Modify `skills/alex/SKILL.md` (Phase-4 booking section lines 230-248; new Phase-5 after line 248)

- [ ] **Step 1: Add the pending-approval branch** after the success line (line 237) — gate the success line on a confirmed result:

```markdown
5. Confirm based on the tool result:
   - If `booking.create` returns status **"confirmed"** (success):
     "You're all set! I've booked [service] for [day] at [time]. You'll receive a calendar invite shortly."
   - If it returns status **"pending_approval"** (the booking needs a human OK first):
     "I've put your booking request in for [service] on [day] at [time] — the team will confirm it shortly and you'll get the calendar invite. Anything else in the meantime?"
     Do NOT say "you're all set", and do NOT call escalate — the approval is already queued.
```

Under the failure branch (line 244-248), add a SLOT_TAKEN line:

```markdown
- If it returns code **SLOT_TAKEN**, the slot was just taken — call calendar-book.slots.query again and offer the next available times. Never claim a taken slot was booked.
```

- [ ] **Step 2: Add Phase-5 reschedule/cancel** (after line 248, before `## Escalation`):

```markdown
### Phase 5: Reschedule or cancel an existing appointment

When a lead with an existing appointment wants to change or cancel it, handle it directly — do NOT escalate.

- To move an appointment: confirm the new time the lead wants, then call `calendar-book.booking.reschedule` with slotStart, slotEnd, calendarId (and `service` if they have more than one upcoming appointment). You do not pass a contact id — the system resolves the lead's own upcoming appointment.
- To cancel: call `calendar-book.booking.cancel` (optionally with `service`/`reason`).
- Confirm the change back by service + date: "Done — I've moved your [service] to [new day/time]." / "I've cancelled your [service] on [day]."
- If the tool returns **NO_UPCOMING_BOOKING**, tell the lead you don't see an upcoming appointment and offer to book one.
- If it returns RESCHEDULE_FAILURE / CANCEL_FAILURE, apologize and escalate so a human can adjust it.
- Rescheduling is no problem — reassure the lead; never apply booking pressure.
```

- [ ] **Step 3: Verify** — `pnpm format:check` (md is prettier-formatted) or let lint-staged reformat on commit.

- [ ] **Step 4: Commit** — `git commit -am "docs(alex): branch booking confirmation prose + add reschedule/cancel phase"`

---

## Task 11: evals — stateful mock + duplicate/cancel/governed-close fixtures that bite

**Files:**

- Modify: `evals/alex-conversation/mock-tools.ts`
- Modify: `evals/alex-conversation/fixtures/gen-post-booking.jsonl` (strengthen reschedule; add cancel)
- Create/modify: `evals/alex-conversation/fixtures/gen-tool-error.jsonl` (duplicate-booking) + a governed-close fixture
- Modify: `evals/alex-conversation/baseline.json`
- Test: `evals/alex-conversation/__tests__/mock-tools.test.ts`

- [ ] **Step 1: Make the mock param-aware/stateful + add reschedule/cancel ops.** In `createMockTools`, give `booking.create` access to the `calls`/state closure so it returns a failure for a sentinel and on a repeat of the same `(contactId,service,slotStart)`; add `booking.reschedule` + `booking.cancel` recording ops to `calendarBook.operations`; add a `pending_approval` path keyed on a sentinel slot:

```ts
// booking.create execute (replace the static thunk):
const bookedSlots = new Set<string>();
// ...
"booking.create": { description: "...", effectCategory: "external_mutation", idempotent: true,
  inputSchema: { /* unchanged */ },
  execute: async (params: unknown): Promise<ToolResult> => {
    record("calendar-book", "booking.create", params);
    const p = params as { contactId?: string; service?: string; slotStart?: string };
    const key = `${p.contactId}|${p.service}|${p.slotStart}`;
    if (p.slotStart?.includes("T23:")) return pendingApproval("APPROVAL_REQUIRED"); // governed-close sentinel
    if (p.slotStart?.includes("T22:") || bookedSlots.has(key)) {
      return fail("SLOT_TAKEN", "That time was just taken.", { retryable: true, data: { failureType: "slot_conflict" } });
    }
    bookedSlots.add(key);
    return ok({ bookingId: "mock-booking", status: "confirmed" });
  },
},
"booking.reschedule": recordingOp("calendar-book", "booking.reschedule", "Reschedule the contact's upcoming appointment.", "external_mutation",
  { type: "object", properties: { slotStart: { type: "string" }, slotEnd: { type: "string" }, calendarId: { type: "string" }, service: { type: "string" } }, required: ["slotStart", "slotEnd", "calendarId"] },
  () => ({ bookingId: "mock-booking", status: "rescheduled" }), false),
"booking.cancel": recordingOp("calendar-book", "booking.cancel", "Cancel the contact's upcoming appointment.", "external_mutation",
  { type: "object", properties: { service: { type: "string" }, reason: { type: "string" } } }, () => ({ bookingId: "mock-booking", status: "cancelled" }), false),
```

(Import `fail`, `pendingApproval` from `@switchboard/core/skill-runtime` alongside `ok`.)

- [ ] **Step 2: Mock unit test** — assert the new behavior:

```ts
it("booking.create fails on a repeat slot and a T22 sentinel; pending on T23; reschedule/cancel exist", async () => {
  const { tools } = createMockTools();
  const cb = tools.get("calendar-book")!;
  expect(cb.operations["booking.reschedule"]).toBeDefined();
  expect(cb.operations["booking.cancel"]).toBeDefined();
  const taken = await cb.operations["booking.create"].execute({
    contactId: "c",
    service: "s",
    slotStart: "2026-06-10T22:00:00Z",
    slotEnd: "x",
    calendarId: "p",
  });
  expect(taken.status).toBe("error");
  const pending = await cb.operations["booking.create"].execute({
    contactId: "c",
    service: "s",
    slotStart: "2026-06-10T23:00:00Z",
    slotEnd: "x",
    calendarId: "p",
  });
  expect(pending.status).toBe("pending_approval");
});
```

- [ ] **Step 3: Add/strengthen fixtures.**
  - In `gen-post-booking.jsonl`, edit `post-sg-hifu-reschedule` oracle to `{"forbiddenTools":["escalate"],"expectedTools":["calendar-book"]}` (now bites: pre-fix Alex escalates → both violations; post-fix reschedules via calendar-book).
  - Add a cancel fixture `post-sg-filler-cancel` (`forbiddenTools:["escalate"]`, `expectedTools:["calendar-book"]`).
  - In `gen-tool-error.jsonl`, add `err-sg-slot-taken-reoffer`: lead picks a slot whose `slotStart` hits the `T22` sentinel; grade `mustNot:["fabricate a confirmed booking"]`, `mustDo:["offer another time"]`; oracle `{"expectsEscalation":false}`.
  - Add a governed-close fixture `book-sg-governed-close` whose chosen slot hits the `T23` sentinel; grade `mustNot:["claim the booking is confirmed","say you're all set"]`, `mustDo:["say the team will confirm shortly"]`; oracle `{"forbiddenTools":["escalate"],"expectedTools":["calendar-book"]}`.

- [ ] **Step 4: Add baseline entries.** For each NEW fixture id, add a `baseline.json` entry (`deterministicPass:true`, a `judgeScore`), so `score.ts` includes them in the regression gate rather than skipping (lines 78-84). Match the existing baseline entry shape.

- [ ] **Step 5: Verify well-formedness (blocking gate)** — `pnpm exec vitest run --config evals/vitest.config.ts` from repo root. Expected: schema/oracle/load-fixtures/mock-tools suites PASS. Then `pnpm --filter @switchboard/eval-alex-conversation typecheck` (evals are NOT typechecked in CI).

- [ ] **Step 6: Red-team verify the bite (live LLM).** With the `.env` key loaded, run the live eval on the new fixtures on this branch (expect PASS) and confirm the reschedule fixture FAILS on a pre-fix tree (stash the mock reschedule ops + SKILL.md Phase-5, re-run, observe `forbidden-tool-called:escalate`/`missing-expected-tool:calendar-book`, then restore):

```bash
node --env-file=.env ./node_modules/.bin/tsx evals/alex-conversation/run-eval.ts --filter post-sg-hifu-reschedule --filter book-sg-governed-close --filter err-sg-slot-taken-reoffer
```

(If `run-eval.ts` has no `--filter`, run the suite and inspect those scenario results.) Record the before/after in the PR description. If credits are unavailable, fall back to a deterministic `run-conversation`/oracle simulation feeding synthetic `toolCalls` (`[escalate]`→fail, `[calendar-book]`→pass).

- [ ] **Step 7: Commit** — `git commit -am "test(eval): stateful booking mock + duplicate/cancel/governed-close fixtures that bite"`

---

## Self-Review (run against the spec)

**Spec coverage:** A (Task 6) · B (Task 2) · C (Task 3) · D orphan (Task 7) · E prose (Task 10) · F reschedule/cancel (Tasks 4,8) · G counters (Tasks 5,7,9) · H eval (Task 11). Decision #2 (no dial) — no governance task, intentional. Decision #3 (reschedule in scope) — Tasks 4/8/10/11. ✓ all covered.

**Type consistency:** `STAGES_AT_OR_BEYOND_BOOKED` (Task 1) used in Task 6. `BookingSlotConflictError`/`isBookingSlotConflictError` (Task 1) thrown in Task 3, caught in Task 7. `findUpcomingByContact`/`reschedule`/`cancel` signatures match between Task 4 (db) and Task 8 (core dep subset). The 6 counter names match across Tasks 5/7/9. `tx.opportunity.updateMany` typed in Task 6, provided in Task 9.

**Placeholder scan:** every code step has concrete code; the migration timestamp is the one intentional fill-in (pick > `20260603000000`).

**Verification gate (final, Task in #8 of the session task list):** `pnpm build && pnpm typecheck && pnpm test && pnpm format:check && pnpm lint` + `pnpm --filter @switchboard/eval-alex-conversation typecheck` + `pnpm db:check-drift`. Ignore the pg_advisory work-trace-integrity flake and the classifier-eval RED-on-main.
