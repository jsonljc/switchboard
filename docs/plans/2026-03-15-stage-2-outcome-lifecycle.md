# Stage 2: Complete Outcome Lifecycle — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the lead bot's outcome tracking, funnel event emission, and conversation flow coverage so every lead journey is measured end-to-end — enabling the North Star metric (booked revenue attributable to Switchboard per customer per month).

**Architecture:** Stage 1 wired the basic pipeline (ConversionBus → CAPI, OutcomePipeline → PrismaOutcomeStore, speed-to-lead %, weekly digest). Stage 2 closes the remaining gaps: emit all 6 outcome types from the correct code paths, emit all funnel-stage ConversionBus events (not just "booked"), register all 5 conversation flow templates (not just 2), add a silence-timeout detector to catch unresponsive leads, and build a conversation thread viewer so business owners can see what their bot is saying.

**Tech Stack:** TypeScript, Vitest, Prisma, Fastify, Next.js App Router, React, ConversationRouter, OutcomePipeline, ConversionBus

---

## Deliverable 1: Complete Outcome Lifecycle (emit all 6 outcome types)

**Problem:** The OutcomePipeline schema defines 6 outcome types (`booked`, `escalated_resolved`, `escalated_unresolved`, `unresponsive`, `lost`, `reactivated`) but only 2 are ever emitted (`booked` at lead-handler.ts:169, `escalated_unresolved` at lead-handler.ts:253). The other 4 are never recorded, making outcome analytics blind to 4/6 of the lead journey endings.

**Existing infrastructure:**

- `OutcomePipeline.emitOutcome()` — `packages/core/src/outcome/pipeline.ts:12-30`
- `OutcomeType` enum — `packages/schemas/src/outcome-event.ts:7-14`
- `LeadConversationState` enum — `cartridges/customer-engagement/src/conversation/lead-state-machine.ts:8-24`
- `LeadConversationEvent` — includes `SILENCE_72H`, `REACTIVATION_REPLY`, `HUMAN_RELEASED`
- `deps.outcomePipeline` already available in lead-handler.ts

### Task 1: Emit `lost` outcome for low-score qualification completions

**Files:**

- Modify: `apps/chat/src/handlers/lead-handler.ts:139-175`
- Test: `apps/chat/src/handlers/__tests__/lead-handler.test.ts`

**Step 1: Write the failing test**

In `apps/chat/src/handlers/__tests__/lead-handler.test.ts`, add a new test:

```ts
it("emits 'lost' outcome when qualification completes with score < 50", async () => {
  const outcomePipeline = {
    emitOutcome: vi.fn().mockResolvedValue({}),
    logResponseVariant: vi.fn().mockResolvedValue({}),
  };

  mockRouter = {
    handleMessage: vi.fn().mockResolvedValue(
      mockRouterResponse({
        responses: ["Thanks for your interest."],
        completed: true,
        variables: { leadScore: "25" },
        machineState: "qualified",
      }),
    ),
  } as unknown as ConversationRouter;

  await handleLeadMessage(ctx, mockRouter, createMockMessage(), "thread-1", null, {
    outcomePipeline: outcomePipeline as never,
  });

  expect(outcomePipeline.emitOutcome).toHaveBeenCalledWith(
    expect.objectContaining({
      outcomeType: "lost",
      metadata: expect.objectContaining({ leadScore: 25, reason: "low_qualification_score" }),
    }),
  );
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/chat && ../../node_modules/.bin/vitest run src/handlers/__tests__/lead-handler.test.ts`
Expected: FAIL — `emitOutcome` not called with `outcomeType: "lost"`

**Step 3: Write minimal implementation**

In `apps/chat/src/handlers/lead-handler.ts`, after the `if (deps?.outcomePipeline && leadScore >= 50)` block (around line 174), add an `else if` for low scores:

