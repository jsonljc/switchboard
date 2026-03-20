# Phase 2: Messaging Cartridge + Conversation Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared conversational infrastructure layer — messaging cartridge, conversation routing, event loop targeting, and WhatsApp plumbing — with no LLM integration yet.

**Architecture:** A new `cartridges/messaging/` cartridge defines WhatsApp send/template/escalation actions following the existing cartridge pattern. The `ConversationRouter` is a pre-processing transform in `packages/agents/` that stamps `metadata.targetAgentId` on `message.received` events based on contact lifecycle stage. The `EventLoop` gains targetAgentId-aware filtering. A `ConversationStore` interface in `packages/core/` provides the persistence contract. WhatsApp rate limiting, opt-out handling, and escalation routing complete the plumbing layer.

**Tech Stack:** TypeScript (ESM), Vitest, Zod schemas, existing cartridge-sdk/core/agents packages

**Design Spec:** `docs/superpowers/specs/2026-03-20-switchboard-product-vision-design.md` (Section 5)

---

## File Structure

### New Files

| File                                                           | Responsibility                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/core/src/conversation-store.ts`                      | `ConversationStore` interface + `Message` / `LifecycleStage` types            |
| `packages/core/src/__tests__/conversation-store.test.ts`       | Type-level tests for the interface                                            |
| `packages/core/src/embedding-adapter.ts`                       | `EmbeddingAdapter` interface (Layer 3, used in Phase 3)                       |
| `packages/core/src/__tests__/embedding-adapter.test.ts`        | Type-level tests for the interface                                            |
| `packages/agents/src/conversation-router.ts`                   | Pre-processing transform: stamps `targetAgentId` on `message.received` events |
| `packages/agents/src/__tests__/conversation-router.test.ts`    | Tests for conversation routing logic                                          |
| `packages/agents/src/__tests__/event-loop-targeting.test.ts`   | Dedicated 6-case test suite for `targetAgentId` filtering                     |
| `cartridges/messaging/package.json`                            | Package config                                                                |
| `cartridges/messaging/tsconfig.json`                           | TypeScript config                                                             |
| `cartridges/messaging/vitest.config.ts`                        | Vitest config                                                                 |
| `cartridges/messaging/src/index.ts`                            | Barrel exports                                                                |
| `cartridges/messaging/src/manifest.ts`                         | Action definitions + cartridge manifest                                       |
| `cartridges/messaging/src/defaults/guardrails.ts`              | Default guardrails (rate limits, cooldowns)                                   |
| `cartridges/messaging/src/defaults/policies.ts`                | Default policies                                                              |
| `cartridges/messaging/src/__tests__/manifest.test.ts`          | Manifest validation tests                                                     |
| `cartridges/messaging/src/rate-limiter.ts`                     | Queue-based WhatsApp rate limiting                                            |
| `cartridges/messaging/src/__tests__/rate-limiter.test.ts`      | Rate limiter tests                                                            |
| `cartridges/messaging/src/opt-out.ts`                          | Opt-out keyword detection + suppression                                       |
| `cartridges/messaging/src/__tests__/opt-out.test.ts`           | Opt-out tests                                                                 |
| `cartridges/messaging/src/escalation-router.ts`                | Owner reply matching (4-step)                                                 |
| `cartridges/messaging/src/__tests__/escalation-router.test.ts` | Escalation router tests                                                       |

### Modified Files

| File                                                   | Change                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `packages/agents/src/events.ts`                        | Add `message.received`, `message.sent`, `escalation.owner_replied` to `AGENT_EVENT_TYPES` |
| `packages/agents/src/agents/lead-responder/port.ts`    | Add `message.received` to `inboundEvents`                                                 |
| `packages/agents/src/agents/lead-responder/handler.ts` | Handle `message.received` in addition to `lead.received`                                  |
| `packages/agents/src/agents/sales-closer/port.ts`      | Add `message.received` to `inboundEvents`                                                 |
| `packages/agents/src/agents/sales-closer/handler.ts`   | Handle `message.received` in addition to `lead.qualified`                                 |
| `packages/agents/src/event-loop.ts`                    | Add `targetAgentId` filtering in `processRecursive()`                                     |
| `packages/agents/src/index.ts`                         | Export `ConversationRouter` + new types                                                   |
| `packages/core/src/index.ts`                           | Export `ConversationStore` interface + types                                              |
| `packages/agents/src/lifecycle.ts`                     | Export stage-to-agent mapping function                                                    |
| `packages/agents/src/__tests__/lifecycle.test.ts`      | Add tests for `agentForStage` function                                                    |

---

## Task 1: Extend AGENT_EVENT_TYPES

**Files:**

- Modify: `packages/agents/src/events.ts`
- Modify: `packages/agents/src/__tests__/events.test.ts`

- [ ] **Step 1: Update the events test to expect new event types**

Add assertions for the 3 new event types in the existing test file:

```typescript
// In the existing "includes all expected event types" test, add:
expect(AGENT_EVENT_TYPES).toContain("message.received");
expect(AGENT_EVENT_TYPES).toContain("message.sent");
expect(AGENT_EVENT_TYPES).toContain("escalation.owner_replied");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/agents test -- --reporter verbose src/__tests__/events.test.ts`
Expected: FAIL — new event types not found

- [ ] **Step 3: Add the 3 new event types to AGENT_EVENT_TYPES**

In `packages/agents/src/events.ts`, add to the `AGENT_EVENT_TYPES` array:

```typescript
export const AGENT_EVENT_TYPES = [
  "lead.received",
  "lead.qualified",
  "lead.disqualified",
  "stage.advanced",
  "stage.reverted",
  "revenue.recorded",
  "revenue.attributed",
  "ad.optimized",
  "ad.anomaly_detected",
  "ad.performance_review",
  "conversation.escalated",
  "message.received",
  "message.sent",
  "escalation.owner_replied",
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/agents test -- --reporter verbose src/__tests__/events.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(agents): add message.received, message.sent, escalation.owner_replied event types
```

---

## Task 2: ConversationStore Interface in packages/core

**Files:**

- Create: `packages/core/src/conversation-store.ts`
- Create: `packages/core/src/__tests__/conversation-store.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the test for ConversationStore**

Create `packages/core/src/__tests__/conversation-store.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { ConversationStore, Message, LifecycleStage } from "../conversation-store.js";

describe("ConversationStore interface", () => {
  it("can be implemented with an in-memory store", async () => {
    const history = new Map<string, Message[]>();
    const stages = new Map<string, LifecycleStage>();
    const optOuts = new Set<string>();

    const store: ConversationStore = {
      async getHistory(contactId: string): Promise<Message[]> {
        return history.get(contactId) ?? [];
      },
      async appendMessage(contactId: string, message: Message): Promise<void> {
        const msgs = history.get(contactId) ?? [];
        msgs.push(message);
        history.set(contactId, msgs);
      },
      async getStage(contactId: string): Promise<LifecycleStage> {
        return stages.get(contactId) ?? "lead";
      },
      async setStage(contactId: string, stage: LifecycleStage): Promise<void> {
        stages.set(contactId, stage);
      },
      async isOptedOut(contactId: string): Promise<boolean> {
        return optOuts.has(contactId);
      },
      async setOptOut(contactId: string, optedOut: boolean): Promise<void> {
        if (optedOut) {
          optOuts.add(contactId);
        } else {
          optOuts.delete(contactId);
        }
      },
    };

    // Test appendMessage + getHistory
    await store.appendMessage("c1", {
      id: "m1",
      contactId: "c1",
      direction: "inbound",
      content: "Hello",
      timestamp: new Date().toISOString(),
      channel: "whatsapp",
    });
    const msgs = await store.getHistory("c1");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe("Hello");

    // Test setStage + getStage
    expect(await store.getStage("c1")).toBe("lead");
    await store.setStage("c1", "qualified");
    expect(await store.getStage("c1")).toBe("qualified");

    // Test opt-out
    expect(await store.isOptedOut("c1")).toBe(false);
    await store.setOptOut("c1", true);
    expect(await store.isOptedOut("c1")).toBe(true);
    await store.setOptOut("c1", false);
    expect(await store.isOptedOut("c1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --reporter verbose src/__tests__/conversation-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the ConversationStore interface**

Create `packages/core/src/conversation-store.ts`:

```typescript
// ---------------------------------------------------------------------------
// Conversation Store — persistence interface for conversation state
// ---------------------------------------------------------------------------

export type LifecycleStage = "lead" | "qualified" | "booked" | "treated" | "churned";

export interface Message {
  id: string;
  contactId: string;
  direction: "inbound" | "outbound";
  content: string;
  timestamp: string;
  channel: "whatsapp" | "telegram" | "dashboard";
  metadata?: Record<string, unknown>;
}

export interface ConversationStore {
  getHistory(contactId: string): Promise<Message[]>;
  appendMessage(contactId: string, message: Message): Promise<void>;
  getStage(contactId: string): Promise<LifecycleStage>;
  setStage(contactId: string, stage: LifecycleStage): Promise<void>;
  isOptedOut(contactId: string): Promise<boolean>;
  setOptOut(contactId: string, optedOut: boolean): Promise<void>;
}
```

- [ ] **Step 4: Export from core barrel**

Add to `packages/core/src/index.ts`:

```typescript
export type {
  ConversationStore,
  Message,
  LifecycleStage as ConversationLifecycleStage,
} from "./conversation-store.js";
```

Note: Export `LifecycleStage` as `ConversationLifecycleStage` to avoid collision with the existing `LifecycleStage` in `packages/agents/src/lifecycle.ts`. The agents package already has its own `LifecycleStage` type — they are identical but live in different packages for layer compliance reasons.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --reporter verbose src/__tests__/conversation-store.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat(core): add ConversationStore interface with Message and LifecycleStage types
```

---

## Task 2b: EmbeddingAdapter Interface in packages/core

**Files:**

- Create: `packages/core/src/embedding-adapter.ts`
- Create: `packages/core/src/__tests__/embedding-adapter.test.ts`
- Modify: `packages/core/src/index.ts`

The spec places this in Phase 2 for layer compliance. The interface is consumed in Phase 3.

- [ ] **Step 1: Write the test**

Create `packages/core/src/__tests__/embedding-adapter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { EmbeddingAdapter } from "../embedding-adapter.js";

describe("EmbeddingAdapter interface", () => {
  it("can be implemented with a mock adapter", async () => {
    const adapter: EmbeddingAdapter = {
      dimensions: 1024,
      async embed(text: string): Promise<number[]> {
        return new Array(1024).fill(0).map(() => Math.random());
      },
      async embedBatch(texts: string[]): Promise<number[][]> {
        return texts.map(() => new Array(1024).fill(0).map(() => Math.random()));
      },
    };

    const result = await adapter.embed("hello");
    expect(result).toHaveLength(1024);

    const batchResult = await adapter.embedBatch(["a", "b"]);
    expect(batchResult).toHaveLength(2);
    expect(batchResult[0]).toHaveLength(1024);

    expect(adapter.dimensions).toBe(1024);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --reporter verbose src/__tests__/embedding-adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the EmbeddingAdapter interface**

Create `packages/core/src/embedding-adapter.ts`:

```typescript
// ---------------------------------------------------------------------------
// Embedding Adapter — provider-agnostic embedding interface
// ---------------------------------------------------------------------------

export interface EmbeddingAdapter {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}
```

- [ ] **Step 4: Export from core barrel**

Add to `packages/core/src/index.ts`:

```typescript
export type { EmbeddingAdapter } from "./embedding-adapter.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --reporter verbose src/__tests__/embedding-adapter.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat(core): add EmbeddingAdapter interface for provider-agnostic embeddings
```

---

## Task 3: Update Lead Responder Port + Handler

**Files:**

- Modify: `packages/agents/src/agents/lead-responder/port.ts`
- Modify: `packages/agents/src/agents/lead-responder/handler.ts`
- Modify: `packages/agents/src/agents/lead-responder/__tests__/port.test.ts`
- Modify: `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts`

- [ ] **Step 1: Update port test to expect message.received**

In `packages/agents/src/agents/lead-responder/__tests__/port.test.ts`, add or update:

```typescript
it("accepts message.received event", () => {
  expect(LEAD_RESPONDER_PORT.inboundEvents).toContain("message.received");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/agents test -- --reporter verbose src/agents/lead-responder/__tests__/port.test.ts`
Expected: FAIL

- [ ] **Step 3: Add message.received to Lead Responder port**

In `packages/agents/src/agents/lead-responder/port.ts`, change:

```typescript
inboundEvents: ["lead.received"],
```

to:

```typescript
inboundEvents: ["lead.received", "message.received"],
```

- [ ] **Step 4: Run port test to verify it passes**

Run: `pnpm --filter @switchboard/agents test -- --reporter verbose src/agents/lead-responder/__tests__/port.test.ts`
Expected: PASS

- [ ] **Step 5: Update handler test for message.received**

In `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts`, add a test:

```typescript
it("handles message.received by scoring and qualifying", async () => {
  const handler = new LeadResponderHandler({
    scoreLead: () => ({ score: 80, tier: "hot" as const, factors: [] }),
  });

  const event = createEventEnvelope({
    organizationId: "org-1",
    eventType: "message.received",
    source: { type: "webhook", id: "whatsapp" },
    payload: { contactId: "c1", messageText: "I want a consultation" },
  });

  const result = await handler.handle(event, {}, { organizationId: "org-1" });

  expect(result.events.length).toBeGreaterThanOrEqual(1);
  expect(result.events[0]!.eventType).toBe("lead.qualified");
});
```

- [ ] **Step 6: Update handler to accept message.received**

In `packages/agents/src/agents/lead-responder/handler.ts`, change the guard at the top of `handle()`:

```typescript
if (event.eventType !== "lead.received" && event.eventType !== "message.received") {
  return { events: [], actions: [] };
}
```

- [ ] **Step 7: Run handler tests**

Run: `pnpm --filter @switchboard/agents test -- --reporter verbose src/agents/lead-responder/__tests__/handler.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```
feat(agents): add message.received to Lead Responder port and handler
```

---

## Task 4: Update Sales Closer Port + Handler

**Files:**

- Modify: `packages/agents/src/agents/sales-closer/port.ts`
- Modify: `packages/agents/src/agents/sales-closer/handler.ts`
- Modify: `packages/agents/src/agents/sales-closer/__tests__/port.test.ts`
- Modify: `packages/agents/src/agents/sales-closer/__tests__/handler.test.ts`

- [ ] **Step 1: Update port test**

In `packages/agents/src/agents/sales-closer/__tests__/port.test.ts`, add:

```typescript
it("accepts message.received event", () => {
  expect(SALES_CLOSER_PORT.inboundEvents).toContain("message.received");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/agents test -- --reporter verbose src/agents/sales-closer/__tests__/port.test.ts`
Expected: FAIL

- [ ] **Step 3: Add message.received to Sales Closer port**

In `packages/agents/src/agents/sales-closer/port.ts`, change:

```typescript
inboundEvents: ["lead.qualified"],
```

to:

```typescript
inboundEvents: ["lead.qualified", "message.received"],
```

- [ ] **Step 4: Run port test**

Run: `pnpm --filter @switchboard/agents test -- --reporter verbose src/agents/sales-closer/__tests__/port.test.ts`
Expected: PASS

- [ ] **Step 5: Update handler test for message.received**

In `packages/agents/src/agents/sales-closer/__tests__/handler.test.ts`, add:

```typescript
it("handles message.received the same as lead.qualified", async () => {
  const handler = new SalesCloserHandler();

  const event = createEventEnvelope({
    organizationId: "org-1",
    eventType: "message.received",
    source: { type: "webhook", id: "whatsapp" },
    payload: { contactId: "c1" },
  });

  const context = {
    organizationId: "org-1",
    profile: { booking: { bookingUrl: "https://book.example.com" } },
  };

  const result = await handler.handle(event, {}, context);

  expect(result.events.some((e) => e.eventType === "stage.advanced")).toBe(true);
});
```

- [ ] **Step 6: Update handler to accept message.received**

In `packages/agents/src/agents/sales-closer/handler.ts`, change:

```typescript
if (event.eventType !== "lead.qualified") {
  return { events: [], actions: [] };
}
```

to:

```typescript
if (event.eventType !== "lead.qualified" && event.eventType !== "message.received") {
  return { events: [], actions: [] };
}
```

- [ ] **Step 7: Run handler tests**

Run: `pnpm --filter @switchboard/agents test -- --reporter verbose src/agents/sales-closer/__tests__/handler.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```
feat(agents): add message.received to Sales Closer port and handler
```

---

## Task 5: EventLoop targetAgentId Filtering

**Files:**

- Modify: `packages/agents/src/event-loop.ts`
- Create: `packages/agents/src/__tests__/event-loop-targeting.test.ts`

This is a load-bearing change. The spec defines exactly 6 required test cases.

- [ ] **Step 1: Write the dedicated targeting test suite**

Create `packages/agents/src/__tests__/event-loop-targeting.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { EventLoop } from "../event-loop.js";
import { AgentRegistry } from "../registry.js";
import { AgentRouter } from "../router.js";
import { PolicyBridge } from "../policy-bridge.js";
import { InMemoryDeliveryStore } from "../delivery-store.js";
import { HandlerRegistry } from "../handler-registry.js";
import { ActionExecutor } from "../action-executor.js";
import { createEventEnvelope } from "../events.js";
import type { AgentHandler, AgentContext, AgentResponse } from "../ports.js";
import type { RoutedEventEnvelope } from "../events.js";

function makeHandler(fn: (event: RoutedEventEnvelope) => AgentResponse): AgentHandler {
  return {
    handle: vi.fn(
      async (event: RoutedEventEnvelope, _config: Record<string, unknown>, _ctx: AgentContext) =>
        fn(event),
    ),
  };
}

function buildLoop(registry: AgentRegistry, handlers: HandlerRegistry): EventLoop {
  return new EventLoop({
    router: new AgentRouter(registry),
    registry,
    handlers,
    actionExecutor: new ActionExecutor(),
    policyBridge: new PolicyBridge(null),
    deliveryStore: new InMemoryDeliveryStore(),
  });
}

describe("EventLoop targetAgentId filtering", () => {
  it("routes message.received with targetAgentId=lead-responder only to Lead Responder", async () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["message.received"], emits: [], tools: [] },
    });
    registry.register("org-1", {
      agentId: "sales-closer",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["message.received"], emits: [], tools: [] },
    });

    const handlers = new HandlerRegistry();
    const lrHandler = makeHandler(() => ({ events: [], actions: [] }));
    const scHandler = makeHandler(() => ({ events: [], actions: [] }));
    handlers.register("lead-responder", lrHandler);
    handlers.register("sales-closer", scHandler);

    const loop = buildLoop(registry, handlers);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c1" },
      metadata: { targetAgentId: "lead-responder" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]!.agentId).toBe("lead-responder");
    expect(scHandler.handle).not.toHaveBeenCalled();
  });

  it("routes message.received with targetAgentId=sales-closer only to Sales Closer", async () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["message.received"], emits: [], tools: [] },
    });
    registry.register("org-1", {
      agentId: "sales-closer",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["message.received"], emits: [], tools: [] },
    });

    const handlers = new HandlerRegistry();
    const lrHandler = makeHandler(() => ({ events: [], actions: [] }));
    const scHandler = makeHandler(() => ({ events: [], actions: [] }));
    handlers.register("lead-responder", lrHandler);
    handlers.register("sales-closer", scHandler);

    const loop = buildLoop(registry, handlers);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c1" },
      metadata: { targetAgentId: "sales-closer" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]!.agentId).toBe("sales-closer");
    expect(lrHandler.handle).not.toHaveBeenCalled();
  });

  it("routes lead.received with NO targetAgentId to all matching agents (existing behavior)", async () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["lead.received"], emits: [], tools: [] },
    });

    const handlers = new HandlerRegistry();
    const handler = makeHandler(() => ({ events: [], actions: [] }));
    handlers.register("lead-responder", handler);

    const loop = buildLoop(registry, handlers);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: { contactId: "c1" },
      // No metadata.targetAgentId
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]!.agentId).toBe("lead-responder");
  });

  it("routes to manual_queue when targetAgentId is a nonexistent agent", async () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["message.received"], emits: [], tools: [] },
    });

    const handlers = new HandlerRegistry();
    handlers.register(
      "lead-responder",
      makeHandler(() => ({ events: [], actions: [] })),
    );

    const loop = buildLoop(registry, handlers);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c1" },
      metadata: { targetAgentId: "nonexistent-agent" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    // Should not process any agent — the router will find agents but
    // targetAgentId filtering will skip them all. The event effectively
    // goes unprocessed (manual_queue routing happens at the Router level).
    expect(result.processed).toHaveLength(0);
  });

  it("routes to manual_queue when targetAgentId agent is disabled", async () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "disabled",
      config: {},
      capabilities: { accepts: ["message.received"], emits: [], tools: [] },
    });

    const handlers = new HandlerRegistry();
    handlers.register(
      "lead-responder",
      makeHandler(() => ({ events: [], actions: [] })),
    );

    const loop = buildLoop(registry, handlers);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c1" },
      metadata: { targetAgentId: "lead-responder" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    // Disabled agents are filtered out by findByInboundEvent (listActive),
    // so nothing processes
    expect(result.processed).toHaveLength(0);
  });

  it("does NOT inherit targetAgentId in recursive output events", async () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["message.received"], emits: ["lead.qualified"], tools: [] },
    });
    registry.register("org-1", {
      agentId: "sales-closer",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["lead.qualified"], emits: [], tools: [] },
    });

    const handlers = new HandlerRegistry();
    handlers.register(
      "lead-responder",
      makeHandler((event) => ({
        events: [
          createEventEnvelope({
            organizationId: event.organizationId,
            eventType: "lead.qualified",
            source: { type: "agent", id: "lead-responder" },
            payload: { contactId: "c1", score: 80 },
            correlationId: event.correlationId,
            causationId: event.eventId,
            // No targetAgentId in output event metadata
          }),
        ],
        actions: [],
      })),
    );
    const scHandler = makeHandler(() => ({ events: [], actions: [] }));
    handlers.register("sales-closer", scHandler);

    const loop = buildLoop(registry, handlers);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c1" },
      metadata: { targetAgentId: "lead-responder" },
    });

    const result = await loop.process(event, { organizationId: "org-1" });

    // Lead Responder processes targeted event, emits lead.qualified
    // Sales Closer processes lead.qualified (no targetAgentId → routes normally)
    expect(result.processed).toHaveLength(2);
    expect(result.processed[0]!.agentId).toBe("lead-responder");
    expect(result.processed[1]!.agentId).toBe("sales-closer");
    expect(scHandler.handle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/agents test -- --reporter verbose src/__tests__/event-loop-targeting.test.ts`
Expected: FAIL — targeting tests fail because EventLoop doesn't filter by targetAgentId yet

- [ ] **Step 3: Implement targetAgentId filtering in EventLoop**

In `packages/agents/src/event-loop.ts`, inside `processRecursive()`, add the filtering logic right after the `registryEntry` lookup (after line 101 in the current file). Add inside the `for (const dest of plan.destinations)` loop, after the `if (!registryEntry)` check:

```typescript
// targetAgentId filtering: skip agents that don't match the target
const targetAgentId = event.metadata?.targetAgentId as string | undefined;
if (targetAgentId && dest.type === "agent" && dest.id !== targetAgentId) {
  continue;
}
```

This goes right after the existing `if (!registryEntry) { continue; }` block (around line 101).

- [ ] **Step 4: Run the targeting tests**

Run: `pnpm --filter @switchboard/agents test -- --reporter verbose src/__tests__/event-loop-targeting.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Run existing event loop tests to verify no regression**

Run: `pnpm --filter @switchboard/agents test -- --reporter verbose src/__tests__/event-loop.test.ts`
Expected: PASS (all existing tests still pass)

- [ ] **Step 6: Commit**

```
feat(agents): add targetAgentId filtering to EventLoop.processRecursive()
```

---

## Task 6: ConversationRouter

**Files:**

- Create: `packages/agents/src/conversation-router.ts`
- Create: `packages/agents/src/__tests__/conversation-router.test.ts`
- Modify: `packages/agents/src/lifecycle.ts`

- [ ] **Step 1: Add stage-to-agent mapping in lifecycle.ts**

In `packages/agents/src/lifecycle.ts`, add:

```typescript
const STAGE_TO_AGENT: Record<LifecycleStage, string | null> = {
  lead: "lead-responder",
  qualified: "sales-closer",
  booked: null, // escalate to owner
  treated: null, // escalate to owner
  churned: null, // escalate to owner
};

export function agentForStage(stage: LifecycleStage | undefined): string | null {
  if (!stage) return "lead-responder";
  return STAGE_TO_AGENT[stage];
}
```

- [ ] **Step 1b: Write agentForStage unit tests**

In `packages/agents/src/__tests__/lifecycle.test.ts`, add tests for the new function:

```typescript
import { agentForStage } from "../lifecycle.js";

describe("agentForStage", () => {
  it("maps lead to lead-responder", () => {
    expect(agentForStage("lead")).toBe("lead-responder");
  });

  it("maps qualified to sales-closer", () => {
    expect(agentForStage("qualified")).toBe("sales-closer");
  });

  it("maps booked to null (escalate)", () => {
    expect(agentForStage("booked")).toBeNull();
  });

  it("maps treated to null (escalate)", () => {
    expect(agentForStage("treated")).toBeNull();
  });

  it("maps churned to null (escalate)", () => {
    expect(agentForStage("churned")).toBeNull();
  });

  it("defaults undefined to lead-responder", () => {
    expect(agentForStage(undefined)).toBe("lead-responder");
  });
});
```

- [ ] **Step 1c: Run lifecycle tests to verify agentForStage tests fail**

Run: `pnpm --filter @switchboard/agents test -- --reporter verbose src/__tests__/lifecycle.test.ts`
Expected: FAIL — `agentForStage` not found

- [ ] **Step 2: Write conversation router tests**

Create `packages/agents/src/__tests__/conversation-router.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { ConversationRouter } from "../conversation-router.js";
import { createEventEnvelope } from "../events.js";
import type { RoutedEventEnvelope } from "../events.js";

function makeStore(stages: Record<string, string>) {
  return {
    getStage: vi.fn(async (contactId: string) => stages[contactId] ?? "lead"),
  };
}

describe("ConversationRouter", () => {
  it("stamps targetAgentId=lead-responder for lead stage contacts", async () => {
    const store = makeStore({ c1: "lead" });
    const router = new ConversationRouter({ getStage: store.getStage });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c1" },
    });

    const result = await router.transform(event);

    expect(result.metadata?.targetAgentId).toBe("lead-responder");
    expect(store.getStage).toHaveBeenCalledWith("c1");
  });

  it("stamps targetAgentId=sales-closer for qualified stage contacts", async () => {
    const store = makeStore({ c1: "qualified" });
    const router = new ConversationRouter({ getStage: store.getStage });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c1" },
    });

    const result = await router.transform(event);

    expect(result.metadata?.targetAgentId).toBe("sales-closer");
  });

  it("emits escalation for booked/treated/churned contacts", async () => {
    const store = makeStore({ c1: "booked" });
    const router = new ConversationRouter({ getStage: store.getStage });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c1" },
    });

    const result = await router.transform(event);

    expect(result.metadata?.escalateToOwner).toBe(true);
    expect(result.metadata?.targetAgentId).toBeUndefined();
  });

  it("defaults unknown contacts to lead-responder", async () => {
    const store = makeStore({});
    const router = new ConversationRouter({ getStage: store.getStage });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "unknown" },
    });

    const result = await router.transform(event);

    expect(result.metadata?.targetAgentId).toBe("lead-responder");
  });

  it("passes through non-message.received events unchanged", async () => {
    const store = makeStore({});
    const router = new ConversationRouter({ getStage: store.getStage });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: { contactId: "c1" },
    });

    const result = await router.transform(event);

    expect(result).toBe(event); // exact same reference, not transformed
    expect(store.getStage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/agents test -- --reporter verbose src/__tests__/conversation-router.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement ConversationRouter**

Create `packages/agents/src/conversation-router.ts`:

```typescript
// ---------------------------------------------------------------------------
// Conversation Router — pre-processing transform for message.received events
// ---------------------------------------------------------------------------

import type { RoutedEventEnvelope } from "./events.js";
import { agentForStage } from "./lifecycle.js";
import type { LifecycleStage } from "./lifecycle.js";

export interface StageResolver {
  getStage(contactId: string): Promise<LifecycleStage | undefined>;
}

export interface ConversationRouterConfig {
  getStage: (contactId: string) => Promise<LifecycleStage | undefined>;
}

export class ConversationRouter {
  private getStage: (contactId: string) => Promise<LifecycleStage | undefined>;

  constructor(config: ConversationRouterConfig) {
    this.getStage = config.getStage;
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

    const stage = await this.getStage(contactId);
    const targetAgent = agentForStage(stage as LifecycleStage | undefined);

    if (targetAgent) {
      return {
        ...event,
        metadata: { ...event.metadata, targetAgentId: targetAgent },
      };
    }

    // No agent handles this stage — mark for owner escalation
    return {
      ...event,
      metadata: { ...event.metadata, escalateToOwner: true },
    };
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @switchboard/agents test -- --reporter verbose src/__tests__/conversation-router.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat(agents): add ConversationRouter with stage-based targetAgentId stamping
```

---

## Task 7: Messaging Cartridge Scaffold

**Files:**

- Create: `cartridges/messaging/package.json`
- Create: `cartridges/messaging/tsconfig.json`
- Create: `cartridges/messaging/vitest.config.ts`
- Create: `cartridges/messaging/src/manifest.ts`
- Create: `cartridges/messaging/src/defaults/guardrails.ts`
- Create: `cartridges/messaging/src/defaults/policies.ts`
- Create: `cartridges/messaging/src/index.ts`
- Create: `cartridges/messaging/src/__tests__/manifest.test.ts`

- [ ] **Step 1: Create package.json**

Create `cartridges/messaging/package.json`:

```json
{
  "name": "@switchboard/messaging",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run",
    "lint": "eslint src --ext .ts",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@switchboard/schemas": "workspace:*",
    "@switchboard/cartridge-sdk": "workspace:*",
    "@switchboard/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `cartridges/messaging/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

Create `cartridges/messaging/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
  },
});
```

- [ ] **Step 4: Create manifest.ts**

Create `cartridges/messaging/src/manifest.ts`:

```typescript
// ---------------------------------------------------------------------------
// Messaging Cartridge — Action Manifest
// ---------------------------------------------------------------------------

import type { ActionDefinition } from "@switchboard/schemas";

export const MESSAGING_ACTIONS: ActionDefinition[] = [
  {
    actionType: "messaging.whatsapp.send",
    name: "Send WhatsApp Message",
    description: "Send a WhatsApp message to a contact.",
    parametersSchema: {
      contactId: { type: "string" },
      phoneNumber: { type: "string" },
      message: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
  {
    actionType: "messaging.whatsapp.send_template",
    name: "Send WhatsApp Template Message",
    description:
      "Send a WhatsApp template message (for first-contact or 24h+ window re-engagement).",
    parametersSchema: {
      contactId: { type: "string" },
      phoneNumber: { type: "string" },
      templateName: { type: "string" },
      templateParameters: { type: "object" },
      language: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
  {
    actionType: "messaging.escalation.notify_owner",
    name: "Notify Owner",
    description: "Notify the business owner via WhatsApp or Telegram about an escalation.",
    parametersSchema: {
      organizationId: { type: "string" },
      contactId: { type: "string" },
      reason: { type: "string" },
      conversationContext: { type: "string" },
      correlationId: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
];

export const MESSAGING_MANIFEST = {
  id: "messaging",
  name: "Messaging",
  version: "0.1.0",
  description:
    "Multi-channel messaging infrastructure: WhatsApp send/template, owner escalation notifications.",
  actions: MESSAGING_ACTIONS,
  requiredConnections: ["whatsapp"],
  defaultPolicies: ["messaging-opt-out-enforcement", "messaging-rate-limit"],
} satisfies import("@switchboard/schemas").CartridgeManifest;
```

- [ ] **Step 5: Create defaults/guardrails.ts**

Create `cartridges/messaging/src/defaults/guardrails.ts`:

```typescript
// ---------------------------------------------------------------------------
// Default Guardrails — Messaging
// ---------------------------------------------------------------------------

import type { GuardrailConfig } from "@switchboard/schemas";

export const DEFAULT_MESSAGING_GUARDRAILS: GuardrailConfig = {
  rateLimits: [
    {
      scope: "patient",
      maxActions: 10,
      windowMs: 86_400_000, // 24 hours — per-contact daily limit
    },
    {
      scope: "global",
      maxActions: 1000,
      windowMs: 86_400_000, // 24 hours — per-org daily limit
    },
  ],
  cooldowns: [
    {
      actionType: "messaging.whatsapp.send_template",
      cooldownMs: 86_400_000, // 24 hours — template messages per contact
      scope: "patient",
    },
    {
      actionType: "messaging.escalation.notify_owner",
      cooldownMs: 300_000, // 5 minutes — prevent owner notification spam
      scope: "global",
    },
  ],
  protectedEntities: [],
};
```

- [ ] **Step 6: Create defaults/policies.ts**

Create `cartridges/messaging/src/defaults/policies.ts`:

```typescript
// ---------------------------------------------------------------------------
// Default Policies — Messaging
// ---------------------------------------------------------------------------

export const DEFAULT_MESSAGING_POLICIES = ["messaging-opt-out-enforcement", "messaging-rate-limit"];
```

- [ ] **Step 7: Write manifest test**

Create `cartridges/messaging/src/__tests__/manifest.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { MESSAGING_MANIFEST, MESSAGING_ACTIONS } from "../manifest.js";

describe("Messaging Manifest", () => {
  it("has required manifest fields", () => {
    expect(MESSAGING_MANIFEST.id).toBe("messaging");
    expect(MESSAGING_MANIFEST.name).toBe("Messaging");
    expect(MESSAGING_MANIFEST.version).toBeDefined();
    expect(MESSAGING_MANIFEST.actions.length).toBeGreaterThan(0);
  });

  it("defines 3 actions", () => {
    expect(MESSAGING_ACTIONS).toHaveLength(3);
    const types = MESSAGING_ACTIONS.map((a) => a.actionType);
    expect(types).toContain("messaging.whatsapp.send");
    expect(types).toContain("messaging.whatsapp.send_template");
    expect(types).toContain("messaging.escalation.notify_owner");
  });

  it("all actions have required fields", () => {
    for (const action of MESSAGING_ACTIONS) {
      expect(action.actionType).toBeTruthy();
      expect(action.name).toBeTruthy();
      expect(action.description).toBeTruthy();
      expect(action.parametersSchema).toBeDefined();
      expect(action.baseRiskCategory).toBeDefined();
      expect(typeof action.reversible).toBe("boolean");
    }
  });
});
```

- [ ] **Step 8: Create barrel index.ts**

Create `cartridges/messaging/src/index.ts`:

```typescript
// ---------------------------------------------------------------------------
// messaging — Multi-channel messaging cartridge
// ---------------------------------------------------------------------------

export { MESSAGING_MANIFEST, MESSAGING_ACTIONS } from "./manifest.js";
export { DEFAULT_MESSAGING_GUARDRAILS } from "./defaults/guardrails.js";
export { DEFAULT_MESSAGING_POLICIES } from "./defaults/policies.js";
export { WhatsAppRateLimiter, type RateLimiterConfig } from "./rate-limiter.js";
export { detectOptOut, detectOptIn, OPT_OUT_KEYWORDS, OPT_IN_KEYWORDS } from "./opt-out.js";
export {
  EscalationRouter,
  type EscalationMessage,
  type EscalationRouterConfig,
  type OwnerReply,
} from "./escalation-router.js";
```

- [ ] **Step 9: Install dependencies and run tests**

Run: `cd /Users/jasonljc/switchboard && pnpm install`
Then: `pnpm --filter @switchboard/messaging test -- --reporter verbose src/__tests__/manifest.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```
feat(messaging): scaffold messaging cartridge with manifest, guardrails, and policies
```

---

## Task 8: WhatsApp Rate Limiter

**Files:**

- Create: `cartridges/messaging/src/rate-limiter.ts`
- Create: `cartridges/messaging/src/__tests__/rate-limiter.test.ts`

- [ ] **Step 1: Write rate limiter tests**

Create `cartridges/messaging/src/__tests__/rate-limiter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WhatsAppRateLimiter } from "../rate-limiter.js";

describe("WhatsAppRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("allows messages under the rate limit", async () => {
    const limiter = new WhatsAppRateLimiter({ messagesPerSecond: 80 });
    const result = await limiter.enqueue({ contactId: "c1", message: "hello" });
    expect(result.accepted).toBe(true);
  });

  it("tracks queue depth", async () => {
    const limiter = new WhatsAppRateLimiter({ messagesPerSecond: 1 });
    await limiter.enqueue({ contactId: "c1", message: "m1" });
    await limiter.enqueue({ contactId: "c2", message: "m2" });
    expect(limiter.queueDepth).toBe(2);
  });

  it("warns when queue exceeds threshold", async () => {
    const onQueueWarning = vi.fn();
    const limiter = new WhatsAppRateLimiter({
      messagesPerSecond: 80,
      queueWarningThreshold: 2,
      onQueueWarning,
    });

    await limiter.enqueue({ contactId: "c1", message: "m1" });
    await limiter.enqueue({ contactId: "c2", message: "m2" });
    await limiter.enqueue({ contactId: "c3", message: "m3" });

    expect(onQueueWarning).toHaveBeenCalledWith(3);
  });

  it("drains queue at configured rate", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const limiter = new WhatsAppRateLimiter({
      messagesPerSecond: 2,
      dispatch,
    });

    await limiter.enqueue({ contactId: "c1", message: "m1" });
    await limiter.enqueue({ contactId: "c2", message: "m2" });
    await limiter.enqueue({ contactId: "c3", message: "m3" });

    // Process the queue
    await limiter.drain();

    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it("tracks template messages separately", async () => {
    const limiter = new WhatsAppRateLimiter({
      messagesPerSecond: 80,
      dailyTemplateLimit: 2,
    });

    const r1 = await limiter.enqueue({ contactId: "c1", message: "t1", isTemplate: true });
    const r2 = await limiter.enqueue({ contactId: "c2", message: "t2", isTemplate: true });
    const r3 = await limiter.enqueue({ contactId: "c3", message: "t3", isTemplate: true });

    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(true);
    expect(r3.accepted).toBe(false);
    expect(r3.reason).toBe("daily_template_limit_exceeded");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/messaging test -- --reporter verbose src/__tests__/rate-limiter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the rate limiter**

Create `cartridges/messaging/src/rate-limiter.ts`:

```typescript
// ---------------------------------------------------------------------------
// WhatsApp Rate Limiter — queue-based throttling for outbound messages
// ---------------------------------------------------------------------------

export interface RateLimiterConfig {
  messagesPerSecond?: number;
  dailyTemplateLimit?: number;
  queueWarningThreshold?: number;
  dispatch?: (item: QueueItem) => Promise<void>;
  onQueueWarning?: (depth: number) => void;
}

export interface QueueItem {
  contactId: string;
  message: string;
  isTemplate?: boolean;
}

export interface EnqueueResult {
  accepted: boolean;
  reason?: string;
}

export class WhatsAppRateLimiter {
  private queue: QueueItem[] = [];
  private messagesPerSecond: number;
  private dailyTemplateLimit: number;
  private templateCount = 0;
  private queueWarningThreshold: number;
  private dispatch: (item: QueueItem) => Promise<void>;
  private onQueueWarning?: (depth: number) => void;

  constructor(config: RateLimiterConfig = {}) {
    this.messagesPerSecond = config.messagesPerSecond ?? 80;
    this.dailyTemplateLimit = config.dailyTemplateLimit ?? 1000;
    this.queueWarningThreshold = config.queueWarningThreshold ?? 1000;
    this.dispatch = config.dispatch ?? (async () => {});
    this.onQueueWarning = config.onQueueWarning;
  }

  get queueDepth(): number {
    return this.queue.length;
  }

  async enqueue(item: QueueItem): Promise<EnqueueResult> {
    if (item.isTemplate) {
      if (this.templateCount >= this.dailyTemplateLimit) {
        return { accepted: false, reason: "daily_template_limit_exceeded" };
      }
      this.templateCount++;
    }

    this.queue.push(item);

    if (this.onQueueWarning && this.queue.length > this.queueWarningThreshold) {
      this.onQueueWarning(this.queue.length);
    }

    return { accepted: true };
  }

  async drain(): Promise<void> {
    const batchSize = this.messagesPerSecond;
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, batchSize);
      await Promise.all(batch.map((item) => this.dispatch(item)));
    }
  }

  resetTemplateCount(): void {
    this.templateCount = 0;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/messaging test -- --reporter verbose src/__tests__/rate-limiter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(messaging): add WhatsApp queue-based rate limiter with template tracking
```

---

## Task 9: WhatsApp Opt-Out Handling

**Files:**

- Create: `cartridges/messaging/src/opt-out.ts`
- Create: `cartridges/messaging/src/__tests__/opt-out.test.ts`

- [ ] **Step 1: Write opt-out tests**

Create `cartridges/messaging/src/__tests__/opt-out.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { detectOptOut, detectOptIn, OPT_OUT_KEYWORDS, OPT_IN_KEYWORDS } from "../opt-out.js";

describe("Opt-out detection", () => {
  it("detects STOP keyword", () => {
    expect(detectOptOut("STOP")).toBe(true);
  });

  it("detects UNSUBSCRIBE keyword", () => {
    expect(detectOptOut("UNSUBSCRIBE")).toBe(true);
  });

  it("detects OPT OUT keyword", () => {
    expect(detectOptOut("OPT OUT")).toBe(true);
  });

  it("detects CANCEL keyword", () => {
    expect(detectOptOut("CANCEL")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(detectOptOut("stop")).toBe(true);
    expect(detectOptOut("Stop")).toBe(true);
    expect(detectOptOut("unsubscribe")).toBe(true);
  });

  it("is whitespace-tolerant", () => {
    expect(detectOptOut("  STOP  ")).toBe(true);
    expect(detectOptOut(" opt  out ")).toBe(true);
  });

  it("does not false-positive on regular messages", () => {
    expect(detectOptOut("I want to stop by for a consultation")).toBe(false);
    expect(detectOptOut("Can you cancel my Tuesday appointment?")).toBe(false);
    expect(detectOptOut("Please help me")).toBe(false);
  });

  it("detects exact opt-out as the full message content", () => {
    expect(detectOptOut("stop")).toBe(true);
    expect(detectOptOut("I want to stop")).toBe(false);
  });

  it("exports keyword lists for inspection", () => {
    expect(OPT_OUT_KEYWORDS.length).toBeGreaterThan(0);
    expect(OPT_IN_KEYWORDS.length).toBeGreaterThan(0);
  });
});

describe("Opt-in detection", () => {
  it("detects START keyword", () => {
    expect(detectOptIn("START")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(detectOptIn("start")).toBe(true);
  });

  it("does not false-positive on regular messages", () => {
    expect(detectOptIn("When do we start?")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/messaging test -- --reporter verbose src/__tests__/opt-out.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement opt-out detection**

Create `cartridges/messaging/src/opt-out.ts`:

```typescript
// ---------------------------------------------------------------------------
// Opt-Out Handling — WhatsApp compliance keyword detection
// ---------------------------------------------------------------------------

export const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "opt out", "cancel"];
export const OPT_IN_KEYWORDS = ["start"];

function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
}

export function detectOptOut(message: string): boolean {
  const normalized = normalizeMessage(message);
  return OPT_OUT_KEYWORDS.includes(normalized);
}

export function detectOptIn(message: string): boolean {
  const normalized = normalizeMessage(message);
  return OPT_IN_KEYWORDS.includes(normalized);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/messaging test -- --reporter verbose src/__tests__/opt-out.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(messaging): add WhatsApp opt-out/opt-in keyword detection
```

---

## Task 10: Escalation Router

**Files:**

- Create: `cartridges/messaging/src/escalation-router.ts`
- Create: `cartridges/messaging/src/__tests__/escalation-router.test.ts`

- [ ] **Step 1: Write escalation router tests**

Create `cartridges/messaging/src/__tests__/escalation-router.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { EscalationRouter } from "../escalation-router.js";
import type { EscalationMessage, OwnerReply } from "../escalation-router.js";

function makeEscalation(overrides: Partial<EscalationMessage> = {}): EscalationMessage {
  return {
    escalationId: "esc-1",
    organizationId: "org-1",
    contactId: "c1",
    agentId: "lead-responder",
    reason: "low_confidence",
    messageId: "msg-100",
    correlationId: "corr-1",
    createdAt: new Date().toISOString(),
    status: "open",
    ...overrides,
  };
}

describe("EscalationRouter", () => {
  it("matches by WhatsApp reply-to threading (context.message_id)", () => {
    const router = new EscalationRouter();
    router.addEscalation(makeEscalation({ messageId: "msg-100" }));

    const reply: OwnerReply = {
      message: "Tell them we have availability on Thursday",
      contextMessageId: "msg-100",
    };

    const match = router.matchReply("org-1", reply);

    expect(match).toBeDefined();
    expect(match!.escalationId).toBe("esc-1");
  });

  it("matches by [REF:xxx] pattern in message body", () => {
    const router = new EscalationRouter();
    router.addEscalation(makeEscalation({ escalationId: "esc-abc" }));

    const reply: OwnerReply = {
      message: "[REF:esc-abc] Yes, we can offer 20% off",
    };

    const match = router.matchReply("org-1", reply);

    expect(match).toBeDefined();
    expect(match!.escalationId).toBe("esc-abc");
  });

  it("falls back to single open escalation when no threading or ref", () => {
    const router = new EscalationRouter();
    router.addEscalation(makeEscalation({ escalationId: "esc-only" }));

    const reply: OwnerReply = {
      message: "Sounds good, go ahead",
    };

    const match = router.matchReply("org-1", reply);

    expect(match).toBeDefined();
    expect(match!.escalationId).toBe("esc-only");
  });

  it("returns null when multiple open escalations and no specific match", () => {
    const router = new EscalationRouter();
    router.addEscalation(
      makeEscalation({
        escalationId: "esc-old",
        createdAt: "2026-03-19T00:00:00.000Z",
      }),
    );
    router.addEscalation(
      makeEscalation({
        escalationId: "esc-new",
        createdAt: "2026-03-20T00:00:00.000Z",
      }),
    );

    const reply: OwnerReply = {
      message: "Sounds good, go ahead",
    };

    // With multiple open, should NOT silently pick most recent — should ambiguate
    const match = router.matchReply("org-1", reply);
    expect(match).toBeNull();
  });

  it("returns null with ambiguity list when multiple open escalations exist and no match", () => {
    const router = new EscalationRouter();
    router.addEscalation(makeEscalation({ escalationId: "esc-1", contactId: "c1" }));
    router.addEscalation(makeEscalation({ escalationId: "esc-2", contactId: "c2" }));
    router.addEscalation(makeEscalation({ escalationId: "esc-3", contactId: "c3" }));

    const reply: OwnerReply = {
      message: "Yes, go ahead",
    };

    const result = router.matchReplyOrAmbiguate("org-1", reply);

    expect(result.match).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.openEscalations).toHaveLength(3);
  });

  it("handles numbered list selection for ambiguity resolution", () => {
    const router = new EscalationRouter();
    router.addEscalation(makeEscalation({ escalationId: "esc-1", contactId: "c1" }));
    router.addEscalation(makeEscalation({ escalationId: "esc-2", contactId: "c2" }));
    router.addEscalation(makeEscalation({ escalationId: "esc-3", contactId: "c3" }));

    const reply: OwnerReply = {
      message: "2",
    };

    const match = router.matchReply("org-1", reply);

    expect(match).toBeDefined();
    expect(match!.escalationId).toBe("esc-2");
  });

  it("marks resolved escalations as closed", () => {
    const router = new EscalationRouter();
    router.addEscalation(makeEscalation({ escalationId: "esc-1" }));

    router.resolve("org-1", "esc-1");

    const reply: OwnerReply = {
      message: "hello",
    };

    const match = router.matchReply("org-1", reply);
    expect(match).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/messaging test -- --reporter verbose src/__tests__/escalation-router.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement EscalationRouter**

Create `cartridges/messaging/src/escalation-router.ts`:

```typescript
// ---------------------------------------------------------------------------
// Escalation Router — 4-step owner reply matching
// ---------------------------------------------------------------------------

export interface EscalationMessage {
  escalationId: string;
  organizationId: string;
  contactId: string;
  agentId: string;
  reason: string;
  messageId: string;
  correlationId: string;
  createdAt: string;
  status: "open" | "closed";
}

export interface OwnerReply {
  message: string;
  contextMessageId?: string;
}

export interface AmbiguousResult {
  match: EscalationMessage | null;
  ambiguous: boolean;
  openEscalations: EscalationMessage[];
}

export interface EscalationRouterConfig {
  maxOpenEscalations?: number;
}

const REF_PATTERN = /\[REF:([^\]]+)\]/;

export class EscalationRouter {
  private escalations = new Map<string, EscalationMessage[]>();

  addEscalation(escalation: EscalationMessage): void {
    const orgEscalations = this.escalations.get(escalation.organizationId) ?? [];
    orgEscalations.push(escalation);
    this.escalations.set(escalation.organizationId, orgEscalations);
  }

  resolve(organizationId: string, escalationId: string): void {
    const orgEscalations = this.escalations.get(organizationId);
    if (!orgEscalations) return;
    const esc = orgEscalations.find((e) => e.escalationId === escalationId);
    if (esc) {
      esc.status = "closed";
    }
  }

  matchReply(organizationId: string, reply: OwnerReply): EscalationMessage | null {
    const openEscalations = this.getOpen(organizationId);
    if (openEscalations.length === 0) return null;

    // Step 1: WhatsApp reply-to threading
    if (reply.contextMessageId) {
      const match = openEscalations.find((e) => e.messageId === reply.contextMessageId);
      if (match) return match;
    }

    // Step 2: [REF:xxx] extraction
    const refMatch = REF_PATTERN.exec(reply.message);
    if (refMatch) {
      const refId = refMatch[1];
      const match = openEscalations.find((e) => e.escalationId === refId);
      if (match) return match;
    }

    // Step 4: Numbered list selection (before recency to handle "2" as a selection)
    const trimmed = reply.message.trim();
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= openEscalations.length && trimmed === String(num)) {
      const sorted = this.sortByRecency(openEscalations);
      return sorted[num - 1] ?? null;
    }

    // Step 3: Recency fallback — only when exactly 1 open escalation
    if (openEscalations.length === 1) {
      return openEscalations[0]!;
    }

    // Multiple open and no specific match — ambiguous, return null
    // Caller should use matchReplyOrAmbiguate() to get the list for the owner
    return null;
  }

  matchReplyOrAmbiguate(organizationId: string, reply: OwnerReply): AmbiguousResult {
    const openEscalations = this.getOpen(organizationId);
    if (openEscalations.length === 0) {
      return { match: null, ambiguous: false, openEscalations: [] };
    }

    // Step 1: WhatsApp reply-to threading
    if (reply.contextMessageId) {
      const match = openEscalations.find((e) => e.messageId === reply.contextMessageId);
      if (match) return { match, ambiguous: false, openEscalations };
    }

    // Step 2: [REF:xxx] extraction
    const refMatch = REF_PATTERN.exec(reply.message);
    if (refMatch) {
      const refId = refMatch[1];
      const match = openEscalations.find((e) => e.escalationId === refId);
      if (match) return { match, ambiguous: false, openEscalations };
    }

    // Step 4: Numbered list selection
    const trimmed = reply.message.trim();
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= openEscalations.length && trimmed === String(num)) {
      const sorted = this.sortByRecency(openEscalations);
      const match = sorted[num - 1] ?? null;
      return { match, ambiguous: false, openEscalations };
    }

    // Step 3: Recency fallback
    if (openEscalations.length === 1) {
      return { match: openEscalations[0]!, ambiguous: false, openEscalations };
    }

    // Ambiguous — multiple open, no threading/ref/number
    return { match: null, ambiguous: true, openEscalations };
  }

  private getOpen(organizationId: string): EscalationMessage[] {
    return (this.escalations.get(organizationId) ?? []).filter((e) => e.status === "open");
  }

  private sortByRecency(escalations: EscalationMessage[]): EscalationMessage[] {
    return [...escalations].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/messaging test -- --reporter verbose src/__tests__/escalation-router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(messaging): add EscalationRouter with 4-step owner reply matching
```

---

## Task 11: Update Barrel Exports

**Files:**

- Modify: `packages/agents/src/index.ts`

- [ ] **Step 1: Add ConversationRouter and lifecycle exports**

In `packages/agents/src/index.ts`, add:

```typescript
export {
  ConversationRouter,
  type ConversationRouterConfig,
  type StageResolver,
} from "./conversation-router.js";

export { agentForStage } from "./lifecycle.js";
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @switchboard/agents typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
feat(agents): export ConversationRouter and agentForStage from barrel
```

---

## Task 12: Full Verification

- [ ] **Step 1: Run all tests**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: No errors (fix any that arise)

- [ ] **Step 4: Final commit if any lint fixes were needed**

```
chore: fix lint issues from Phase 2 implementation
```
