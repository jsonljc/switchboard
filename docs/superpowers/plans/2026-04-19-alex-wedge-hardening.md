# Alex Wedge Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Alex booking path survive provider failures, duplicate bookings, and confirmation failures — with real operator escalation instead of conversational theater.

**Architecture:** Extract a `BookingFailureHandler` that owns the failure/escalation path (booking → failed, escalation record, outbox event). Keep `calendar-book.ts` focused on the happy path with inline duplicate detection and provider failure delegation. Add `"failed"` to the booking status enum.

**Tech Stack:** TypeScript, Vitest, Prisma, Zod

---

## File Map

| File                                                                    | Action              | Responsibility                                                     |
| ----------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------ |
| `packages/schemas/src/calendar.ts`                                      | Modify (line 21-27) | Add `"failed"` to `BookingStatusSchema`                            |
| `packages/schemas/src/__tests__/calendar.test.ts`                       | Create              | Schema test for new status                                         |
| `packages/db/src/stores/prisma-booking-store.ts`                        | Modify              | Add `findBySlot` + `markFailed` methods                            |
| `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`         | Modify              | Tests for new methods                                              |
| `packages/core/src/skill-runtime/tools/booking-failure-handler.ts`      | Create              | Failure handler: mark failed, create escalation, emit outbox event |
| `packages/core/src/skill-runtime/tools/booking-failure-handler.test.ts` | Create              | Handler tests                                                      |
| `packages/core/src/skill-runtime/tools/calendar-book.ts`                | Modify              | Add duplicate guard, provider failure catch, confirm failure catch |
| `packages/core/src/skill-runtime/tools/calendar-book.test.ts`           | Modify              | Tests for new failure paths                                        |
| `packages/core/src/skill-runtime/index.ts`                              | Modify              | Re-export `BookingFailureHandler`                                  |
| `apps/api/src/bootstrap/skill-mode.ts`                                  | Modify              | Wire `BookingFailureHandler` into tool deps                        |

---

### Task 1: Add `"failed"` to BookingStatusSchema + Schema Test

**Files:**

- Modify: `packages/schemas/src/calendar.ts:21-27`
- Create: `packages/schemas/src/__tests__/calendar.test.ts`

- [ ] **Step 1: Write the schema test**

Create `packages/schemas/src/__tests__/calendar.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { BookingStatusSchema } from "../calendar.js";

describe("BookingStatusSchema", () => {
  it("accepts 'failed' as a valid booking status", () => {
    expect(BookingStatusSchema.parse("failed")).toBe("failed");
  });

  it("rejects invalid statuses", () => {
    expect(() => BookingStatusSchema.parse("bogus")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run src/__tests__/calendar.test.ts`

Expected: FAIL — `"failed"` is not in the enum yet.

- [ ] **Step 3: Add `"failed"` to the enum**

In `packages/schemas/src/calendar.ts`, replace lines 21-27:

```typescript
export const BookingStatusSchema = z.enum([
  "pending_confirmation",
  "confirmed",
  "cancelled",
  "no_show",
  "completed",
  "failed",
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run src/__tests__/calendar.test.ts`

Expected: PASS

- [ ] **Step 5: Regenerate Prisma client**

Run: `npx pnpm@9.15.4 db:generate`

The DB column is a plain `String` — no migration needed. Prisma client regen ensures types are fresh.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/calendar.ts packages/schemas/src/__tests__/calendar.test.ts && git commit -m "feat: add 'failed' booking status to schema"
```

---

### Task 2: Add `findBySlot` and `markFailed` to PrismaBookingStore

**Files:**

- Modify: `packages/db/src/stores/prisma-booking-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`

- [ ] **Step 1: Write the tests**

Add to `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`, inside the existing `describe("PrismaBookingStore")` block, after the last `it()`:

```typescript
it("finds a booking by slot fields", async () => {
  const startsAt = new Date("2026-04-20T10:00:00Z");
  (prisma.booking.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "bk_1",
    status: "confirmed",
  });

  const result = await store.findBySlot("org_1", "ct_1", "consultation", startsAt);
  expect(result?.id).toBe("bk_1");
  expect(prisma.booking.findFirst).toHaveBeenCalledWith({
    where: {
      organizationId: "org_1",
      contactId: "ct_1",
      service: "consultation",
      startsAt,
    },
  });
});

