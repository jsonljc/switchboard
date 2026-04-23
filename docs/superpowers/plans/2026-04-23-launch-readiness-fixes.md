# Launch Readiness Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 2 deployment blockers and 3 degraded-experience issues to make Switchboard launch-ready.

**Architecture:** Five independent fixes applied to the existing monorepo. Fixes 1–4 have no interdependencies and can be parallelized. Fix 5 (simulation endpoint) depends on Fix 2's `SkillRequestContext` type. Each fix is a self-contained task with tests.

**Tech Stack:** TypeScript, Fastify, Next.js, Prisma, Vitest, Docker

**Spec:** `docs/superpowers/specs/2026-04-23-launch-readiness-fixes-design.md`

---

### Task 1: Dockerfile — Copy `skills/` Directory

**Files:**

- Modify: `Dockerfile:62-64`

- [ ] **Step 1: Add the COPY line to the Dockerfile**

In `Dockerfile`, after line 63 (`COPY --from=build /app/apps/api/dist/ apps/api/dist/`), add the skills directory copy:

```dockerfile
COPY --from=build /app/skills/ skills/
```

The full context for where to insert (between the `apps/api/dist/` copy and `pnpm install --prod`):

```dockerfile
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist/ apps/api/dist/

COPY --from=build /app/skills/ skills/

RUN pnpm install --frozen-lockfile --prod
```

This places skills at `/app/skills/` in the container. The runtime resolution in `skill-mode.ts:44` does `new URL("../../../../skills", import.meta.url).pathname` from `apps/api/dist/bootstrap/skill-mode.js`, which walks up 4 directories to `/app/skills/`.

- [ ] **Step 2: Verify Docker build succeeds**

Run: `docker build --target api -t switchboard-api-test .`
Expected: Build completes successfully

- [ ] **Step 3: Commit**

```bash
git commit -m "fix: copy skills/ directory into Docker API stage"
```

---

### Task 2: Escalate Tool — Per-Request Instantiation

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts`
- Modify: `packages/core/src/skill-runtime/tools/escalate.ts`
- Modify: `packages/core/src/skill-runtime/tools/escalate.test.ts`
- Modify: `packages/core/src/skill-runtime/tools/index.ts`
- Modify: `packages/core/src/skill-runtime/index.ts`
- Modify: `apps/api/src/bootstrap/skill-mode.ts`

- [ ] **Step 1: Add `SkillRequestContext` to types.ts**

In `packages/core/src/skill-runtime/types.ts`, add after the `ContextResolutionError` class (end of file, before the closing):

```typescript
// ---------------------------------------------------------------------------
// Request Context (per-request identity, never shared across requests)
// ---------------------------------------------------------------------------

export interface SkillRequestContext {
  sessionId: string;
  orgId: string;
  deploymentId: string;
  actorId?: string;
  traceId?: string;
  surface?: "chat" | "simulation" | "api" | "system";
}
```

- [ ] **Step 2: Export `SkillRequestContext` from the barrel**

In `packages/core/src/skill-runtime/index.ts`, add `SkillRequestContext` to the existing type export block. Find:

```typescript
export type {
  SkillDefinition,
  ParameterDeclaration,
  ParameterType,
  SkillExecutionParams,
  SkillExecutionResult,
  ToolCallRecord,
  SkillTool,
  SkillToolOperation,
  SkillExecutor,
  OutputFieldDeclaration,
  SkillExecutionTraceData,
  SkillExecutionTrace,
} from "./types.js";
```

Add `SkillRequestContext` to the list:

```typescript
export type {
  SkillDefinition,
  ParameterDeclaration,
  ParameterType,
  SkillExecutionParams,
  SkillExecutionResult,
  ToolCallRecord,
  SkillTool,
  SkillToolOperation,
  SkillExecutor,
  OutputFieldDeclaration,
  SkillExecutionTraceData,
  SkillExecutionTrace,
  SkillRequestContext,
} from "./types.js";
```

- [ ] **Step 3: Write failing test for factory-based escalate tool**

In `packages/core/src/skill-runtime/tools/escalate.test.ts`, replace the entire file:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEscalateToolFactory } from "./escalate.js";
import type { HandoffReason } from "../../handoff/types.js";
import type { SkillRequestContext } from "../types.js";

function makeBaseDeps() {
  return {
    assembler: {
      assemble: vi.fn().mockReturnValue({
        id: "handoff_123",
        sessionId: "sess_1",
        organizationId: "org_1",
        reason: "missing_knowledge" as HandoffReason,
        status: "pending" as const,
        leadSnapshot: { channel: "whatsapp" },
        qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
        conversationSummary: {
          turnCount: 3,
          keyTopics: [],
          objectionHistory: [],
          sentiment: "neutral",
        },
        slaDeadlineAt: new Date(),
        createdAt: new Date(),
      }),
    },
    handoffStore: {
      save: vi.fn().mockResolvedValue(undefined),
      getBySessionId: vi.fn().mockResolvedValue(null),
    },
    notifier: {
      notify: vi.fn().mockResolvedValue(undefined),
    },
  };
}

const TEST_CONTEXT: SkillRequestContext = {
  sessionId: "sess_1",
  orgId: "org_1",
  deploymentId: "deploy_1",
  traceId: "trace_1",
  surface: "chat",
};

describe("escalate tool factory", () => {
  let baseDeps: ReturnType<typeof makeBaseDeps>;

  beforeEach(() => {
    baseDeps = makeBaseDeps();
  });

  it("factory returns a tool with id 'escalate'", () => {
    const factory = createEscalateToolFactory(baseDeps);
    const tool = factory(TEST_CONTEXT);
    expect(tool.id).toBe("escalate");
  });

  it("has handoff.create operation with effectCategory write", () => {
    const factory = createEscalateToolFactory(baseDeps);
    const tool = factory(TEST_CONTEXT);
    expect(tool.operations["handoff.create"]).toBeDefined();
    expect(tool.operations["handoff.create"]!.effectCategory).toBe("write");
  });

  it("creates a handoff package using request context IDs", async () => {
    const factory = createEscalateToolFactory(baseDeps);
    const tool = factory(TEST_CONTEXT);
    const result = await tool.operations["handoff.create"]!.execute({
      reason: "missing_knowledge",
      summary: "Customer asked about parking, no data available",
      customerSentiment: "neutral",
    });

    expect(baseDeps.assembler.assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_1",
        organizationId: "org_1",
        reason: "missing_knowledge",
      }),
    );
    expect(baseDeps.handoffStore.save).toHaveBeenCalled();
    expect(baseDeps.notifier.notify).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        status: "success",
        data: { handoffId: "handoff_123", status: "pending" },
      }),
    );
  });

  it("uses different IDs for different request contexts", async () => {
    const factory = createEscalateToolFactory(baseDeps);

    const ctx2: SkillRequestContext = {
      sessionId: "sess_2",
      orgId: "org_2",
      deploymentId: "deploy_2",
    };

    const tool = factory(ctx2);
    await tool.operations["handoff.create"]!.execute({
      reason: "missing_knowledge",
      summary: "test",
    });

    expect(baseDeps.assembler.assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_2",
        organizationId: "org_2",
      }),
    );
  });

  it("returns existing handoff if one is pending for same session (duplicate guard)", async () => {
    baseDeps.handoffStore.getBySessionId.mockResolvedValue({
      id: "handoff_existing",
      status: "pending",
    });
    const factory = createEscalateToolFactory(baseDeps);
    const tool = factory(TEST_CONTEXT);
    const result = await tool.operations["handoff.create"]!.execute({
      reason: "missing_knowledge",
      summary: "duplicate attempt",
    });

    expect(baseDeps.assembler.assemble).not.toHaveBeenCalled();
    expect(baseDeps.handoffStore.save).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        status: "success",
        data: { handoffId: "handoff_existing", status: "already_pending" },
      }),
    );
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run escalate.test`
Expected: FAIL — `createEscalateToolFactory` is not exported