```ts
// Emit "lost" outcome for low-score completions (qualification didn't convert)
if (deps?.outcomePipeline && leadScore < 50) {
  try {
    await deps.outcomePipeline.emitOutcome({
      sessionId: threadId,
      organizationId: inbound.organizationId,
      outcomeType: "lost",
      metadata: { leadScore, reason: "low_qualification_score" },
    });
  } catch {
    // Non-critical
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/chat && ../../node_modules/.bin/vitest run src/handlers/__tests__/lead-handler.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git commit -m "feat: emit 'lost' outcome for low-score qualification completions"
```

---

### Task 2: Emit `escalated_resolved` outcome on human release

**Files:**

- Modify: `apps/chat/src/runtime.ts`
- Modify: `apps/chat/src/handlers/lead-handler.ts`
- Test: `apps/chat/src/handlers/__tests__/lead-handler.test.ts`

**Context:** The `HUMAN_RELEASED` event transitions the state machine from `HUMAN_ACTIVE` → `REACTIVATION`. When an escalated conversation is released by a human, we need to emit `escalated_resolved`. The router already detects `HUMAN_RELEASED` transitions — we need to add outcome emission.

**Step 1: Write the failing test**

Add test in `lead-handler.test.ts`:

```ts
it("emits 'escalated_resolved' when router signals human release", async () => {
  const outcomePipeline = {
    emitOutcome: vi.fn().mockResolvedValue({}),
    logResponseVariant: vi.fn().mockResolvedValue({}),
  };

  mockRouter = {
    handleMessage: vi.fn().mockResolvedValue(
      mockRouterResponse({
        responses: ["Welcome back! How can I help?"],
        machineState: "REACTIVATION",
        previousMachineState: "HUMAN_ACTIVE",
      }),
    ),
  } as unknown as ConversationRouter;

  await handleLeadMessage(ctx, mockRouter, createMockMessage(), "thread-1", null, {
    outcomePipeline: outcomePipeline as never,
  });

  expect(outcomePipeline.emitOutcome).toHaveBeenCalledWith(
    expect.objectContaining({ outcomeType: "escalated_resolved" }),
  );
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — check if `RouterResponse` has `previousMachineState`. If not, we need to check if the router exposes this. Look at `router.ts` to see what data is available. We may need to track previous state in the conversation thread instead.

**Step 3: Write minimal implementation**

In `lead-handler.ts`, after the response loop (after line 103), add a state-transition check:

```ts
// Detect human-release transition (HUMAN_ACTIVE → REACTIVATION)
if (deps?.outcomePipeline && routerResponse.machineState === "REACTIVATION") {
  const conversation = await getThread(threadId);
  const prevState = conversation?.previousMachineState;
  if (prevState === "HUMAN_ACTIVE" || prevState === "ESCALATING") {
    try {
      await deps.outcomePipeline.emitOutcome({
        sessionId: threadId,
        organizationId: inbound.organizationId,
        outcomeType: "escalated_resolved",
      });
    } catch {
      // Non-critical
    }
  }
}
```

Also, update the conversation thread to track `previousMachineState` — store `routerResponse.machineState` at the end of `handleLeadMessage` to the thread as `previousMachineState` so the next invocation can detect transitions. This may require updating the conversation state schema.

**Note:** If `RouterResponse` already has `previousMachineState`, use that directly. Check the actual type first during implementation.

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git commit -m "feat: emit 'escalated_resolved' outcome on human release transition"
```

---

### Task 3: Emit `reactivated` outcome when dormant lead re-engages

**Files:**

- Modify: `apps/chat/src/handlers/lead-handler.ts`
- Test: `apps/chat/src/handlers/__tests__/lead-handler.test.ts`

**Step 1: Write the failing test**