it("marks a booking as failed", async () => {
  (prisma.booking.update as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "bk_1",
    status: "failed",
  });

  const result = await store.markFailed("bk_1");
  expect(result.status).toBe("failed");
  expect(prisma.booking.update).toHaveBeenCalledWith({
    where: { id: "bk_1" },
    data: { status: "failed" },
  });
});
```

Also add `findFirst` to the `makePrisma()` function at the top of the file — add it to the `booking` object:

```typescript
function makePrisma() {
  return {
    booking: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run src/stores/__tests__/prisma-booking-store.test.ts`

Expected: FAIL — `findBySlot` and `markFailed` do not exist.

- [ ] **Step 3: Implement the methods**

Add to `packages/db/src/stores/prisma-booking-store.ts`, after the `countConfirmed` method:

```typescript
  async findBySlot(orgId: string, contactId: string, service: string, startsAt: Date) {
    return this.prisma.booking.findFirst({
      where: { organizationId: orgId, contactId, service, startsAt },
    });
  }

  async markFailed(bookingId: string) {
    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: "failed" },
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run src/stores/__tests__/prisma-booking-store.test.ts`

Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-booking-store.ts packages/db/src/stores/__tests__/prisma-booking-store.test.ts && git commit -m "feat: add findBySlot and markFailed to PrismaBookingStore"
```

---

### Task 3: Create BookingFailureHandler

**Files:**

- Create: `packages/core/src/skill-runtime/tools/booking-failure-handler.ts`
- Create: `packages/core/src/skill-runtime/tools/booking-failure-handler.test.ts`

- [ ] **Step 1: Write the tests**

Create `packages/core/src/skill-runtime/tools/booking-failure-handler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BookingFailureHandler } from "./booking-failure-handler.js";
import type { BookingFailureInput } from "./booking-failure-handler.js";

function makeRunTransaction() {
  const created: Record<string, unknown>[] = [];
  return {
    fn: vi.fn(
      async (
        fn: (tx: {
          booking: { update: (...args: unknown[]) => Promise<unknown> };
          escalationRecord: { create: (...args: unknown[]) => Promise<unknown> };
          outboxEvent: { create: (...args: unknown[]) => Promise<unknown> };
        }) => Promise<unknown>,
      ) =>
        fn({
          booking: {
            update: vi.fn().mockResolvedValue({ id: "bk_1", status: "failed" }),
          },
          escalationRecord: {
            create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
              const record = { id: "esc_1", ...args.data };
              created.push(record);
              return Promise.resolve(record);
            }),
          },
          outboxEvent: {
            create: vi.fn().mockResolvedValue({ id: "ob_1" }),
          },
        }),
    ),
    created,
  };
}

function makeBookingStore() {
  return {
    findById: vi.fn(),
  };
}

function makeEscalationLookup() {
  return {
    findByBookingId: vi.fn(),
  };
}

function makeInput(overrides: Partial<BookingFailureInput> = {}): BookingFailureInput {
  return {
    bookingId: "bk_1",
    orgId: "org_1",
    contactId: "ct_1",
    service: "consultation",
    provider: "google_calendar",
    error: new Error("503 Service Unavailable"),
    failureType: "provider_error",
    retryable: false,
    ...overrides,
  };
}

describe("BookingFailureHandler", () => {
  let txHelper: ReturnType<typeof makeRunTransaction>;
  let bookingStore: ReturnType<typeof makeBookingStore>;
  let escalationLookup: ReturnType<typeof makeEscalationLookup>;
  let handler: BookingFailureHandler;

  beforeEach(() => {
    txHelper = makeRunTransaction();
    bookingStore = makeBookingStore();
    escalationLookup = makeEscalationLookup();
    bookingStore.findById.mockResolvedValue({ id: "bk_1", status: "pending_confirmation" });
    escalationLookup.findByBookingId.mockResolvedValue(null);
    handler = new BookingFailureHandler({
      runTransaction: txHelper.fn as never,
      bookingStore: bookingStore as never,
      escalationLookup: escalationLookup as never,
    });
  });

  it("marks booking as failed and creates escalation + outbox event", async () => {
    const result = await handler.handle(makeInput());

    expect(result.status).toBe("failed");
    expect(result.bookingId).toBe("bk_1");
    expect(result.escalationId).toBe("esc_1");
    expect(result.failureType).toBe("provider_error");
    expect(result.retryable).toBe(false);

    // Verify transaction was called (booking update + escalation + outbox)
    expect(txHelper.fn).toHaveBeenCalledTimes(1);

    // Booking must NOT remain pending_confirmation
    const txFn = txHelper.fn.mock.calls[0]![0] as (tx: unknown) => Promise<unknown>;
    const mockTx = {
      booking: { update: vi.fn().mockResolvedValue({ id: "bk_1", status: "failed" }) },
      escalationRecord: {
        create: vi.fn().mockResolvedValue({ id: "esc_1" }),
      },
      outboxEvent: { create: vi.fn().mockResolvedValue({ id: "ob_1" }) },
    };
    await txFn(mockTx);
    expect(mockTx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bk_1" },
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("is idempotent — returns existing escalation without duplicates", async () => {
    // First call: booking is pending
    bookingStore.findById.mockResolvedValue({ id: "bk_1", status: "pending_confirmation" });
    escalationLookup.findByBookingId.mockResolvedValue(null);
    const result1 = await handler.handle(makeInput());

    // Second call: booking is already failed, escalation exists
    bookingStore.findById.mockResolvedValue({ id: "bk_1", status: "failed" });
    escalationLookup.findByBookingId.mockResolvedValue({
      id: "esc_1",
      reason: "booking_failure",
    });
    const result2 = await handler.handle(makeInput());

    expect(result2.escalationId).toBe("esc_1");
    expect(result2.status).toBe("failed");
    // Transaction should NOT be called on second invocation
    expect(txHelper.fn).toHaveBeenCalledTimes(1);
  });

  it("includes structured metadata in escalation record", async () => {
    await handler.handle(makeInput());

    const txCall = txHelper.fn.mock.calls[0]![0] as (tx: unknown) => Promise<unknown>;
    const createCalls: { data: Record<string, unknown> }[] = [];
    const mockTx = {
      booking: { update: vi.fn().mockResolvedValue({}) },
      escalationRecord: {
        create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
          createCalls.push(args);
          return Promise.resolve({ id: "esc_1" });
        }),
      },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    await txCall(mockTx);

    const escalationData = createCalls[0]!.data;
    expect(escalationData.reason).toBe("booking_failure");
    expect(escalationData.sourceAgent).toBe("alex");
    expect(escalationData.priority).toBe("high");

    const metadata = escalationData.metadata as Record<string, unknown>;
    expect(metadata.bookingId).toBe("bk_1");
    expect(metadata.provider).toBe("google_calendar");
    expect(metadata.failureType).toBe("provider_error");
    expect(metadata.retryable).toBe(false);
  });

  it("message is LLM-safe — does not leak raw error text", async () => {
    const result = await handler.handle(
      makeInput({
        error: new Error("GOOGLE_API_KEY=sk-123abc leaked credential in stack trace"),
      }),
    );

    expect(result.message).toBe(
      "I couldn't complete the booking just now. I've flagged this for a human to follow up.",
    );
    expect(result.message).not.toContain("GOOGLE_API_KEY");
    expect(result.message).not.toContain("sk-123abc");
    expect(result.message).not.toContain("stack trace");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tools/booking-failure-handler.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/skill-runtime/tools/booking-failure-handler.ts`:

```typescript
import { randomUUID } from "node:crypto";

export interface BookingFailureInput {
  bookingId: string;
  orgId: string;
  contactId: string;
  service: string;
  provider: string;
  error: unknown;
  failureType: "provider_error" | "confirmation_failed";
  retryable: boolean;
}

export interface BookingFailureResult {
  bookingId: string;
  status: "failed";
  failureType: string;
  retryable: boolean;
  escalationId: string;
  message: string;
}

interface BookingStoreSubset {
  findById(bookingId: string): Promise<{ id: string; status: string } | null>;
}

interface EscalationLookup {
  findByBookingId(bookingId: string): Promise<{ id: string } | null>;
}

type FailureTransactionFn = (
  fn: (tx: {
    booking: {
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    };
    escalationRecord: {
      create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
    };
    outboxEvent: {
      create(args: { data: Record<string, unknown> }): Promise<unknown>;
    };
  }) => Promise<unknown>,
) => Promise<unknown>;

interface BookingFailureHandlerDeps {
  runTransaction: FailureTransactionFn;
  bookingStore: BookingStoreSubset;
  escalationLookup: EscalationLookup;
}

const SAFE_MESSAGE =
  "I couldn't complete the booking just now. I've flagged this for a human to follow up.";

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.length > 200) return msg.slice(0, 200) + "…";
    return msg;
  }
  return "Unknown error";
}

export class BookingFailureHandler {
  constructor(private deps: BookingFailureHandlerDeps) {}

  async handle(input: BookingFailureInput): Promise<BookingFailureResult> {
    const booking = await this.deps.bookingStore.findById(input.bookingId);
    if (booking?.status === "failed") {
      const existing = await this.deps.escalationLookup.findByBookingId(input.bookingId);
      return {
        bookingId: input.bookingId,
        status: "failed",
        failureType: input.failureType,
        retryable: input.retryable,
        escalationId: existing?.id ?? "unknown",
        message: SAFE_MESSAGE,
      };
    }

    const eventId = randomUUID();
    let escalationId = "";

    await this.deps.runTransaction(async (tx) => {
      await tx.booking.update({
        where: { id: input.bookingId },
        data: { status: "failed" },
      });

      const escalation = await tx.escalationRecord.create({
        data: {
          orgId: input.orgId,
          contactId: input.contactId,
          reason: "booking_failure",
          reasonDetails: sanitizeError(input.error),
          sourceAgent: "alex",
          priority: "high",
          status: "open",
          metadata: {
            bookingId: input.bookingId,
            provider: input.provider,
            failureType: input.failureType,
            retryable: input.retryable,
            service: input.service,
          },
        },
      });
      escalationId = escalation.id;

      await tx.outboxEvent.create({
        data: {
          eventId,
          type: "booking.failed",
          status: "pending",
          payload: {
            type: "booking.failed",
            contactId: input.contactId,
            organizationId: input.orgId,
            value: 0,
            occurredAt: new Date().toISOString(),
            source: "booking-failure-handler",
            metadata: {
              bookingId: input.bookingId,
              provider: input.provider,
              failureType: input.failureType,
              retryable: input.retryable,
              escalationId,
              service: input.service,
            },
          },
        },
      });
    });

    return {
      bookingId: input.bookingId,
      status: "failed",
      failureType: input.failureType,
      retryable: input.retryable,
      escalationId,
      message: SAFE_MESSAGE,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tools/booking-failure-handler.test.ts`

Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/tools/booking-failure-handler.ts packages/core/src/skill-runtime/tools/booking-failure-handler.test.ts && git commit -m "feat: add BookingFailureHandler — marks failed, creates escalation + outbox event"
```

---

### Task 4: Add duplicate guard + failure delegation to `calendar-book.ts`

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts`

- [ ] **Step 1: Update the `BookingStoreSubset` interface**

In `packages/core/src/skill-runtime/tools/calendar-book.ts`, add `findBySlot` to the existing `BookingStoreSubset` interface (after the `create` method):

```typescript
interface BookingStoreSubset {
  create(input: {
    organizationId: string;
    contactId: string;
    opportunityId?: string | null;
    service: string;
    startsAt: Date;
    endsAt: Date;
    timezone?: string;
    attendeeName?: string | null;
    attendeeEmail?: string | null;
    createdByType?: string;
    sourceChannel?: string | null;
    workTraceId?: string | null;
  }): Promise<{ id: string }>;
  findBySlot(
    orgId: string,
    contactId: string,
    service: string,
    startsAt: Date,
  ): Promise<{ id: string } | null>;
}
```

- [ ] **Step 2: Add the failure handler to deps**

Add the import at the top of the file:

```typescript
import type { BookingFailureHandler, BookingFailureResult } from "./booking-failure-handler.js";
```

Update `CalendarBookToolDeps` to include the failure handler:

```typescript
interface CalendarBookToolDeps {
  calendarProvider: CalendarProvider;
  bookingStore: BookingStoreSubset;
  opportunityStore: OpportunityStoreSubset;
  runTransaction: TransactionFn;
  failureHandler: BookingFailureHandler;
}
```

- [ ] **Step 3: Add a Prisma unique constraint error detector**

Add this helper function before `createCalendarBookTool`:

```typescript
function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
```

- [ ] **Step 4: Wrap booking creation with duplicate guard**

Replace the `// 1. Persist booking as pending` section (lines 119-129) with:

```typescript
// 1. Persist booking as pending (with duplicate guard)
let booking: { id: string };
try {
  booking = await deps.bookingStore.create({
    organizationId: input.orgId,
    contactId: input.contactId,
    opportunityId,
    service: input.service,
    startsAt: new Date(input.slotStart),
    endsAt: new Date(input.slotEnd),
    attendeeName: input.attendeeName ?? null,
    attendeeEmail: input.attendeeEmail ?? null,
  });
} catch (err) {
  if (isPrismaUniqueConstraintError(err)) {
    const existing = await deps.bookingStore.findBySlot(
      input.orgId,
      input.contactId,
      input.service,
      new Date(input.slotStart),
    );
    return {
      existingBookingId: existing?.id ?? null,
      status: "duplicate",
      failureType: "duplicate_booking",
      message: "This time slot is already booked for this contact.",
    };
  }
  throw err;
}
```

- [ ] **Step 5: Wrap calendar provider call + confirm transaction with failure handling**

Replace lines 131-185 (from `// 2. Call calendar provider` to the final `return`) with:

```typescript
// 2. Call calendar provider
let calendarResult: { calendarEventId?: string | null };
try {
  calendarResult = await deps.calendarProvider.createBooking({
    contactId: input.contactId,
    organizationId: input.orgId,
    opportunityId,
    slot: {
      start: input.slotStart,
      end: input.slotEnd,
      calendarId: input.calendarId,
      available: true,
    },
    service: input.service,
    attendeeName: input.attendeeName,
    attendeeEmail: input.attendeeEmail,
    createdByType: "agent" as const,
  });
} catch (error) {
  return deps.failureHandler.handle({
    bookingId: booking.id,
    orgId: input.orgId,
    contactId: input.contactId,
    service: input.service,
    provider: "google_calendar",
    error,
    failureType: "provider_error",
    retryable: false,
  });
}

// 3. On success: confirm booking + write outbox in one transaction
try {
  const eventId = randomUUID();
  await deps.runTransaction(async (tx) => {
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: "confirmed",
        calendarEventId: calendarResult.calendarEventId,
      },
    });
    await tx.outboxEvent.create({
      data: {
        eventId,
        type: "booked",
        status: "pending",
        payload: {
          type: "booked",
          contactId: input.contactId,
          organizationId: input.orgId,
          value: 0,
          occurredAt: new Date().toISOString(),
          source: "calendar-book",
          metadata: {
            bookingId: booking.id,
            opportunityId,
            service: input.service,
            slotStart: input.slotStart,
            slotEnd: input.slotEnd,
          },
        },
      },
    });
  });
} catch (error) {
  return deps.failureHandler.handle({
    bookingId: booking.id,
    orgId: input.orgId,
    contactId: input.contactId,
    service: input.service,
    provider: "google_calendar",
    error,
    failureType: "confirmation_failed",
    retryable: true,
  });
}

return {
  bookingId: booking.id,
  calendarEventId: calendarResult.calendarEventId,
  status: "confirmed",
  startsAt: input.slotStart,
  endsAt: input.slotEnd,
};
```

- [ ] **Step 6: Verify the file typechecks**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck`

Expected: PASS (or existing errors only, not new ones)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skill-runtime/tools/calendar-book.ts && git commit -m "feat: add duplicate guard + failure delegation to calendar-book"
```

---

### Task 5: Update `calendar-book.test.ts` with failure path tests

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`

- [ ] **Step 1: Update mock factories to include new deps**

In `packages/core/src/skill-runtime/tools/calendar-book.test.ts`, update `makeBookingStore` to include `findBySlot`:

```typescript
function makeBookingStore() {
  return {
    create: vi.fn(),
    findBySlot: vi.fn(),
  };
}
```

Add a `makeFailureHandler` factory:

```typescript
function makeFailureHandler() {
  return {
    handle: vi.fn().mockResolvedValue({
      bookingId: "bk_1",
      status: "failed",
      failureType: "provider_error",
      retryable: false,
      escalationId: "esc_1",
      message:
        "I couldn't complete the booking just now. I've flagged this for a human to follow up.",
    }),
  };
}
```

Update the `beforeEach` to create and wire the failure handler:

```typescript
let failureHandler: ReturnType<typeof makeFailureHandler>;

beforeEach(() => {
  calendarProvider = makeCalendarProvider();
  bookingStore = makeBookingStore();
  opportunityStore = makeOpportunityStore();
  runTransaction = makeRunTransaction();
  failureHandler = makeFailureHandler();
  tool = createCalendarBookTool({
    calendarProvider: calendarProvider as never,
    bookingStore: bookingStore as never,
    opportunityStore: opportunityStore as never,
    runTransaction: runTransaction as never,
    failureHandler: failureHandler as never,
  });
});
```

- [ ] **Step 2: Add duplicate booking test**

Add after the existing tests:

```typescript
it("returns existing booking ID on duplicate", async () => {
  const p2002Error = Object.assign(new Error("Unique constraint"), { code: "P2002" });
  bookingStore.create.mockRejectedValue(p2002Error);
  bookingStore.findBySlot.mockResolvedValue({ id: "bk_existing" });
  opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });

  const result = (await tool.operations["booking.create"]!.execute({
    orgId: "org_1",
    contactId: "ct_1",
    service: "consultation",
    slotStart: "2026-04-20T10:00:00+08:00",
    slotEnd: "2026-04-20T10:30:00+08:00",
    calendarId: "primary",
  })) as Record<string, unknown>;

  expect(result.status).toBe("duplicate");
  expect(result.existingBookingId).toBe("bk_existing");
  expect(result.failureType).toBe("duplicate_booking");
  expect(calendarProvider.createBooking).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Add provider failure test**

```typescript
it("delegates to failure handler when calendar provider throws", async () => {
  bookingStore.create.mockResolvedValue({ id: "bk_1" });
  opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
  calendarProvider.createBooking.mockRejectedValue(new Error("503 Service Unavailable"));

  const result = (await tool.operations["booking.create"]!.execute({
    orgId: "org_1",
    contactId: "ct_1",
    service: "consultation",
    slotStart: "2026-04-20T10:00:00+08:00",
    slotEnd: "2026-04-20T10:30:00+08:00",
    calendarId: "primary",
  })) as Record<string, unknown>;

  expect(result.status).toBe("failed");
  expect(result.escalationId).toBe("esc_1");
  expect(failureHandler.handle).toHaveBeenCalledWith(
    expect.objectContaining({
      bookingId: "bk_1",
      failureType: "provider_error",
      retryable: false,
    }),
  );
});
```

- [ ] **Step 4: Add confirm transaction failure test**

```typescript
it("delegates to failure handler when confirm transaction fails", async () => {
  bookingStore.create.mockResolvedValue({ id: "bk_1" });
  opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
  calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_123" });
  runTransaction.mockRejectedValue(new Error("DB connection lost"));

  failureHandler.handle.mockResolvedValue({
    bookingId: "bk_1",
    status: "failed",
    failureType: "confirmation_failed",
    retryable: true,
    escalationId: "esc_2",
    message:
      "I couldn't complete the booking just now. I've flagged this for a human to follow up.",
  });

  const result = (await tool.operations["booking.create"]!.execute({
    orgId: "org_1",
    contactId: "ct_1",
    service: "consultation",
    slotStart: "2026-04-20T10:00:00+08:00",
    slotEnd: "2026-04-20T10:30:00+08:00",
    calendarId: "primary",
  })) as Record<string, unknown>;

  expect(result.status).toBe("failed");
  expect(result.failureType).toBe("confirmation_failed");
  expect(result.retryable).toBe(true);
  expect(failureHandler.handle).toHaveBeenCalledWith(
    expect.objectContaining({
      failureType: "confirmation_failed",
      retryable: true,
    }),
  );
});
```

- [ ] **Step 5: Run all calendar-book tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tools/calendar-book.test.ts`

Expected: PASS (all 11 tests — 8 existing + 3 new)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/tools/calendar-book.test.ts && git commit -m "test: add failure path tests for calendar-book — duplicate, provider, confirm"
```

---

### Task 6: Re-export BookingFailureHandler + Wire in skill-mode.ts

**Files:**

- Modify: `packages/core/src/skill-runtime/index.ts`
- Modify: `apps/api/src/bootstrap/skill-mode.ts`

- [ ] **Step 1: Add re-export**

In `packages/core/src/skill-runtime/index.ts`, add after the `createCalendarBookTool` export line:

```typescript
export { BookingFailureHandler } from "./tools/booking-failure-handler.js";
export type { BookingFailureInput, BookingFailureResult } from "./tools/booking-failure-handler.js";
```

- [ ] **Step 2: Wire in skill-mode.ts**

In `apps/api/src/bootstrap/skill-mode.ts`, update the dynamic import (line 23) to include `BookingFailureHandler`:

```typescript
const {
  loadSkill,
  SkillExecutorImpl,
  AnthropicToolCallingAdapter,
  BuilderRegistry,
  createCrmQueryTool,
  createCrmWriteTool,
  createCalendarBookTool,
  BookingFailureHandler,
} = await import("@switchboard/core/skill-runtime");
```

Then add the failure handler construction after the `calendarProvider` resolution (after line 43) and before the `toolsMap`:

```typescript
const failureHandler = new BookingFailureHandler({
  runTransaction: (fn) =>
    prismaClient.$transaction((tx) =>
      fn({
        booking: tx.booking,
        escalationRecord: tx.escalationRecord,
        outboxEvent: tx.outboxEvent,
      }),
    ),
  bookingStore: {
    findById: async (bookingId: string) => {
      const b = await bookingStore.findById(bookingId);
      return b ? { id: b.id, status: b.status } : null;
    },
  },
  escalationLookup: {
    findByBookingId: async (bookingId: string) => {
      const records = await prismaClient.escalationRecord.findMany({
        where: {
          reason: "booking_failure",
          metadata: { path: ["bookingId"], equals: bookingId },
        },
        take: 1,
        orderBy: { createdAt: "desc" },
      });
      return records.length > 0 ? { id: records[0]!.id } : null;
    },
  },
});
```

Then add `failureHandler` to the `createCalendarBookTool` call — add it after `runTransaction`:

```typescript
      createCalendarBookTool({
        calendarProvider,
        bookingStore,
        opportunityStore: {
          // ... existing wrapper ...
        },
        runTransaction: (
          // ... existing wrapper ...
        ),
        failureHandler,
      }),
```

- [ ] **Step 3: Verify typecheck**

Run: `npx pnpm@9.15.4 typecheck`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skill-runtime/index.ts apps/api/src/bootstrap/skill-mode.ts && git commit -m "feat: wire BookingFailureHandler into skill-mode bootstrap"
```

---

### Task 7: Full test suite + typecheck validation

**Files:** None (validation only)

- [ ] **Step 1: Run full typecheck**

Run: `npx pnpm@9.15.4 typecheck`

Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `npx pnpm@9.15.4 test`

Expected: PASS — all packages pass. The new tests (calendar.test.ts, booking-failure-handler.test.ts, updated calendar-book.test.ts, updated prisma-booking-store.test.ts) should all pass along with existing tests.

- [ ] **Step 3: Run architecture check**

Run: `npx pnpm@9.15.4 arch:check`

Expected: PASS — no new error-level issues. `booking-failure-handler.ts` is a new file in the same directory as `calendar-book.ts` so it follows the same layer rules.

- [ ] **Step 4: Verify no regressions in existing booking tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tools/calendar-book.test.ts`

Expected: All 11 tests pass (8 existing + 3 new).

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run src/stores/__tests__/prisma-booking-store.test.ts`

Expected: All 6 tests pass (4 existing + 2 new).