- [ ] **Step 5: Implement the factory-based escalate tool**

Replace the contents of `packages/core/src/skill-runtime/tools/escalate.ts`:

```typescript
import type { SkillTool } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok } from "../tool-result.js";
import type { AssemblerInput } from "../../handoff/package-assembler.js";
import type { HandoffPackage, HandoffReason, HandoffStore } from "../../handoff/types.js";
import type { SkillRequestContext } from "../types.js";

interface EscalateToolBaseDeps {
  assembler: { assemble(input: AssemblerInput): HandoffPackage };
  handoffStore: Pick<HandoffStore, "save" | "getBySessionId">;
  notifier: { notify(pkg: HandoffPackage): Promise<void> };
}

interface EscalateInput {
  reason: HandoffReason;
  summary: string;
  customerSentiment?: "positive" | "neutral" | "frustrated" | "angry";
}

export type EscalateToolFactory = (ctx: SkillRequestContext) => SkillTool;

export function createEscalateToolFactory(deps: EscalateToolBaseDeps): EscalateToolFactory {
  return (ctx: SkillRequestContext): SkillTool => ({
    id: "escalate",
    operations: {
      "handoff.create": {
        description:
          "Escalate the conversation to a human team member. Use when the customer's question is outside your scope, when business knowledge is missing, or when the customer is frustrated.",
        effectCategory: "write" as const,
        idempotent: false,
        inputSchema: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              enum: [
                "human_requested",
                "missing_knowledge",
                "complex_objection",
                "negative_sentiment",
                "compliance_concern",
                "booking_failure",
                "max_turns_exceeded",
              ],
            },
            summary: {
              type: "string",
              description: "Brief summary of why escalation is needed and what the customer wants",
            },
            customerSentiment: {
              type: "string",
              enum: ["positive", "neutral", "frustrated", "angry"],
            },
          },
          required: ["reason", "summary"],
        },
        execute: async (params: unknown): Promise<ToolResult> => {
          const input = params as EscalateInput;

          const existing = await deps.handoffStore.getBySessionId(ctx.sessionId);
          if (existing && (existing.status === "pending" || existing.status === "assigned")) {
            return ok({ handoffId: existing.id, status: "already_pending" });
          }

          const pkg = deps.assembler.assemble({
            sessionId: ctx.sessionId,
            organizationId: ctx.orgId,
            reason: input.reason,
            leadSnapshot: { channel: "whatsapp" },
            qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
            messages: [],
          });

          await deps.handoffStore.save(pkg);
          await deps.notifier.notify(pkg);

          return ok({ handoffId: pkg.id, status: "pending" });
        },
      },
    },
  });
}
```

- [ ] **Step 6: Update the tools barrel export**

In `packages/core/src/skill-runtime/tools/index.ts`, replace:

```typescript
export { createEscalateTool } from "./escalate.js";
```

With:

```typescript
export { createEscalateToolFactory } from "./escalate.js";
export type { EscalateToolFactory } from "./escalate.js";
```

- [ ] **Step 7: Update the skill-runtime barrel export**

In `packages/core/src/skill-runtime/index.ts`, find:

```typescript
  createEscalateTool,
```

Replace with:

```typescript
  createEscalateToolFactory,
```

Also add to the type exports near the tools section:

```typescript
export type { EscalateToolFactory } from "./tools/index.js";
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --run escalate.test`
Expected: PASS — all 5 tests pass

- [ ] **Step 9: Update skill-mode.ts to use the factory**

In `apps/api/src/bootstrap/skill-mode.ts`, make these changes:

1. In the import block (line 24), change `createEscalateTool` to `createEscalateToolFactory`:

```typescript
    createEscalateToolFactory,
```

2. Replace the `toolsMap` construction (lines 107-160). Remove the escalate entry from the static map and store the factory separately:

```typescript
const baseTools = new Map([
  ["crm-query", createCrmQueryTool(contactStore, activityStore)],
  ["crm-write", createCrmWriteTool(opportunityStore, activityStore)],
  [
    "calendar-book",
    createCalendarBookTool({
      calendarProvider,
      bookingStore,
      opportunityStore: {
        findActiveByContact: async (orgId: string, contactId: string) => {
          const active = await opportunityStore.findActiveByContact(orgId, contactId);
          return active.length > 0 ? { id: active[0]!.id } : null;
        },
        create: async (input: { organizationId: string; contactId: string; service: string }) => {
          const created = await opportunityStore.create({
            organizationId: input.organizationId,
            contactId: input.contactId,
            serviceId: input.service,
            serviceName: input.service,
          });
          return { id: created.id };
        },
      },
      runTransaction: (
        fn: (tx: {
          booking: {
            update(args: {
              where: { id: string };
              data: Record<string, unknown>;
            }): Promise<unknown>;
          };
          outboxEvent: {
            create(args: { data: Record<string, unknown> }): Promise<unknown>;
          };
        }) => Promise<unknown>,
      ) =>
        prismaClient.$transaction((tx) => fn({ booking: tx.booking, outboxEvent: tx.outboxEvent })),
      failureHandler,
    }),
  ],
]);

const escalateFactory = createEscalateToolFactory({
  assembler: handoffAssembler,
  handoffStore,
  notifier: handoffNotifier,
});
```