```ts
it("emits 'reactivated' outcome when state transitions to REACTIVATION from CLOSED_UNRESPONSIVE", async () => {
  const outcomePipeline = {
    emitOutcome: vi.fn().mockResolvedValue({}),
    logResponseVariant: vi.fn().mockResolvedValue({}),
  };

  // Mock thread with previous unresponsive state
  const { getThread } = await import("../../conversation/threads.js");
  (getThread as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    id: "thread-1",
    crmContactId: "contact-123",
    messages: [],
    previousMachineState: "CLOSED_UNRESPONSIVE",
  });

  mockRouter = {
    handleMessage: vi.fn().mockResolvedValue(
      mockRouterResponse({
        responses: ["Welcome back!"],
        machineState: "REACTIVATION",
      }),
    ),
  } as unknown as ConversationRouter;

  await handleLeadMessage(ctx, mockRouter, createMockMessage(), "thread-1", null, {
    outcomePipeline: outcomePipeline as never,
  });

  expect(outcomePipeline.emitOutcome).toHaveBeenCalledWith(
    expect.objectContaining({ outcomeType: "reactivated" }),
  );
});
```

**Step 2: Run test to verify it fails**

**Step 3: Write minimal implementation**

In the same REACTIVATION-detection block from Task 2, add a branch for `CLOSED_UNRESPONSIVE`:

```ts
if (prevState === "CLOSED_UNRESPONSIVE") {
  try {
    await deps.outcomePipeline.emitOutcome({
      sessionId: threadId,
      organizationId: inbound.organizationId,
      outcomeType: "reactivated",
      metadata: { previousState: prevState },
    });
  } catch {
    // Non-critical
  }
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git commit -m "feat: emit 'reactivated' outcome when dormant lead re-engages"
```

---

## Deliverable 2: Silence Timeout Detector

**Problem:** The `unresponsive` outcome is never emitted. The state machine has a `SILENCE_72H` event that transitions to `CLOSED_UNRESPONSIVE`, but no background job detects lead silence and fires this event. Leads that go silent are never marked as unresponsive.

### Task 4: Create silence-timeout background job

**Files:**

- Create: `apps/chat/src/jobs/silence-detector.ts`
- Test: `apps/chat/src/jobs/__tests__/silence-detector.test.ts`
- Modify: `apps/chat/src/bootstrap.ts` (wire the job)

**Step 1: Write the failing test**

Create `apps/chat/src/jobs/__tests__/silence-detector.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { detectSilentConversations } from "../silence-detector.js";

function createMockPrisma(conversations: unknown[] = []) {
  return {
    conversationState: {
      findMany: vi.fn().mockResolvedValue(conversations),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("detectSilentConversations", () => {
  it("emits 'unresponsive' for conversations silent > 72 hours", async () => {
    const outcomePipeline = {
      emitOutcome: vi.fn().mockResolvedValue({}),
    };

    const now = new Date();
    const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);

    const prisma = createMockPrisma([
      {
        threadId: "thread-1",
        organizationId: "org-1",
        status: "active",
        lastInboundAt: fourDaysAgo,
      },
    ]);

    await detectSilentConversations({
      prisma: prisma as never,
      outcomePipeline: outcomePipeline as never,
    });

    expect(outcomePipeline.emitOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "thread-1",
        organizationId: "org-1",
        outcomeType: "unresponsive",
      }),
    );
  });

  it("does NOT flag conversations with recent activity", async () => {
    const outcomePipeline = { emitOutcome: vi.fn().mockResolvedValue({}) };
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const prisma = createMockPrisma([
      {
        threadId: "thread-2",
        organizationId: "org-1",
        status: "active",
        lastInboundAt: oneHourAgo,
      },
    ]);

    await detectSilentConversations({
      prisma: prisma as never,
      outcomePipeline: outcomePipeline as never,
    });

    expect(outcomePipeline.emitOutcome).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/chat && ../../node_modules/.bin/vitest run src/jobs/__tests__/silence-detector.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `apps/chat/src/jobs/silence-detector.ts`:

```ts
import type { OutcomePipeline } from "@switchboard/core";

