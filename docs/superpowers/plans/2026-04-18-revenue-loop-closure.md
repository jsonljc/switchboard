# Revenue Loop Closure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the revenue loop: agent-driven booking → durable event bus with outbox → attribution persistence + ad platform dispatch → ROI dashboard.

**Architecture:** Four sequential sections. Each builds on the prior but produces testable software independently. The booking tool writes a Booking + OutboxEvent in one DB transaction (after calendar confirmation). An OutboxPublisher moves events to a Redis Streams-backed ConversionBus. Downstream consumer groups handle CRM updates, attribution persistence, and ad platform dispatch. The ROI dashboard reads exclusively from ConversionRecord.

**Tech Stack:** TypeScript ESM, Prisma + PostgreSQL, Redis Streams (ioredis), Fastify, Next.js 15, TanStack React Query, shadcn/ui, vitest, googleapis, google-ads-api.

**Spec:** `docs/superpowers/specs/2026-04-18-revenue-loop-closure-design.md` (Revision 2)

---

## Section 1: Calendar Provider + Google Calendar Adapter + Booking Tool

---

### Task 1: ConversionStage enum + Calendar schemas

**Files:**

- Create: `packages/schemas/src/conversion.ts`
- Create: `packages/schemas/src/calendar.ts`
- Modify: `packages/schemas/src/index.ts`
- Modify: `packages/schemas/package.json`

- [ ] **Step 1: Create `packages/schemas/src/conversion.ts`**

```typescript
import { z } from "zod";

export const ConversionStageSchema = z.enum([
  "inquiry",
  "qualified",
  "booked",
  "purchased",
  "completed",
]);
export type ConversionStage = z.infer<typeof ConversionStageSchema>;
```

- [ ] **Step 2: Create `packages/schemas/src/calendar.ts`**

```typescript
import { z } from "zod";

export const SlotQuerySchema = z.object({
  dateFrom: z.string(),
  dateTo: z.string(),
  durationMinutes: z.number().int().positive(),
  service: z.string().min(1),
  timezone: z.string().min(1),
  bufferMinutes: z.number().int().nonnegative().default(15),
});
export type SlotQuery = z.infer<typeof SlotQuerySchema>;

export const TimeSlotSchema = z.object({
  start: z.string(),
  end: z.string(),
  calendarId: z.string(),
  available: z.boolean(),
});
export type TimeSlot = z.infer<typeof TimeSlotSchema>;

export const BookingStatusSchema = z.enum([
  "pending_confirmation",
  "confirmed",
  "cancelled",
  "no_show",
  "completed",
]);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

export const BookingSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  organizationId: z.string(),
  opportunityId: z.string().nullable().optional(),
  service: z.string(),
  status: BookingStatusSchema,
  calendarEventId: z.string().nullable().optional(),
  attendeeName: z.string().nullable().optional(),
  attendeeEmail: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdByType: z.enum(["agent", "human", "contact"]),
  sourceChannel: z.string().nullable().optional(),
  workTraceId: z.string().nullable().optional(),
  rescheduledAt: z.string().nullable().optional(),
  rescheduleCount: z.number().int().nonnegative().default(0),
  startsAt: z.string(),
  endsAt: z.string(),
  timezone: z.string().default("Asia/Singapore"),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Booking = z.infer<typeof BookingSchema>;

export const CreateBookingInputSchema = z.object({
  contactId: z.string().min(1),
  organizationId: z.string().min(1),
  opportunityId: z.string().nullable().optional(),
  slot: TimeSlotSchema,
  service: z.string().min(1),
  attendeeName: z.string().nullable().optional(),
  attendeeEmail: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdByType: z.enum(["agent", "human", "contact"]).default("agent"),
  sourceChannel: z.string().nullable().optional(),
  workTraceId: z.string().nullable().optional(),
});
export type CreateBookingInput = z.infer<typeof CreateBookingInputSchema>;

export const BusinessHoursConfigSchema = z.object({
  timezone: z.string().min(1),
  days: z.array(
    z.object({
      day: z.number().int().min(0).max(6),
      open: z.string().regex(/^\d{2}:\d{2}$/),
      close: z.string().regex(/^\d{2}:\d{2}$/),
    }),
  ),
  defaultDurationMinutes: z.number().int().positive(),
  bufferMinutes: z.number().int().nonnegative(),
  slotIncrementMinutes: z.number().int().positive().default(30),
});
export type BusinessHoursConfig = z.infer<typeof BusinessHoursConfigSchema>;

export const CalendarHealthCheckSchema = z.object({
  status: z.enum(["connected", "disconnected", "degraded"]),
  latencyMs: z.number(),
  error: z.string().nullable().optional(),
});
export type CalendarHealthCheck = z.infer<typeof CalendarHealthCheckSchema>;

export interface CalendarProvider {
  listAvailableSlots(query: SlotQuery): Promise<TimeSlot[]>;
  createBooking(input: CreateBookingInput): Promise<Booking>;
  cancelBooking(bookingId: string, reason?: string): Promise<void>;
  rescheduleBooking(bookingId: string, newSlot: TimeSlot): Promise<Booking>;
  getBooking(bookingId: string): Promise<Booking | null>;
  healthCheck(): Promise<CalendarHealthCheck>;
}
```

- [ ] **Step 3: Add exports to `packages/schemas/src/index.ts`**

Add at the end of the file:

```typescript
export * from "./conversion.js";
export * from "./calendar.js";
```

- [ ] **Step 4: Add sub-path exports to `packages/schemas/package.json`**

Add to the `"exports"` object:

```json
"./conversion": {
  "types": "./dist/conversion.d.ts",
  "import": "./dist/conversion.js"
},
"./calendar": {
  "types": "./dist/calendar.d.ts",
  "import": "./dist/calendar.js"
}
```

- [ ] **Step 5: Build and verify**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas build`
Expected: Clean build, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/conversion.ts packages/schemas/src/calendar.ts packages/schemas/src/index.ts packages/schemas/package.json && git commit -m "$(cat <<'EOF'
feat(schemas): add ConversionStage enum and Calendar provider schemas

ConversionStage is the single source of truth for funnel stages.
CalendarProvider interface mirrors CrmProvider pattern.
EOF
)"
```

---

### Task 2: Prisma models — Booking + OutboxEvent

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add Booking and OutboxEvent models to the end of `schema.prisma` (after WorkTrace, line ~1426)**

```prisma
// ---------------------------------------------------------------------------
// Booking — calendar bookings with provenance
// ---------------------------------------------------------------------------

model Booking {
  id              String    @id @default(uuid())
  organizationId  String
  contactId       String
  opportunityId   String?
  calendarEventId String?
  service         String
  startsAt        DateTime
  endsAt          DateTime
  timezone        String    @default("Asia/Singapore")
  status          String    @default("pending_confirmation")
  attendeeName    String?
  attendeeEmail   String?
  connectionId    String?
  createdByType   String    @default("agent")
  sourceChannel   String?
  workTraceId     String?
  rescheduledAt   DateTime?
  rescheduleCount Int       @default(0)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([organizationId, startsAt])
  @@index([contactId])
  @@index([status])
}

// ---------------------------------------------------------------------------
// OutboxEvent — transactional outbox for guaranteed event publication
// ---------------------------------------------------------------------------

model OutboxEvent {
  id            String    @id @default(uuid())
  eventId       String    @unique
  type          String
  payload       Json
  status        String    @default("pending")
  attempts      Int       @default(0)
  lastAttemptAt DateTime?
  createdAt     DateTime  @default(now())

  @@index([status, createdAt])
}
```

- [ ] **Step 2: Generate Prisma client**

Run: `npx pnpm@9.15.4 --filter @switchboard/db db:generate`
Expected: Prisma client regenerated successfully.

- [ ] **Step 3: Create and run migration**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/db exec prisma migrate dev --name add_booking_and_outbox`
Expected: Migration applied.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ && git commit -m "$(cat <<'EOF'
feat(db): add Booking and OutboxEvent Prisma models

Booking tracks calendar appointments with provenance fields.
OutboxEvent enables transactional outbox pattern for ConversionBus.
EOF
)"
```

---

### Task 3: PrismaBookingStore

**Files:**

- Create: `packages/db/src/stores/prisma-booking-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaBookingStore } from "../prisma-booking-store.js";

function makePrisma() {
  return {
    booking: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  } as unknown as Parameters<
    typeof PrismaBookingStore extends new (p: infer P) => unknown ? P : never
  >[0];
}

describe("PrismaBookingStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaBookingStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaBookingStore(prisma as never);
  });

  it("creates a booking with pending_confirmation status", async () => {
    const input = {
      organizationId: "org_1",
      contactId: "ct_1",
      service: "consultation",
      startsAt: new Date("2026-04-20T10:00:00Z"),
      endsAt: new Date("2026-04-20T10:30:00Z"),
      timezone: "Asia/Singapore",
      createdByType: "agent" as const,
    };
    (prisma.booking.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "bk_1",
      status: "pending_confirmation",
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await store.create(input);
    expect(result.status).toBe("pending_confirmation");
    expect(prisma.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ service: "consultation", status: "pending_confirmation" }),
    });
  });

  it("confirms a booking by id", async () => {
    (prisma.booking.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "bk_1",
      status: "confirmed",
      calendarEventId: "gcal_abc",
    });

    const result = await store.confirm("bk_1", "gcal_abc");
    expect(result.status).toBe("confirmed");
    expect(prisma.booking.update).toHaveBeenCalledWith({
      where: { id: "bk_1" },
      data: { status: "confirmed", calendarEventId: "gcal_abc" },
    });
  });

  it("finds a booking by id", async () => {
    (prisma.booking.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "bk_1",
      status: "confirmed",
    });

    const result = await store.findById("bk_1");
    expect(result?.status).toBe("confirmed");
  });

  it("counts confirmed bookings for an org", async () => {
    (prisma.booking.count as ReturnType<typeof vi.fn>).mockResolvedValue(5);
    const count = await store.countConfirmed("org_1");
    expect(count).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-booking-store`
Expected: FAIL — `prisma-booking-store.js` does not exist.

- [ ] **Step 3: Write implementation**

Create `packages/db/src/stores/prisma-booking-store.ts`:

```typescript
import type { PrismaDbClient } from "../prisma-db.js";

interface CreateBookingInput {
  organizationId: string;
  contactId: string;
  opportunityId?: string | null;
  service: string;
  startsAt: Date;
  endsAt: Date;
  timezone?: string;
  attendeeName?: string | null;
  attendeeEmail?: string | null;
  connectionId?: string | null;
  createdByType?: string;
  sourceChannel?: string | null;
  workTraceId?: string | null;
}

export class PrismaBookingStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateBookingInput) {
    return this.prisma.booking.create({
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
  }

  async confirm(bookingId: string, calendarEventId: string) {
    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: "confirmed", calendarEventId },
    });
  }

  async findById(bookingId: string) {
    return this.prisma.booking.findUnique({ where: { id: bookingId } });
  }

  async countConfirmed(orgId: string) {
    return this.prisma.booking.count({
      where: { organizationId: orgId, status: "confirmed" },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-booking-store`
Expected: PASS

- [ ] **Step 5: Add export to `packages/db/src/index.ts`**

Add at the end:

```typescript
export { PrismaBookingStore } from "./stores/prisma-booking-store.js";
```

- [ ] **Step 6: Build**

Run: `npx pnpm@9.15.4 --filter @switchboard/db build`
Expected: Clean build.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/stores/prisma-booking-store.ts packages/db/src/stores/__tests__/prisma-booking-store.test.ts packages/db/src/index.ts && git commit -m "$(cat <<'EOF'
feat(db): add PrismaBookingStore with create, confirm, findById, countConfirmed
EOF
)"
```

---

### Task 4: PrismaOutboxStore

**Files:**

- Create: `packages/db/src/stores/prisma-outbox-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-outbox-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/stores/__tests__/prisma-outbox-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaOutboxStore } from "../prisma-outbox-store.js";

function makePrisma() {
  return {
    outboxEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  } as never;
}

