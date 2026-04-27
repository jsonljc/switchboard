# Phase 4: SchedulerService + Event-Driven Triggers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class SchedulerService that supports timer, cron, and event-match triggers — wiring into WorkflowEngine for `scheduled` state transitions and EventLoop for event-match dispatch.

**Architecture:** SchedulerService interface lives in `packages/core` (no BullMQ dependency). BullMQ-backed implementation lives in `apps/api`, following the existing queue patterns (`execution-queue.ts`, `background-jobs-queue.ts`). Timer triggers use BullMQ delayed jobs, cron triggers use `upsertJobScheduler()` (already used in background-jobs), event-match triggers are checked by EventLoop on event dispatch. A new `ScheduledTrigger` Prisma model persists trigger state alongside the existing workflow models.

**Tech Stack:** TypeScript, Zod, Prisma, BullMQ v5, ioredis, cron-parser v5, Vitest

---

## File Structure

### New Files

| File                                                                | Responsibility                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/schemas/src/scheduler.ts`                                 | Zod schemas for ScheduledTrigger, TriggerAction, TriggerFilters |
| `packages/core/src/scheduler/trigger-types.ts`                      | TypeScript types inferred from Zod schemas + constants          |
| `packages/core/src/scheduler/trigger-store.ts`                      | `TriggerStore` persistence interface                            |
| `packages/core/src/scheduler/scheduler-service.ts`                  | `SchedulerService` abstract interface (no BullMQ)               |
| `packages/core/src/scheduler/index.ts`                              | Barrel re-exports                                               |
| `packages/core/src/scheduler/__tests__/trigger-types.test.ts`       | Schema validation tests                                         |
| `packages/core/src/scheduler/__tests__/scheduler-service.test.ts`   | SchedulerService contract tests with in-memory store            |
| `packages/db/src/stores/prisma-trigger-store.ts`                    | `PrismaTriggerStore` implementing `TriggerStore`                |
| `packages/db/src/stores/__tests__/prisma-trigger-store.test.ts`     | Prisma trigger store tests                                      |
| `apps/api/src/queue/scheduler-queue.ts`                             | BullMQ queue + worker for timer/cron triggers                   |
| `apps/api/src/queue/__tests__/scheduler-queue.test.ts`              | Queue integration tests                                         |
| `apps/api/src/scheduler/bullmq-scheduler-service.ts`                | BullMQ-backed `SchedulerService` implementation                 |
| `apps/api/src/scheduler/__tests__/bullmq-scheduler-service.test.ts` | Service implementation tests                                    |
| `apps/api/src/bootstrap/scheduler-deps.ts`                          | Bootstrap factory for scheduler wiring                          |
| `apps/api/src/routes/scheduler.ts`                                  | REST endpoints for trigger management                           |
| `apps/api/src/routes/__tests__/scheduler.test.ts`                   | Route handler tests                                             |

### Modified Files

| File                                             | Change                                                |
| ------------------------------------------------ | ----------------------------------------------------- |
| `packages/schemas/src/index.ts`                  | Add scheduler schema re-exports                       |
| `packages/core/src/index.ts`                     | Add scheduler module re-exports                       |
| `packages/db/prisma/schema.prisma`               | Add `ScheduledTriggerRecord` model                    |
| `packages/db/src/index.ts`                       | Add `PrismaTriggerStore` re-export                    |
| `packages/agents/src/event-loop.ts`              | Add event-match trigger checking on dispatch          |
| `packages/core/src/workflows/workflow-engine.ts` | Add `scheduleStep()` for `scheduled` state transition |
| `apps/api/src/app.ts`                            | Wire scheduler deps + cleanup                         |
| `apps/api/src/bootstrap/routes.ts`               | Register scheduler routes                             |
| `apps/api/src/bootstrap/workflow-deps.ts`        | Expose scheduler to workflow engine                   |

---

## Task 1: Scheduler Zod Schemas

**Files:**

- Create: `packages/schemas/src/scheduler.ts`
- Create: `packages/schemas/src/__tests__/scheduler.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/__tests__/scheduler.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  ScheduledTriggerSchema,
  TriggerTypeSchema,
  TriggerStatusSchema,
  TriggerActionSchema,
  TriggerActionTypeSchema,
  EventPatternSchema,
  TriggerFiltersSchema,
  TERMINAL_TRIGGER_STATUSES,
} from "../scheduler.js";

describe("ScheduledTrigger schemas", () => {
  describe("TriggerTypeSchema", () => {
    it("accepts valid trigger types", () => {
      expect(TriggerTypeSchema.parse("timer")).toBe("timer");
      expect(TriggerTypeSchema.parse("cron")).toBe("cron");
      expect(TriggerTypeSchema.parse("event_match")).toBe("event_match");
    });

    it("rejects invalid trigger types", () => {
      expect(() => TriggerTypeSchema.parse("webhook")).toThrow();
    });
  });

  describe("TriggerStatusSchema", () => {
    it("accepts valid statuses", () => {
      expect(TriggerStatusSchema.parse("active")).toBe("active");
      expect(TriggerStatusSchema.parse("fired")).toBe("fired");
      expect(TriggerStatusSchema.parse("cancelled")).toBe("cancelled");
      expect(TriggerStatusSchema.parse("expired")).toBe("expired");
    });
  });

  describe("TERMINAL_TRIGGER_STATUSES", () => {
    it("contains fired, cancelled, expired", () => {
      expect(TERMINAL_TRIGGER_STATUSES).toContain("fired");
      expect(TERMINAL_TRIGGER_STATUSES).toContain("cancelled");
      expect(TERMINAL_TRIGGER_STATUSES).toContain("expired");
      expect(TERMINAL_TRIGGER_STATUSES).not.toContain("active");
    });
  });

  describe("TriggerActionSchema", () => {
    it("accepts spawn_workflow action", () => {
      const result = TriggerActionSchema.parse({
        type: "spawn_workflow",
        payload: { sourceAgent: "ad-optimizer", intent: "recheck_roas" },
      });
      expect(result.type).toBe("spawn_workflow");
    });

    it("accepts resume_workflow action", () => {
      const result = TriggerActionSchema.parse({
        type: "resume_workflow",
        payload: { workflowId: "wf-123" },
      });
      expect(result.type).toBe("resume_workflow");
    });

    it("accepts emit_event action", () => {
      const result = TriggerActionSchema.parse({
        type: "emit_event",
        payload: { eventType: "follow_up.due", contactId: "c-1" },
      });
      expect(result.type).toBe("emit_event");
    });
  });

  describe("EventPatternSchema", () => {
    it("accepts a pattern with type and filters", () => {
      const result = EventPatternSchema.parse({
        type: "ad.anomaly_detected",
        filters: { severity: "high" },
      });
      expect(result.type).toBe("ad.anomaly_detected");
      expect(result.filters).toEqual({ severity: "high" });
    });

    it("accepts a pattern with empty filters", () => {
      const result = EventPatternSchema.parse({
        type: "payment.received",
        filters: {},
      });
      expect(result.filters).toEqual({});
    });
  });

  describe("ScheduledTriggerSchema", () => {
    const baseTrigger = {
      id: "trig-1",
      organizationId: "org-1",
      status: "active" as const,
      action: { type: "spawn_workflow" as const, payload: {} },
      sourceWorkflowId: null,
      createdAt: new Date(),
      expiresAt: null,
    };

    it("accepts a timer trigger", () => {
      const result = ScheduledTriggerSchema.parse({
        ...baseTrigger,
        type: "timer",
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
      });
      expect(result.type).toBe("timer");
      expect(result.fireAt).toBeInstanceOf(Date);
    });

    it("accepts a cron trigger", () => {
      const result = ScheduledTriggerSchema.parse({
        ...baseTrigger,
        type: "cron",
        fireAt: null,
        cronExpression: "0 9 * * 1-5",
        eventPattern: null,
      });
      expect(result.type).toBe("cron");
      expect(result.cronExpression).toBe("0 9 * * 1-5");
    });

    it("accepts an event_match trigger", () => {
      const result = ScheduledTriggerSchema.parse({
        ...baseTrigger,
        type: "event_match",
        fireAt: null,
        cronExpression: null,
        eventPattern: { type: "payment.received", filters: {} },
      });
      expect(result.type).toBe("event_match");
    });

    it("rejects timer trigger without fireAt", () => {
      expect(() =>
        ScheduledTriggerSchema.parse({
          ...baseTrigger,
          type: "timer",
          fireAt: null,
          cronExpression: null,
          eventPattern: null,
        }),
      ).toThrow();
    });

    it("rejects cron trigger without cronExpression", () => {
      expect(() =>
        ScheduledTriggerSchema.parse({
          ...baseTrigger,
          type: "cron",
          fireAt: null,
          cronExpression: null,
          eventPattern: null,
        }),
      ).toThrow();
    });

    it("rejects event_match trigger without eventPattern", () => {
      expect(() =>
        ScheduledTriggerSchema.parse({
          ...baseTrigger,
          type: "event_match",
          fireAt: null,
          cronExpression: null,
          eventPattern: null,
        }),
      ).toThrow();
    });
  });

  describe("TriggerFiltersSchema", () => {
    it("accepts organizationId filter", () => {
      const result = TriggerFiltersSchema.parse({ organizationId: "org-1" });
      expect(result.organizationId).toBe("org-1");
    });

    it("accepts status filter", () => {
      const result = TriggerFiltersSchema.parse({ status: "active" });
      expect(result.status).toBe("active");
    });

    it("accepts sourceWorkflowId filter", () => {
      const result = TriggerFiltersSchema.parse({ sourceWorkflowId: "wf-1" });
      expect(result.sourceWorkflowId).toBe("wf-1");
    });

    it("accepts combined filters", () => {
      const result = TriggerFiltersSchema.parse({
        organizationId: "org-1",
        status: "active",
        type: "timer",
      });
      expect(result.organizationId).toBe("org-1");
      expect(result.status).toBe("active");
    });

    it("accepts empty filters", () => {
      const result = TriggerFiltersSchema.parse({});
      expect(result).toEqual({});
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test -- scheduler`
Expected: FAIL — cannot resolve `../scheduler.js`

- [ ] **Step 3: Write the schema implementation**

Create `packages/schemas/src/scheduler.ts`:

```typescript
import { z } from "zod";

export const TriggerTypeSchema = z.enum(["timer", "cron", "event_match"]);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const TriggerStatusSchema = z.enum(["active", "fired", "cancelled", "expired"]);
export type TriggerStatus = z.infer<typeof TriggerStatusSchema>;

export const TERMINAL_TRIGGER_STATUSES: readonly TriggerStatus[] = [
  "fired",
  "cancelled",
  "expired",
];

export const TriggerActionTypeSchema = z.enum(["spawn_workflow", "resume_workflow", "emit_event"]);
export type TriggerActionType = z.infer<typeof TriggerActionTypeSchema>;

export const TriggerActionSchema = z.object({
  type: TriggerActionTypeSchema,
  payload: z.record(z.unknown()),
});
export type TriggerAction = z.infer<typeof TriggerActionSchema>;

export const EventPatternSchema = z.object({
  type: z.string(),
  filters: z.record(z.unknown()),
});
export type EventPattern = z.infer<typeof EventPatternSchema>;

export const TriggerFiltersSchema = z
  .object({
    organizationId: z.string(),
    status: TriggerStatusSchema,
    type: TriggerTypeSchema,
    sourceWorkflowId: z.string(),
  })
  .partial();
export type TriggerFilters = z.infer<typeof TriggerFiltersSchema>;

export const ScheduledTriggerSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    type: TriggerTypeSchema,
    fireAt: z.coerce.date().nullable(),
    cronExpression: z.string().nullable(),
    eventPattern: EventPatternSchema.nullable(),
    action: TriggerActionSchema,
    sourceWorkflowId: z.string().nullable(),
    status: TriggerStatusSchema,
    createdAt: z.coerce.date(),
    expiresAt: z.coerce.date().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "timer" && data.fireAt === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timer trigger requires fireAt",
        path: ["fireAt"],
      });
    }
    if (data.type === "cron" && data.cronExpression === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "cron trigger requires cronExpression",
        path: ["cronExpression"],
      });
    }
    if (data.type === "event_match" && data.eventPattern === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "event_match trigger requires eventPattern",
        path: ["eventPattern"],
      });
    }
  });