3. Update the `SkillExecutorImpl` construction (around line 166) to include all tools including escalate at boot for tool schema registration. The executor needs the tool schemas to build Anthropic tool definitions. Create the full tools map by merging base + a default escalate instance:

```typescript
const toolsMap = new Map(baseTools);
toolsMap.set(
  "escalate",
  escalateFactory({
    sessionId: "__schema_only__",
    orgId: "__schema_only__",
    deploymentId: "__schema_only__",
  }),
);
```

Note: This instance is only used for schema registration (building Anthropic tool definitions). The actual escalate tool used at execution time must be bound with real request context. This is handled at the `SkillMode` execution call site where `escalateFactory(realContext)` produces the per-request tool.

4. Store the factory on the SkillMode for use at execution time. Update the `SkillMode` construction to pass the factory:

In the `modeRegistry.register(new SkillMode({...}))` call, add `escalateFactory`:

```typescript
  modeRegistry.register(
    new SkillMode({
      executor: skillExecutor,
      skillsBySlug,
      builderRegistry,
      escalateFactory,
      stores: {
```

- [ ] **Step 10: Run all tests to verify nothing broke**

Run: `pnpm test -- --run`
Expected: All tests pass. Any test that used `createEscalateTool` directly will need updating — check for compilation errors.

- [ ] **Step 11: Commit**

```bash
git commit -m "fix: make escalate tool per-request with SkillRequestContext

Replace singleton createEscalateTool with createEscalateToolFactory.
Identity (sessionId, orgId) is now bound per-request, not at boot.
Removes bootstrap-placeholder values entirely."
```

---

### Task 3: LocalCalendarProvider — First-Class Fallback

**Files:**

- Create: `packages/core/src/calendar/local-calendar-provider.ts`
- Create: `packages/core/src/calendar/local-calendar-provider.test.ts`
- Modify: `apps/api/src/bootstrap/skill-mode.ts` (the `resolveCalendarProvider` function and `STUB_CALENDAR_PROVIDER`)

- [ ] **Step 1: Write failing tests for LocalCalendarProvider**

Create `packages/core/src/calendar/local-calendar-provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalCalendarProvider } from "./local-calendar-provider.js";
import type { BusinessHoursConfig, SlotQuery } from "@switchboard/schemas";

const BUSINESS_HOURS: BusinessHoursConfig = {
  timezone: "Asia/Singapore",
  days: [
    { day: 1, open: "09:00", close: "18:00" },
    { day: 2, open: "09:00", close: "18:00" },
    { day: 3, open: "09:00", close: "18:00" },
    { day: 4, open: "09:00", close: "18:00" },
    { day: 5, open: "09:00", close: "18:00" },
  ],
  defaultDurationMinutes: 30,
  bufferMinutes: 15,
  slotIncrementMinutes: 30,
};

function makeBookingStore() {
  return {
    findOverlapping: vi.fn().mockResolvedValue([]),
    createInTransaction: vi.fn().mockResolvedValue({ id: "booking_1" }),
    findById: vi.fn().mockResolvedValue(null),
    cancel: vi.fn().mockResolvedValue(undefined),
    reschedule: vi.fn().mockResolvedValue({ id: "booking_1" }),
  };
}

describe("LocalCalendarProvider", () => {
  let store: ReturnType<typeof makeBookingStore>;
  let provider: LocalCalendarProvider;

  beforeEach(() => {
    store = makeBookingStore();
    provider = new LocalCalendarProvider({
      businessHours: BUSINESS_HOURS,
      bookingStore: store,
    });
  });

  describe("listAvailableSlots", () => {
    it("generates slots from business hours for a weekday", async () => {
      // Monday 2026-04-27
      const query: SlotQuery = {
        dateFrom: "2026-04-27T00:00:00+08:00",
        dateTo: "2026-04-27T23:59:59+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
        bufferMinutes: 15,
      };

      const slots = await provider.listAvailableSlots(query);
      expect(slots.length).toBeGreaterThan(0);
      expect(slots.every((s) => s.available)).toBe(true);
      expect(slots.every((s) => s.calendarId === "local")).toBe(true);
    });

    it("returns no slots for a weekend (Saturday)", async () => {
      // Saturday 2026-04-25
      const query: SlotQuery = {
        dateFrom: "2026-04-25T00:00:00+08:00",
        dateTo: "2026-04-25T23:59:59+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
        bufferMinutes: 15,
      };

      const slots = await provider.listAvailableSlots(query);
      expect(slots).toHaveLength(0);
    });

    it("excludes slots that overlap with existing bookings", async () => {
      store.findOverlapping.mockResolvedValue([
        {
          startsAt: new Date("2026-04-27T09:00:00+08:00"),
          endsAt: new Date("2026-04-27T09:30:00+08:00"),
        },
      ]);

      const query: SlotQuery = {
        dateFrom: "2026-04-27T09:00:00+08:00",
        dateTo: "2026-04-27T10:00:00+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
        bufferMinutes: 15,
      };

      const slots = await provider.listAvailableSlots(query);
      const nineAm = slots.find((s) => s.start.includes("01:00:00"));
      expect(nineAm).toBeUndefined();
    });
  });

  describe("createBooking", () => {
    it("creates a booking with provider=local and local- prefixed calendarEventId", async () => {
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
      });

      expect(result.calendarEventId).toMatch(/^local-/);
      expect(result.status).toBe("confirmed");
      expect(store.createInTransaction).toHaveBeenCalled();
    });

    it("throws when slot conflicts with existing booking", async () => {
      store.createInTransaction.mockRejectedValue(new Error("SLOT_CONFLICT"));

      await expect(
        provider.createBooking({
          contactId: "c1",
          organizationId: "org1",
          slot: {
            start: "2026-04-27T09:00:00+08:00",
            end: "2026-04-27T09:30:00+08:00",
            calendarId: "local",
            available: true,
          },
          service: "consultation",
        }),
      ).rejects.toThrow("SLOT_CONFLICT");
    });
  });

  describe("healthCheck", () => {
    it("returns degraded status", async () => {
      const health = await provider.healthCheck();
      expect(health.status).toBe("degraded");
      expect(health.latencyMs).toBe(0);
    });
  });

  describe("getBooking", () => {
    it("delegates to store", async () => {
      store.findById.mockResolvedValue({ id: "b1", status: "confirmed" });
      const result = await provider.getBooking("b1");
      expect(result).toBeTruthy();
      expect(store.findById).toHaveBeenCalledWith("b1");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/core test -- --run local-calendar-provider.test`
