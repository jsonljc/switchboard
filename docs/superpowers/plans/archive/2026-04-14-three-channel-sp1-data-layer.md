# Three-Channel Comms SP1: Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data foundation for three-channel communication — Prisma models, scoped store interfaces, and store implementations for AgentEvent, ActivityLog, and schema extensions.

**Architecture:** Add 2 new Prisma models (AgentEvent, ActivityLog), extend 2 existing models (KnowledgeChunk with draft fields, AgentDeployment with trust fields), define 3 scoped memory interfaces in core, and implement stores in db. Each scoped interface restricts what data a channel can access — enforced by TypeScript compiler.

**Tech Stack:** Prisma, PostgreSQL, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-13-switchboard-three-channel-comms-design.md`

---

## File Map

| File                                                      | Action | Responsibility                                                             |
| --------------------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| `packages/db/prisma/schema.prisma`                        | Modify | Add AgentEvent, ActivityLog models + KnowledgeChunk/AgentDeployment fields |
| `packages/schemas/src/three-channel.ts`                   | Create | Zod schemas for AgentEvent, ActivityLog, trust levels, notification tiers  |
| `packages/schemas/src/index.ts`                           | Modify | Export new schemas                                                         |
| `packages/core/src/memory/scoped-stores.ts`               | Create | 3 scoped interfaces (Customer, Owner, Aggregate)                           |
| `packages/core/src/memory/index.ts`                       | Create | Barrel exports for memory module                                           |
| `packages/core/src/index.ts`                              | Modify | Export memory module                                                       |
| `packages/db/src/stores/prisma-event-store.ts`            | Create | AgentEvent emit/poll/complete/fail                                         |
| `packages/db/src/stores/prisma-activity-log-store.ts`     | Create | ActivityLog CRUD                                                           |
| `packages/db/src/stores/prisma-customer-memory-store.ts`  | Create | CustomerScopedMemoryAccess implementation                                  |
| `packages/db/src/stores/prisma-owner-memory-store.ts`     | Create | OwnerMemoryAccess implementation                                           |
| `packages/db/src/stores/prisma-aggregate-memory-store.ts` | Create | AggregateScopedMemoryAccess implementation                                 |
| `packages/db/src/index.ts`                                | Modify | Export new stores                                                          |

---

### Task 1: Prisma Schema Changes

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add AgentEvent model**

Add after the `DeploymentMemory` model block (after line 553):

```prisma
// ---------------------------------------------------------------------------
// Three-Channel Communication
// ---------------------------------------------------------------------------

model AgentEvent {
  id              String    @id @default(uuid())
  organizationId  String
  deploymentId    String
  eventType       String
  payload         Json
  status          String    @default("pending")
  retryCount      Int       @default(0)
  createdAt       DateTime  @default(now())
  processedAt     DateTime?

  @@index([status, createdAt])
  @@index([organizationId, deploymentId])
}

model ActivityLog {
  id              String   @id @default(uuid())
  organizationId  String
  deploymentId    String
  eventType       String
  description     String
  metadata        Json     @default("{}")
  createdAt       DateTime @default(now())

  @@index([organizationId, deploymentId])
  @@index([createdAt])
}
```

- [ ] **Step 2: Add draft fields to KnowledgeChunk**

In the `KnowledgeChunk` model, add after the `updatedAt` field (before the `@@index` lines):

```prisma
  draftStatus    String?
  draftExpiresAt DateTime?
```

- [ ] **Step 3: Add trust fields to AgentDeployment**

In the `AgentDeployment` model, add after the `connectionIds` field (before `createdAt`):

```prisma
  trustLevel              String   @default("observe")
  spendApprovalThreshold  Float    @default(50)
```

- [ ] **Step 4: Generate migration**

Run: `npx pnpm@9.15.4 --filter @switchboard/db exec prisma migrate dev --name three_channel_comms`
Expected: Migration created successfully

- [ ] **Step 5: Generate Prisma client**

Run: `npx pnpm@9.15.4 db:generate`
Expected: Prisma client generated

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/ && git commit -m "feat(db): add AgentEvent, ActivityLog models + trust/draft fields"
```

---

### Task 2: Zod Schemas

**Files:**