const SILENCE_THRESHOLD_MS = 72 * 60 * 60 * 1000; // 72 hours

export interface SilenceDetectorConfig {
  prisma: import("@switchboard/db").PrismaClient;
  outcomePipeline: OutcomePipeline;
  thresholdMs?: number;
}

export async function detectSilentConversations(config: SilenceDetectorConfig): Promise<number> {
  const { prisma, outcomePipeline, thresholdMs = SILENCE_THRESHOLD_MS } = config;
  const cutoff = new Date(Date.now() - thresholdMs);

  const silentConversations = await prisma.conversationState.findMany({
    where: {
      status: "active",
      lastInboundAt: { lt: cutoff },
    },
    select: { threadId: true, organizationId: true },
  });

  let emitted = 0;
  for (const conv of silentConversations) {
    if (!conv.organizationId) continue;
    try {
      await outcomePipeline.emitOutcome({
        sessionId: conv.threadId,
        organizationId: conv.organizationId,
        outcomeType: "unresponsive",
        metadata: { detectedBy: "silence_detector" },
      });
      // Mark conversation as completed so it's not re-detected
      await prisma.conversationState.update({
        where: { threadId: conv.threadId },
        data: { status: "completed" },
      });
      emitted++;
    } catch {
      // Non-critical — continue to next
    }
  }
  return emitted;
}