Expected: FAIL — `LocalCalendarProvider` does not exist

- [ ] **Step 3: Implement LocalCalendarProvider**

Create `packages/core/src/calendar/local-calendar-provider.ts`:

```typescript
import { randomUUID } from "node:crypto";
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

export interface LocalBookingStore {
  findOverlapping(
    orgId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<Array<{ startsAt: Date; endsAt: Date }>>;
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
  cancel(bookingId: string): Promise<void>;
  reschedule(bookingId: string, newSlot: { start: string; end: string }): Promise<{ id: string }>;
}

interface LocalCalendarProviderConfig {
  businessHours: BusinessHoursConfig;
  bookingStore: LocalBookingStore;
}

// All slot calculations and DB comparisons are performed in UTC.
// BusinessHoursConfig is converted to UTC at query time via generateAvailableSlots.
// Bookings are stored as UTC timestamps in Prisma (DateTime fields default to UTC).

export class LocalCalendarProvider implements CalendarProvider {
  private readonly businessHours: BusinessHoursConfig;
  private readonly store: LocalBookingStore;

  constructor(config: LocalCalendarProviderConfig) {
    this.businessHours = config.businessHours;
    this.store = config.bookingStore;
  }

  async listAvailableSlots(query: SlotQuery): Promise<TimeSlot[]> {
    const existingBookings = await this.store.findOverlapping(
      "",
      new Date(query.dateFrom),
      new Date(query.dateTo),
    );

    const busyPeriods = existingBookings.map((b) => ({
      start: b.startsAt.toISOString(),
      end: b.endsAt.toISOString(),
    }));

    return generateAvailableSlots({
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      durationMinutes: query.durationMinutes,
      bufferMinutes: query.bufferMinutes,
      businessHours: this.businessHours,
      busyPeriods,
      calendarId: "local",
    });
  }

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    const calendarEventId = `local-${randomUUID()}`;

    const result = await this.store.createInTransaction({
      organizationId: input.organizationId,
      contactId: input.contactId,
      opportunityId: input.opportunityId ?? null,
      service: input.service,
      startsAt: new Date(input.slot.start),
      endsAt: new Date(input.slot.end),
      timezone: "Asia/Singapore",
      status: "confirmed",
      calendarEventId,
      attendeeName: input.attendeeName ?? null,
      attendeeEmail: input.attendeeEmail ?? null,
      createdByType: input.createdByType ?? "agent",
      sourceChannel: input.sourceChannel ?? null,
      workTraceId: input.workTraceId ?? null,
    });

    return {
      id: result.id,
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
      timezone: "Asia/Singapore",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async cancelBooking(bookingId: string, _reason?: string): Promise<void> {
    await this.store.cancel(bookingId);
  }

  async rescheduleBooking(bookingId: string, newSlot: TimeSlot): Promise<Booking> {
    const result = await this.store.reschedule(bookingId, {
      start: newSlot.start,
      end: newSlot.end,
    });

    return {
      id: result.id,
      contactId: "",
      organizationId: "",
      service: "",
      status: "confirmed",
      calendarEventId: null,
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

  async getBooking(bookingId: string): Promise<Booking | null> {
    return this.store.findById(bookingId);
  }

  async healthCheck(): Promise<CalendarHealthCheck> {
    return { status: "degraded", latencyMs: 0 };
  }
}
```

- [ ] **Step 4: Export LocalCalendarProvider from the calendar barrel**

Check if `packages/core/src/calendar/index.ts` exists, and add:

```typescript
export { LocalCalendarProvider } from "./local-calendar-provider.js";
export type { LocalBookingStore } from "./local-calendar-provider.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --run local-calendar-provider.test`
Expected: PASS

- [ ] **Step 6: Update skill-mode.ts to use LocalCalendarProvider as fallback**

In `apps/api/src/bootstrap/skill-mode.ts`, replace the `STUB_CALENDAR_PROVIDER` constant and the `resolveCalendarProvider` function:

```typescript
async function resolveCalendarProvider(
  prismaClient: PrismaClient,
  logger: { info(msg: string): void; error(msg: string): void },
): Promise<CalendarProvider> {
  const credentials = process.env["GOOGLE_CALENDAR_CREDENTIALS"];
  const calendarId = process.env["GOOGLE_CALENDAR_ID"];

  // Read business hours from the first org config that has them
  let businessHours: import("@switchboard/schemas").BusinessHoursConfig | null = null;
  const orgConfig = await prismaClient.organizationConfig.findFirst({
    select: { businessHours: true },
  });
  if (orgConfig?.businessHours && typeof orgConfig.businessHours === "object") {
    businessHours = orgConfig.businessHours as import("@switchboard/schemas").BusinessHoursConfig;
  }

  if (credentials && calendarId) {
    try {
      const { createGoogleCalendarProvider } = await import("./google-calendar-factory.js");
      const provider = await createGoogleCalendarProvider({
        credentials,
        calendarId,
        businessHours,
      });

      const health = await provider.healthCheck();
      logger.info(`Calendar: Google Calendar connected (${health.status}, ${health.latencyMs}ms)`);
      return provider;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Calendar: failed to initialize Google Calendar: ${msg}`);
    }
  }

  if (businessHours) {
    const { LocalCalendarProvider } = await import("@switchboard/core/calendar");
    const provider = new LocalCalendarProvider({
      businessHours,
      bookingStore: {
        findOverlapping: async (_orgId: string, startsAt: Date, endsAt: Date) => {
          return prismaClient.booking.findMany({
            where: {
              startsAt: { lt: endsAt },
              endsAt: { gt: startsAt },
              status: { notIn: ["cancelled", "failed"] },
            },
            select: { startsAt: true, endsAt: true },
          });
        },
        createInTransaction: async (input) => {
          return prismaClient.$transaction(async (tx) => {
            const conflicts = await tx.booking.findMany({
              where: {
                organizationId: input.organizationId,
                startsAt: { lt: input.endsAt },
                endsAt: { gt: input.startsAt },
                status: { notIn: ["cancelled", "failed"] },
              },
              take: 1,
            });
            if (conflicts.length > 0) {
              throw new Error("SLOT_CONFLICT: time slot is no longer available");
            }
            return tx.booking.create({ data: input });
          });
        },
        findById: async (bookingId: string) => {
          const row = await prismaClient.booking.findUnique({ where: { id: bookingId } });
          if (!row) return null;
          return {
            id: row.id,
            contactId: row.contactId,
            organizationId: row.organizationId,
            opportunityId: row.opportunityId,
            service: row.service,
            status: row.status as "confirmed",
            calendarEventId: row.calendarEventId,
            attendeeName: row.attendeeName,
            attendeeEmail: row.attendeeEmail,
            notes: null,
            createdByType: row.createdByType as "agent",
            sourceChannel: row.sourceChannel,
            workTraceId: row.workTraceId,
            rescheduledAt: row.rescheduledAt?.toISOString() ?? null,
            rescheduleCount: row.rescheduleCount,
            startsAt: row.startsAt.toISOString(),
            endsAt: row.endsAt.toISOString(),
            timezone: row.timezone,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          };
        },
        cancel: async (bookingId: string) => {
          await prismaClient.booking.update({
            where: { id: bookingId },
            data: { status: "cancelled" },
          });
        },
        reschedule: async (bookingId: string, newSlot: { start: string; end: string }) => {
          const updated = await prismaClient.booking.update({
            where: { id: bookingId },
            data: {
              startsAt: new Date(newSlot.start),
              endsAt: new Date(newSlot.end),
              rescheduledAt: new Date(),
              rescheduleCount: { increment: 1 },
            },
          });
          return { id: updated.id };
        },
      },
    });
    logger.info(
      "Calendar: using LocalCalendarProvider (business hours configured, no Google creds)",
    );
    return provider;
  }

  throw new Error(
    "Calendar unavailable: no GOOGLE_CALENDAR_CREDENTIALS and no business hours configured. " +
      "Set credentials or configure business hours in organization settings.",
  );
}
```

Delete the `STUB_CALENDAR_PROVIDER` constant entirely (lines 196-213 in the original file).

- [ ] **Step 7: Run all tests**

Run: `pnpm test -- --run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git commit -m "feat: add LocalCalendarProvider as first-class calendar fallback