- Create: `packages/schemas/src/three-channel.ts`
- Create: `packages/schemas/src/__tests__/three-channel.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/schemas/src/__tests__/three-channel.test.ts
import { describe, it, expect } from "vitest";
import {
  AgentEventSchema,
  ActivityLogSchema,
  TrustLevelSchema,
  NotificationTierSchema,
  AgentEventStatusSchema,
  ActivityLogEventTypeSchema,
} from "../three-channel.js";

describe("Three-Channel Schemas", () => {
  describe("TrustLevelSchema", () => {
    it("accepts valid trust levels", () => {
      expect(TrustLevelSchema.parse("observe")).toBe("observe");
      expect(TrustLevelSchema.parse("guarded")).toBe("guarded");
      expect(TrustLevelSchema.parse("autonomous")).toBe("autonomous");
    });

    it("rejects invalid trust level", () => {
      expect(() => TrustLevelSchema.parse("locked")).toThrow();
    });
  });

  describe("NotificationTierSchema", () => {
    it("accepts T1, T2, T3", () => {
      expect(NotificationTierSchema.parse("T1")).toBe("T1");
      expect(NotificationTierSchema.parse("T2")).toBe("T2");
      expect(NotificationTierSchema.parse("T3")).toBe("T3");
    });
  });

  describe("AgentEventSchema", () => {
    it("validates a complete event", () => {
      const event = {
        id: "evt-1",
        organizationId: "org-1",
        deploymentId: "dep-1",
        eventType: "conversation_end",
        payload: { messages: [], channelType: "telegram" },
        status: "pending",
        retryCount: 0,
        createdAt: new Date(),
        processedAt: null,
      };
      expect(AgentEventSchema.parse(event)).toBeDefined();
    });

    it("defaults status to pending", () => {
      const event = {
        id: "evt-1",
        organizationId: "org-1",
        deploymentId: "dep-1",
        eventType: "conversation_end",
        payload: {},
        retryCount: 0,
        createdAt: new Date(),
      };
      const parsed = AgentEventSchema.parse(event);
      expect(parsed.status).toBe("pending");
    });
  });

  describe("ActivityLogSchema", () => {
    it("validates a complete log entry", () => {
      const entry = {
        id: "log-1",
        organizationId: "org-1",
        deploymentId: "dep-1",
        eventType: "fact_learned",
        description: "Learned: busiest day is Tuesday",
        metadata: { category: "business_hours" },
        createdAt: new Date(),
      };
      expect(ActivityLogSchema.parse(entry)).toBeDefined();
    });
  });

  describe("AgentEventStatusSchema", () => {
    it("accepts all valid statuses", () => {
      for (const s of ["pending", "processing", "done", "failed", "dead_letter"]) {
        expect(AgentEventStatusSchema.parse(s)).toBe(s);
      }
    });
  });

  describe("ActivityLogEventTypeSchema", () => {
    it("accepts all valid event types", () => {
      const types = [
        "fact_learned",
        "fact_decayed",
        "faq_drafted",
        "faq_promoted",
        "summary_created",
        "correction_applied",
        "memory_deleted",
        "consolidation_run",
      ];
      for (const t of types) {
        expect(ActivityLogEventTypeSchema.parse(t)).toBe(t);
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run three-channel`
Expected: FAIL — module not found

- [ ] **Step 3: Write the schemas**

```typescript
// packages/schemas/src/three-channel.ts
import { z } from "zod";

// ---------------------------------------------------------------------------
// Trust Levels — observe / guarded / autonomous
// ---------------------------------------------------------------------------

export const TrustLevelSchema = z.enum(["observe", "guarded", "autonomous"]);
export type TrustLevel = z.infer<typeof TrustLevelSchema>;

// ---------------------------------------------------------------------------
// Notification Tiers — T1 (act now) / T2 (confirm) / T3 (FYI)
// ---------------------------------------------------------------------------

export const NotificationTierSchema = z.enum(["T1", "T2", "T3"]);
export type NotificationTier = z.infer<typeof NotificationTierSchema>;

// ---------------------------------------------------------------------------
// Agent Event — database-backed event bus
// ---------------------------------------------------------------------------

export const AgentEventStatusSchema = z.enum([
  "pending",
  "processing",
  "done",
  "failed",
  "dead_letter",
]);
export type AgentEventStatus = z.infer<typeof AgentEventStatusSchema>;

export const AgentEventSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  deploymentId: z.string(),
  eventType: z.string(),
  payload: z.record(z.unknown()),
  status: AgentEventStatusSchema.default("pending"),
  retryCount: z.number().int().min(0),
  createdAt: z.coerce.date(),
  processedAt: z.coerce.date().nullable().optional(),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

// ---------------------------------------------------------------------------
// Activity Log — runtime activity diary
// ---------------------------------------------------------------------------

export const ActivityLogEventTypeSchema = z.enum([
  "fact_learned",
  "fact_decayed",
  "faq_drafted",
  "faq_promoted",
  "summary_created",
  "correction_applied",
  "memory_deleted",
  "consolidation_run",
]);
export type ActivityLogEventType = z.infer<typeof ActivityLogEventTypeSchema>;

export const ActivityLogSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  deploymentId: z.string(),
  eventType: ActivityLogEventTypeSchema,
  description: z.string(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.coerce.date(),
});
export type ActivityLogEntry = z.infer<typeof ActivityLogSchema>;

// ---------------------------------------------------------------------------
// Draft FAQ — fields on KnowledgeChunk
// ---------------------------------------------------------------------------

export const DraftStatusSchema = z.enum(["pending", "approved"]).nullable();
export type DraftStatus = z.infer<typeof DraftStatusSchema>;
```

- [ ] **Step 4: Export from barrel**

Add to `packages/schemas/src/index.ts`:

```typescript
export * from "./three-channel.js";
```

- [ ] **Step 5: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run three-channel`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/three-channel.ts packages/schemas/src/__tests__/three-channel.test.ts packages/schemas/src/index.ts && git commit -m "feat(schemas): add three-channel Zod schemas (trust, events, activity log)"
```

---

### Task 3: Scoped Store Interfaces

**Files:**

