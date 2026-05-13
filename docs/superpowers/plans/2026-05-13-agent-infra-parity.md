# Agent Infrastructure Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four agent infrastructure gaps identified in Switchboard-vs-Meta-BizAI analysis: activate dormant FAQ auto-promotion, parallelize safe tool calls, inject outcome-informed context, and decouple the skill executor from Anthropic-specific types.

**Architecture:** Four independent PRs shipped in dependency order. PR-1 wires a missing dependency. PR-2 introduces a single-use, concurrency-aware tool call scheduler. PR-3 closes the memory loop end-to-end: it adds the booked-outcome write path in `compounding-service.ts`, surfaces real `lastSeenAt` from `listHighConfidence`, and threads outcome patterns through `ContextBuilder` into Alex via a new `SkillServices` slot. PR-4 extracts a provider-neutral adapter boundary from the Anthropic-coupled tool-calling path — type boundary only, no behavior change. Fallback routing is explicitly deferred to PR-4B.

**Tech Stack:** TypeScript, Vitest, Prisma, Anthropic SDK, pgvector, Zod

**Spec:** `docs/superpowers/specs/2026-05-13-agent-infra-parity-design.md`

---

## PR-1: Wire knowledgeStore into ConversationCompoundingService

### File Map

- Modify: `apps/chat/src/gateway/gateway-bridge.ts` — inject `knowledgeStore` + `agentId`
- Modify: `packages/core/src/memory/__tests__/compounding-service.test.ts` — add wiring + regression tests

---

### Task 1: Add wiring regression test

**Files:**

- Modify: `packages/core/src/memory/__tests__/compounding-service.test.ts`

- [ ] **Step 1: Write the failing test — knowledgeStore receives FAQ promotion**

Add a test that verifies FAQ promotion writes a learned chunk when `knowledgeStore` is provided and the threshold is crossed:

```typescript
it("promotes FAQ to learned KnowledgeChunk when knowledgeStore is wired", async () => {
  const knowledgeStore = { store: vi.fn().mockResolvedValue(undefined) };
  const deps = createMockDeps();
  // Pre-existing FAQ entry at 2 observations (one below threshold)
  deps.deploymentMemoryStore.findByCategory.mockResolvedValue([
    { id: "faq-1", content: "What is your cancellation policy?", sourceCount: 2, confidence: 0.6 },
  ]);
  deps.deploymentMemoryStore.incrementConfidence.mockResolvedValue({
    id: "faq-1",
    sourceCount: 3,
  });
  deps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

  const service = new ConversationCompoundingService({
    ...deps,
    knowledgeStore,
    agentId: "alex",
  });

  await service.processConversationEnd(createEvent());

  expect(knowledgeStore.store).toHaveBeenCalledTimes(1);
  const stored = knowledgeStore.store.mock.calls[0]![0];
  expect(stored.sourceType).toBe("learned");
  expect(stored.agentId).toBe("alex");
  expect(stored.draftStatus).toBe("pending");
  expect(stored.draftExpiresAt).toBeInstanceOf(Date);
});
```

- [ ] **Step 2: Run test to verify it passes**

This test should already pass because the FAQ promotion path exists in `compounding-service.ts` (line 222). The `knowledgeStore` guard `if (result.sourceCount === FAQ_PROMOTION_THRESHOLD && this.knowledgeStore)` handles the gating.

Run: `pnpm --filter @switchboard/core test -- --grep "promotes FAQ to learned"`
Expected: PASS

- [ ] **Step 3: Write the regression test — graceful degradation without knowledgeStore**

```typescript
it("skips FAQ promotion gracefully when knowledgeStore is not provided", async () => {
  const deps = createMockDeps();
  deps.deploymentMemoryStore.findByCategory.mockResolvedValue([
    { id: "faq-1", content: "What is your cancellation policy?", sourceCount: 2, confidence: 0.6 },
  ]);
  deps.deploymentMemoryStore.incrementConfidence.mockResolvedValue({
    id: "faq-1",
    sourceCount: 3,
  });
  deps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

  // No knowledgeStore provided — should not throw
  const service = new ConversationCompoundingService(deps);

  await expect(service.processConversationEnd(createEvent())).resolves.not.toThrow();
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --grep "skips FAQ promotion gracefully"`
Expected: PASS

- [ ] **Step 5: Write the test — pending drafts are not trusted/live**

```typescript
it("created learned chunks have draftStatus=pending, not null", async () => {
  const knowledgeStore = { store: vi.fn().mockResolvedValue(undefined) };
  const deps = createMockDeps();
  deps.deploymentMemoryStore.findByCategory.mockResolvedValue([
    { id: "faq-1", content: "Do you accept walk-ins?", sourceCount: 2, confidence: 0.6 },
  ]);
  deps.deploymentMemoryStore.incrementConfidence.mockResolvedValue({
    id: "faq-1",
    sourceCount: 3,
  });
  deps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

  const service = new ConversationCompoundingService({
    ...deps,
    knowledgeStore,
    agentId: "alex",
  });

  await service.processConversationEnd(createEvent());

  const stored = knowledgeStore.store.mock.calls[0]![0];
  expect(stored.draftStatus).toBe("pending");
  expect(stored.draftExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  // 72 hours ± 1 minute tolerance
  const expectedExpiry = Date.now() + 72 * 60 * 60 * 1000;
  expect(stored.draftExpiresAt!.getTime()).toBeCloseTo(expectedExpiry, -4);
});
```

- [ ] **Step 6: Run all compounding tests**

Run: `pnpm --filter @switchboard/core test -- --grep "CompoundingService"`
Expected: All PASS

- [ ] **Step 7: Commit tests**

```bash
git add packages/core/src/memory/__tests__/compounding-service.test.ts
git commit -m "$(cat <<'EOF'
test(memory): add wiring + regression tests for knowledgeStore FAQ promotion
EOF
)"
```

---

### Task 2: Wire knowledgeStore in gateway-bridge.ts

**Files:**

- Modify: `apps/chat/src/gateway/gateway-bridge.ts`

- [ ] **Step 1: Add PrismaKnowledgeStore import and wire knowledgeStore**

In `apps/chat/src/gateway/gateway-bridge.ts`, add the import and wire the dependency:

```typescript
// Add to imports at top:
import { PrismaKnowledgeStore } from "@switchboard/db";
```

Then update the `ConversationCompoundingService` construction (currently lines 71-96) to include `knowledgeStore` and `agentId`:

```typescript
const compoundingService = new ConversationCompoundingService({
  llmClient: {
    complete: async (prompt: string) => {
      const adapter = createAnthropicAdapter();
      const reply = await adapter.generateReply({
        systemPrompt: "You are a fact extraction assistant. Return only valid JSON.",
        conversationHistory: [
          {
            id: "extract-prompt",
            contactId: "",
            direction: "inbound",
            content: prompt,
            timestamp: new Date().toISOString(),
            channel: "dashboard",
          },
        ],
        retrievedContext: [],
        agentInstructions: "",
      });
      return reply.reply;
    },
  },
  embeddingAdapter,
  interactionSummaryStore: new PrismaInteractionSummaryStore(prisma),
  deploymentMemoryStore: new PrismaDeploymentMemoryStore(prisma),
  knowledgeStore: new PrismaKnowledgeStore(prisma),
  agentId: "alex",
});
```

- [ ] **Step 2: Verify PrismaKnowledgeStore exists and implements the required interface**

Run: `grep -n "class PrismaKnowledgeStore" packages/db/src/stores/*.ts`
Expected: A class with a `store(chunk)` method matching the `CompoundingDeps["knowledgeStore"]` interface.

If `PrismaKnowledgeStore` does not exist or is not exported from `@switchboard/db`, check for the actual knowledge store implementation name and adjust the import.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: No new errors

- [ ] **Step 4: Run all tests**

Run: `pnpm test`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat/src/gateway/gateway-bridge.ts
git commit -m "$(cat <<'EOF'
feat(chat): wire knowledgeStore into ConversationCompoundingService