export function startSilenceDetector(
  config: SilenceDetectorConfig & { intervalMs?: number },
): () => void {
  const { intervalMs = 60 * 60 * 1000 } = config; // Default: every hour
  let stopped = false;

  const run = async () => {
    if (stopped) return;
    await detectSilentConversations(config);
  };

  const timer = setInterval(() => {
    run().catch((err) => console.error("[SilenceDetector] Error:", err));
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
```

**Step 4: Run test to verify it passes**

**Step 5: Wire into bootstrap**

In `apps/chat/src/bootstrap.ts`, after the cadence worker block (~line 475), add:

```ts
// Silence detector — flags conversations with 72h+ of inactivity as unresponsive
let stopSilenceDetector: (() => void) | null = null;
if (isLeadBot && process.env["DATABASE_URL"] && outcomeStore) {
  const { getDb } = await import("@switchboard/db");
  const { startSilenceDetector } = await import("./jobs/silence-detector.js");
  const { OutcomePipeline } = await import("@switchboard/core");
  stopSilenceDetector = startSilenceDetector({
    prisma: getDb(),
    outcomePipeline: new OutcomePipeline(outcomeStore),
    intervalMs: 60 * 60 * 1000, // Every hour
  });
}
```

Update cleanup function to call `stopSilenceDetector?.()`.

**Step 6: Commit**

```bash
git commit -m "feat: add silence-timeout detector for unresponsive lead tracking"
```

---

## Deliverable 3: Complete ConversionBus Funnel Events

**Problem:** The ConversionBus supports 5 event types (`inquiry`, `qualified`, `booked`, `purchased`, `completed`) but only `booked` is emitted from the lead bot. Meta CAPI needs `inquiry` (first contact) and `qualified` (signals captured) to optimize ad targeting for top-of-funnel events.

### Task 5: Emit `inquiry` event on first lead bot message

**Files:**

- Modify: `apps/chat/src/runtime.ts:340-392`
- Test: `apps/chat/src/handlers/__tests__/lead-handler.test.ts`

**Step 1: Write the failing test**

Add to `lead-handler.test.ts` a new describe block or add to the runtime test:

```ts
it("emits 'inquiry' to ConversionBus on first message in new conversation", async () => {
  // This test may need to be in a runtime-level test since the inquiry
  // happens at conversation creation time, not in the lead handler.
  // Alternatively, add inquiry emission at the start of handleLeadMessage
  // when the conversation has no messages yet.
});
```

**Note:** The `inquiry` event should fire when a new lead first messages. The best hook is in `runtime.ts` line 342-363 where `isNewConversation` is set to `true`. This fires before the lead bot path (line 384). Add the emission there.

**Step 2: Implementation**

In `apps/chat/src/runtime.ts`, after the welcome message is sent (around line 362), add:

```ts
// Emit inquiry event to ConversionBus for new lead bot conversations
if (this.isLeadBot && this.conversionBus) {
  this.conversionBus.emit({
    type: "inquiry",
    contactId: threadId,
    organizationId: message.organizationId ?? "default",
    value: 0,
    timestamp: new Date(),
    metadata: { channel: message.channel },
  });
}
```

**Step 3: Commit**

```bash
git commit -m "feat: emit 'inquiry' ConversionBus event on first lead bot contact"
```

---

### Task 6: Emit `qualified` event when qualification signals are captured

**Files:**

- Modify: `apps/chat/src/handlers/lead-handler.ts`
- Test: `apps/chat/src/handlers/__tests__/lead-handler.test.ts`

**Step 1: Write the failing test**

```ts
it("emits 'qualified' to ConversionBus when qualification completes regardless of score", async () => {
  mockRouter = {
    handleMessage: vi.fn().mockResolvedValue(
      mockRouterResponse({
        responses: ["Thanks for the info."],
        completed: true,
        variables: { leadScore: "35" },
        machineState: "qualified",
      }),
    ),
  } as unknown as ConversationRouter;

  await handleLeadMessage(ctx, mockRouter, createMockMessage(), "thread-1", null, {
    conversionBus,
  });

  expect(conversionBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "qualified" }));
});
```

**Step 2: Implementation**

In `lead-handler.ts`, in the `routerResponse.completed` block (around line 139), add before the cadence start:

```ts
// Emit qualified event to ConversionBus (fires for all completed qualifications)
if (deps?.conversionBus) {
  try {
    deps.conversionBus.emit({
      type: "qualified",
      contactId: threadId,
      organizationId: inbound.organizationId,
      value: leadScore,
      timestamp: new Date(),
      metadata: { leadScore },
    });
  } catch {
    // Non-critical
  }
}
```

**Step 3: Commit**

```bash
git commit -m "feat: emit 'qualified' ConversionBus event on qualification completion"
```

---

## Deliverable 4: Register All Conversation Flow Templates

**Problem:** 5 conversation flow templates exist in `cartridges/customer-engagement/src/conversation/templates/` but only `qualificationFlow` and `bookingFlow` are registered in `apps/chat/src/bootstrap.ts:420-422`. The `objectionHandlingFlow`, `reviewRequestFlow`, and `postTreatmentFlow` are unused, meaning the lead bot can't handle objections or post-service follow-ups.

### Task 7: Export and register all 5 flow templates

**Files:**

- Modify: `cartridges/customer-engagement/src/index.ts:116-117`
- Modify: `apps/chat/src/bootstrap.ts:416-432`
- Test: verify existing template tests pass

**Step 1: Add missing exports to customer-engagement index**

In `cartridges/customer-engagement/src/index.ts`, after line 117, add:

```ts
export { objectionHandlingFlow } from "./conversation/templates/objection-handling.js";
export { reviewRequestFlow } from "./conversation/templates/review-request.js";
export { postTreatmentFlow } from "./conversation/templates/post-treatment.js";
```

**Step 2: Register all flows in bootstrap**

In `apps/chat/src/bootstrap.ts`, update the imports around line 48-52 to include the new flows:

```ts
import {
  ConversationRouter,
  InMemorySessionStore,
  RedisSessionStore,
  qualificationFlow,
  bookingFlow,
  objectionHandlingFlow,
  reviewRequestFlow,
  postTreatmentFlow,
  resolveCadenceTemplates,
} from "@switchboard/customer-engagement";
```

Update the flows map around line 420-422:

```ts
leadRouter = new ConversationRouter({
  sessionStore,
  flows: new Map([
    [qualificationFlow.id, qualificationFlow],
    [bookingFlow.id, bookingFlow],
    [objectionHandlingFlow.id, objectionHandlingFlow],
    [reviewRequestFlow.id, reviewRequestFlow],
    [postTreatmentFlow.id, postTreatmentFlow],
  ]),
  defaultFlowId: qualificationFlow.id,
  faqs: resolvedProfile?.profile?.faqs,
  businessName: resolvedProfile?.profile?.name,
});
```

**Step 3: Run existing template tests**

Run: `cd cartridges/customer-engagement && ../../node_modules/.bin/vitest run src/conversation/__tests__/templates.test.ts`
Expected: PASS (templates already have tests)

**Step 4: Commit**

```bash
git commit -m "feat: register all 5 conversation flow templates in lead bot router"
```

---

## Deliverable 5: Conversation Thread Viewer (Dashboard)

**Problem:** Business owners have no way to see what their lead bot is saying to prospects. The dashboard has lead detail pages but no conversation transcript viewer.

### Task 8: Create conversation threads API endpoint

**Files:**

- Create: `apps/api/src/routes/conversations.ts`
- Test: `apps/api/src/routes/__tests__/conversations.test.ts`
- Modify: `apps/api/src/bootstrap/routes.ts` (register route)

**Step 1: Write the failing test**

Create `apps/api/src/routes/__tests__/conversations.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildConversationList, buildConversationDetail } from "../conversations.js";