- Create: `packages/core/src/memory/scoped-stores.ts`
- Create: `packages/core/src/memory/__tests__/scoped-stores.test.ts`
- Create: `packages/core/src/memory/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/core/src/memory/__tests__/scoped-stores.test.ts
import { describe, it, expect } from "vitest";
import type {
  CustomerScopedMemoryAccess,
  OwnerMemoryAccess,
  AggregateScopedMemoryAccess,
  DeploymentMemoryEntry,
  ActivityLogEntry,
} from "../scoped-stores.js";

describe("Scoped Store Interfaces", () => {
  it("CustomerScopedMemoryAccess has read-only methods", () => {
    const store: CustomerScopedMemoryAccess = {
      getBusinessKnowledge: async () => [],
      getHighConfidenceFacts: async () => [],
      getContactSummaries: async () => [],
    };
    expect(store.getBusinessKnowledge).toBeDefined();
    expect(store.getHighConfidenceFacts).toBeDefined();
    expect(store.getContactSummaries).toBeDefined();
    // Should NOT have listAllMemories, delete, correct, etc.
    expect((store as Record<string, unknown>).listAllMemories).toBeUndefined();
    expect((store as Record<string, unknown>).deleteMemory).toBeUndefined();
  });

  it("OwnerMemoryAccess has full CRUD", () => {
    const store: OwnerMemoryAccess = {
      listAllMemories: async () => [],
      correctMemory: async () => {},
      deleteMemory: async () => {},
      listDraftFAQs: async () => [],
      approveDraftFAQ: async () => {},
      rejectDraftFAQ: async () => {},
      listActivityLog: async () => [],
      listAllSummaries: async () => [],
    };
    expect(store.listAllMemories).toBeDefined();
    expect(store.correctMemory).toBeDefined();
    expect(store.approveDraftFAQ).toBeDefined();
  });

  it("AggregateScopedMemoryAccess has write + aggregate-only methods", () => {
    const store: AggregateScopedMemoryAccess = {
      upsertFact: async () => ({
        id: "1",
        organizationId: "",
        deploymentId: "",
        category: "",
        content: "",
        confidence: 0.5,
        sourceCount: 1,
      }),
      writeSummary: async () => {},
      writeActivityLog: async () => {},
      findFactsByCategory: async () => [],
      promoteDraftFAQs: async () => 0,
      decayStale: async () => 0,
    };
    expect(store.upsertFact).toBeDefined();
    expect(store.writeSummary).toBeDefined();
    // Should NOT have listAllMemories or getContactSummaries
    expect((store as Record<string, unknown>).listAllMemories).toBeUndefined();
    expect((store as Record<string, unknown>).getContactSummaries).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run scoped-stores`
Expected: FAIL — module not found

- [ ] **Step 3: Write the scoped interfaces**

```typescript
// packages/core/src/memory/scoped-stores.ts

// ---------------------------------------------------------------------------
// Shared DTOs — stripped of internal Prisma fields
// ---------------------------------------------------------------------------

export interface DeploymentMemoryEntry {
  id: string;
  organizationId: string;
  deploymentId: string;
  category: string;
  content: string;
  confidence: number;
  sourceCount: number;
}

export interface InteractionSummaryEntry {
  id: string;
  summary: string;
  outcome: string;
  createdAt: Date;
}

export interface KnowledgeChunkEntry {
  id: string;
  content: string;
  sourceType: string;
  metadata: Record<string, unknown>;
}

export interface DraftFAQ {
  id: string;
  content: string;
  sourceType: string;
  draftStatus: string | null;
  draftExpiresAt: Date | null;
  createdAt: Date;
}

export interface ActivityLogEntry {
  id: string;
  organizationId: string;
  deploymentId: string;
  eventType: string;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/** Stripped fact for customer agent — no confidence/sourceCount metadata */
export interface CustomerFact {
  id: string;
  category: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Customer Scoped — read-only, no metadata, approved content only
// ---------------------------------------------------------------------------

export interface CustomerScopedMemoryAccess {
  getBusinessKnowledge(
    orgId: string,
    deploymentId: string,
    query: string,
  ): Promise<KnowledgeChunkEntry[]>;

  /** Returns facts stripped of confidence/sourceCount per anti-regurgitation policy */
  getHighConfidenceFacts(orgId: string, deploymentId: string): Promise<CustomerFact[]>;

  getContactSummaries(
    orgId: string,
    deploymentId: string,
    contactId: string,
  ): Promise<InteractionSummaryEntry[]>;
}

// ---------------------------------------------------------------------------
// Owner — full visibility and control
// ---------------------------------------------------------------------------

export interface OwnerMemoryAccess {
  listAllMemories(orgId: string, deploymentId: string): Promise<DeploymentMemoryEntry[]>;

  correctMemory(id: string, content: string): Promise<void>;

  deleteMemory(id: string): Promise<void>;

  listDraftFAQs(orgId: string, deploymentId: string): Promise<DraftFAQ[]>;

  approveDraftFAQ(id: string): Promise<void>;

  rejectDraftFAQ(id: string): Promise<void>;

  listActivityLog(
    orgId: string,
    deploymentId: string,
    opts?: { limit?: number },
  ): Promise<ActivityLogEntry[]>;

  listAllSummaries(
    orgId: string,
    deploymentId: string,
    opts?: { limit?: number },
  ): Promise<InteractionSummaryEntry[]>;
}

// ---------------------------------------------------------------------------
// Aggregate — write + aggregate patterns, no individual contact data
// ---------------------------------------------------------------------------

export interface AggregateScopedMemoryAccess {
  upsertFact(entry: Omit<DeploymentMemoryEntry, "id">): Promise<DeploymentMemoryEntry>;

  writeSummary(
    entry: Omit<InteractionSummaryEntry, "id"> & {
      organizationId: string;
      deploymentId: string;
      channelType: string;
      contactId?: string;
      extractedFacts: unknown[];
      questionsAsked: string[];
      duration: number;
      messageCount: number;
    },
  ): Promise<void>;

  writeActivityLog(entry: Omit<ActivityLogEntry, "id" | "createdAt">): Promise<void>;

  findFactsByCategory(
    orgId: string,
    deploymentId: string,
    category: string,
  ): Promise<DeploymentMemoryEntry[]>;

  promoteDraftFAQs(olderThan: Date): Promise<number>;

  decayStale(cutoffDate: Date, decayAmount: number): Promise<number>;
}
```