Activates the existing FAQ auto-promotion path. When repeated customer
questions cross the promotion threshold (3 observations), the system
creates learned KnowledgeChunk drafts with draftStatus=pending and
72-hour expiry.
EOF
)"
```

---

## PR-2: Parallel safe tool calls in skill executor

### File Map

- Create: `packages/core/src/skill-runtime/tool-call-scheduler.ts` — concurrency-aware scheduler
- Create: `packages/core/src/skill-runtime/__tests__/tool-call-scheduler.test.ts` — scheduler tests
- Modify: `packages/core/src/skill-runtime/skill-executor.ts` — use scheduler instead of sequential loop

---

### Task 3: Define the ToolCallScheduler interface and types

**Files:**

- Create: `packages/core/src/skill-runtime/tool-call-scheduler.ts`
- Test: `packages/core/src/skill-runtime/__tests__/tool-call-scheduler.test.ts`

- [ ] **Step 1: Write the failing test — read-only tools execute concurrently**

```typescript
// packages/core/src/skill-runtime/__tests__/tool-call-scheduler.test.ts
import { describe, it, expect, vi } from "vitest";
import { ToolCallScheduler, type ScheduledToolCall } from "../tool-call-scheduler.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ToolCallScheduler", () => {
  it("executes multiple read-only tools concurrently", async () => {
    const executionOrder: string[] = [];

    const calls: ScheduledToolCall[] = [
      {
        id: "call-1",
        effectCategory: "read",
        execute: async () => {
          executionOrder.push("start-1");
          await delay(50);
          executionOrder.push("end-1");
          return { status: "ok" as const, data: "result-1" };
        },
      },
      {
        id: "call-2",
        effectCategory: "read",
        execute: async () => {
          executionOrder.push("start-2");
          await delay(50);
          executionOrder.push("end-2");
          return { status: "ok" as const, data: "result-2" };
        },
      },
    ];

    const scheduler = new ToolCallScheduler({ maxBudget: 10 });
    const results = await scheduler.execute(calls);

    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe("call-1");
    expect(results[1]!.id).toBe("call-2");
    // Both should start before either ends (concurrent)
    expect(executionOrder[0]).toBe("start-1");
    expect(executionOrder[1]).toBe("start-2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --grep "executes multiple read-only tools concurrently"`
Expected: FAIL — module not found

- [ ] **Step 3: Write the ToolCallScheduler implementation**

```typescript
// packages/core/src/skill-runtime/tool-call-scheduler.ts
//
// Concurrency-aware scheduler for one batch of tool calls returned by an LLM
// in a single turn. Construct a fresh instance per turn — schedulers are
// SINGLE-USE. Reusing an instance after `execute()` returns throws
// SchedulerAlreadyUsedError, by design: lifecycle mistakes should fail loudly
// rather than silently double-count budget or corrupt audit ordering.
import type { EffectCategory } from "./governance-types.js";
import { SkillExecutionBudgetError } from "./types.js";

export class SchedulerAlreadyUsedError extends Error {
  constructor() {
    super("ToolCallScheduler is single-use; construct a fresh instance per LLM turn");
    this.name = "SchedulerAlreadyUsedError";
  }
}

export interface ScheduledToolCall {
  id: string;
  effectCategory: EffectCategory;
  execute: () => Promise<ScheduledToolResult>;
}

export interface ScheduledToolResult {
  status: "ok" | "error";
  data: unknown;
  error?: string;
}

export interface ToolCallSchedulerResult {
  id: string;
  result: ScheduledToolResult;
}

export interface ToolCallSchedulerConfig {
  maxBudget: number;
}

const READ_ONLY_CATEGORIES: Set<EffectCategory> = new Set(["read", "propose", "simulate"]);

export class ToolCallScheduler {
  private readonly maxBudget: number;
  private used = false;

  constructor(config: ToolCallSchedulerConfig) {
    this.maxBudget = config.maxBudget;
  }

  async execute(calls: ScheduledToolCall[]): Promise<ToolCallSchedulerResult[]> {
    if (this.used) throw new SchedulerAlreadyUsedError();
    this.used = true;

    if (calls.length === 0) return [];

    // Reserve budget upfront for the whole batch before any execution starts.
    if (calls.length > this.maxBudget) {
      throw new SkillExecutionBudgetError(`Exceeded maximum tool calls (${this.maxBudget})`);
    }

    // Partition into read-only and mutating batches, preserving order
    const batches = this.partition(calls);

    // Results indexed by original call id for order preservation
    const resultMap = new Map<string, ScheduledToolResult>();

    for (const batch of batches) {
      if (batch.parallel) {
        const settled = await Promise.allSettled(
          batch.calls.map(async (call) => {
            const result = await call.execute();
            return { id: call.id, result };
          }),
        );
        for (const outcome of settled) {
          if (outcome.status === "fulfilled") {
            resultMap.set(outcome.value.id, outcome.value.result);
          } else {
            const call = batch.calls[settled.indexOf(outcome)]!;
            resultMap.set(call.id, {
              status: "error",
              data: null,
              error:
                outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
            });
          }
        }
      } else {
        for (const call of batch.calls) {
          try {
            const result = await call.execute();
            resultMap.set(call.id, result);
          } catch (err) {
            resultMap.set(call.id, {
              status: "error",
              data: null,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }

    // Return results in original positional order
    return calls.map((call) => ({
      id: call.id,
      result: resultMap.get(call.id)!,
    }));
  }

  private partition(
    calls: ScheduledToolCall[],
  ): Array<{ parallel: boolean; calls: ScheduledToolCall[] }> {
    const batches: Array<{ parallel: boolean; calls: ScheduledToolCall[] }> = [];
    let currentReadBatch: ScheduledToolCall[] = [];

    for (const call of calls) {
      if (READ_ONLY_CATEGORIES.has(call.effectCategory)) {
        currentReadBatch.push(call);
      } else {
        // Flush any pending read batch before the mutating call
        if (currentReadBatch.length > 0) {
          batches.push({ parallel: true, calls: currentReadBatch });
          currentReadBatch = [];
        }
        // Mutating calls run alone (serialized)
        batches.push({ parallel: false, calls: [call] });
      }
    }

    // Flush trailing read batch
    if (currentReadBatch.length > 0) {
      batches.push({ parallel: true, calls: currentReadBatch });
    }

    return batches;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --grep "executes multiple read-only tools concurrently"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/tool-call-scheduler.ts packages/core/src/skill-runtime/__tests__/tool-call-scheduler.test.ts
git commit -m "$(cat <<'EOF'
feat(skill-runtime): add concurrency-aware ToolCallScheduler

Partitions tool calls by effectCategory: read-only tools run in parallel,
mutating tools serialize. Budget is reserved upfront before execution.
Results are returned in original positional order.
EOF
)"
```

---

### Task 4: Add remaining scheduler tests

**Files:**

- Modify: `packages/core/src/skill-runtime/__tests__/tool-call-scheduler.test.ts`

- [ ] **Step 1: Write test — tool results preserve positional order**

```typescript
it("returns results in original positional order regardless of completion order", async () => {
  const calls: ScheduledToolCall[] = [
    {
      id: "slow",
      effectCategory: "read",
      execute: async () => {
        await delay(80);
        return { status: "ok" as const, data: "slow-result" };
      },
    },
    {
      id: "fast",
      effectCategory: "read",
      execute: async () => {
        await delay(10);
        return { status: "ok" as const, data: "fast-result" };
      },
    },
  ];

  const scheduler = new ToolCallScheduler({ maxBudget: 10 });
  const results = await scheduler.execute(calls);

  expect(results[0]!.id).toBe("slow");
  expect(results[0]!.result.data).toBe("slow-result");
  expect(results[1]!.id).toBe("fast");
  expect(results[1]!.result.data).toBe("fast-result");
});
```

- [ ] **Step 2: Write test — mutating tools are serialized**

```typescript
it("serializes mutating tools — they do not overlap", async () => {
  let concurrentMutations = 0;
  let maxConcurrentMutations = 0;

  const calls: ScheduledToolCall[] = [
    {
      id: "write-1",
      effectCategory: "write",
      execute: async () => {
        concurrentMutations++;
        maxConcurrentMutations = Math.max(maxConcurrentMutations, concurrentMutations);
        await delay(30);
        concurrentMutations--;
        return { status: "ok" as const, data: "w1" };
      },
    },
    {
      id: "write-2",
      effectCategory: "external_send",
      execute: async () => {
        concurrentMutations++;
        maxConcurrentMutations = Math.max(maxConcurrentMutations, concurrentMutations);
        await delay(30);
        concurrentMutations--;
        return { status: "ok" as const, data: "w2" };
      },
    },
  ];

  const scheduler = new ToolCallScheduler({ maxBudget: 10 });
  await scheduler.execute(calls);

  expect(maxConcurrentMutations).toBe(1);
});
```

- [ ] **Step 3: Write test — mixed read/write batch**

```typescript
it("handles mixed read/write batch: reads parallel, writes serialized", async () => {
  const executionOrder: string[] = [];

  const calls: ScheduledToolCall[] = [
    {
      id: "read-1",
      effectCategory: "read",
      execute: async () => {
        executionOrder.push("start-read-1");
        await delay(40);
        executionOrder.push("end-read-1");
        return { status: "ok" as const, data: "r1" };
      },
    },
    {
      id: "read-2",
      effectCategory: "read",
      execute: async () => {
        executionOrder.push("start-read-2");
        await delay(40);
        executionOrder.push("end-read-2");
        return { status: "ok" as const, data: "r2" };
      },
    },
    {
      id: "write-1",
      effectCategory: "write",
      execute: async () => {
        executionOrder.push("start-write-1");
        await delay(10);
        executionOrder.push("end-write-1");
        return { status: "ok" as const, data: "w1" };
      },
    },
  ];

  const scheduler = new ToolCallScheduler({ maxBudget: 10 });
  const results = await scheduler.execute(calls);

  // Reads should start before write (reads are first batch, parallel)
  expect(executionOrder.indexOf("start-read-1")).toBeLessThan(
    executionOrder.indexOf("start-write-1"),
  );
  expect(executionOrder.indexOf("start-read-2")).toBeLessThan(
    executionOrder.indexOf("start-write-1"),
  );
  // Write should start only after both reads complete
  expect(executionOrder.indexOf("end-read-1")).toBeLessThan(
    executionOrder.indexOf("start-write-1"),
  );

  // Results still in original order
  expect(results.map((r) => r.id)).toEqual(["read-1", "read-2", "write-1"]);
});
```

- [ ] **Step 4: Write test — budget reservation before execution**

```typescript
it("rejects when budget would be exceeded — reservation happens before execution", async () => {
  const scheduler = new ToolCallScheduler({ maxBudget: 2 });

  const calls: ScheduledToolCall[] = Array.from({ length: 3 }, (_, i) => ({
    id: `call-${i}`,
    effectCategory: "read" as const,
    execute: async () => ({ status: "ok" as const, data: i }),
  }));

  await expect(scheduler.execute(calls)).rejects.toThrow("Exceeded maximum tool calls");
});
```

- [ ] **Step 5: Write test — single tool call unchanged**

```typescript
it("single tool call behaves identically to sequential execution", async () => {
  const calls: ScheduledToolCall[] = [
    {
      id: "only",
      effectCategory: "write",
      execute: async () => ({ status: "ok" as const, data: "result" }),
    },
  ];

  const scheduler = new ToolCallScheduler({ maxBudget: 10 });
  const results = await scheduler.execute(calls);

  expect(results).toHaveLength(1);
  expect(results[0]!.id).toBe("only");
  expect(results[0]!.result.data).toBe("result");
});
```

- [ ] **Step 6: Write test — failed tool does not drop sibling results**

```typescript
it("failed tool call does not drop successful sibling results", async () => {
  const calls: ScheduledToolCall[] = [
    {
      id: "success",
      effectCategory: "read",
      execute: async () => ({ status: "ok" as const, data: "good" }),
    },
    {
      id: "failure",
      effectCategory: "read",
      execute: async () => {
        throw new Error("tool broke");
      },
    },
  ];

  const scheduler = new ToolCallScheduler({ maxBudget: 10 });
  const results = await scheduler.execute(calls);

  expect(results[0]!.result.status).toBe("ok");
  expect(results[0]!.result.data).toBe("good");
  expect(results[1]!.result.status).toBe("error");
  expect(results[1]!.result.error).toBe("tool broke");
});
```

- [ ] **Step 7: Write test — scheduler is single-use**

```typescript
it("throws SchedulerAlreadyUsedError on second execute()", async () => {
  const scheduler = new ToolCallScheduler({ maxBudget: 10 });
  const calls: ScheduledToolCall[] = [
    {
      id: "only",
      effectCategory: "read",
      execute: async () => ({ status: "ok" as const, data: "x" }),
    },
  ];

  await scheduler.execute(calls);
  await expect(scheduler.execute(calls)).rejects.toThrow(/single-use/);
});
```

This pins the per-turn lifecycle: a scheduler cannot accidentally be reused across LLM turns. Failing loudly here is by design — silent reset would let lifecycle mistakes corrupt budget accounting or audit ordering.

- [ ] **Step 8: Write test — hook ordering preserved across parallel reads**

```typescript
it("audit-relevant side effects appear in original call order, not completion order", async () => {
  const auditLog: string[] = [];

  const calls: ScheduledToolCall[] = [
    {
      id: "first-slow",
      effectCategory: "read",
      execute: async () => {
        await delay(60);
        auditLog.push("first-slow");
        return { status: "ok" as const, data: 1 };
      },
    },
    {
      id: "second-fast",
      effectCategory: "read",
      execute: async () => {
        await delay(10);
        auditLog.push("second-fast");
        return { status: "ok" as const, data: 2 };
      },
    },
  ];

  const scheduler = new ToolCallScheduler({ maxBudget: 10 });
  const results = await scheduler.execute(calls);

  // Results are returned in original positional order.
  expect(results.map((r) => r.id)).toEqual(["first-slow", "second-fast"]);

  // Note on audit ordering under parallelism:
  // Side effects performed *inside* the per-call `execute()` body run in
  // completion order, not call order — that's intentional and unavoidable for
  // parallel reads. Callers that need ordered audit emission must perform the
  // audit write OUTSIDE the parallel closure, using the scheduler result array
  // (which IS in original order). This test pins the result-array contract.
  expect(auditLog).toEqual(["second-fast", "first-slow"]);
});
```

This documents the seam: parallel reads complete in non-deterministic order, so any audit logging that must preserve call order has to happen against the returned `ToolCallSchedulerResult[]`, not inside the `execute()` callback. The scheduler integration in Task 5 must respect this.

- [ ] **Step 9: Run all scheduler tests**

Run: `pnpm --filter @switchboard/core test -- --grep "ToolCallScheduler"`
Expected: All PASS

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/skill-runtime/__tests__/tool-call-scheduler.test.ts
git commit -m "$(cat <<'EOF'
test(skill-runtime): comprehensive scheduler tests

Covers: positional ordering, mutating serialization, mixed batches,
budget reservation, single call regression, failed sibling isolation,
single-use lifecycle enforcement, and ordering contract for audit
side effects under parallel reads.
EOF
)"
```

---

### Task 5: Integrate scheduler into SkillExecutorImpl

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts`

- [ ] **Step 1: Write failing test — read-only tools execute via scheduler**

Add to `packages/core/src/skill-runtime/skill-executor.test.ts`:

```typescript
it("uses concurrency-aware scheduling for same-turn tool calls", async () => {
  const executionTimestamps: Array<{ id: string; start: number; end: number }> = [];

  const readTool: SkillTool = {
    id: "data",
    operations: {
      fetch_a: {
        description: "Fetch A",
        inputSchema: { type: "object", properties: {} },
        effectCategory: "read",
        execute: async () => {
          const start = Date.now();
          await new Promise((r) => setTimeout(r, 50));
          executionTimestamps.push({ id: "a", start, end: Date.now() });
          return ok({ value: "a" });
        },
      },
      fetch_b: {
        description: "Fetch B",
        inputSchema: { type: "object", properties: {} },
        effectCategory: "read",
        execute: async () => {
          const start = Date.now();
          await new Promise((r) => setTimeout(r, 50));
          executionTimestamps.push({ id: "b", start, end: Date.now() });
          return ok({ value: "b" });
        },
      },
    },
  };

  const toolMap = new Map([["data", readTool]]);

  const adapter = createMockAdapter([
    {
      content: [
        { type: "tool_use", id: "tu-1", name: "data.fetch_a", input: {} },
        { type: "tool_use", id: "tu-2", name: "data.fetch_b", input: {} },
      ],
      stopReason: "tool_use",
      usage: { inputTokens: 100, outputTokens: 50 },
    },
    {
      content: [{ type: "text", text: "Done" }],
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
    },
  ]);

  const executor = new SkillExecutorImpl(adapter, toolMap);
  await executor.execute({
    skill: { ...mockSkill, tools: ["data"] },
    parameters: { NAME: "test" },
    messages: [{ role: "user", content: "fetch both" }],
    deploymentId: "dep-1",
    orgId: "org-1",
    trustScore: 80,
    trustLevel: "autonomous",
  });

  // Both reads should have overlapping execution windows (concurrent)
  expect(executionTimestamps).toHaveLength(2);
  const [a, b] = executionTimestamps;
  // Tool B should start before Tool A ends (parallel)
  expect(b!.start).toBeLessThan(a!.end);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --grep "concurrency-aware scheduling"`
Expected: FAIL — tools execute sequentially, so B starts after A ends

- [ ] **Step 3: Refactor skill-executor.ts to use ToolCallScheduler**

Replace the sequential `for...of` loop (lines 330-444 of `skill-executor.ts`) with the scheduler. The key changes:

Import the scheduler:

```typescript
import { ToolCallScheduler, type ScheduledToolCall } from "./tool-call-scheduler.js";
```

Replace the tool execution loop. The existing code at lines 329-446:

```typescript
const toolResults: Anthropic.ToolResultBlockParam[] = [];

for (const toolUse of toolUseBlocks) {
  // ... ~115 lines of sequential tool processing
}
```

Becomes:

```typescript
// Build scheduled calls with governance + validation baked in
const scheduledCalls: ScheduledToolCall[] = toolUseBlocks.map((toolUse) => {
  const [toolId, ...opParts] = toolUse.name.split(".");
  const operation = opParts.join(".");
  const tool = runtimeTools.get(toolId!);
  const op = tool?.operations[operation];

  return {
    id: toolUse.id,
    effectCategory: op?.effectCategory ?? ("read" as const),
    execute: async () => {
      const start = Date.now();
      const toolCtx = {
        toolId: toolId!,
        operation,
        params: toolUse.input,
        effectCategory: op?.effectCategory ?? ("read" as const),
        trustLevel: params.trustLevel,
      };
      const toolHookResult = await runBeforeToolCallHooks(this.hooks, toolCtx);

      let result: ToolResult;
      let governanceOutcome: string;

      if (!toolHookResult.proceed) {
        if (toolHookResult.substituteResult) {
          if (toolHookResult.decision) {
            throw new Error(
              `Hook invariant violated: substituteResult and decision are mutually exclusive (got decision=${toolHookResult.decision})`,
            );
          }
          result = toolHookResult.substituteResult;
          governanceOutcome = "simulated";
        } else if (toolHookResult.decision === "pending_approval") {
          result = pendingApproval(toolHookResult.reason ?? "Requires approval");
          governanceOutcome = "require-approval";
        } else {
          result = denied(toolHookResult.reason ?? "Denied by policy");
          governanceOutcome = "denied";
        }
      } else if (op) {
        const validation = validateToolInput(op.inputSchema, toolUse.input);
        if (!validation.ok) {
          console.warn(
            `[SkillExecutor] tool_input_invalid: ${toolUse.name} issues=${validation.issues
              .join("; ")
              .slice(0, 200)} redacted=${redactInputForLog(toolUse.input)}`,
          );
          result = fail(
            "execution",
            "INVALID_TOOL_INPUT",
            `Tool input did not match declared schema: ${validation.issues.join("; ")}`,
            {
              modelRemediation:
                "Re-issue the tool call with input matching the declared inputSchema. Do not include trust-bound identifiers (orgId, deploymentId) — those are injected by the runtime.",
              retryable: false,
            },
          );
          governanceOutcome = "auto-approved";
        } else {
          result = await op.execute(toolUse.input);
          governanceOutcome = "auto-approved";
        }
      } else {
        const availableTools = params.skill.tools
          .flatMap((tid) => {
            const t = runtimeTools.get(tid);
            return t ? Object.keys(t.operations).map((opN) => `${tid}.${opN}`) : [];
          })
          .join(", ");
        result = fail("execution", "TOOL_NOT_FOUND", `Unknown tool: ${toolUse.name}`, {
          modelRemediation: `Available tools for this skill: ${availableTools}`,
          retryable: false,
        });
        governanceOutcome = "auto-approved";
      }

      await runAfterToolCallHooks(this.hooks, toolCtx, result);

      toolCallRecords.push({
        toolId: toolId!,
        operation,
        params: toolUse.input,
        result,
        durationMs: Date.now() - start,
        governanceDecision: governanceOutcome as ToolCallRecord["governanceDecision"],
      });

      console.warn(
        `[SkillExecutor] tool_call: ${toolUse.name} args=${JSON.stringify(toolUse.input).slice(0, 200)}`,
      );

      return { status: "ok" as const, data: result };
    },
  };
});

const scheduler = new ToolCallScheduler({
  maxBudget: this.policy.maxToolCalls - toolCallRecords.length,
});
const scheduledResults = await scheduler.execute(scheduledCalls);

const toolResults: Anthropic.ToolResultBlockParam[] = scheduledResults.map((sr) => {
  const result = sr.result.data as ToolResult;
  const toolUse = toolUseBlocks.find((tu) => tu.id === sr.id)!;
  const [toolId, ...opParts] = toolUse.name.split(".");
  const op = runtimeTools.get(toolId!)?.operations[opParts.join(".")];
  const decision = filterForReinjection(result, op ?? FALLBACK_READ_OP, DEFAULT_REINJECTION_POLICY);
  const wrappedContent = `<|tool-output|>\n${escapeSentinel(decision.content)}\n<|/tool-output|>`;
  return {
    type: "tool_result" as const,
    tool_use_id: sr.id,
    content: wrappedContent,
  };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --grep "concurrency-aware scheduling"`
Expected: PASS

- [ ] **Step 5: Run all existing skill executor tests**

Run: `pnpm --filter @switchboard/core test -- --grep "SkillExecutorImpl"`
Expected: All PASS — existing behavior unchanged

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skill-runtime/skill-executor.ts
git commit -m "$(cat <<'EOF'
feat(skill-runtime): integrate ToolCallScheduler into executor

Read-only tool calls execute concurrently within a single LLM turn.
Mutating tools remain serialized. Budget is reserved upfront per the
scheduler invariant. Results preserve original positional order.
EOF
)"
```

---

## PR-3: Outcome-informed context injection

### File Map

- Create: `packages/core/src/memory/outcome-pattern-extractor.ts` — pure helpers (Task 6)
- Create: `packages/core/src/memory/__tests__/outcome-pattern-extractor.test.ts`
- Modify: `packages/core/src/memory/compounding-service.ts` — write booked-outcome patterns to `DeploymentMemory.category="pattern"` (Task 6a)
- Modify: `packages/core/src/memory/extraction-prompts.ts` — extend existing extraction response with `patterns: string[]` (Task 6a)
- Modify: `packages/core/src/memory/__tests__/compounding-service.test.ts` — outcome write-path tests (Task 6a)
- Modify: `packages/core/src/memory/context-builder.ts` — extend `listHighConfidence` to return `lastSeenAt`, filter + format outcome patterns (Task 7)
- Modify: `packages/db/src/stores/prisma-deployment-memory-store.ts` — surface `lastSeenAt` column (Task 7)
- Modify: `packages/db/src/stores/__tests__/prisma-deployment-memory-store.test.ts` — ordering regression (Task 7)
- Modify: `packages/core/src/memory/__tests__/context-builder.test.ts` — outcome filtering tests (Task 7)
- Modify: `packages/core/src/skill-runtime/parameter-builder.ts` — add `SkillServices` slot for stateful composition deps (Task 8)
- Modify: `packages/core/src/skill-runtime/builders/alex.ts` — resolve `OUTCOME_PATTERNS` via `services.contextBuilder` (Task 8)
- Modify: `skills/alex/SKILL.md` — declare `OUTCOME_PATTERNS` parameter, plain `{{OUTCOME_PATTERNS}}` substitution (Task 8)

---

### Task 6: Add outcome-pattern extractor

**Files:**

- Create: `packages/core/src/memory/outcome-pattern-extractor.ts`
- Create: `packages/core/src/memory/__tests__/outcome-pattern-extractor.test.ts`

- [ ] **Step 1: Write the failing test — only booked outcomes produce patterns**

```typescript
// packages/core/src/memory/__tests__/outcome-pattern-extractor.test.ts
import { describe, it, expect } from "vitest";
import {
  shouldExtractOutcomePatterns,
  formatOutcomePatternsForContext,
  type OutcomePattern,
} from "../outcome-pattern-extractor.js";

describe("shouldExtractOutcomePatterns", () => {
  it("returns true for booked outcome", () => {
    expect(shouldExtractOutcomePatterns("booked")).toBe(true);
  });

  it("returns false for non-booked outcomes", () => {
    expect(shouldExtractOutcomePatterns("lost")).toBe(false);
    expect(shouldExtractOutcomePatterns("qualified")).toBe(false);
    expect(shouldExtractOutcomePatterns("info_request")).toBe(false);
    expect(shouldExtractOutcomePatterns("escalated")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --grep "shouldExtractOutcomePatterns"`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/memory/outcome-pattern-extractor.ts
import type { InteractionOutcome, DeploymentMemoryCategory } from "@switchboard/schemas";
import { SURFACING_THRESHOLD } from "@switchboard/schemas";

const BOOKED_OUTCOMES: Set<InteractionOutcome> = new Set(["booked"]);

export interface OutcomePattern {
  content: string;
  category: DeploymentMemoryCategory;
  confidence: number;
  sourceCount: number;
  lastSeenAt: Date;
}

export function shouldExtractOutcomePatterns(outcome: string): boolean {
  return BOOKED_OUTCOMES.has(outcome as InteractionOutcome);
}

export function filterSurfaceablePatterns(patterns: OutcomePattern[]): OutcomePattern[] {
  return patterns.filter(
    (p) =>
      p.sourceCount >= SURFACING_THRESHOLD.minSourceCount &&
      p.confidence >= SURFACING_THRESHOLD.minConfidence,
  );
}

export function formatOutcomePatternsForContext(patterns: OutcomePattern[]): string {
  if (patterns.length === 0) return "";

  const lines = [
    "## Patterns from successful bookings (advisory — do not override business facts or operator corrections)",
    "",
  ];

  for (const p of patterns) {
    lines.push(
      `- ${p.content} (confidence: ${(p.confidence * 100).toFixed(0)}%, observed ${p.sourceCount} times)`,
    );
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --grep "shouldExtractOutcomePatterns"`
Expected: PASS

- [ ] **Step 5: Write formatter tests**

```typescript
describe("formatOutcomePatternsForContext", () => {
  it("formats patterns with provenance metadata", () => {
    const patterns: OutcomePattern[] = [
      {
        content: "Customers ask about downtime before booking",
        category: "pattern",
        confidence: 0.82,
        sourceCount: 5,
        lastSeenAt: new Date(),
      },
    ];

    const result = formatOutcomePatternsForContext(patterns);

    expect(result).toContain("advisory");
    expect(result).toContain("do not override");
    expect(result).toContain("Customers ask about downtime");
    expect(result).toContain("82%");
    expect(result).toContain("5 times");
  });

  it("returns empty string for no patterns", () => {
    expect(formatOutcomePatternsForContext([])).toBe("");
  });
});

describe("filterSurfaceablePatterns", () => {
  it("filters out low-confidence patterns", () => {
    const patterns: OutcomePattern[] = [
      {
        content: "high",
        category: "pattern",
        confidence: 0.85,
        sourceCount: 5,
        lastSeenAt: new Date(),
      },
      {
        content: "low",
        category: "pattern",
        confidence: 0.3,
        sourceCount: 1,
        lastSeenAt: new Date(),
      },
    ];

    const result = filterSurfaceablePatterns(patterns);

    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("high");
  });

  it("requires both minSourceCount and minConfidence", () => {
    const patterns: OutcomePattern[] = [
      {
        content: "high-conf-low-count",
        category: "pattern",
        confidence: 0.9,
        sourceCount: 1,
        lastSeenAt: new Date(),
      },
      {
        content: "low-conf-high-count",
        category: "pattern",
        confidence: 0.3,
        sourceCount: 10,
        lastSeenAt: new Date(),
      },
    ];

    expect(filterSurfaceablePatterns(patterns)).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run all outcome pattern tests**

Run: `pnpm --filter @switchboard/core test -- --grep "outcome-pattern"`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/memory/outcome-pattern-extractor.ts packages/core/src/memory/__tests__/outcome-pattern-extractor.test.ts
git commit -m "$(cat <<'EOF'
feat(memory): add outcome-pattern extractor

Pure functions: shouldExtractOutcomePatterns (booked only),
filterSurfaceablePatterns (uses existing SURFACING_THRESHOLD),
formatOutcomePatternsForContext (with provenance metadata).
EOF
)"
```

---

### Task 6a: Wire outcome-pattern writes in compounding-service

**Why this task exists:** without writing booked-conversation patterns into `DeploymentMemory` with `category: "pattern"`, the `category === "pattern"` filter in Task 7's `ContextBuilder` always returns the empty set and the entire PR is a runtime no-op. The previous plan omitted this task; the spec ("What changes" first bullet) requires it.

**Constraint:** reuse the existing LLM extraction call in `processConversationEnd`. Do not add a second LLM call for pattern extraction — pull pattern candidates from the same extraction response that already produces `extractedFacts` and `questionsAsked`.

**Files:**

- Modify: `packages/core/src/memory/compounding-service.ts`
- Modify: `packages/core/src/memory/__tests__/compounding-service.test.ts`
- Modify: `packages/core/src/memory/extraction-prompts.ts` — add pattern candidates to the existing extraction response shape (if not already present)

- [ ] **Step 1: Write the failing test — booked event writes pattern memories**

```typescript
it("writes pattern-category memories when outcome is booked", async () => {
  const deps = createMockDeps();
  deps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);
  deps.deploymentMemoryStore.upsert = vi.fn().mockResolvedValue({
    id: "p-1",
    sourceCount: 1,
  });
  primeFaqExtractionLlm(deps, undefined, {
    patterns: ["Customers ask about downtime before booking laser treatment"],
  });
  deps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

  const service = new ConversationCompoundingService(deps);
  await service.processConversationEnd({ ...baseEvent, outcome: "booked" });

  expect(deps.deploymentMemoryStore.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      category: "pattern",
      content: "Customers ask about downtime before booking laser treatment",
    }),
  );
});
```

- [ ] **Step 2: Write the failing test — non-booked outcomes skip pattern writes**

```typescript
it("does not write pattern-category memories for non-booked outcomes", async () => {
  for (const outcome of ["lost", "qualified", "info_request", "escalated"] as const) {
    const deps = createMockDeps();
    deps.deploymentMemoryStore.findByCategory.mockResolvedValue([]);
    deps.deploymentMemoryStore.upsert = vi.fn().mockResolvedValue({ id: "p", sourceCount: 1 });
    primeFaqExtractionLlm(deps, undefined, {
      patterns: ["irrelevant since outcome is not booked"],
    });
    deps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

    const service = new ConversationCompoundingService(deps);
    await service.processConversationEnd({ ...baseEvent, outcome });

    const patternCalls = deps.deploymentMemoryStore.upsert.mock.calls.filter(
      (c) => c[0].category === "pattern",
    );
    expect(patternCalls).toHaveLength(0);
  }
});
```

- [ ] **Step 3: Write the failing test — repeated booked observations increment sourceCount via existing path**

```typescript
it("increments sourceCount on existing pattern entries instead of creating duplicates", async () => {
  const deps = createMockDeps();
  deps.deploymentMemoryStore.findByCategory.mockResolvedValue([
    {
      id: "p-existing",
      content: "Customers ask about downtime before booking laser treatment",
      category: "pattern",
      sourceCount: 2,
      confidence: 0.6,
      lastSeenAt: new Date(),
    },
  ]);
  deps.deploymentMemoryStore.incrementConfidence = vi.fn().mockResolvedValue({
    id: "p-existing",
    sourceCount: 3,
  });
  primeFaqExtractionLlm(deps, undefined, {
    patterns: ["Customers ask about downtime before booking laser treatment"],
  });
  deps.embeddingAdapter.embed.mockResolvedValue(new Array(1024).fill(0.1));

  const service = new ConversationCompoundingService(deps);
  await service.processConversationEnd({ ...baseEvent, outcome: "booked" });

  // Existing path increments rather than inserting a duplicate
  expect(deps.deploymentMemoryStore.incrementConfidence).toHaveBeenCalledWith(
    "p-existing",
    expect.any(Object),
  );
});
```

- [ ] **Step 4: Implement the pattern-write path**

Extend `processConversationEnd` (after the FAQ tracking block, before the function returns) to call a new private method `trackPattern(extracted.patterns[])` when `event.outcome === "booked"`. `trackPattern` should mirror the existing `trackQuestion` shape:

1. `findByCategory(orgId, deploymentId, "pattern")` to load existing pattern memories.
2. Use the existing similarity helper (embedding cosine, threshold matching the FAQ path) to decide insert-vs-increment.
3. If a near-duplicate exists, call `incrementConfidence(id, ...)` — confidence formula is the existing `computeConfidenceScore`.
4. Otherwise, call `upsert({ category: "pattern", content, confidence, sourceCount: 1, lastSeenAt: new Date(), ... })`.
5. Update `extractionResponseSchema` in `extraction-prompts.ts` to include a `patterns: string[]` array, parsed from the existing extraction LLM response. Do not add a second LLM call — extend the existing prompt and parsing.

**Constraint:** the pattern detection prompt should only ask the LLM for patterns when the conversation outcome is `booked`. For non-booked outcomes, `patterns: []` is passed through.

- [ ] **Step 5: Run all compounding tests**

Run: `pnpm --filter @switchboard/core test -- --run -t "CompoundingService"`
Expected: All PASS, including the 3 new tests above.

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/memory/compounding-service.ts packages/core/src/memory/extraction-prompts.ts packages/core/src/memory/__tests__/compounding-service.test.ts
git commit -m "$(cat <<'EOF'
feat(memory): write booked-outcome patterns into DeploymentMemory

When processConversationEnd sees outcome=booked, pattern candidates from
the existing extraction LLM call are upserted with category=pattern.
Repeated booked observations increment sourceCount via the existing
similarity-and-increment path used by FAQ tracking. No second LLM call.
EOF
)"
```

---

### Task 7: Wire outcome patterns into ContextBuilder

**Files:**

- Modify: `packages/core/src/memory/context-builder.ts`
- Modify: `packages/core/src/memory/__tests__/context-builder.test.ts`

- [ ] **Step 1: Write the failing test — outcome patterns included in built context**

Add to `packages/core/src/memory/__tests__/context-builder.test.ts`:

```typescript
it("includes formatted outcome patterns in built context", async () => {
  deps.deploymentMemoryStore.listHighConfidence.mockResolvedValue([
    {
      id: "m1",
      content: "Customers ask about downtime before booking laser treatment",
      category: "pattern",
      confidence: 0.85,
      sourceCount: 5,
      lastSeenAt: new Date(),
    },
  ]);

  const result = await builder.build({
    organizationId: "org-1",
    agentId: "agent-1",
    deploymentId: "dep-1",
    query: "Tell me about laser",
  });

  expect(result.learnedFacts).toHaveLength(1);
  expect(result.outcomePatternContext).toContain("advisory");
  expect(result.outcomePatternContext).toContain("downtime");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --grep "outcome patterns in built context"`
Expected: FAIL — `outcomePatternContext` not a property of `BuiltContext`

- [ ] **Step 3: Extend `listHighConfidence` to return `lastSeenAt`**

Real freshness data must come from `DeploymentMemory.lastSeenAt`, not be synthesized at read time. Update the store interface and implementation:

In `packages/core/src/memory/context-builder.ts`, change `ContextBuilderDeploymentMemoryStore`:

```typescript
export interface ContextBuilderDeploymentMemoryStore {
  listHighConfidence(
    organizationId: string,
    deploymentId: string,
    minConfidence: number,
    minSourceCount: number,
  ): Promise<
    Array<{
      id: string;
      content: string;
      category: string;
      confidence: number;
      sourceCount: number;
      lastSeenAt: Date;
    }>
  >;
}
```

Then update `packages/db/src/stores/prisma-deployment-memory-store.ts` `listHighConfidence` to `select` the `lastSeenAt` column.

**Ordering contract:** the returned list ordering must remain identical to today (confidence/sourceCount-based). Adding `lastSeenAt` to the projection must not change the `orderBy` clause. Add a regression test in the same task to pin this.

- [ ] **Step 4: Add ordering regression test**

```typescript
it("listHighConfidence ordering is unchanged after adding lastSeenAt projection", async () => {
  // Seed two memories with same confidence and sourceCount but different lastSeenAt.
  // The pre-existing ordering rule (confidence desc, then sourceCount desc) should
  // still hold; lastSeenAt must NOT become a tiebreaker.
  // ...assertion that pre-existing first-result remains first
});
```

This test goes in the `PrismaDeploymentMemoryStore` test file (or its integration test if mocked Prisma can't assert ordering). The point is: surfacing a new column from a query is the most common silent-ordering-change bug, and we want the test to catch it.

- [ ] **Step 5: Add outcomePatternContext to BuiltContext and wire formatting**

In `packages/core/src/memory/context-builder.ts`, add the import and field:

```typescript
import {
  filterSurfaceablePatterns,
  formatOutcomePatternsForContext,
  type OutcomePattern,
} from "./outcome-pattern-extractor.js";
```

Add to `BuiltContext` interface:

```typescript
export interface BuiltContext {
  retrievedChunks: ContextRetrievedChunk[];
  learnedFacts: ContextLearnedFact[];
  recentSummaries: ContextSummary[];
  outcomePatternContext: string;
  totalTokenEstimate: number;
}
```

At the end of the `build()` method, after populating `learnedFacts`, add:

```typescript
// Build outcome pattern context from high-confidence pattern-category memories.
// lastSeenAt comes from the store — do NOT synthesize it.
const outcomePatterns: OutcomePattern[] = memories
  .filter((m) => m.category === "pattern")
  .map((m) => ({
    content: m.content,
    category: m.category as OutcomePattern["category"],
    confidence: m.confidence,
    sourceCount: m.sourceCount,
    lastSeenAt: m.lastSeenAt,
  }));
const surfaceable = filterSurfaceablePatterns(outcomePatterns);
const outcomePatternContext = formatOutcomePatternsForContext(surfaceable);

return {
  retrievedChunks,
  learnedFacts,
  recentSummaries,
  outcomePatternContext,
  totalTokenEstimate: tokensUsed + estimateTokens(outcomePatternContext),
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --grep "outcome patterns in built context"`
Expected: PASS

- [ ] **Step 7: Write test — low-confidence patterns excluded**

```typescript
it("excludes low-confidence patterns from outcomePatternContext", async () => {
  deps.deploymentMemoryStore.listHighConfidence.mockResolvedValue([
    {
      id: "m1",
      content: "Weak signal",
      category: "pattern",
      confidence: 0.67,
      sourceCount: 2, // below SURFACING_THRESHOLD.minSourceCount (3)
      lastSeenAt: new Date(),
    },
  ]);

  const result = await builder.build({
    organizationId: "org-1",
    agentId: "agent-1",
    deploymentId: "dep-1",
    query: "test",
  });

  expect(result.outcomePatternContext).toBe("");
});
```

- [ ] **Step 8: Run all ContextBuilder tests**

Run: `pnpm --filter @switchboard/core test -- --grep "ContextBuilder"`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/memory/context-builder.ts packages/core/src/memory/__tests__/context-builder.test.ts packages/db/src/stores/prisma-deployment-memory-store.ts packages/db/src/stores/__tests__/prisma-deployment-memory-store.test.ts
git commit -m "$(cat <<'EOF'
feat(memory): wire outcome patterns into ContextBuilder

High-confidence pattern-category memories are filtered through
SURFACING_THRESHOLD and formatted as advisory context with provenance
metadata. Added to BuiltContext as outcomePatternContext. lastSeenAt
is sourced from the DeploymentMemory row, not synthesized. Ordering
of listHighConfidence is preserved via a regression test.
EOF
)"
```

---

### Task 8: Inject outcome context into Alex builder

**Files:**

- Modify: `packages/core/src/skill-runtime/parameter-builder.ts` — add `SkillServices` slot
- Modify: `packages/core/src/skill-runtime/builders/alex.ts`
- Modify: `skills/alex/SKILL.md`

**Architectural note:** `ContextBuilder` is a stateful service, not a per-call store. The existing `SkillStores` interface (lines 3-39 of `parameter-builder.ts`) holds thin repository-shaped objects (`opportunityStore`, `contactStore`, etc.) — adding a stateful composition service alongside them would muddle the abstraction. Instead, add a new `services` parameter to the `ParameterBuilder` signature alongside `stores`. This keeps the existing store contract clean and gives builders a typed place for orchestration dependencies.

- [ ] **Step 1: Add `SkillServices` slot to ParameterBuilder**

In `parameter-builder.ts`, add:

```typescript
import type { ContextBuilder } from "../memory/context-builder.js";

export interface SkillServices {
  contextBuilder?: ContextBuilder;
}

export type ParameterBuilder = (
  ctx: AgentContext,
  config: {
    deploymentId: string;
    orgId: string;
    contactId: string;
    phone?: string;
    channel?: string;
  },
  stores: SkillStores,
  services?: SkillServices,
) => Promise<Record<string, unknown>>;
```

Update all existing callers (parameter-resolution sites, test harnesses) to pass `services` (or `undefined` for now). Existing builders that don't use services keep their current signatures because `services` is optional.

- [ ] **Step 2: Wire `ContextBuilder` into the Alex builder dispatch path**

Find the call site that invokes `alexBuilder(ctx, config, stores)` and update it to pass `services: { contextBuilder }` where `contextBuilder` is constructed once at composition root (likely `gateway-bridge.ts`, alongside the existing `ConversationCompoundingService` construction PR-1 added). Reuse the same `knowledgeRetriever`, `deploymentMemoryStore`, and `interactionSummaryStore` instances; they are already wired.

- [ ] **Step 3: Add OUTCOME_PATTERNS resolution to alex builder**

In `packages/core/src/skill-runtime/builders/alex.ts`, after `BUSINESS_FACTS` is set, add:

```typescript
// Outcome-informed context (advisory, priority 4 — below business facts and operator corrections).
// Builder ALWAYS supplies OUTCOME_PATTERNS as a string so the template interpolation cannot
// leak an unrendered placeholder. Empty string when no patterns surface.
let OUTCOME_PATTERNS = "";
if (services?.contextBuilder) {
  const builtCtx = await services.contextBuilder.build({
    organizationId: config.orgId,
    agentId: "alex",
    deploymentId: config.deploymentId,
    query: (ctx.workUnit.parameters.message as string) ?? "",
    contactId: ctx.workUnit.parameters.contactId as string | undefined,
  });
  OUTCOME_PATTERNS = builtCtx.outcomePatternContext;
}
```

Add `OUTCOME_PATTERNS` to the returned parameters object. The builder owns rendering: patterns are already formatted as plain prompt text by `formatOutcomePatternsForContext`. Do not introduce any conditional template syntax.

- [ ] **Step 4: Add OUTCOME_PATTERNS placeholder in the Alex skill markdown**

In `skills/alex/SKILL.md`, declare `OUTCOME_PATTERNS` as an optional parameter and reference it inline:

```
{{OUTCOME_PATTERNS}}
```

placed after business facts and operator corrections, before generic instructions.

**Do not use Mustache section syntax** (`{{#...}}...{{/...}}`). The existing `interpolate()` template engine (`packages/core/src/skill-runtime/template-engine.ts`) only supports `{{PARAM}}` and `{{PARAM.field}}` replacement via a single regex — section markers would leak into the prompt as literal text. The "render nothing when empty" semantics come from the builder always passing an empty string when there's nothing to surface.

- [ ] **Step 5: Write the contract test — empty OUTCOME_PATTERNS renders cleanly**

```typescript
it("renders without unresolved placeholders when OUTCOME_PATTERNS is empty", async () => {
  const params = await alexBuilder(ctx, config, stores /* no services */);
  expect(params.OUTCOME_PATTERNS).toBe("");
  // ...assert downstream interpolate() emits no literal "{{OUTCOME_PATTERNS}}" or section markers
});
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 7: Run tests**

Run: `pnpm test`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/skill-runtime/parameter-builder.ts packages/core/src/skill-runtime/builders/alex.ts skills/alex/SKILL.md packages/core/src/skill-runtime/builders/alex.test.ts
git commit -m "$(cat <<'EOF'
feat(alex): inject outcome-informed patterns into skill context

Booked-outcome patterns are surfaced as advisory context at priority 4
(below safety, business facts, operator corrections, and customer
preferences). Patterns include provenance, confidence, and observation
count. No retrieval re-ranking or behavior forcing.

Adds SkillServices slot to ParameterBuilder for stateful composition
services (ContextBuilder), kept separate from per-call SkillStores.
Builder always supplies OUTCOME_PATTERNS as a string (empty when no
patterns surface) so plain {{OUTCOME_PATTERNS}} substitution renders
cleanly without Mustache section syntax.
EOF
)"
```

---

## PR-4: Provider-agnostic tool-calling adapter boundary

### File Map

- Create: `packages/core/src/skill-runtime/llm-types.ts` — provider-neutral type definitions
- Create: `packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts` — Anthropic implementation
- Create: `packages/core/src/skill-runtime/adapters/test-tool-adapter.ts` — test double
- Create: `packages/core/src/skill-runtime/__tests__/llm-types-contract.test.ts` — contract tests
- Modify: `packages/core/src/skill-runtime/skill-executor.ts` — use provider-neutral types
- Modify: `packages/core/src/skill-runtime/tool-calling-adapter.ts` — re-export for backward compat

---

### Task 9: Define provider-neutral types

**Files:**

- Create: `packages/core/src/skill-runtime/llm-types.ts`
- Create: `packages/core/src/skill-runtime/__tests__/llm-types-contract.test.ts`

- [ ] **Step 1: Write contract test — provider-neutral types are Anthropic-free**

```typescript
// packages/core/src/skill-runtime/__tests__/llm-types-contract.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("llm-types contract", () => {
  it("does not import from @anthropic-ai/sdk", () => {
    const source = readFileSync(join(__dirname, "../llm-types.ts"), "utf-8");
    expect(source).not.toContain("@anthropic-ai/sdk");
    expect(source).not.toContain("anthropic");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --grep "does not import from"`
Expected: FAIL — file not found

- [ ] **Step 3: Write provider-neutral type definitions**

```typescript
// packages/core/src/skill-runtime/llm-types.ts

// Provider-neutral types for the tool-calling adapter boundary.
// No provider SDK types may appear in this file.

export interface LLMTextBlock {
  type: "text";
  text: string;
}

export interface LLMToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export type LLMContentBlock = LLMTextBlock | LLMToolUseBlock;

export interface LLMToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type LLMMessageRole = "user" | "assistant";

export interface LLMMessage {
  role: LLMMessageRole;
  content: string | LLMContentBlock[] | LLMToolResultBlock[];
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type LLMStopReason = "end_turn" | "tool_use" | "max_tokens";

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  content: LLMContentBlock[];
  stopReason: LLMStopReason;
  usage: LLMUsage;
}

export interface LLMError {
  retryable: boolean;
  statusCode?: number;
  message: string;
  provider: string;
}

// LLMError is consumed by PR-4B's fallback router. PR-4 only defines the
// shape and proves the boundary; no runtime path consumes `retryable` yet.
export function isRetryableError(err: unknown): err is LLMError {
  return (
    typeof err === "object" &&
    err !== null &&
    "retryable" in err &&
    (err as LLMError).retryable === true
  );
}

// Thrown by adapter implementations when the provider returns a shape the
// adapter cannot translate (unknown stop reason, unknown content block type,
// etc). Surfaces the mismatch at the boundary instead of silently coercing.
export class LLMAdapterShapeMismatchError extends Error {
  constructor(
    public readonly provider: string,
    public readonly kind: "stop_reason" | "content_block",
    public readonly observed: string,
  ) {
    super(`[${provider}] unknown ${kind}: ${observed}`);
    this.name = "LLMAdapterShapeMismatchError";
  }
}

export interface ToolCallingLLMAdapter {
  chatWithTools(params: {
    system: string;
    messages: LLMMessage[];
    tools: LLMToolDefinition[];
    maxTokens?: number;
    profile?: { model: string; maxTokens: number; temperature: number; timeoutMs: number };
  }): Promise<LLMResponse>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --grep "does not import from"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/llm-types.ts packages/core/src/skill-runtime/__tests__/llm-types-contract.test.ts
git commit -m "$(cat <<'EOF'
feat(skill-runtime): define provider-neutral tool-calling types

LLMContentBlock, LLMMessage, LLMToolDefinition, LLMResponse, LLMError,
and ToolCallingLLMAdapter interface. No @anthropic-ai/sdk imports.
Contract test enforces this boundary.
EOF
)"
```

---

### Task 10: Implement Anthropic adapter against neutral types

**Files:**

- Create: `packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts`
- Create: `packages/core/src/skill-runtime/__tests__/anthropic-tool-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/skill-runtime/__tests__/anthropic-tool-adapter.test.ts
import { describe, it, expect, vi } from "vitest";
import { AnthropicToolAdapter } from "../adapters/anthropic-tool-adapter.js";
import type { LLMResponse, LLMMessage, LLMToolDefinition } from "../llm-types.js";

describe("AnthropicToolAdapter", () => {
  it("translates Anthropic response to provider-neutral LLMResponse", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "Hello" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      },
    };

    const adapter = new AnthropicToolAdapter(mockClient as never);
    const result: LLMResponse = await adapter.chatWithTools({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    });

    expect(result.stopReason).toBe("end_turn");
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
    expect(result.content[0]!.type).toBe("text");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --grep "translates Anthropic response"`
Expected: FAIL — module not found

- [ ] **Step 3: Write the Anthropic adapter**

```typescript
// packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts
import type Anthropic from "@anthropic-ai/sdk";
import {
  LLMAdapterShapeMismatchError,
  type ToolCallingLLMAdapter,
  type LLMMessage,
  type LLMToolDefinition,
  type LLMResponse,
  type LLMContentBlock,
  type LLMStopReason,
} from "../llm-types.js";

// Track current Anthropic model defaults centrally. Do not propagate the
// pre-existing stale `claude-sonnet-4-5-20250514` literal from
// tool-calling-adapter.ts into this new adapter — updating that legacy file's
// default is a separate cleanup outside PR-4 scope.
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 1024;
const PROVIDER = "anthropic";

const KNOWN_STOP_REASONS: ReadonlySet<LLMStopReason> = new Set([
  "end_turn",
  "tool_use",
  "max_tokens",
]);

export class AnthropicToolAdapter implements ToolCallingLLMAdapter {
  constructor(private client: Anthropic) {}

  async chatWithTools(params: {
    system: string;
    messages: LLMMessage[];
    tools: LLMToolDefinition[];
    maxTokens?: number;
    profile?: { model: string; maxTokens: number; temperature: number; timeoutMs: number };
  }): Promise<LLMResponse> {
    const anthropicMessages: Anthropic.MessageParam[] = params.messages.map((m) => ({
      role: m.role,
      content: m.content as Anthropic.MessageParam["content"],
    }));

    const anthropicTools: Anthropic.Tool[] | undefined =
      params.tools.length > 0
        ? params.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema as Anthropic.Tool.InputSchema,
          }))
        : undefined;

    const response = await this.client.messages.create({
      model: params.profile?.model ?? DEFAULT_MODEL,
      max_tokens: params.profile?.maxTokens ?? params.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: params.system,
      messages: anthropicMessages,
      tools: anthropicTools,
      ...(params.profile?.temperature !== undefined && {
        temperature: params.profile.temperature,
      }),
    });

    // Translate content blocks. Unknown block types MUST surface as a typed
    // adapter error — silent coercion to empty text hides provider mismatches.
    const content: LLMContentBlock[] = response.content.map((block) => {
      if (block.type === "text") {
        return { type: "text" as const, text: block.text };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input: block.input,
        };
      }
      throw new LLMAdapterShapeMismatchError(PROVIDER, "content_block", String(block.type));
    });

    // Translate stop_reason. Unknown reasons MUST surface — Anthropic adds
    // new ones (`refusal`, `pause_turn`, etc.) and silent coercion to "end_turn"
    // would hide premature stops.
    if (!KNOWN_STOP_REASONS.has(response.stop_reason as LLMStopReason)) {
      throw new LLMAdapterShapeMismatchError(
        PROVIDER,
        "stop_reason",
        String(response.stop_reason),
      );
    }

    return {
      content,
      stopReason: response.stop_reason as LLMStopReason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --grep "translates Anthropic response"`
Expected: PASS

- [ ] **Step 5: Add tool_use translation round-trip test**

The first test only covered a text-only response. The adapter's main job is translating `tool_use` blocks — pin that round-trip explicitly:

```typescript
it("round-trips tool_use blocks through provider-neutral types", async () => {
  const mockClient = {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          { type: "text", text: "Let me check that." },
          {
            type: "tool_use",
            id: "tu_abc123",
            name: "calendar.search",
            input: { date: "2026-05-20" },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 200, output_tokens: 75 },
      }),
    },
  };

  const adapter = new AnthropicToolAdapter(mockClient as never);
  const result = await adapter.chatWithTools({
    system: "You are helpful.",
    messages: [{ role: "user", content: "Find me a slot" }],
    tools: [
      {
        name: "calendar.search",
        description: "Search calendar",
        input_schema: { type: "object", properties: { date: { type: "string" } } },
      },
    ],
  });

  expect(result.stopReason).toBe("tool_use");
  expect(result.content).toHaveLength(2);
  expect(result.content[0]!.type).toBe("text");
  const toolUse = result.content[1]!;
  expect(toolUse.type).toBe("tool_use");
  if (toolUse.type === "tool_use") {
    expect(toolUse.id).toBe("tu_abc123");
    expect(toolUse.name).toBe("calendar.search");
    expect(toolUse.input).toEqual({ date: "2026-05-20" });
  }
});
```

- [ ] **Step 6: Add shape-mismatch error tests**

Both error paths must throw `LLMAdapterShapeMismatchError`, not coerce silently:

```typescript
it("throws LLMAdapterShapeMismatchError on unknown stop_reason", async () => {
  const mockClient = {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "x" }],
        stop_reason: "refusal", // unknown — Anthropic may add new reasons
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
  };

  const adapter = new AnthropicToolAdapter(mockClient as never);
  await expect(
    adapter.chatWithTools({ system: "s", messages: [{ role: "user", content: "x" }], tools: [] }),
  ).rejects.toThrow(/unknown stop_reason: refusal/);
});

it("throws LLMAdapterShapeMismatchError on unknown content block type", async () => {
  const mockClient = {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "server_thinking", text: "internal" }], // unknown
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
  };

  const adapter = new AnthropicToolAdapter(mockClient as never);
  await expect(
    adapter.chatWithTools({ system: "s", messages: [{ role: "user", content: "x" }], tools: [] }),
  ).rejects.toThrow(/unknown content_block: server_thinking/);
});
```

- [ ] **Step 7: Run all adapter tests**

Run: `pnpm --filter @switchboard/core test -- --grep "AnthropicToolAdapter"`
Expected: All PASS (4 tests: text-only, tool_use round-trip, unknown stop_reason, unknown content_block)

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts packages/core/src/skill-runtime/__tests__/anthropic-tool-adapter.test.ts
git commit -m "$(cat <<'EOF'
feat(skill-runtime): Anthropic adapter implementing neutral types

AnthropicToolAdapter translates between Anthropic SDK types and
provider-neutral LLMResponse/LLMMessage/LLMToolDefinition.
Anthropic SDK is imported only in this file.

Unknown stop reasons and unknown content block types throw a typed
LLMAdapterShapeMismatchError instead of being silently coerced — this
keeps provider mismatches visible to the executor.
EOF
)"
```

---

### Task 11: Implement test double adapter

**Files:**

- Create: `packages/core/src/skill-runtime/adapters/test-tool-adapter.ts`
- Test: `packages/core/src/skill-runtime/__tests__/test-tool-adapter.test.ts`

- [ ] **Step 1: Write the test double + its test**

```typescript
// packages/core/src/skill-runtime/adapters/test-tool-adapter.ts
import type {
  ToolCallingLLMAdapter,
  LLMMessage,
  LLMToolDefinition,
  LLMResponse,
} from "../llm-types.js";

export class TestToolAdapter implements ToolCallingLLMAdapter {
  private responses: LLMResponse[];
  private callIndex = 0;
  public readonly calls: Array<{
    system: string;
    messages: LLMMessage[];
    tools: LLMToolDefinition[];
  }> = [];

  constructor(responses: LLMResponse[]) {
    this.responses = responses;
  }

  async chatWithTools(params: {
    system: string;
    messages: LLMMessage[];
    tools: LLMToolDefinition[];
  }): Promise<LLMResponse> {
    this.calls.push({
      system: params.system,
      messages: params.messages,
      tools: params.tools,
    });

    if (this.callIndex >= this.responses.length) {
      throw new Error(
        `TestToolAdapter: no more responses (call ${this.callIndex + 1}, have ${this.responses.length})`,
      );
    }

    return this.responses[this.callIndex++]!;
  }
}
```

```typescript
// packages/core/src/skill-runtime/__tests__/test-tool-adapter.test.ts
import { describe, it, expect } from "vitest";
import { TestToolAdapter } from "../adapters/test-tool-adapter.js";
import type { LLMResponse } from "../llm-types.js";

describe("TestToolAdapter", () => {
  it("returns configured responses in sequence", async () => {
    const responses: LLMResponse[] = [
      {
        content: [{ type: "text", text: "Hello" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ];

    const adapter = new TestToolAdapter(responses);
    const result = await adapter.chatWithTools({
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });

    expect(result.content[0]!.type).toBe("text");
    expect(adapter.calls).toHaveLength(1);
  });

  it("throws when responses exhausted", async () => {
    const adapter = new TestToolAdapter([]);
    await expect(
      adapter.chatWithTools({ system: "test", messages: [], tools: [] }),
    ).rejects.toThrow("no more responses");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @switchboard/core test -- --grep "TestToolAdapter"`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/skill-runtime/adapters/test-tool-adapter.ts packages/core/src/skill-runtime/__tests__/test-tool-adapter.test.ts
git commit -m "$(cat <<'EOF'
feat(skill-runtime): add TestToolAdapter for provider-neutral testing

Returns canned LLMResponse sequences. Records calls for assertions.
Proves the ToolCallingLLMAdapter interface works with a non-Anthropic
implementation.
EOF
)"
```

---

### Task 12: Migrate skill executor to provider-neutral types

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts`
- Create: `packages/core/src/skill-runtime/__tests__/executor-no-anthropic-imports.test.ts`

- [ ] **Step 1: Write the contract test — executor imports no Anthropic SDK types**

```typescript
// packages/core/src/skill-runtime/__tests__/executor-no-anthropic-imports.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("skill-executor Anthropic decoupling", () => {
  it("does not import @anthropic-ai/sdk", () => {
    const source = readFileSync(join(__dirname, "../skill-executor.ts"), "utf-8");
    expect(source).not.toContain("@anthropic-ai/sdk");
  });

  it("does not reference Anthropic namespace types", () => {
    const source = readFileSync(join(__dirname, "../skill-executor.ts"), "utf-8");
    expect(source).not.toMatch(/Anthropic\./);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --grep "does not import @anthropic-ai/sdk"`
Expected: FAIL — `skill-executor.ts` currently has `import type Anthropic from "@anthropic-ai/sdk"` and multiple `Anthropic.` references

- [ ] **Step 3: Migrate skill-executor.ts to use provider-neutral types**

Replace all Anthropic types with provider-neutral equivalents:

1. Remove `import type Anthropic from "@anthropic-ai/sdk";`
2. Add `import type { LLMContentBlock, LLMTextBlock, LLMToolUseBlock, LLMMessage, LLMToolDefinition, LLMToolResultBlock, ToolCallingLLMAdapter } from "./llm-types.js";`
3. Change constructor's `adapter` type from `ToolCallingAdapter` to `ToolCallingLLMAdapter`
4. Replace `Anthropic.MessageParam` with `LLMMessage`
5. Replace `Anthropic.Tool` with `LLMToolDefinition`
6. Replace `Anthropic.TextBlock` with `LLMTextBlock`
7. Replace `Anthropic.ToolUseBlock` with `LLMToolUseBlock`
8. Replace `Anthropic.ToolResultBlockParam` with `LLMToolResultBlock`
9. Replace `Anthropic.Tool.InputSchema` with `Record<string, unknown>`

Update `buildAnthropicTools` to `buildToolDefinitions`:

```typescript
  private buildToolDefinitions(toolIds: string[]): LLMToolDefinition[] {
    const result: LLMToolDefinition[] = [];
    for (const toolId of toolIds) {
      const tool = this.tools.get(toolId);
      if (!tool) continue;
      for (const [opName, op] of Object.entries(tool.operations)) {
        result.push({
          name: `${toolId}.${opName}`,
          description: op.description,
          input_schema: op.inputSchema,
        });
      }
    }
    return result;
  }
```

- [ ] **Step 4: Run contract test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --grep "does not import @anthropic-ai/sdk"`
Expected: PASS

- [ ] **Step 5: Run all existing executor tests**

Run: `pnpm --filter @switchboard/core test -- --grep "SkillExecutorImpl"`
Expected: All PASS (existing tests need their mock adapter updated to return provider-neutral types)

- [ ] **Step 6: Update existing test mocks if needed**

The `createMockAdapter()` in `skill-executor.test.ts` returns Anthropic-typed responses. Update it to return provider-neutral `LLMResponse` types. The shape is the same (text blocks, tool_use blocks) — only the TypeScript types change.

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 8: Run full test suite**

Run: `pnpm test`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/skill-runtime/skill-executor.ts packages/core/src/skill-runtime/__tests__/executor-no-anthropic-imports.test.ts packages/core/src/skill-runtime/skill-executor.test.ts
git commit -m "$(cat <<'EOF'
feat(skill-runtime): decouple executor from Anthropic SDK types

skill-executor.ts now uses provider-neutral LLMMessage, LLMContentBlock,
LLMToolDefinition, and ToolCallingLLMAdapter. Anthropic SDK types are
confined to adapters/anthropic-tool-adapter.ts. Contract test enforces
no @anthropic-ai/sdk imports in the executor.
EOF
)"
```

---

### Task 13: Backward-compatible re-export + cleanup

**Files:**

- Modify: `packages/core/src/skill-runtime/tool-calling-adapter.ts`

- [ ] **Step 1: Update tool-calling-adapter.ts for backward compatibility**

Keep the existing file as a re-export shim so callers that import from `tool-calling-adapter.ts` continue to work:

```typescript
// packages/core/src/skill-runtime/tool-calling-adapter.ts
//
// Backward-compatibility re-exports. New code should import from
// llm-types.ts (provider-neutral) or adapters/anthropic-tool-adapter.ts.

export type { ToolCallingLLMAdapter as ToolCallingAdapter } from "./llm-types.js";
export type { LLMResponse as ToolCallingAdapterResponse } from "./llm-types.js";
export { AnthropicToolAdapter as AnthropicToolCallingAdapter } from "./adapters/anthropic-tool-adapter.js";
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors — callers importing from `tool-calling-adapter.ts` get the same shapes

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skill-runtime/tool-calling-adapter.ts
git commit -m "$(cat <<'EOF'
refactor(skill-runtime): re-export provider-neutral types from adapter shim

tool-calling-adapter.ts now re-exports from llm-types.ts and
adapters/anthropic-tool-adapter.ts for backward compatibility.
EOF
)"
```

---

## PR-4B preview (deferred — separate brainstorm)

Out of scope for this plan. PR-4 stops at the type boundary; PR-4B picks up the runtime work needed to actually deliver Anthropic-outage resilience. Listed here so reviewers know which scope was cut and where it goes.

PR-4B work (high-level — not task-decomposed yet):

- Fallback router that consumes `isRetryableError` / `LLMError` and switches providers on eligible failures (timeout, 5xx, rate-limit, unavailable).
- Feature flag gating fallback (off by default, enable per-deployment).
- Pick a first real fallback provider (likely OpenAI for tool-calling parity) and ship a concrete adapter.
- Migrate `packages/core/src/agent-runtime/anthropic-adapter.ts` (chat-reply path, used by `ConversationCompoundingService`) to share the same neutral boundary so resilience covers both paths, not just skill-runtime tool calls.
- Clean up the legacy `claude-sonnet-4-5-20250514` literal in `packages/core/src/skill-runtime/tool-calling-adapter.ts` (which is now a backward-compat shim per PR-4 Task 13) and any other stragglers.

PR-4B should get its own design spec + plan before implementation. Do not extend this plan with PR-4B tasks.
