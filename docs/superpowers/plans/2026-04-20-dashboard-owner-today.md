# OwnerToday Dashboard Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the skeletal OwnerToday dashboard with a full operating brief — greeting, 6 stat cards, action zone (approvals + bookings), pipeline funnel, revenue summary, owner tasks, and business activity feed — all powered by a single aggregate API endpoint, styled in Stone & Weight.

**Architecture:** Backend-first. Add new store methods → new Fastify routes → dashboard aggregate endpoint → new React Query hook → shared presentational components → rewired OwnerToday composition. The dashboard page makes one API call to `/api/:orgId/dashboard/overview` which assembles data from 6 stores in parallel.

**Tech Stack:** Fastify (API), Prisma (DB), React + TanStack Query (frontend), Stone & Weight CSS tokens (visual system). All TypeScript, ESM with `.js` extensions on relative imports.

**Spec:** `docs/superpowers/specs/2026-04-20-dashboard-owner-today-design.md`

---

## File Map

### Backend (packages/db + apps/api)

| File                                                                      | Action | Responsibility                                   |
| ------------------------------------------------------------------------- | ------ | ------------------------------------------------ |
| `packages/schemas/src/dashboard.ts`                                       | Create | `DashboardOverview` Zod schema + TS type         |
| `packages/db/src/stores/prisma-booking-store.ts`                          | Modify | Add `listByDate()` method                        |
| `packages/db/src/stores/prisma-owner-task-store.ts`                       | Modify | Add `listOpen()` method                          |
| `packages/db/src/stores/prisma-conversion-record-store.ts`                | Modify | Add `activePipelineCounts()` method              |
| `packages/db/src/stores/prisma-revenue-store.ts`                          | Modify | Add `sumByCampaignTop()` method                  |
| `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`           | Create | Tests for `listByDate()`                         |
| `packages/db/src/stores/__tests__/prisma-owner-task-store.test.ts`        | Create | Tests for `listOpen()`                           |
| `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts` | Modify | Tests for `activePipelineCounts()`               |
| `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts`           | Modify | Tests for `sumByCampaignTop()`                   |
| `apps/api/src/routes/dashboard-overview.ts`                               | Create | Aggregate endpoint route                         |
| `apps/api/src/routes/__tests__/dashboard-overview.test.ts`                | Create | Route tests                                      |
| `apps/api/src/services/activity-translator.ts`                            | Create | Server-side event → business language translator |
| `apps/api/src/services/__tests__/activity-translator.test.ts`             | Create | Translation tests                                |
| `apps/api/src/bootstrap/routes.ts`                                        | Modify | Register new route                               |

### Frontend (apps/dashboard)

| File                                                           | Action  | Responsibility                                   |
| -------------------------------------------------------------- | ------- | ------------------------------------------------ |
| `apps/dashboard/src/lib/api-client.ts`                         | Modify  | Add `getDashboardOverview()` method              |
| `apps/dashboard/src/app/api/dashboard/overview/route.ts`       | Create  | Next.js proxy route                              |
| `apps/dashboard/src/hooks/use-dashboard-overview.ts`           | Create  | React Query hook for aggregate endpoint          |
| `apps/dashboard/src/lib/query-keys.ts`                         | Modify  | Add `dashboard` namespace                        |
| `apps/dashboard/src/components/dashboard/section-label.tsx`    | Create  | Reusable 13px uppercase section header           |
| `apps/dashboard/src/components/dashboard/dashboard-header.tsx` | Create  | Greeting + summary line + date                   |
| `apps/dashboard/src/components/dashboard/stat-card.tsx`        | Create  | Single stat card (replaces old `stat-cards.tsx`) |
| `apps/dashboard/src/components/dashboard/stat-card-grid.tsx`   | Create  | Responsive grid of stat cards                    |
| `apps/dashboard/src/components/dashboard/action-card.tsx`      | Create  | Approval/task/escalation action card             |
| `apps/dashboard/src/components/dashboard/booking-row.tsx`      | Create  | Single booking entry                             |
| `apps/dashboard/src/components/dashboard/booking-preview.tsx`  | Create  | Card with booking rows                           |
| `apps/dashboard/src/components/dashboard/funnel-strip.tsx`     | Create  | Horizontal pipeline count strip                  |
| `apps/dashboard/src/components/dashboard/revenue-summary.tsx`  | Create  | Compact revenue block                            |
| `apps/dashboard/src/components/dashboard/activity-event.tsx`   | Create  | Single activity feed entry                       |
| `apps/dashboard/src/components/dashboard/activity-feed.tsx`    | Create  | Stacked event list                               |
| `apps/dashboard/src/components/dashboard/owner-task-row.tsx`   | Create  | Task row with checkbox                           |
| `apps/dashboard/src/components/dashboard/owner-task-list.tsx`  | Create  | Card with task rows                              |
| `apps/dashboard/src/components/dashboard/owner-today.tsx`      | Rewrite | New composition using shared components          |

---

## Task 1: DashboardOverview Schema

Define the shared contract between backend and frontend.

**Files:**

- Create: `packages/schemas/src/dashboard.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the schema file**

```typescript
// packages/schemas/src/dashboard.ts
import { z } from "zod";

export const DashboardOverviewSchema = z.object({
  generatedAt: z.string(),

  greeting: z.object({
    period: z.enum(["morning", "afternoon", "evening"]),
    operatorName: z.string(),
  }),

  stats: z.object({
    pendingApprovals: z.number(),
    newInquiriesToday: z.number(),
    newInquiriesYesterday: z.number(),
    qualifiedLeads: z.number(),
    bookingsToday: z.number(),
    revenue7d: z.object({ total: z.number(), count: z.number() }),
    openTasks: z.number(),
    overdueTasks: z.number(),
  }),

  approvals: z.array(
    z.object({
      id: z.string(),
      summary: z.string(),
      riskContext: z.string().nullable(),
      createdAt: z.string(),
      envelopeId: z.string(),
      bindingHash: z.string(),
      riskCategory: z.string(),
    }),
  ),

  bookings: z.array(
    z.object({
      id: z.string(),
      startsAt: z.string(),
      service: z.string(),
      contactName: z.string(),
      status: z.enum(["confirmed", "pending"]),
      channel: z.string().nullable(),
    }),
  ),

  funnel: z.object({
    inquiry: z.number(),
    qualified: z.number(),
    booked: z.number(),
    purchased: z.number(),
    completed: z.number(),
  }),

  revenue: z.object({
    total: z.number(),
    count: z.number(),
    topSource: z.object({ name: z.string(), amount: z.number() }).nullable(),
    periodDays: z.literal(7),
  }),

  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      dueAt: z.string().nullable(),
      isOverdue: z.boolean(),
      status: z.string(),
    }),
  ),

  activity: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      description: z.string(),
      dotColor: z.enum(["green", "amber", "blue", "gray"]),
      createdAt: z.string(),
    }),
  ),
});

export type DashboardOverview = z.infer<typeof DashboardOverviewSchema>;
```

- [ ] **Step 2: Export from schemas index**

Add to `packages/schemas/src/index.ts`:

```typescript
export { DashboardOverviewSchema, type DashboardOverview } from "./dashboard.js";
```

- [ ] **Step 3: Verify it compiles**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas build`
Expected: Clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/schemas/src/dashboard.ts packages/schemas/src/index.ts
git commit -m "$(cat <<'EOF'
feat: add DashboardOverview Zod schema for aggregate endpoint contract
EOF
)"
```

---

## Task 2: PrismaBookingStore — Add `listByDate()`

**Files:**

- Modify: `packages/db/src/stores/prisma-booking-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/db/src/stores/__tests__/prisma-booking-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