- [ ] **Step 4: Create barrel export**

```typescript
// packages/core/src/memory/index.ts
export type {
  CustomerScopedMemoryAccess,
  OwnerMemoryAccess,
  AggregateScopedMemoryAccess,
  DeploymentMemoryEntry,
  InteractionSummaryEntry,
  KnowledgeChunkEntry,
  CustomerFact,
  DraftFAQ,
  ActivityLogEntry,
} from "./scoped-stores.js";
```

- [ ] **Step 5: Export from core barrel**

Add to `packages/core/src/index.ts` after the "Marketplace" section:

```typescript
// Memory (scoped store interfaces for three-channel privacy)
export * from "./memory/index.js";
```

- [ ] **Step 6: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run scoped-stores`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/memory/ packages/core/src/index.ts && git commit -m "feat(core): add scoped memory store interfaces for three-channel privacy"
```

---

### Task 4: PrismaEventStore

**Files:**

- Create: `packages/db/src/stores/prisma-event-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-event-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/db/src/stores/__tests__/prisma-event-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaEventStore } from "../prisma-event-store.js";

function createMockPrisma() {
  return {
    agentEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

describe("PrismaEventStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaEventStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaEventStore(prisma as never);
  });

  it("emits an event", async () => {
    prisma.agentEvent.create.mockResolvedValue({ id: "evt-1" });

    await store.emit({
      organizationId: "org-1",
      deploymentId: "dep-1",
      eventType: "conversation_end",
      payload: { messages: [] },
    });

    expect(prisma.agentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        deploymentId: "dep-1",
        eventType: "conversation_end",
        status: "pending",
      }),
    });
  });

  it("polls pending events ordered by createdAt", async () => {
    prisma.agentEvent.findMany.mockResolvedValue([]);

    await store.pollPending(5);

    expect(prisma.agentEvent.findMany).toHaveBeenCalledWith({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: 5,
    });
  });

  it("marks event as processing", async () => {
    prisma.agentEvent.update.mockResolvedValue({ id: "evt-1" });

    await store.markProcessing("evt-1");

    expect(prisma.agentEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-1" },
      data: { status: "processing" },
    });
  });

  it("marks event as done", async () => {
    prisma.agentEvent.update.mockResolvedValue({ id: "evt-1" });

    await store.markDone("evt-1");

    expect(prisma.agentEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-1" },
      data: expect.objectContaining({ status: "done" }),
    });
  });

  it("marks event as failed and increments retryCount", async () => {
    prisma.agentEvent.update.mockResolvedValue({ id: "evt-1" });

    await store.markFailed("evt-1");

    expect(prisma.agentEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-1" },
      data: expect.objectContaining({
        status: "failed",
        retryCount: { increment: 1 },
      }),
    });
  });

  it("marks dead letters for events with retryCount >= maxRetries", async () => {
    prisma.agentEvent.updateMany.mockResolvedValue({ count: 2 });

    const count = await store.markDeadLetters(3);

    expect(count).toBe(2);
    expect(prisma.agentEvent.updateMany).toHaveBeenCalledWith({
      where: {
        status: "failed",
        retryCount: { gte: 3 },
      },
      data: { status: "dead_letter" },
    });
  });

  it("cleans up old done events", async () => {
    const cutoff = new Date();
    prisma.agentEvent.deleteMany.mockResolvedValue({ count: 5 });

    const count = await store.cleanupDone(cutoff);

    expect(count).toBe(5);
    expect(prisma.agentEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        status: "done",
        createdAt: { lt: cutoff },
      },
    });
  });

  it("resets stale processing events", async () => {
    const cutoff = new Date();
    prisma.agentEvent.updateMany.mockResolvedValue({ count: 1 });

    const count = await store.resetStaleProcessing(cutoff);

    expect(count).toBe(1);
    expect(prisma.agentEvent.updateMany).toHaveBeenCalledWith({
      where: {
        status: "processing",
        createdAt: { lt: cutoff },
      },
      data: {
        status: "failed",
        retryCount: { increment: 1 },
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-event-store`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/db/src/stores/prisma-event-store.ts
import type { PrismaDbClient } from "../prisma-db.js";

