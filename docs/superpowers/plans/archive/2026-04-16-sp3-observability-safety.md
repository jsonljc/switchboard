# SP3: Execution Traces + Lightweight Safety Gates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every skill execution inspectable and safe — persist traces, link to business outcomes, and stop misbehaving agents before they cause damage.

**Architecture:** The executor computes raw trace data (duration, status, writeCount, governanceDecisions) and returns it alongside the existing result. The handler assembles the full trace (adding deployment/org/session context), persists it, then runs outcome linking. Circuit breaker and blast radius checks run before execution as pre-flight safety gates. All safety queries hit the trace store's indexed columns.

**Tech Stack:** TypeScript (ESM), Vitest, Prisma (PostgreSQL), Fastify, Next.js 14, TanStack React Query, `@paralleldrive/cuid2` for trace IDs, `node:crypto` for parameter hashing.

**Spec:** `docs/superpowers/specs/2026-04-15-sp3-observability-safety-design.md`

---

### Task 1: Prisma Model + Migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

Add the `ExecutionTrace` model and safety fields on `AgentDeployment`.

- [ ] **Step 1: Add ExecutionTrace model to schema.prisma**

After the `ActivityLog` model (around line 590), add:

```prisma
// ---------------------------------------------------------------------------
// Execution Traces (SP3)
// ---------------------------------------------------------------------------

model ExecutionTrace {
  id                   String    @id @default(cuid())
  deploymentId         String
  organizationId       String
  skillSlug            String
  skillVersion         String

  trigger              String    @default("chat_message")
  sessionId            String
  inputParametersHash  String

  toolCalls            Json      @default("[]")
  governanceDecisions  Json      @default("[]")
  tokenUsage           Json      @default("{}")
  durationMs           Int
  turnCount            Int

  status               String
  error                String?
  responseSummary      String

  linkedOutcomeId      String?
  linkedOutcomeType    String?
  linkedOutcomeResult  String?

  writeCount           Int       @default(0)

  createdAt            DateTime  @default(now())

  @@index([deploymentId, createdAt])
  @@index([organizationId, createdAt])
  @@index([status])
  @@index([sessionId])
}
```

- [ ] **Step 2: Add safety fields to AgentDeployment**

In the `AgentDeployment` model (around line 807), add after `skillSlug`:

```prisma
  circuitBreakerThreshold  Int?
  maxWritesPerHour          Int?
```

- [ ] **Step 3: Generate migration**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 db:generate`
Expected: Prisma client generated successfully.

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/db exec prisma migrate dev --name add_execution_trace`
Expected: Migration created and applied.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/
git commit -m "$(cat <<'EOF'
feat: add ExecutionTrace model and AgentDeployment safety fields
EOF
)"
```

---

### Task 2: Trace Types in Core

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts`

Add `SkillExecutionTraceData` type and update `SkillExecutionResult` to include trace data. The handler-owned `SkillExecutionTrace` type also lives here.

- [ ] **Step 1: Add trace types to types.ts**

After the `ToolCallRecord` interface (line 71), add:

```typescript
// ---------------------------------------------------------------------------
// Execution Trace (SP3)
// ---------------------------------------------------------------------------

export interface SkillExecutionTraceData {
  durationMs: number;
  turnCount: number;
  status: "success" | "error" | "budget_exceeded" | "denied";
  error?: string;
  responseSummary: string;
  writeCount: number;
  governanceDecisions: GovernanceLogEntry[];
}

export interface SkillExecutionTrace {
  id: string;
  deploymentId: string;
  organizationId: string;
  skillSlug: string;
  skillVersion: string;
  trigger: "chat_message" | "batch_job";
  sessionId: string;
  inputParametersHash: string;
  toolCalls: ToolCallRecord[];
  governanceDecisions: GovernanceLogEntry[];
  tokenUsage: { input: number; output: number };
  durationMs: number;
  turnCount: number;
  status: "success" | "error" | "budget_exceeded" | "denied";
  error?: string;
  responseSummary: string;
  linkedOutcomeId?: string;
  linkedOutcomeType?: "opportunity" | "task" | "campaign";
  linkedOutcomeResult?: string;
  writeCount: number;
  createdAt: Date;
}
```

- [ ] **Step 2: Update SkillExecutionResult**

Change the existing `SkillExecutionResult` interface (line 58) to add the `trace` field:

```typescript
export interface SkillExecutionResult {
  response: string;
  toolCalls: ToolCallRecord[];
  tokenUsage: { input: number; output: number };
  trace: SkillExecutionTraceData;
}
```

- [ ] **Step 3: Add import for GovernanceLogEntry**

The file already imports `GovernanceTier`, `GovernanceOutcome`, `TrustLevel`, `GovernanceDecision` from `./governance.js`. Add `GovernanceLogEntry` to that import:

```typescript
import type {
  GovernanceTier,
  GovernanceOutcome,
  TrustLevel,
  GovernanceDecision,
  GovernanceLogEntry,
} from "./governance.js";
```

- [ ] **Step 4: Run typecheck to see what breaks**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core exec tsc --noEmit`
Expected: FAIL — `SkillExecutorImpl` and tests don't return `trace` field yet. That's expected; we fix it in Task 4.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/types.ts
git commit -m "$(cat <<'EOF'
feat: add SkillExecutionTrace and SkillExecutionTraceData types
EOF
)"
```

---

### Task 3: ExecutionTraceStore

**Files:**