describe("Conversations API", () => {
  it("returns paginated conversation list", async () => {
    const prisma = {
      conversationState: {
        findMany: vi.fn().mockResolvedValue([
          {
            threadId: "t1",
            channel: "telegram",
            principalId: "user-1",
            organizationId: "org-1",
            status: "active",
            messages: JSON.stringify([
              { role: "user", text: "Hi", timestamp: new Date().toISOString() },
              { role: "assistant", text: "Hello!", timestamp: new Date().toISOString() },
            ]),
            lastActivityAt: new Date(),
            firstReplyAt: new Date(),
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
    };

    const result = await buildConversationList(prisma as never, "org-1", { limit: 20, offset: 0 });

    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0].threadId).toBe("t1");
    expect(result.conversations[0].messageCount).toBe(2);
    expect(result.conversations[0].lastMessage).toBe("Hello!");
    expect(result.total).toBe(1);
  });

  it("returns full conversation with messages", async () => {
    const messages = [
      { role: "user", text: "Hi there", timestamp: new Date().toISOString() },
      { role: "assistant", text: "Welcome!", timestamp: new Date().toISOString() },
    ];
    const prisma = {
      conversationState: {
        findUnique: vi.fn().mockResolvedValue({
          threadId: "t1",
          channel: "whatsapp",
          principalId: "user-1",
          organizationId: "org-1",
          status: "active",
          messages: JSON.stringify(messages),
          lastActivityAt: new Date(),
          firstReplyAt: new Date(),
        }),
      },
    };

    const result = await buildConversationDetail(prisma as never, "org-1", "t1");

    expect(result).not.toBeNull();
    expect(result!.messages).toHaveLength(2);
    expect(result!.messages[0].role).toBe("user");
  });
});
```

**Step 2: Write implementation**

Create `apps/api/src/routes/conversations.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@switchboard/db";

interface ConversationListItem {
  threadId: string;
  channel: string;
  principalId: string;
  status: string;
  messageCount: number;
  lastMessage: string | null;
  lastActivityAt: string;
  firstReplyAt: string | null;
}

export async function buildConversationList(
  prisma: PrismaClient,
  organizationId: string,
  opts: { limit: number; offset: number; status?: string },
) {
  const where: Record<string, unknown> = { organizationId };
  if (opts.status) where["status"] = opts.status;

  const [conversations, total] = await Promise.all([
    prisma.conversationState.findMany({
      where,
      orderBy: { lastActivityAt: "desc" },
      take: opts.limit,
      skip: opts.offset,
    }),
    prisma.conversationState.count({ where }),
  ]);

  return {
    conversations: conversations.map((c) => {
      const msgs = parseMessages(c.messages);
      const lastMsg = msgs[msgs.length - 1];
      return {
        threadId: c.threadId,
        channel: c.channel,
        principalId: c.principalId,
        status: c.status,
        messageCount: msgs.length,
        lastMessage: lastMsg?.text ?? null,
        lastActivityAt: c.lastActivityAt.toISOString(),
        firstReplyAt: c.firstReplyAt?.toISOString() ?? null,
      } satisfies ConversationListItem;
    }),
    total,
  };
}

export async function buildConversationDetail(
  prisma: PrismaClient,
  organizationId: string,
  threadId: string,
) {
  const conv = await prisma.conversationState.findUnique({
    where: { threadId },
  });
  if (!conv || conv.organizationId !== organizationId) return null;

  return {
    threadId: conv.threadId,
    channel: conv.channel,
    principalId: conv.principalId,
    status: conv.status,
    messages: parseMessages(conv.messages),
    lastActivityAt: conv.lastActivityAt.toISOString(),
    firstReplyAt: conv.firstReplyAt?.toISOString() ?? null,
  };
}

function parseMessages(raw: unknown): Array<{ role: string; text: string; timestamp: string }> {
  try {
    if (typeof raw === "string") return JSON.parse(raw);
    if (Array.isArray(raw)) return raw as Array<{ role: string; text: string; timestamp: string }>;
    return [];
  } catch {
    return [];
  }
}

export async function conversationRoutes(app: FastifyInstance) {
  app.get("/api/conversations", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database not available" });

    const query = request.query as { limit?: string; offset?: string; status?: string };
    const orgId = (request as { organizationIdFromAuth?: string }).organizationIdFromAuth;
    if (!orgId) return reply.code(400).send({ error: "organizationId required" });

    const result = await buildConversationList(app.prisma, orgId, {
      limit: Math.min(parseInt(query.limit ?? "20", 10), 100),
      offset: parseInt(query.offset ?? "0", 10),
      status: query.status,
    });

    return reply.send(result);
  });

  app.get("/api/conversations/:threadId", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database not available" });

    const { threadId } = request.params as { threadId: string };
    const orgId = (request as { organizationIdFromAuth?: string }).organizationIdFromAuth;
    if (!orgId) return reply.code(400).send({ error: "organizationId required" });

    const result = await buildConversationDetail(app.prisma, orgId, threadId);
    if (!result) return reply.code(404).send({ error: "Conversation not found" });

    return reply.send(result);
  });
}
```

**Step 3: Register in routes bootstrap**

In `apps/api/src/bootstrap/routes.ts`, import and register `conversationRoutes`.

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git commit -m "feat: add conversations API endpoints for thread listing and detail"
```