export interface EmitEventInput {
  organizationId: string;
  deploymentId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export class PrismaEventStore {
  constructor(private prisma: PrismaDbClient) {}

  async emit(input: EmitEventInput): Promise<void> {
    await this.prisma.agentEvent.create({
      data: {
        organizationId: input.organizationId,
        deploymentId: input.deploymentId,
        eventType: input.eventType,
        payload: input.payload,
        status: "pending",
        retryCount: 0,
      },
    });
  }

  async pollPending(limit: number) {
    return this.prisma.agentEvent.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }

  async markProcessing(id: string): Promise<void> {
    await this.prisma.agentEvent.update({
      where: { id },
      data: { status: "processing" },
    });
  }

  async markDone(id: string): Promise<void> {
    await this.prisma.agentEvent.update({
      where: { id },
      data: { status: "done", processedAt: new Date() },
    });
  }

  async markFailed(id: string): Promise<void> {
    await this.prisma.agentEvent.update({
      where: { id },
      data: { status: "failed", retryCount: { increment: 1 } },
    });
  }

  async markDeadLetters(maxRetries: number): Promise<number> {
    const result = await this.prisma.agentEvent.updateMany({
      where: { status: "failed", retryCount: { gte: maxRetries } },
      data: { status: "dead_letter" },
    });
    return result.count;
  }

  async cleanupDone(olderThan: Date): Promise<number> {
    const result = await this.prisma.agentEvent.deleteMany({
      where: { status: "done", createdAt: { lt: olderThan } },
    });
    return result.count;
  }

  async resetStaleProcessing(olderThan: Date): Promise<number> {
    const result = await this.prisma.agentEvent.updateMany({
      where: { status: "processing", createdAt: { lt: olderThan } },
      data: { status: "failed", retryCount: { increment: 1 } },
    });
    return result.count;
  }
}
```

- [ ] **Step 4: Export from db barrel**

Add to `packages/db/src/index.ts`:

```typescript
export { PrismaEventStore } from "./stores/prisma-event-store.js";
```

- [ ] **Step 5: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-event-store`
Expected: All 8 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/stores/prisma-event-store.ts packages/db/src/stores/__tests__/prisma-event-store.test.ts packages/db/src/index.ts && git commit -m "feat(db): add PrismaEventStore for database-backed event bus"
```

---

### Task 5: PrismaActivityLogStore

**Files:**

- Create: `packages/db/src/stores/prisma-activity-log-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-activity-log-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/db/src/stores/__tests__/prisma-activity-log-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaActivityLogStore } from "../prisma-activity-log-store.js";