- Create: `packages/db/src/stores/prisma-execution-trace-store.ts`
- Create: `packages/db/src/stores/prisma-execution-trace-store.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/db/src/stores/prisma-execution-trace-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaExecutionTraceStore } from "./prisma-execution-trace-store.js";

function makeTrace(overrides: Record<string, unknown> = {}) {
  return {
    id: "trace-1",
    deploymentId: "d1",
    organizationId: "org1",
    skillSlug: "sales-pipeline",
    skillVersion: "1.0.0",
    trigger: "chat_message" as const,
    sessionId: "session-1",
    inputParametersHash: "abc123",
    toolCalls: [],
    governanceDecisions: [],
    tokenUsage: { input: 100, output: 50 },
    durationMs: 1500,
    turnCount: 2,
    status: "success" as const,
    responseSummary: "Qualified lead, moved to quoted stage",
    writeCount: 1,
    createdAt: new Date(),
    ...overrides,
  };
}

function makePrisma() {
  return {
    executionTrace: {
      create: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(0),
    },
  } as any;
}

describe("PrismaExecutionTraceStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaExecutionTraceStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaExecutionTraceStore(prisma);
  });

  describe("create", () => {
    it("persists a trace", async () => {
      const trace = makeTrace();
      await store.create(trace);
      expect(prisma.executionTrace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: "trace-1",
          deploymentId: "d1",
          skillSlug: "sales-pipeline",
          status: "success",
        }),
      });
    });
  });

  describe("listByDeployment", () => {
    it("queries by orgId and deploymentId", async () => {
      prisma.executionTrace.findMany.mockResolvedValue([makeTrace()]);
      const result = await store.listByDeployment("org1", "d1", { limit: 10 });
      expect(prisma.executionTrace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "org1", deploymentId: "d1" },
          orderBy: { createdAt: "desc" },
          take: 11,
        }),
      );
      expect(result.traces).toHaveLength(1);
    });

    it("returns nextCursor when more results exist", async () => {
      const traces = Array.from({ length: 11 }, (_, i) =>
        makeTrace({ id: `trace-${i}`, createdAt: new Date(2026, 0, i + 1) }),
      );
      prisma.executionTrace.findMany.mockResolvedValue(traces);
      const result = await store.listByDeployment("org1", "d1", { limit: 10 });
      expect(result.traces).toHaveLength(10);
      expect(result.nextCursor).toBe("trace-9");
    });
  });

  describe("findById", () => {
    it("returns trace when found", async () => {
      const trace = makeTrace();
      prisma.executionTrace.findFirst.mockResolvedValue(trace);
      const result = await store.findById("org1", "trace-1");
      expect(result).toEqual(trace);
      expect(prisma.executionTrace.findFirst).toHaveBeenCalledWith({
        where: { id: "trace-1", organizationId: "org1" },
      });
    });

    it("returns null when not found", async () => {
      const result = await store.findById("org1", "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("linkOutcome", () => {
    it("updates trace with outcome", async () => {
      await store.linkOutcome("trace-1", {
        id: "opp-1",
        type: "opportunity",
        result: "stage_qualified",
      });
      expect(prisma.executionTrace.update).toHaveBeenCalledWith({
        where: { id: "trace-1" },
        data: {
          linkedOutcomeId: "opp-1",
          linkedOutcomeType: "opportunity",
          linkedOutcomeResult: "stage_qualified",
        },
      });
    });
  });

  describe("countRecentFailures", () => {
    it("counts traces with error/budget_exceeded status in window", async () => {
      prisma.executionTrace.count.mockResolvedValue(3);
      const result = await store.countRecentFailures("d1", 3_600_000);
      expect(result).toBe(3);
      expect(prisma.executionTrace.count).toHaveBeenCalledWith({
        where: {
          deploymentId: "d1",
          status: { in: ["error", "budget_exceeded"] },
          createdAt: { gte: expect.any(Date) },
        },
      });
    });
  });

  describe("countWritesInWindow", () => {
    it("sums writeCount for traces in window", async () => {
      prisma.executionTrace.findMany.mockResolvedValue([
        makeTrace({ writeCount: 3 }),
        makeTrace({ writeCount: 7 }),
      ]);
      const result = await store.countWritesInWindow("d1", 3_600_000);
      expect(result).toBe(10);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/db test -- --run src/stores/prisma-execution-trace-store.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the implementation**

```typescript
// packages/db/src/stores/prisma-execution-trace-store.ts
import type { PrismaDbClient } from "../prisma-db.js";
import type { SkillExecutionTrace } from "@switchboard/core";