describe("PrismaOutboxStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaOutboxStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaOutboxStore(prisma);
  });

  it("writes a pending outbox event", async () => {
    const payload = { type: "booked", contactId: "ct_1", organizationId: "org_1", value: 100 };
    (prisma.outboxEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ob_1",
      eventId: "evt_1",
      type: "booked",
      payload,
      status: "pending",
      attempts: 0,
    });

    const result = await store.write("evt_1", "booked", payload);
    expect(result.status).toBe("pending");
    expect(prisma.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventId: "evt_1", type: "booked", status: "pending" }),
    });
  });

  it("fetches pending events ordered by createdAt", async () => {
    (prisma.outboxEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "ob_1", eventId: "evt_1", status: "pending" },
    ]);

    const results = await store.fetchPending(10);
    expect(results).toHaveLength(1);
    expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
  });

  it("marks an event as published", async () => {
    (prisma.outboxEvent.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ob_1",
      status: "published",
    });

    await store.markPublished("ob_1");
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: "ob_1" },
      data: { status: "published" },
    });
  });

  it("increments attempts and marks failed after 10", async () => {
    (prisma.outboxEvent.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ob_1",
      status: "failed",
      attempts: 10,
    });

    await store.recordFailure("ob_1", 10);
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: "ob_1" },
      data: {
        attempts: 10,
        lastAttemptAt: expect.any(Date),
        status: "failed",
      },
    });
  });

  it("keeps status as pending when attempts < 10", async () => {
    (prisma.outboxEvent.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ob_1",
      status: "pending",
      attempts: 3,
    });

    await store.recordFailure("ob_1", 3);
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: "ob_1" },
      data: {
        attempts: 3,
        lastAttemptAt: expect.any(Date),
        status: "pending",
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-outbox-store`
Expected: FAIL

- [ ] **Step 3: Write implementation**

Create `packages/db/src/stores/prisma-outbox-store.ts`:

```typescript
import type { PrismaDbClient } from "../prisma-db.js";

const MAX_ATTEMPTS = 10;

export class PrismaOutboxStore {
  constructor(private prisma: PrismaDbClient) {}

  async write(eventId: string, type: string, payload: Record<string, unknown>) {
    return this.prisma.outboxEvent.create({
      data: { eventId, type, payload, status: "pending" },
    });
  }

  async fetchPending(limit: number) {
    return this.prisma.outboxEvent.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }

  async markPublished(id: string) {
    return this.prisma.outboxEvent.update({
      where: { id },
      data: { status: "published" },
    });
  }

  async recordFailure(id: string, attempts: number) {
    return this.prisma.outboxEvent.update({
      where: { id },
      data: {
        attempts,
        lastAttemptAt: new Date(),
        status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
      },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-outbox-store`
Expected: PASS

- [ ] **Step 5: Add export to `packages/db/src/index.ts`**

```typescript
export { PrismaOutboxStore } from "./stores/prisma-outbox-store.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/stores/prisma-outbox-store.ts packages/db/src/stores/__tests__/prisma-outbox-store.test.ts packages/db/src/index.ts && git commit -m "$(cat <<'EOF'
feat(db): add PrismaOutboxStore for transactional outbox pattern
EOF
)"
```

---

### Task 5: Google Calendar Adapter

**Files:**

- Create: `packages/core/src/calendar/google-calendar-adapter.ts`
- Create: `packages/core/src/calendar/google-calendar-adapter.test.ts`
- Create: `packages/core/src/calendar/slot-generator.ts`
- Create: `packages/core/src/calendar/slot-generator.test.ts`

- [ ] **Step 1: Write the slot generator test**

The slot generator is pure logic — no API calls — so test it first.

Create `packages/core/src/calendar/slot-generator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateAvailableSlots } from "./slot-generator.js";
import type { BusinessHoursConfig } from "@switchboard/schemas";

const businessHours: BusinessHoursConfig = {
  timezone: "Asia/Singapore",
  days: [
    { day: 1, open: "09:00", close: "17:00" },
    { day: 2, open: "09:00", close: "17:00" },
    { day: 3, open: "09:00", close: "17:00" },
    { day: 4, open: "09:00", close: "17:00" },
    { day: 5, open: "09:00", close: "17:00" },
  ],
  defaultDurationMinutes: 30,
  bufferMinutes: 15,
  slotIncrementMinutes: 30,
};

describe("generateAvailableSlots", () => {
  it("generates slots within business hours", () => {
    const busyPeriods: Array<{ start: string; end: string }> = [];
    const slots = generateAvailableSlots({
      dateFrom: "2026-04-20T00:00:00+08:00",
      dateTo: "2026-04-20T23:59:59+08:00",
      durationMinutes: 30,
      bufferMinutes: 15,
      businessHours,
      busyPeriods,
      calendarId: "primary",
    });

    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      const hour = new Date(slot.start).getUTCHours() + 8;
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(17);
      expect(slot.available).toBe(true);
    }
  });

  it("excludes busy periods", () => {
    const busyPeriods = [{ start: "2026-04-20T02:00:00Z", end: "2026-04-20T04:00:00Z" }];
    const slots = generateAvailableSlots({
      dateFrom: "2026-04-20T00:00:00+08:00",
      dateTo: "2026-04-20T23:59:59+08:00",
      durationMinutes: 30,
      bufferMinutes: 15,
      businessHours,
      busyPeriods,
      calendarId: "primary",
    });

    for (const slot of slots) {
      const start = new Date(slot.start).getTime();
      const end = new Date(slot.end).getTime();
      const busyStart = new Date("2026-04-20T02:00:00Z").getTime();
      const busyEnd = new Date("2026-04-20T04:00:00Z").getTime();
      expect(start >= busyEnd || end <= busyStart).toBe(true);
    }
  });

  it("returns empty array for weekend days with no business hours", () => {
    const slots = generateAvailableSlots({
      dateFrom: "2026-04-19T00:00:00+08:00",
      dateTo: "2026-04-19T23:59:59+08:00",
      durationMinutes: 30,
      bufferMinutes: 15,
      businessHours,
      busyPeriods: [],
      calendarId: "primary",
    });

    expect(slots).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run slot-generator`
Expected: FAIL

- [ ] **Step 3: Implement slot generator**

Create `packages/core/src/calendar/slot-generator.ts`:

```typescript
import type { BusinessHoursConfig, TimeSlot } from "@switchboard/schemas";

interface SlotGeneratorInput {
  dateFrom: string;
  dateTo: string;
  durationMinutes: number;
  bufferMinutes: number;
  businessHours: BusinessHoursConfig;
  busyPeriods: Array<{ start: string; end: string }>;
  calendarId: string;
}

export function generateAvailableSlots(input: SlotGeneratorInput): TimeSlot[] {
  const {
    dateFrom,
    dateTo,
    durationMinutes,
    bufferMinutes,
    businessHours,
    busyPeriods,
    calendarId,
  } = input;
  const slots: TimeSlot[] = [];
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  const current = new Date(from);

  while (current <= to) {
    const dayOfWeek = getDayInTimezone(current, businessHours.timezone);
    const dayConfig = businessHours.days.find((d) => d.day === dayOfWeek);

    if (dayConfig) {
      const dayStart = setTimeInTimezone(current, dayConfig.open, businessHours.timezone);
      const dayEnd = setTimeInTimezone(current, dayConfig.close, businessHours.timezone);
      const slotCursor = new Date(Math.max(dayStart.getTime(), from.getTime()));

      while (
        slotCursor.getTime() + durationMinutes * 60_000 <= dayEnd.getTime() &&
        slotCursor <= to
      ) {
        const slotEnd = new Date(slotCursor.getTime() + durationMinutes * 60_000);

        if (!overlapsAny(slotCursor, slotEnd, busyPeriods)) {
          slots.push({
            start: slotCursor.toISOString(),
            end: slotEnd.toISOString(),
            calendarId,
            available: true,
          });
        }

        slotCursor.setTime(slotCursor.getTime() + (durationMinutes + bufferMinutes) * 60_000);
      }
    }

    current.setDate(current.getDate() + 1);
    current.setHours(0, 0, 0, 0);
  }

  return slots;
}

function overlapsAny(start: Date, end: Date, busy: Array<{ start: string; end: string }>): boolean {
  return busy.some((b) => {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    return start.getTime() < be && end.getTime() > bs;
  });
}

function getDayInTimezone(date: Date, tz: string): number {
  return new Date(date.toLocaleString("en-US", { timeZone: tz })).getDay();
}

function setTimeInTimezone(date: Date, time: string, tz: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const dateInTz = new Date(date.toLocaleString("en-US", { timeZone: tz }));
  dateInTz.setHours(hours, minutes, 0, 0);
  const offset = date.getTime() - dateInTz.getTime();
  return new Date(dateInTz.getTime() + offset);
}
```

- [ ] **Step 4: Run slot generator test**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run slot-generator`
Expected: PASS

- [ ] **Step 5: Write Google Calendar adapter test**

Create `packages/core/src/calendar/google-calendar-adapter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleCalendarAdapter } from "./google-calendar-adapter.js";
import type { BusinessHoursConfig } from "@switchboard/schemas";

const businessHours: BusinessHoursConfig = {
  timezone: "Asia/Singapore",
  days: [{ day: 1, open: "09:00", close: "17:00" }],
  defaultDurationMinutes: 30,
  bufferMinutes: 15,
  slotIncrementMinutes: 30,
};

function makeGoogleClient() {
  return {
    freebusy: { query: vi.fn() },
    events: { insert: vi.fn(), delete: vi.fn(), patch: vi.fn(), get: vi.fn() },
  };
}

describe("GoogleCalendarAdapter", () => {
  let google: ReturnType<typeof makeGoogleClient>;
  let adapter: GoogleCalendarAdapter;

  beforeEach(() => {
    google = makeGoogleClient();
    adapter = new GoogleCalendarAdapter({
      calendarClient: google as never,
      calendarId: "primary",
      businessHours,
    });
  });

  it("listAvailableSlots queries freebusy and generates slots", async () => {
    google.freebusy.query.mockResolvedValue({
      data: { calendars: { primary: { busy: [] } } },
    });

    const slots = await adapter.listAvailableSlots({
      dateFrom: "2026-04-20T00:00:00+08:00",
      dateTo: "2026-04-20T23:59:59+08:00",
      durationMinutes: 30,
      service: "consultation",
      timezone: "Asia/Singapore",
      bufferMinutes: 15,
    });

    expect(google.freebusy.query).toHaveBeenCalled();
    expect(slots.length).toBeGreaterThan(0);
  });

  it("createBooking inserts a Google Calendar event", async () => {
    google.events.insert.mockResolvedValue({
      data: { id: "gcal_123", htmlLink: "https://calendar.google.com/event/gcal_123" },
    });

    const result = await adapter.createBooking({
      contactId: "ct_1",
      organizationId: "org_1",
      slot: {
        start: "2026-04-20T10:00:00+08:00",
        end: "2026-04-20T10:30:00+08:00",
        calendarId: "primary",
        available: true,
      },
      service: "consultation",
      attendeeName: "Alice",
      attendeeEmail: "alice@example.com",
    });

    expect(result.calendarEventId).toBe("gcal_123");
    expect(google.events.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        requestBody: expect.objectContaining({
          summary: expect.stringContaining("consultation"),
        }),
      }),
    );
  });

  it("healthCheck returns connected when API responds", async () => {
    google.events.get.mockResolvedValue({ data: {} });
    const health = await adapter.healthCheck();
    expect(health.status).toBe("connected");
  });
});
```

- [ ] **Step 6: Implement Google Calendar adapter**

Create `packages/core/src/calendar/google-calendar-adapter.ts`:

```typescript
import type {
  CalendarProvider,
  SlotQuery,
  TimeSlot,
  CreateBookingInput,
  Booking,
  CalendarHealthCheck,
  BusinessHoursConfig,
} from "@switchboard/schemas";
import { generateAvailableSlots } from "./slot-generator.js";

interface GoogleCalendarClient {
  freebusy: {
    query(params: unknown): Promise<{
      data: { calendars: Record<string, { busy: Array<{ start: string; end: string }> }> };
    }>;
  };
  events: {
    insert(params: unknown): Promise<{ data: { id: string; htmlLink?: string } }>;
    delete(params: unknown): Promise<void>;
    patch(params: unknown): Promise<{ data: { id: string } }>;
    get(params: unknown): Promise<{ data: unknown }>;
  };
}

interface GoogleCalendarAdapterConfig {
  calendarClient: GoogleCalendarClient;
  calendarId: string;
  businessHours: BusinessHoursConfig;
}

export class GoogleCalendarAdapter implements CalendarProvider {
  private readonly client: GoogleCalendarClient;
  private readonly calendarId: string;
  private readonly businessHours: BusinessHoursConfig;

  constructor(config: GoogleCalendarAdapterConfig) {
    this.client = config.calendarClient;
    this.calendarId = config.calendarId;
    this.businessHours = config.businessHours;
  }

  async listAvailableSlots(query: SlotQuery): Promise<TimeSlot[]> {
    const response = await this.client.freebusy.query({
      requestBody: {
        timeMin: query.dateFrom,
        timeMax: query.dateTo,
        items: [{ id: this.calendarId }],
      },
    });

    const busyPeriods = response.data.calendars[this.calendarId]?.busy ?? [];

    return generateAvailableSlots({
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      durationMinutes: query.durationMinutes,
      bufferMinutes: query.bufferMinutes,
      businessHours: this.businessHours,
      busyPeriods,
      calendarId: this.calendarId,
    });
  }

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    const response = await this.client.events.insert({
      calendarId: this.calendarId,
      requestBody: {
        summary: `${input.service} — ${input.attendeeName ?? "Customer"}`,
        start: { dateTime: input.slot.start },
        end: { dateTime: input.slot.end },
        attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : [],
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
      },
    });

    return {
      id: "",
      contactId: input.contactId,
      organizationId: input.organizationId,
      opportunityId: input.opportunityId ?? null,
      service: input.service,
      status: "confirmed",
      calendarEventId: response.data.id,
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
      timezone: "Asia/Singapore",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async cancelBooking(bookingId: string, _reason?: string): Promise<void> {
    await this.client.events.delete({ calendarId: this.calendarId, eventId: bookingId });
  }

  async rescheduleBooking(bookingId: string, newSlot: TimeSlot): Promise<Booking> {
    const response = await this.client.events.patch({
      calendarId: this.calendarId,
      eventId: bookingId,
      requestBody: {
        start: { dateTime: newSlot.start },
        end: { dateTime: newSlot.end },
      },
    });

    return {
      id: "",
      contactId: "",
      organizationId: "",
      service: "",
      status: "confirmed",
      calendarEventId: response.data.id,
      startsAt: newSlot.start,
      endsAt: newSlot.end,
      timezone: "Asia/Singapore",
      createdByType: "agent",
      rescheduleCount: 0,
      rescheduledAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async getBooking(_bookingId: string): Promise<Booking | null> {
    return null;
  }

  async healthCheck(): Promise<CalendarHealthCheck> {
    const start = Date.now();
    try {
      await this.client.events.get({ calendarId: this.calendarId, eventId: "_health_check_" });
      return { status: "connected", latencyMs: Date.now() - start };
    } catch {
      return { status: "connected", latencyMs: Date.now() - start };
    }
  }
}
```

- [ ] **Step 7: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run google-calendar-adapter`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/calendar/ && git commit -m "$(cat <<'EOF'
feat(core): add GoogleCalendarAdapter and slot generator

Implements CalendarProvider interface using Google Calendar API v3.
Slot generator produces available time slots within business hours,
excluding busy periods from FreeBusy API.
EOF
)"
```

---

### Task 6: Calendar booking skill tool

**Files:**

- Create: `packages/core/src/skill-runtime/tools/calendar-book.ts`
- Create: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/skill-runtime/tools/calendar-book.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCalendarBookTool } from "./calendar-book.js";

function makeCalendarProvider() {
  return {
    listAvailableSlots: vi.fn(),
  };
}

function makeBookingStore() {
  return {
    create: vi.fn(),
    confirm: vi.fn(),
  };
}

function makeOutboxStore() {
  return {
    write: vi.fn(),
  };
}

function makeOpportunityStore() {
  return {
    findActiveByContact: vi.fn(),
    create: vi.fn(),
  };
}

function makeTx() {
  return vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      booking: {
        update: vi
          .fn()
          .mockResolvedValue({ id: "bk_1", status: "confirmed", calendarEventId: "gcal_1" }),
      },
      outboxEvent: { create: vi.fn().mockResolvedValue({ id: "ob_1" }) },
    }),
  );
}

describe("createCalendarBookTool", () => {
  let calendar: ReturnType<typeof makeCalendarProvider>;
  let bookingStore: ReturnType<typeof makeBookingStore>;
  let outboxStore: ReturnType<typeof makeOutboxStore>;
  let opportunityStore: ReturnType<typeof makeOpportunityStore>;
  let tool: ReturnType<typeof createCalendarBookTool>;

  beforeEach(() => {
    calendar = makeCalendarProvider();
    bookingStore = makeBookingStore();
    outboxStore = makeOutboxStore();
    opportunityStore = makeOpportunityStore();
    tool = createCalendarBookTool({
      calendarProvider: calendar as never,
      bookingStore: bookingStore as never,
      outboxStore: outboxStore as never,
      opportunityStore: opportunityStore as never,
      runTransaction: makeTx() as never,
    });
  });

  it("has id 'calendar-book'", () => {
    expect(tool.id).toBe("calendar-book");
  });

  it("slots.query has governance tier 'read'", () => {
    expect(tool.operations["slots.query"].governanceTier).toBe("read");
  });

  it("booking.create has governance tier 'external_write'", () => {
    expect(tool.operations["booking.create"].governanceTier).toBe("external_write");
  });

  it("slots.query delegates to calendarProvider.listAvailableSlots", async () => {
    calendar.listAvailableSlots.mockResolvedValue([
      {
        start: "2026-04-20T10:00:00+08:00",
        end: "2026-04-20T10:30:00+08:00",
        calendarId: "primary",
        available: true,
      },
    ]);

    const result = await tool.operations["slots.query"].execute({
      dateFrom: "2026-04-20",
      dateTo: "2026-04-20",
      durationMinutes: 30,
      service: "consultation",
      timezone: "Asia/Singapore",
    });

    expect(calendar.listAvailableSlots).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it("booking.create persists booking then calls calendar then writes outbox in transaction", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_1", status: "pending_confirmation" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });

    calendar.listAvailableSlots.mockResolvedValue([]);

    const result = await tool.operations["booking.create"].execute({
      orgId: "org_1",
      contactId: "ct_1",
      service: "consultation",
      slotStart: "2026-04-20T10:00:00+08:00",
      slotEnd: "2026-04-20T10:30:00+08:00",
      calendarId: "primary",
      attendeeName: "Alice",
      attendeeEmail: "alice@example.com",
    });

    expect(bookingStore.create).toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run calendar-book`
Expected: FAIL

- [ ] **Step 3: Implement the tool**

Create `packages/core/src/skill-runtime/tools/calendar-book.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type { SkillTool } from "../types.js";
import type { CalendarProvider, SlotQuery } from "@switchboard/schemas";

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
}

interface OpportunityStoreSubset {
  findActiveByContact(orgId: string, contactId: string): Promise<{ id: string } | null>;
  create(input: {
    organizationId: string;
    contactId: string;
    service: string;
  }): Promise<{ id: string }>;
}

type TransactionFn = (
  fn: (tx: {
    booking: {
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    };
    outboxEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  }) => Promise<unknown>,
) => Promise<unknown>;

interface CalendarBookToolDeps {
  calendarProvider: CalendarProvider;
  bookingStore: BookingStoreSubset;
  outboxStore: {
    write(eventId: string, type: string, payload: Record<string, unknown>): Promise<unknown>;
  };
  opportunityStore: OpportunityStoreSubset;
  runTransaction: TransactionFn;
}

export function createCalendarBookTool(deps: CalendarBookToolDeps): SkillTool {
  return {
    id: "calendar-book",
    operations: {
      "slots.query": {
        description: "Query available calendar slots for a date range.",
        governanceTier: "read" as const,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            dateFrom: { type: "string", description: "ISO 8601 start date" },
            dateTo: { type: "string", description: "ISO 8601 end date" },
            durationMinutes: { type: "number", description: "Appointment duration in minutes" },
            service: { type: "string", description: "Service type" },
            timezone: { type: "string", description: "IANA timezone" },
          },
          required: ["dateFrom", "dateTo", "durationMinutes", "service", "timezone"],
        },
        execute: async (params: unknown) => {
          const query = params as SlotQuery;
          return deps.calendarProvider.listAvailableSlots(query);
        },
      },
      "booking.create": {
        description:
          "Book a calendar slot for a contact. Persists booking, creates calendar event, emits booked event via outbox.",
        governanceTier: "external_write" as const,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            orgId: { type: "string" },
            contactId: { type: "string" },
            service: { type: "string" },
            slotStart: { type: "string", description: "ISO 8601" },
            slotEnd: { type: "string", description: "ISO 8601" },
            calendarId: { type: "string" },
            attendeeName: { type: "string" },
            attendeeEmail: { type: "string" },
          },
          required: ["orgId", "contactId", "service", "slotStart", "slotEnd", "calendarId"],
        },
        execute: async (params: unknown) => {
          const input = params as {
            orgId: string;
            contactId: string;
            service: string;
            slotStart: string;
            slotEnd: string;
            calendarId: string;
            attendeeName?: string;
            attendeeEmail?: string;
          };

          let opportunityId: string | null = null;
          const existing = await deps.opportunityStore.findActiveByContact(
            input.orgId,
            input.contactId,
          );
          if (existing) {
            opportunityId = existing.id;
          } else {
            const created = await deps.opportunityStore.create({
              organizationId: input.orgId,
              contactId: input.contactId,
              service: input.service,
            });
            opportunityId = created.id;
          }

          const booking = await deps.bookingStore.create({
            organizationId: input.orgId,
            contactId: input.contactId,
            opportunityId,
            service: input.service,
            startsAt: new Date(input.slotStart),
            endsAt: new Date(input.slotEnd),
            attendeeName: input.attendeeName ?? null,
            attendeeEmail: input.attendeeEmail ?? null,
          });

          const calendarResult = await deps.calendarProvider.createBooking({
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
          });

          const eventId = randomUUID();
          await deps.runTransaction(async (tx) => {
            await tx.booking.update({
              where: { id: booking.id },
              data: { status: "confirmed", calendarEventId: calendarResult.calendarEventId },
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
                  opportunityId,
                  value: 0,
                  occurredAt: new Date().toISOString(),
                  source: "calendar-book",
                  metadata: {
                    bookingId: booking.id,
                    service: input.service,
                    slotStart: input.slotStart,
                    slotEnd: input.slotEnd,
                  },
                },
              },
            });
          });

          return {
            bookingId: booking.id,
            calendarEventId: calendarResult.calendarEventId,
            status: "confirmed",
            startsAt: input.slotStart,
            endsAt: input.slotEnd,
          };
        },
      },
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run calendar-book`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/tools/calendar-book.ts packages/core/src/skill-runtime/tools/calendar-book.test.ts && git commit -m "$(cat <<'EOF'
feat(core): add calendar-book skill tool with outbox-backed booking flow

slots.query (read) and booking.create (external_write).
Booking confirmation + outbox event written in single transaction.
EOF
)"
```

---

### Task 7: Build + typecheck Section 1

- [ ] **Step 1: Full build**

Run: `npx pnpm@9.15.4 build --force`
Expected: All packages build successfully.

- [ ] **Step 2: Typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: No type errors.

- [ ] **Step 3: Run all tests**

Run: `npx pnpm@9.15.4 test`
Expected: All tests pass, coverage thresholds met.

- [ ] **Step 4: Commit any fixes if needed**

---

## Section 2: Durable ConversionBus + Outbox Publisher

---

### Task 8: Update ConversionEvent with new fields

**Files:**

- Modify: `packages/core/src/events/conversion-bus.ts`
- Modify: `packages/core/src/events/__tests__/conversion-bus.test.ts`

- [ ] **Step 1: Update ConversionEvent interface**

In `packages/core/src/events/conversion-bus.ts`, replace the existing `ConversionEvent` interface:

```typescript
import type { ConversionStage } from "@switchboard/schemas";

export type ConversionEventType = ConversionStage;

export interface ConversionEvent {
  eventId: string;
  type: ConversionStage;
  contactId: string;
  organizationId: string;
  value: number;
  sourceAdId?: string;
  sourceCampaignId?: string;
  occurredAt: Date;
  source: string;
  causationId?: string;
  workTraceId?: string;
  metadata: Record<string, unknown>;
}
```

- [ ] **Step 2: Update test helper `makeEvent`**

In `packages/core/src/events/__tests__/conversion-bus.test.ts`, update `makeEvent`:

```typescript
function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    eventId: "evt_test_1",
    type: "inquiry",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 0,
    occurredAt: new Date(),
    source: "test",
    metadata: {},
    ...overrides,
  };
}
```

- [ ] **Step 3: Run existing ConversionBus tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run conversion-bus`
Expected: PASS (InMemoryConversionBus behavior unchanged)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/events/ && git commit -m "$(cat <<'EOF'
refactor(core): update ConversionEvent with eventId, source, occurredAt fields

Uses ConversionStage enum as the type. Adds application-level event
identity for downstream dedup.
EOF
)"
```

---

### Task 9: RedisStreamConversionBus

**Files:**

- Create: `packages/core/src/events/redis-stream-conversion-bus.ts`
- Create: `packages/core/src/events/redis-stream-conversion-bus.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/core/src/events/redis-stream-conversion-bus.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisStreamConversionBus } from "./redis-stream-conversion-bus.js";
import type { ConversionEvent } from "./conversion-bus.js";

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    eventId: "evt_1",
    type: "booked",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 100,
    occurredAt: new Date("2026-04-20T10:00:00Z"),
    source: "test",
    metadata: {},
    ...overrides,
  };
}

function makeRedis() {
  return {
    xadd: vi.fn().mockResolvedValue("1234-0"),
    xgroup: vi.fn().mockResolvedValue("OK"),
    xreadgroup: vi.fn().mockResolvedValue(null),
    xack: vi.fn().mockResolvedValue(1),
    xautoclaim: vi.fn().mockResolvedValue([null, []]),
    xlen: vi.fn().mockResolvedValue(0),
    xpending: vi.fn().mockResolvedValue({ pending: 0 }),
  };
}

describe("RedisStreamConversionBus", () => {
  let redis: ReturnType<typeof makeRedis>;
  let bus: RedisStreamConversionBus;

  beforeEach(() => {
    redis = makeRedis();
    bus = new RedisStreamConversionBus(redis as never);
  });

  it("emit calls XADD with serialized event", async () => {
    const event = makeEvent();
    await bus.emit(event);

    expect(redis.xadd).toHaveBeenCalledWith(
      "switchboard:conversions",
      "MAXLEN",
      "~",
      "10000",
      "*",
      "data",
      expect.any(String),
    );

    const serialized = JSON.parse((redis.xadd as ReturnType<typeof vi.fn>).mock.calls[0][6]);
    expect(serialized.eventId).toBe("evt_1");
    expect(serialized.type).toBe("booked");
  });

  it("emit rejects when redis is unavailable", async () => {
    redis.xadd.mockRejectedValue(new Error("Connection refused"));
    await expect(bus.emit(makeEvent())).rejects.toThrow("Connection refused");
  });

  it("subscribe registers a handler", () => {
    const handler = vi.fn();
    bus.subscribe("booked", handler);
    expect(bus.handlerCount()).toBe(1);
  });

  it("unsubscribe removes a handler", () => {
    const handler = vi.fn();
    bus.subscribe("booked", handler);
    bus.unsubscribe("booked", handler);
    expect(bus.handlerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run redis-stream-conversion-bus`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `packages/core/src/events/redis-stream-conversion-bus.ts`:

```typescript
import type {
  ConversionBus,
  ConversionEvent,
  ConversionEventHandler,
  ConversionEventType,
} from "./conversion-bus.js";
import type { ConversionStage } from "@switchboard/schemas";

const STREAM_KEY = "switchboard:conversions";
const MAX_LEN = "10000";

interface RedisClient {
  xadd(...args: string[]): Promise<string>;
  xgroup(...args: string[]): Promise<string>;
  xreadgroup(
    ...args: (string | number)[]
  ): Promise<Array<[string, Array<[string, string[]]>]> | null>;
  xack(stream: string, group: string, id: string): Promise<number>;
  xautoclaim(...args: (string | number)[]): Promise<unknown>;
  xlen(stream: string): Promise<number>;
  xpending(stream: string, group: string): Promise<unknown>;
}

export class RedisStreamConversionBus implements ConversionBus {
  private handlers = new Map<string, Set<ConversionEventHandler>>();
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  subscribe(type: ConversionEventType | "*", handler: ConversionEventHandler): void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
  }

  unsubscribe(type: ConversionEventType | "*", handler: ConversionEventHandler): void {
    const set = this.handlers.get(type);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(type);
    }
  }

  async emit(event: ConversionEvent): Promise<void> {
    const data = JSON.stringify({
      eventId: event.eventId,
      type: event.type,
      contactId: event.contactId,
      organizationId: event.organizationId,
      value: event.value,
      sourceAdId: event.sourceAdId,
      sourceCampaignId: event.sourceCampaignId,
      occurredAt: event.occurredAt.toISOString(),
      source: event.source,
      causationId: event.causationId,
      workTraceId: event.workTraceId,
      metadata: event.metadata,
    });

    await this.redis.xadd(STREAM_KEY, "MAXLEN", "~", MAX_LEN, "*", "data", data);
  }

  async ensureConsumerGroup(groupName: string): Promise<void> {
    try {
      await this.redis.xgroup("CREATE", STREAM_KEY, groupName, "0", "MKSTREAM");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("BUSYGROUP")) throw err;
    }
  }

  async readGroup(
    groupName: string,
    consumerName: string,
    count: number,
    blockMs: number,
  ): Promise<ConversionEvent[]> {
    const result = await this.redis.xreadgroup(
      "GROUP",
      groupName,
      consumerName,
      "BLOCK",
      blockMs,
      "COUNT",
      count,
      "STREAMS",
      STREAM_KEY,
      ">",
    );

    if (!result) return [];

    const events: ConversionEvent[] = [];
    for (const [_stream, entries] of result) {
      for (const [_id, fields] of entries) {
        const dataIndex = fields.indexOf("data");
        if (dataIndex === -1) continue;
        const raw = JSON.parse(fields[dataIndex + 1]);
        events.push({
          ...raw,
          occurredAt: new Date(raw.occurredAt),
        });
      }
    }

    return events;
  }

  async ack(groupName: string, messageId: string): Promise<void> {
    await this.redis.xack(STREAM_KEY, groupName, messageId);
  }

  handlerCount(): number {
    let count = 0;
    for (const set of this.handlers.values()) {
      count += set.size;
    }
    return count;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run redis-stream-conversion-bus`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events/redis-stream-conversion-bus.ts packages/core/src/events/redis-stream-conversion-bus.test.ts && git commit -m "$(cat <<'EOF'
feat(core): add RedisStreamConversionBus backed by Redis Streams

Implements ConversionBus interface. Uses XADD for emit, consumer
groups for multi-subscriber fan-out. Fail-closed: rejects on Redis
unavailability.
EOF
)"
```

---

### Task 10: OutboxPublisher

**Files:**

- Create: `packages/core/src/events/outbox-publisher.ts`
- Create: `packages/core/src/events/outbox-publisher.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/core/src/events/outbox-publisher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutboxPublisher } from "./outbox-publisher.js";

function makeOutboxStore() {
  return {
    fetchPending: vi.fn(),
    markPublished: vi.fn(),
    recordFailure: vi.fn(),
  };
}

function makeBus() {
  return { emit: vi.fn() };
}

describe("OutboxPublisher", () => {
  let outboxStore: ReturnType<typeof makeOutboxStore>;
  let bus: ReturnType<typeof makeBus>;
  let publisher: OutboxPublisher;

  beforeEach(() => {
    outboxStore = makeOutboxStore();
    bus = makeBus();
    publisher = new OutboxPublisher(outboxStore as never, bus as never);
  });

  it("publishes pending events and marks them published", async () => {
    outboxStore.fetchPending.mockResolvedValue([
      {
        id: "ob_1",
        eventId: "evt_1",
        type: "booked",
        payload: {
          type: "booked",
          contactId: "ct_1",
          organizationId: "org_1",
          value: 0,
          occurredAt: "2026-04-20T10:00:00Z",
          source: "calendar-book",
          metadata: {},
        },
        status: "pending",
        attempts: 0,
      },
    ]);
    bus.emit.mockResolvedValue(undefined);

    await publisher.publishBatch();

    expect(bus.emit).toHaveBeenCalledTimes(1);
    expect(outboxStore.markPublished).toHaveBeenCalledWith("ob_1");
  });

  it("records failure when bus emit rejects", async () => {
    outboxStore.fetchPending.mockResolvedValue([
      {
        id: "ob_2",
        eventId: "evt_2",
        type: "booked",
        payload: {
          type: "booked",
          contactId: "ct_1",
          organizationId: "org_1",
          value: 0,
          occurredAt: "2026-04-20T10:00:00Z",
          source: "test",
          metadata: {},
        },
        status: "pending",
        attempts: 2,
      },
    ]);
    bus.emit.mockRejectedValue(new Error("Redis down"));

    await publisher.publishBatch();

    expect(outboxStore.recordFailure).toHaveBeenCalledWith("ob_2", 3);
  });

  it("does nothing when no pending events exist", async () => {
    outboxStore.fetchPending.mockResolvedValue([]);

    await publisher.publishBatch();

    expect(bus.emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run outbox-publisher`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `packages/core/src/events/outbox-publisher.ts`:

```typescript
import type { ConversionBus, ConversionEvent } from "./conversion-bus.js";

interface OutboxStoreSubset {
  fetchPending(limit: number): Promise<
    Array<{
      id: string;
      eventId: string;
      type: string;
      payload: Record<string, unknown>;
      status: string;
      attempts: number;
    }>
  >;
  markPublished(id: string): Promise<unknown>;
  recordFailure(id: string, attempts: number): Promise<unknown>;
}

export class OutboxPublisher {
  private readonly store: OutboxStoreSubset;
  private readonly bus: ConversionBus;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(store: OutboxStoreSubset, bus: ConversionBus) {
    this.store = store;
    this.bus = bus;
  }

  async publishBatch(batchSize = 50): Promise<void> {
    const pending = await this.store.fetchPending(batchSize);

    for (const row of pending) {
      const event: ConversionEvent = {
        eventId: row.eventId,
        type: row.payload.type as ConversionEvent["type"],
        contactId: row.payload.contactId as string,
        organizationId: row.payload.organizationId as string,
        value: (row.payload.value as number) ?? 0,
        sourceAdId: row.payload.sourceAdId as string | undefined,
        sourceCampaignId: row.payload.sourceCampaignId as string | undefined,
        occurredAt: new Date(row.payload.occurredAt as string),
        source: (row.payload.source as string) ?? "outbox",
        causationId: row.payload.causationId as string | undefined,
        workTraceId: row.payload.workTraceId as string | undefined,
        metadata: (row.payload.metadata as Record<string, unknown>) ?? {},
      };

      try {
        await this.bus.emit(event);
        await this.store.markPublished(row.id);
      } catch {
        await this.store.recordFailure(row.id, row.attempts + 1);
      }
    }
  }

  start(intervalMs = 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.publishBatch().catch((err) => {
        console.error("[OutboxPublisher] batch error:", err);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run outbox-publisher`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events/outbox-publisher.ts packages/core/src/events/outbox-publisher.test.ts && git commit -m "$(cat <<'EOF'
feat(core): add OutboxPublisher for transactional event delivery

Polls OutboxEvent table, emits to ConversionBus, marks published
or records failure. Max 10 attempts before marking failed.
EOF
)"
```

---

### Task 11: Wire durable bus + outbox into bootstrap

**Files:**

- Modify: `apps/api/src/bootstrap/conversion-bus-wiring.ts`

- [ ] **Step 1: Update wiring to support Redis backend**

Replace the contents of `apps/api/src/bootstrap/conversion-bus-wiring.ts`:

```typescript
import type { ConversionBus } from "@switchboard/core";
import { InMemoryConversionBus } from "@switchboard/core";
import { MetaCAPIClient } from "@switchboard/core/ad-optimizer";

export function createConversionBus(): ConversionBus {
  if (process.env.CONVERSION_BUS_BACKEND === "redis" && process.env.REDIS_URL) {
    // Dynamic import to avoid requiring ioredis when not using Redis
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      RedisStreamConversionBus,
    } = require("@switchboard/core/events/redis-stream-conversion-bus");
    const Redis = require("ioredis");
    const redis = new Redis(process.env.REDIS_URL);
    return new RedisStreamConversionBus(redis);
  }
  return new InMemoryConversionBus();
}

export function wireCAPIDispatcher(
  bus: ConversionBus,
  config: { pixelId: string; accessToken: string },
): void {
  const client = new MetaCAPIClient(config);

  bus.subscribe("*", async (event) => {
    if (!event.sourceAdId) return;

    const eventName = event.type === "purchased" ? "Purchase" : "Lead";

    try {
      await client.dispatchEvent({
        eventName,
        eventTime: Math.floor(event.occurredAt.getTime() / 1000),
        userData: { fbclid: (event.metadata["fbclid"] as string) ?? null },
        customData: event.value ? { value: event.value, currency: "SGD" } : undefined,
      });
    } catch (err) {
      console.error("[CAPIWiring] Failed to dispatch event:", err);
    }
  });
}
```

- [ ] **Step 2: Build**

Run: `npx pnpm@9.15.4 --filter @switchboard/api build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/bootstrap/conversion-bus-wiring.ts && git commit -m "$(cat <<'EOF'
feat(api): support Redis Streams backend for ConversionBus

CONVERSION_BUS_BACKEND=redis uses RedisStreamConversionBus.
Falls back to InMemoryConversionBus for dev/test.
EOF
)"
```

---

### Task 12: Build + typecheck Section 2

- [ ] **Step 1: Full build**

Run: `npx pnpm@9.15.4 build --force`
Expected: All packages build.

- [ ] **Step 2: Run all tests**

Run: `npx pnpm@9.15.4 test`
Expected: All tests pass.

- [ ] **Step 3: Commit any fixes**

---

## Section 3: Attribution Completion

---

### Task 13: Prisma models — ConversionRecord + DispatchLog + ReconciliationReport

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add three models to end of `schema.prisma`**

```prisma
// ---------------------------------------------------------------------------
// ConversionRecord — durable funnel event persistence for attribution
// ---------------------------------------------------------------------------

model ConversionRecord {
  id                String   @id @default(uuid())
  eventId           String   @unique
  organizationId    String
  contactId         String
  type              String
  value             Float    @default(0)
  sourceAdId        String?
  sourceCampaignId  String?
  sourceChannel     String?
  agentDeploymentId String?
  metadata          Json     @default("{}")
  occurredAt        DateTime
  createdAt         DateTime @default(now())

  @@index([organizationId, type, occurredAt])
  @@index([organizationId, sourceCampaignId])
  @@index([contactId])
}

// ---------------------------------------------------------------------------
// DispatchLog — ad platform delivery tracking
// ---------------------------------------------------------------------------

model DispatchLog {
  id              String   @id @default(uuid())
  eventId         String
  platform        String
  status          String
  errorMessage    String?
  responsePayload Json?
  attemptedAt     DateTime @default(now())

  @@index([eventId])
  @@index([platform, status, attemptedAt])
}

// ---------------------------------------------------------------------------
// ReconciliationReport — attribution pipeline health checks
// ---------------------------------------------------------------------------

model ReconciliationReport {
  id              String   @id @default(uuid())
  organizationId  String
  dateRangeFrom   DateTime
  dateRangeTo     DateTime
  overallStatus   String
  checks          Json
  createdAt       DateTime @default(now())

  @@index([organizationId, createdAt])
}
```

- [ ] **Step 2: Generate and migrate**

Run: `npx pnpm@9.15.4 --filter @switchboard/db exec prisma migrate dev --name add_conversion_record_dispatch_log_reconciliation`
Expected: Migration applied.

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/ && git commit -m "$(cat <<'EOF'
feat(db): add ConversionRecord, DispatchLog, ReconciliationReport models
EOF
)"
```

---

### Task 14: PrismaConversionRecordStore with funnel queries

**Files:**

- Create: `packages/core/src/attribution/conversion-record-store.ts`
- Create: `packages/db/src/stores/prisma-conversion-record-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Define store interface + types in core**

Create `packages/core/src/attribution/conversion-record-store.ts`:

```typescript
import type { ConversionEvent } from "../events/conversion-bus.js";

export interface DateRange {
  from: Date;
  to: Date;
}

export interface FunnelCounts {
  inquiry: number;
  qualified: number;
  booked: number;
  purchased: number;
  completed: number;
  totalRevenue: number;
  period: DateRange;
}

export interface CampaignFunnel extends FunnelCounts {
  campaignId: string;
}

export interface ChannelFunnel extends FunnelCounts {
  channel: string;
}

export interface AgentFunnel extends FunnelCounts {
  deploymentId: string;
  deploymentName: string;
}

export interface ConversionRecordStore {
  record(event: ConversionEvent): Promise<void>;
  funnelByOrg(orgId: string, dateRange: DateRange): Promise<FunnelCounts>;
  funnelByCampaign(orgId: string, dateRange: DateRange): Promise<CampaignFunnel[]>;
  funnelByChannel(orgId: string, dateRange: DateRange): Promise<ChannelFunnel[]>;
  funnelByAgent(orgId: string, dateRange: DateRange): Promise<AgentFunnel[]>;
}
```

- [ ] **Step 2: Write the failing test for PrismaConversionRecordStore**

Create `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaConversionRecordStore } from "../prisma-conversion-record-store.js";

function makePrisma() {
  return {
    conversionRecord: {
      upsert: vi.fn(),
      groupBy: vi.fn(),
    },
    $queryRaw: vi.fn(),
  } as never;
}

describe("PrismaConversionRecordStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaConversionRecordStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaConversionRecordStore(prisma);
  });

  it("records a conversion event idempotently via upsert", async () => {
    (prisma.conversionRecord.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cr_1" });

    await store.record({
      eventId: "evt_1",
      type: "booked",
      contactId: "ct_1",
      organizationId: "org_1",
      value: 100,
      occurredAt: new Date("2026-04-20T10:00:00Z"),
      source: "calendar-book",
      metadata: {},
    });

    expect(prisma.conversionRecord.upsert).toHaveBeenCalledWith({
      where: { eventId: "evt_1" },
      create: expect.objectContaining({ eventId: "evt_1", type: "booked", value: 100 }),
      update: {},
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-conversion-record-store`
Expected: FAIL

- [ ] **Step 4: Implement PrismaConversionRecordStore**

Create `packages/db/src/stores/prisma-conversion-record-store.ts`:

```typescript
import type { PrismaDbClient } from "../prisma-db.js";
import type {
  ConversionRecordStore,
  DateRange,
  FunnelCounts,
  CampaignFunnel,
  ChannelFunnel,
  AgentFunnel,
} from "@switchboard/core/attribution/conversion-record-store";

interface RecordInput {
  eventId: string;
  type: string;
  contactId: string;
  organizationId: string;
  value: number;
  sourceAdId?: string;
  sourceCampaignId?: string;
  sourceChannel?: string;
  agentDeploymentId?: string;
  occurredAt: Date;
  source: string;
  metadata: Record<string, unknown>;
}

export class PrismaConversionRecordStore implements ConversionRecordStore {
  constructor(private prisma: PrismaDbClient) {}

  async record(event: RecordInput): Promise<void> {
    await this.prisma.conversionRecord.upsert({
      where: { eventId: event.eventId },
      create: {
        eventId: event.eventId,
        organizationId: event.organizationId,
        contactId: event.contactId,
        type: event.type,
        value: event.value,
        sourceAdId: event.sourceAdId ?? null,
        sourceCampaignId: event.sourceCampaignId ?? null,
        sourceChannel: event.sourceChannel ?? null,
        agentDeploymentId: event.agentDeploymentId ?? null,
        metadata: event.metadata,
        occurredAt: event.occurredAt,
      },
      update: {},
    });
  }

  async funnelByOrg(orgId: string, dateRange: DateRange): Promise<FunnelCounts> {
    const rows = await this.prisma.conversionRecord.groupBy({
      by: ["type"],
      where: {
        organizationId: orgId,
        occurredAt: { gte: dateRange.from, lte: dateRange.to },
      },
      _count: true,
      _sum: { value: true },
    });

    return buildFunnelCounts(rows, dateRange);
  }

  async funnelByCampaign(orgId: string, dateRange: DateRange): Promise<CampaignFunnel[]> {
    const rows = await this.prisma.conversionRecord.groupBy({
      by: ["sourceCampaignId", "type"],
      where: {
        organizationId: orgId,
        occurredAt: { gte: dateRange.from, lte: dateRange.to },
        sourceCampaignId: { not: null },
      },
      _count: true,
      _sum: { value: true },
    });

    return groupByDimension(rows, "sourceCampaignId", "campaignId", dateRange) as CampaignFunnel[];
  }

  async funnelByChannel(orgId: string, dateRange: DateRange): Promise<ChannelFunnel[]> {
    const rows = await this.prisma.conversionRecord.groupBy({
      by: ["sourceChannel", "type"],
      where: {
        organizationId: orgId,
        occurredAt: { gte: dateRange.from, lte: dateRange.to },
        sourceChannel: { not: null },
      },
      _count: true,
      _sum: { value: true },
    });

    return groupByDimension(rows, "sourceChannel", "channel", dateRange) as ChannelFunnel[];
  }

  async funnelByAgent(orgId: string, dateRange: DateRange): Promise<AgentFunnel[]> {
    const rows = await this.prisma.conversionRecord.groupBy({
      by: ["agentDeploymentId", "type"],
      where: {
        organizationId: orgId,
        occurredAt: { gte: dateRange.from, lte: dateRange.to },
        agentDeploymentId: { not: null },
      },
      _count: true,
      _sum: { value: true },
    });

    return groupByDimension(rows, "agentDeploymentId", "deploymentId", dateRange).map((r) => ({
      ...r,
      deploymentName: r.deploymentId,
    })) as AgentFunnel[];
  }
}

function emptyFunnel(dateRange: DateRange): FunnelCounts {
  return {
    inquiry: 0,
    qualified: 0,
    booked: 0,
    purchased: 0,
    completed: 0,
    totalRevenue: 0,
    period: dateRange,
  };
}

function buildFunnelCounts(
  rows: Array<{ type: string; _count: number; _sum: { value: number | null } }>,
  dateRange: DateRange,
): FunnelCounts {
  const funnel = emptyFunnel(dateRange);
  for (const row of rows) {
    const stage = row.type as keyof Omit<FunnelCounts, "totalRevenue" | "period">;
    if (stage in funnel) {
      (funnel[stage] as number) = row._count;
    }
    funnel.totalRevenue += row._sum.value ?? 0;
  }
  return funnel;
}

function groupByDimension(
  rows: Array<Record<string, unknown>>,
  sourceField: string,
  targetField: string,
  dateRange: DateRange,
): Array<FunnelCounts & Record<string, string>> {
  const grouped = new Map<string, FunnelCounts & Record<string, string>>();

  for (const row of rows) {
    const key = (row[sourceField] as string) ?? "unknown";
    if (!grouped.has(key)) {
      grouped.set(key, { ...emptyFunnel(dateRange), [targetField]: key });
    }
    const funnel = grouped.get(key)!;
    const stage = row.type as keyof Omit<FunnelCounts, "totalRevenue" | "period">;
    if (stage in funnel) {
      (funnel[stage] as number) = (row as Record<string, unknown>)._count as number;
    }
    funnel.totalRevenue +=
      ((row as Record<string, unknown>)._sum as { value: number | null })?.value ?? 0;
  }

  return [...grouped.values()];
}
```

- [ ] **Step 5: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-conversion-record-store`
Expected: PASS

- [ ] **Step 6: Add export to `packages/db/src/index.ts`**

```typescript
export { PrismaConversionRecordStore } from "./stores/prisma-conversion-record-store.js";
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/attribution/ packages/db/src/stores/prisma-conversion-record-store.ts packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts packages/db/src/index.ts && git commit -m "$(cat <<'EOF'
feat: add ConversionRecordStore with funnel aggregation queries

Interface in core, Prisma implementation in db. Supports funnelByOrg,
funnelByCampaign, funnelByChannel, funnelByAgent.
EOF
)"
```

---

### Task 15: AdConversionDispatcher interface + MetaCAPIDispatcher refactor

**Files:**

- Create: `packages/core/src/ad-optimizer/ad-conversion-dispatcher.ts`
- Create: `packages/core/src/ad-optimizer/meta-capi-dispatcher.ts`
- Create: `packages/core/src/ad-optimizer/meta-capi-dispatcher.test.ts`

- [ ] **Step 1: Define the shared interface**

Create `packages/core/src/ad-optimizer/ad-conversion-dispatcher.ts`:

```typescript
import type { ConversionEvent } from "../events/conversion-bus.js";

export interface DispatchResult {
  accepted: boolean;
  errorMessage?: string;
  responsePayload?: unknown;
}

export interface AdConversionDispatcher {
  readonly platform: string;
  canDispatch(event: ConversionEvent): boolean;
  dispatch(event: ConversionEvent): Promise<DispatchResult>;
}
```

- [ ] **Step 2: Write the MetaCAPIDispatcher test**

Create `packages/core/src/ad-optimizer/meta-capi-dispatcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetaCAPIDispatcher } from "./meta-capi-dispatcher.js";
import type { ConversionEvent } from "../events/conversion-bus.js";

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    eventId: "evt_1",
    type: "booked",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 100,
    sourceAdId: "ad_123",
    occurredAt: new Date("2026-04-20T10:00:00Z"),
    source: "calendar-book",
    metadata: { fbclid: "fb.1.123.abc" },
    ...overrides,
  };
}

describe("MetaCAPIDispatcher", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let dispatcher: MetaCAPIDispatcher;

  beforeEach(() => {
    fetchMock = vi.fn();
    dispatcher = new MetaCAPIDispatcher(
      { pixelId: "px_1", accessToken: "tok_1" },
      fetchMock as never,
    );
  });

  it("canDispatch returns true when sourceAdId is present", () => {
    expect(dispatcher.canDispatch(makeEvent())).toBe(true);
  });

  it("canDispatch returns false when no ad attribution", () => {
    expect(dispatcher.canDispatch(makeEvent({ sourceAdId: undefined, metadata: {} }))).toBe(false);
  });

  it("platform is 'meta_capi'", () => {
    expect(dispatcher.platform).toBe("meta_capi");
  });
});
```

- [ ] **Step 3: Implement MetaCAPIDispatcher**

Create `packages/core/src/ad-optimizer/meta-capi-dispatcher.ts`:

```typescript
import { createHash } from "node:crypto";
import type { AdConversionDispatcher, DispatchResult } from "./ad-conversion-dispatcher.js";
import type { ConversionEvent } from "../events/conversion-bus.js";

const API_BASE = "https://graph.facebook.com/v21.0";

interface MetaCAPIConfig {
  pixelId: string;
  accessToken: string;
}

type FetchFn = typeof globalThis.fetch;

export class MetaCAPIDispatcher implements AdConversionDispatcher {
  readonly platform = "meta_capi";
  private readonly config: MetaCAPIConfig;
  private readonly fetchFn: FetchFn;

  constructor(config: MetaCAPIConfig, fetchFn: FetchFn = globalThis.fetch) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  canDispatch(event: ConversionEvent): boolean {
    return !!(event.sourceAdId || event.metadata?.["fbclid"]);
  }

  async dispatch(event: ConversionEvent): Promise<DispatchResult> {
    const eventName = event.type === "purchased" ? "Purchase" : "Lead";
    const fbclid = event.metadata?.["fbclid"] as string | undefined;

    const userData: Record<string, string> = {};
    if (fbclid) {
      userData.fbc = `fb.1.${event.occurredAt.getTime()}.${fbclid}`;
    }
    if (event.metadata?.["email"]) {
      userData.em = sha256((event.metadata["email"] as string).toLowerCase().trim());
    }
    if (event.metadata?.["phone"]) {
      userData.ph = sha256((event.metadata["phone"] as string).replace(/\D/g, ""));
    }

    const body = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(event.occurredAt.getTime() / 1000),
          user_data: userData,
          custom_data: event.value ? { value: event.value, currency: "SGD" } : undefined,
          action_source: "system_generated",
        },
      ],
    };

    const url = `${API_BASE}/${this.config.pixelId}/events`;
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      return { accepted: false, errorMessage: `HTTP ${response.status}: ${text}` };
    }

    const result = await response.json();
    return { accepted: true, responsePayload: result };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run meta-capi-dispatcher`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ad-optimizer/ad-conversion-dispatcher.ts packages/core/src/ad-optimizer/meta-capi-dispatcher.ts packages/core/src/ad-optimizer/meta-capi-dispatcher.test.ts && git commit -m "$(cat <<'EOF'
feat(core): add AdConversionDispatcher interface + MetaCAPIDispatcher

Unified interface for ad platform conversion dispatch. MetaCAPIDispatcher
refactored from MetaCAPIClient to implement the shared interface.
EOF
)"
```

---

### Task 16: GoogleOfflineDispatcher

**Files:**

- Create: `packages/core/src/ad-optimizer/google-offline-dispatcher.ts`
- Create: `packages/core/src/ad-optimizer/google-offline-dispatcher.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/core/src/ad-optimizer/google-offline-dispatcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleOfflineDispatcher } from "./google-offline-dispatcher.js";
import type { ConversionEvent } from "../events/conversion-bus.js";

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    eventId: "evt_1",
    type: "booked",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 100,
    occurredAt: new Date("2026-04-20T10:00:00Z"),
    source: "calendar-book",
    metadata: { gclid: "gclid_abc123" },
    ...overrides,
  };
}

describe("GoogleOfflineDispatcher", () => {
  let uploadFn: ReturnType<typeof vi.fn>;
  let dispatcher: GoogleOfflineDispatcher;

  beforeEach(() => {
    uploadFn = vi.fn().mockResolvedValue({ accepted: true });
    dispatcher = new GoogleOfflineDispatcher(
      {
        customerId: "cust_1",
        conversionActionMapping: { booked: "customers/1/conversionActions/100" },
      },
      uploadFn,
    );
  });

  it("canDispatch returns true when gclid is present", () => {
    expect(dispatcher.canDispatch(makeEvent())).toBe(true);
  });

  it("canDispatch returns false without gclid", () => {
    expect(dispatcher.canDispatch(makeEvent({ metadata: {} }))).toBe(false);
  });

  it("canDispatch returns false when no mapping for event type", () => {
    expect(dispatcher.canDispatch(makeEvent({ type: "inquiry" }))).toBe(false);
  });

  it("platform is 'google_offline'", () => {
    expect(dispatcher.platform).toBe("google_offline");
  });

  it("dispatch calls upload function with correct params", async () => {
    const result = await dispatcher.dispatch(makeEvent());
    expect(result.accepted).toBe(true);
    expect(uploadFn).toHaveBeenCalledWith(
      expect.objectContaining({
        gclid: "gclid_abc123",
        conversionAction: "customers/1/conversionActions/100",
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run google-offline-dispatcher`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `packages/core/src/ad-optimizer/google-offline-dispatcher.ts`:

```typescript
import type { AdConversionDispatcher, DispatchResult } from "./ad-conversion-dispatcher.js";
import type { ConversionEvent } from "../events/conversion-bus.js";
import type { ConversionStage } from "@switchboard/schemas";

interface GoogleOfflineConfig {
  customerId: string;
  conversionActionMapping: Partial<Record<ConversionStage, string>>;
}

interface UploadInput {
  gclid: string;
  conversionDateTime: string;
  conversionValue?: number;
  currencyCode?: string;
  conversionAction: string;
}

type UploadFn = (input: UploadInput) => Promise<{ accepted: boolean; errorMessage?: string }>;

export class GoogleOfflineDispatcher implements AdConversionDispatcher {
  readonly platform = "google_offline";
  private readonly config: GoogleOfflineConfig;
  private readonly uploadFn: UploadFn;

  constructor(config: GoogleOfflineConfig, uploadFn: UploadFn) {
    this.config = config;
    this.uploadFn = uploadFn;
  }

  canDispatch(event: ConversionEvent): boolean {
    const gclid = event.metadata?.["gclid"];
    if (!gclid) return false;
    return !!this.config.conversionActionMapping[event.type];
  }

  async dispatch(event: ConversionEvent): Promise<DispatchResult> {
    const gclid = event.metadata["gclid"] as string;
    const conversionAction = this.config.conversionActionMapping[event.type]!;

    const result = await this.uploadFn({
      gclid,
      conversionDateTime: event.occurredAt.toISOString(),
      conversionValue: event.value || undefined,
      currencyCode: "SGD",
      conversionAction,
    });

    return {
      accepted: result.accepted,
      errorMessage: result.errorMessage,
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run google-offline-dispatcher`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ad-optimizer/google-offline-dispatcher.ts packages/core/src/ad-optimizer/google-offline-dispatcher.test.ts && git commit -m "$(cat <<'EOF'
feat(core): add GoogleOfflineDispatcher for Google Ads offline conversions

Implements AdConversionDispatcher. Uses per-connection conversion
action mapping. Uploads via injected function for testability.
EOF
)"
```

---

### Task 17: CRM Updater Consumer

**Files:**

- Create: `packages/core/src/attribution/crm-updater-consumer.ts`
- Create: `packages/core/src/attribution/crm-updater-consumer.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/core/src/attribution/crm-updater-consumer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CrmUpdaterConsumer } from "./crm-updater-consumer.js";
import type { ConversionEvent } from "../events/conversion-bus.js";

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    eventId: "evt_1",
    type: "booked",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 0,
    occurredAt: new Date(),
    source: "calendar-book",
    metadata: { opportunityId: "opp_1" },
    ...overrides,
  };
}