export type ScheduledTrigger = z.infer<typeof ScheduledTriggerSchema>;
```

- [ ] **Step 4: Add re-export to barrel**

In `packages/schemas/src/index.ts`, add:

```typescript
export * from "./scheduler.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/schemas test -- scheduler`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
sl commit -m "feat(schemas): add ScheduledTrigger Zod schemas for Phase 4 scheduler"
```

---

## Task 2: Core Scheduler Interfaces

**Files:**

- Create: `packages/core/src/scheduler/trigger-types.ts`
- Create: `packages/core/src/scheduler/trigger-store.ts`
- Create: `packages/core/src/scheduler/scheduler-service.ts`
- Create: `packages/core/src/scheduler/index.ts`
- Create: `packages/core/src/scheduler/__tests__/scheduler-service.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/scheduler/__tests__/scheduler-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import type { SchedulerService, RegisterTriggerInput } from "../scheduler-service.js";
import type { TriggerStore } from "../trigger-store.js";
import type { ScheduledTrigger, TriggerFilters, TriggerStatus } from "@switchboard/schemas";
import { createSchedulerService } from "../scheduler-service.js";
import {
  VALID_TRIGGER_TRANSITIONS,
  canTriggerTransition,
  validateTriggerTransition,
  TriggerTransitionError,
  isTerminalTriggerStatus,
} from "../trigger-types.js";

function createInMemoryTriggerStore(): TriggerStore {
  const triggers = new Map<string, ScheduledTrigger>();

  return {
    async save(trigger: ScheduledTrigger): Promise<void> {
      triggers.set(trigger.id, { ...trigger });
    },
    async findById(id: string): Promise<ScheduledTrigger | null> {
      return triggers.get(id) ?? null;
    },
    async findByFilters(filters: TriggerFilters): Promise<ScheduledTrigger[]> {
      let result = Array.from(triggers.values());
      if (filters.organizationId) {
        result = result.filter((t) => t.organizationId === filters.organizationId);
      }
      if (filters.status) {
        result = result.filter((t) => t.status === filters.status);
      }
      if (filters.type) {
        result = result.filter((t) => t.type === filters.type);
      }
      if (filters.sourceWorkflowId) {
        result = result.filter((t) => t.sourceWorkflowId === filters.sourceWorkflowId);
      }
      return result;
    },
    async updateStatus(id: string, status: TriggerStatus): Promise<void> {
      const trigger = triggers.get(id);
      if (trigger) {
        triggers.set(id, { ...trigger, status });
      }
    },
    async deleteExpired(before: Date): Promise<number> {
      let count = 0;
      for (const [id, trigger] of triggers) {
        if (trigger.expiresAt && trigger.expiresAt < before) {
          triggers.delete(id);
          count++;
        }
      }
      return count;
    },
  };
}

describe("Trigger state transitions", () => {
  it("allows active -> fired", () => {
    expect(canTriggerTransition("active", "fired")).toBe(true);
  });

  it("allows active -> cancelled", () => {
    expect(canTriggerTransition("active", "cancelled")).toBe(true);
  });

  it("allows active -> expired", () => {
    expect(canTriggerTransition("active", "expired")).toBe(true);
  });

  it("rejects fired -> active", () => {
    expect(canTriggerTransition("fired", "active")).toBe(false);
  });

  it("rejects cancelled -> active", () => {
    expect(canTriggerTransition("cancelled", "active")).toBe(false);
  });

  it("validates transition throws on invalid", () => {
    expect(() => validateTriggerTransition("fired", "active")).toThrow(TriggerTransitionError);
  });

  it("identifies terminal statuses", () => {
    expect(isTerminalTriggerStatus("fired")).toBe(true);
    expect(isTerminalTriggerStatus("cancelled")).toBe(true);
    expect(isTerminalTriggerStatus("expired")).toBe(true);
    expect(isTerminalTriggerStatus("active")).toBe(false);
  });
});

