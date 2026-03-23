# Phase 2: ConversationThread + Agent Memory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent per-contact conversation state so agents remember across messages — objections, preferences, offers, topics, sentiment — and wire thread loading into the ConversationRouter for stage-based routing.

**Architecture:** A new `ConversationThread` model stores derived conversation state alongside the existing `ConversationMessage` table (raw messages). The ConversationRouter loads/creates threads and attaches them to event metadata. Agent handlers read thread context, use it in LLM prompts, and return thread updates extracted via a dedicated LLM call. A summary refresher regenerates the thread's `currentSummary` every N messages.

**Tech Stack:** TypeScript, Zod, Prisma, Vitest, pnpm

**Spec:** `docs/superpowers/specs/2026-03-22-switchboard-native-runtime-design.md` (Sections 4.1, 11, 13 — Phase 2)

**Important context:**

- Phase 1 (OpenClaw removal) is complete on `main`. Start from clean `main`.
- ESM with `.js` extensions in relative imports (except `apps/dashboard/`).
- Dependency layers: schemas (L1) → core (L3) → agents (L5) → apps (L6). The `db` package (L4) may import schemas + core but NEVER agents or apps.
- Run `pnpm test` and `pnpm typecheck` after each task to verify nothing breaks.
- Conventional commits enforced: `feat:` prefix for feature tasks.
- **Customer #1 viable after this phase.**

---

## File Structure

### New Files

| File                                              | Responsibility                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/schemas/src/conversation-thread.ts`     | Zod schemas for ConversationThread, AgentContextData, ThreadStage |
| `packages/core/src/conversations/thread.ts`       | ConversationThread type re-export + helper functions              |
| `packages/core/src/conversations/thread-store.ts` | ConversationThreadStore persistence interface                     |
| `packages/core/src/conversations/index.ts`        | Barrel export for conversations module                            |
| `packages/db/src/stores/prisma-thread-store.ts`   | Prisma implementation of ConversationThreadStore                  |
| `packages/agents/src/context-extractor.ts`        | LLM-based extraction of conversation context signals              |
| `packages/agents/src/summary-refresher.ts`        | LLM-based conversation summary regeneration                       |
| Test files co-located with each new source file   |

### Modified Files

| File                                                          | Change                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| `packages/schemas/src/index.ts`                               | Export conversation-thread schemas                            |
| `packages/core/src/index.ts`                                  | Export conversations module                                   |
| `packages/core/src/llm-adapter.ts`                            | Add `ConversationPrompt.threadContext` field                  |
| `packages/db/src/index.ts`                                    | Export PrismaConversationThreadStore                          |
| `packages/db/prisma/schema.prisma`                            | Add ConversationThread Prisma model                           |
| `packages/agents/src/lifecycle.ts`                            | Add ThreadStage type + stage-to-agent mapping                 |
| `packages/agents/src/conversation-router.ts`                  | Load/create threads, attach to event metadata                 |
| `packages/agents/src/ports.ts`                                | Add `thread` to AgentContext, `threadUpdate` to AgentResponse |
| `packages/agents/src/agents/lead-responder/handler.ts`        | Read thread, extract context, return updates                  |
| `packages/agents/src/agents/lead-responder/prompt-builder.ts` | Include thread context in prompt                              |
| `packages/agents/src/agents/lead-responder/types.ts`          | Add thread store to deps                                      |
| `packages/agents/src/agents/sales-closer/handler.ts`          | Read thread, extract context, return updates                  |
| `packages/agents/src/agents/sales-closer/prompt-builder.ts`   | Include thread context in prompt                              |
| `packages/agents/src/agents/sales-closer/types.ts`            | Add thread store to deps                                      |
| `packages/agents/src/index.ts`                                | Export new modules                                            |
| `apps/api/src/routes/conversation.ts`                         | Save thread updates after EventLoop processing                |
| `apps/api/src/agent-bootstrap.ts`                             | Pass thread store to ConversationRouter                       |
| `apps/api/src/bootstrap/conversation-deps.ts`                 | Add thread store to deps                                      |

---

### Task 1: ConversationThread Zod Schemas

**Files:**

- Create: `packages/schemas/src/conversation-thread.ts`
- Create: `packages/schemas/src/__tests__/conversation-thread.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/schemas/src/__tests__/conversation-thread.test.ts
import { describe, it, expect } from "vitest";
import {
  ThreadStageSchema,
  SentimentTrendSchema,
  AgentContextDataSchema,
  FollowUpScheduleSchema,
  ConversationThreadSchema,
} from "../conversation-thread.js";