export class PrismaExecutionTraceStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(trace: SkillExecutionTrace): Promise<void> {
    await this.prisma.executionTrace.create({
      data: {
        id: trace.id,
        deploymentId: trace.deploymentId,
        organizationId: trace.organizationId,
        skillSlug: trace.skillSlug,
        skillVersion: trace.skillVersion,
        trigger: trace.trigger,
        sessionId: trace.sessionId,
        inputParametersHash: trace.inputParametersHash,
        toolCalls: trace.toolCalls as unknown as Record<string, unknown>[],
        governanceDecisions: trace.governanceDecisions as unknown as Record<string, unknown>[],
        tokenUsage: trace.tokenUsage as unknown as Record<string, unknown>,
        durationMs: trace.durationMs,
        turnCount: trace.turnCount,
        status: trace.status,
        error: trace.error,
        responseSummary: trace.responseSummary,
        writeCount: trace.writeCount,
        createdAt: trace.createdAt,
      },
    });
  }

  async listByDeployment(
    orgId: string,
    deploymentId: string,
    opts: { limit: number; cursor?: string },
  ): Promise<{ traces: SkillExecutionTrace[]; nextCursor?: string }> {
    const rows = await this.prisma.executionTrace.findMany({
      where: { organizationId: orgId, deploymentId },
      orderBy: { createdAt: "desc" },
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > opts.limit;
    const traces = (hasMore ? rows.slice(0, opts.limit) : rows) as unknown as SkillExecutionTrace[];
    const nextCursor = hasMore ? traces[traces.length - 1]!.id : undefined;

    return { traces, nextCursor };
  }

  async findById(orgId: string, traceId: string): Promise<SkillExecutionTrace | null> {
    const row = await this.prisma.executionTrace.findFirst({
      where: { id: traceId, organizationId: orgId },
    });
    return row as unknown as SkillExecutionTrace | null;
  }

  async linkOutcome(
    traceId: string,
    outcome: { id: string; type: "opportunity" | "task" | "campaign"; result: string },
  ): Promise<void> {
    await this.prisma.executionTrace.update({
      where: { id: traceId },
      data: {
        linkedOutcomeId: outcome.id,
        linkedOutcomeType: outcome.type,
        linkedOutcomeResult: outcome.result,
      },
    });
  }

  async countRecentFailures(deploymentId: string, windowMs: number): Promise<number> {
    const since = new Date(Date.now() - windowMs);
    return this.prisma.executionTrace.count({
      where: {
        deploymentId,
        status: { in: ["error", "budget_exceeded"] },
        createdAt: { gte: since },
      },
    });
  }

  async countWritesInWindow(deploymentId: string, windowMs: number): Promise<number> {
    const since = new Date(Date.now() - windowMs);
    const rows = await this.prisma.executionTrace.findMany({
      where: {
        deploymentId,
        writeCount: { gt: 0 },
        createdAt: { gte: since },
      },
      select: { writeCount: true },
    });
    return rows.reduce((sum, r) => sum + r.writeCount, 0);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/db test -- --run src/stores/prisma-execution-trace-store.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-execution-trace-store.ts packages/db/src/stores/prisma-execution-trace-store.test.ts
git commit -m "$(cat <<'EOF'
feat: add PrismaExecutionTraceStore with 6 query methods
EOF
)"
```

---

### Task 4: Executor Trace Emission

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts`
- Modify: `packages/core/src/skill-runtime/skill-executor.test.ts`

Update the executor to compute `SkillExecutionTraceData` and return it in the result.

- [ ] **Step 1: Add trace data test to skill-executor.test.ts**

Add this test to the existing `describe("SkillExecutorImpl")` block:

```typescript
it("returns trace data with execution metadata", async () => {
  const adapter = createMockAdapter([
    {
      content: [{ type: "text", text: "Hi there" }],
      stop_reason: "end_turn",
    },
  ]);

  const executor = new SkillExecutorImpl(adapter, new Map());
  const result = await executor.execute({
    skill: mockSkill,
    parameters: { NAME: "Alice" },
    messages: [{ role: "user", content: "hello" }],
    deploymentId: "d1",
    orgId: "org1",
    trustScore: 50,
    trustLevel: "guided",
  });

  expect(result.trace).toBeDefined();
  expect(result.trace.status).toBe("success");
  expect(result.trace.turnCount).toBe(1);
  expect(result.trace.durationMs).toBeGreaterThanOrEqual(0);
  expect(result.trace.writeCount).toBe(0);
  expect(result.trace.responseSummary).toBe("Hi there");
  expect(result.trace.governanceDecisions).toEqual([]);
});

it("counts writes in trace data", async () => {
  const writeTool: SkillTool = {
    id: "crm-write",
    operations: {
      "stage.update": {
        description: "update stage",
        inputSchema: { type: "object", properties: {} },
        governanceTier: "internal_write" as any,
        execute: vi.fn().mockResolvedValue({ stage: "qualified" }),
      },
    },
  };

  const toolSkill: SkillDefinition = {
    ...mockSkill,
    tools: ["crm-write"],
    body: "Update stage {{NAME}}",
  };

  const adapter = createMockAdapter([
    {
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "crm-write.stage.update",
          input: { stage: "qualified" },
        },
      ],
      stop_reason: "tool_use",
    },
    {
      content: [{ type: "text", text: "Stage updated." }],
      stop_reason: "end_turn",
    },
  ]);

  const executor = new SkillExecutorImpl(adapter, new Map([["crm-write", writeTool]]));
  const result = await executor.execute({
    skill: toolSkill,
    parameters: { NAME: "X" },
    messages: [{ role: "user", content: "update" }],
    deploymentId: "d1",
    orgId: "org1",
    trustScore: 50,
    trustLevel: "guided",
  });

  expect(result.trace.writeCount).toBe(1);
  expect(result.trace.governanceDecisions).toHaveLength(1);
  expect(result.trace.governanceDecisions[0]!.tier).toBe("internal_write");
});

it("sets error status in trace when budget exceeded", async () => {
  const adapter = createMockAdapter(
    Array.from({ length: 7 }, () => ({
      content: [{ type: "tool_use" as const, id: "t1", name: "crm-query.contact.get", input: {} }],
      stop_reason: "tool_use",
    })),
  );

  const queryTool: SkillTool = {
    id: "crm-query",
    operations: {
      "contact.get": {
        description: "get contact",
        inputSchema: { type: "object", properties: {} },
        governanceTier: "read" as any,
        execute: vi.fn().mockResolvedValue({ id: "c1" }),
      },
    },
  };

  const toolSkill: SkillDefinition = {
    ...mockSkill,
    tools: ["crm-query"],
    body: "Query contact {{NAME}}",
  };

  const executor = new SkillExecutorImpl(adapter, new Map([["crm-query", queryTool]]));

  await expect(
    executor.execute({
      skill: toolSkill,
      parameters: { NAME: "X" },
      messages: [{ role: "user", content: "query" }],
      deploymentId: "d1",
      orgId: "org1",
      trustScore: 50,
      trustLevel: "guided",
    }),
  ).rejects.toThrow(SkillExecutionBudgetError);
});
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/skill-executor.test.ts`
Expected: FAIL — `result.trace` is undefined.

- [ ] **Step 3: Update the executor to compute and return trace data**

Three surgical changes to `packages/core/src/skill-runtime/skill-executor.ts`. Do NOT restructure the method — just add code at three insertion points.

**Change A — Add import at top:**

```typescript
import type { GovernanceLogEntry } from "./governance.js";
```

**Change B — Add governance log array after existing variable declarations (after line 40, the `const startTime = Date.now();` line):**

```typescript
const governanceLogs: GovernanceLogEntry[] = [];
```

Then inside the tool call loop, after `const governanceDecision = op ? getToolGovernanceDecision(op, params.trustLevel) : "auto-approve";` (line 109), add:

```typescript
if (op) {
  governanceLogs.push({
    operationId: `${toolId}.${operation}`,
    tier: op.governanceTier,
    trustLevel: params.trustLevel,
    decision: governanceDecision,
    overridden: !!op.governanceOverride?.[params.trustLevel],
    timestamp: new Date().toISOString(),
  });
}
```

**Change C — In the success return block (the `if (response.stopReason === "end_turn" || ...)` block around line 77), add `trace` to the return object:**

Replace the existing return statement with:

```typescript
const responseText = response.content
  .filter((b): b is Anthropic.TextBlock => b.type === "text")
  .map((b) => b.text)
  .join("");

return {
  response: responseText,
  toolCalls: toolCallRecords,
  tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
  trace: {
    durationMs: Date.now() - startTime,
    turnCount,
    status: "success" as const,
    responseSummary: responseText.slice(0, 500),
    writeCount: toolCallRecords.filter((tc) => {
      const tool = this.tools.get(tc.toolId);
      const opDef = tool?.operations[tc.operation];
      return (
        opDef?.governanceTier === "internal_write" || opDef?.governanceTier === "external_write"
      );
    }).length,
    governanceDecisions: governanceLogs,
  },
};
```

**Budget errors still throw `SkillExecutionBudgetError` — no change needed.** The executor only returns trace data on the success path. The handler (Task 7) catches budget errors and records error traces externally.

- [ ] **Step 4: Update existing tests to expect trace field**

All existing tests that check `result.response` also need to handle the new `trace` field. Update the first test's assertion to also check `result.trace`:

```typescript
expect(result.trace).toBeDefined();
expect(result.trace.status).toBe("success");
```

For the existing tool-call test (the one testing `crm-write.stage.update`), add `governanceTier: "internal_write" as any` to the mock tool operation if not already present.

- [ ] **Step 5: Run all executor tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/skill-executor.test.ts`
Expected: PASS (all existing + 3 new tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/skill-executor.ts packages/core/src/skill-runtime/skill-executor.test.ts
git commit -m "$(cat <<'EOF'
feat: executor computes and returns SkillExecutionTraceData
EOF
)"
```

---

### Task 5: Circuit Breaker + Blast Radius Limiter

**Files:**

- Create: `packages/core/src/skill-runtime/circuit-breaker.ts`
- Create: `packages/core/src/skill-runtime/circuit-breaker.test.ts`
- Create: `packages/core/src/skill-runtime/blast-radius-limiter.ts`
- Create: `packages/core/src/skill-runtime/blast-radius-limiter.test.ts`

- [ ] **Step 1: Write circuit breaker tests**

```typescript
// packages/core/src/skill-runtime/circuit-breaker.test.ts
import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "./circuit-breaker.js";

function makeStore(failureCount: number) {
  return { countRecentFailures: vi.fn().mockResolvedValue(failureCount) } as any;
}

describe("CircuitBreaker", () => {
  it("allows execution when failure count is below threshold", async () => {
    const cb = new CircuitBreaker(makeStore(2));
    const result = await cb.check("d1");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("blocks execution when failure count meets threshold", async () => {
    const cb = new CircuitBreaker(makeStore(5));
    const result = await cb.check("d1");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Circuit breaker");
    expect(result.reason).toContain("5 failures");
  });

  it("blocks execution when failure count exceeds threshold", async () => {
    const cb = new CircuitBreaker(makeStore(10));
    const result = await cb.check("d1");
    expect(result.allowed).toBe(false);
  });

  it("uses custom config", async () => {
    const store = makeStore(2);
    const cb = new CircuitBreaker(store, { maxFailuresInWindow: 2, windowMs: 600_000 });
    const result = await cb.check("d1");
    expect(result.allowed).toBe(false);
    expect(store.countRecentFailures).toHaveBeenCalledWith("d1", 600_000);
  });
});
```

- [ ] **Step 2: Run circuit breaker tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/circuit-breaker.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write circuit breaker implementation**

```typescript
// packages/core/src/skill-runtime/circuit-breaker.ts

interface CircuitBreakerConfig {
  maxFailuresInWindow: number;
  windowMs: number;
}

interface TraceStoreForCircuitBreaker {
  countRecentFailures(deploymentId: string, windowMs: number): Promise<number>;
}

export class CircuitBreaker {
  constructor(
    private traceStore: TraceStoreForCircuitBreaker,
    private config: CircuitBreakerConfig = {
      maxFailuresInWindow: 5,
      windowMs: 3_600_000,
    },
  ) {}

  async check(deploymentId: string): Promise<{ allowed: boolean; reason?: string }> {
    const failureCount = await this.traceStore.countRecentFailures(
      deploymentId,
      this.config.windowMs,
    );

    if (failureCount >= this.config.maxFailuresInWindow) {
      return {
        allowed: false,
        reason: `Circuit breaker tripped: ${failureCount} failures in the last ${this.config.windowMs / 60_000} minutes. Routing to human escalation.`,
      };
    }

    return { allowed: true };
  }
}
```

- [ ] **Step 4: Run circuit breaker tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/circuit-breaker.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write blast radius limiter tests**

```typescript
// packages/core/src/skill-runtime/blast-radius-limiter.test.ts
import { describe, it, expect, vi } from "vitest";
import { BlastRadiusLimiter } from "./blast-radius-limiter.js";

function makeStore(writeCount: number) {
  return { countWritesInWindow: vi.fn().mockResolvedValue(writeCount) } as any;
}

describe("BlastRadiusLimiter", () => {
  it("allows execution when write count is below limit", async () => {
    const limiter = new BlastRadiusLimiter(makeStore(10));
    const result = await limiter.check("d1");
    expect(result.allowed).toBe(true);
  });

  it("blocks execution when write count meets limit", async () => {
    const limiter = new BlastRadiusLimiter(makeStore(50));
    const result = await limiter.check("d1");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Blast radius");
    expect(result.reason).toContain("50 writes");
  });

  it("uses custom config", async () => {
    const store = makeStore(20);
    const limiter = new BlastRadiusLimiter(store, { maxWritesPerWindow: 20, windowMs: 1_800_000 });
    const result = await limiter.check("d1");
    expect(result.allowed).toBe(false);
    expect(store.countWritesInWindow).toHaveBeenCalledWith("d1", 1_800_000);
  });
});
```

- [ ] **Step 6: Run blast radius tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/blast-radius-limiter.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 7: Write blast radius limiter implementation**

```typescript
// packages/core/src/skill-runtime/blast-radius-limiter.ts

interface BlastRadiusConfig {
  maxWritesPerWindow: number;
  windowMs: number;
}

interface TraceStoreForBlastRadius {
  countWritesInWindow(deploymentId: string, windowMs: number): Promise<number>;
}

export class BlastRadiusLimiter {
  constructor(
    private traceStore: TraceStoreForBlastRadius,
    private config: BlastRadiusConfig = {
      maxWritesPerWindow: 50,
      windowMs: 3_600_000,
    },
  ) {}

  async check(deploymentId: string): Promise<{ allowed: boolean; reason?: string }> {
    const writeCount = await this.traceStore.countWritesInWindow(
      deploymentId,
      this.config.windowMs,
    );

    if (writeCount >= this.config.maxWritesPerWindow) {
      return {
        allowed: false,
        reason: `Blast radius limit: ${writeCount} writes in the last ${this.config.windowMs / 60_000} minutes (max ${this.config.maxWritesPerWindow}).`,
      };
    }

    return { allowed: true };
  }
}
```

- [ ] **Step 8: Run blast radius tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/blast-radius-limiter.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/skill-runtime/circuit-breaker.ts packages/core/src/skill-runtime/circuit-breaker.test.ts packages/core/src/skill-runtime/blast-radius-limiter.ts packages/core/src/skill-runtime/blast-radius-limiter.test.ts
git commit -m "$(cat <<'EOF'
feat: add CircuitBreaker and BlastRadiusLimiter safety gates
EOF
)"
```

---

### Task 6: Outcome Linker

**Files:**

- Create: `packages/core/src/skill-runtime/outcome-linker.ts`
- Create: `packages/core/src/skill-runtime/outcome-linker.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// packages/core/src/skill-runtime/outcome-linker.test.ts
import { describe, it, expect, vi } from "vitest";
import { OutcomeLinker } from "./outcome-linker.js";
import type { ToolCallRecord } from "./types.js";

function makeStore() {
  return { linkOutcome: vi.fn().mockResolvedValue(undefined) } as any;
}

function makeToolCall(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    toolId: "crm-query",
    operation: "contact.get",
    params: {},
    result: {},
    durationMs: 10,
    governanceDecision: "auto-approved",
    ...overrides,
  };
}