---

### Task 9: Create dashboard conversations page

**Files:**

- Create: `apps/dashboard/src/app/conversations/page.tsx`
- Create: `apps/dashboard/src/hooks/use-conversations.ts`

**Step 1: Create the data hook**

Create `apps/dashboard/src/hooks/use-conversations.ts`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface ConversationListItem {
  threadId: string;
  channel: string;
  principalId: string;
  status: string;
  messageCount: number;
  lastMessage: string | null;
  lastActivityAt: string;
  firstReplyAt: string | null;
}

interface ConversationDetail {
  threadId: string;
  channel: string;
  principalId: string;
  status: string;
  messages: Array<{ role: string; text: string; timestamp: string }>;
  lastActivityAt: string;
  firstReplyAt: string | null;
}

export function useConversations(status?: string) {
  return useQuery({
    queryKey: [...queryKeys.conversations.list(), status],
    queryFn: async (): Promise<{ conversations: ConversationListItem[]; total: number }> => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const res = await fetch(`/api/dashboard/conversations?${params}`);
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return res.json();
    },
    refetchInterval: 30_000,
  });
}

export function useConversationDetail(threadId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.conversations.detail(), threadId],
    queryFn: async (): Promise<ConversationDetail> => {
      const res = await fetch(`/api/dashboard/conversations/${threadId}`);
      if (!res.ok) throw new Error("Failed to fetch conversation");
      return res.json();
    },
    enabled: !!threadId,
  });
}
```

**Note:** Check `apps/dashboard/src/lib/query-keys.ts` for the existing pattern and add `conversations` keys. If it uses a factory pattern, add:

```ts
conversations: {
  list: () => ["conversations", "list"] as const,
  detail: () => ["conversations", "detail"] as const,
},
```

**Step 2: Create the conversations page**

Create `apps/dashboard/src/app/conversations/page.tsx` with:

- List view showing recent conversations (thread ID, channel icon, status badge, last message preview, time)
- Click to expand shows full message thread in a chat-bubble layout
- Filter by status (active, completed, expired)
- Auto-refresh every 30 seconds

Follow the existing page patterns from `apps/dashboard/src/app/results/page.tsx` for:

- Session auth guard
- Skeleton loading state
- Section/tile layout using existing design tokens

**Step 3: Commit**

```bash
git commit -m "feat: add conversation thread viewer to dashboard"
```

---

## Implementation Order

```
Phase 1 (parallel — outcome tracking):
  ├── Task 1: Emit 'lost' outcome for low-score completions
  ├── Task 4: Create silence-timeout detector (unresponsive)
  └── Task 7: Register all 5 conversation flows