describe("ConversationThread schemas", () => {
  it("validates ThreadStage enum", () => {
    expect(ThreadStageSchema.parse("new")).toBe("new");
    expect(ThreadStageSchema.parse("responding")).toBe("responding");
    expect(ThreadStageSchema.parse("nurturing")).toBe("nurturing");
    expect(() => ThreadStageSchema.parse("invalid")).toThrow();
  });

  it("validates SentimentTrend enum", () => {
    expect(SentimentTrendSchema.parse("positive")).toBe("positive");
    expect(() => SentimentTrendSchema.parse("angry")).toThrow();
  });

  it("validates AgentContextData with defaults", () => {
    const result = AgentContextDataSchema.parse({});
    expect(result.objectionsEncountered).toEqual([]);
    expect(result.preferencesLearned).toEqual({});
    expect(result.offersMade).toEqual([]);
    expect(result.topicsDiscussed).toEqual([]);
    expect(result.sentimentTrend).toBe("unknown");
  });

  it("validates full AgentContextData", () => {
    const data = {
      objectionsEncountered: ["too expensive", "not sure about timing"],
      preferencesLearned: { time: "mornings", treatment: "facial" },
      offersMade: [{ description: "Summer special 20% off", date: new Date() }],
      topicsDiscussed: ["pricing", "availability"],
      sentimentTrend: "positive",
    };
    const result = AgentContextDataSchema.parse(data);
    expect(result.objectionsEncountered).toHaveLength(2);
    expect(result.sentimentTrend).toBe("positive");
  });

  it("validates ConversationThread", () => {
    const thread = {
      id: "t-1",
      contactId: "c-1",
      organizationId: "org-1",
      stage: "responding",
      assignedAgent: "lead-responder",
      agentContext: {},
      currentSummary: "",
      followUpSchedule: { nextFollowUpAt: null, reason: null, cadenceId: null },
      lastOutcomeAt: null,
      messageCount: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = ConversationThreadSchema.parse(thread);
    expect(result.stage).toBe("responding");
    expect(result.messageCount).toBe(3);
  });

  it("rejects ConversationThread with invalid stage", () => {
    expect(() =>
      ConversationThreadSchema.parse({
        id: "t-1",
        contactId: "c-1",
        organizationId: "org-1",
        stage: "invalid_stage",
        assignedAgent: "lead-responder",
        agentContext: {},
        currentSummary: "",
        followUpSchedule: { nextFollowUpAt: null, reason: null, cadenceId: null },
        lastOutcomeAt: null,
        messageCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/schemas test -- conversation-thread
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the schema file**

```typescript
// packages/schemas/src/conversation-thread.ts
import { z } from "zod";

// ---------------------------------------------------------------------------
// Thread Stage — conversation progression (distinct from CRM lifecycle stage)
// ---------------------------------------------------------------------------

export const ThreadStageSchema = z.enum([
  "new",
  "responding",
  "qualifying",
  "qualified",
  "closing",
  "won",
  "lost",
  "nurturing",
]);
export type ThreadStage = z.infer<typeof ThreadStageSchema>;

// ---------------------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------------------

export const SentimentTrendSchema = z.enum(["positive", "neutral", "negative", "unknown"]);
export type SentimentTrend = z.infer<typeof SentimentTrendSchema>;

// ---------------------------------------------------------------------------
// Agent Context Data — derived state accumulated over conversation turns
// ---------------------------------------------------------------------------

export const OfferMadeSchema = z.object({
  description: z.string(),
  date: z.coerce.date(),
});
export type OfferMade = z.infer<typeof OfferMadeSchema>;

export const AgentContextDataSchema = z.object({
  objectionsEncountered: z.array(z.string()).default([]),
  preferencesLearned: z.record(z.string()).default({}),
  offersMade: z.array(OfferMadeSchema).default([]),
  topicsDiscussed: z.array(z.string()).default([]),
  sentimentTrend: SentimentTrendSchema.default("unknown"),
});
export type AgentContextData = z.infer<typeof AgentContextDataSchema>;

// ---------------------------------------------------------------------------
// Follow-Up Schedule
// ---------------------------------------------------------------------------

export const FollowUpScheduleSchema = z.object({
  nextFollowUpAt: z.coerce.date().nullable(),
  reason: z.string().nullable(),
  cadenceId: z.string().nullable(),
});
export type FollowUpSchedule = z.infer<typeof FollowUpScheduleSchema>;

// ---------------------------------------------------------------------------
// ConversationThread — per-contact derived state (not message storage)
// ---------------------------------------------------------------------------

export const ConversationThreadSchema = z.object({
  id: z.string().min(1),
  contactId: z.string().min(1),
  organizationId: z.string().min(1),
  stage: ThreadStageSchema,
  assignedAgent: z.string().min(1),
  agentContext: AgentContextDataSchema,
  currentSummary: z.string(),
  followUpSchedule: FollowUpScheduleSchema,
  lastOutcomeAt: z.coerce.date().nullable(),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ConversationThread = z.infer<typeof ConversationThreadSchema>;
```

- [ ] **Step 4: Export from schemas barrel**

Add to `packages/schemas/src/index.ts`:

```typescript
// Conversation thread (per-contact derived state)
export * from "./conversation-thread.js";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @switchboard/schemas test -- conversation-thread
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(schemas): add ConversationThread Zod schemas"
```

---

### Task 2: Core Thread Interface and Store

**Files:**

- Create: `packages/core/src/conversations/thread.ts`
- Create: `packages/core/src/conversations/thread-store.ts`
- Create: `packages/core/src/conversations/index.ts`
- Create: `packages/core/src/conversations/__tests__/thread.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/core/src/conversations/__tests__/thread.test.ts
import { describe, it, expect } from "vitest";
import { createDefaultThread, SUMMARY_REFRESH_INTERVAL } from "../thread.js";

describe("ConversationThread helpers", () => {
  it("creates a default thread for a new contact", () => {
    const thread = createDefaultThread("c-1", "org-1");
    expect(thread.contactId).toBe("c-1");
    expect(thread.organizationId).toBe("org-1");
    expect(thread.stage).toBe("new");
    expect(thread.assignedAgent).toBe("lead-responder");
    expect(thread.messageCount).toBe(0);
    expect(thread.currentSummary).toBe("");
    expect(thread.agentContext.objectionsEncountered).toEqual([]);
    expect(thread.agentContext.sentimentTrend).toBe("unknown");
    expect(thread.followUpSchedule.nextFollowUpAt).toBeNull();
  });

  it("exposes SUMMARY_REFRESH_INTERVAL constant", () => {
    expect(SUMMARY_REFRESH_INTERVAL).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/core test -- conversations/thread
```

Expected: FAIL

- [ ] **Step 3: Create thread.ts**

```typescript
// packages/core/src/conversations/thread.ts
import { randomUUID } from "node:crypto";
import type { ConversationThread } from "@switchboard/schemas";

/** Regenerate summary every N messages */
export const SUMMARY_REFRESH_INTERVAL = 10;

/**
 * Creates a default ConversationThread for a brand-new contact.
 */
export function createDefaultThread(contactId: string, organizationId: string): ConversationThread {
  const now = new Date();
  return {
    id: randomUUID(),
    contactId,
    organizationId,
    stage: "new",
    assignedAgent: "lead-responder",
    agentContext: {
      objectionsEncountered: [],
      preferencesLearned: {},
      offersMade: [],
      topicsDiscussed: [],
      sentimentTrend: "unknown",
    },
    currentSummary: "",
    followUpSchedule: {
      nextFollowUpAt: null,
      reason: null,
      cadenceId: null,
    },
    lastOutcomeAt: null,
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}
```

- [ ] **Step 4: Create thread-store.ts**

```typescript
// packages/core/src/conversations/thread-store.ts
import type { ConversationThread, ThreadStage, AgentContextData } from "@switchboard/schemas";

/**
 * Persistence interface for ConversationThread.
 * Implementations: PrismaConversationThreadStore (packages/db).
 */
export interface ConversationThreadStore {
  /** Load thread by contactId + orgId. Returns null if no thread exists. */
  getByContact(contactId: string, organizationId: string): Promise<ConversationThread | null>;

  /** Create a new thread. */
  create(thread: ConversationThread): Promise<void>;

  /** Update an existing thread. Partial — only provided fields are updated. */
  update(
    threadId: string,
    updates: {
      stage?: ThreadStage;
      assignedAgent?: string;
      agentContext?: AgentContextData;
      currentSummary?: string;
      followUpSchedule?: ConversationThread["followUpSchedule"];
      lastOutcomeAt?: Date | null;
      messageCount?: number;
    },
  ): Promise<void>;
}
```

- [ ] **Step 5: Create barrel export**

```typescript
// packages/core/src/conversations/index.ts
export { createDefaultThread, SUMMARY_REFRESH_INTERVAL } from "./thread.js";
export type { ConversationThreadStore } from "./thread-store.js";
```

- [ ] **Step 6: Export from core barrel**

Add to `packages/core/src/index.ts` after the existing `ConversationStore` export:

```typescript
// Conversation Thread (per-contact derived state)
export * from "./conversations/index.js";
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/core test -- conversations/thread
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(core): add ConversationThread interface and store contract"
```

---

### Task 3: Prisma Model + Migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add ConversationThread model to Prisma schema**

Add after the `ContactLifecycle` model (around line 1030):

```prisma
model ConversationThread {
  id              String    @id @default(uuid())
  contactId       String
  organizationId  String
  stage           String    @default("new") // ThreadStage enum
  assignedAgent   String    @default("lead-responder")
  agentContext    Json      @default("{}")  // AgentContextData JSON
  currentSummary  String    @default("")
  followUpSchedule Json     @default("{\"nextFollowUpAt\":null,\"reason\":null,\"cadenceId\":null}")
  lastOutcomeAt   DateTime?
  messageCount    Int       @default(0)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@unique([contactId, organizationId])
  @@index([organizationId])
  @@index([stage])
}
```

- [ ] **Step 2: Generate migration**

```bash
cd packages/db && npx prisma migrate dev --name add_conversation_thread
```

- [ ] **Step 3: Generate Prisma client**

```bash
pnpm db:generate
```

- [ ] **Step 4: Verify DB package builds**

```bash
pnpm --filter @switchboard/db test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): add ConversationThread Prisma model"
```

---

### Task 4: PrismaConversationThreadStore

**Files:**

- Create: `packages/db/src/stores/prisma-thread-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-thread-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/db/src/stores/__tests__/prisma-thread-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaConversationThreadStore } from "../prisma-thread-store.js";

function mockPrisma() {
  return {
    conversationThread: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as import("@prisma/client").PrismaClient;
}

describe("PrismaConversationThreadStore", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let store: PrismaConversationThreadStore;

  beforeEach(() => {
    prisma = mockPrisma();
    store = new PrismaConversationThreadStore(prisma);
  });

  it("getByContact returns null when no thread exists", async () => {
    (prisma.conversationThread.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await store.getByContact("c-1", "org-1");
    expect(result).toBeNull();
    expect(prisma.conversationThread.findUnique).toHaveBeenCalledWith({
      where: { contactId_organizationId: { contactId: "c-1", organizationId: "org-1" } },
    });
  });

  it("getByContact maps Prisma row to ConversationThread", async () => {
    const now = new Date();
    (prisma.conversationThread.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t-1",
      contactId: "c-1",
      organizationId: "org-1",
      stage: "responding",
      assignedAgent: "lead-responder",
      agentContext: {
        objectionsEncountered: ["price"],
        preferencesLearned: {},
        offersMade: [],
        topicsDiscussed: [],
        sentimentTrend: "neutral",
      },
      currentSummary: "Lead asked about pricing.",
      followUpSchedule: { nextFollowUpAt: null, reason: null, cadenceId: null },
      lastOutcomeAt: null,
      messageCount: 5,
      createdAt: now,
      updatedAt: now,
    });

    const result = await store.getByContact("c-1", "org-1");
    expect(result).not.toBeNull();
    expect(result!.stage).toBe("responding");
    expect(result!.agentContext.objectionsEncountered).toEqual(["price"]);
    expect(result!.messageCount).toBe(5);
  });

  it("create persists a new thread", async () => {
    const now = new Date();
    const thread = {
      id: "t-1",
      contactId: "c-1",
      organizationId: "org-1",
      stage: "new" as const,
      assignedAgent: "lead-responder",
      agentContext: {
        objectionsEncountered: [],
        preferencesLearned: {},
        offersMade: [],
        topicsDiscussed: [],
        sentimentTrend: "unknown" as const,
      },
      currentSummary: "",
      followUpSchedule: { nextFollowUpAt: null, reason: null, cadenceId: null },
      lastOutcomeAt: null,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await store.create(thread);
    expect(prisma.conversationThread.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: "t-1", contactId: "c-1", stage: "new" }),
    });
  });

  it("update applies partial changes", async () => {
    await store.update("t-1", { stage: "qualifying", messageCount: 6 });
    expect(prisma.conversationThread.update).toHaveBeenCalledWith({
      where: { id: "t-1" },
      data: expect.objectContaining({ stage: "qualifying", messageCount: 6 }),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/db test -- prisma-thread-store
```

Expected: FAIL

- [ ] **Step 3: Implement PrismaConversationThreadStore**

```typescript
// packages/db/src/stores/prisma-thread-store.ts
import type { PrismaClient } from "@prisma/client";

// Local interfaces matching @switchboard/core ConversationThreadStore shape.
// Structural typing — no cross-layer import.

type ThreadStage =
  | "new"
  | "responding"
  | "qualifying"
  | "qualified"
  | "closing"
  | "won"
  | "lost"
  | "nurturing";

type SentimentTrend = "positive" | "neutral" | "negative" | "unknown";

interface AgentContextData {
  objectionsEncountered: string[];
  preferencesLearned: Record<string, string>;
  offersMade: Array<{ description: string; date: Date }>;
  topicsDiscussed: string[];
  sentimentTrend: SentimentTrend;
}

interface FollowUpSchedule {
  nextFollowUpAt: Date | null;
  reason: string | null;
  cadenceId: string | null;
}

interface ConversationThread {
  id: string;
  contactId: string;
  organizationId: string;
  stage: ThreadStage;
  assignedAgent: string;
  agentContext: AgentContextData;
  currentSummary: string;
  followUpSchedule: FollowUpSchedule;
  lastOutcomeAt: Date | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export class PrismaConversationThreadStore {
  constructor(private prisma: PrismaClient) {}

  async getByContact(
    contactId: string,
    organizationId: string,
  ): Promise<ConversationThread | null> {
    const row = await this.prisma.conversationThread.findUnique({
      where: { contactId_organizationId: { contactId, organizationId } },
    });

    if (!row) return null;

    return {
      id: row.id,
      contactId: row.contactId,
      organizationId: row.organizationId,
      stage: row.stage as ThreadStage,
      assignedAgent: row.assignedAgent,
      agentContext: row.agentContext as unknown as AgentContextData,
      currentSummary: row.currentSummary,
      followUpSchedule: row.followUpSchedule as unknown as FollowUpSchedule,
      lastOutcomeAt: row.lastOutcomeAt,
      messageCount: row.messageCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(thread: ConversationThread): Promise<void> {
    await this.prisma.conversationThread.create({
      data: {
        id: thread.id,
        contactId: thread.contactId,
        organizationId: thread.organizationId,
        stage: thread.stage,
        assignedAgent: thread.assignedAgent,
        agentContext: thread.agentContext as object,
        currentSummary: thread.currentSummary,
        followUpSchedule: thread.followUpSchedule as object,
        lastOutcomeAt: thread.lastOutcomeAt,
        messageCount: thread.messageCount,
      },
    });
  }

  async update(
    threadId: string,
    updates: {
      stage?: ThreadStage;
      assignedAgent?: string;
      agentContext?: AgentContextData;
      currentSummary?: string;
      followUpSchedule?: FollowUpSchedule;
      lastOutcomeAt?: Date | null;
      messageCount?: number;
    },
  ): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.stage !== undefined) data.stage = updates.stage;
    if (updates.assignedAgent !== undefined) data.assignedAgent = updates.assignedAgent;
    if (updates.agentContext !== undefined) data.agentContext = updates.agentContext as object;
    if (updates.currentSummary !== undefined) data.currentSummary = updates.currentSummary;
    if (updates.followUpSchedule !== undefined)
      data.followUpSchedule = updates.followUpSchedule as object;
    if (updates.lastOutcomeAt !== undefined) data.lastOutcomeAt = updates.lastOutcomeAt;
    if (updates.messageCount !== undefined) data.messageCount = updates.messageCount;

    await this.prisma.conversationThread.update({
      where: { id: threadId },
      data,
    });
  }
}
```

- [ ] **Step 4: Export from db barrel**

Add to `packages/db/src/index.ts`:

```typescript
export { PrismaConversationThreadStore } from "./stores/prisma-thread-store.js";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @switchboard/db test -- prisma-thread-store
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(db): add PrismaConversationThreadStore"
```

---

### Task 5: Thread Stage Routing

**Files:**

- Modify: `packages/agents/src/lifecycle.ts`
- Modify: `packages/agents/src/__tests__/lifecycle.test.ts`

- [ ] **Step 1: Read current lifecycle test**

Read `packages/agents/src/__tests__/lifecycle.test.ts` to understand existing test coverage.

- [ ] **Step 2: Add ThreadStage routing tests**

Add to the existing test file:

```typescript
import { agentForThreadStage } from "../lifecycle.js";
import type { ThreadStage } from "@switchboard/schemas";

describe("agentForThreadStage", () => {
  it.each([
    ["new", "lead-responder"],
    ["responding", "lead-responder"],
    ["qualifying", "lead-responder"],
    ["qualified", "sales-closer"],
    ["closing", "sales-closer"],
    ["nurturing", "nurture"],
    ["won", null],
    ["lost", null],
  ] as [ThreadStage, string | null][])("maps %s -> %s", (stage, expected) => {
    expect(agentForThreadStage(stage)).toBe(expected);
  });

  it("returns lead-responder for undefined stage", () => {
    expect(agentForThreadStage(undefined)).toBe("lead-responder");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @switchboard/agents test -- lifecycle
```

Expected: FAIL — `agentForThreadStage` not found.

- [ ] **Step 4: Add agentForThreadStage to lifecycle.ts**

Add to `packages/agents/src/lifecycle.ts`:

```typescript
import type { ThreadStage } from "@switchboard/schemas";

const THREAD_STAGE_TO_AGENT: Record<ThreadStage, string | null> = {
  new: "lead-responder",
  responding: "lead-responder",
  qualifying: "lead-responder",
  qualified: "sales-closer",
  closing: "sales-closer",
  won: null,
  lost: null,
  nurturing: "nurture",
};

export function agentForThreadStage(stage: ThreadStage | undefined): string | null {
  if (!stage) return "lead-responder";
  return THREAD_STAGE_TO_AGENT[stage];
}
```

- [ ] **Step 5: Export from agents barrel**

In `packages/agents/src/index.ts`, update the lifecycle export line:

```typescript
export {
  canRequalify,
  agentForStage,
  agentForThreadStage,
  type LifecycleStage,
} from "./lifecycle.js";
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/agents test -- lifecycle
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(agents): add thread stage to agent routing"
```

---

### Task 6: ConversationRouter Thread Loading

**Files:**

- Modify: `packages/agents/src/conversation-router.ts`
- Modify: `packages/agents/src/__tests__/conversation-router.test.ts`

- [ ] **Step 1: Read current ConversationRouter test**

Read `packages/agents/src/__tests__/conversation-router.test.ts`.

- [ ] **Step 2: Add thread loading tests**

Add to the existing test file:

```typescript
describe("ConversationRouter with threadStore", () => {
  it("loads existing thread and attaches to metadata", async () => {
    const existingThread = {
      id: "t-1",
      contactId: "c-1",
      organizationId: "org-1",
      stage: "qualifying" as const,
      assignedAgent: "lead-responder",
      agentContext: {
        objectionsEncountered: [],
        preferencesLearned: {},
        offersMade: [],
        topicsDiscussed: [],
        sentimentTrend: "unknown" as const,
      },
      currentSummary: "",
      followUpSchedule: { nextFollowUpAt: null, reason: null, cadenceId: null },
      lastOutcomeAt: null,
      messageCount: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const threadStore = {
      getByContact: vi.fn().mockResolvedValue(existingThread),
      create: vi.fn(),
      update: vi.fn(),
    };

    const router = new ConversationRouter({
      getStage: async () => "lead",
      threadStore,
    });

    const event = makeMessageEvent({ contactId: "c-1" }, "org-1");
    const result = await router.transform(event);

    expect(result.metadata?.conversationThread).toEqual(existingThread);
    expect(result.metadata?.targetAgentId).toBe("lead-responder");
    expect(threadStore.getByContact).toHaveBeenCalledWith("c-1", "org-1");
  });

  it("creates a new thread when none exists", async () => {
    const threadStore = {
      getByContact: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    };

    const router = new ConversationRouter({
      getStage: async () => undefined,
      threadStore,
    });

    const event = makeMessageEvent({ contactId: "c-1" }, "org-1");
    const result = await router.transform(event);

    expect(threadStore.create).toHaveBeenCalled();
    expect(result.metadata?.conversationThread).toBeDefined();
    const thread = result.metadata!.conversationThread as { stage: string };
    expect(thread.stage).toBe("new");
  });

  it("routes based on thread stage when thread exists", async () => {
    const threadStore = {
      getByContact: vi.fn().mockResolvedValue({
        id: "t-1",
        contactId: "c-1",
        organizationId: "org-1",
        stage: "qualified",
        assignedAgent: "sales-closer",
        agentContext: {
          objectionsEncountered: [],
          preferencesLearned: {},
          offersMade: [],
          topicsDiscussed: [],
          sentimentTrend: "unknown",
        },
        currentSummary: "",
        followUpSchedule: { nextFollowUpAt: null, reason: null, cadenceId: null },
        lastOutcomeAt: null,
        messageCount: 8,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      create: vi.fn(),
      update: vi.fn(),
    };

    const router = new ConversationRouter({
      getStage: async () => "lead",
      threadStore,
    });

    const event = makeMessageEvent({ contactId: "c-1" }, "org-1");
    const result = await router.transform(event);

    expect(result.metadata?.targetAgentId).toBe("sales-closer");
  });
});
```

You'll need to add a `makeMessageEvent` helper if not already present in the test file:

```typescript
function makeMessageEvent(payload: Record<string, unknown>, orgId = "org-1"): RoutedEventEnvelope {
  return createEventEnvelope({
    organizationId: orgId,
    eventType: "message.received",
    source: { type: "webhook", id: "whatsapp" },
    payload,
  });
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @switchboard/agents test -- conversation-router
```

Expected: FAIL — `threadStore` not accepted, new behavior not implemented.

- [ ] **Step 4: Update ConversationRouter to load threads**

Replace `packages/agents/src/conversation-router.ts`:

```typescript
// ---------------------------------------------------------------------------
// Conversation Router — pre-processing transform for message.received events
// ---------------------------------------------------------------------------

import type { ConversationThread, ThreadStage } from "@switchboard/schemas";
import type { ConversationThreadStore } from "@switchboard/core";
import { createDefaultThread } from "@switchboard/core";
import type { RoutedEventEnvelope } from "./events.js";
import { agentForStage, agentForThreadStage } from "./lifecycle.js";
import type { LifecycleStage } from "./lifecycle.js";

export interface StageResolver {
  getStage(contactId: string): Promise<LifecycleStage | undefined>;
}

export interface ConversationRouterConfig {
  getStage: (contactId: string) => Promise<LifecycleStage | undefined>;
  threadStore?: ConversationThreadStore;
}

export class ConversationRouter {
  private getStage: (contactId: string) => Promise<LifecycleStage | undefined>;
  private threadStore: ConversationThreadStore | undefined;

  constructor(config: ConversationRouterConfig) {
    this.getStage = config.getStage;
    this.threadStore = config.threadStore;
  }

  async transform(event: RoutedEventEnvelope): Promise<RoutedEventEnvelope> {
    if (event.eventType !== "message.received") {
      return event;
    }

    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string | undefined;
    if (!contactId) {
      return event;
    }

    // If thread store available, use thread-based routing
    if (this.threadStore) {
      return this.transformWithThread(event, contactId);
    }

    // Fallback: lifecycle-based routing (no thread store)
    const stage = await this.getStage(contactId);
    const targetAgent = agentForStage(stage as LifecycleStage | undefined);

    if (targetAgent) {
      return {
        ...event,
        metadata: { ...event.metadata, targetAgentId: targetAgent },
      };
    }

    return {
      ...event,
      metadata: { ...event.metadata, escalateToOwner: true },
    };
  }

  private async transformWithThread(
    event: RoutedEventEnvelope,
    contactId: string,
  ): Promise<RoutedEventEnvelope> {
    const orgId = event.organizationId;

    let thread = await this.threadStore!.getByContact(contactId, orgId);

    if (!thread) {
      thread = createDefaultThread(contactId, orgId);
      await this.threadStore!.create(thread);
    }

    const targetAgent = agentForThreadStage(thread.stage as ThreadStage);

    if (targetAgent) {
      return {
        ...event,
        metadata: {
          ...event.metadata,
          targetAgentId: targetAgent,
          conversationThread: thread,
        },
      };
    }

    // No agent for this stage — escalate to owner
    return {
      ...event,
      metadata: {
        ...event.metadata,
        escalateToOwner: true,
        conversationThread: thread,
      },
    };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/agents test -- conversation-router
```

Expected: PASS (both old and new tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(agents): wire thread loading into ConversationRouter"
```

---

### Task 7: AgentContext Thread Support

**Files:**

- Modify: `packages/agents/src/ports.ts`
- Modify: `packages/agents/src/__tests__/ports.test.ts`

- [ ] **Step 1: Update AgentContext and AgentResponse**

In `packages/agents/src/ports.ts`, update:

```typescript
import type { ConversationThread, AgentContextData, ThreadStage } from "@switchboard/schemas";

export interface AgentContext {
  organizationId: string;
  profile?: Record<string, unknown>;
  conversationHistory?: Array<{ role: string; content: string }>;
  contactData?: Record<string, unknown>;
  /** Loaded ConversationThread for this contact (if available). */
  thread?: ConversationThread;
}

export interface ThreadUpdate {
  stage?: ThreadStage;
  assignedAgent?: string;
  agentContext?: AgentContextData;
  currentSummary?: string;
  messageCount?: number;
}

export interface AgentResponse {
  events: import("./events.js").RoutedEventEnvelope[];
  actions: ActionRequest[];
  state?: Record<string, unknown>;
  /** Thread updates to persist after processing. */
  threadUpdate?: ThreadUpdate;
}
```

- [ ] **Step 2: Export ThreadUpdate from agents barrel**

In `packages/agents/src/index.ts`, update the ports export:

```typescript
export {
  validateAgentPort,
  type ActionRequest,
  type AgentContext,
  type AgentHandler,
  type AgentPort,
  type AgentResponse,
  type PortValidationResult,
  type ThreadUpdate,
  type ToolDeclaration,
} from "./ports.js";
```

- [ ] **Step 3: Run existing tests to verify nothing breaks**

```bash
pnpm --filter @switchboard/agents test
```

Expected: PASS — the new fields are optional, so existing code is unaffected.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(agents): add thread to AgentContext and ThreadUpdate to AgentResponse"
```

---

### Task 8: Context Extractor Module

**Files:**

- Create: `packages/agents/src/context-extractor.ts`
- Create: `packages/agents/src/__tests__/context-extractor.test.ts`

- [ ] **Step 1: Write the test file**

````typescript
// packages/agents/src/__tests__/context-extractor.test.ts
import { describe, it, expect, vi } from "vitest";
import { extractConversationContext, parseContextResponse } from "../context-extractor.js";
import type { LLMAdapter, ConversationPrompt, LLMReply } from "@switchboard/core";
import type { AgentContextData } from "@switchboard/schemas";
import type { Message } from "@switchboard/core";

describe("parseContextResponse", () => {
  it("parses valid JSON context from LLM reply", () => {
    const raw = JSON.stringify({
      objectionsEncountered: ["too expensive"],
      preferencesLearned: { time: "mornings" },
      topicsDiscussed: ["pricing", "scheduling"],
      sentimentTrend: "positive",
      offersMade: [],
    });

    const result = parseContextResponse(raw);
    expect(result.objectionsEncountered).toEqual(["too expensive"]);
    expect(result.preferencesLearned).toEqual({ time: "mornings" });
    expect(result.sentimentTrend).toBe("positive");
  });

  it("returns defaults for invalid JSON", () => {
    const result = parseContextResponse("not json");
    expect(result.objectionsEncountered).toEqual([]);
    expect(result.sentimentTrend).toBe("unknown");
  });

  it("extracts JSON from markdown code block", () => {
    const raw =
      '```json\n{"objectionsEncountered":["price"],"preferencesLearned":{},"topicsDiscussed":[],"sentimentTrend":"neutral","offersMade":[]}\n```';
    const result = parseContextResponse(raw);
    expect(result.objectionsEncountered).toEqual(["price"]);
  });
});

describe("extractConversationContext", () => {
  it("calls LLM and returns parsed context", async () => {
    const mockLlm: LLMAdapter = {
      generateReply: vi.fn().mockResolvedValue({
        reply: JSON.stringify({
          objectionsEncountered: ["timing"],
          preferencesLearned: { treatment: "botox" },
          topicsDiscussed: ["treatments"],
          sentimentTrend: "positive",
          offersMade: [],
        }),
        confidence: 0.9,
      }),
    };

    const history: Message[] = [
      {
        id: "m-1",
        contactId: "c-1",
        direction: "inbound",
        content: "How much is botox?",
        timestamp: new Date().toISOString(),
        channel: "whatsapp",
      },
      {
        id: "m-2",
        contactId: "c-1",
        direction: "outbound",
        content: "Our botox starts at $300.",
        timestamp: new Date().toISOString(),
        channel: "whatsapp",
      },
    ];

    const existing: AgentContextData = {
      objectionsEncountered: [],
      preferencesLearned: {},
      offersMade: [],
      topicsDiscussed: [],
      sentimentTrend: "unknown",
    };

    const result = await extractConversationContext(mockLlm, history, existing);
    expect(result.objectionsEncountered).toEqual(["timing"]);
    expect(result.preferencesLearned.treatment).toBe("botox");
    expect(mockLlm.generateReply).toHaveBeenCalledOnce();
  });

  it("returns existing context when LLM fails", async () => {
    const mockLlm: LLMAdapter = {
      generateReply: vi.fn().mockRejectedValue(new Error("API error")),
    };

    const existing: AgentContextData = {
      objectionsEncountered: ["price"],
      preferencesLearned: {},
      offersMade: [],
      topicsDiscussed: ["pricing"],
      sentimentTrend: "neutral",
    };

    const result = await extractConversationContext(mockLlm, [], existing);
    expect(result).toEqual(existing);
  });
});
````

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/agents test -- context-extractor
```

Expected: FAIL

- [ ] **Step 3: Implement context-extractor.ts**

````typescript
// packages/agents/src/context-extractor.ts
// ---------------------------------------------------------------------------
// Context Extractor — LLM-based extraction of conversation context signals
// ---------------------------------------------------------------------------

import type { LLMAdapter, Message } from "@switchboard/core";
import { AgentContextDataSchema, type AgentContextData } from "@switchboard/schemas";

const EXTRACTION_PROMPT = `Analyze the conversation and extract these signals as JSON:
{
  "objectionsEncountered": ["list of objections or concerns raised by the lead"],
  "preferencesLearned": {"key": "value pairs of learned preferences"},
  "topicsDiscussed": ["list of topics covered"],
  "sentimentTrend": "positive" | "neutral" | "negative" | "unknown",
  "offersMade": [{"description": "offer description"}]
}

Rules:
- Merge with existing context — add new items, don't remove old ones.
- Only include objections explicitly stated by the lead, not implied.
- Preferences should be specific and actionable (e.g., "preferred time: mornings").
- Sentiment reflects the lead's overall attitude across the conversation.
- Return ONLY the JSON object, no extra text.`;

const DEFAULT_CONTEXT: AgentContextData = {
  objectionsEncountered: [],
  preferencesLearned: {},
  offersMade: [],
  topicsDiscussed: [],
  sentimentTrend: "unknown",
};

/**
 * Parse an LLM response string into AgentContextData.
 * Handles raw JSON or JSON inside markdown code blocks.
 */
export function parseContextResponse(raw: string): AgentContextData {
  try {
    // Strip markdown code blocks if present
    const cleaned = raw
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    return AgentContextDataSchema.parse(parsed);
  } catch {
    return { ...DEFAULT_CONTEXT };
  }
}

/**
 * Extract conversation context signals via a dedicated LLM call.
 * Returns existing context unchanged if LLM call fails.
 */
export async function extractConversationContext(
  llm: LLMAdapter,
  history: Message[],
  existing: AgentContextData,
): Promise<AgentContextData> {
  if (history.length === 0) return existing;

  try {
    const existingJson = JSON.stringify(existing, null, 2);
    const reply = await llm.generateReply({
      systemPrompt:
        "You are a conversation analyst. Extract structured context from conversations.",
      conversationHistory: history,
      retrievedContext: [],
      agentInstructions: `${EXTRACTION_PROMPT}\n\nExisting context to merge with:\n${existingJson}`,
    });

    const extracted = parseContextResponse(reply.reply);

    // Merge: deduplicate arrays, overwrite sentiment
    return {
      objectionsEncountered: dedupe([
        ...existing.objectionsEncountered,
        ...extracted.objectionsEncountered,
      ]),
      preferencesLearned: {
        ...existing.preferencesLearned,
        ...extracted.preferencesLearned,
      },
      offersMade: [...existing.offersMade, ...extracted.offersMade],
      topicsDiscussed: dedupe([...existing.topicsDiscussed, ...extracted.topicsDiscussed]),
      sentimentTrend: extracted.sentimentTrend,
    };
  } catch {
    return existing;
  }
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
````

- [ ] **Step 4: Export from agents barrel**

Add to `packages/agents/src/index.ts`:

```typescript
// Context extraction (LLM-based conversation signal analysis)
export { extractConversationContext, parseContextResponse } from "./context-extractor.js";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/agents test -- context-extractor
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(agents): add LLM-based conversation context extractor"
```

---

### Task 9: Summary Refresher Module

**Files:**

- Create: `packages/agents/src/summary-refresher.ts`
- Create: `packages/agents/src/__tests__/summary-refresher.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/agents/src/__tests__/summary-refresher.test.ts
import { describe, it, expect, vi } from "vitest";
import { refreshSummary, shouldRefreshSummary } from "../summary-refresher.js";
import type { LLMAdapter } from "@switchboard/core";
import type { Message } from "@switchboard/core";

describe("shouldRefreshSummary", () => {
  it("returns true when message count is a multiple of interval", () => {
    expect(shouldRefreshSummary(10, 10)).toBe(true);
    expect(shouldRefreshSummary(20, 10)).toBe(true);
  });

  it("returns false when message count is not a multiple", () => {
    expect(shouldRefreshSummary(5, 10)).toBe(false);
    expect(shouldRefreshSummary(13, 10)).toBe(false);
  });

  it("returns false for zero messages", () => {
    expect(shouldRefreshSummary(0, 10)).toBe(false);
  });
});

describe("refreshSummary", () => {
  it("generates summary via LLM", async () => {
    const mockLlm: LLMAdapter = {
      generateReply: vi.fn().mockResolvedValue({
        reply: "Lead interested in botox, asked about pricing. Positive sentiment.",
        confidence: 0.9,
      }),
    };

    const history: Message[] = [
      {
        id: "m-1",
        contactId: "c-1",
        direction: "inbound",
        content: "Hi",
        timestamp: new Date().toISOString(),
        channel: "whatsapp",
      },
      {
        id: "m-2",
        contactId: "c-1",
        direction: "outbound",
        content: "Hello!",
        timestamp: new Date().toISOString(),
        channel: "whatsapp",
      },
    ];

    const result = await refreshSummary(mockLlm, history);
    expect(result).toBe("Lead interested in botox, asked about pricing. Positive sentiment.");
    expect(mockLlm.generateReply).toHaveBeenCalledOnce();
  });

  it("returns fallback on LLM failure", async () => {
    const mockLlm: LLMAdapter = {
      generateReply: vi.fn().mockRejectedValue(new Error("timeout")),
    };

    const result = await refreshSummary(mockLlm, []);
    expect(result).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/agents test -- summary-refresher
```

Expected: FAIL

- [ ] **Step 3: Implement summary-refresher.ts**

```typescript
// packages/agents/src/summary-refresher.ts
// ---------------------------------------------------------------------------
// Summary Refresher — LLM-based conversation summary regeneration
// ---------------------------------------------------------------------------

import type { LLMAdapter, Message } from "@switchboard/core";

const SUMMARY_PROMPT = `Summarize this conversation in 2-3 sentences. Focus on:
- What the lead is interested in
- Key questions or concerns raised
- Current status of the conversation (exploring, ready to book, hesitant, etc.)

Return ONLY the summary text, no formatting or labels.`;

/**
 * Check if the conversation summary should be refreshed based on message count.
 */
export function shouldRefreshSummary(messageCount: number, interval: number): boolean {
  return messageCount > 0 && messageCount % interval === 0;
}

/**
 * Generate a fresh conversation summary via LLM.
 * Returns empty string on failure.
 */
export async function refreshSummary(llm: LLMAdapter, history: Message[]): Promise<string> {
  if (history.length === 0) return "";

  try {
    const reply = await llm.generateReply({
      systemPrompt: "You are a conversation summarizer. Be concise and factual.",
      conversationHistory: history,
      retrievedContext: [],
      agentInstructions: SUMMARY_PROMPT,
    });
    return reply.reply.trim();
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Export from agents barrel**

Add to `packages/agents/src/index.ts`:

```typescript
// Summary refresh (LLM-based conversation summarization)
export { refreshSummary, shouldRefreshSummary } from "./summary-refresher.js";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/agents test -- summary-refresher
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(agents): add LLM-based conversation summary refresher"
```

---

### Task 10: LeadResponder Thread Integration

**Files:**

- Modify: `packages/agents/src/agents/lead-responder/types.ts`
- Modify: `packages/agents/src/agents/lead-responder/prompt-builder.ts`
- Modify: `packages/agents/src/agents/lead-responder/handler.ts`
- Modify: `packages/agents/src/agents/lead-responder/__tests__/handler-conversation.test.ts`
- Modify: `packages/agents/src/agents/lead-responder/__tests__/prompt-builder.test.ts`

- [ ] **Step 1: Read existing handler-conversation test**

Read `packages/agents/src/agents/lead-responder/__tests__/handler-conversation.test.ts` to understand current test patterns.

- [ ] **Step 2: Add thread context to prompt builder input**

In `packages/agents/src/agents/lead-responder/prompt-builder.ts`, update the `PromptBuildInput` interface and `buildConversationPrompt`:

```typescript
import type { AgentContextData } from "@switchboard/schemas";

export interface PromptBuildInput {
  history: Message[];
  chunks: RetrievedChunk[];
  tonePreset: TonePreset | undefined;
  language: SupportedLanguage | undefined;
  bookingLink?: string;
  testMode?: boolean;
  /** Thread context — objections, preferences, topics, sentiment */
  threadContext?: AgentContextData;
}
```

Update the `buildConversationPrompt` function to include thread context in `agentInstructions`:

```typescript
export function buildConversationPrompt(input: PromptBuildInput): ConversationPrompt {
  const tone = getTonePreset(input.tonePreset);
  const language = getLanguageDirective(input.language);

  const systemPrompt = `${tone}\n\n${language}`;

  let instructions = AGENT_INSTRUCTIONS;

  if (input.bookingLink) {
    instructions += `\n\nBooking link: ${input.bookingLink} — share this when the client is ready to book.`;
  }

  if (input.testMode) {
    instructions += TEST_MODE_ADDENDUM;
  }

  if (input.threadContext) {
    instructions += buildThreadContextBlock(input.threadContext);
  }

  return {
    systemPrompt,
    conversationHistory: input.history,
    retrievedContext: input.chunks,
    agentInstructions: instructions,
  };
}

function buildThreadContextBlock(ctx: AgentContextData): string {
  const parts: string[] = ["\n\n--- CONVERSATION MEMORY ---"];

  if (ctx.objectionsEncountered.length > 0) {
    parts.push(`Objections raised: ${ctx.objectionsEncountered.join(", ")}`);
  }

  const prefs = Object.entries(ctx.preferencesLearned);
  if (prefs.length > 0) {
    parts.push(`Known preferences: ${prefs.map(([k, v]) => `${k}: ${v}`).join(", ")}`);
  }

  if (ctx.topicsDiscussed.length > 0) {
    parts.push(`Topics covered: ${ctx.topicsDiscussed.join(", ")}`);
  }

  if (ctx.sentimentTrend !== "unknown") {
    parts.push(`Lead sentiment: ${ctx.sentimentTrend}`);
  }

  if (ctx.offersMade.length > 0) {
    parts.push(`Offers made: ${ctx.offersMade.map((o) => o.description).join(", ")}`);
  }

  parts.push(
    "Use this memory to maintain continuity. Don't repeat offers or re-ask answered questions.",
  );
  parts.push("--- END MEMORY ---");

  return parts.join("\n");
}
```

- [ ] **Step 3: Update prompt-builder test**

Read `packages/agents/src/agents/lead-responder/__tests__/prompt-builder.test.ts` and add:

```typescript
it("includes thread context in instructions", () => {
  const prompt = buildConversationPrompt({
    history: [],
    chunks: [],
    tonePreset: undefined,
    language: undefined,
    threadContext: {
      objectionsEncountered: ["too expensive"],
      preferencesLearned: { time: "mornings" },
      offersMade: [],
      topicsDiscussed: ["pricing"],
      sentimentTrend: "positive",
    },
  });

  expect(prompt.agentInstructions).toContain("CONVERSATION MEMORY");
  expect(prompt.agentInstructions).toContain("too expensive");
  expect(prompt.agentInstructions).toContain("time: mornings");
  expect(prompt.agentInstructions).toContain("positive");
});

it("omits memory block when no thread context", () => {
  const prompt = buildConversationPrompt({
    history: [],
    chunks: [],
    tonePreset: undefined,
    language: undefined,
  });

  expect(prompt.agentInstructions).not.toContain("CONVERSATION MEMORY");
});
```

- [ ] **Step 4: Run prompt-builder tests**

```bash
pnpm --filter @switchboard/agents test -- prompt-builder
```

Expected: PASS

- [ ] **Step 5: Update LeadResponderHandler to use thread context**

In `packages/agents/src/agents/lead-responder/handler.ts`, update `handleMessageReceived` to:

1. Read thread from event metadata
2. Pass threadContext to prompt builder
3. After LLM reply, extract context and return threadUpdate
4. Refresh summary if needed

Update the imports at the top:

```typescript
import type { ConversationThread, AgentContextData } from "@switchboard/schemas";
import { extractConversationContext } from "../../context-extractor.js";
import { refreshSummary, shouldRefreshSummary } from "../../summary-refresher.js";
import { SUMMARY_REFRESH_INTERVAL } from "@switchboard/core";
import type { ThreadUpdate } from "../../ports.js";
```

Update `handleMessageReceived` — after step 4 (retrieve knowledge chunks), before step 5 (build prompt):

```typescript
// 4.5. Load thread context from event metadata
const thread = (event.metadata?.conversationThread as ConversationThread) ?? undefined;
const existingContext = thread?.agentContext ?? {
  objectionsEncountered: [],
  preferencesLearned: {},
  offersMade: [],
  topicsDiscussed: [],
  sentimentTrend: "unknown" as const,
};
```

Update the `buildConversationPrompt` call to include `threadContext`:

```typescript
const prompt = buildConversationPrompt({
  history: [...history, inboundMessage],
  chunks,
  tonePreset,
  language,
  bookingLink,
  testMode,
  threadContext: existingContext,
});
```

After step 11 (append outbound reply), add context extraction and summary refresh:

```typescript
// 12. Extract updated context (non-blocking, best-effort)
let threadUpdate: ThreadUpdate | undefined;
if (thread) {
  const newMessageCount = (thread.messageCount ?? 0) + 1;
  const updatedContext = await extractConversationContext(
    conv.llm,
    [...history, inboundMessage, outboundMessage],
    existingContext,
  );

  threadUpdate = {
    stage: qualified ? "qualified" : thread.stage === "new" ? "responding" : thread.stage,
    agentContext: updatedContext,
    messageCount: newMessageCount,
  };

  // 13. Refresh summary if at interval
  if (shouldRefreshSummary(newMessageCount, SUMMARY_REFRESH_INTERVAL)) {
    const summary = await refreshSummary(conv.llm, [...history, inboundMessage, outboundMessage]);
    if (summary) {
      threadUpdate.currentSummary = summary;
    }
  }
}
```

Update the return to include threadUpdate:

```typescript
return {
  events,
  actions,
  state: {
    lastScore: scoreResult.score,
    lastTier: scoreResult.tier,
    qualified,
    confidence,
    reply: llmReply.reply,
  },
  threadUpdate,
};
```

- [ ] **Step 6: Add thread integration test**

Add to `packages/agents/src/agents/lead-responder/__tests__/handler-conversation.test.ts`:

```typescript
describe("thread integration", () => {
  it("reads thread context from event metadata and returns threadUpdate", async () => {
    const handler = new LeadResponderHandler({
      scoreLead: () => ({ score: 30, tier: "cool", factors: [] }),
      conversation: {
        llm: {
          generateReply: vi
            .fn()
            .mockResolvedValueOnce({ reply: "Hi! How can I help?", confidence: 0.8 })
            .mockResolvedValueOnce({
              reply: JSON.stringify({
                objectionsEncountered: [],
                preferencesLearned: {},
                topicsDiscussed: ["greeting"],
                sentimentTrend: "positive",
                offersMade: [],
              }),
              confidence: 0.9,
            }),
        },
        retriever: { retrieve: vi.fn().mockResolvedValue([]) },
        conversationStore: {
          getHistory: vi.fn().mockResolvedValue([]),
          appendMessage: vi.fn(),
          getStage: vi.fn().mockResolvedValue("lead"),
          setStage: vi.fn(),
          isOptedOut: vi.fn().mockResolvedValue(false),
          setOptOut: vi.fn(),
        },
      },
    });

    const event = {
      eventId: "e-1",
      eventType: "message.received",
      organizationId: "org-1",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c-1", messageText: "Hello" },
      timestamp: new Date().toISOString(),
      metadata: {
        conversationThread: {
          id: "t-1",
          contactId: "c-1",
          organizationId: "org-1",
          stage: "new",
          assignedAgent: "lead-responder",
          agentContext: {
            objectionsEncountered: [],
            preferencesLearned: {},
            offersMade: [],
            topicsDiscussed: [],
            sentimentTrend: "unknown",
          },
          currentSummary: "",
          followUpSchedule: { nextFollowUpAt: null, reason: null, cadenceId: null },
          lastOutcomeAt: null,
          messageCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    } as unknown as import("../../../events.js").RoutedEventEnvelope;

    const result = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(result.threadUpdate).toBeDefined();
    expect(result.threadUpdate!.stage).toBe("responding");
    expect(result.threadUpdate!.messageCount).toBe(1);
  });
});
```

- [ ] **Step 7: Run handler tests**

```bash
pnpm --filter @switchboard/agents test -- lead-responder
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(agents): integrate thread context into LeadResponder"
```

---

### Task 11: SalesCloser Thread Integration

**Files:**

- Modify: `packages/agents/src/agents/sales-closer/prompt-builder.ts`
- Modify: `packages/agents/src/agents/sales-closer/handler.ts`
- Modify: `packages/agents/src/agents/sales-closer/__tests__/prompt-builder.test.ts`
- Modify: `packages/agents/src/agents/sales-closer/__tests__/handler.test.ts`

- [ ] **Step 1: Update SalesCloser prompt builder with thread context**

In `packages/agents/src/agents/sales-closer/prompt-builder.ts`, apply the same pattern as LeadResponder:

```typescript
import type { AgentContextData } from "@switchboard/schemas";

export interface SalesCloserPromptInput {
  history: Message[];
  chunks: RetrievedChunk[];
  tonePreset: TonePreset | undefined;
  language: SupportedLanguage | undefined;
  bookingUrl?: string;
  urgencyEnabled?: boolean;
  /** Thread context — objections, preferences, topics, sentiment */
  threadContext?: AgentContextData;
}
```

Add the same `buildThreadContextBlock` helper and call it in `buildSalesCloserPrompt`:

```typescript
export function buildSalesCloserPrompt(input: SalesCloserPromptInput): ConversationPrompt {
  const tone = getTonePreset(input.tonePreset);
  const language = getLanguageDirective(input.language);

  const systemPrompt = `${tone}\n\n${language}`;

  let instructions = AGENT_INSTRUCTIONS;

  if (input.urgencyEnabled) {
    instructions += URGENCY_ADDENDUM;
  }

  if (input.bookingUrl) {
    instructions += `\n\nBooking link: ${input.bookingUrl} — share this when the client is ready to book.`;
  }

  if (input.threadContext) {
    instructions += buildThreadContextBlock(input.threadContext);
  }

  return {
    systemPrompt,
    conversationHistory: input.history,
    retrievedContext: input.chunks,
    agentInstructions: instructions,
  };
}

function buildThreadContextBlock(ctx: AgentContextData): string {
  const parts: string[] = ["\n\n--- CONVERSATION MEMORY ---"];

  if (ctx.objectionsEncountered.length > 0) {
    parts.push(`Objections raised: ${ctx.objectionsEncountered.join(", ")}`);
  }

  const prefs = Object.entries(ctx.preferencesLearned);
  if (prefs.length > 0) {
    parts.push(`Known preferences: ${prefs.map(([k, v]) => `${k}: ${v}`).join(", ")}`);
  }

  if (ctx.topicsDiscussed.length > 0) {
    parts.push(`Topics covered: ${ctx.topicsDiscussed.join(", ")}`);
  }

  if (ctx.sentimentTrend !== "unknown") {
    parts.push(`Lead sentiment: ${ctx.sentimentTrend}`);
  }

  if (ctx.offersMade.length > 0) {
    parts.push(`Offers made: ${ctx.offersMade.map((o) => o.description).join(", ")}`);
  }

  parts.push(
    "Use this memory to maintain continuity. Don't repeat offers or re-ask answered questions.",
  );
  parts.push("--- END MEMORY ---");

  return parts.join("\n");
}
```

- [ ] **Step 2: Update SalesCloser handler**

In `packages/agents/src/agents/sales-closer/handler.ts`, the `handleMessageReceived` method has this flow:

1. Validate payload (line ~46)
2. Get history (line ~67, "// 1. Retrieve conversation history")
3. Check max turns (line ~71, "// 2. Check max turns")
4. Append inbound (line ~88, "// 3. Append inbound message")
5. Retrieve chunks (line ~98, "// 4. Retrieve relevant knowledge chunks")
6. Build prompt (line ~105, "// 5. Build ConversationPrompt")
7. Generate reply (line ~115, "// 6. Generate LLM reply")
8. Confidence check (line ~125, "// 8. Confidence check")
9. Send reply (line ~149, "// 9. Send reply")
10. Append outbound (line ~156, "// 10. Append outbound reply")

Add imports at the top of the file:

```typescript
import type { ConversationThread, AgentContextData } from "@switchboard/schemas";
import { extractConversationContext } from "../../context-extractor.js";
import { refreshSummary, shouldRefreshSummary } from "../../summary-refresher.js";
import { SUMMARY_REFRESH_INTERVAL } from "@switchboard/core";
import type { ThreadUpdate } from "../../ports.js";
```

**After step 4 (retrieve chunks, line ~103)**, add thread context loading:

```typescript
// 4.5. Load thread context
const thread = (event.metadata?.conversationThread as ConversationThread) ?? undefined;
const existingContext = thread?.agentContext ?? {
  objectionsEncountered: [],
  preferencesLearned: {},
  offersMade: [],
  topicsDiscussed: [],
  sentimentTrend: "unknown" as const,
};
```

**Update the `buildSalesCloserPrompt` call (step 5)** to include `threadContext`:

```typescript
const prompt = buildSalesCloserPrompt({
  history: [...history, inboundMessage],
  chunks,
  tonePreset,
  language,
  bookingUrl,
  urgencyEnabled,
  threadContext: existingContext,
});
```

**After step 10 (append outbound, line ~165)**, add context extraction:

```typescript
// 11. Extract updated context
let threadUpdate: ThreadUpdate | undefined;
if (thread) {
  const newMessageCount = (thread.messageCount ?? 0) + 1;
  const updatedContext = await extractConversationContext(
    conv.llm,
    [...history, inboundMessage, outboundMessage],
    existingContext,
  );

  threadUpdate = {
    agentContext: updatedContext,
    messageCount: newMessageCount,
  };

  if (shouldRefreshSummary(newMessageCount, SUMMARY_REFRESH_INTERVAL)) {
    const summary = await refreshSummary(conv.llm, [...history, inboundMessage, outboundMessage]);
    if (summary) {
      threadUpdate.currentSummary = summary;
    }
  }
}
```

**Update the return statement** (currently `return { events: [], actions, state: ... }`) to include threadUpdate:

```typescript
return {
  events: [],
  actions,
  state: { contactId, confidence, reply: llmReply.reply },
  threadUpdate,
};
```

- [ ] **Step 3: Add tests for prompt builder**

Add to `packages/agents/src/agents/sales-closer/__tests__/prompt-builder.test.ts`:

```typescript
it("includes thread context in instructions", () => {
  const prompt = buildSalesCloserPrompt({
    history: [],
    chunks: [],
    tonePreset: undefined,
    language: undefined,
    threadContext: {
      objectionsEncountered: ["timing concern"],
      preferencesLearned: { treatment: "facial" },
      offersMade: [{ description: "20% off", date: new Date() }],
      topicsDiscussed: ["booking"],
      sentimentTrend: "positive",
    },
  });

  expect(prompt.agentInstructions).toContain("CONVERSATION MEMORY");
  expect(prompt.agentInstructions).toContain("timing concern");
  expect(prompt.agentInstructions).toContain("treatment: facial");
  expect(prompt.agentInstructions).toContain("20% off");
});
```

- [ ] **Step 4: Run SalesCloser tests**

```bash
pnpm --filter @switchboard/agents test -- sales-closer
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(agents): integrate thread context into SalesCloser"
```

---

### Task 12: API Wiring — Conversation Endpoint + Bootstrap

**Files:**

- Modify: `apps/api/src/bootstrap/conversation-deps.ts`
- Modify: `apps/api/src/agent-bootstrap.ts`
- Modify: `apps/api/src/routes/conversation.ts`

- [ ] **Step 1: Add threadStore to ConversationDeps**

In `apps/api/src/bootstrap/conversation-deps.ts`, add:

```typescript
import type { ConversationThreadStore } from "@switchboard/core";

export interface ConversationDepsInput {
  anthropicApiKey?: string;
  conversationStore?: ConversationStore;
  knowledgeStore?: KnowledgeStore;
  model?: string;
  voyageApiKey?: string;
  /** Thread store for per-contact derived state. */
  threadStore?: ConversationThreadStore;
}

export interface ConversationDeps {
  llm: LLMAdapter;
  retriever: KnowledgeRetriever;
  conversationStore: ConversationStore;
  embeddingAdapter: EmbeddingAdapter;
  /** Thread store — null if not provided. */
  threadStore: ConversationThreadStore | null;
}
```

Update `buildConversationDeps` to pass through the threadStore:

```typescript
return {
  llm,
  retriever,
  conversationStore,
  embeddingAdapter,
  threadStore: input.threadStore ?? null,
};
```

- [ ] **Step 2: Wire threadStore into AgentSystem bootstrap**

In `apps/api/src/agent-bootstrap.ts`, update `AgentSystemOptions`:

```typescript
import type { ConversationThreadStore } from "@switchboard/core";

export interface AgentSystemOptions {
  // ... existing fields ...
  /** Thread store for per-contact conversation state. */
  threadStore?: ConversationThreadStore;
}
```

Update the ConversationRouter creation to pass threadStore:

```typescript
let conversationRouter: ConversationRouter | undefined;
if (options.conversationStore) {
  conversationRouter = new ConversationRouter({
    getStage: options.conversationStore.getStage,
    threadStore: options.threadStore,
  });
}
```

- [ ] **Step 3: Update conversation endpoint to save thread updates**

In `apps/api/src/routes/conversation.ts`, add thread saving after EventLoop processing.

Add imports:

```typescript
import type { ConversationThreadStore } from "@switchboard/core";
```

After step 4 (process through EventLoop), before sending the response, add:

```typescript
// 4.5. Save thread updates from agent processing
const threadStore = app.agentSystem?.threadStore ?? null;
if (threadStore && result.processed.length > 0) {
  for (const agent of result.processed) {
    const threadUpdate = (agent as unknown as { threadUpdate?: Record<string, unknown> })
      .threadUpdate;
    if (threadUpdate && event.metadata?.conversationThread) {
      const thread = event.metadata.conversationThread as { id: string };
      try {
        await threadStore.update(thread.id, threadUpdate);
      } catch (err) {
        app.log.error({ err, threadId: thread.id }, "Failed to save thread update");
      }
    }
  }
}
```

Wait — `ProcessedAgent` doesn't have `threadUpdate`. Looking at the EventLoop, it returns `ProcessedAgent` which has limited fields. The `AgentResponse.threadUpdate` needs to be propagated through the EventLoop to the caller.

Let me check the EventLoop code first.

- [ ] **Step 3 (revised): Update EventLoop to propagate threadUpdate**

Read `packages/agents/src/event-loop.ts`. The `ProcessedAgent` interface (lines 31-40) has:

- `eventId`, `eventType`, `agentId`, `success`, `outputEvents: string[]`, `actionsExecuted: string[]`, `actionsFailed: string[]`, `error?: string`

It does NOT preserve `AgentResponse.threadUpdate`. We need to propagate it through.

In `packages/agents/src/event-loop.ts`, add `threadUpdate` to the `ProcessedAgent` interface:

```typescript
export interface ProcessedAgent {
  eventId: string;
  eventType: string;
  agentId: string;
  success: boolean;
  outputEvents: string[];
  actionsExecuted: string[];
  actionsFailed: string[];
  error?: string;
  /** Thread updates from agent (if any). */
  threadUpdate?: import("./ports.js").ThreadUpdate;
}
```

Then in the `processAgent` method (around line 194), where the successful `ProcessedAgent` result is built, add `threadUpdate`:

```typescript
return {
  result: {
    eventId: event.eventId,
    eventType: event.eventType,
    agentId: destId,
    success: true,
    outputEvents: response.events.map((e) => e.eventType),
    actionsExecuted,
    actionsFailed,
    threadUpdate: response.threadUpdate, // <-- ADD THIS LINE
  },
  outputEvents: response.events,
};
```

- [ ] **Step 4: Update AgentSystem interface to include threadStore**

In `apps/api/src/agent-bootstrap.ts`, update the `AgentSystem` interface:

```typescript
export interface AgentSystem {
  registry: AgentRegistry;
  handlerRegistry: HandlerRegistry;
  eventLoop: EventLoop;
  stateTracker: AgentStateTracker;
  scheduledRunner: ScheduledRunner;
  actionExecutor: ActionExecutor;
  conversationRouter?: ConversationRouter;
  threadStore?: ConversationThreadStore;
}
```

Pass it through in the return:

```typescript
return {
  registry,
  handlerRegistry,
  eventLoop,
  stateTracker,
  scheduledRunner,
  actionExecutor,
  conversationRouter,
  threadStore: options.threadStore,
};
```

- [ ] **Step 5: Update conversation endpoint to save thread updates (final version)**

In `apps/api/src/routes/conversation.ts`, after EventLoop processing, add:

```typescript
// 5. Save thread updates from agent processing
if (result.processed.length > 0) {
  const thread = event.metadata?.conversationThread as { id: string } | undefined;
  if (thread && agentSystem.threadStore) {
    for (const agent of result.processed) {
      if (agent.threadUpdate) {
        try {
          await agentSystem.threadStore.update(thread.id, agent.threadUpdate);
        } catch (err) {
          app.log.error({ err, threadId: thread.id }, "Failed to save thread update");
        }
      }
    }
  }
}
```

- [ ] **Step 6: Wire PrismaConversationThreadStore in app.ts**

Read `apps/api/src/app.ts` to find where conversation deps are built and the agent system is bootstrapped. Add:

```typescript
import { PrismaConversationThreadStore } from "@switchboard/db";
```

Where the `buildConversationDeps` is called, create and pass the thread store:

```typescript
const threadStore = new PrismaConversationThreadStore(prisma);
```

Pass it both to `buildConversationDeps` and to `bootstrapAgentSystem`:

```typescript
const convDeps = buildConversationDeps({
  // ... existing ...
  threadStore,
});

const agentSystem = bootstrapAgentSystem({
  // ... existing ...
  threadStore,
});
```

- [ ] **Step 7: Export ProcessedAgent threadUpdate from agents barrel**

The agents barrel already exports `ProcessedAgent`. Since we added `threadUpdate` to its interface, the export is updated automatically.

Verify `packages/agents/src/index.ts` already exports `ProcessedAgent`:

```typescript
export {
  EventLoop,
  type EventLoopConfig,
  type EventLoopResult,
  type ProcessedAgent,
} from "./event-loop.js";
```

- [ ] **Step 8: Run API tests**

```bash
pnpm --filter @switchboard/api test
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(api): wire ConversationThread store into conversation pipeline"
```

---

### Task 13: Full Verification

**Files:** None — verification only

- [ ] **Step 1: Type check all packages**

```bash
pnpm typecheck --force
```

Expected: PASS

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: PASS

- [ ] **Step 3: Run linting**

```bash
pnpm lint
```

Expected: PASS

- [ ] **Step 4: Run format check**

```bash
pnpm format:check
```

Expected: PASS. If not:

```bash
pnpm format:write
```

- [ ] **Step 5: Verify no circular dependencies**

```bash
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/agents test
pnpm --filter @switchboard/db test
```

Check that the new imports respect the layer hierarchy:

- `schemas` → no @switchboard/\* imports ✓
- `core` → schemas only ✓ (conversations/ imports from @switchboard/schemas)
- `agents` → schemas + core ✓ (context-extractor, summary-refresher use @switchboard/core LLMAdapter)
- `db` → schemas + core ✓ (prisma-thread-store uses local types, no cross-layer imports)

- [ ] **Step 6: Commit final state**

If any formatting or lint fixes were needed:

```bash
git add -A && git commit -m "chore: fix formatting and lint after thread integration"
```

- [ ] **Step 7: Push for PR**

If not already on a feature branch, create one:

```bash
git checkout -b feat/conversation-thread-phase2
```

Push all commits:

```bash
git push origin feat/conversation-thread-phase2
```

---

## Follow-Up Items (not in scope for this plan)

- **Extract shared `buildThreadContextBlock` helper.** Currently duplicated identically in LeadResponder and SalesCloser prompt builders. Extract to `packages/agents/src/thread-prompt-utils.ts` when a third agent needs it.
- **Nurture agent thread integration.** The Nurture agent doesn't handle `message.received` yet (it runs cadences). Thread integration deferred to when Nurture gets conversational capability.
- **Thread-based ContactLifecycle sync.** The `ContactLifecycle.stage` and `ConversationThread.stage` are now independent. Consider syncing them or deprecating the former.
- **Thread context extraction optimization.** Currently a separate LLM call per turn. Could batch with the main reply generation for lower latency.
