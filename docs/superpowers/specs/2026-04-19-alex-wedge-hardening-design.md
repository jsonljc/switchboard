# Alex Wedge Hardening: Booking Failure Handling, Duplicate Guard, Operator Escalation

**Date:** 2026-04-19
**Status:** Approved
**Scope:** Booking failure recovery, duplicate booking guard, operator escalation via record + outbox event

---

## Problem

The Alex booking path (WhatsApp → PlatformIngress → calendar booking → attribution) has three launch risks:

1. **No error handling on `CalendarProvider.createBooking()`** — if the Google Calendar API throws, the booking row stays `pending_confirmation` forever with no cleanup, no notification, and no user-facing response. The LLM gets an unhandled error.

2. **No duplicate booking guard** — the database has a unique constraint on `(organizationId, contactId, service, startsAt)`, but the application layer doesn't catch the constraint violation. The LLM gets a raw Prisma error.

3. **No programmatic operator escalation** — the Alex skill markdown instructs the LLM to say "let me get someone," but nothing actually notifies anyone. Escalation is conversational theater.

## Solution

**Approach B:** Extract a `BookingFailureHandler` that owns the failure/escalation path. Keep `calendar-book.ts` focused on the happy path with inline duplicate detection and provider failure delegation.

---

## Part 1: Schema Change

**File:** `packages/schemas/src/calendar.ts`

Add `"failed"` to `BookingStatusSchema`:

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

This is the only schema change. `"failed"` is semantically distinct from existing terminal states:

- `"cancelled"` = intentionally cancelled by user/operator
- `"completed"` = booking happened and finished
- `"failed"` = booking could not be created due to provider/system error

**Propagation:**

- Regenerate Prisma client (`pnpm db:generate`)
- The DB column is a plain `String` — no SQL migration needed
- Update any test fixtures that enumerate booking statuses

---

## Part 2: BookingFailureHandler

**New file:** `packages/core/src/skill-runtime/tools/booking-failure-handler.ts`

### Responsibilities

On provider failure or confirmation transaction failure:

1. Mark booking status as `"failed"` (exits `pending_confirmation`)
2. Create an `EscalationRecord` with structured details
3. Emit a `"booking.failed"` outbox event
4. Return a structured result the LLM can relay safely

### Interface

```typescript
interface BookingFailureInput {
  bookingId: string;
  orgId: string;
  contactId: string;
  service: string;
  provider: string;
  error: unknown;
  failureType: "provider_error" | "confirmation_failed";
  retryable: boolean;
}

interface BookingFailureResult {
  bookingId: string;
  status: "failed";
  failureType: string;
  retryable: boolean;
  escalationId: string;
  message: string; // LLM-safe, never contains raw error details
}
```

### Idempotency

Before writing, checks if the booking is already in `"failed"` status. If so:

- Fetches the existing `EscalationRecord` linked to this booking ID (via metadata JSON query or a second query filtered by `orgId` + `reason` + metadata containing `bookingId`)
- Returns the existing `BookingFailureResult` with the original `escalationId`
- Does NOT create a second escalation record or outbox event

### Transaction scope

All three writes (booking status → `"failed"`, `EscalationRecord` creation, outbox event emission) run in a single Prisma transaction. This is the right scope because they represent one logical state transition: "this booking failed and we need help." Partial writes would leave the system in a confusing state.

### EscalationRecord fields

| Field           | Value                                                               |
| --------------- | ------------------------------------------------------------------- |
| `orgId`         | from input                                                          |
| `contactId`     | from input                                                          |
| `reason`        | `"booking_failure"`                                                 |
| `reasonDetails` | Sanitized error message (no raw stack traces or provider internals) |
| `sourceAgent`   | `"alex"`                                                            |
| `priority`      | `"high"`                                                            |
| `status`        | `"open"`                                                            |
| `metadata`      | `{ bookingId, provider, failureType, retryable, service }`          |

### Outbox event

| Field                    | Value                                                                    |
| ------------------------ | ------------------------------------------------------------------------ |
| `type`                   | `"booking.failed"`                                                       |
| `status`                 | `"pending"`                                                              |
| `payload.type`           | `"booking.failed"`                                                       |
| `payload.contactId`      | from input                                                               |
| `payload.organizationId` | from input                                                               |
| `payload.metadata`       | `{ bookingId, provider, failureType, retryable, escalationId, service }` |

### LLM-safe message

The returned `message` is always a fixed string:

```
"I couldn't complete the booking just now. I've flagged this for a human to follow up."
```

Never interpolates raw error text. The error details live in `EscalationRecord.reasonDetails` and metadata, visible to operators but not users.

---

## Part 3: Changes to `calendar-book.ts`

### Duplicate booking guard

Wrap `bookingStore.create()` in a try/catch. On Prisma unique constraint error (`P2002`):

```typescript
catch (err) {
  if (isPrismaUniqueConstraintError(err)) {
    const existing = await deps.bookingStore.findBySlot(
      input.orgId, input.contactId, input.service, new Date(input.slotStart)
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

This requires adding a `findBySlot` method to `BookingStoreSubset`. It queries by the same fields as the unique constraint.

No escalation needed for duplicates — they're business-state idempotency, not operational failures.

### Provider failure delegation

Wrap `calendarProvider.createBooking()` in a try/catch:

```typescript
try {
  const calendarResult = await deps.calendarProvider.createBooking(...);
  // ... existing success transaction ...
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
```

### Confirmation transaction failure

Wrap the success transaction in a try/catch:

```typescript
try {
  await deps.runTransaction(async (tx) => { ... });
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
```

This case is distinct: the calendar event WAS created in Google Calendar, but we couldn't confirm it in our DB. `retryable: true` + `failureType: "confirmation_failed"` gives operators enough signal to distinguish this from a provider failure.

### Dependency change

`CalendarBookToolDeps` gains:

```typescript
failureHandler: BookingFailureHandler;
```

Wired in `apps/api/src/bootstrap/skill-mode.ts`.

### What doesn't change

The success path (opportunity resolution, pending booking creation, calendar API call, confirm transaction, return confirmed result) stays exactly as-is.

---

## Part 4: BookingStore Addition

**File:** `packages/db/src/stores/prisma-booking-store.ts`

Add one method:

```typescript
async findBySlot(orgId: string, contactId: string, service: string, startsAt: Date) {
  return this.prisma.booking.findFirst({
    where: { organizationId: orgId, contactId, service, startsAt },
  });
}
```

Also add to `BookingStoreSubset` interface in `calendar-book.ts`:

```typescript
findBySlot(orgId: string, contactId: string, service: string, startsAt: Date):
  Promise<{ id: string } | null>;
```

---

## Part 5: Test Plan

### New: `booking-failure-handler.test.ts`

1. **marks booking as failed and creates escalation + outbox event** — verify booking status is `"failed"` (not `pending_confirmation`), escalation record has correct fields, outbox event has type `"booking.failed"` with structured metadata
2. **idempotent on retry** — call `handle()` twice with same booking ID, verify exactly one escalation record and one outbox event, second call returns same `escalationId`, no second outbox payload with different ID/timestamp
3. **includes structured metadata** — verify metadata contains `bookingId`, `provider`, `failureType`, `retryable`, `contactId`, `orgId`
4. **message is LLM-safe** — verify returned message does not contain raw error text, provider internals, or stack traces

### Updates to: `calendar-book.test.ts`

5. **duplicate booking returns existing booking ID** — mock `bookingStore.create` to throw P2002, mock `findBySlot` to return existing booking, verify response has `status: "duplicate"`, `existingBookingId` is the real ID, `failureType: "duplicate_booking"`
6. **calendar provider failure delegates to failure handler** — mock `calendarProvider.createBooking` to throw, verify `failureHandler.handle()` is called with `failureType: "provider_error"` and `retryable: false`, verify response is the structured failure result (not a thrown error)
7. **confirm transaction failure routes through failure handler** — mock the confirm transaction to throw after successful `createBooking`, verify failure handler is called with `failureType: "confirmation_failed"` and `retryable: true`

### Schema test

8. **BookingStatusSchema accepts "failed"** — verify `BookingStatusSchema.parse("failed")` succeeds

### Total: 8 tests across 3 files

All use mocked dependencies. No integration tests at this stage.

---

## Implementation Sequence

1. Add `"failed"` to `BookingStatusSchema`, regenerate Prisma client, add schema test
2. Add `findBySlot` to `PrismaBookingStore`
3. Create `BookingFailureHandler` with tests
4. Modify `calendar-book.ts` — add duplicate guard, provider failure delegation, confirm failure delegation, update deps interface
5. Update `calendar-book.test.ts` with new test cases
6. Wire `BookingFailureHandler` in `skill-mode.ts` bootstrap
7. Run full test suite + typecheck