Phase 2 (sequential — depends on Phase 1):
  ├── Task 2: Emit 'escalated_resolved' on human release
  ├── Task 3: Emit 'reactivated' on dormant lead re-engagement
  ├── Task 5: Emit 'inquiry' ConversionBus event
  └── Task 6: Emit 'qualified' ConversionBus event

Phase 3 (parallel — dashboard):
  ├── Task 8: Conversations API endpoint
  └── Task 9: Dashboard conversations page
```

## Verification

After all tasks:

1. `cd apps/api && ../../node_modules/.bin/vitest run` — all API tests pass
2. `cd apps/chat && ../../node_modules/.bin/vitest run` — all chat tests pass
3. `./node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json` — no type errors
4. `./node_modules/.bin/tsc --noEmit -p apps/chat/tsconfig.json` — no type errors
5. `./node_modules/.bin/tsc --noEmit -p apps/dashboard/tsconfig.json` — no type errors

## Files Summary

| Action | File                                                    | Task           |
| ------ | ------------------------------------------------------- | -------------- |
| MODIFY | `apps/chat/src/handlers/lead-handler.ts`                | T1, T2, T3, T6 |
| MODIFY | `apps/chat/src/handlers/__tests__/lead-handler.test.ts` | T1, T2, T3, T6 |
| MODIFY | `apps/chat/src/runtime.ts`                              | T5             |
| CREATE | `apps/chat/src/jobs/silence-detector.ts`                | T4             |
| CREATE | `apps/chat/src/jobs/__tests__/silence-detector.test.ts` | T4             |
| MODIFY | `apps/chat/src/bootstrap.ts`                            | T4, T7         |
| MODIFY | `cartridges/customer-engagement/src/index.ts`           | T7             |
| CREATE | `apps/api/src/routes/conversations.ts`                  | T8             |
| CREATE | `apps/api/src/routes/__tests__/conversations.test.ts`   | T8             |
| MODIFY | `apps/api/src/bootstrap/routes.ts`                      | T8             |
| CREATE | `apps/dashboard/src/app/conversations/page.tsx`         | T9             |
| CREATE | `apps/dashboard/src/hooks/use-conversations.ts`         | T9             |
| MODIFY | `apps/dashboard/src/lib/query-keys.ts`                  | T9             |