describe("SchedulerService (in-memory)", () => {
  let service: SchedulerService;
  let store: TriggerStore;

  beforeEach(() => {
    store = createInMemoryTriggerStore();
    service = createSchedulerService({ store });
  });

  describe("registerTrigger", () => {
    it("registers a timer trigger and returns its id", async () => {
      const input: RegisterTriggerInput = {
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: { agent: "nurture" } },
        sourceWorkflowId: null,
        expiresAt: null,
      };

      const id = await service.registerTrigger(input);
      expect(id).toBeTruthy();

      const trigger = await store.findById(id);
      expect(trigger).not.toBeNull();
      expect(trigger!.type).toBe("timer");
      expect(trigger!.status).toBe("active");
      expect(trigger!.organizationId).toBe("org-1");
    });

    it("registers a cron trigger", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "cron",
        fireAt: null,
        cronExpression: "0 9 * * 1-5",
        eventPattern: null,
        action: { type: "emit_event", payload: { type: "daily_check" } },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      const trigger = await store.findById(id);
      expect(trigger!.type).toBe("cron");
      expect(trigger!.cronExpression).toBe("0 9 * * 1-5");
    });

    it("registers an event_match trigger", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "event_match",
        fireAt: null,
        cronExpression: null,
        eventPattern: { type: "payment.received", filters: { amount_gt: 100 } },
        action: { type: "resume_workflow", payload: { workflowId: "wf-1" } },
        sourceWorkflowId: "wf-1",
        expiresAt: new Date("2026-04-15T00:00:00Z"),
      });

      const trigger = await store.findById(id);
      expect(trigger!.type).toBe("event_match");
      expect(trigger!.eventPattern).toEqual({
        type: "payment.received",
        filters: { amount_gt: 100 },
      });
    });
  });

  describe("cancelTrigger", () => {
    it("cancels an active trigger", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      await service.cancelTrigger(id);
      const trigger = await store.findById(id);
      expect(trigger!.status).toBe("cancelled");
    });

    it("throws on cancelling a non-existent trigger", async () => {
      await expect(service.cancelTrigger("nonexistent")).rejects.toThrow();
    });

    it("throws on cancelling an already-fired trigger", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      await store.updateStatus(id, "fired");
      await expect(service.cancelTrigger(id)).rejects.toThrow(TriggerTransitionError);
    });
  });

  describe("listPendingTriggers", () => {
    it("returns triggers matching filters", async () => {
      await service.registerTrigger({
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });
      await service.registerTrigger({
        organizationId: "org-2",
        type: "cron",
        fireAt: null,
        cronExpression: "0 9 * * *",
        eventPattern: null,
        action: { type: "emit_event", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      const org1 = await service.listPendingTriggers({ organizationId: "org-1" });
      expect(org1).toHaveLength(1);
      expect(org1[0].organizationId).toBe("org-1");

      const all = await service.listPendingTriggers({});
      expect(all).toHaveLength(2);
    });
  });

  describe("matchEvent", () => {
    it("returns matching event_match triggers for an event", async () => {
      await service.registerTrigger({
        organizationId: "org-1",
        type: "event_match",
        fireAt: null,
        cronExpression: null,
        eventPattern: { type: "payment.received", filters: {} },
        action: { type: "resume_workflow", payload: { workflowId: "wf-1" } },
        sourceWorkflowId: "wf-1",
        expiresAt: null,
      });
      await service.registerTrigger({
        organizationId: "org-1",
        type: "event_match",
        fireAt: null,
        cronExpression: null,
        eventPattern: { type: "ad.anomaly_detected", filters: {} },
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      const matches = await service.matchEvent("org-1", "payment.received", {});
      expect(matches).toHaveLength(1);
      expect(matches[0].action.payload).toEqual({ workflowId: "wf-1" });
    });

    it("returns empty array when no triggers match", async () => {
      const matches = await service.matchEvent("org-1", "unknown.event", {});
      expect(matches).toHaveLength(0);
    });

    it("filters by event pattern filters", async () => {
      await service.registerTrigger({
        organizationId: "org-1",
        type: "event_match",
        fireAt: null,
        cronExpression: null,
        eventPattern: { type: "payment.received", filters: { currency: "USD" } },
        action: { type: "resume_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      const matchUsd = await service.matchEvent("org-1", "payment.received", {
        currency: "USD",
        amount: 100,
      });
      expect(matchUsd).toHaveLength(1);

      const matchEur = await service.matchEvent("org-1", "payment.received", { currency: "EUR" });
      expect(matchEur).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- scheduler-service`
Expected: FAIL — cannot resolve modules

- [ ] **Step 3: Write trigger-types.ts**

Create `packages/core/src/scheduler/trigger-types.ts`:

```typescript
import type { TriggerStatus } from "@switchboard/schemas";

export const VALID_TRIGGER_TRANSITIONS: Record<TriggerStatus, readonly TriggerStatus[]> = {
  active: ["fired", "cancelled", "expired"],
  fired: [],
  cancelled: [],
  expired: [],
};

export function canTriggerTransition(from: TriggerStatus, to: TriggerStatus): boolean {
  return VALID_TRIGGER_TRANSITIONS[from].includes(to);
}

export class TriggerTransitionError extends Error {
  constructor(
    public readonly from: TriggerStatus,
    public readonly to: TriggerStatus,
  ) {
    super(`Invalid trigger transition: ${from} -> ${to}`);
    this.name = "TriggerTransitionError";
  }
}

export function validateTriggerTransition(from: TriggerStatus, to: TriggerStatus): void {
  if (!canTriggerTransition(from, to)) {
    throw new TriggerTransitionError(from, to);
  }
}

export function isTerminalTriggerStatus(status: TriggerStatus): boolean {
  return VALID_TRIGGER_TRANSITIONS[status].length === 0;
}
```

- [ ] **Step 4: Write trigger-store.ts**

Create `packages/core/src/scheduler/trigger-store.ts`:

```typescript
import type { ScheduledTrigger, TriggerFilters, TriggerStatus } from "@switchboard/schemas";

export interface TriggerStore {
  save(trigger: ScheduledTrigger): Promise<void>;
  findById(id: string): Promise<ScheduledTrigger | null>;
  findByFilters(filters: TriggerFilters): Promise<ScheduledTrigger[]>;
  updateStatus(id: string, status: TriggerStatus): Promise<void>;
  deleteExpired(before: Date): Promise<number>;
}
```

- [ ] **Step 5: Write scheduler-service.ts**

Create `packages/core/src/scheduler/scheduler-service.ts`:

```typescript
import type {
  ScheduledTrigger,
  TriggerFilters,
  TriggerType,
  TriggerAction,
  EventPattern,
} from "@switchboard/schemas";
import type { TriggerStore } from "./trigger-store.js";
import { validateTriggerTransition } from "./trigger-types.js";
import { randomUUID } from "node:crypto";

export interface RegisterTriggerInput {
  organizationId: string;
  type: TriggerType;
  fireAt: Date | null;
  cronExpression: string | null;
  eventPattern: EventPattern | null;
  action: TriggerAction;
  sourceWorkflowId: string | null;
  expiresAt: Date | null;
}

export interface SchedulerService {
  registerTrigger(input: RegisterTriggerInput): Promise<string>;
  cancelTrigger(triggerId: string): Promise<void>;
  listPendingTriggers(filters: TriggerFilters): Promise<ScheduledTrigger[]>;
  matchEvent(
    organizationId: string,
    eventType: string,
    eventData: Record<string, unknown>,
  ): Promise<ScheduledTrigger[]>;
}

export interface SchedulerServiceDeps {
  store: TriggerStore;
}

export function createSchedulerService(deps: SchedulerServiceDeps): SchedulerService {
  const { store } = deps;

  return {
    async registerTrigger(input: RegisterTriggerInput): Promise<string> {
      const id = randomUUID();
      const trigger: ScheduledTrigger = {
        id,
        organizationId: input.organizationId,
        type: input.type,
        fireAt: input.fireAt,
        cronExpression: input.cronExpression,
        eventPattern: input.eventPattern,
        action: input.action,
        sourceWorkflowId: input.sourceWorkflowId,
        status: "active",
        createdAt: new Date(),
        expiresAt: input.expiresAt,
      };
      await store.save(trigger);
      return id;
    },

    async cancelTrigger(triggerId: string): Promise<void> {
      const trigger = await store.findById(triggerId);
      if (!trigger) {
        throw new Error(`Trigger not found: ${triggerId}`);
      }
      validateTriggerTransition(trigger.status, "cancelled");
      await store.updateStatus(triggerId, "cancelled");
    },

    async listPendingTriggers(filters: TriggerFilters): Promise<ScheduledTrigger[]> {
      return store.findByFilters(filters);
    },

    async matchEvent(
      organizationId: string,
      eventType: string,
      eventData: Record<string, unknown>,
    ): Promise<ScheduledTrigger[]> {
      const candidates = await store.findByFilters({
        organizationId,
        status: "active",
        type: "event_match",
      });

      return candidates.filter((trigger) => {
        if (!trigger.eventPattern) return false;
        if (trigger.eventPattern.type !== eventType) return false;

        // Check that all filter key-value pairs match the event data
        for (const [key, value] of Object.entries(trigger.eventPattern.filters)) {
          if (eventData[key] !== value) return false;
        }
        return true;
      });
    },
  };
}
```

- [ ] **Step 6: Write barrel index.ts**

Create `packages/core/src/scheduler/index.ts`:

```typescript
export {
  VALID_TRIGGER_TRANSITIONS,
  canTriggerTransition,
  validateTriggerTransition,
  TriggerTransitionError,
  isTerminalTriggerStatus,
} from "./trigger-types.js";
export type { TriggerStore } from "./trigger-store.js";
export { createSchedulerService } from "./scheduler-service.js";
export type {
  SchedulerService,
  SchedulerServiceDeps,
  RegisterTriggerInput,
} from "./scheduler-service.js";
```

- [ ] **Step 7: Add re-export to core barrel**

In `packages/core/src/index.ts`, add:

```typescript
export * from "./scheduler/index.js";
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/core test -- scheduler-service`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
sl commit -m "feat(core): add SchedulerService interface, TriggerStore, and trigger state machine"
```

---

## Task 3: Prisma Model + PrismaTriggerStore

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/stores/prisma-trigger-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-trigger-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add ScheduledTriggerRecord to Prisma schema**

Add after the `ApprovalCheckpointRecord` model (around line 1208) in `packages/db/prisma/schema.prisma`:

```prisma
model ScheduledTriggerRecord {
  id                String    @id @default(uuid())
  organizationId    String
  type              String    // "timer" | "cron" | "event_match"
  fireAt            DateTime?
  cronExpression    String?
  eventPattern      Json?     // { type: string, filters: Record<string, unknown> }
  action            Json      // { type: string, payload: Record<string, unknown> }
  sourceWorkflowId  String?
  status            String    @default("active") // "active" | "fired" | "cancelled" | "expired"
  createdAt         DateTime  @default(now())
  expiresAt         DateTime?

  workflow          WorkflowExecution? @relation(fields: [sourceWorkflowId], references: [id])

  @@index([organizationId, status])
  @@index([status, type])
  @@index([sourceWorkflowId])
  @@index([fireAt])
}
```

Also add to the `WorkflowExecution` model's relations:

```prisma
triggers          ScheduledTriggerRecord[]
```

- [ ] **Step 2: Generate Prisma client**

Run: `pnpm db:generate`
Expected: Prisma client generated successfully

- [ ] **Step 3: Create migration**

Run: `cd packages/db && npx prisma migrate dev --name add-scheduled-trigger`
Expected: Migration created and applied

- [ ] **Step 4: Write the failing test**

Create `packages/db/src/stores/__tests__/prisma-trigger-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaTriggerStore } from "../prisma-trigger-store.js";

function createMockPrisma() {
  return {
    scheduledTriggerRecord: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

describe("PrismaTriggerStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaTriggerStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaTriggerStore(prisma as never);
  });

  describe("save", () => {
    it("creates a trigger record", async () => {
      const trigger = {
        id: "trig-1",
        organizationId: "org-1",
        type: "timer" as const,
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow" as const, payload: {} },
        sourceWorkflowId: null,
        status: "active" as const,
        createdAt: new Date(),
        expiresAt: null,
      };

      await store.save(trigger);

      expect(prisma.scheduledTriggerRecord.create).toHaveBeenCalledWith({
        data: {
          id: "trig-1",
          organizationId: "org-1",
          type: "timer",
          fireAt: trigger.fireAt,
          cronExpression: null,
          eventPattern: null,
          action: { type: "spawn_workflow", payload: {} },
          sourceWorkflowId: null,
          status: "active",
          createdAt: trigger.createdAt,
          expiresAt: null,
        },
      });
    });
  });

  describe("findById", () => {
    it("returns null when not found", async () => {
      prisma.scheduledTriggerRecord.findUnique.mockResolvedValue(null);
      const result = await store.findById("nonexistent");
      expect(result).toBeNull();
    });

    it("maps Prisma record to ScheduledTrigger", async () => {
      prisma.scheduledTriggerRecord.findUnique.mockResolvedValue({
        id: "trig-1",
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        status: "active",
        createdAt: new Date(),
        expiresAt: null,
      });

      const result = await store.findById("trig-1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("trig-1");
      expect(result!.type).toBe("timer");
    });
  });

  describe("findByFilters", () => {
    it("builds where clause from filters", async () => {
      prisma.scheduledTriggerRecord.findMany.mockResolvedValue([]);
      await store.findByFilters({ organizationId: "org-1", status: "active" });

      expect(prisma.scheduledTriggerRecord.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", status: "active" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("handles empty filters", async () => {
      prisma.scheduledTriggerRecord.findMany.mockResolvedValue([]);
      await store.findByFilters({});

      expect(prisma.scheduledTriggerRecord.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("updateStatus", () => {
    it("updates trigger status", async () => {
      await store.updateStatus("trig-1", "fired");

      expect(prisma.scheduledTriggerRecord.update).toHaveBeenCalledWith({
        where: { id: "trig-1" },
        data: { status: "fired" },
      });
    });
  });

  describe("deleteExpired", () => {
    it("deletes triggers expired before given date", async () => {
      prisma.scheduledTriggerRecord.deleteMany.mockResolvedValue({ count: 3 });
      const before = new Date("2026-03-01T00:00:00Z");
      const count = await store.deleteExpired(before);

      expect(count).toBe(3);
      expect(prisma.scheduledTriggerRecord.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: before },
          status: { in: ["fired", "cancelled", "expired"] },
        },
      });
    });
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test -- prisma-trigger-store`
Expected: FAIL — cannot resolve `../prisma-trigger-store.js`

- [ ] **Step 6: Write PrismaTriggerStore**

Create `packages/db/src/stores/prisma-trigger-store.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type { ScheduledTrigger, TriggerFilters, TriggerStatus } from "@switchboard/schemas";

type PrismaRecord = {
  id: string;
  organizationId: string;
  type: string;
  fireAt: Date | null;
  cronExpression: string | null;
  eventPattern: unknown;
  action: unknown;
  sourceWorkflowId: string | null;
  status: string;
  createdAt: Date;
  expiresAt: Date | null;
};

function toScheduledTrigger(record: PrismaRecord): ScheduledTrigger {
  return {
    id: record.id,
    organizationId: record.organizationId,
    type: record.type as ScheduledTrigger["type"],
    fireAt: record.fireAt,
    cronExpression: record.cronExpression,
    eventPattern: record.eventPattern as ScheduledTrigger["eventPattern"],
    action: record.action as ScheduledTrigger["action"],
    sourceWorkflowId: record.sourceWorkflowId,
    status: record.status as ScheduledTrigger["status"],
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

export class PrismaTriggerStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(trigger: ScheduledTrigger): Promise<void> {
    await this.prisma.scheduledTriggerRecord.create({
      data: {
        id: trigger.id,
        organizationId: trigger.organizationId,
        type: trigger.type,
        fireAt: trigger.fireAt,
        cronExpression: trigger.cronExpression,
        eventPattern: trigger.eventPattern as object | undefined,
        action: trigger.action as object,
        sourceWorkflowId: trigger.sourceWorkflowId,
        status: trigger.status,
        createdAt: trigger.createdAt,
        expiresAt: trigger.expiresAt,
      },
    });
  }

  async findById(id: string): Promise<ScheduledTrigger | null> {
    const record = await this.prisma.scheduledTriggerRecord.findUnique({
      where: { id },
    });
    return record ? toScheduledTrigger(record as PrismaRecord) : null;
  }

  async findByFilters(filters: TriggerFilters): Promise<ScheduledTrigger[]> {
    const where: Record<string, unknown> = {};
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    if (filters.sourceWorkflowId) where.sourceWorkflowId = filters.sourceWorkflowId;

    const records = await this.prisma.scheduledTriggerRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return records.map((r) => toScheduledTrigger(r as PrismaRecord));
  }

  async updateStatus(id: string, status: TriggerStatus): Promise<void> {
    await this.prisma.scheduledTriggerRecord.update({
      where: { id },
      data: { status },
    });
  }

  async deleteExpired(before: Date): Promise<number> {
    const result = await this.prisma.scheduledTriggerRecord.deleteMany({
      where: {
        expiresAt: { lt: before },
        status: { in: ["fired", "cancelled", "expired"] },
      },
    });
    return result.count;
  }
}
```

- [ ] **Step 7: Add re-export to db barrel**

In `packages/db/src/index.ts`, add:

```typescript
export { PrismaTriggerStore } from "./stores/prisma-trigger-store.js";
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @switchboard/db test -- prisma-trigger-store`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
sl commit -m "feat(db): add ScheduledTriggerRecord Prisma model and PrismaTriggerStore"
```

---

## Task 4: BullMQ Scheduler Queue

**Files:**

- Create: `apps/api/src/queue/scheduler-queue.ts`
- Create: `apps/api/src/queue/__tests__/scheduler-queue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/queue/__tests__/scheduler-queue.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSchedulerJobData,
  SCHEDULER_QUEUE_NAME,
  computeTimerDelay,
  computeCronRepeatOpts,
} from "../scheduler-queue.js";

describe("scheduler-queue", () => {
  describe("SCHEDULER_QUEUE_NAME", () => {
    it("has the expected queue name", () => {
      expect(SCHEDULER_QUEUE_NAME).toBe("switchboard:scheduler");
    });
  });

  describe("createSchedulerJobData", () => {
    it("creates job data for a timer trigger", () => {
      const data = createSchedulerJobData({
        triggerId: "trig-1",
        organizationId: "org-1",
        action: { type: "spawn_workflow", payload: { agent: "nurture" } },
      });
      expect(data).toEqual({
        triggerId: "trig-1",
        organizationId: "org-1",
        action: { type: "spawn_workflow", payload: { agent: "nurture" } },
      });
    });
  });

  describe("computeTimerDelay", () => {
    it("returns milliseconds until fireAt", () => {
      const now = new Date("2026-03-23T10:00:00Z");
      const fireAt = new Date("2026-03-23T10:05:00Z");
      const delay = computeTimerDelay(fireAt, now);
      expect(delay).toBe(5 * 60 * 1000);
    });

    it("returns 0 for past dates", () => {
      const now = new Date("2026-03-23T10:00:00Z");
      const fireAt = new Date("2026-03-23T09:00:00Z");
      const delay = computeTimerDelay(fireAt, now);
      expect(delay).toBe(0);
    });
  });

  describe("computeCronRepeatOpts", () => {
    it("returns BullMQ repeat options for cron expression", () => {
      const opts = computeCronRepeatOpts("0 9 * * 1-5");
      expect(opts).toEqual({ pattern: "0 9 * * 1-5" });
    });

    it("includes limit when expiresAt is provided", () => {
      const expiresAt = new Date("2026-06-01T00:00:00Z");
      const opts = computeCronRepeatOpts("0 9 * * 1-5", expiresAt);
      expect(opts).toEqual({
        pattern: "0 9 * * 1-5",
        endDate: expiresAt,
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- scheduler-queue`
Expected: FAIL — cannot resolve `../scheduler-queue.js`

- [ ] **Step 3: Write scheduler-queue.ts**

Create `apps/api/src/queue/scheduler-queue.ts`:

```typescript
import { Queue, Worker } from "bullmq";
import type { ConnectionOptions, Job } from "bullmq";
import type { TriggerAction } from "@switchboard/schemas";

export const SCHEDULER_QUEUE_NAME = "switchboard:scheduler";

export interface SchedulerJobData {
  triggerId: string;
  organizationId: string;
  action: TriggerAction;
}

export function createSchedulerJobData(input: SchedulerJobData): SchedulerJobData {
  return {
    triggerId: input.triggerId,
    organizationId: input.organizationId,
    action: input.action,
  };
}

export function computeTimerDelay(fireAt: Date, now: Date = new Date()): number {
  return Math.max(0, fireAt.getTime() - now.getTime());
}

export function computeCronRepeatOpts(
  cronExpression: string,
  expiresAt?: Date | null,
): { pattern: string; endDate?: Date } {
  const opts: { pattern: string; endDate?: Date } = { pattern: cronExpression };
  if (expiresAt) {
    opts.endDate = expiresAt;
  }
  return opts;
}

export function createSchedulerQueue(connection: ConnectionOptions): Queue<SchedulerJobData> {
  return new Queue<SchedulerJobData>(SCHEDULER_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    },
  });
}

export type SchedulerJobHandler = (job: Job<SchedulerJobData>) => Promise<void>;

export function createSchedulerWorker(
  connection: ConnectionOptions,
  handler: SchedulerJobHandler,
): Worker<SchedulerJobData> {
  return new Worker<SchedulerJobData>(SCHEDULER_QUEUE_NAME, handler, {
    connection,
    concurrency: 3,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api test -- scheduler-queue`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
sl commit -m "feat(api): add BullMQ scheduler queue for timer and cron triggers"
```

---

## Task 5: BullMQ-Backed SchedulerService Implementation

**Files:**

- Create: `apps/api/src/scheduler/bullmq-scheduler-service.ts`
- Create: `apps/api/src/scheduler/__tests__/bullmq-scheduler-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/scheduler/__tests__/bullmq-scheduler-service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BullMQSchedulerService } from "../bullmq-scheduler-service.js";
import type { TriggerStore } from "@switchboard/core";
import type { ScheduledTrigger, TriggerFilters, TriggerStatus } from "@switchboard/schemas";

function createMockStore(): TriggerStore {
  const triggers = new Map<string, ScheduledTrigger>();
  return {
    save: vi.fn(async (trigger: ScheduledTrigger) => {
      triggers.set(trigger.id, { ...trigger });
    }),
    findById: vi.fn(async (id: string) => triggers.get(id) ?? null),
    findByFilters: vi.fn(async (filters: TriggerFilters) => {
      let result = Array.from(triggers.values());
      if (filters.organizationId)
        result = result.filter((t) => t.organizationId === filters.organizationId);
      if (filters.status) result = result.filter((t) => t.status === filters.status);
      if (filters.type) result = result.filter((t) => t.type === filters.type);
      return result;
    }),
    updateStatus: vi.fn(async (id: string, status: TriggerStatus) => {
      const t = triggers.get(id);
      if (t) triggers.set(id, { ...t, status });
    }),
    deleteExpired: vi.fn(async () => 0),
  };
}

function createMockQueue() {
  return {
    add: vi.fn(async () => ({ id: "job-1" })),
    upsertJobScheduler: vi.fn(async () => ({ id: "job-cron-1" })),
    removeJobScheduler: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe("BullMQSchedulerService", () => {
  let store: ReturnType<typeof createMockStore>;
  let queue: ReturnType<typeof createMockQueue>;
  let service: BullMQSchedulerService;

  beforeEach(() => {
    store = createMockStore();
    queue = createMockQueue();
    service = new BullMQSchedulerService(store, queue as never);
  });

  describe("registerTrigger", () => {
    it("registers a timer trigger with delayed BullMQ job", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date(Date.now() + 60_000),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      expect(id).toBeTruthy();
      expect(store.save).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        expect.stringContaining("timer:"),
        expect.objectContaining({ triggerId: id }),
        expect.objectContaining({ delay: expect.any(Number) }),
      );
    });

    it("registers a cron trigger with BullMQ job scheduler", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "cron",
        fireAt: null,
        cronExpression: "0 9 * * 1-5",
        eventPattern: null,
        action: { type: "emit_event", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      expect(id).toBeTruthy();
      expect(store.save).toHaveBeenCalledTimes(1);
      expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        expect.stringContaining("cron:"),
        expect.objectContaining({ pattern: "0 9 * * 1-5" }),
        expect.objectContaining({
          data: expect.objectContaining({ triggerId: id }),
        }),
      );
    });

    it("registers an event_match trigger without BullMQ job", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "event_match",
        fireAt: null,
        cronExpression: null,
        eventPattern: { type: "payment.received", filters: {} },
        action: { type: "resume_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      expect(id).toBeTruthy();
      expect(store.save).toHaveBeenCalledTimes(1);
      expect(queue.add).not.toHaveBeenCalled();
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });
  });

  describe("cancelTrigger", () => {
    it("cancels timer trigger and removes BullMQ job", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date(Date.now() + 60_000),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      await service.cancelTrigger(id);
      expect(store.updateStatus).toHaveBeenCalledWith(id, "cancelled");
    });

    it("cancels cron trigger and removes BullMQ job scheduler", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "cron",
        fireAt: null,
        cronExpression: "0 9 * * *",
        eventPattern: null,
        action: { type: "emit_event", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      await service.cancelTrigger(id);
      expect(store.updateStatus).toHaveBeenCalledWith(id, "cancelled");
      expect(queue.removeJobScheduler).toHaveBeenCalledWith(expect.stringContaining("cron:"));
    });
  });

  describe("listPendingTriggers", () => {
    it("delegates to store.findByFilters", async () => {
      await service.listPendingTriggers({ organizationId: "org-1" });
      expect(store.findByFilters).toHaveBeenCalledWith({ organizationId: "org-1" });
    });
  });

  describe("matchEvent", () => {
    it("finds matching event_match triggers", async () => {
      await service.registerTrigger({
        organizationId: "org-1",
        type: "event_match",
        fireAt: null,
        cronExpression: null,
        eventPattern: { type: "payment.received", filters: {} },
        action: { type: "resume_workflow", payload: { workflowId: "wf-1" } },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      const matches = await service.matchEvent("org-1", "payment.received", {});
      expect(matches).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- bullmq-scheduler-service`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Write BullMQSchedulerService**

Create `apps/api/src/scheduler/bullmq-scheduler-service.ts`:

```typescript
import type { Queue } from "bullmq";
import type { SchedulerService, RegisterTriggerInput, TriggerStore } from "@switchboard/core";
import type { ScheduledTrigger, TriggerFilters } from "@switchboard/schemas";
import { validateTriggerTransition } from "@switchboard/core";
import { randomUUID } from "node:crypto";
import type { SchedulerJobData } from "../queue/scheduler-queue.js";
import { computeTimerDelay, computeCronRepeatOpts } from "../queue/scheduler-queue.js";

export class BullMQSchedulerService implements SchedulerService {
  constructor(
    private readonly store: TriggerStore,
    private readonly queue: Queue<SchedulerJobData>,
  ) {}

  async registerTrigger(input: RegisterTriggerInput): Promise<string> {
    const id = randomUUID();
    const trigger: ScheduledTrigger = {
      id,
      organizationId: input.organizationId,
      type: input.type,
      fireAt: input.fireAt,
      cronExpression: input.cronExpression,
      eventPattern: input.eventPattern,
      action: input.action,
      sourceWorkflowId: input.sourceWorkflowId,
      status: "active",
      createdAt: new Date(),
      expiresAt: input.expiresAt,
    };

    await this.store.save(trigger);

    const jobData: SchedulerJobData = {
      triggerId: id,
      organizationId: input.organizationId,
      action: input.action,
    };

    if (input.type === "timer" && input.fireAt) {
      const delay = computeTimerDelay(input.fireAt);
      await this.queue.add(`timer:${id}`, jobData, { delay, jobId: `timer:${id}` });
    } else if (input.type === "cron" && input.cronExpression) {
      const repeatOpts = computeCronRepeatOpts(input.cronExpression, input.expiresAt);
      await this.queue.upsertJobScheduler(`cron:${id}`, repeatOpts, { data: jobData });
    }
    // event_match triggers have no BullMQ job — checked by EventLoop on dispatch

    return id;
  }

  async cancelTrigger(triggerId: string): Promise<void> {
    const trigger = await this.store.findById(triggerId);
    if (!trigger) {
      throw new Error(`Trigger not found: ${triggerId}`);
    }

    validateTriggerTransition(trigger.status, "cancelled");
    await this.store.updateStatus(triggerId, "cancelled");

    if (trigger.type === "timer") {
      try {
        await this.queue.remove(`timer:${triggerId}`);
      } catch {
        // Job may have already fired — safe to ignore
      }
    } else if (trigger.type === "cron") {
      try {
        await this.queue.removeJobScheduler(`cron:${triggerId}`);
      } catch {
        // Scheduler may not exist — safe to ignore
      }
    }
  }

  async listPendingTriggers(filters: TriggerFilters): Promise<ScheduledTrigger[]> {
    return this.store.findByFilters(filters);
  }

  async matchEvent(
    organizationId: string,
    eventType: string,
    eventData: Record<string, unknown>,
  ): Promise<ScheduledTrigger[]> {
    const candidates = await this.store.findByFilters({
      organizationId,
      status: "active",
      type: "event_match",
    });

    return candidates.filter((trigger) => {
      if (!trigger.eventPattern) return false;
      if (trigger.eventPattern.type !== eventType) return false;

      for (const [key, value] of Object.entries(trigger.eventPattern.filters)) {
        if (eventData[key] !== value) return false;
      }
      return true;
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api test -- bullmq-scheduler-service`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
sl commit -m "feat(api): add BullMQ-backed SchedulerService with timer, cron, and event_match support"
```

---

## Task 6: Scheduler Job Handler (Trigger Firing)

**Files:**

- Create: `apps/api/src/scheduler/trigger-handler.ts`
- Create: `apps/api/src/scheduler/__tests__/trigger-handler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/scheduler/__tests__/trigger-handler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTriggerHandler } from "../trigger-handler.js";
import type { TriggerStore, SchedulerService } from "@switchboard/core";
import type { WorkflowEngine } from "@switchboard/core";

describe("createTriggerHandler", () => {
  let store: { findById: ReturnType<typeof vi.fn>; updateStatus: ReturnType<typeof vi.fn> };
  let workflowEngine: {
    createWorkflow: ReturnType<typeof vi.fn>;
    startWorkflow: ReturnType<typeof vi.fn>;
    resumeAfterApproval: ReturnType<typeof vi.fn>;
  };
  let handler: ReturnType<typeof createTriggerHandler>;

  beforeEach(() => {
    store = {
      findById: vi.fn(),
      updateStatus: vi.fn(),
    };
    workflowEngine = {
      createWorkflow: vi.fn(async () => ({ id: "wf-new" })),
      startWorkflow: vi.fn(async () => ({ status: "completed" })),
      resumeAfterApproval: vi.fn(),
    };
    handler = createTriggerHandler({
      store: store as unknown as TriggerStore,
      workflowEngine: workflowEngine as unknown as WorkflowEngine,
    });
  });

  it("skips if trigger is no longer active", async () => {
    store.findById.mockResolvedValue({ id: "trig-1", status: "cancelled" });

    await handler({
      data: {
        triggerId: "trig-1",
        organizationId: "org-1",
        action: { type: "spawn_workflow", payload: {} },
      },
    } as never);

    expect(workflowEngine.createWorkflow).not.toHaveBeenCalled();
    expect(store.updateStatus).not.toHaveBeenCalled();
  });

  it("skips if trigger not found", async () => {
    store.findById.mockResolvedValue(null);

    await handler({
      data: {
        triggerId: "trig-1",
        organizationId: "org-1",
        action: { type: "spawn_workflow", payload: {} },
      },
    } as never);

    expect(workflowEngine.createWorkflow).not.toHaveBeenCalled();
  });

  it("spawns a workflow for spawn_workflow action", async () => {
    store.findById.mockResolvedValue({
      id: "trig-1",
      status: "active",
      type: "timer",
      organizationId: "org-1",
    });

    await handler({
      data: {
        triggerId: "trig-1",
        organizationId: "org-1",
        action: {
          type: "spawn_workflow",
          payload: { sourceAgent: "nurture", intent: "follow_up" },
        },
      },
    } as never);

    expect(workflowEngine.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        triggerType: "schedule",
        triggerRef: "trig-1",
        sourceAgent: "nurture",
        actions: [],
        strategy: "sequential",
      }),
    );
    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith("wf-new");
    expect(store.updateStatus).toHaveBeenCalledWith("trig-1", "fired");
  });

  it("does not mark cron trigger as fired (stays active)", async () => {
    store.findById.mockResolvedValue({
      id: "trig-1",
      status: "active",
      type: "cron",
      organizationId: "org-1",
    });

    await handler({
      data: {
        triggerId: "trig-1",
        organizationId: "org-1",
        action: { type: "spawn_workflow", payload: {} },
      },
    } as never);

    expect(workflowEngine.createWorkflow).toHaveBeenCalled();
    // Cron triggers stay active — they fire repeatedly
    expect(store.updateStatus).not.toHaveBeenCalledWith("trig-1", "fired");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- trigger-handler`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Write trigger-handler.ts**

Create `apps/api/src/scheduler/trigger-handler.ts`:

```typescript
import type { Job } from "bullmq";
import type { TriggerStore, WorkflowEngine } from "@switchboard/core";
import type { SchedulerJobData } from "../queue/scheduler-queue.js";

export interface TriggerHandlerDeps {
  store: TriggerStore;
  workflowEngine: WorkflowEngine;
}

export function createTriggerHandler(deps: TriggerHandlerDeps) {
  const { store, workflowEngine } = deps;

  return async function handleTriggerFired(job: Job<SchedulerJobData>): Promise<void> {
    const { triggerId, organizationId, action } = job.data;

    const trigger = await store.findById(triggerId);
    if (!trigger || trigger.status !== "active") {
      return; // Trigger was cancelled or already fired
    }

    if (action.type === "spawn_workflow") {
      const payload = action.payload as Record<string, unknown>;
      const workflow = await workflowEngine.createWorkflow({
        organizationId,
        triggerType: "schedule",
        triggerRef: triggerId,
        sourceAgent: (payload.sourceAgent as string) ?? "scheduler",
        actions: [],
        strategy: "sequential",
        safetyEnvelope: {
          maxSteps: (payload.maxSteps as number) ?? 10,
          maxDollarsAtRisk: (payload.maxDollarsAtRisk as number) ?? 0,
          timeoutMs: (payload.timeoutMs as number) ?? 300_000,
          maxReplans: (payload.maxReplans as number) ?? 3,
        },
        metadata: payload,
      });
      await workflowEngine.startWorkflow(workflow.id);
    } else if (action.type === "resume_workflow") {
      const workflowId = (action.payload as Record<string, unknown>).workflowId as string;
      if (workflowId) {
        await workflowEngine.startWorkflow(workflowId);
      }
    }
    // emit_event: handled by EventLoop integration (Task 8), not here

    // Timer triggers fire once — mark as fired. Cron triggers stay active.
    if (trigger.type === "timer") {
      await store.updateStatus(triggerId, "fired");
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api test -- trigger-handler`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
sl commit -m "feat(api): add trigger handler for processing fired scheduler jobs"
```

---

## Task 7: WorkflowEngine `scheduled` State Integration

**Files:**

- Modify: `packages/core/src/workflows/workflow-engine.ts`
- Modify: `packages/core/src/workflows/__tests__/workflow-engine.test.ts`

This task adds the ability for WorkflowEngine to transition a workflow to `scheduled` state when a step result includes a `scheduleRequest`. The engine stores the request in `workflow.metadata.scheduleRequest` and transitions to `scheduled`. The API layer reads this metadata to register the actual trigger (engine does NOT call SchedulerService — that would violate layer boundaries).

**Key types (existing):**

- `WorkflowEngine.startWorkflow()` returns `Promise<WorkflowExecution>` — do NOT change this return type
- `StepExecutionResult` has `outcome: StepExecutionOutcome` (not `status`), `result?: unknown`, `error?: string`, `reason?: string`
- `StepExecutionOutcome = "completed" | "failed" | "rejected" | "requires_approval"`

- [ ] **Step 1: Write the failing test**

Add to the existing `packages/core/src/workflows/__tests__/workflow-engine.test.ts`:

```typescript
describe("scheduled state", () => {
  it("transitions to scheduled when step result contains scheduleRequest", async () => {
    const action = createPendingAction({
      intent: "schedule_follow_up",
      organizationId: "org-1",
      sourceAgent: "nurture",
      humanSummary: "Schedule follow-up in 2 hours",
    });

    const workflow = await engine.createWorkflow({
      organizationId: "org-1",
      triggerType: "operator_command",
      sourceAgent: "nurture",
      actions: [action],
      strategy: "sequential",
      safetyEnvelope: { maxSteps: 5, maxDollarsAtRisk: 0, timeoutMs: 300000, maxReplans: 3 },
      metadata: {},
    });

    // The StepExecutor returns a completed outcome with a scheduleRequest
    mockStepExecutor.execute.mockResolvedValueOnce({
      outcome: "completed",
      result: {
        scheduleRequest: {
          fireAt: new Date(Date.now() + 7200_000).toISOString(),
          reason: "Follow up in 2 hours",
        },
      },
    });

    const result = await engine.startWorkflow(workflow.id);
    expect(result.status).toBe("scheduled");
    // Schedule request stored in metadata for API layer to read
    expect(result.metadata.scheduleRequest).toBeDefined();
    expect(result.metadata.scheduleRequest.reason).toBe("Follow up in 2 hours");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- workflow-engine`
Expected: FAIL — workflow status is `completed` not `scheduled`

- [ ] **Step 3: Add schedule detection to handleStepSuccess**

In `packages/core/src/workflows/workflow-engine.ts`, modify the `handleStepSuccess` method. After the step succeeds, check if the result contains a `scheduleRequest` object. If so, store it in metadata and transition to `scheduled`:

```typescript
// In handleStepSuccess(), after advancing the step and updating counters:
// Check if step result requests scheduling
const stepResult = result.result as Record<string, unknown> | undefined;
if (stepResult?.scheduleRequest) {
  await this.deps.workflows.update(workflowId, {
    plan: updatedPlan,
    currentStepIndex: nextStep.index + 1,
    counters: {
      /* same as above */
    },
    status: "scheduled",
    metadata: {
      ...workflow.metadata,
      scheduleRequest: stepResult.scheduleRequest,
    },
  });
  return this.requireWorkflow(workflowId);
}
```

This uses the existing `result` field on `StepExecutionResult` (type `unknown`) as the carrier — no interface changes needed. The convention is: if `result.scheduleRequest` exists, the engine transitions to `scheduled` and stores it in `workflow.metadata`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- workflow-engine`
Expected: All tests PASS (existing + new)

- [ ] **Step 5: Commit**

```bash
sl commit -m "feat(core): add scheduled state support to WorkflowEngine via metadata.scheduleRequest"
```

---

## Task 8: EventLoop Event-Match Trigger Integration

**Files:**

- Modify: `packages/agents/src/event-loop.ts`
- Modify: `packages/agents/src/__tests__/event-loop.test.ts`

When the EventLoop dispatches events, it should check for active `event_match` triggers and fire them. The SchedulerService is injected as an optional dependency.

**Key types (existing):**

- `EventLoop.process(event: RoutedEventEnvelope, context: AgentContext)` — event has `eventType` (not `type`), `organizationId`, `payload`, `eventId`, `idempotencyKey`, etc.
- `AgentContext` has `organizationId`, `profile?`, `conversationHistory?`, `contactData?`, `thread?`
- `RoutedEventEnvelope` has `organizationId` on the event object itself (not on context)

- [ ] **Step 1: Write the failing test**

Add to `packages/agents/src/__tests__/event-loop.test.ts`:

```typescript
import { createEventEnvelope } from "../events.js";

describe("event-match trigger integration", () => {
  it("checks for matching triggers when processing events", async () => {
    const mockScheduler = {
      matchEvent: vi.fn(async () => []),
      registerTrigger: vi.fn(),
      cancelTrigger: vi.fn(),
      listPendingTriggers: vi.fn(),
    };

    const loop = new EventLoop({
      ...baseConfig,
      scheduler: mockScheduler,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "payment.received",
      source: { type: "webhook", id: "stripe" },
      payload: { amount: 100 },
    });

    await loop.process(event, { organizationId: "org-1" });

    expect(mockScheduler.matchEvent).toHaveBeenCalledWith(
      "org-1",
      "payment.received",
      expect.objectContaining({ amount: 100 }),
    );
  });

  it("fires matched triggers by invoking onTriggerFired callback", async () => {
    const mockTrigger = {
      id: "trig-1",
      organizationId: "org-1",
      type: "event_match" as const,
      action: { type: "resume_workflow" as const, payload: { workflowId: "wf-1" } },
      status: "active" as const,
      eventPattern: { type: "payment.received", filters: {} },
      fireAt: null,
      cronExpression: null,
      sourceWorkflowId: "wf-1",
      createdAt: new Date(),
      expiresAt: null,
    };

    const mockScheduler = {
      matchEvent: vi.fn(async () => [mockTrigger]),
      registerTrigger: vi.fn(),
      cancelTrigger: vi.fn(),
      listPendingTriggers: vi.fn(),
    };

    const onTriggerFired = vi.fn();

    const loop = new EventLoop({
      ...baseConfig,
      scheduler: mockScheduler,
      onTriggerFired,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "payment.received",
      source: { type: "webhook", id: "stripe" },
      payload: { amount: 100 },
    });

    await loop.process(event, { organizationId: "org-1" });

    expect(onTriggerFired).toHaveBeenCalledWith(mockTrigger);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/agents test -- event-loop`
Expected: FAIL — `scheduler` not in EventLoopConfig

- [ ] **Step 3: Add scheduler integration to EventLoop**

In `packages/agents/src/event-loop.ts`, modify the `EventLoopConfig` interface to add optional scheduler:

```typescript
import type { SchedulerService } from "@switchboard/core";
import type { ScheduledTrigger } from "@switchboard/schemas";

// Add to EventLoopConfig:
scheduler?: SchedulerService;
onTriggerFired?: (trigger: ScheduledTrigger) => void | Promise<void>;
```

Store them as instance fields in the constructor (same pattern as `stateTracker` and `contactMutex`):

```typescript
private scheduler?: SchedulerService;
private onTriggerFired?: (trigger: ScheduledTrigger) => void | Promise<void>;

// In constructor:
this.scheduler = config.scheduler;
this.onTriggerFired = config.onTriggerFired;
```

In the `processRecursive()` method, add event-match checking near the top (after the idempotency/depth guard, before routing). Use `event.organizationId` and `event.eventType` (the actual field names on `RoutedEventEnvelope`):

```typescript
// Check for event-match triggers
if (this.scheduler) {
  const eventData = (event.payload ?? {}) as Record<string, unknown>;
  const matchedTriggers = await this.scheduler.matchEvent(
    event.organizationId,
    event.eventType,
    eventData,
  );
  for (const trigger of matchedTriggers) {
    if (this.onTriggerFired) {
      await this.onTriggerFired(trigger);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/agents test -- event-loop`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
sl commit -m "feat(agents): add event-match trigger checking in EventLoop dispatch"
```

---

## Task 9: Scheduler API Routes

**Files:**

- Create: `apps/api/src/routes/scheduler.ts`
- Create: `apps/api/src/routes/__tests__/scheduler.test.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/__tests__/scheduler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { schedulerRoutes } from "../scheduler.js";

function createMockSchedulerService() {
  return {
    registerTrigger: vi.fn(async () => "trig-1"),
    cancelTrigger: vi.fn(async () => undefined),
    listPendingTriggers: vi.fn(async () => []),
    matchEvent: vi.fn(async () => []),
  };
}

describe("scheduler routes", () => {
  let app: ReturnType<typeof Fastify>;
  let scheduler: ReturnType<typeof createMockSchedulerService>;

  beforeEach(async () => {
    scheduler = createMockSchedulerService();
    app = Fastify();
    app.decorate("schedulerService", scheduler);
    await app.register(schedulerRoutes, { prefix: "/api/scheduler" });
    await app.ready();
  });

  describe("POST /api/scheduler/triggers", () => {
    it("creates a timer trigger", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/scheduler/triggers",
        payload: {
          organizationId: "org-1",
          type: "timer",
          fireAt: "2026-04-01T10:00:00Z",
          cronExpression: null,
          eventPattern: null,
          action: { type: "spawn_workflow", payload: {} },
          sourceWorkflowId: null,
          expiresAt: null,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.triggerId).toBe("trig-1");
    });

    it("returns 400 for invalid trigger type", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/scheduler/triggers",
        payload: {
          organizationId: "org-1",
          type: "invalid",
          action: { type: "spawn_workflow", payload: {} },
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("DELETE /api/scheduler/triggers/:id", () => {
    it("cancels a trigger", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/scheduler/triggers/trig-1",
      });

      expect(response.statusCode).toBe(204);
      expect(scheduler.cancelTrigger).toHaveBeenCalledWith("trig-1");
    });

    it("returns 404 when trigger not found", async () => {
      scheduler.cancelTrigger.mockRejectedValue(new Error("Trigger not found: trig-x"));

      const response = await app.inject({
        method: "DELETE",
        url: "/api/scheduler/triggers/trig-x",
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /api/scheduler/triggers", () => {
    it("lists triggers with filters", async () => {
      scheduler.listPendingTriggers.mockResolvedValue([
        {
          id: "trig-1",
          organizationId: "org-1",
          type: "timer",
          status: "active",
          action: { type: "spawn_workflow", payload: {} },
          fireAt: new Date(),
          cronExpression: null,
          eventPattern: null,
          sourceWorkflowId: null,
          createdAt: new Date(),
          expiresAt: null,
        },
      ]);

      const response = await app.inject({
        method: "GET",
        url: "/api/scheduler/triggers?organizationId=org-1&status=active",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.triggers).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- routes/scheduler`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Write scheduler routes**

Create `apps/api/src/routes/scheduler.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import {
  TriggerTypeSchema,
  TriggerActionSchema,
  EventPatternSchema,
  TriggerFiltersSchema,
} from "@switchboard/schemas";
import { z } from "zod";

const CreateTriggerBodySchema = z.object({
  organizationId: z.string(),
  type: TriggerTypeSchema,
  fireAt: z.coerce.date().nullable().optional().default(null),
  cronExpression: z.string().nullable().optional().default(null),
  eventPattern: EventPatternSchema.nullable().optional().default(null),
  action: TriggerActionSchema,
  sourceWorkflowId: z.string().nullable().optional().default(null),
  expiresAt: z.coerce.date().nullable().optional().default(null),
});

export async function schedulerRoutes(app: FastifyInstance): Promise<void> {
  const scheduler = app.schedulerService;

  if (!scheduler) {
    app.log.warn("SchedulerService not available — scheduler routes disabled");
    return;
  }

  // Create trigger
  app.post("/triggers", async (request, reply) => {
    const parsed = CreateTriggerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid trigger input", details: parsed.error.issues });
    }

    const triggerId = await scheduler.registerTrigger(parsed.data);
    return reply.status(201).send({ triggerId });
  });

  // Cancel trigger
  app.delete<{ Params: { id: string } }>("/triggers/:id", async (request, reply) => {
    try {
      await scheduler.cancelTrigger(request.params.id);
      return reply.status(204).send();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("not found")) {
        return reply.status(404).send({ error: message });
      }
      throw err;
    }
  });

  // List triggers
  app.get("/triggers", async (request, reply) => {
    const filters = TriggerFiltersSchema.parse(request.query);
    const triggers = await scheduler.listPendingTriggers(filters);
    return reply.send({ triggers });
  });
}
```

- [ ] **Step 4: Register routes in bootstrap**

In `apps/api/src/bootstrap/routes.ts`, add:

```typescript
import { schedulerRoutes } from "../routes/scheduler.js";

// In the route registration section:
app.register(schedulerRoutes, { prefix: "/api/scheduler" });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api test -- routes/scheduler`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
sl commit -m "feat(api): add scheduler REST API routes for trigger CRUD"
```

---

## Task 10: Bootstrap Wiring

**Files:**

- Create: `apps/api/src/bootstrap/scheduler-deps.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write scheduler-deps.ts**

Create `apps/api/src/bootstrap/scheduler-deps.ts`:

**Note:** The existing BullMQ pattern in `app.ts` uses `{ url: redisUrl }` as the connection config (line 390). Follow this same pattern — do NOT pass an ioredis instance.

```typescript
import type { PrismaClient } from "@prisma/client";
import type { SchedulerService, WorkflowEngine } from "@switchboard/core";
import { PrismaTriggerStore } from "@switchboard/db";
import { BullMQSchedulerService } from "../scheduler/bullmq-scheduler-service.js";
import { createSchedulerQueue, createSchedulerWorker } from "../queue/scheduler-queue.js";
import { createTriggerHandler } from "../scheduler/trigger-handler.js";
import type { TriggerHandlerDeps } from "../scheduler/trigger-handler.js";

export interface SchedulerDeps {
  service: SchedulerService;
  /** Pre-built trigger handler — reuse this instead of creating new instances. */
  triggerHandler: (job: {
    data: import("../queue/scheduler-queue.js").SchedulerJobData;
  }) => Promise<void>;
  cleanup: () => Promise<void>;
}

export function buildSchedulerDeps(
  prisma: PrismaClient,
  redisUrl: string,
  workflowEngine: WorkflowEngine,
): SchedulerDeps {
  const connection = { url: redisUrl };
  const store = new PrismaTriggerStore(prisma);
  const queue = createSchedulerQueue(connection);
  const service = new BullMQSchedulerService(store, queue);

  const triggerHandler = createTriggerHandler({ store, workflowEngine });
  const worker = createSchedulerWorker(connection, triggerHandler);

  return {
    service,
    triggerHandler,
    cleanup: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
```

- [ ] **Step 2: Wire into app.ts**

In `apps/api/src/app.ts`, add the scheduler to Fastify's declaration merging (inside `FastifyInstance`):

```typescript
schedulerService: import("@switchboard/core").SchedulerService | null;
```

In the bootstrap section, add after workflow deps are created (around line 380) and before execution queue setup (line 382). Use the `redisUrl` string (already extracted at line 386), not the `redis` ioredis instance:

```typescript
// --- Scheduler service bootstrap (optional — requires DATABASE_URL + REDIS_URL + workflow engine) ---
let schedulerDeps: import("./bootstrap/scheduler-deps.js").SchedulerDeps | null = null;
const redisUrl = process.env["REDIS_URL"]; // already exists at line 386 — reuse
if (prismaClient && redisUrl && workflowDeps) {
  const { buildSchedulerDeps } = await import("./bootstrap/scheduler-deps.js");
  schedulerDeps = buildSchedulerDeps(prismaClient, redisUrl, workflowDeps.workflowEngine);
  app.log.info("Scheduler service bootstrapped");
}
app.decorate("schedulerService", schedulerDeps?.service ?? null);
```

In the onClose hook (around line 490), add before worker/queue cleanup:

```typescript
if (schedulerDeps) {
  await schedulerDeps.cleanup();
}
```

Also wire the scheduler into EventLoop config (wherever EventLoop is created). Reuse the `triggerHandler` from `schedulerDeps` — do NOT create new store/handler instances:

```typescript
// When creating EventLoop config, add:
scheduler: schedulerDeps?.service ?? undefined,
onTriggerFired: schedulerDeps
  ? async (trigger) => {
      await schedulerDeps!.triggerHandler({
        data: {
          triggerId: trigger.id,
          organizationId: trigger.organizationId,
          action: trigger.action,
        },
      });
    }
  : undefined,
```

- [ ] **Step 3: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS (no type errors)

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
sl commit -m "feat(api): wire SchedulerService into app bootstrap and EventLoop"
```

---

## Task 11: Expired Trigger Cleanup Job

**Files:**

- Modify: `apps/api/src/bootstrap/jobs.ts`
- Create: `apps/api/src/jobs/__tests__/trigger-cleanup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/jobs/__tests__/trigger-cleanup.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createTriggerCleanupJob } from "../trigger-cleanup.js";
import type { TriggerStore } from "@switchboard/core";

describe("trigger cleanup job", () => {
  it("calls deleteExpired with current date", async () => {
    const store: Partial<TriggerStore> = {
      deleteExpired: vi.fn(async () => 5),
    };

    const job = createTriggerCleanupJob(store as TriggerStore);
    const deleted = await job();
    expect(deleted).toBe(5);
    expect(store.deleteExpired).toHaveBeenCalledWith(expect.any(Date));
  });
});
```

- [ ] **Step 2: Create trigger-cleanup.ts**

Create `apps/api/src/jobs/trigger-cleanup.ts`:

```typescript
import type { TriggerStore } from "@switchboard/core";

export function createTriggerCleanupJob(store: TriggerStore): () => Promise<number> {
  return async () => {
    return store.deleteExpired(new Date());
  };
}
```

- [ ] **Step 3: Register in background jobs**

In `apps/api/src/bootstrap/jobs.ts`, add the trigger cleanup to the background job schedule (runs hourly):

```typescript
// Add to the background jobs list:
{ kind: "trigger-cleanup", interval: 3600_000 }
```

Wire the handler in the background worker dispatch to call `createTriggerCleanupJob`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/api test -- trigger-cleanup`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
sl commit -m "feat(api): add expired trigger cleanup background job"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck --force`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 3: Run linter**

Run: `pnpm lint`
Expected: PASS (no lint errors)

- [ ] **Step 4: Check file sizes**

Verify no new file exceeds 400 lines:

```bash
wc -l packages/core/src/scheduler/*.ts packages/db/src/stores/prisma-trigger-store.ts apps/api/src/scheduler/*.ts apps/api/src/queue/scheduler-queue.ts apps/api/src/routes/scheduler.ts
```

Expected: All files under 200 lines

- [ ] **Step 5: Verify architecture layers**

```bash
pnpm lint # dependency-cruiser rules catch layer violations
```

- [ ] **Step 6: Commit any final fixes**

```bash
sl commit -m "chore: Phase 4 scheduler service final verification fixes"
```