describe("OutcomeLinker", () => {
  it("links stage update to opportunity", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("trace-1", [
      makeToolCall({
        toolId: "crm-write",
        operation: "stage.update",
        params: { opportunityId: "opp-1" },
        result: { stage: "qualified" },
      }),
    ]);
    expect(store.linkOutcome).toHaveBeenCalledWith("trace-1", {
      id: "opp-1",
      type: "opportunity",
      result: "stage_qualified",
    });
  });

  it("links opt-out activity log as outcome", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("trace-1", [
      makeToolCall({
        toolId: "crm-write",
        operation: "activity.log",
        params: { eventType: "opt-out" },
        result: {},
      }),
    ]);
    expect(store.linkOutcome).toHaveBeenCalledWith("trace-1", {
      id: "trace-1",
      type: "task",
      result: "opt_out",
    });
  });

  it("links only the first matching outcome (stage update wins over opt-out)", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("trace-1", [
      makeToolCall({
        toolId: "crm-write",
        operation: "stage.update",
        params: { opportunityId: "opp-1" },
        result: { stage: "quoted" },
      }),
      makeToolCall({
        toolId: "crm-write",
        operation: "activity.log",
        params: { eventType: "opt-out" },
        result: {},
      }),
    ]);
    expect(store.linkOutcome).toHaveBeenCalledTimes(1);
    expect(store.linkOutcome).toHaveBeenCalledWith("trace-1", {
      id: "opp-1",
      type: "opportunity",
      result: "stage_quoted",
    });
  });

  it("does nothing when no business outcome detected", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("trace-1", [
      makeToolCall({ toolId: "crm-query", operation: "contact.get" }),
    ]);
    expect(store.linkOutcome).not.toHaveBeenCalled();
  });

  it("does nothing for empty tool calls", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("trace-1", []);
    expect(store.linkOutcome).not.toHaveBeenCalled();
  });

  it("skips stage update without opportunityId", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("trace-1", [
      makeToolCall({
        toolId: "crm-write",
        operation: "stage.update",
        params: {},
        result: { stage: "qualified" },
      }),
    ]);
    expect(store.linkOutcome).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/outcome-linker.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write implementation**

```typescript
// packages/core/src/skill-runtime/outcome-linker.ts
import type { ToolCallRecord } from "./types.js";

interface TraceStoreForOutcomeLinker {
  linkOutcome(
    traceId: string,
    outcome: { id: string; type: "opportunity" | "task" | "campaign"; result: string },
  ): Promise<void>;
}

export class OutcomeLinker {
  constructor(private traceStore: TraceStoreForOutcomeLinker) {}

  async linkFromToolCalls(traceId: string, toolCalls: ToolCallRecord[]): Promise<void> {
    for (const call of toolCalls) {
      if (call.toolId === "crm-write" && call.operation === "stage.update") {
        const params = call.params as { opportunityId?: string };
        const result = call.result as { stage?: string } | undefined;
        if (params.opportunityId && result?.stage) {
          await this.traceStore.linkOutcome(traceId, {
            id: params.opportunityId,
            type: "opportunity",
            result: `stage_${result.stage}`,
          });
          return;
        }
      }

      if (call.toolId === "crm-write" && call.operation === "activity.log") {
        const params = call.params as { eventType?: string };
        if (params.eventType === "opt-out") {
          await this.traceStore.linkOutcome(traceId, {
            id: traceId,
            type: "task",
            result: "opt_out",
          });
          return;
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/outcome-linker.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/outcome-linker.ts packages/core/src/skill-runtime/outcome-linker.test.ts
git commit -m "$(cat <<'EOF'
feat: add OutcomeLinker for trace-to-business-outcome linking
EOF
)"
```

---

### Task 7: SkillHandler Integration

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-handler.ts`
- Modify: `packages/core/src/skill-runtime/skill-handler.test.ts`

Wire safety gates, trace assembly, persistence, and outcome linking into the handler.

- [ ] **Step 1: Add new tests to skill-handler.test.ts**

Add these tests to the existing `describe("SkillHandler (generic)")` block. You'll need to update the test helpers to support the new dependencies.

First, update the `makeCtx()` helper to include `sessionId`:

```typescript
function makeCtx() {
  return {
    sessionId: "session-1",
    persona: { businessName: "Biz" },
    conversation: { id: "conv-1", messages: [{ role: "user", content: "hi" }] },
    trust: { score: 50, level: "guided" as const },
    chat: { send: vi.fn() },
  } as any;
}
```

Add mock factories for the new dependencies:

```typescript
function makeTraceStore() {
  return {
    create: vi.fn().mockResolvedValue(undefined),
    countRecentFailures: vi.fn().mockResolvedValue(0),
    countWritesInWindow: vi.fn().mockResolvedValue(0),
    linkOutcome: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function makeCircuitBreaker(allowed = true) {
  return {
    check: vi.fn().mockResolvedValue({ allowed, reason: allowed ? undefined : "tripped" }),
  } as any;
}

function makeBlastRadius(allowed = true) {
  return {
    check: vi.fn().mockResolvedValue({ allowed, reason: allowed ? undefined : "capped" }),
  } as any;
}

function makeOutcomeLinker() {
  return { linkFromToolCalls: vi.fn().mockResolvedValue(undefined) } as any;
}
```

Then add the new tests:

```typescript
it("persists trace after execution", async () => {
  const builder: ParameterBuilder = vi.fn().mockResolvedValue({ NAME: "Alice" });
  const traceStore = makeTraceStore();
  const executor = {
    execute: vi.fn().mockResolvedValue({
      response: "Hello Alice",
      toolCalls: [],
      tokenUsage: { input: 100, output: 50 },
      trace: {
        durationMs: 150,
        turnCount: 1,
        status: "success",
        responseSummary: "Hello Alice",
        writeCount: 0,
        governanceDecisions: [],
      },
    }),
  };
  const handler = new SkillHandler(
    mockSkill,
    executor as any,
    new Map([["test-skill", builder]]),
    mockStores,
    { deploymentId: "d1", orgId: "org1", contactId: "c1" },
    traceStore,
    makeCircuitBreaker(),
    makeBlastRadius(),
    makeOutcomeLinker(),
  );

  await handler.onMessage!(makeCtx());
  expect(traceStore.create).toHaveBeenCalledWith(
    expect.objectContaining({
      deploymentId: "d1",
      organizationId: "org1",
      skillSlug: "test-skill",
      status: "success",
    }),
  );
});

it("blocks execution when circuit breaker trips", async () => {
  const executor = { execute: vi.fn() };
  const handler = new SkillHandler(
    mockSkill,
    executor as any,
    new Map([["test-skill", vi.fn()]]),
    mockStores,
    { deploymentId: "d1", orgId: "org1", contactId: "c1" },
    makeTraceStore(),
    makeCircuitBreaker(false),
    makeBlastRadius(),
    makeOutcomeLinker(),
  );

  const ctx = makeCtx();
  await handler.onMessage!(ctx);

  expect(executor.execute).not.toHaveBeenCalled();
  expect(ctx.chat.send).toHaveBeenCalledWith(expect.stringContaining("trouble"));
});

it("blocks execution when blast radius limit reached", async () => {
  const executor = { execute: vi.fn() };
  const handler = new SkillHandler(
    mockSkill,
    executor as any,
    new Map([["test-skill", vi.fn()]]),
    mockStores,
    { deploymentId: "d1", orgId: "org1", contactId: "c1" },
    makeTraceStore(),
    makeCircuitBreaker(),
    makeBlastRadius(false),
    makeOutcomeLinker(),
  );

  const ctx = makeCtx();
  await handler.onMessage!(ctx);

  expect(executor.execute).not.toHaveBeenCalled();
  expect(ctx.chat.send).toHaveBeenCalledWith(expect.stringContaining("active"));
});

it("still sends response when trace persistence fails", async () => {
  const builder: ParameterBuilder = vi.fn().mockResolvedValue({ NAME: "Alice" });
  const traceStore = makeTraceStore();
  traceStore.create.mockRejectedValue(new Error("DB down"));
  const executor = {
    execute: vi.fn().mockResolvedValue({
      response: "Hello Alice",
      toolCalls: [],
      tokenUsage: { input: 100, output: 50 },
      trace: {
        durationMs: 150,
        turnCount: 1,
        status: "success",
        responseSummary: "Hello Alice",
        writeCount: 0,
        governanceDecisions: [],
      },
    }),
  };
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const handler = new SkillHandler(
    mockSkill,
    executor as any,
    new Map([["test-skill", builder]]),
    mockStores,
    { deploymentId: "d1", orgId: "org1", contactId: "c1" },
    traceStore,
    makeCircuitBreaker(),
    makeBlastRadius(),
    makeOutcomeLinker(),
  );

  const ctx = makeCtx();
  await handler.onMessage!(ctx);

  expect(ctx.chat.send).toHaveBeenCalledWith("Hello Alice");
  expect(consoleErrorSpy).toHaveBeenCalled();
  consoleErrorSpy.mockRestore();
});
```

- [ ] **Step 2: Update ALL existing tests for new dependencies**

Three changes needed across all existing tests:

**A. Update `makeCtx()` to include `sessionId`** — this applies to ALL tests, not just new ones. The handler now accesses `ctx.sessionId` for trace assembly:

```typescript
function makeCtx() {
  return {
    sessionId: "session-1", // ADD THIS
    persona: { businessName: "Biz" },
    // ... rest unchanged
  } as any;
}
```

**B. Update all mock executor return values to include `trace`** — After Task 4, `SkillExecutionResult` requires a `trace` field. Every mock `executor.execute` must return it:

```typescript
const executor = {
  execute: vi.fn().mockResolvedValue({
    response: "Hello Alice",
    toolCalls: [],
    tokenUsage: { input: 100, output: 50 },
    trace: {
      // ADD THIS
      durationMs: 150,
      turnCount: 1,
      status: "success",
      responseSummary: "Hello Alice",
      writeCount: 0,
      governanceDecisions: [],
    },
  }),
};
```

Apply this to EVERY existing test that mocks `executor.execute` (lines 48, 76). Without this, the handler will crash accessing `result.trace.governanceDecisions`.

**C. Update all `new SkillHandler(...)` calls** — add the 4 new trailing arguments:

```typescript
new SkillHandler(
  mockSkill,
  executor as any,
  builderMap,
  mockStores,
  { deploymentId: "d1", orgId: "org1", contactId: "c1" },
  makeTraceStore(),
  makeCircuitBreaker(),
  makeBlastRadius(),
  makeOutcomeLinker(),
);
```

- [ ] **Step 3: Install @paralleldrive/cuid2 dependency**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core add @paralleldrive/cuid2`

This provides `createId()` for generating trace IDs.

- [ ] **Step 4: Rewrite skill-handler.ts**

```typescript
// packages/core/src/skill-runtime/skill-handler.ts
import type { AgentHandler, AgentContext } from "@switchboard/sdk";
import type { SkillDefinition, SkillExecutor, SkillExecutionTrace } from "./types.js";
import type { ParameterBuilder, SkillStores } from "./parameter-builder.js";
import { ParameterResolutionError } from "./parameter-builder.js";
import type { CircuitBreaker } from "./circuit-breaker.js";
import type { BlastRadiusLimiter } from "./blast-radius-limiter.js";
import type { OutcomeLinker } from "./outcome-linker.js";
import { createId } from "@paralleldrive/cuid2";
import { createHash } from "node:crypto";

interface SkillHandlerConfig {
  deploymentId: string;
  orgId: string;
  contactId: string;
}

interface ExecutionTraceStore {
  create(trace: SkillExecutionTrace): Promise<void>;
}

function hashParameters(params: Record<string, unknown>): string {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  return createHash("sha256").update(sorted).digest("hex");
}

export class SkillHandler implements AgentHandler {
  constructor(
    private skill: SkillDefinition,
    private executor: SkillExecutor,
    private builderMap: Map<string, ParameterBuilder>,
    private stores: SkillStores,
    private config: SkillHandlerConfig,
    private traceStore: ExecutionTraceStore,
    private circuitBreaker: CircuitBreaker,
    private blastRadiusLimiter: BlastRadiusLimiter,
    private outcomeLinker: OutcomeLinker,
  ) {}

  async onMessage(ctx: AgentContext): Promise<void> {
    const cbResult = await this.circuitBreaker.check(this.config.deploymentId);
    if (!cbResult.allowed) {
      await ctx.chat.send(
        "I'm having some trouble right now. Let me connect you with the team directly.",
      );
      console.error(`Circuit breaker: ${cbResult.reason}`);
      return;
    }

    const brResult = await this.blastRadiusLimiter.check(this.config.deploymentId);
    if (!brResult.allowed) {
      await ctx.chat.send(
        "I've been quite active recently. Let me connect you with the team for this one.",
      );
      console.error(`Blast radius: ${brResult.reason}`);
      return;
    }

    const builder = this.builderMap.get(this.skill.slug);
    if (!builder) {
      throw new Error(`No parameter builder registered for skill: ${this.skill.slug}`);
    }

    let parameters: Record<string, unknown>;
    try {
      parameters = await builder(ctx, this.config, this.stores);
    } catch (err) {
      if (err instanceof ParameterResolutionError) {
        await ctx.chat.send(err.userMessage);
        return;
      }
      throw err;
    }

    const messages = (ctx.conversation?.messages ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const result = await this.executor.execute({
      skill: this.skill,
      parameters,
      messages,
      deploymentId: this.config.deploymentId,
      orgId: this.config.orgId,
      trustScore: ctx.trust.score,
      trustLevel: ctx.trust.level,
    });

    const trace: SkillExecutionTrace = {
      id: createId(),
      deploymentId: this.config.deploymentId,
      organizationId: this.config.orgId,
      skillSlug: this.skill.slug,
      skillVersion: this.skill.version,
      trigger: "chat_message",
      sessionId: ctx.sessionId,
      inputParametersHash: hashParameters(parameters),
      toolCalls: result.toolCalls,
      governanceDecisions: result.trace.governanceDecisions,
      tokenUsage: result.tokenUsage,
      durationMs: result.trace.durationMs,
      turnCount: result.trace.turnCount,
      status: result.trace.status,
      error: result.trace.error,
      responseSummary: result.response.slice(0, 500),
      writeCount: result.trace.writeCount,
      createdAt: new Date(),
    };

    try {
      await this.traceStore.create(trace);
      await this.outcomeLinker.linkFromToolCalls(trace.id, result.toolCalls);
    } catch (err) {
      console.error(`Trace persistence failed for ${trace.id}:`, err);
    }

    await ctx.chat.send(result.response);
  }
}
```

- [ ] **Step 5: Run handler tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/skill-handler.test.ts`
Expected: PASS (existing 4 + new 4 = 8 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/skill-handler.ts packages/core/src/skill-runtime/skill-handler.test.ts packages/core/package.json
git commit -m "$(cat <<'EOF'
feat: wire safety gates, trace persistence, and outcome linking into SkillHandler
EOF
)"
```

---

### Task 8: Barrel Export + Channel Gateway Wiring

**Files:**

- Modify: `packages/core/src/skill-runtime/index.ts`
- Modify: `packages/core/src/channel-gateway/types.ts`
- Modify: `packages/core/src/channel-gateway/channel-gateway.ts`

- [ ] **Step 1: Update barrel export**

Add to `packages/core/src/skill-runtime/index.ts`:

```typescript
export { CircuitBreaker } from "./circuit-breaker.js";
export { BlastRadiusLimiter } from "./blast-radius-limiter.js";
export { OutcomeLinker } from "./outcome-linker.js";
```

Add to the type exports:

```typescript
export type { SkillExecutionTraceData, SkillExecutionTrace } from "./types.js";
```

- [ ] **Step 2: Update SkillRuntimeDeps in channel-gateway/types.ts**

Add imports at top:

```typescript
import type { SkillExecutionTrace } from "../skill-runtime/types.js";
import type { CircuitBreaker } from "../skill-runtime/circuit-breaker.js";
import type { BlastRadiusLimiter } from "../skill-runtime/blast-radius-limiter.js";
import type { OutcomeLinker } from "../skill-runtime/outcome-linker.js";
```

Add to `SkillRuntimeDeps`:

```typescript
export interface SkillRuntimeDeps {
  // ... existing fields ...
  traceStore: { create(trace: SkillExecutionTrace): Promise<void> };
  circuitBreaker: CircuitBreaker;
  blastRadiusLimiter: BlastRadiusLimiter;
  outcomeLinker: OutcomeLinker;
}
```

- [ ] **Step 3: Update resolveHandler in channel-gateway.ts**

Find the place where `SkillHandler` is constructed (it should be in the `resolveHandler` or equivalent method). Update it to pass the new dependencies:

```typescript
return new SkillHandler(
  skill,
  executor,
  skillRuntime.builderMap,
  skillRuntime.stores,
  {
    deploymentId: info.deployment.id,
    orgId: info.deployment.organizationId,
    contactId: message.sessionId,
  },
  skillRuntime.traceStore,
  skillRuntime.circuitBreaker,
  skillRuntime.blastRadiusLimiter,
  skillRuntime.outcomeLinker,
);
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/index.ts packages/core/src/channel-gateway/types.ts packages/core/src/channel-gateway/channel-gateway.ts
git commit -m "$(cat <<'EOF'
feat: wire trace store and safety gates into channel gateway
EOF
)"
```

---

### Task 9: API Routes for Traces

**Files:**

- Modify: `apps/api/src/routes/marketplace.ts`

Add two endpoints for listing and retrieving traces.

- [ ] **Step 1: Add trace list endpoint**

In `apps/api/src/routes/marketplace.ts`, add after the existing deployment routes:

```typescript
// ── Execution Traces ──

app.get<{
  Params: { deploymentId: string };
  Querystring: { limit?: string; cursor?: string };
}>("/deployments/:deploymentId/traces", async (request, reply) => {
  const orgId = request.orgId;
  const { deploymentId } = request.params;
  const limit = Math.min(Number(request.query.limit) || 20, 100);
  const cursor = request.query.cursor;

  const traceStore = new PrismaExecutionTraceStore(request.prisma);
  const result = await traceStore.listByDeployment(orgId, deploymentId, { limit, cursor });

  return reply.send(result);
});
```

Add the import at the top of the file:

```typescript
import { PrismaExecutionTraceStore } from "@switchboard/db";
```

- [ ] **Step 2: Add trace detail endpoint**

```typescript
app.get<{
  Params: { traceId: string };
}>("/traces/:traceId", async (request, reply) => {
  const orgId = request.orgId;
  const { traceId } = request.params;

  const traceStore = new PrismaExecutionTraceStore(request.prisma);
  const trace = await traceStore.findById(orgId, traceId);

  if (!trace) {
    return reply.status(404).send({ error: "Trace not found" });
  }

  return reply.send({ trace });
});
```

- [ ] **Step 3: Export PrismaExecutionTraceStore from @switchboard/db**

Check `packages/db/src/index.ts` and add the export:

```typescript
export { PrismaExecutionTraceStore } from "./stores/prisma-execution-trace-store.js";
```

- [ ] **Step 4: Run the API typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/api exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/marketplace.ts packages/db/src/index.ts
git commit -m "$(cat <<'EOF'
feat: add trace list and detail API endpoints
EOF
)"
```

---

### Task 10: Dashboard Proxy Routes + Hook + Query Keys

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/traces/route.ts`
- Create: `apps/dashboard/src/hooks/use-traces.ts`
- Modify: `apps/dashboard/src/lib/query-keys.ts`
- Modify: `apps/dashboard/src/lib/api-client.ts`

- [ ] **Step 1: Add query keys**

In `apps/dashboard/src/lib/query-keys.ts`, add to the `marketplace` section:

```typescript
traces: (deploymentId: string) => ["marketplace", "traces", deploymentId] as const,
trace: (traceId: string) => ["marketplace", "trace", traceId] as const,
```

- [ ] **Step 2: Add API client methods**

In `apps/dashboard/src/lib/api-client.ts`, add:

```typescript
async listTraces(deploymentId: string, opts?: { limit?: number; cursor?: string }) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.cursor) params.set("cursor", opts.cursor);
  const qs = params.toString();
  return this.request<{ traces: ExecutionTraceSummary[]; nextCursor?: string }>(
    `/api/marketplace/deployments/${deploymentId}/traces${qs ? `?${qs}` : ""}`,
  );
}
```

Add the type near the top with other marketplace types:

```typescript
export interface ExecutionTraceSummary {
  id: string;
  skillSlug: string;
  status: string;
  durationMs: number;
  turnCount: number;
  writeCount: number;
  responseSummary: string;
  linkedOutcomeType?: string;
  linkedOutcomeResult?: string;
  createdAt: string;
}
```

- [ ] **Step 3: Create proxy route**

```typescript
// apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/traces/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await getApiClient();
    const data = await client.listTraces(id);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

- [ ] **Step 4: Create React Query hook**

```typescript
// apps/dashboard/src/hooks/use-traces.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { ExecutionTraceSummary } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export function useTraces(deploymentId: string) {
  return useQuery({
    queryKey: queryKeys.marketplace.traces(deploymentId),
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/marketplace/deployments/${deploymentId}/traces`);
      if (!res.ok) throw new Error("Failed to fetch traces");
      const data = await res.json();
      return data as { traces: ExecutionTraceSummary[]; nextCursor?: string };
    },
    enabled: !!deploymentId,
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/marketplace/deployments/\[id\]/traces/route.ts apps/dashboard/src/hooks/use-traces.ts apps/dashboard/src/lib/query-keys.ts apps/dashboard/src/lib/api-client.ts
git commit -m "$(cat <<'EOF'
feat: add dashboard trace proxy route, hook, and query keys
EOF
)"
```

---

### Task 11: Dashboard Trace List Page

**Files:**

- Create: `apps/dashboard/src/app/(auth)/deployments/[id]/traces/page.tsx`

- [ ] **Step 1: Create the trace list page**

```tsx
// apps/dashboard/src/app/(auth)/deployments/[id]/traces/page.tsx
import { getApiClient } from "@/lib/get-api-client";
import { notFound } from "next/navigation";
import { TracesClient } from "./traces-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TracesPage({ params }: PageProps) {
  const { id } = await params;

  try {
    const client = await getApiClient();
    const { deployments } = await client.listDeployments();
    const deployment = deployments.find((d) => d.id === id);
    if (!deployment) notFound();

    return <TracesClient deploymentId={id} />;
  } catch {
    notFound();
  }
}
```

- [ ] **Step 2: Create the client component**

```tsx
// apps/dashboard/src/app/(auth)/deployments/[id]/traces/traces-client.tsx
"use client";

import { useTraces } from "@/hooks/use-traces";
import { useState } from "react";

const STATUS_COLORS: Record<string, string> = {
  success: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
  budget_exceeded: "bg-yellow-100 text-yellow-800",
  denied: "bg-gray-100 text-gray-800",
};

export function TracesClient({ deploymentId }: { deploymentId: string }) {
  const { data, isLoading, error } = useTraces(deploymentId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) return <div className="p-6">Loading traces...</div>;
  if (error) return <div className="p-6 text-red-600">Failed to load traces</div>;
  if (!data?.traces.length) return <div className="p-6 text-gray-500">No traces yet</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Execution Traces</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 px-3">Time</th>
            <th className="py-2 px-3">Skill</th>
            <th className="py-2 px-3">Status</th>
            <th className="py-2 px-3">Duration</th>
            <th className="py-2 px-3">Tools</th>
            <th className="py-2 px-3">Writes</th>
            <th className="py-2 px-3">Outcome</th>
            <th className="py-2 px-3">Summary</th>
          </tr>
        </thead>
        <tbody>
          {data.traces.map((trace) => (
            <>
              <tr
                key={trace.id}
                className="border-b hover:bg-gray-50 cursor-pointer"
                onClick={() => setExpandedId(expandedId === trace.id ? null : trace.id)}
              >
                <td className="py-2 px-3 whitespace-nowrap">
                  {new Date(trace.createdAt).toLocaleString()}
                </td>
                <td className="py-2 px-3 font-mono text-xs">{trace.skillSlug}</td>
                <td className="py-2 px-3">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[trace.status] ?? "bg-gray-100"}`}
                  >
                    {trace.status}
                  </span>
                </td>
                <td className="py-2 px-3">{trace.durationMs}ms</td>
                <td className="py-2 px-3">{trace.turnCount}</td>
                <td className="py-2 px-3">{trace.writeCount}</td>
                <td className="py-2 px-3 text-xs">{trace.linkedOutcomeResult ?? "—"}</td>
                <td className="py-2 px-3 max-w-xs truncate text-gray-600">
                  {trace.responseSummary}
                </td>
              </tr>
              {expandedId === trace.id && (
                <tr key={`${trace.id}-detail`}>
                  <td colSpan={8} className="bg-gray-50 p-4">
                    <pre className="text-xs overflow-auto max-h-96">
                      {JSON.stringify(trace, null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Run dashboard typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/deployments/\[id\]/traces/
git commit -m "$(cat <<'EOF'
feat: add dashboard trace list page with inline detail expansion
EOF
)"
```

---

### Task 12: Full Suite Verification

**Files:** None new — verification only.

- [ ] **Step 1: Run typecheck across entire monorepo**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 lint`
Expected: PASS (fix any issues)

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 test`
Expected: PASS (all existing + ~30 new tests)

- [ ] **Step 4: Commit any fixes**

```bash
git commit -m "$(cat <<'EOF'
fix: resolve lint/type issues from SP3 integration
EOF
)"
```

---

### Summary

| Task      | What It Builds                 | Files         | Tests             |
| --------- | ------------------------------ | ------------- | ----------------- |
| 1         | Prisma model + migration       | 1 modify      | 0                 |
| 2         | Trace types in core            | 1 modify      | 0                 |
| 3         | ExecutionTraceStore            | 2 new         | 7                 |
| 4         | Executor trace emission        | 2 modify      | 3 new + existing  |
| 5         | Circuit breaker + blast radius | 4 new         | 7                 |
| 6         | Outcome linker                 | 2 new         | 6                 |
| 7         | SkillHandler integration       | 2 modify      | 4 new + existing  |
| 8         | Barrel export + gateway wiring | 3 modify      | 0 (typecheck)     |
| 9         | API routes                     | 2 modify      | 0                 |
| 10        | Dashboard proxy + hooks        | 4 new/modify  | 0                 |
| 11        | Dashboard trace page           | 2 new         | 0                 |
| 12        | Full verification              | 0             | full suite        |
| **Total** |                                | **~25 files** | **~27 new tests** |

Tasks 1-2 are data layer foundation. Tasks 3-6 are the core observability + safety logic. Task 7 wires it all into the handler. Tasks 8-9 expose it via API. Tasks 10-11 are the dashboard surface. Task 12 is verification.