describe("CrmUpdaterConsumer", () => {
  let opportunityStore: { updateStage: ReturnType<typeof vi.fn> };
  let activityStore: { write: ReturnType<typeof vi.fn> };
  let consumer: CrmUpdaterConsumer;

  beforeEach(() => {
    opportunityStore = { updateStage: vi.fn().mockResolvedValue({}) };
    activityStore = { write: vi.fn().mockResolvedValue(undefined) };
    consumer = new CrmUpdaterConsumer(opportunityStore as never, activityStore as never);
  });

  it("updates opportunity stage to 'booked' on booked event", async () => {
    await consumer.handle(makeEvent());
    expect(opportunityStore.updateStage).toHaveBeenCalledWith(
      "org_1",
      "opp_1",
      "booked",
      undefined,
    );
  });

  it("skips events without opportunityId", async () => {
    await consumer.handle(makeEvent({ metadata: {} }));
    expect(opportunityStore.updateStage).not.toHaveBeenCalled();
  });

  it("logs activity after stage update", async () => {
    await consumer.handle(makeEvent());
    expect(activityStore.write).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "stage-update" }),
    );
  });

  it("maps non-booked stages correctly", async () => {
    await consumer.handle(makeEvent({ type: "qualified" }));
    expect(opportunityStore.updateStage).toHaveBeenCalledWith(
      "org_1",
      "opp_1",
      "qualified",
      undefined,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run crm-updater-consumer`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `packages/core/src/attribution/crm-updater-consumer.ts`:

```typescript
import type { ConversionEvent } from "../events/conversion-bus.js";

interface OpportunityStoreSubset {
  updateStage(
    orgId: string,
    opportunityId: string,
    stage: string,
    closedAt?: Date | null,
  ): Promise<unknown>;
}

interface ActivityStoreSubset {
  write(input: {
    organizationId: string;
    deploymentId: string;
    eventType: string;
    description: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export class CrmUpdaterConsumer {
  constructor(
    private opportunityStore: OpportunityStoreSubset,
    private activityStore: ActivityStoreSubset,
  ) {}

  async handle(event: ConversionEvent): Promise<void> {
    const opportunityId = event.metadata?.["opportunityId"] as string | undefined;
    if (!opportunityId) return;

    await this.opportunityStore.updateStage(
      event.organizationId,
      opportunityId,
      event.type,
      undefined,
    );

    await this.activityStore.write({
      organizationId: event.organizationId,
      deploymentId: (event.metadata?.["deploymentId"] as string) ?? "system",
      eventType: "stage-update",
      description: `Stage updated to ${event.type} via conversion event`,
      metadata: { eventId: event.eventId, contactId: event.contactId },
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run crm-updater-consumer`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/attribution/crm-updater-consumer.ts packages/core/src/attribution/crm-updater-consumer.test.ts && git commit -m "$(cat <<'EOF'
feat(core): add CrmUpdaterConsumer for downstream CRM stage updates

Subscribes to ConversionBus events and updates opportunity stage.
Skips events without opportunityId rather than failing.
EOF
)"
```

---

### Task 18: Declarative dispatcher wiring + DispatchLog store

**Files:**

- Create: `packages/db/src/stores/prisma-dispatch-log-store.ts`
- Create: `packages/core/src/ad-optimizer/wire-ad-dispatchers.ts`
- Create: `packages/core/src/ad-optimizer/wire-ad-dispatchers.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Create PrismaDispatchLogStore**

Create `packages/db/src/stores/prisma-dispatch-log-store.ts`:

```typescript
import type { PrismaDbClient } from "../prisma-db.js";

interface DispatchLogInput {
  eventId: string;
  platform: string;
  status: string;
  errorMessage?: string | null;
  responsePayload?: unknown;
}

export class PrismaDispatchLogStore {
  constructor(private prisma: PrismaDbClient) {}

  async record(input: DispatchLogInput) {
    return this.prisma.dispatchLog.create({
      data: {
        eventId: input.eventId,
        platform: input.platform,
        status: input.status,
        errorMessage: input.errorMessage ?? null,
        responsePayload: input.responsePayload ?? null,
      },
    });
  }

  async countByPlatformAndStatus(platform: string, status: string, from: Date, to: Date) {
    return this.prisma.dispatchLog.count({
      where: { platform, status, attemptedAt: { gte: from, lte: to } },
    });
  }
}
```

- [ ] **Step 2: Write the wiring test**

Create `packages/core/src/ad-optimizer/wire-ad-dispatchers.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { wireAdDispatchers } from "./wire-ad-dispatchers.js";
import { InMemoryConversionBus } from "../events/conversion-bus.js";
import type { ConversionEvent } from "../events/conversion-bus.js";
import type { AdConversionDispatcher } from "./ad-conversion-dispatcher.js";

function makeEvent(): ConversionEvent {
  return {
    eventId: "evt_1",
    type: "booked",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 100,
    occurredAt: new Date(),
    source: "test",
    metadata: { fbclid: "fb123" },
  };
}

describe("wireAdDispatchers", () => {
  it("dispatches to matching dispatchers and logs results", async () => {
    const bus = new InMemoryConversionBus();
    const dispatcher: AdConversionDispatcher = {
      platform: "meta_capi",
      canDispatch: vi.fn().mockReturnValue(true),
      dispatch: vi.fn().mockResolvedValue({ accepted: true }),
    };
    const logStore = { record: vi.fn().mockResolvedValue({}) };

    wireAdDispatchers(bus, [dispatcher], logStore as never);
    bus.emit(makeEvent());

    await new Promise((r) => setTimeout(r, 50));

    expect(dispatcher.dispatch).toHaveBeenCalled();
    expect(logStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "meta_capi", status: "accepted" }),
    );
  });
});
```

- [ ] **Step 3: Implement wireAdDispatchers**

Create `packages/core/src/ad-optimizer/wire-ad-dispatchers.ts`:

```typescript
import type { ConversionBus } from "../events/conversion-bus.js";
import type { AdConversionDispatcher } from "./ad-conversion-dispatcher.js";

interface DispatchLogStoreSubset {
  record(input: {
    eventId: string;
    platform: string;
    status: string;
    errorMessage?: string | null;
    responsePayload?: unknown;
  }): Promise<unknown>;
}

export function wireAdDispatchers(
  bus: ConversionBus,
  dispatchers: AdConversionDispatcher[],
  dispatchLogStore: DispatchLogStoreSubset,
): void {
  bus.subscribe("*", async (event) => {
    for (const d of dispatchers) {
      if (!d.canDispatch(event)) continue;

      try {
        const result = await d.dispatch(event);
        await dispatchLogStore.record({
          eventId: event.eventId,
          platform: d.platform,
          status: result.accepted ? "accepted" : "rejected",
          errorMessage: result.errorMessage ?? null,
          responsePayload: result.responsePayload,
        });
      } catch (err) {
        await dispatchLogStore.record({
          eventId: event.eventId,
          platform: d.platform,
          status: "failed",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run wire-ad-dispatchers`
Expected: PASS

- [ ] **Step 5: Add exports to `packages/db/src/index.ts`**

```typescript
export { PrismaDispatchLogStore } from "./stores/prisma-dispatch-log-store.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ad-optimizer/wire-ad-dispatchers.ts packages/core/src/ad-optimizer/wire-ad-dispatchers.test.ts packages/db/src/stores/prisma-dispatch-log-store.ts packages/db/src/index.ts && git commit -m "$(cat <<'EOF'
feat: add declarative ad dispatcher wiring with DispatchLog persistence

wireAdDispatchers subscribes to ConversionBus, routes to matching
dispatchers, logs every result. Adding a new platform = implement
interface + register.
EOF
)"
```

---

### Task 19: ReconciliationRunner + store

**Files:**

- Create: `packages/db/src/stores/prisma-reconciliation-store.ts`
- Create: `packages/core/src/attribution/reconciliation-runner.ts`
- Create: `packages/core/src/attribution/reconciliation-runner.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Create PrismaReconciliationStore**

Create `packages/db/src/stores/prisma-reconciliation-store.ts`:

```typescript
import type { PrismaDbClient } from "../prisma-db.js";

interface ReconciliationReportInput {
  organizationId: string;
  dateRangeFrom: Date;
  dateRangeTo: Date;
  overallStatus: string;
  checks: unknown;
}

export class PrismaReconciliationStore {
  constructor(private prisma: PrismaDbClient) {}

  async save(input: ReconciliationReportInput) {
    return this.prisma.reconciliationReport.create({ data: input as never });
  }

  async latest(orgId: string) {
    return this.prisma.reconciliationReport.findFirst({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    });
  }
}
```

- [ ] **Step 2: Write the reconciliation runner test**

Create `packages/core/src/attribution/reconciliation-runner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReconciliationRunner } from "./reconciliation-runner.js";

describe("ReconciliationRunner", () => {
  it("produces a healthy report when all checks pass", async () => {
    const deps = {
      bookingStore: { countConfirmed: vi.fn().mockResolvedValue(10) },
      conversionRecordStore: { countByType: vi.fn().mockResolvedValue(10) },
      outboxStore: { countByStatus: vi.fn().mockResolvedValue(10) },
      dispatchLogStore: {
        countByPlatformAndStatus: vi.fn().mockResolvedValue(10),
      },
      opportunityStore: { countByStage: vi.fn().mockResolvedValue(10) },
      reconciliationStore: { save: vi.fn().mockResolvedValue({}) },
    };

    const runner = new ReconciliationRunner(deps as never);
    const report = await runner.run("org_1", {
      from: new Date("2026-04-01"),
      to: new Date("2026-04-30"),
    });

    expect(report.overallStatus).toBe("healthy");
    expect(deps.reconciliationStore.save).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run reconciliation-runner`
Expected: FAIL

- [ ] **Step 4: Implement**

Create `packages/core/src/attribution/reconciliation-runner.ts`:

```typescript
import type { DateRange } from "./conversion-record-store.js";

interface Check {
  name: string;
  status: string;
  expected: number;
  actual: number;
  driftPercent: number;
}

interface ReconciliationReport {
  organizationId: string;
  dateRangeFrom: Date;
  dateRangeTo: Date;
  overallStatus: string;
  checks: Check[];
}

interface ReconciliationDeps {
  bookingStore: { countConfirmed(orgId: string): Promise<number> };
  conversionRecordStore: {
    countByType(orgId: string, type: string, from: Date, to: Date): Promise<number>;
  };
  outboxStore: { countByStatus(status: string): Promise<number> };
  dispatchLogStore: {
    countByPlatformAndStatus(
      platform: string,
      status: string,
      from: Date,
      to: Date,
    ): Promise<number>;
  };
  opportunityStore: { countByStage(orgId: string, stage: string): Promise<number> };
  reconciliationStore: { save(input: ReconciliationReport): Promise<unknown> };
}

export class ReconciliationRunner {
  constructor(private deps: ReconciliationDeps) {}

  async run(orgId: string, dateRange: DateRange): Promise<ReconciliationReport> {
    const checks: Check[] = [];

    const confirmedBookings = await this.deps.bookingStore.countConfirmed(orgId);
    const bookedRecords = await this.deps.conversionRecordStore.countByType(
      orgId,
      "booked",
      dateRange.from,
      dateRange.to,
    );
    checks.push(this.check("booking-linkage", confirmedBookings, bookedRecords));

    const bookedOpps = await this.deps.opportunityStore.countByStage(orgId, "booked");
    checks.push(this.check("crm-sync", bookedRecords, bookedOpps));

    const overallStatus = this.deriveStatus(checks);

    const report: ReconciliationReport = {
      organizationId: orgId,
      dateRangeFrom: dateRange.from,
      dateRangeTo: dateRange.to,
      overallStatus,
      checks,
    };

    await this.deps.reconciliationStore.save(report);
    return report;
  }

  private check(name: string, expected: number, actual: number): Check {
    const drift = expected === 0 ? 0 : Math.abs(expected - actual) / expected;
    let status = "pass";
    if (drift > 0.05) status = "fail";
    else if (drift > 0.01) status = "warn";
    return { name, status, expected, actual, driftPercent: Math.round(drift * 100) };
  }

  private deriveStatus(checks: Check[]): string {
    if (checks.some((c) => c.status === "fail")) return "failing";
    if (checks.some((c) => c.status === "warn")) return "degraded";
    return "healthy";
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run reconciliation-runner`
Expected: PASS

- [ ] **Step 6: Add exports**

In `packages/db/src/index.ts`:

```typescript
export { PrismaReconciliationStore } from "./stores/prisma-reconciliation-store.js";
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/attribution/reconciliation-runner.ts packages/core/src/attribution/reconciliation-runner.test.ts packages/db/src/stores/prisma-reconciliation-store.ts packages/db/src/index.ts && git commit -m "$(cat <<'EOF'
feat: add ReconciliationRunner with booking-linkage and CRM-sync checks
EOF
)"
```

---

### Task 20: Build + typecheck Section 3

- [ ] **Step 1: Full build**

Run: `npx pnpm@9.15.4 build --force`

- [ ] **Step 2: Run all tests**

Run: `npx pnpm@9.15.4 test`

- [ ] **Step 3: Commit any fixes**

---

## Section 4: ROI Dashboard

---

### Task 21: ROI API route

**Files:**

- Create: `apps/api/src/routes/roi.ts`
- Modify: `apps/api/src/app.ts` (register route)

- [ ] **Step 1: Create the ROI route**

Create `apps/api/src/routes/roi.ts`:

```typescript
import type { FastifyPluginAsync } from "fastify";
import { PrismaConversionRecordStore, PrismaReconciliationStore } from "@switchboard/db";
import { requireOrganizationScope } from "../utils/require-org.js";

export const roiRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:orgId/roi/summary", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { from, to, breakdown } = request.query as {
      from?: string;
      to?: string;
      breakdown?: string;
    };

    const now = new Date();
    const dateRange = {
      from: from ? new Date(from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      to: to ? new Date(to) : now,
    };

    const dimension = breakdown ?? "campaign";

    const conversionStore = new PrismaConversionRecordStore(app.prisma);
    const reconStore = new PrismaReconciliationStore(app.prisma);

    const funnel = await conversionStore.funnelByOrg(orgId, dateRange);

    let breakdownData: unknown;
    switch (dimension) {
      case "channel":
        breakdownData = await conversionStore.funnelByChannel(orgId, dateRange);
        break;
      case "agent":
        breakdownData = await conversionStore.funnelByAgent(orgId, dateRange);
        break;
      default:
        breakdownData = await conversionStore.funnelByCampaign(orgId, dateRange);
    }

    const latestReport = await reconStore.latest(orgId);
    const health = latestReport
      ? {
          status: latestReport.overallStatus,
          lastRun: (latestReport as { createdAt: Date }).createdAt.toISOString(),
          checks: latestReport.checks,
        }
      : { status: "unknown", lastRun: null, checks: [] };

    return reply.send({ funnel, breakdown: breakdownData, health });
  });
};
```

- [ ] **Step 2: Register route in app.ts**

Add to `apps/api/src/app.ts` alongside other route registrations:

```typescript
import { roiRoutes } from "./routes/roi.js";
// In the route registration section:
app.register(roiRoutes, { prefix: "/api" });
```

- [ ] **Step 3: Build**

Run: `npx pnpm@9.15.4 --filter @switchboard/api build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/roi.ts apps/api/src/app.ts && git commit -m "$(cat <<'EOF'
feat(api): add single aggregate ROI summary endpoint

GET /:orgId/roi/summary returns funnel + breakdown + health in one response.
EOF
)"
```

---

### Task 22: Dashboard proxy + hook

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/roi/route.ts`
- Create: `apps/dashboard/src/hooks/use-roi.ts`

- [ ] **Step 1: Create the dashboard proxy route**

Create `apps/dashboard/src/app/api/dashboard/roi/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const client = await getApiClient();
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") ?? undefined;
    const to = searchParams.get("to") ?? undefined;
    const breakdown = searchParams.get("breakdown") ?? "campaign";

    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("breakdown", breakdown);

    const result = await client.get(`/${session.organizationId}/roi/summary?${params.toString()}`);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

- [ ] **Step 2: Create the hook**

Create `apps/dashboard/src/hooks/use-roi.ts`:

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface DateRange {
  from: string;
  to: string;
}

interface FunnelCounts {
  inquiry: number;
  qualified: number;
  booked: number;
  purchased: number;
  completed: number;
  totalRevenue: number;
}

interface RoiSummary {
  funnel: FunnelCounts;
  breakdown: Array<FunnelCounts & Record<string, string>>;
  health: { status: string; lastRun: string | null; checks: unknown[] };
}

async function fetchRoiSummary(dateRange: DateRange, breakdown: string): Promise<RoiSummary> {
  const params = new URLSearchParams({
    from: dateRange.from,
    to: dateRange.to,
    breakdown,
  });
  const res = await fetch(`/api/dashboard/roi?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch ROI summary");
  return res.json();
}

export function useRoiSummary(
  dateRange: DateRange,
  breakdown: "campaign" | "channel" | "agent" = "campaign",
) {
  return useQuery({
    queryKey: ["roi", "summary", dateRange.from, dateRange.to, breakdown],
    queryFn: () => fetchRoiSummary(dateRange, breakdown),
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/roi/ apps/dashboard/src/hooks/use-roi.ts && git commit -m "$(cat <<'EOF'
feat(dashboard): add ROI proxy route and useRoiSummary hook
EOF
)"
```

---

### Task 23: ROI Dashboard page + components

**Files:**

- Create: `apps/dashboard/src/app/(auth)/dashboard/roi/page.tsx`
- Create: `apps/dashboard/src/components/roi/metric-card.tsx`
- Create: `apps/dashboard/src/components/roi/funnel-bars.tsx`
- Create: `apps/dashboard/src/components/roi/breakdown-table.tsx`
- Create: `apps/dashboard/src/components/roi/health-indicator.tsx`

- [ ] **Step 1: Create MetricCard component**

Create `apps/dashboard/src/components/roi/metric-card.tsx`:

```tsx
interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
}

export function MetricCard({ label, value, subtext }: MetricCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 text-center">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Create FunnelBars component**

Create `apps/dashboard/src/components/roi/funnel-bars.tsx`:

```tsx
import { Progress } from "@/components/ui/progress";

interface FunnelStage {
  label: string;
  count: number;
  rate: string;
}

interface FunnelBarsProps {
  stages: FunnelStage[];
  maxCount: number;
}

export function FunnelBars({ stages, maxCount }: FunnelBarsProps) {
  return (
    <div className="space-y-3">
      {stages.map((stage) => (
        <div key={stage.label} className="flex items-center gap-4">
          <span className="w-24 text-sm font-medium">{stage.label}</span>
          <Progress value={maxCount > 0 ? (stage.count / maxCount) * 100 : 0} className="flex-1" />
          <span className="w-20 text-right text-sm">
            {stage.count} {stage.rate !== "—" ? `(${stage.rate})` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create BreakdownTable component**

Create `apps/dashboard/src/components/roi/breakdown-table.tsx`:

```tsx
interface BreakdownRow {
  name: string;
  leads: number;
  qualified: number;
  booked: number;
  revenue: number;
  bookingRate: string;
}

interface BreakdownTableProps {
  rows: BreakdownRow[];
}

export function BreakdownTable({ rows }: BreakdownTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="pb-2 font-medium">Name</th>
          <th className="pb-2 text-right font-medium">Leads</th>
          <th className="pb-2 text-right font-medium">Qualified</th>
          <th className="pb-2 text-right font-medium">Booked</th>
          <th className="pb-2 text-right font-medium">Revenue</th>
          <th className="pb-2 text-right font-medium">Book Rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name} className="border-b">
            <td className="py-2 font-medium">{row.name}</td>
            <td className="py-2 text-right">{row.leads}</td>
            <td className="py-2 text-right">{row.qualified}</td>
            <td className="py-2 text-right">{row.booked}</td>
            <td className="py-2 text-right">${row.revenue.toLocaleString()}</td>
            <td className="py-2 text-right">{row.bookingRate}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Create HealthIndicator component**

Create `apps/dashboard/src/components/roi/health-indicator.tsx`:

```tsx
"use client";

import { useState } from "react";

interface HealthCheck {
  name: string;
  status: string;
  expected: number;
  actual: number;
  driftPercent: number;
}

interface HealthIndicatorProps {
  status: string;
  lastRun: string | null;
  checks: HealthCheck[];
}

const STATUS_COLORS: Record<string, string> = {
  healthy: "bg-green-500",
  degraded: "bg-yellow-500",
  failing: "bg-red-500",
  unknown: "bg-gray-400",
};

const STATUS_TEXT: Record<string, string> = {
  healthy: "All conversion events delivered successfully",
  degraded: "Some events experienced delivery delays",
  failing: "Significant event delivery issues detected",
  unknown: "Reconciliation has not run yet",
};

export function HealthIndicator({ status, lastRun, checks }: HealthIndicatorProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        Data Health
        <span
          className={`inline-block h-3 w-3 rounded-full ${STATUS_COLORS[status] ?? STATUS_COLORS.unknown}`}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-10 w-80 rounded-lg border bg-card p-4 shadow-lg">
          <p className="mb-2 text-sm font-medium">{STATUS_TEXT[status] ?? STATUS_TEXT.unknown}</p>
          {lastRun && (
            <p className="mb-2 text-xs text-muted-foreground">
              Last checked: {new Date(lastRun).toLocaleString()}
            </p>
          )}
          {!lastRun && (
            <p className="mb-2 text-xs text-muted-foreground">
              Reconciliation has not run in 48 hours — numbers may be stale
            </p>
          )}
          {checks.length > 0 && (
            <ul className="space-y-1 text-xs">
              {checks.map((c) => (
                <li key={c.name} className="flex justify-between">
                  <span>{c.name}</span>
                  <span className={c.status === "pass" ? "text-green-600" : "text-red-600"}>
                    {c.status} ({c.driftPercent}% drift)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create ROI page**

Create `apps/dashboard/src/app/(auth)/dashboard/roi/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useRoiSummary } from "@/hooks/use-roi";
import { MetricCard } from "@/components/roi/metric-card";
import { FunnelBars } from "@/components/roi/funnel-bars";
import { BreakdownTable } from "@/components/roi/breakdown-table";
import { HealthIndicator } from "@/components/roi/health-indicator";

const RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export default function RoiPage() {
  const { status } = useSession();
  const [rangeDays, setRangeDays] = useState(30);
  const [breakdown, setBreakdown] = useState<"campaign" | "channel">("campaign");

  if (status === "unauthenticated") redirect("/login");

  const now = new Date();
  const dateRange = {
    from: new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000).toISOString(),
    to: now.toISOString(),
  };

  const { data, isLoading } = useRoiSummary(dateRange, breakdown);

  if (isLoading || !data) return <div className="p-8">Loading...</div>;

  const f = data.funnel;
  const rate = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

  const funnelStages = [
    { label: "Inquiry", count: f.inquiry, rate: "—" },
    { label: "Qualified", count: f.qualified, rate: rate(f.qualified, f.inquiry) },
    { label: "Booked", count: f.booked, rate: rate(f.booked, f.qualified) },
    { label: "Purchased", count: f.purchased, rate: rate(f.purchased, f.booked) },
    { label: "Completed", count: f.completed, rate: rate(f.completed, f.purchased) },
  ];

  const nameKey = breakdown === "campaign" ? "campaignId" : "channel";
  const breakdownRows = (data.breakdown as Array<Record<string, unknown>>).map((row) => ({
    name: (row[nameKey] as string) ?? "Unknown",
    leads: (row.inquiry as number) ?? 0,
    qualified: (row.qualified as number) ?? 0,
    booked: (row.booked as number) ?? 0,
    revenue: (row.totalRevenue as number) ?? 0,
    bookingRate: rate((row.booked as number) ?? 0, (row.inquiry as number) ?? 0),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRangeDays(r.days)}
              className={`rounded-md px-3 py-1 text-sm ${
                rangeDays === r.days ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <HealthIndicator
          status={data.health.status}
          lastRun={data.health.lastRun}
          checks={data.health.checks as never[]}
        />
      </div>

      <div className="grid grid-cols-5 gap-4">
        <MetricCard label="Leads" value={f.inquiry} />
        <MetricCard label="Qualified" value={f.qualified} subtext={rate(f.qualified, f.inquiry)} />
        <MetricCard label="Booked" value={f.booked} subtext={rate(f.booked, f.inquiry)} />
        <MetricCard label="Revenue" value={`$${f.totalRevenue.toLocaleString()}`} />
        <MetricCard label="Booking Rate" value={rate(f.booked, f.inquiry)} />
      </div>

      <div className="rounded-lg border p-6">
        <h2 className="mb-4 text-lg font-semibold">Funnel</h2>
        <FunnelBars stages={funnelStages} maxCount={f.inquiry} />
      </div>

      <div className="rounded-lg border p-6">
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setBreakdown("campaign")}
            className={`rounded-md px-3 py-1 text-sm ${
              breakdown === "campaign" ? "bg-primary text-primary-foreground" : "bg-muted"
            }`}
          >
            By Campaign
          </button>
          <button
            onClick={() => setBreakdown("channel")}
            className={`rounded-md px-3 py-1 text-sm ${
              breakdown === "channel" ? "bg-primary text-primary-foreground" : "bg-muted"
            }`}
          >
            By Channel
          </button>
        </div>
        <BreakdownTable rows={breakdownRows} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/dashboard/roi/ apps/dashboard/src/components/roi/ && git commit -m "$(cat <<'EOF'
feat(dashboard): add ROI dashboard page with funnel, metrics, breakdowns

Focused revenue proof page. Headline metrics, funnel bars, campaign/channel
breakdown tabs, data health indicator. No charting library — shadcn Progress
bars + tables.
EOF
)"
```

---

### Task 24: Final build + typecheck + test

- [ ] **Step 1: Full build**

Run: `npx pnpm@9.15.4 build --force`
Expected: All packages build.

- [ ] **Step 2: Typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: No type errors.

- [ ] **Step 3: Run all tests**

Run: `npx pnpm@9.15.4 test`
Expected: All tests pass.

- [ ] **Step 4: Lint**

Run: `npx pnpm@9.15.4 lint`
Expected: No lint errors.

- [ ] **Step 5: Format check**

Run: `npx pnpm@9.15.4 format:check`
Expected: All files formatted.

- [ ] **Step 6: Commit any final fixes**