function createMockPrisma() {
  return {
    booking: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

describe("PrismaBookingStore", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let store: InstanceType<typeof import("../prisma-booking-store.js").PrismaBookingStore>;

  beforeEach(async () => {
    mockPrisma = createMockPrisma();
    const { PrismaBookingStore } = await import("../prisma-booking-store.js");
    store = new PrismaBookingStore(mockPrisma as never);
  });

  describe("listByDate", () => {
    it("returns bookings for a specific date excluding cancelled", async () => {
      const bookings = [
        {
          id: "b1",
          service: "Whitening",
          startsAt: new Date("2026-04-20T14:30:00Z"),
          status: "confirmed",
          sourceChannel: "whatsapp",
          contact: { name: "Sarah Chen" },
        },
      ];
      mockPrisma.booking.findMany.mockResolvedValue(bookings);

      const result = await store.listByDate("org-1", new Date("2026-04-20"));
      expect(result).toHaveLength(1);
      expect(result[0].service).toBe("Whitening");
      expect(result[0].status).toBe("confirmed");

      const call = mockPrisma.booking.findMany.mock.calls[0][0];
      expect(call.where.organizationId).toBe("org-1");
      expect(call.where.status).toEqual({ notIn: ["cancelled", "failed"] });
      expect(call.orderBy).toEqual({ startsAt: "asc" });
      expect(call.include.contact).toEqual({ select: { name: true } });
    });

    it("limits results to 10 by default", async () => {
      mockPrisma.booking.findMany.mockResolvedValue([]);
      await store.listByDate("org-1", new Date("2026-04-20"));

      const call = mockPrisma.booking.findMany.mock.calls[0][0];
      expect(call.take).toBe(10);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-booking-store`
Expected: FAIL — `listByDate` is not a function.

- [ ] **Step 3: Implement `listByDate()`**

Add to `packages/db/src/stores/prisma-booking-store.ts`, inside the class:

```typescript
async listByDate(
  orgId: string,
  date: Date,
  limit = 10,
): Promise<
  Array<{
    id: string;
    startsAt: Date;
    service: string;
    status: string;
    sourceChannel: string | null;
    contact: { name: string | null };
  }>
> {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  return this.prisma.booking.findMany({
    where: {
      organizationId: orgId,
      startsAt: { gte: dayStart, lte: dayEnd },
      status: { notIn: ["cancelled", "failed"] },
    },
    orderBy: { startsAt: "asc" },
    take: limit,
    include: {
      contact: { select: { name: true } },
    },
  });
}
```

Note: The constructor stores the Prisma client as `this.prisma`. Follow the existing pattern in the file — the constructor accepts a `PrismaClient` and stores it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-booking-store`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-booking-store.ts packages/db/src/stores/__tests__/prisma-booking-store.test.ts
git commit -m "$(cat <<'EOF'
feat: add listByDate to PrismaBookingStore for dashboard bookings preview
EOF
)"
```

---

## Task 3: PrismaOwnerTaskStore — Add `listOpen()`

The existing `findPending()` finds pending tasks. We need `listOpen()` which returns pending tasks with overdue detection and a configurable limit.

**Files:**

- Modify: `packages/db/src/stores/prisma-owner-task-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-owner-task-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/db/src/stores/__tests__/prisma-owner-task-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

function createMockPrisma() {
  return {
    ownerTask: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

describe("PrismaOwnerTaskStore", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let store: InstanceType<typeof import("../prisma-owner-task-store.js").PrismaOwnerTaskStore>;

  beforeEach(async () => {
    mockPrisma = createMockPrisma();
    const { PrismaOwnerTaskStore } = await import("../prisma-owner-task-store.js");
    store = new PrismaOwnerTaskStore(mockPrisma as never);
  });

  describe("listOpen", () => {
    it("returns pending tasks with isOverdue flag", async () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString();
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

      mockPrisma.ownerTask.findMany.mockResolvedValue([
        {
          id: "t1",
          title: "Follow up",
          status: "pending",
          priority: "high",
          dueAt: new Date(yesterday),
          createdAt: new Date(),
        },
        {
          id: "t2",
          title: "Review pricing",
          status: "pending",
          priority: "medium",
          dueAt: new Date(tomorrow),
          createdAt: new Date(),
        },
        {
          id: "t3",
          title: "No due date",
          status: "pending",
          priority: "low",
          dueAt: null,
          createdAt: new Date(),
        },
      ]);

      const result = await store.listOpen("org-1");

      expect(result).toHaveLength(3);
      expect(result[0].isOverdue).toBe(true);
      expect(result[1].isOverdue).toBe(false);
      expect(result[2].isOverdue).toBe(false);
    });

    it("respects limit parameter", async () => {
      mockPrisma.ownerTask.findMany.mockResolvedValue([]);
      await store.listOpen("org-1", 5);

      const call = mockPrisma.ownerTask.findMany.mock.calls[0][0];
      expect(call.take).toBe(5);
    });

    it("counts total open and overdue tasks", async () => {
      const yesterday = new Date(Date.now() - 86_400_000);
      mockPrisma.ownerTask.findMany.mockResolvedValue([
        {
          id: "t1",
          title: "Overdue",
          status: "pending",
          priority: "high",
          dueAt: yesterday,
          createdAt: new Date(),
        },
      ]);

      const result = await store.listOpen("org-1");
      expect(result.openCount).toBeDefined();
      expect(result.overdueCount).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-owner-task-store`
Expected: FAIL — `listOpen` is not a function.

- [ ] **Step 3: Implement `listOpen()`**

Add to `packages/db/src/stores/prisma-owner-task-store.ts`, inside the class:

```typescript
async listOpen(
  orgId: string,
  limit = 10,
): Promise<
  Array<{
    id: string;
    title: string;
    dueAt: Date | null;
    isOverdue: boolean;
    status: string;
    priority: string;
  }> & { openCount: number; overdueCount: number }
> {
  const rows = await this.prisma.ownerTask.findMany({
    where: { organizationId: orgId, status: "pending" },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: limit,
  });

  const now = new Date();
  const mapped = rows.map((r) => ({
    id: r.id,
    title: r.title,
    dueAt: r.dueAt,
    isOverdue: r.dueAt !== null && r.dueAt < now,
    status: r.status,
    priority: r.priority,
  }));

  const result = mapped as typeof mapped & { openCount: number; overdueCount: number };
  result.openCount = rows.length;
  result.overdueCount = mapped.filter((t) => t.isOverdue).length;
  return result;
}
```

Note: Priority sorting uses string ordering which works for the existing values (high > low > medium > urgent in alphabetical order is wrong). The existing `findPending()` uses a custom sort with a priority map. Replicate that pattern:

```typescript
const PRIORITY_RANK: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };

// Inside listOpen, after fetching rows:
const sorted = rows.sort((a, b) => {
  const pa = PRIORITY_RANK[a.priority] ?? 0;
  const pb = PRIORITY_RANK[b.priority] ?? 0;
  if (pb !== pa) return pb - pa;
  return a.createdAt.getTime() - b.createdAt.getTime();
});
```

Replace the `orderBy` in the Prisma query with just `{ createdAt: "asc" }` and sort in JS like `findPending()` already does. Check the existing `findPending()` method for the exact pattern and replicate it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-owner-task-store`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-owner-task-store.ts packages/db/src/stores/__tests__/prisma-owner-task-store.test.ts
git commit -m "$(cat <<'EOF'
feat: add listOpen to PrismaOwnerTaskStore with overdue detection
EOF
)"
```

---

## Task 4: PrismaConversionRecordStore — Add `activePipelineCounts()`

**Files:**

- Modify: `packages/db/src/stores/prisma-conversion-record-store.ts`
- Modify or create: `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

function createMockPrisma() {
  return {
    conversionRecord: {
      groupBy: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
    },
  };
}

describe("PrismaConversionRecordStore", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let store: InstanceType<
    typeof import("../prisma-conversion-record-store.js").PrismaConversionRecordStore
  >;

  beforeEach(async () => {
    mockPrisma = createMockPrisma();
    const { PrismaConversionRecordStore } = await import("../prisma-conversion-record-store.js");
    store = new PrismaConversionRecordStore(mockPrisma as never);
  });

  describe("activePipelineCounts", () => {
    it("returns counts per stage with 30-day window for terminal states", async () => {
      mockPrisma.conversionRecord.groupBy.mockResolvedValue([
        { type: "inquiry", _count: { _all: 12 } },
        { type: "qualified", _count: { _all: 8 } },
        { type: "booked", _count: { _all: 5 } },
        { type: "purchased", _count: { _all: 3 } },
        { type: "completed", _count: { _all: 2 } },
      ]);

      const result = await store.activePipelineCounts("org-1");

      expect(result).toEqual({
        inquiry: 12,
        qualified: 8,
        booked: 5,
        purchased: 3,
        completed: 2,
      });
    });

    it("returns zeros for missing stages", async () => {
      mockPrisma.conversionRecord.groupBy.mockResolvedValue([
        { type: "inquiry", _count: { _all: 3 } },
      ]);

      const result = await store.activePipelineCounts("org-1");

      expect(result).toEqual({
        inquiry: 3,
        qualified: 0,
        booked: 0,
        purchased: 0,
        completed: 0,
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-conversion-record-store`
Expected: FAIL — `activePipelineCounts` is not a function.

- [ ] **Step 3: Implement `activePipelineCounts()`**

Add to `packages/db/src/stores/prisma-conversion-record-store.ts`, inside the class:

```typescript
async activePipelineCounts(
  orgId: string,
): Promise<{
  inquiry: number;
  qualified: number;
  booked: number;
  purchased: number;
  completed: number;
}> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const terminalStages = ["completed", "lost"];

  const groups = await this.prisma.conversionRecord.groupBy({
    by: ["type"],
    where: {
      organizationId: orgId,
      OR: [
        { type: { notIn: terminalStages } },
        { type: { in: terminalStages }, occurredAt: { gte: thirtyDaysAgo } },
      ],
    },
    _count: { _all: true },
  });

  const counts: Record<string, number> = {};
  for (const g of groups) {
    counts[g.type] = g._count._all;
  }

  return {
    inquiry: counts["inquiry"] ?? 0,
    qualified: counts["qualified"] ?? 0,
    booked: counts["booked"] ?? 0,
    purchased: counts["purchased"] ?? 0,
    completed: counts["completed"] ?? 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-conversion-record-store`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-conversion-record-store.ts packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts
git commit -m "$(cat <<'EOF'
feat: add activePipelineCounts to ConversionRecordStore with 30-day terminal window
EOF
)"
```

---

## Task 5: Activity Translator (Server-Side)

The spec requires `{actor} {action} {business object}` translation to happen server-side, not in frontend formatting. This service takes raw audit entries and returns pre-translated activity items.

**Files:**

- Create: `apps/api/src/services/activity-translator.ts`
- Create: `apps/api/src/services/__tests__/activity-translator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/services/__tests__/activity-translator.test.ts
import { describe, it, expect } from "vitest";
import { translateActivity } from "../activity-translator.js";
import type { RawAuditEntry } from "../activity-translator.js";

describe("translateActivity", () => {
  const base: RawAuditEntry = {
    id: "a1",
    eventType: "action.executed",
    timestamp: "2026-04-20T08:00:00Z",
    actorType: "agent",
    actorId: "alex",
    entityType: "booking",
    entityId: "b1",
    summary: "Booking confirmed for Sarah Chen",
    snapshot: {},
  };

  it("translates action.executed with booking entity", () => {
    const result = translateActivity({
      ...base,
      summary: "Confirmed booking: Teeth Whitening at 2:30 PM for Sarah Chen",
    });

    expect(result.description).toContain("Alex");
    expect(result.description).not.toContain("action.executed");
    expect(result.description).not.toContain("entityId");
    expect(result.dotColor).toBe("green");
  });

  it("translates action.approved", () => {
    const result = translateActivity({
      ...base,
      eventType: "action.approved",
      actorType: "owner",
      actorId: "owner-1",
      summary: "Approved booking for Sarah Chen",
    });

    expect(result.description).toContain("You");
    expect(result.dotColor).toBe("green");
  });

  it("translates action.denied", () => {
    const result = translateActivity({
      ...base,
      eventType: "action.denied",
      actorType: "owner",
      summary: "Denied booking",
    });

    expect(result.dotColor).toBe("amber");
  });

  it("never exposes internal IDs or enum values", () => {
    const result = translateActivity(base);
    expect(result.description).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}/);
    expect(result.description).not.toContain("action.executed");
    expect(result.description).not.toContain("entityType");
  });

  it("returns all required fields", () => {
    const result = translateActivity(base);
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("type");
    expect(result).toHaveProperty("description");
    expect(result).toHaveProperty("dotColor");
    expect(result).toHaveProperty("createdAt");
    expect(["green", "amber", "blue", "gray"]).toContain(result.dotColor);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run activity-translator`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the translator**

```typescript
// apps/api/src/services/activity-translator.ts

export interface RawAuditEntry {
  id: string;
  eventType: string;
  timestamp: string;
  actorType: string;
  actorId: string;
  entityType: string;
  entityId: string;
  summary: string;
  snapshot: Record<string, unknown>;
}

export interface TranslatedActivity {
  id: string;
  type: string;
  description: string;
  dotColor: "green" | "amber" | "blue" | "gray";
  createdAt: string;
}

function resolveActor(entry: RawAuditEntry): string {
  if (entry.actorType === "owner" || entry.actorType === "operator") return "You";
  if (entry.actorType === "agent") {
    const name = entry.actorId.charAt(0).toUpperCase() + entry.actorId.slice(1);
    return name;
  }
  return "System";
}

function resolveDotColor(eventType: string): TranslatedActivity["dotColor"] {
  if (eventType.includes("approved") || eventType.includes("executed")) return "green";
  if (
    eventType.includes("denied") ||
    eventType.includes("rejected") ||
    eventType.includes("failed")
  )
    return "amber";
  if (eventType.startsWith("tool.") || eventType.startsWith("connection.")) return "blue";
  return "gray";
}

function buildDescription(entry: RawAuditEntry): string {
  const actor = resolveActor(entry);
  const summary = entry.summary || "";

  if (summary) {
    const cleaned = summary
      .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (cleaned.toLowerCase().startsWith(actor.toLowerCase())) {
      return cleaned;
    }
    return `${actor} ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}`;
  }

  return `${actor} performed an action`;
}

export function translateActivity(entry: RawAuditEntry): TranslatedActivity {
  return {
    id: entry.id,
    type: entry.eventType,
    description: buildDescription(entry),
    dotColor: resolveDotColor(entry.eventType),
    createdAt: entry.timestamp,
  };
}

export function translateActivities(entries: RawAuditEntry[], limit = 8): TranslatedActivity[] {
  return entries.slice(0, limit).map(translateActivity);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run activity-translator`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/activity-translator.ts apps/api/src/services/__tests__/activity-translator.test.ts
git commit -m "$(cat <<'EOF'
feat: add server-side activity translator for dashboard business-language feed
EOF
)"
```

---

## Task 6: Dashboard Aggregate Endpoint

The single composed endpoint that powers the entire OwnerToday page.

**Files:**

- Create: `apps/api/src/routes/dashboard-overview.ts`
- Create: `apps/api/src/routes/__tests__/dashboard-overview.test.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/routes/__tests__/dashboard-overview.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildDashboardOverview } from "../dashboard-overview.js";

describe("buildDashboardOverview", () => {
  it("assembles all sections from store results", async () => {
    const stores = {
      approvals: { listPending: vi.fn().mockResolvedValue([]) },
      bookings: {
        listByDate: vi.fn().mockResolvedValue([]),
        countConfirmed: vi.fn().mockResolvedValue(0),
      },
      tasks: {
        listOpen: vi.fn().mockResolvedValue(Object.assign([], { openCount: 0, overdueCount: 0 })),
      },
      conversions: {
        activePipelineCounts: vi
          .fn()
          .mockResolvedValue({ inquiry: 0, qualified: 0, booked: 0, purchased: 0, completed: 0 }),
        countByType: vi.fn().mockResolvedValue(0),
      },
      revenue: {
        sumByOrg: vi.fn().mockResolvedValue({ totalAmount: 0, count: 0 }),
        sumByCampaign: vi.fn().mockResolvedValue([]),
      },
      audit: { query: vi.fn().mockResolvedValue({ entries: [], total: 0 }) },
    };

    const result = await buildDashboardOverview("org-1", "Operator", stores as never);

    expect(result.generatedAt).toBeDefined();
    expect(result.greeting).toBeDefined();
    expect(result.stats).toBeDefined();
    expect(result.approvals).toEqual([]);
    expect(result.bookings).toEqual([]);
    expect(result.funnel).toBeDefined();
    expect(result.revenue).toBeDefined();
    expect(result.tasks).toEqual([]);
    expect(result.activity).toEqual([]);
  });

  it("generates correct greeting period", async () => {
    const stores = {
      approvals: { listPending: vi.fn().mockResolvedValue([]) },
      bookings: {
        listByDate: vi.fn().mockResolvedValue([]),
        countConfirmed: vi.fn().mockResolvedValue(0),
      },
      tasks: {
        listOpen: vi.fn().mockResolvedValue(Object.assign([], { openCount: 0, overdueCount: 0 })),
      },
      conversions: {
        activePipelineCounts: vi
          .fn()
          .mockResolvedValue({ inquiry: 0, qualified: 0, booked: 0, purchased: 0, completed: 0 }),
        countByType: vi.fn().mockResolvedValue(0),
      },
      revenue: {
        sumByOrg: vi.fn().mockResolvedValue({ totalAmount: 0, count: 0 }),
        sumByCampaign: vi.fn().mockResolvedValue([]),
      },
      audit: { query: vi.fn().mockResolvedValue({ entries: [], total: 0 }) },
    };

    const result = await buildDashboardOverview("org-1", "Alex", stores as never);
    expect(["morning", "afternoon", "evening"]).toContain(result.greeting.period);
    expect(result.greeting.operatorName).toBe("Alex");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run dashboard-overview`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route and builder**

```typescript
// apps/api/src/routes/dashboard-overview.ts
import type { FastifyPluginAsync } from "fastify";
import {
  PrismaBookingStore,
  PrismaOwnerTaskStore,
  PrismaConversionRecordStore,
  PrismaRevenueStore,
} from "@switchboard/db";
import { requireOrganizationScope } from "../utils/require-org.js";
import { translateActivities } from "../services/activity-translator.js";
import type { DashboardOverview } from "@switchboard/schemas";

interface DashboardStores {
  approvals: { listPending: (orgId: string) => Promise<Array<Record<string, unknown>>> };
  bookings: PrismaBookingStore;
  tasks: PrismaOwnerTaskStore;
  conversions: PrismaConversionRecordStore;
  revenue: PrismaRevenueStore;
  audit: {
    query: (
      filter: Record<string, unknown>,
    ) => Promise<{ entries: Array<Record<string, unknown>>; total: number }>;
  };
}

function getGreetingPeriod(): "morning" | "afternoon" | "evening" {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export async function buildDashboardOverview(
  orgId: string,
  operatorName: string,
  stores: DashboardStores,
): Promise<DashboardOverview> {
  const today = new Date();
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const sevenDaysAgo = new Date(todayStart);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [
    pendingApprovals,
    todayBookings,
    openTasks,
    funnel,
    inquiriesToday,
    inquiriesYesterday,
    revenue7d,
    revenueByCampaign,
    auditResult,
  ] = await Promise.all([
    stores.approvals.listPending(orgId),
    stores.bookings.listByDate(orgId, today, 5),
    stores.tasks.listOpen(orgId, 5),
    stores.conversions.activePipelineCounts(orgId),
    stores.conversions.countByType(orgId, "inquiry", todayStart, today),
    stores.conversions.countByType(orgId, "inquiry", yesterdayStart, todayStart),
    stores.revenue.sumByOrg(orgId, { from: sevenDaysAgo, to: today }),
    stores.revenue.sumByCampaign(orgId, { from: sevenDaysAgo, to: today }),
    stores.audit.query({ organizationId: orgId, limit: 8 }),
  ]);

  const topCampaign =
    revenueByCampaign.sort(
      (a: { totalAmount: number }, b: { totalAmount: number }) => b.totalAmount - a.totalAmount,
    )[0] ?? null;

  const activity = translateActivities(
    (auditResult.entries ?? []).map((e: Record<string, unknown>) => ({
      id: String(e.id ?? ""),
      eventType: String(e.eventType ?? ""),
      timestamp: String(e.timestamp ?? ""),
      actorType: String(e.actorType ?? ""),
      actorId: String(e.actorId ?? ""),
      entityType: String(e.entityType ?? ""),
      entityId: String(e.entityId ?? ""),
      summary: String(e.summary ?? ""),
      snapshot: (e.snapshot as Record<string, unknown>) ?? {},
    })),
    8,
  );

  return {
    generatedAt: new Date().toISOString(),
    greeting: {
      period: getGreetingPeriod(),
      operatorName,
    },
    stats: {
      pendingApprovals: pendingApprovals.length,
      newInquiriesToday: inquiriesToday,
      newInquiriesYesterday: inquiriesYesterday,
      qualifiedLeads: funnel.qualified,
      bookingsToday: todayBookings.length,
      revenue7d: { total: revenue7d.totalAmount, count: revenue7d.count },
      openTasks: (openTasks as unknown as { openCount: number }).openCount ?? 0,
      overdueTasks: (openTasks as unknown as { overdueCount: number }).overdueCount ?? 0,
    },
    approvals: pendingApprovals.slice(0, 3).map((a: Record<string, unknown>) => ({
      id: String(a.id),
      summary: String(a.summary ?? ""),
      riskContext: a.riskContext ? String(a.riskContext) : null,
      createdAt: String(a.createdAt ?? ""),
      envelopeId: String(a.envelopeId ?? ""),
      bindingHash: String(a.bindingHash ?? ""),
      riskCategory: String(a.riskCategory ?? "medium"),
    })),
    bookings: todayBookings.map((b) => ({
      id: b.id,
      startsAt: b.startsAt.toISOString(),
      service: b.service,
      contactName: b.contact?.name ?? "Unknown",
      status: b.status as "confirmed" | "pending",
      channel: b.sourceChannel ?? null,
    })),
    funnel,
    revenue: {
      total: revenue7d.totalAmount,
      count: revenue7d.count,
      topSource: topCampaign
        ? { name: String(topCampaign.sourceCampaignId), amount: topCampaign.totalAmount }
        : null,
      periodDays: 7,
    },
    tasks: (
      openTasks as Array<{
        id: string;
        title: string;
        dueAt: Date | null;
        isOverdue: boolean;
        status: string;
      }>
    ).map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.dueAt?.toISOString() ?? null,
      isOverdue: t.isOverdue,
      status: t.status,
    })),
    activity,
  };
}

export const dashboardOverviewRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:orgId/dashboard/overview", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const roster = await app.prisma.agentRoster.findFirst({
      where: { organizationId: orgId, agentRole: "primary_operator" },
      select: { displayName: true },
    });
    const operatorName = roster?.displayName ?? "Alex";

    const stores: DashboardStores = {
      approvals: {
        listPending: (oid: string) =>
          app.prisma!.approval?.findMany?.({ where: { organizationId: oid, status: "pending" } }) ??
          Promise.resolve([]),
      },
      bookings: new PrismaBookingStore(app.prisma),
      tasks: new PrismaOwnerTaskStore(app.prisma),
      conversions: new PrismaConversionRecordStore(app.prisma),
      revenue: new PrismaRevenueStore(app.prisma),
      audit: app.auditLedger ?? { query: () => Promise.resolve({ entries: [], total: 0 }) },
    };

    const overview = await buildDashboardOverview(orgId, operatorName, stores);
    return reply.send(overview);
  });
};
```

Note: The approvals store access depends on how approvals are currently stored. Check whether `app.prisma.approval` exists or if approvals are queried differently (the existing route uses `client.listPendingApprovals()` which likely hits an approvals route). Look at `apps/api/src/routes/approvals.ts` for the exact query pattern and replicate it in the `stores.approvals.listPending` lambda. The implementation above is a reasonable starting point — adjust the Prisma model name to match what exists.

- [ ] **Step 4: Register the route**

Add to `apps/api/src/bootstrap/routes.ts`:

```typescript
import { dashboardOverviewRoutes } from "../routes/dashboard-overview.js";
```

And in the `registerRoutes` function body:

```typescript
await app.register(dashboardOverviewRoutes, { prefix: "/api" });
```

- [ ] **Step 5: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run dashboard-overview`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/dashboard-overview.ts apps/api/src/routes/__tests__/dashboard-overview.test.ts apps/api/src/bootstrap/routes.ts
git commit -m "$(cat <<'EOF'
feat: add dashboard aggregate endpoint GET /:orgId/dashboard/overview
EOF
)"
```

---

## Task 7: Frontend — Dashboard Hook + Proxy Route

Wire the frontend to the new aggregate endpoint.

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/overview/route.ts`
- Create: `apps/dashboard/src/hooks/use-dashboard-overview.ts`
- Modify: `apps/dashboard/src/lib/api-client.ts`
- Modify: `apps/dashboard/src/lib/query-keys.ts`

- [ ] **Step 1: Add `getDashboardOverview()` to SwitchboardClient**

Add to `apps/dashboard/src/lib/api-client.ts`, inside the `SwitchboardClient` class:

```typescript
async getDashboardOverview(): Promise<DashboardOverview> {
  return this.request<DashboardOverview>("/dashboard/overview");
}
```

Add the import at the top of the file:

```typescript
import type { DashboardOverview } from "@switchboard/schemas";
```

Note: The `request()` method on the base class automatically prepends the org-scoped API base URL and adds the auth header.

- [ ] **Step 2: Create the Next.js proxy route**

```typescript
// apps/dashboard/src/app/api/dashboard/overview/route.ts
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET() {
  try {
    const client = await getApiClient();
    const data = await client.getDashboardOverview();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load dashboard";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

- [ ] **Step 3: Add query key namespace**

Add to `apps/dashboard/src/lib/query-keys.ts`:

```typescript
dashboard: {
  all: ["dashboard"] as const,
  overview: () => ["dashboard", "overview"] as const,
},
```

- [ ] **Step 4: Create the React Query hook**

```typescript
// apps/dashboard/src/hooks/use-dashboard-overview.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { DashboardOverview } from "@switchboard/schemas";

async function fetchOverview(): Promise<DashboardOverview> {
  const res = await fetch("/api/dashboard/overview");
  if (!res.ok) throw new Error("Failed to fetch dashboard overview");
  return res.json();
}

export function useDashboardOverview() {
  return useQuery({
    queryKey: queryKeys.dashboard.overview(),
    queryFn: fetchOverview,
    refetchInterval: 60_000,
  });
}
```

- [ ] **Step 5: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit 2>&1 | grep -i dashboard`
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/overview/route.ts apps/dashboard/src/hooks/use-dashboard-overview.ts apps/dashboard/src/lib/api-client.ts apps/dashboard/src/lib/query-keys.ts
git commit -m "$(cat <<'EOF'
feat: add dashboard overview proxy route, React Query hook, and client method
EOF
)"
```

---

## Task 8: Shared UI Components — Primitives

Build the small, reusable components. All use `--sw-*` tokens exclusively.

**Files:**

- Create: `apps/dashboard/src/components/dashboard/section-label.tsx`
- Create: `apps/dashboard/src/components/dashboard/stat-card.tsx`
- Create: `apps/dashboard/src/components/dashboard/stat-card-grid.tsx`

- [ ] **Step 1: SectionLabel**

```tsx
// apps/dashboard/src/components/dashboard/section-label.tsx
interface SectionLabelProps {
  children: React.ReactNode;
}

export function SectionLabel({ children }: SectionLabelProps) {
  return (
    <h2
      style={{
        fontSize: "13px",
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "var(--sw-text-muted)",
        margin: 0,
      }}
    >
      {children}
    </h2>
  );
}
```

- [ ] **Step 2: StatCard**

```tsx
// apps/dashboard/src/components/dashboard/stat-card.tsx
interface StatCardProps {
  label: string;
  value: string | number;
  delta?: { direction: "up" | "down"; text: string };
  badge?: { text: string; variant: "overdue" };
}

export function StatCard({ label, value, delta, badge }: StatCardProps) {
  return (
    <div
      style={{
        background: "var(--sw-surface-raised)",
        border: "1px solid var(--sw-border)",
        borderRadius: "12px",
        padding: "24px",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "28px",
          fontWeight: 600,
          color: "var(--sw-text-primary)",
          lineHeight: 1,
          margin: 0,
        }}
      >
        {value}
      </p>
      <p
        style={{
          fontSize: "13px",
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--sw-text-muted)",
          marginTop: "8px",
        }}
      >
        {label}
      </p>
      {delta && (
        <p style={{ fontSize: "13px", color: "var(--sw-text-secondary)", marginTop: "4px" }}>
          {delta.direction === "up" ? "↑" : "↓"} {delta.text}
        </p>
      )}
      {badge && (
        <span
          style={{
            display: "inline-block",
            marginTop: "6px",
            padding: "2px 8px",
            borderRadius: "9999px",
            fontSize: "13px",
            color: "hsl(0, 38%, 40%)",
            background: "hsl(0, 20%, 95%)",
          }}
        >
          {badge.text}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: StatCardGrid**

```tsx
// apps/dashboard/src/components/dashboard/stat-card-grid.tsx
import { StatCard } from "./stat-card";
import type { ComponentProps } from "react";

interface StatCardGridProps {
  stats: Array<ComponentProps<typeof StatCard>>;
}

export function StatCardGrid({ stats }: StatCardGridProps) {
  return (
    <div
      style={{ display: "grid", gap: "16px" }}
      className="grid-cols-2 md:grid-cols-3 lg:grid-cols-6"
    >
      {stats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit 2>&1 | grep -i "stat-card\|section-label"`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/dashboard/section-label.tsx apps/dashboard/src/components/dashboard/stat-card.tsx apps/dashboard/src/components/dashboard/stat-card-grid.tsx
git commit -m "$(cat <<'EOF'
feat: add SectionLabel, StatCard, and StatCardGrid dashboard primitives
EOF
)"
```

---

## Task 9: Shared UI Components — Action Zone

**Files:**

- Create: `apps/dashboard/src/components/dashboard/dashboard-header.tsx`
- Create: `apps/dashboard/src/components/dashboard/action-card.tsx`
- Create: `apps/dashboard/src/components/dashboard/booking-row.tsx`
- Create: `apps/dashboard/src/components/dashboard/booking-preview.tsx`

- [ ] **Step 1: DashboardHeader**

```tsx
// apps/dashboard/src/components/dashboard/dashboard-header.tsx
import type { DashboardOverview } from "@switchboard/schemas";

interface DashboardHeaderProps {
  overview: DashboardOverview;
}

const GREETING_TEXT = {
  morning: "Good morning.",
  afternoon: "Good afternoon.",
  evening: "Good evening.",
};

type SignalEntry = { count: number; label: string };

function buildSummary(stats: DashboardOverview["stats"]): string {
  const signals: SignalEntry[] = [
    { count: stats.pendingApprovals, label: "approval" },
    { count: stats.bookingsToday, label: "booking" },
    { count: stats.newInquiriesToday, label: "new inquiry" },
    { count: stats.overdueTasks, label: "overdue task" },
  ];

  const active = signals
    .filter((s) => s.count > 0)
    .slice(0, 3)
    .map((s) => `${s.count} ${s.label}${s.count !== 1 ? "s" : ""}`)
    .join(" · ");

  return active || "All clear this morning.";
}

export function DashboardHeader({ overview }: DashboardHeaderProps) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "24px",
            fontWeight: 600,
            color: "var(--sw-text-primary)",
            margin: 0,
          }}
        >
          {GREETING_TEXT[overview.greeting.period]}
        </h1>
        <time style={{ fontSize: "13px", color: "var(--sw-text-muted)" }}>{today}</time>
      </div>
      <p style={{ fontSize: "16px", color: "var(--sw-text-secondary)", marginTop: "8px" }}>
        {buildSummary(overview.stats)}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: ActionCard**

```tsx
// apps/dashboard/src/components/dashboard/action-card.tsx
import { formatRelative } from "@/lib/format";

interface ActionCardAction {
  label: string;
  variant: "primary" | "secondary";
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

interface ActionCardProps {
  summary: string;
  context: string | null;
  createdAt: string;
  actions: ActionCardAction[];
}

export function ActionCard({ summary, context, createdAt, actions }: ActionCardProps) {
  return (
    <div
      style={{
        background: "var(--sw-surface-raised)",
        border: "1px solid var(--sw-border)",
        borderRadius: "12px",
        padding: "20px",
      }}
    >
      <p style={{ fontSize: "16px", color: "var(--sw-text-primary)", margin: 0 }}>{summary}</p>
      {context && (
        <p style={{ fontSize: "14px", color: "var(--sw-text-secondary)", marginTop: "6px" }}>
          {context}
        </p>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginTop: "12px",
        }}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={action.onClick}
            disabled={action.disabled || action.loading}
            className="active:scale-[0.98]"
            style={{
              height: "36px",
              padding: "0 16px",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: 600,
              border: "none",
              cursor: action.disabled ? "not-allowed" : "pointer",
              opacity: action.disabled ? 0.5 : 1,
              transition: "opacity 200ms ease-out, transform 200ms ease-out",
              ...(action.variant === "primary"
                ? { background: "var(--sw-accent)", color: "white" }
                : { background: "transparent", color: "var(--sw-text-secondary)" }),
            }}
          >
            {action.loading ? "..." : action.label}
          </button>
        ))}
        <time
          style={{
            marginLeft: "auto",
            fontSize: "13px",
            color: "var(--sw-text-muted)",
          }}
        >
          {formatRelative(createdAt)}
        </time>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: BookingRow and BookingPreview**

```tsx
// apps/dashboard/src/components/dashboard/booking-row.tsx
interface BookingRowProps {
  time: string;
  service: string;
  contact: string;
  status: "confirmed" | "pending" | "completed";
}

const DOT_COLORS: Record<string, string> = {
  confirmed: "hsl(145, 45%, 42%)",
  pending: "var(--sw-accent)",
  completed: "var(--sw-text-muted)",
};

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  completed: "Done",
};

export function BookingRow({ time, service, contact, status }: BookingRowProps) {
  const isMuted = status === "completed";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "16px 20px",
        opacity: isMuted ? 0.6 : 1,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "16px",
          fontWeight: 600,
          color: "var(--sw-text-primary)",
          minWidth: "72px",
        }}
      >
        {time}
      </span>
      <span style={{ fontSize: "16px", color: "var(--sw-text-primary)", flex: 1 }}>
        {service} · {contact}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: DOT_COLORS[status] ?? "var(--sw-text-muted)",
          }}
        />
        <span style={{ fontSize: "13px", color: "var(--sw-text-muted)" }}>
          {STATUS_LABELS[status] ?? status}
        </span>
      </span>
    </div>
  );
}
```

```tsx
// apps/dashboard/src/components/dashboard/booking-preview.tsx
import { BookingRow } from "./booking-row";
import { SectionLabel } from "./section-label";

interface BookingData {
  id: string;
  startsAt: string;
  service: string;
  contactName: string;
  status: "confirmed" | "pending";
}

interface BookingPreviewProps {
  bookings: BookingData[];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function classifyStatus(booking: BookingData): "confirmed" | "pending" | "completed" {
  if (booking.status === "confirmed" && new Date(booking.startsAt) < new Date()) {
    return "completed";
  }
  return booking.status;
}

export function BookingPreview({ bookings }: BookingPreviewProps) {
  return (
    <div>
      <SectionLabel>Today&apos;s Bookings</SectionLabel>
      <div
        style={{
          marginTop: "12px",
          background: "var(--sw-surface-raised)",
          border: "1px solid var(--sw-border)",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      >
        {bookings.length === 0 ? (
          <p
            style={{
              padding: "24px 20px",
              fontSize: "16px",
              color: "var(--sw-text-secondary)",
              margin: 0,
            }}
          >
            No bookings today
          </p>
        ) : (
          bookings.map((b, i) => (
            <div
              key={b.id}
              style={
                i < bookings.length - 1 ? { borderBottom: "1px solid var(--sw-border)" } : undefined
              }
            >
              <BookingRow
                time={formatTime(b.startsAt)}
                service={b.service}
                contact={b.contactName}
                status={classifyStatus(b)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit 2>&1 | grep -iE "dashboard-header|action-card|booking"`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/dashboard/dashboard-header.tsx apps/dashboard/src/components/dashboard/action-card.tsx apps/dashboard/src/components/dashboard/booking-row.tsx apps/dashboard/src/components/dashboard/booking-preview.tsx
git commit -m "$(cat <<'EOF'
feat: add DashboardHeader, ActionCard, BookingRow, BookingPreview components
EOF
)"
```

---

## Task 10: Shared UI Components — Funnel, Revenue, Activity, Tasks

**Files:**

- Create: `apps/dashboard/src/components/dashboard/funnel-strip.tsx`
- Create: `apps/dashboard/src/components/dashboard/revenue-summary.tsx`
- Create: `apps/dashboard/src/components/dashboard/activity-event.tsx`
- Create: `apps/dashboard/src/components/dashboard/activity-feed.tsx`
- Create: `apps/dashboard/src/components/dashboard/owner-task-row.tsx`
- Create: `apps/dashboard/src/components/dashboard/owner-task-list.tsx`

- [ ] **Step 1: FunnelStrip**

```tsx
// apps/dashboard/src/components/dashboard/funnel-strip.tsx
import { SectionLabel } from "./section-label";

interface FunnelStage {
  name: string;
  count: number;
}

interface FunnelStripProps {
  stages: FunnelStage[];
}

export function FunnelStrip({ stages }: FunnelStripProps) {
  return (
    <div>
      <SectionLabel>Pipeline</SectionLabel>
      <div
        style={{
          marginTop: "12px",
          background: "var(--sw-surface-raised)",
          border: "1px solid var(--sw-border)",
          borderRadius: "12px",
          padding: "24px",
          display: "flex",
          alignItems: "center",
        }}
        className="flex-wrap gap-y-4"
      >
        {stages.map((stage, i) => (
          <div key={stage.name} style={{ flex: 1, minWidth: "100px", textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              {i > 0 && (
                <span
                  style={{
                    color: "var(--sw-text-muted)",
                    fontSize: "14px",
                    marginRight: "12px",
                    opacity: 0.4,
                  }}
                >
                  ›
                </span>
              )}
              <div>
                <p
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "24px",
                    fontWeight: 600,
                    color: "var(--sw-text-primary)",
                    margin: 0,
                    lineHeight: 1,
                  }}
                >
                  {stage.count}
                </p>
                <p
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--sw-text-muted)",
                    marginTop: "6px",
                  }}
                >
                  {stage.name}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: RevenueSummary**

```tsx
// apps/dashboard/src/components/dashboard/revenue-summary.tsx
import { SectionLabel } from "./section-label";

interface RevenueSummaryProps {
  total: number;
  count: number;
  topSource: { name: string; amount: number } | null;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function RevenueSummary({ total, count, topSource }: RevenueSummaryProps) {
  return (
    <div>
      <SectionLabel>Revenue (7d)</SectionLabel>
      <div
        style={{
          marginTop: "12px",
          background: "var(--sw-surface-raised)",
          border: "1px solid var(--sw-border)",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "32px",
            fontWeight: 600,
            color: "var(--sw-text-primary)",
            margin: 0,
            lineHeight: 1,
          }}
        >
          {formatCurrency(total)}
        </p>
        <p style={{ fontSize: "14px", color: "var(--sw-text-secondary)", marginTop: "8px" }}>
          {count === 0
            ? "No revenue recorded in the last 7 days"
            : `from ${count} transaction${count !== 1 ? "s" : ""}`}
        </p>
        {topSource && (
          <p style={{ fontSize: "14px", color: "var(--sw-text-secondary)", marginTop: "4px" }}>
            Top: {topSource.name} · {formatCurrency(topSource.amount)}
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: ActivityEvent and ActivityFeed**

```tsx
// apps/dashboard/src/components/dashboard/activity-event.tsx
import { formatRelative } from "@/lib/format";

interface ActivityEventProps {
  description: string;
  dotColor: "green" | "amber" | "blue" | "gray";
  createdAt: string;
}

const DOT_CSS: Record<string, string> = {
  green: "hsl(145, 45%, 42%)",
  amber: "var(--sw-accent)",
  blue: "hsl(210, 50%, 50%)",
  gray: "var(--sw-text-muted)",
};

export function ActivityEvent({ description, dotColor, createdAt }: ActivityEventProps) {
  return (
    <div style={{ display: "flex", alignItems: "start", gap: "12px", padding: "12px 0" }}>
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: DOT_CSS[dotColor] ?? DOT_CSS.gray,
          marginTop: "7px",
          flexShrink: 0,
        }}
      />
      <p style={{ flex: 1, fontSize: "16px", color: "var(--sw-text-primary)", margin: 0 }}>
        {description}
      </p>
      <time style={{ fontSize: "13px", color: "var(--sw-text-muted)", flexShrink: 0 }}>
        {formatRelative(createdAt)}
      </time>
    </div>
  );
}
```

```tsx
// apps/dashboard/src/components/dashboard/activity-feed.tsx
import Link from "next/link";
import { ActivityEvent } from "./activity-event";
import { SectionLabel } from "./section-label";

interface ActivityItem {
  id: string;
  description: string;
  dotColor: "green" | "amber" | "blue" | "gray";
  createdAt: string;
}

interface ActivityFeedProps {
  events: ActivityItem[];
}

export function ActivityFeed({ events }: ActivityFeedProps) {
  return (
    <div>
      <SectionLabel>Recent Activity</SectionLabel>
      <div style={{ marginTop: "12px" }}>
        {events.length === 0 ? (
          <p style={{ fontSize: "16px", color: "var(--sw-text-secondary)", padding: "12px 0" }}>
            No activity yet. When Alex takes action, it will appear here.
          </p>
        ) : (
          events.map((event, i) => (
            <div
              key={event.id}
              style={
                i < events.length - 1 ? { borderBottom: "1px solid var(--sw-border)" } : undefined
              }
            >
              <ActivityEvent
                description={event.description}
                dotColor={event.dotColor}
                createdAt={event.createdAt}
              />
            </div>
          ))
        )}
        {events.length > 0 && (
          <Link
            href="/dashboard"
            style={{
              display: "inline-block",
              marginTop: "16px",
              fontSize: "14px",
              color: "var(--sw-accent)",
              textDecoration: "none",
            }}
          >
            See all activity →
          </Link>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: OwnerTaskRow and OwnerTaskList**

```tsx
// apps/dashboard/src/components/dashboard/owner-task-row.tsx
"use client";

import { useState } from "react";

interface OwnerTaskRowProps {
  id: string;
  title: string;
  dueAt: string | null;
  isOverdue: boolean;
  onComplete: (id: string) => void;
}

export function OwnerTaskRow({ id, title, dueAt, isOverdue, onComplete }: OwnerTaskRowProps) {
  const [completed, setCompleted] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 20px",
        opacity: completed ? 0.5 : 1,
        transition: "opacity 200ms ease-out",
      }}
    >
      <button
        onClick={() => {
          setCompleted(true);
          onComplete(id);
        }}
        disabled={completed}
        style={{
          width: "20px",
          height: "20px",
          borderRadius: "4px",
          border: completed ? "none" : "1px solid var(--sw-border)",
          background: completed ? "var(--sw-accent)" : "transparent",
          cursor: completed ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          transition: "background 200ms ease-out, border-color 200ms ease-out",
        }}
      >
        {completed && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 6l3 3 5-5"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      <span
        style={{
          flex: 1,
          fontSize: "16px",
          color: "var(--sw-text-primary)",
          textDecoration: completed ? "line-through" : "none",
        }}
      >
        {title}
      </span>
      {dueAt && (
        <span
          style={{
            fontSize: "13px",
            color: isOverdue ? "hsl(0, 38%, 40%)" : "var(--sw-text-muted)",
          }}
        >
          {isOverdue
            ? "Overdue"
            : new Date(dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      )}
    </div>
  );
}
```

```tsx
// apps/dashboard/src/components/dashboard/owner-task-list.tsx
import { OwnerTaskRow } from "./owner-task-row";
import { SectionLabel } from "./section-label";

interface TaskData {
  id: string;
  title: string;
  dueAt: string | null;
  isOverdue: boolean;
}

interface OwnerTaskListProps {
  tasks: TaskData[];
  onComplete: (id: string) => void;
}

export function OwnerTaskList({ tasks, onComplete }: OwnerTaskListProps) {
  if (tasks.length === 0) return null;

  return (
    <div>
      <SectionLabel>Your Tasks</SectionLabel>
      <div
        style={{
          marginTop: "12px",
          background: "var(--sw-surface-raised)",
          border: "1px solid var(--sw-border)",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      >
        {tasks.map((task, i) => (
          <div
            key={task.id}
            style={
              i < tasks.length - 1 ? { borderBottom: "1px solid var(--sw-border)" } : undefined
            }
          >
            <OwnerTaskRow
              id={task.id}
              title={task.title}
              dueAt={task.dueAt}
              isOverdue={task.isOverdue}
              onComplete={onComplete}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit 2>&1 | grep -iE "funnel|revenue-summary|activity|owner-task"`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/dashboard/funnel-strip.tsx apps/dashboard/src/components/dashboard/revenue-summary.tsx apps/dashboard/src/components/dashboard/activity-event.tsx apps/dashboard/src/components/dashboard/activity-feed.tsx apps/dashboard/src/components/dashboard/owner-task-row.tsx apps/dashboard/src/components/dashboard/owner-task-list.tsx
git commit -m "$(cat <<'EOF'
feat: add FunnelStrip, RevenueSummary, ActivityFeed, OwnerTaskList components
EOF
)"
```

---

## Task 11: Rewrite OwnerToday Composition

Replace the existing `owner-today.tsx` with the new composition that uses the aggregate endpoint and shared components.

**Files:**

- Rewrite: `apps/dashboard/src/components/dashboard/owner-today.tsx`

- [ ] **Step 1: Rewrite the component**

```tsx
// apps/dashboard/src/components/dashboard/owner-today.tsx
"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { queryKeys } from "@/lib/query-keys";
import { useDashboardOverview } from "@/hooks/use-dashboard-overview";
import { useFirstRun } from "@/hooks/use-first-run";
import { FirstRunBanner } from "@/components/dashboard/first-run-banner";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { StatCardGrid } from "@/components/dashboard/stat-card-grid";
import { SectionLabel } from "@/components/dashboard/section-label";
import { ActionCard } from "@/components/dashboard/action-card";
import { BookingPreview } from "@/components/dashboard/booking-preview";
import { FunnelStrip } from "@/components/dashboard/funnel-strip";
import { RevenueSummary } from "@/components/dashboard/revenue-summary";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { OwnerTaskList } from "@/components/dashboard/owner-task-list";
import { CONSEQUENCE } from "@/lib/approval-constants";

export function OwnerToday() {
  const { data: session } = useSession();
  const { data: overview, isLoading } = useDashboardOverview();
  const { isFirstRun, dismissBanner } = useFirstRun();
  const queryClient = useQueryClient();
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const { toast } = useToast();

  const respondMutation = useMutation({
    mutationFn: async ({
      approvalId,
      action,
      bindingHash,
    }: {
      approvalId: string;
      action: string;
      bindingHash: string;
    }) => {
      const res = await fetch("/api/dashboard/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId,
          action,
          respondedBy: (session as { principalId?: string })?.principalId ?? "dashboard-user",
          bindingHash,
        }),
      });
      if (!res.ok) throw new Error("Failed to respond");
      return res.json();
    },
    onSuccess: (_data, variables) => {
      toast({
        title: variables.action === "approve" ? "Approved" : "Declined",
        description:
          variables.action === "approve"
            ? "The action will proceed."
            : "The action has been blocked.",
      });
    },
    onError: () => {
      toast({
        title: "Something went wrong",
        description: "Try again or check your connection.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setRespondingId(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
    },
  });

  const handleTaskComplete = async (taskId: string) => {
    await fetch("/api/dashboard/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, status: "completed" }),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  };

  if (isLoading || !overview) {
    return (
      <div style={{ maxWidth: "64rem", margin: "0 auto", padding: "48px" }}>
        <div
          style={{
            height: "32px",
            background: "var(--sw-surface)",
            borderRadius: "8px",
            width: "200px",
            marginBottom: "48px",
          }}
        />
        <div
          style={{ display: "grid", gap: "16px" }}
          className="grid-cols-2 md:grid-cols-3 lg:grid-cols-6"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: "96px",
                background: "var(--sw-surface-raised)",
                border: "1px solid var(--sw-border)",
                borderRadius: "12px",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  const stats = [
    { label: "Pending approvals", value: overview.stats.pendingApprovals },
    {
      label: "New inquiries",
      value: overview.stats.newInquiriesToday,
      delta:
        overview.stats.newInquiriesYesterday > 0
          ? {
              direction: (overview.stats.newInquiriesToday >= overview.stats.newInquiriesYesterday
                ? "up"
                : "down") as "up" | "down",
              text: `${Math.abs(overview.stats.newInquiriesToday - overview.stats.newInquiriesYesterday)} vs yesterday`,
            }
          : undefined,
    },
    { label: "Qualified leads", value: overview.stats.qualifiedLeads },
    { label: "Bookings today", value: overview.stats.bookingsToday },
    {
      label: "Revenue (7d)",
      value: `$${overview.stats.revenue7d.total.toLocaleString()}`,
    },
    {
      label: "Open tasks",
      value: overview.stats.openTasks,
      badge:
        overview.stats.overdueTasks > 0
          ? { text: `${overview.stats.overdueTasks} overdue`, variant: "overdue" as const }
          : undefined,
    },
  ];

  const funnelStages = [
    { name: "Inquiry", count: overview.funnel.inquiry },
    { name: "Qualified", count: overview.funnel.qualified },
    { name: "Booked", count: overview.funnel.booked },
    { name: "Purchased", count: overview.funnel.purchased },
    { name: "Completed", count: overview.funnel.completed },
  ];

  const totalApprovals =
    overview.approvals.length +
    (overview.stats.pendingApprovals > 3 ? overview.stats.pendingApprovals - 3 : 0);

  return (
    <div
      style={{
        maxWidth: "64rem",
        margin: "0 auto",
        padding: "48px",
        background: "var(--sw-base)",
        minHeight: "100vh",
      }}
      className="px-6 md:px-12"
    >
      {/* Header */}
      <DashboardHeader overview={overview} />

      {/* First Run Banner */}
      {isFirstRun && (
        <div style={{ marginTop: "32px" }}>
          <FirstRunBanner onDismiss={dismissBanner} />
        </div>
      )}

      {/* Stat Cards */}
      <div style={{ marginTop: "48px" }}>
        <StatCardGrid stats={stats} />
      </div>

      {/* Action Zone */}
      <div
        style={{ marginTop: "48px", display: "grid", gap: "24px" }}
        className="grid-cols-1 lg:grid-cols-[1fr_1fr]"
      >
        {/* Needs Your Attention */}
        <div>
          <SectionLabel>Needs Your Attention</SectionLabel>
          <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
            {overview.approvals.length === 0 ? (
              <div
                style={{
                  background: "var(--sw-surface-raised)",
                  border: "1px solid var(--sw-border)",
                  borderRadius: "12px",
                  padding: "24px",
                  textAlign: "center",
                }}
              >
                <p style={{ fontSize: "16px", color: "var(--sw-text-secondary)", margin: 0 }}>
                  All caught up
                </p>
              </div>
            ) : (
              <>
                {overview.approvals.map((approval) => (
                  <ActionCard
                    key={approval.id}
                    summary={approval.summary}
                    context={CONSEQUENCE[approval.riskCategory] ?? CONSEQUENCE.medium}
                    createdAt={approval.createdAt}
                    actions={[
                      {
                        label: respondingId === approval.id ? "Approving..." : "Approve",
                        variant: "primary",
                        onClick: () => {
                          setRespondingId(approval.id);
                          respondMutation.mutate({
                            approvalId: approval.id,
                            action: "approve",
                            bindingHash: approval.bindingHash,
                          });
                        },
                        loading: respondingId === approval.id && respondMutation.isPending,
                        disabled: respondingId === approval.id,
                      },
                      {
                        label: respondingId === approval.id ? "Declining..." : "Not now",
                        variant: "secondary",
                        onClick: () => {
                          setRespondingId(approval.id);
                          respondMutation.mutate({
                            approvalId: approval.id,
                            action: "reject",
                            bindingHash: approval.bindingHash,
                          });
                        },
                        loading: respondingId === approval.id && respondMutation.isPending,
                        disabled: respondingId === approval.id,
                      },
                    ]}
                  />
                ))}
                {totalApprovals > 3 && (
                  <Link
                    href="/decide"
                    style={{ fontSize: "14px", color: "var(--sw-accent)", textDecoration: "none" }}
                  >
                    View all {totalApprovals} →
                  </Link>
                )}
              </>
            )}
          </div>
        </div>

        {/* Today's Bookings */}
        <BookingPreview bookings={overview.bookings} />
      </div>

      {/* Funnel Snapshot */}
      <div style={{ marginTop: "48px" }}>
        <FunnelStrip stages={funnelStages} />
      </div>

      {/* Revenue + Tasks row */}
      <div
        style={{ marginTop: "48px", display: "grid", gap: "24px" }}
        className={overview.tasks.length > 0 ? "grid-cols-1 lg:grid-cols-[1fr_1fr]" : ""}
      >
        <RevenueSummary
          total={overview.revenue.total}
          count={overview.revenue.count}
          topSource={overview.revenue.topSource}
        />
        <OwnerTaskList tasks={overview.tasks} onComplete={handleTaskComplete} />
      </div>

      {/* Activity Feed */}
      <div style={{ marginTop: "48px" }}>
        <ActivityFeed events={overview.activity} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit 2>&1 | grep -i "owner-today"`
Expected: No errors.

- [ ] **Step 3: Run existing dashboard tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run`
Expected: PASS (or pre-existing failures only).

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/dashboard/owner-today.tsx
git commit -m "$(cat <<'EOF'
feat: rewrite OwnerToday with aggregate endpoint and Stone & Weight design system
EOF
)"
```

---

## Task 12: Task Completion Proxy Route

The OwnerToday component calls `PATCH /api/dashboard/tasks` for task completion. Wire up the proxy.

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/tasks/route.ts`

- [ ] **Step 1: Create the proxy route**

```tsx
// apps/dashboard/src/app/api/dashboard/tasks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function PATCH(request: NextRequest) {
  try {
    const client = await getApiClient();
    const body = await request.json();
    const { taskId, status } = body;

    const res = await client.request(`/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    return NextResponse.json(res);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

Note: The `client.request()` method is `protected` on the base class. If it can't be called directly, add a public `updateTask(taskId: string, body: Record<string, unknown>)` method to the `SwitchboardClient` class instead:

```typescript
async updateTask(taskId: string, body: Record<string, unknown>) {
  return this.request(`/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
```

Then the proxy route becomes:

```typescript
const res = await client.updateTask(taskId, { status });
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/tasks/route.ts apps/dashboard/src/lib/api-client.ts
git commit -m "$(cat <<'EOF'
feat: add task completion proxy route for dashboard task checkboxes
EOF
)"
```

---

## Task 13: Owner Tasks Fastify Route

The aggregate endpoint and the task completion proxy need a Fastify route for owner tasks.

**Files:**

- Create: `apps/api/src/routes/owner-tasks.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1: Create the route**

```typescript
// apps/api/src/routes/owner-tasks.ts
import type { FastifyPluginAsync } from "fastify";
import { PrismaOwnerTaskStore } from "@switchboard/db";
import { requireOrganizationScope } from "../utils/require-org.js";

export const ownerTaskRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:orgId/tasks", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const store = new PrismaOwnerTaskStore(app.prisma);
    const tasks = await store.listOpen(orgId);

    return reply.send({
      tasks,
      openCount: tasks.openCount,
      overdueCount: tasks.overdueCount,
    });
  });

  app.patch("/:orgId/tasks/:taskId", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { taskId } = request.params as { taskId: string };
    const { status } = request.body as { status: string };

    const store = new PrismaOwnerTaskStore(app.prisma);
    const completedAt = status === "completed" ? new Date() : undefined;
    const task = await store.updateStatus(orgId, taskId, status, completedAt);

    return reply.send({ task });
  });
};
```

- [ ] **Step 2: Register the route**

Add to `apps/api/src/bootstrap/routes.ts`:

```typescript
import { ownerTaskRoutes } from "../routes/owner-tasks.js";
```

And in `registerRoutes`:

```typescript
await app.register(ownerTaskRoutes, { prefix: "/api" });
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/owner-tasks.ts apps/api/src/bootstrap/routes.ts
git commit -m "$(cat <<'EOF'
feat: add owner tasks Fastify routes (GET list, PATCH status)
EOF
)"
```

---

## Task 14: Clean Up Old StatCards

The old `stat-cards.tsx` is now superseded by `stat-card.tsx` + `stat-card-grid.tsx`. Remove the old file if nothing else imports it.

**Files:**

- Delete: `apps/dashboard/src/components/dashboard/stat-cards.tsx` (if no other imports)

- [ ] **Step 1: Check for other imports**

Run: `grep -r "stat-cards" apps/dashboard/src/ --include="*.tsx" --include="*.ts" -l`

If only `owner-today.tsx` imported it (and that's been rewritten), the old file is dead.

- [ ] **Step 2: Delete the old file**

```bash
rm apps/dashboard/src/components/dashboard/stat-cards.tsx
```

- [ ] **Step 3: Verify nothing breaks**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add -u apps/dashboard/src/components/dashboard/stat-cards.tsx
git commit -m "$(cat <<'EOF'
chore: remove old StatCards component superseded by StatCard + StatCardGrid
EOF
)"
```

---

## Task 15: Final Verification

- [ ] **Step 1: Full typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: No new errors from this work.

- [ ] **Step 2: Run all tests**

Run: `npx pnpm@9.15.4 test`
Expected: All pass (or only pre-existing failures).

- [ ] **Step 3: Lint**

Run: `npx pnpm@9.15.4 lint`
Expected: Clean.

- [ ] **Step 4: Visual verification**

Start the dev server and verify the dashboard renders correctly:

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard dev`

Open `http://localhost:3002/dashboard` in a browser. Check:

- Stone & Weight background (`#F5F3F0`)
- 6 stat cards in responsive grid
- Greeting with operational summary
- Approval action cards with amber Approve button
- Booking preview with time, service, contact
- Pipeline funnel strip with 5 stages
- Revenue summary with currency formatting
- Activity feed with colored dots and business language
- Owner tasks with checkboxes (if tasks exist)
- Mobile responsive: single column, 2-col stat cards

- [ ] **Step 5: Commit any fixes from visual testing**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: address visual polish from dashboard manual testing
EOF
)"
```