Implements CalendarProvider using business hours config and DB-backed
bookings. Runtime selection: Google Calendar if credentials present,
local provider if business hours configured, explicit error otherwise.
Atomic double-booking protection via transactional overlap check."
```

---

### Task 4: Embeddings — Graceful Disable

**Files:**

- Modify: `packages/core/src/embedding-adapter.ts`
- Create: `packages/core/src/llm/disabled-embedding-adapter.ts`
- Create: `packages/core/src/llm/disabled-embedding-adapter.test.ts`
- Modify: `packages/core/src/knowledge/retrieval.ts`
- Create: `packages/core/src/knowledge/retrieval.test.ts` (or modify existing)
- Modify: `apps/api/src/bootstrap/conversation-deps.ts`
- Modify: `packages/core/src/llm/claude-embedding-adapter.ts`
- Modify: `packages/core/src/llm/voyage-embedding-adapter.ts`

- [ ] **Step 1: Add `available` to the EmbeddingAdapter interface**

In `packages/core/src/embedding-adapter.ts`, add the `available` property:

```typescript
export interface EmbeddingAdapter {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly available: boolean;
}
```

- [ ] **Step 2: Add `available = true` to existing adapters**

In `packages/core/src/llm/claude-embedding-adapter.ts`, add to the class:

```typescript
export class ClaudeEmbeddingAdapter implements EmbeddingAdapter {
  readonly dimensions = DIMENSIONS;
  readonly available = true;
```

In `packages/core/src/llm/voyage-embedding-adapter.ts`, add to the class:

```typescript
export class VoyageEmbeddingAdapter implements EmbeddingAdapter {
  readonly dimensions = DIMENSIONS;
  readonly available = true;
```

- [ ] **Step 3: Write failing test for DisabledEmbeddingAdapter**

Create `packages/core/src/llm/disabled-embedding-adapter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  DisabledEmbeddingAdapter,
  EmbeddingsUnavailableError,
} from "./disabled-embedding-adapter.js";

describe("DisabledEmbeddingAdapter", () => {
  it("reports available = false", () => {
    const adapter = new DisabledEmbeddingAdapter();
    expect(adapter.available).toBe(false);
  });

  it("has nominal dimensions = 1024", () => {
    const adapter = new DisabledEmbeddingAdapter();
    expect(adapter.dimensions).toBe(1024);
  });

  it("throws EmbeddingsUnavailableError on embed()", async () => {
    const adapter = new DisabledEmbeddingAdapter();
    await expect(adapter.embed("test")).rejects.toThrow(EmbeddingsUnavailableError);
  });

  it("throws EmbeddingsUnavailableError on embedBatch()", async () => {
    const adapter = new DisabledEmbeddingAdapter();
    await expect(adapter.embedBatch(["a", "b"])).rejects.toThrow(EmbeddingsUnavailableError);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run disabled-embedding-adapter.test`
Expected: FAIL — module does not exist

- [ ] **Step 5: Implement DisabledEmbeddingAdapter**

Create `packages/core/src/llm/disabled-embedding-adapter.ts`:

```typescript
import type { EmbeddingAdapter } from "../embedding-adapter.js";

export class EmbeddingsUnavailableError extends Error {
  constructor() {
    super("Embedding provider not configured — semantic search unavailable");
    this.name = "EmbeddingsUnavailableError";
  }
}

export class DisabledEmbeddingAdapter implements EmbeddingAdapter {
  readonly dimensions = 1024;
  readonly available = false;

  async embed(_text: string): Promise<number[]> {
    throw new EmbeddingsUnavailableError();
  }

  async embedBatch(_texts: string[]): Promise<number[][]> {
    throw new EmbeddingsUnavailableError();
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --run disabled-embedding-adapter.test`
Expected: PASS

- [ ] **Step 7: Write failing test for KnowledgeRetriever availability check**

Create or modify `packages/core/src/knowledge/retrieval.test.ts`. Add a test case:

```typescript
import { describe, it, expect, vi } from "vitest";
import { KnowledgeRetriever } from "./retrieval.js";
import { DisabledEmbeddingAdapter } from "../llm/disabled-embedding-adapter.js";

describe("KnowledgeRetriever", () => {
  it("returns empty results with EMBEDDINGS_UNAVAILABLE reason when adapter is disabled", async () => {
    const adapter = new DisabledEmbeddingAdapter();
    const store = {
      search: vi.fn(),
      upsert: vi.fn(),
      listByOrganization: vi.fn(),
    };
    const retriever = new KnowledgeRetriever({ embedding: adapter, store });

    const result = await retriever.retrieve("test query", {
      organizationId: "org1",
      agentId: "agent1",
    });

    expect(result).toEqual([]);
    expect(store.search).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run retrieval.test`
Expected: FAIL — retriever calls embed() which throws

- [ ] **Step 9: Update KnowledgeRetriever to check availability**

In `packages/core/src/knowledge/retrieval.ts`, modify the `retrieve` method:

```typescript
  async retrieve(query: string, options: RetrieveOptions): Promise<RetrievedChunk[]> {
    if (!this.embedding.available) {
      return [];
    }

    const queryEmbedding = await this.embedding.embed(query);
```

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --run retrieval.test`
Expected: PASS

- [ ] **Step 11: Update conversation-deps.ts to use DisabledEmbeddingAdapter**

In `apps/api/src/bootstrap/conversation-deps.ts`, replace the zero-vector fallback. Change the `createEmbeddingFn` assignment (lines 79-107):

```typescript
let embeddingAdapter: EmbeddingAdapter;

if (input.voyageApiKey) {
  const createEmbeddingFn: EmbeddingClient["createEmbedding"] = async (params) => {
    const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.voyageApiKey}`,
      },
      body: JSON.stringify({
        input: params.texts,
        model: "voyage-3-lite",
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Voyage API error ${resp.status}: ${body}`);
    }

    const result = (await resp.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return { embeddings: result.data.map((d) => d.embedding) };
  };

  embeddingAdapter = new ClaudeEmbeddingAdapter({
    createEmbedding: createEmbeddingFn,
    model: "voyage-3-lite",
  });
} else {
  console.warn("[boot] Embedding provider not configured — semantic search disabled");
  const { DisabledEmbeddingAdapter } = await import("@switchboard/core/llm");
  embeddingAdapter = new DisabledEmbeddingAdapter();
}
```

Update the imports at the top — remove `EmbeddingClient` from the `@switchboard/core` import if it's no longer needed at module scope, and add `EmbeddingAdapter`:

Also update the `retriever` construction to use the new `embeddingAdapter` variable:

```typescript
const retriever = new KnowledgeRetriever({
  store: knowledgeStore,
  embedding: embeddingAdapter,
});

return { llm, retriever, conversationStore, embeddingAdapter };
```

Note: remove the zero-vector error fallback inside the Voyage branch too — if Voyage returns an error, throw instead of silently returning zero vectors.

- [ ] **Step 12: Export DisabledEmbeddingAdapter from core**

Ensure `DisabledEmbeddingAdapter` and `EmbeddingsUnavailableError` are exported. Check if `packages/core/src/llm/index.ts` or `packages/core/src/index.ts` needs an export added.

- [ ] **Step 13: Propagate embedding status to dashboard health**

The dashboard has a `/api/dashboard/health` route. When embeddings are unavailable, the health response should include this. Check `apps/api/src/routes/health.ts` for the existing health check structure and add an `embeddings` entry:

```typescript
embeddings: {
  status: embeddingAdapter.available ? "connected" : "unavailable",
  detail: embeddingAdapter.available ? undefined : "Semantic search disabled — VOYAGE_API_KEY not configured",
}
```

This ensures the dashboard system health panel surfaces the degradation. Users should understand why answers may feel less contextual when knowledge search is unavailable.

- [ ] **Step 14: Run all tests**

Run: `pnpm test -- --run`
Expected: PASS — existing embedding adapter tests still pass, new tests pass

- [ ] **Step 15: Commit**

```bash
git commit -m "fix: replace zero-vector embedding fallback with graceful disable

Add DisabledEmbeddingAdapter that signals unavailability via the
available property. KnowledgeRetriever short-circuits with empty
results when embeddings are unavailable. Eliminates silent corruption
from random semantic search results."
```

---

### Task 5: Simulation Endpoint — Real Executor, Dry-Run Mode

**Depends on:** Task 2 (SkillRequestContext type and factory pattern)

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts` (extend HookResult)
- Modify: `packages/core/src/skill-runtime/skill-executor.ts` (handle substituteResult)
- Create: `packages/core/src/skill-runtime/hooks/simulation-policy-hook.ts`
- Create: `packages/core/src/skill-runtime/hooks/simulation-policy-hook.test.ts`
- Modify: `packages/core/src/skill-runtime/skill-executor.test.ts`
- Modify: `apps/api/src/routes/simulate.ts` (create new)
- Modify: `apps/api/src/bootstrap/routes.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/simulate/route.ts`

- [ ] **Step 1: Extend HookResult with substituteResult**

In `packages/core/src/skill-runtime/types.ts`, find the `HookResult` interface:

```typescript
export interface HookResult {
  proceed: boolean;
  reason?: string;
  /** When a hook blocks a tool call, this distinguishes deny from pending_approval. */
  decision?: "denied" | "pending_approval";
}
```

Add `substituteResult`:

```typescript
export interface HookResult {
  proceed: boolean;
  reason?: string;
  /** When a hook blocks a tool call, this distinguishes deny from pending_approval. */
  decision?: "denied" | "pending_approval";
  /** When set with proceed=false and decision=undefined, executor uses this instead of denied/pendingApproval. */
  substituteResult?: ToolResult;
}
```

Add the `ToolResult` import at the top of the file if not already present. Check — `ToolResult` is already imported via `import type { ToolResult } from "./tool-result.js";` in `types.ts`. If not, add it.

- [ ] **Step 2: Write failing test for substituteResult in executor**

In `packages/core/src/skill-runtime/skill-executor.test.ts`, add a test:

```typescript
it("uses substituteResult from hook when proceed=false and substituteResult is set", async () => {
  // This test verifies the executor extension for simulation mode.
  // When a hook returns { proceed: false, substituteResult: ok({...}) },
  // the executor should use the substituteResult instead of denied/pendingApproval.
  // Find the existing test setup pattern in this file and add:
  // A hook that returns substituteResult, verify the tool call record
  // uses that result instead of denied().
});
```

Note: The implementer should look at the existing test structure in `skill-executor.test.ts` and follow the same mock patterns. The test should:

1. Create a hook with `beforeToolCall` that returns `{ proceed: false, substituteResult: ok({ simulated: true }) }`
2. Execute a skill that triggers a tool call
3. Verify the tool call record's result matches the substitute, not `denied()`

- [ ] **Step 3: Update skill-executor.ts to handle substituteResult**

In `packages/core/src/skill-runtime/skill-executor.ts`, find the block at lines 230-237:

```typescript
        if (!toolHookResult.proceed) {
          if (toolHookResult.decision === "pending_approval") {
            result = pendingApproval(toolHookResult.reason ?? "Requires approval");
            governanceOutcome = "require-approval";
          } else {
            result = denied(toolHookResult.reason ?? "Denied by policy");
            governanceOutcome = "denied";
          }
```

Replace with:

```typescript
        if (!toolHookResult.proceed) {
          if (toolHookResult.substituteResult) {
            if (toolHookResult.decision) {
              throw new Error(
                `Hook invariant violated: substituteResult and decision are mutually exclusive (got decision=${toolHookResult.decision})`,
              );
            }
            result = toolHookResult.substituteResult;
            governanceOutcome = "auto-approved";
          } else if (toolHookResult.decision === "pending_approval") {
            result = pendingApproval(toolHookResult.reason ?? "Requires approval");
            governanceOutcome = "require-approval";
          } else {
            result = denied(toolHookResult.reason ?? "Denied by policy");
            governanceOutcome = "denied";
          }
```

- [ ] **Step 4: Run tests to verify existing behavior is unchanged**

Run: `pnpm --filter @switchboard/core test -- --run skill-executor`
Expected: PASS — existing tests still pass, the new code path is only triggered by hooks that set `substituteResult`

- [ ] **Step 5: Write failing test for SimulationPolicyHook**

Create `packages/core/src/skill-runtime/hooks/simulation-policy-hook.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SimulationPolicyHook } from "./simulation-policy-hook.js";
import type { ToolCallContext } from "../types.js";
import type { EffectCategory } from "../governance.js";

function makeCtx(effectCategory: EffectCategory): ToolCallContext {
  return {
    toolId: "test-tool",
    operation: "test-op",
    params: {},
    effectCategory,
    trustLevel: "guided",
  };
}

describe("SimulationPolicyHook", () => {
  const hook = new SimulationPolicyHook();

  it("has name 'simulation-policy'", () => {
    expect(hook.name).toBe("simulation-policy");
  });

  it("allows read operations", async () => {
    const result = await hook.beforeToolCall!(makeCtx("read"));
    expect(result.proceed).toBe(true);
  });

  it("allows propose operations", async () => {
    const result = await hook.beforeToolCall!(makeCtx("propose"));
    expect(result.proceed).toBe(true);
  });

  it("allows simulate operations", async () => {
    const result = await hook.beforeToolCall!(makeCtx("simulate"));
    expect(result.proceed).toBe(true);
  });

  it("blocks write operations with substituteResult", async () => {
    const result = await hook.beforeToolCall!(makeCtx("write"));
    expect(result.proceed).toBe(false);
    expect(result.substituteResult).toBeDefined();
    expect(result.substituteResult!.status).toBe("success");
    expect(result.substituteResult!.data?.simulated).toBe(true);
    expect(result.substituteResult!.data?.effect_category).toBe("write");
  });

  it("blocks external_send operations", async () => {
    const result = await hook.beforeToolCall!(makeCtx("external_send"));
    expect(result.proceed).toBe(false);
    expect(result.substituteResult!.data?.simulated).toBe(true);
  });

  it("blocks external_mutation operations", async () => {
    const result = await hook.beforeToolCall!(makeCtx("external_mutation"));
    expect(result.proceed).toBe(false);
    expect(result.substituteResult!.data?.effect_category).toBe("external_mutation");
  });

  it("blocks irreversible operations", async () => {
    const result = await hook.beforeToolCall!(makeCtx("irreversible"));
    expect(result.proceed).toBe(false);
    expect(result.substituteResult!.data?.simulated).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run simulation-policy-hook.test`
Expected: FAIL — module does not exist

- [ ] **Step 7: Implement SimulationPolicyHook**

Create `packages/core/src/skill-runtime/hooks/simulation-policy-hook.ts`:

```typescript
import type { SkillHook, ToolCallContext, HookResult } from "../types.js";
import type { EffectCategory } from "../governance.js";
import { ok } from "../tool-result.js";

const BLOCKED_CATEGORIES: EffectCategory[] = [
  "write",
  "external_send",
  "external_mutation",
  "irreversible",
];

export class SimulationPolicyHook implements SkillHook {
  name = "simulation-policy";

  async beforeToolCall(ctx: ToolCallContext): Promise<HookResult> {
    if (BLOCKED_CATEGORIES.includes(ctx.effectCategory)) {
      return {
        proceed: false,
        reason: "simulation_mode",
        substituteResult: ok({
          simulated: true,
          action: `would_execute_${ctx.operation}`,
          blocked_reason: "simulation_mode",
          effect_category: ctx.effectCategory,
        }),
      };
    }
    return { proceed: true };
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --run simulation-policy-hook.test`
Expected: PASS

- [ ] **Step 9: Export SimulationPolicyHook**

In `packages/core/src/skill-runtime/index.ts`, add:

```typescript
export { SimulationPolicyHook } from "./hooks/simulation-policy-hook.js";
```

- [ ] **Step 10: Create the API simulate route**

Create `apps/api/src/routes/simulate.ts`:

```typescript
import type { FastifyPluginAsync } from "fastify";
import { PlaybookSchema } from "@switchboard/schemas";
import type { EffectCategory } from "@switchboard/core/skill-runtime";

interface SimulateBody {
  playbook: unknown;
  userMessage: string;
}

interface SimulateResponse {
  alexMessage: string;
  annotations: string[];
  toolsAttempted?: Array<{
    toolId: string;
    operation: string;
    simulated: boolean;
    effectCategory: EffectCategory;
  }>;
  blockedActions?: string[];
  metadata?: {
    policyNotes?: string[];
  };
}

const simulateRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/simulate", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) return reply.code(401).send({ error: "Unauthorized", statusCode: 401 });

    const body = request.body as SimulateBody;

    if (!body.userMessage || typeof body.userMessage !== "string") {
      return reply.code(400).send({ error: "userMessage is required", statusCode: 400 });
    }

    const playbookParse = PlaybookSchema.safeParse(body.playbook);
    if (!playbookParse.success) {
      return reply
        .code(400)
        .send({ error: "Invalid playbook", issues: playbookParse.error.issues, statusCode: 400 });
    }

    if (!app.skillExecutor || !app.simulationHooks) {
      return reply
        .code(503)
        .send({
          error: "Simulation not available — skill executor not configured",
          statusCode: 503,
        });
    }

    try {
      const { SkillExecutorImpl, SimulationPolicyHook, GovernanceHook } =
        await import("@switchboard/core/skill-runtime");

      const result = await app.skillExecutor.execute({
        skill: {
          ...app.alexSkill,
          body:
            app.alexSkill.body +
            "\n\n" +
            "SIMULATION MODE: You are in simulation mode. No actions are real. " +
            "Always communicate that outcomes are simulated. Never say a booking " +
            "is confirmed, an email was sent, or any action was completed. " +
            "Instead say what WOULD happen if this were a real conversation.",
        },
        parameters: { playbook: playbookParse.data },
        messages: [{ role: "user", content: body.userMessage }],
        deploymentId: "simulation",
        orgId,
        trustScore: 50,
        trustLevel: "guided",
      });

      const toolsAttempted = result.toolCalls.map((tc) => ({
        toolId: tc.toolId,
        operation: tc.operation,
        simulated: tc.result.data?.simulated === true,
        effectCategory: (tc.result.data?.effect_category ?? "read") as EffectCategory,
      }));

      const blockedActions = result.toolCalls
        .filter((tc) => tc.result.data?.simulated === true)
        .map((tc) => `${tc.toolId}.${tc.operation}: ${tc.result.data?.action ?? "blocked"}`);

      const annotations = result.trace.governanceDecisions.map(
        (d) => `${d.toolId}.${d.operation}: ${d.decision}`,
      );
      if (blockedActions.length > 0) {
        annotations.push(`Simulation blocked ${blockedActions.length} write operations`);
      }

      const response: SimulateResponse = {
        alexMessage: result.response,
        annotations,
        toolsAttempted: toolsAttempted.length > 0 ? toolsAttempted : undefined,
        blockedActions: blockedActions.length > 0 ? blockedActions : undefined,
      };

      return reply.send(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      app.log.error(`Simulation failed: ${message}`);
      return reply.code(500).send({ error: "Simulation failed", detail: message, statusCode: 500 });
    }
  });
};

export { simulateRoutes };
```

Note: The route above references `app.skillExecutor`, `app.simulationHooks`, and `app.alexSkill`. These need to be made available on the Fastify instance during bootstrap. The implementer should check how `bootstrapSkillMode` currently exposes its internals and either:

1. Store a simulation-ready executor (with SimulationPolicyHook prepended) on `app`, or
2. Store the base executor and hooks separately and compose them in the route.

Option 2 is cleaner — store `app.skillExecutor` and the simulation hook, then create a simulation-specific executor in the route by prepending the hook.

- [ ] **Step 11: Register the simulate route**

In `apps/api/src/bootstrap/routes.ts`, add:

```typescript
import { simulateRoutes } from "../routes/simulate.js";
```

And in the `registerRoutes` function:

```typescript
await app.register(simulateRoutes);
```

- [ ] **Step 12: Update the dashboard simulate proxy**

Replace `apps/dashboard/src/app/api/dashboard/simulate/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function POST(request: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.simulate(body);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
```

- [ ] **Step 13: Update the SwitchboardClient simulate method**

In `apps/dashboard/src/lib/api-client/governance.ts`, the existing `simulate` method sends to `/api/simulate` with a different body shape (actionType, parameters, principalId). Update it or add a new method for the chat simulation:

```typescript
  async simulateChat(body: {
    playbook: unknown;
    userMessage: string;
  }) {
    return this.request<{
      alexMessage: string;
      annotations: string[];
      toolsAttempted?: Array<{
        toolId: string;
        operation: string;
        simulated: boolean;
        effectCategory: string;
      }>;
      blockedActions?: string[];
    }>("/api/simulate", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
```

Then update the dashboard proxy route to use `client.simulateChat(body)` instead of `client.simulate(body)`.

- [ ] **Step 14: Update the use-simulation hook to match new contract**

In `apps/dashboard/src/hooks/use-simulation.ts`, update the response type and the fetch call. The fetch path (`/api/dashboard/simulate`) is correct. Update `SimulateResponse`:

```typescript
interface SimulateResponse {
  alexMessage: string;
  annotations: string[];
  toolsAttempted?: Array<{
    toolId: string;
    operation: string;
    simulated: boolean;
    effectCategory: string;
  }>;
  blockedActions?: string[];
}
```

- [ ] **Step 15: Run all tests**

Run: `pnpm test -- --run`
Expected: PASS

- [ ] **Step 16: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 17: Commit**

```bash
git commit -m "feat: add simulation endpoint with dry-run policy hook

Real executor, real playbook, simulation policy envelope that blocks
write/external_mutation/external_send/irreversible tool calls and
returns structured simulated results. Extends HookResult with
substituteResult for backward-compatible hook payload substitution."
```

---

### Task 6: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test -- --run`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 4: Verify Docker build**

Run: `docker build --target api -t switchboard-api-verify .`
Expected: Build succeeds, skills/ directory present

- [ ] **Step 5: Commit any final fixes and tag**

If any fixes were needed, commit them. Then:

```bash
git log --oneline -6
```

Expected: 5 commits for the 5 fixes, in order.