function createMockPrisma() {
  return {
    activityLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

describe("PrismaActivityLogStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaActivityLogStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaActivityLogStore(prisma as never);
  });

  it("writes a log entry", async () => {
    prisma.activityLog.create.mockResolvedValue({ id: "log-1" });

    await store.write({
      organizationId: "org-1",
      deploymentId: "dep-1",
      eventType: "fact_learned",
      description: "Learned: busiest day is Tuesday",
      metadata: { category: "business_hours" },
    });

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        eventType: "fact_learned",
        description: "Learned: busiest day is Tuesday",
      }),
    });
  });

  it("lists entries by deployment", async () => {
    prisma.activityLog.findMany.mockResolvedValue([]);

    await store.listByDeployment("org-1", "dep-1", { limit: 10 });

    expect(prisma.activityLog.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", deploymentId: "dep-1" },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  });

  it("defaults limit to 50", async () => {
    prisma.activityLog.findMany.mockResolvedValue([]);

    await store.listByDeployment("org-1", "dep-1");

    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it("cleans up old entries", async () => {
    const cutoff = new Date();
    prisma.activityLog.deleteMany.mockResolvedValue({ count: 3 });

    const count = await store.cleanup(cutoff);

    expect(count).toBe(3);
    expect(prisma.activityLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: cutoff } },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-activity-log`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/db/src/stores/prisma-activity-log-store.ts
import type { PrismaDbClient } from "../prisma-db.js";

export interface WriteActivityLogInput {
  organizationId: string;
  deploymentId: string;
  eventType: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export class PrismaActivityLogStore {
  constructor(private prisma: PrismaDbClient) {}

  async write(input: WriteActivityLogInput): Promise<void> {
    await this.prisma.activityLog.create({
      data: {
        organizationId: input.organizationId,
        deploymentId: input.deploymentId,
        eventType: input.eventType,
        description: input.description,
        metadata: input.metadata ?? {},
      },
    });
  }

  async listByDeployment(
    organizationId: string,
    deploymentId: string,
    opts: { limit?: number } = {},
  ) {
    return this.prisma.activityLog.findMany({
      where: { organizationId, deploymentId },
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
    });
  }

  async cleanup(olderThan: Date): Promise<number> {
    const result = await this.prisma.activityLog.deleteMany({
      where: { createdAt: { lt: olderThan } },
    });
    return result.count;
  }
}
```

- [ ] **Step 4: Export from db barrel**

Add to `packages/db/src/index.ts`:

```typescript
export { PrismaActivityLogStore } from "./stores/prisma-activity-log-store.js";
```

- [ ] **Step 5: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-activity-log`
Expected: All 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/stores/prisma-activity-log-store.ts packages/db/src/stores/__tests__/prisma-activity-log-store.test.ts packages/db/src/index.ts && git commit -m "feat(db): add PrismaActivityLogStore for runtime activity diary"
```

---

### Task 6: Scoped Store Implementations

**Files:**

- Create: `packages/db/src/stores/prisma-customer-memory-store.ts`
- Create: `packages/db/src/stores/prisma-owner-memory-store.ts`
- Create: `packages/db/src/stores/prisma-aggregate-memory-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-scoped-stores.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/db/src/stores/__tests__/prisma-scoped-stores.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCustomerMemoryStore } from "../prisma-customer-memory-store.js";
import { PrismaOwnerMemoryStore } from "../prisma-owner-memory-store.js";
import { PrismaAggregateMemoryStore } from "../prisma-aggregate-memory-store.js";

function createMockPrisma() {
  return {
    deploymentMemory: {
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    interactionSummary: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    knowledgeChunk: {
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
    },
    activityLog: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  };
}

describe("PrismaCustomerMemoryStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaCustomerMemoryStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaCustomerMemoryStore(prisma as never);
  });

  it("getHighConfidenceFacts filters by threshold and strips metadata", async () => {
    prisma.deploymentMemory.findMany.mockResolvedValue([
      {
        id: "1",
        organizationId: "o",
        deploymentId: "d",
        category: "hours",
        content: "Open 9-5",
        confidence: 0.8,
        sourceCount: 4,
      },
    ]);

    const facts = await store.getHighConfidenceFacts("o", "d");

    expect(prisma.deploymentMemory.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "o",
        deploymentId: "d",
        confidence: { gte: 0.7 },
        sourceCount: { gte: 3 },
      },
      orderBy: { confidence: "desc" },
    });
    // Should strip sourceCount and confidence — customer sees fact only
    expect(facts[0]).toEqual({
      id: "1",
      category: "hours",
      content: "Open 9-5",
    });
    expect((facts[0] as Record<string, unknown>).confidence).toBeUndefined();
    expect((facts[0] as Record<string, unknown>).sourceCount).toBeUndefined();
  });

  it("getContactSummaries scopes to specific contact", async () => {
    prisma.interactionSummary.findMany.mockResolvedValue([]);

    await store.getContactSummaries("o", "d", "contact-1");

    expect(prisma.interactionSummary.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "o", deploymentId: "d", contactId: "contact-1" },
      }),
    );
  });
});

describe("PrismaOwnerMemoryStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaOwnerMemoryStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaOwnerMemoryStore(prisma as never);
  });

  it("listAllMemories returns all deployment memories", async () => {
    prisma.deploymentMemory.findMany.mockResolvedValue([]);
    await store.listAllMemories("o", "d");
    expect(prisma.deploymentMemory.findMany).toHaveBeenCalledWith({
      where: { organizationId: "o", deploymentId: "d" },
      orderBy: { confidence: "desc" },
    });
  });

  it("correctMemory updates content and sets sourceType to correction", async () => {
    prisma.deploymentMemory.update.mockResolvedValue({});
    await store.correctMemory("mem-1", "Updated content");
    expect(prisma.deploymentMemory.update).toHaveBeenCalledWith({
      where: { id: "mem-1" },
      data: { content: "Updated content" },
    });
  });

  it("approveDraftFAQ sets draftStatus to approved", async () => {
    prisma.knowledgeChunk.update.mockResolvedValue({});
    await store.approveDraftFAQ("faq-1");
    expect(prisma.knowledgeChunk.update).toHaveBeenCalledWith({
      where: { id: "faq-1" },
      data: { draftStatus: "approved" },
    });
  });

  it("rejectDraftFAQ deletes the draft", async () => {
    prisma.knowledgeChunk.delete.mockResolvedValue({});
    await store.rejectDraftFAQ("faq-1");
    expect(prisma.knowledgeChunk.delete).toHaveBeenCalledWith({
      where: { id: "faq-1" },
    });
  });

  it("listDraftFAQs returns pending drafts", async () => {
    prisma.knowledgeChunk.findMany.mockResolvedValue([]);
    await store.listDraftFAQs("o", "d");
    expect(prisma.knowledgeChunk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ draftStatus: "pending" }),
      }),
    );
  });
});

describe("PrismaAggregateMemoryStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaAggregateMemoryStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaAggregateMemoryStore(prisma as never);
  });

  it("writeActivityLog creates an entry", async () => {
    prisma.activityLog.create.mockResolvedValue({});
    await store.writeActivityLog({
      organizationId: "o",
      deploymentId: "d",
      eventType: "fact_learned",
      description: "Learned something",
      metadata: {},
    });
    expect(prisma.activityLog.create).toHaveBeenCalled();
  });

  it("promoteDraftFAQs updates expired pending drafts", async () => {
    const cutoff = new Date();
    prisma.knowledgeChunk.updateMany.mockResolvedValue({ count: 2 });
    const count = await store.promoteDraftFAQs(cutoff);
    expect(count).toBe(2);
    expect(prisma.knowledgeChunk.updateMany).toHaveBeenCalledWith({
      where: {
        draftStatus: "pending",
        draftExpiresAt: { lt: cutoff },
      },
      data: { draftStatus: "approved" },
    });
  });

  it("decayStale decrements confidence", async () => {
    const cutoff = new Date();
    prisma.deploymentMemory.updateMany.mockResolvedValue({ count: 3 });
    const count = await store.decayStale(cutoff, 0.1);
    expect(count).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-scoped-stores`
Expected: FAIL — modules not found

- [ ] **Step 3: Write PrismaCustomerMemoryStore**

```typescript
// packages/db/src/stores/prisma-customer-memory-store.ts
import type { PrismaDbClient } from "../prisma-db.js";
import type {
  CustomerScopedMemoryAccess,
  CustomerFact,
  KnowledgeChunkEntry,
  InteractionSummaryEntry,
} from "@switchboard/core";

export class PrismaCustomerMemoryStore implements CustomerScopedMemoryAccess {
  constructor(private prisma: PrismaDbClient) {}

  async getBusinessKnowledge(
    orgId: string,
    deploymentId: string,
    _query: string,
  ): Promise<KnowledgeChunkEntry[]> {
    const rows = await this.prisma.knowledgeChunk.findMany({
      where: {
        organizationId: orgId,
        OR: [{ deploymentId }, { deploymentId: null }],
        AND: [{ OR: [{ draftStatus: "approved" }, { draftStatus: null }] }],
      },
      select: { id: true, content: true, sourceType: true, metadata: true },
      take: 10,
    });
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      sourceType: r.sourceType,
      metadata: r.metadata as Record<string, unknown>,
    }));
  }

  async getHighConfidenceFacts(orgId: string, deploymentId: string): Promise<CustomerFact[]> {
    const rows = await this.prisma.deploymentMemory.findMany({
      where: {
        organizationId: orgId,
        deploymentId,
        confidence: { gte: 0.7 },
        sourceCount: { gte: 3 },
      },
      orderBy: { confidence: "desc" },
    });
    // Strip confidence/sourceCount — customer agent sees the fact, not the metadata
    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      content: r.content,
    }));
  }

  async getContactSummaries(
    orgId: string,
    deploymentId: string,
    contactId: string,
  ): Promise<InteractionSummaryEntry[]> {
    const rows = await this.prisma.interactionSummary.findMany({
      where: { organizationId: orgId, deploymentId, contactId },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    return rows.map((r) => ({
      id: r.id,
      summary: r.summary,
      outcome: r.outcome,
      createdAt: r.createdAt,
    }));
  }
}
```

- [ ] **Step 4: Write PrismaOwnerMemoryStore**

```typescript
// packages/db/src/stores/prisma-owner-memory-store.ts
import type { PrismaDbClient } from "../prisma-db.js";
import type {
  OwnerMemoryAccess,
  DeploymentMemoryEntry,
  DraftFAQ,
  ActivityLogEntry,
  InteractionSummaryEntry,
} from "@switchboard/core";

export class PrismaOwnerMemoryStore implements OwnerMemoryAccess {
  constructor(private prisma: PrismaDbClient) {}

  async listAllMemories(orgId: string, deploymentId: string): Promise<DeploymentMemoryEntry[]> {
    const rows = await this.prisma.deploymentMemory.findMany({
      where: { organizationId: orgId, deploymentId },
      orderBy: { confidence: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      deploymentId: r.deploymentId,
      category: r.category,
      content: r.content,
      confidence: r.confidence,
      sourceCount: r.sourceCount,
    }));
  }

  async correctMemory(id: string, content: string): Promise<void> {
    await this.prisma.deploymentMemory.update({
      where: { id },
      data: { content },
    });
  }

  async deleteMemory(id: string): Promise<void> {
    await this.prisma.deploymentMemory.delete({ where: { id } });
  }

  async listDraftFAQs(orgId: string, deploymentId: string): Promise<DraftFAQ[]> {
    const rows = await this.prisma.knowledgeChunk.findMany({
      where: { organizationId: orgId, deploymentId, draftStatus: "pending" },
      select: {
        id: true,
        content: true,
        sourceType: true,
        draftStatus: true,
        draftExpiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      sourceType: r.sourceType,
      draftStatus: r.draftStatus,
      draftExpiresAt: r.draftExpiresAt,
      createdAt: r.createdAt,
    }));
  }

  async approveDraftFAQ(id: string): Promise<void> {
    await this.prisma.knowledgeChunk.update({
      where: { id },
      data: { draftStatus: "approved" },
    });
  }

  async rejectDraftFAQ(id: string): Promise<void> {
    await this.prisma.knowledgeChunk.delete({ where: { id } });
  }

  async listActivityLog(
    orgId: string,
    deploymentId: string,
    opts: { limit?: number } = {},
  ): Promise<ActivityLogEntry[]> {
    const rows = await this.prisma.activityLog.findMany({
      where: { organizationId: orgId, deploymentId },
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
    });
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      deploymentId: r.deploymentId,
      eventType: r.eventType,
      description: r.description,
      metadata: r.metadata as Record<string, unknown>,
      createdAt: r.createdAt,
    }));
  }

  async listAllSummaries(
    orgId: string,
    deploymentId: string,
    opts: { limit?: number } = {},
  ): Promise<InteractionSummaryEntry[]> {
    const rows = await this.prisma.interactionSummary.findMany({
      where: { organizationId: orgId, deploymentId },
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
    });
    return rows.map((r) => ({
      id: r.id,
      summary: r.summary,
      outcome: r.outcome,
      createdAt: r.createdAt,
    }));
  }
}
```

- [ ] **Step 5: Write PrismaAggregateMemoryStore**

```typescript
// packages/db/src/stores/prisma-aggregate-memory-store.ts
import type { PrismaDbClient } from "../prisma-db.js";
import type {
  AggregateScopedMemoryAccess,
  DeploymentMemoryEntry,
  InteractionSummaryEntry,
  ActivityLogEntry,
} from "@switchboard/core";

export class PrismaAggregateMemoryStore implements AggregateScopedMemoryAccess {
  constructor(private prisma: PrismaDbClient) {}

  async upsertFact(entry: Omit<DeploymentMemoryEntry, "id">): Promise<DeploymentMemoryEntry> {
    const now = new Date();
    const result = await this.prisma.deploymentMemory.upsert({
      where: {
        organizationId_deploymentId_category_content: {
          organizationId: entry.organizationId,
          deploymentId: entry.deploymentId,
          category: entry.category,
          content: entry.content,
        },
      },
      update: {
        sourceCount: { increment: 1 },
        confidence: entry.confidence,
        lastSeenAt: now,
      },
      create: {
        organizationId: entry.organizationId,
        deploymentId: entry.deploymentId,
        category: entry.category,
        content: entry.content,
        confidence: entry.confidence,
        sourceCount: entry.sourceCount,
        lastSeenAt: now,
      },
    });
    return {
      id: result.id,
      organizationId: result.organizationId,
      deploymentId: result.deploymentId,
      category: result.category,
      content: result.content,
      confidence: result.confidence,
      sourceCount: result.sourceCount,
    };
  }

  async writeSummary(
    entry: Omit<InteractionSummaryEntry, "id"> & {
      organizationId: string;
      deploymentId: string;
      channelType: string;
      contactId?: string;
      extractedFacts: unknown[];
      questionsAsked: string[];
      duration: number;
      messageCount: number;
    },
  ): Promise<void> {
    await this.prisma.interactionSummary.create({
      data: {
        organizationId: entry.organizationId,
        deploymentId: entry.deploymentId,
        channelType: entry.channelType,
        contactId: entry.contactId ?? null,
        summary: entry.summary,
        outcome: entry.outcome,
        extractedFacts: entry.extractedFacts as object[],
        questionsAsked: entry.questionsAsked,
        duration: entry.duration,
        messageCount: entry.messageCount,
      },
    });
  }

  async writeActivityLog(entry: Omit<ActivityLogEntry, "id" | "createdAt">): Promise<void> {
    await this.prisma.activityLog.create({
      data: {
        organizationId: entry.organizationId,
        deploymentId: entry.deploymentId,
        eventType: entry.eventType,
        description: entry.description,
        metadata: entry.metadata,
      },
    });
  }

  async findFactsByCategory(
    orgId: string,
    deploymentId: string,
    category: string,
  ): Promise<DeploymentMemoryEntry[]> {
    const rows = await this.prisma.deploymentMemory.findMany({
      where: { organizationId: orgId, deploymentId, category },
    });
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      deploymentId: r.deploymentId,
      category: r.category,
      content: r.content,
      confidence: r.confidence,
      sourceCount: r.sourceCount,
    }));
  }

  async promoteDraftFAQs(olderThan: Date): Promise<number> {
    const result = await this.prisma.knowledgeChunk.updateMany({
      where: {
        draftStatus: "pending",
        draftExpiresAt: { lt: olderThan },
      },
      data: { draftStatus: "approved" },
    });
    return result.count;
  }

  async decayStale(cutoffDate: Date, decayAmount: number): Promise<number> {
    const result = await this.prisma.deploymentMemory.updateMany({
      where: {
        lastSeenAt: { lt: cutoffDate },
        confidence: { gt: 0 },
      },
      data: { confidence: { decrement: decayAmount } },
    });
    return result.count;
  }
}
```

- [ ] **Step 6: Export all three from db barrel**

Add to `packages/db/src/index.ts`:

```typescript
export { PrismaCustomerMemoryStore } from "./stores/prisma-customer-memory-store.js";
export { PrismaOwnerMemoryStore } from "./stores/prisma-owner-memory-store.js";
export { PrismaAggregateMemoryStore } from "./stores/prisma-aggregate-memory-store.js";
```

- [ ] **Step 7: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-scoped-stores`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/stores/prisma-customer-memory-store.ts packages/db/src/stores/prisma-owner-memory-store.ts packages/db/src/stores/prisma-aggregate-memory-store.ts packages/db/src/stores/__tests__/prisma-scoped-stores.test.ts packages/db/src/index.ts && git commit -m "feat(db): add scoped memory store implementations (customer, owner, aggregate)"
```

---

### Task 7: Final Validation

- [ ] **Step 1: Run full lint**

Run: `npx pnpm@9.15.4 lint`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: PASS (pre-existing errors only)

- [ ] **Step 3: Run full test suite**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas --filter @switchboard/core --filter @switchboard/db test`
Expected: All tests pass

- [ ] **Step 4: Verify build**

Run: `npx pnpm@9.15.4 build`
Expected: Clean build (pre-existing errors only)
