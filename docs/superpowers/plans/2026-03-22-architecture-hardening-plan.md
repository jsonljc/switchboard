# Architecture Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Switchboard AI agent architecture with LLM infrastructure, persistence, escalation, concurrency safety, and reliability — all invisible to the customer.

**Architecture:** Seven workstreams executed in dependency order: (1) Prisma schema additions, (2) core LLM infrastructure (model router, LLM call wrapper, structured outputs, usage logging), (3) persistence stores (conversation, agent registry, ROAS), (4) execution safety (concurrency, loop detection, rate limiting), (5) escalation & routing wiring, (6) EventLoop mutex wiring, (7) dispatcher cleanup & final integration.

**Tech Stack:** TypeScript, Prisma, PostgreSQL, Fastify, Zod, Vitest, Next.js (dashboard)

**Spec:** `docs/superpowers/specs/2026-03-22-architecture-hardening-design.md`

---

## File Structure

### New Files

| File                                                                 | Responsibility                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/core/src/model-router.ts`                                  | Model slot resolution with critical flag + fallback chain      |
| `packages/core/src/__tests__/model-router.test.ts`                   | Tests for model router                                         |
| `packages/core/src/llm-usage-logger.ts`                              | LLM usage logging interface                                    |
| `packages/core/src/__tests__/llm-usage-logger.test.ts`               | Tests for usage logger                                         |
| `packages/core/src/structured-output.ts`                             | Zod-based structured output parsing + safe fallbacks           |
| `packages/core/src/__tests__/structured-output.test.ts`              | Tests for structured output                                    |
| `packages/core/src/llm-call-wrapper.ts`                              | Retry + fallback orchestration for LLM calls                   |
| `packages/core/src/__tests__/llm-call-wrapper.test.ts`               | Tests for LLM call wrapper                                     |
| `packages/agents/src/concurrency.ts`                                 | Per-contact mutex + loop detection                             |
| `packages/agents/src/__tests__/concurrency.test.ts`                  | Tests for concurrency                                          |
| `packages/agents/src/escalation.ts`                                  | `escalateToOwner()` with structured payload, dedup, fan-out    |
| `packages/agents/src/__tests__/escalation.test.ts`                   | Tests for escalation                                           |
| `packages/db/src/stores/prisma-conversation-store.ts`                | ConversationStore backed by Prisma                             |
| `packages/db/src/stores/prisma-agent-registry.ts`                    | Persistence backing for in-memory AgentRegistry with hot cache |
| `packages/db/src/stores/prisma-roas-store.ts`                        | ROAS snapshot persistence                                      |
| `packages/db/src/stores/__tests__/prisma-conversation-store.test.ts` | Tests                                                          |
| `packages/db/src/stores/__tests__/prisma-agent-registry.test.ts`     | Tests                                                          |
| `packages/db/src/stores/__tests__/prisma-roas-store.test.ts`         | Tests                                                          |
| `apps/api/src/middleware/rate-limiter.ts`                            | Per-org concurrency limiter for LLM endpoints                  |
| `apps/api/src/middleware/__tests__/rate-limiter.test.ts`             | Tests for rate limiter                                         |

### Modified Files

| File                                | Changes                                                  |
| ----------------------------------- | -------------------------------------------------------- |
| `packages/db/prisma/schema.prisma`  | Add 6 new models                                         |
| `packages/core/src/llm-adapter.ts`  | Add optional `ModelConfig` to `generateReply()`          |
| `packages/agents/src/index.ts`      | Remove Dispatcher exports, add new exports               |
| `packages/agents/src/event-loop.ts` | Wire concurrency mutex around agent processing           |
| `apps/api/src/agent-bootstrap.ts`   | Wire ConversationRouter, persistence stores, escalation  |
| `apps/api/src/app.ts`               | Register rate-limiter middleware on LLM-consuming routes |

### Deleted Files

| File                                               | Reason                                          |
| -------------------------------------------------- | ----------------------------------------------- |
| `packages/agents/src/dispatcher.ts`                | Dead code — EventLoop is the sole dispatch path |
| `packages/agents/src/__tests__/dispatcher.test.ts` | Tests for removed module                        |

### Deferred (Not in This Plan)

| Item                                               | Reason                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| Dashboard DLQ viewer status filter                 | Frontend-only change, can be a separate PR                               |
| Cost guardrails (threshold check + auto-downgrade) | Needs real usage data first; `LlmUsageLog` table provides the foundation |
| Task-appropriate fail-safe messages                | Per-agent handler changes; wired when handlers adopt `LlmCallWrapper`    |

---

## Task 1: Prisma Schema — Add New Models

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add ConversationMessage and ContactLifecycle models**

Add to the end of `schema.prisma`:

```prisma
// ── Conversation Persistence (Architecture Hardening) ──

model ConversationMessage {
  id        String   @id @default(uuid())
  contactId String
  orgId     String
  direction String   // "inbound" | "outbound"
  content   String
  channel   String   // "whatsapp" | "telegram" | "dashboard"
  metadata  Json     @default("{}")
  createdAt DateTime @default(now())

  @@index([contactId, orgId])
  @@index([createdAt])
}

model ContactLifecycle {
  id        String   @id @default(uuid())
  contactId String
  orgId     String
  stage     String   @default("lead") // lead, qualified, booked, treated, churned
  optedOut  Boolean  @default(false)
  updatedAt DateTime @updatedAt
  createdAt DateTime @default(now())

  @@unique([contactId, orgId])
  @@index([orgId])
}
```

- [ ] **Step 2: Add AgentRegistration model**

```prisma
model AgentRegistration {
  id            String   @id @default(uuid())
  orgId         String
  agentId       String
  agentRole     String?
  executionMode String   @default("realtime") // realtime, scheduled, hybrid
  status        String   @default("active") // active, disabled, draft, error
  config        Json     @default("{}")
  configVersion Int      @default(1)
  capabilities  Json     @default("{}")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([orgId, agentId])
  @@index([orgId])
  @@index([status])
}
```

- [ ] **Step 3: Add RoasSnapshot model**

```prisma
model RoasSnapshot {
  id                String   @id @default(uuid())
  orgId             String
  entityType        String   @default("campaign") // campaign, adset, account
  entityId          String
  platform          String   // meta, google, tiktok
  adAccountId       String?
  roas              Float
  spend             Float
  revenue           Float
  currency          String   @default("USD") @db.VarChar(3)
  campaignStatus    String?
  attributionWindow String?
  dataFreshnessAt   DateTime?
  snapshotDate      DateTime @db.Date
  optimizerRunId    String?
  createdAt         DateTime @default(now())

  @@unique([orgId, entityType, entityId, snapshotDate])
  @@index([orgId, platform])
  @@index([snapshotDate])
  @@index([optimizerRunId])
}
```

- [ ] **Step 4: Add LlmUsageLog model**

```prisma
model LlmUsageLog {
  id           String   @id @default(uuid())
  orgId        String
  model        String
  inputTokens  Int
  outputTokens Int
  taskType     String
  durationMs   Int?
  error        String?
  createdAt    DateTime @default(now())

  @@index([orgId, createdAt])
  @@index([model])
}
```

- [ ] **Step 5: Add EscalationRecord model**

```prisma
model EscalationRecord {
  id                  String    @id @default(uuid())
  orgId               String
  contactId           String
  reason              String    // low_confidence, booking_question, pricing_exception, etc.
  reasonDetails       String?
  sourceAgent         String
  priority            String    @default("medium") // low, medium, high, urgent
  conversationSummary String?
  status              String    @default("open") // open, acknowledged, snoozed, resolved
  metadata            Json      @default("{}")
  acknowledgedAt      DateTime?
  resolvedAt          DateTime?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  @@index([orgId, status])
  @@index([contactId])
  @@index([createdAt])
}
```

- [ ] **Step 6: Generate Prisma client and create migration**

Run:

```bash
pnpm db:generate && pnpm db:migrate -- --name architecture_hardening
```

Expected: Migration created, Prisma client regenerated with new models.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add Prisma models for architecture hardening

Add ConversationMessage, ContactLifecycle, AgentRegistration,
RoasSnapshot, LlmUsageLog, and EscalationRecord models."
```

---

## Task 2: Model Router

**Files:**

- Create: `packages/core/src/model-router.ts`
- Test: `packages/core/src/__tests__/model-router.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/__tests__/model-router.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ModelRouter } from "../model-router.js";

describe("ModelRouter", () => {
  const router = new ModelRouter();

  it("resolves default slot to cheap model", () => {
    const config = router.resolve("default");
    expect(config.modelId).toBe("claude-haiku-4-5-20251001");
    expect(config.slot).toBe("default");
  });

  it("resolves premium slot to strong model", () => {
    const config = router.resolve("premium");
    expect(config.modelId).toBe("claude-sonnet-4-6");
  });

  it("resolves embedding slot", () => {
    const config = router.resolve("embedding");
    expect(config.slot).toBe("embedding");
  });

  it("upgrades default to premium when critical", () => {
    const config = router.resolve("default", { critical: true });
    expect(config.modelId).toBe("claude-sonnet-4-6");
    expect(config.slot).toBe("premium");
  });

  it("keeps premium as premium when critical", () => {
    const config = router.resolve("premium", { critical: true });
    expect(config.modelId).toBe("claude-sonnet-4-6");
  });

  it("returns fallback config for default slot", () => {
    const config = router.resolve("default");
    expect(config.fallbackSlot).toBe("premium");
  });

  it("returns fallback for premium slot when explicitly degradable", () => {
    const config = router.resolve("premium", { degradable: true });
    expect(config.fallbackSlot).toBe("default");
  });

  it("returns no fallback for premium slot by default (non-degradable)", () => {
    const config = router.resolve("premium");
    expect(config.fallbackSlot).toBeUndefined();
  });

  it("returns no fallback for premium slot when explicitly non-degradable", () => {
    const config = router.resolve("premium", { degradable: false });
    expect(config.fallbackSlot).toBeUndefined();
  });

  it("includes timeout from task class", () => {
    const config = router.resolve("default", { timeoutMs: 5000 });
    expect(config.timeoutMs).toBe(5000);
  });

  it("uses default timeout when none specified", () => {
    const config = router.resolve("default");
    expect(config.timeoutMs).toBe(8000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm --filter @switchboard/core test -- --run model-router`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ModelRouter**

Create `packages/core/src/model-router.ts`:

```typescript
export type ModelSlot = "default" | "premium" | "embedding";

export interface ModelConfig {
  slot: ModelSlot;
  modelId: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  fallbackSlot?: ModelSlot;
}

export interface ResolveOptions {
  critical?: boolean;
  /** Must be explicitly `true` for premium→default fallback. Defaults to no fallback. */
  degradable?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;

const SLOT_CONFIGS: Record<ModelSlot, Omit<ModelConfig, "fallbackSlot" | "timeoutMs">> = {
  default: {
    slot: "default",
    modelId: "claude-haiku-4-5-20251001",
    maxTokens: 1024,
    temperature: 0.7,
  },
  premium: {
    slot: "premium",
    modelId: "claude-sonnet-4-6",
    maxTokens: 2048,
    temperature: 0.5,
  },
  embedding: {
    slot: "embedding",
    modelId: "voyage-3-large",
    maxTokens: 0,
    temperature: 0,
  },
};

export class ModelRouter {
  resolve(slot: ModelSlot, options: ResolveOptions = {}): ModelConfig {
    const { critical = false, degradable, timeoutMs } = options;

    // Critical flag: upgrade default → premium
    const effectiveSlot: ModelSlot = critical && slot === "default" ? "premium" : slot;

    const base = SLOT_CONFIGS[effectiveSlot];
    if (!base) {
      return { ...SLOT_CONFIGS.default, timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS };
    }

    // Determine fallback
    let fallbackSlot: ModelSlot | undefined;
    if (effectiveSlot === "default") {
      fallbackSlot = "premium";
    } else if (effectiveSlot === "premium" && degradable === true) {
      // Only degrade premium→default when explicitly marked as degradable
      fallbackSlot = "default";
    }
    // Non-degradable premium tasks (default): no fallback — will escalate instead

    return {
      ...base,
      timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fallbackSlot,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm --filter @switchboard/core test -- --run model-router`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/model-router.ts packages/core/src/__tests__/model-router.test.ts
git commit -m "feat(core): add ModelRouter with slot resolution and critical flag"
```

---

## Task 3: LLM Usage Logger

**Files:**

- Create: `packages/core/src/llm-usage-logger.ts`
- Test: `packages/core/src/__tests__/llm-usage-logger.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/__tests__/llm-usage-logger.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { LlmUsageLogger, type LlmUsageEntry } from "../llm-usage-logger.js";

describe("LlmUsageLogger", () => {
  it("logs a usage entry via the provided sink", async () => {
    const entries: LlmUsageEntry[] = [];
    const logger = new LlmUsageLogger({
      sink: async (e) => {
        entries.push(e);
      },
    });

    await logger.log({
      orgId: "org-1",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 100,
      outputTokens: 50,
      taskType: "lead-qualification",
      durationMs: 320,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.model).toBe("claude-haiku-4-5-20251001");
  });

  it("does not throw if sink fails, but warns", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = new LlmUsageLogger({
      sink: async () => {
        throw new Error("DB down");
      },
    });

    await expect(
      logger.log({
        orgId: "org-1",
        model: "test",
        inputTokens: 1,
        outputTokens: 1,
        taskType: "test",
      }),
    ).resolves.not.toThrow();

    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm --filter @switchboard/core test -- --run llm-usage-logger`
Expected: FAIL

- [ ] **Step 3: Implement LlmUsageLogger**

Create `packages/core/src/llm-usage-logger.ts`:

```typescript
export interface LlmUsageEntry {
  orgId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  taskType: string;
  durationMs?: number;
  error?: string;
}

export interface LlmUsageLoggerConfig {
  sink: (entry: LlmUsageEntry) => Promise<void>;
}

export class LlmUsageLogger {
  private sink: (entry: LlmUsageEntry) => Promise<void>;

  constructor(config: LlmUsageLoggerConfig) {
    this.sink = config.sink;
  }

  async log(entry: LlmUsageEntry): Promise<void> {
    try {
      await this.sink(entry);
    } catch (err) {
      console.warn("[LlmUsageLogger] sink error:", err);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm --filter @switchboard/core test -- --run llm-usage-logger`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/llm-usage-logger.ts packages/core/src/__tests__/llm-usage-logger.test.ts
git commit -m "feat(core): add LlmUsageLogger with fire-and-forget sink"
```

---

## Task 4: Structured Output Parser

**Files:**

- Create: `packages/core/src/structured-output.ts`
- Test: `packages/core/src/__tests__/structured-output.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/__tests__/structured-output.test.ts`:

````typescript
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseStructuredOutput } from "../structured-output.js";

const QualificationSchema = z.object({
  qualified: z.boolean(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

describe("parseStructuredOutput", () => {
  it("parses valid JSON matching schema", () => {
    const raw = '{"qualified": true, "reason": "budget match", "confidence": 0.9}';
    const result = parseStructuredOutput(raw, QualificationSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.qualified).toBe(true);
    }
  });

  it("extracts JSON from markdown code block", () => {
    const raw = '```json\n{"qualified": false, "reason": "no budget", "confidence": 0.3}\n```';
    const result = parseStructuredOutput(raw, QualificationSchema);
    expect(result.success).toBe(true);
  });

  it("returns failure for invalid JSON", () => {
    const raw = "not json at all";
    const result = parseStructuredOutput(raw, QualificationSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  it("returns failure for JSON that doesn't match schema", () => {
    const raw = '{"qualified": "maybe"}';
    const result = parseStructuredOutput(raw, QualificationSchema);
    expect(result.success).toBe(false);
  });
});
````

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm --filter @switchboard/core test -- --run structured-output`
Expected: FAIL

- [ ] **Step 3: Implement structured output parser**

Create `packages/core/src/structured-output.ts`:

````typescript
import type { ZodSchema } from "zod";

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; raw: string };

export function parseStructuredOutput<T>(raw: string, schema: ZodSchema<T>): ParseResult<T> {
  // Try to extract JSON from markdown code block
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1]!.trim() : raw.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { success: false, error: "Invalid JSON", raw };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      error: result.error.issues.map((i) => i.message).join("; "),
      raw,
    };
  }

  return { success: true, data: result.data };
}
````

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm --filter @switchboard/core test -- --run structured-output`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/structured-output.ts packages/core/src/__tests__/structured-output.test.ts
git commit -m "feat(core): add Zod-based structured output parser for LLM responses"
```

---

## Task 5: LLM Call Wrapper (Retry + Fallback Orchestration)

**Files:**

- Create: `packages/core/src/llm-call-wrapper.ts`
- Test: `packages/core/src/__tests__/llm-call-wrapper.test.ts`

This module orchestrates the retry-then-fallback sequence using `ModelRouter` and `LlmUsageLogger`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/__tests__/llm-call-wrapper.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { LlmCallWrapper, type LlmCallFn } from "../llm-call-wrapper.js";
import { ModelRouter } from "../model-router.js";

describe("LlmCallWrapper", () => {
  const router = new ModelRouter();

  it("returns result on first successful call", async () => {
    const callFn: LlmCallFn = vi.fn().mockResolvedValue({ reply: "hello", confidence: 0.9 });
    const wrapper = new LlmCallWrapper({ router, callFn });

    const result = await wrapper.call("default", { prompt: "test" });
    expect(result.reply).toBe("hello");
    expect(callFn).toHaveBeenCalledOnce();
  });

  it("retries once on transient failure then succeeds", async () => {
    const callFn: LlmCallFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue({ reply: "ok", confidence: 0.8 });
    const wrapper = new LlmCallWrapper({ router, callFn, maxRetries: 1 });

    const result = await wrapper.call("default", { prompt: "test" });
    expect(result.reply).toBe("ok");
    expect(callFn).toHaveBeenCalledTimes(2);
  });

  it("falls back to fallback slot after retries exhausted", async () => {
    const callFn: LlmCallFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValue({ reply: "fallback ok", confidence: 0.7 });
    const wrapper = new LlmCallWrapper({ router, callFn, maxRetries: 1 });

    // default slot has fallback to premium
    const result = await wrapper.call("default", { prompt: "test" });
    expect(result.reply).toBe("fallback ok");
    expect(callFn).toHaveBeenCalledTimes(3);
  });

  it("returns fail-safe when all attempts fail and no fallback", async () => {
    const callFn: LlmCallFn = vi.fn().mockRejectedValue(new Error("always fail"));
    const wrapper = new LlmCallWrapper({
      router,
      callFn,
      maxRetries: 1,
      failSafe: { reply: "I'll have someone follow up shortly", confidence: 0 },
    });

    // premium slot with no degradable flag → no fallback
    const result = await wrapper.call("premium", { prompt: "test" });
    expect(result.reply).toBe("I'll have someone follow up shortly");
  });

  it("throws when all attempts fail and no fail-safe provided", async () => {
    const callFn: LlmCallFn = vi.fn().mockRejectedValue(new Error("always fail"));
    const wrapper = new LlmCallWrapper({ router, callFn, maxRetries: 0 });

    await expect(wrapper.call("premium", { prompt: "test" })).rejects.toThrow("always fail");
  });

  it("calls usage logger on success", async () => {
    const logFn = vi.fn();
    const callFn: LlmCallFn = vi.fn().mockResolvedValue({ reply: "hi", confidence: 0.9 });
    const wrapper = new LlmCallWrapper({ router, callFn, onUsage: logFn });

    await wrapper.call("default", { prompt: "test", orgId: "org-1", taskType: "qualification" });
    expect(logFn).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5-20251001", orgId: "org-1" }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm --filter @switchboard/core test -- --run llm-call-wrapper`
Expected: FAIL

- [ ] **Step 3: Implement LlmCallWrapper**

Create `packages/core/src/llm-call-wrapper.ts`:

```typescript
import type { ModelRouter, ModelSlot, ModelConfig, ResolveOptions } from "./model-router.js";

export interface LlmCallResult {
  reply: string;
  confidence: number;
}

export type LlmCallFn = (
  modelConfig: ModelConfig,
  input: Record<string, unknown>,
) => Promise<LlmCallResult>;

export interface UsageInfo {
  orgId: string;
  model: string;
  taskType: string;
  durationMs: number;
  error?: string;
}

export interface LlmCallWrapperConfig {
  router: ModelRouter;
  callFn: LlmCallFn;
  maxRetries?: number;
  failSafe?: LlmCallResult;
  onUsage?: (info: UsageInfo) => void;
}

export interface CallOptions extends ResolveOptions {
  prompt: string;
  orgId?: string;
  taskType?: string;
  [key: string]: unknown;
}

export class LlmCallWrapper {
  private router: ModelRouter;
  private callFn: LlmCallFn;
  private maxRetries: number;
  private failSafe?: LlmCallResult;
  private onUsage?: (info: UsageInfo) => void;

  constructor(config: LlmCallWrapperConfig) {
    this.router = config.router;
    this.callFn = config.callFn;
    this.maxRetries = config.maxRetries ?? 1;
    this.failSafe = config.failSafe;
    this.onUsage = config.onUsage;
  }

  async call(slot: ModelSlot, options: CallOptions): Promise<LlmCallResult> {
    const modelConfig = this.router.resolve(slot, options);
    const start = Date.now();

    // Try primary model with retries
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.callWithTimeout(modelConfig, options);
        this.reportUsage(options, modelConfig, start);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    // Try fallback slot if available
    if (modelConfig.fallbackSlot) {
      const fallbackConfig = this.router.resolve(modelConfig.fallbackSlot, options);
      try {
        const result = await this.callWithTimeout(fallbackConfig, options);
        this.reportUsage(options, fallbackConfig, start);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    // Return fail-safe or throw
    this.reportUsage(options, modelConfig, start, lastError?.message);

    if (this.failSafe) {
      return this.failSafe;
    }

    throw lastError ?? new Error("LLM call failed");
  }

  private async callWithTimeout(
    config: ModelConfig,
    input: Record<string, unknown>,
  ): Promise<LlmCallResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      return await this.callFn(config, { ...input, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private reportUsage(
    options: CallOptions,
    config: ModelConfig,
    startMs: number,
    error?: string,
  ): void {
    if (!this.onUsage) return;
    try {
      this.onUsage({
        orgId: options.orgId ?? "unknown",
        model: config.modelId,
        taskType: options.taskType ?? "unknown",
        durationMs: Date.now() - startMs,
        error,
      });
    } catch {
      // usage reporting must never block
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm --filter @switchboard/core test -- --run llm-call-wrapper`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/llm-call-wrapper.ts packages/core/src/__tests__/llm-call-wrapper.test.ts
git commit -m "feat(core): add LlmCallWrapper with retry, fallback, and usage reporting"
```

---

## Task 6: Update LLMAdapter Interface

**Files:**

- Modify: `packages/core/src/llm-adapter.ts`

- [ ] **Step 1: Read the current LLMAdapter interface**

Read `packages/core/src/llm-adapter.ts`.

- [ ] **Step 2: Add optional ModelConfig parameter to generateReply**

Add the `ModelConfig` import and update the interface:

```typescript
import type { ModelConfig } from "./model-router.js";
```

Update `LLMAdapter.generateReply` signature:

```typescript
export interface LLMAdapter {
  generateReply(prompt: ConversationPrompt, modelConfig?: ModelConfig): Promise<LLMReply>;
}
```

This is backwards-compatible — existing implementations still work since `modelConfig` is optional.

- [ ] **Step 3: Run typecheck**

Run: `npx pnpm typecheck`
Expected: PASS — the optional parameter doesn't break existing callers.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/llm-adapter.ts
git commit -m "feat(core): add optional ModelConfig to LLMAdapter.generateReply"
```

---

## Task 7: Per-Contact Mutex & Loop Detection

**Files:**

- Create: `packages/agents/src/concurrency.ts`
- Test: `packages/agents/src/__tests__/concurrency.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/agents/src/__tests__/concurrency.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContactMutex, LoopDetector } from "../concurrency.js";

describe("ContactMutex", () => {
  let mutex: ContactMutex;

  beforeEach(() => {
    mutex = new ContactMutex({ timeoutMs: 1000 });
  });

  it("acquires lock for a contact", async () => {
    const release = await mutex.acquire("org-1", "contact-1");
    expect(release).toBeTypeOf("function");
    release();
  });

  it("queues second caller for same contact", async () => {
    const order: number[] = [];
    const release1 = await mutex.acquire("org-1", "contact-1");

    const promise2 = mutex.acquire("org-1", "contact-1").then((release) => {
      order.push(2);
      release();
    });

    order.push(1);
    release1();
    await promise2;

    expect(order).toEqual([1, 2]);
  });

  it("allows parallel locks for different contacts", async () => {
    const release1 = await mutex.acquire("org-1", "contact-1");
    const release2 = await mutex.acquire("org-1", "contact-2");
    expect(release1).toBeTypeOf("function");
    expect(release2).toBeTypeOf("function");
    release1();
    release2();
  });
});

describe("LoopDetector", () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector({ windowMs: 5000, maxRepeats: 3 });
  });

  it("returns false for first occurrence", () => {
    expect(detector.isLoop("org-1", "contact-1", "message.received", "hash-1")).toBe(false);
  });

  it("returns true when same event repeats beyond threshold", () => {
    detector.isLoop("org-1", "contact-1", "message.received", "hash-1");
    detector.isLoop("org-1", "contact-1", "message.received", "hash-1");
    expect(detector.isLoop("org-1", "contact-1", "message.received", "hash-1")).toBe(true);
  });

  it("returns false for different content hashes", () => {
    detector.isLoop("org-1", "contact-1", "message.received", "hash-1");
    detector.isLoop("org-1", "contact-1", "message.received", "hash-1");
    expect(detector.isLoop("org-1", "contact-1", "message.received", "hash-2")).toBe(false);
  });

  it("resets counter after window expires", async () => {
    const shortDetector = new LoopDetector({ windowMs: 50, maxRepeats: 2 });
    shortDetector.isLoop("org-1", "c1", "msg", "h1");
    await new Promise((r) => setTimeout(r, 60));
    expect(shortDetector.isLoop("org-1", "c1", "msg", "h1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm --filter @switchboard/agents test -- --run concurrency`
Expected: FAIL

- [ ] **Step 3: Implement ContactMutex and LoopDetector**

Create `packages/agents/src/concurrency.ts`:

```typescript
export interface ContactMutexConfig {
  timeoutMs?: number;
}

export class ContactMutex {
  private locks = new Map<
    string,
    { queue: Array<() => void>; timer?: ReturnType<typeof setTimeout> }
  >();
  private timeoutMs: number;

  constructor(config: ContactMutexConfig = {}) {
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  async acquire(orgId: string, contactId: string): Promise<() => void> {
    const key = `${orgId}:${contactId}`;
    const existing = this.locks.get(key);

    if (!existing) {
      const entry = {
        queue: [] as Array<() => void>,
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
      };
      this.locks.set(key, entry);
      return this.createRelease(key);
    }

    return new Promise<() => void>((resolve) => {
      existing.queue.push(() => resolve(this.createRelease(key)));
    });
  }

  private createRelease(key: string): () => void {
    const timer = setTimeout(() => this.release(key), this.timeoutMs);
    const entry = this.locks.get(key);
    if (entry) entry.timer = timer;

    return () => {
      clearTimeout(timer);
      this.release(key);
    };
  }

  private release(key: string): void {
    const entry = this.locks.get(key);
    if (!entry) return;

    if (entry.timer) clearTimeout(entry.timer);

    const next = entry.queue.shift();
    if (next) {
      next();
    } else {
      this.locks.delete(key);
    }
  }
}

export interface LoopDetectorConfig {
  windowMs?: number;
  maxRepeats?: number;
}

interface LoopEntry {
  count: number;
  firstSeen: number;
}

export class LoopDetector {
  private entries = new Map<string, LoopEntry>();
  private windowMs: number;
  private maxRepeats: number;

  constructor(config: LoopDetectorConfig = {}) {
    this.windowMs = config.windowMs ?? 5000;
    this.maxRepeats = config.maxRepeats ?? 3;
  }

  isLoop(orgId: string, contactId: string, eventType: string, contentHash: string): boolean {
    const key = `${orgId}:${contactId}:${eventType}:${contentHash}`;
    const now = Date.now();
    const existing = this.entries.get(key);

    if (!existing || now - existing.firstSeen > this.windowMs) {
      this.entries.set(key, { count: 1, firstSeen: now });
      return false;
    }

    existing.count++;
    return existing.count >= this.maxRepeats;
  }

  static contentHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return hash.toString(36);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm --filter @switchboard/agents test -- --run concurrency`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/concurrency.ts packages/agents/src/__tests__/concurrency.test.ts
git commit -m "feat(agents): add per-contact mutex and loop detection"
```

---

## Task 8: Escalation Implementation

**Files:**

- Create: `packages/agents/src/escalation.ts`
- Test: `packages/agents/src/__tests__/escalation.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/agents/src/__tests__/escalation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EscalationService, type EscalationStore, type EscalationNotifier } from "../escalation.js";

describe("EscalationService", () => {
  let store: EscalationStore;
  let notifier: EscalationNotifier;
  let service: EscalationService;

  beforeEach(() => {
    store = {
      create: vi.fn().mockResolvedValue({ id: "esc-1" }),
      findOpen: vi.fn().mockResolvedValue(null),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    };
    notifier = {
      notifyDashboard: vi.fn().mockResolvedValue(undefined),
      notifyWhatsApp: vi.fn().mockResolvedValue(undefined),
    };
    service = new EscalationService({ store, notifier });
  });

  it("creates durable record before sending notifications", async () => {
    const callOrder: string[] = [];
    (store.create as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("store");
      return { id: "esc-1" };
    });
    (notifier.notifyDashboard as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("dashboard");
    });

    await service.escalateToOwner({
      orgId: "org-1",
      contactId: "c-1",
      reason: "low_confidence",
      sourceAgent: "lead-responder",
      priority: "medium",
    });

    expect(callOrder[0]).toBe("store");
    expect(store.create).toHaveBeenCalledOnce();
    expect(notifier.notifyDashboard).toHaveBeenCalledOnce();
  });

  it("does not throw if WhatsApp notification fails", async () => {
    (notifier.notifyWhatsApp as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("timeout"));

    await expect(
      service.escalateToOwner({
        orgId: "org-1",
        contactId: "c-1",
        reason: "unhappy_lead",
        sourceAgent: "sales-closer",
        priority: "high",
      }),
    ).resolves.not.toThrow();

    expect(store.create).toHaveBeenCalledOnce();
    expect(notifier.notifyDashboard).toHaveBeenCalledOnce();
  });

  it("deduplicates: skips if open escalation exists for same contact+reason", async () => {
    (store.findOpen as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "existing-esc" });

    const result = await service.escalateToOwner({
      orgId: "org-1",
      contactId: "c-1",
      reason: "low_confidence",
      sourceAgent: "lead-responder",
      priority: "medium",
    });

    expect(result.deduplicated).toBe(true);
    expect(store.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm --filter @switchboard/agents test -- --run escalation`
Expected: FAIL

- [ ] **Step 3: Implement EscalationService**

Create `packages/agents/src/escalation.ts`:

```typescript
export type EscalationReason =
  | "low_confidence"
  | "booking_question"
  | "pricing_exception"
  | "unhappy_lead"
  | "compliance_risk"
  | "high_value_lead"
  | "human_requested"
  | "unsupported_intent";

export type EscalationPriority = "low" | "medium" | "high" | "urgent";
export type EscalationStatus = "open" | "acknowledged" | "snoozed" | "resolved";

export interface EscalateInput {
  orgId: string;
  contactId: string;
  reason: EscalationReason;
  reasonDetails?: string;
  sourceAgent: string;
  priority: EscalationPriority;
  conversationSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface EscalationRecord {
  id: string;
}

export interface EscalationStore {
  create(input: EscalateInput): Promise<EscalationRecord>;
  findOpen(orgId: string, contactId: string, reason: string): Promise<EscalationRecord | null>;
  updateStatus(id: string, status: EscalationStatus): Promise<void>;
}

export interface EscalationNotifier {
  notifyDashboard(record: EscalationRecord, input: EscalateInput): Promise<void>;
  notifyWhatsApp(record: EscalationRecord, input: EscalateInput): Promise<void>;
}

export interface EscalationServiceConfig {
  store: EscalationStore;
  notifier: EscalationNotifier;
}

export interface EscalateResult {
  escalationId: string;
  deduplicated: boolean;
}

export class EscalationService {
  private store: EscalationStore;
  private notifier: EscalationNotifier;

  constructor(config: EscalationServiceConfig) {
    this.store = config.store;
    this.notifier = config.notifier;
  }

  async escalateToOwner(input: EscalateInput): Promise<EscalateResult> {
    // Deduplicate: skip if open escalation exists for same contact+reason
    const existing = await this.store.findOpen(input.orgId, input.contactId, input.reason);
    if (existing) {
      return { escalationId: existing.id, deduplicated: true };
    }

    // 1. Create durable record first (the real record)
    const record = await this.store.create(input);

    // 2. Fan out notifications — failures must not block
    await this.notifier.notifyDashboard(record, input).catch(() => {});

    await this.notifier.notifyWhatsApp(record, input).catch(() => {});

    return { escalationId: record.id, deduplicated: false };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm --filter @switchboard/agents test -- --run escalation`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/escalation.ts packages/agents/src/__tests__/escalation.test.ts
git commit -m "feat(agents): add EscalationService with dedup and fan-out notifications"
```

---

## Task 9: PrismaConversationStore

**Files:**

- Create: `packages/db/src/stores/prisma-conversation-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-conversation-store.test.ts`

Note: This store is scoped per-org via constructor. Multi-org usage requires one instance per org. This matches how agents process events — always within an org context.

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/stores/__tests__/prisma-conversation-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaConversationStore } from "../prisma-conversation-store.js";

function mockPrisma() {
  return {
    conversationMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    },
    contactLifecycle: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("PrismaConversationStore", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let store: PrismaConversationStore;

  beforeEach(() => {
    prisma = mockPrisma();
    store = new PrismaConversationStore(prisma as never, "org-1");
  });

  it("getHistory returns messages ordered by createdAt", async () => {
    prisma.conversationMessage.findMany.mockResolvedValue([
      {
        id: "m1",
        contactId: "c1",
        direction: "inbound",
        content: "hi",
        channel: "whatsapp",
        metadata: {},
        createdAt: new Date("2026-01-01"),
      },
    ]);

    const messages = await store.getHistory("c1");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe("hi");
    expect(prisma.conversationMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contactId: "c1", orgId: "org-1" },
      }),
    );
  });

  it("appendMessage creates a new message record", async () => {
    await store.appendMessage("c1", {
      id: "m2",
      contactId: "c1",
      direction: "outbound",
      content: "hello",
      timestamp: "2026-01-01T00:00:00Z",
      channel: "whatsapp",
    });

    expect(prisma.conversationMessage.create).toHaveBeenCalledOnce();
  });

  it("getStage returns 'lead' when no lifecycle record exists", async () => {
    prisma.contactLifecycle.findUnique.mockResolvedValue(null);
    const stage = await store.getStage("c1");
    expect(stage).toBe("lead");
  });

  it("setStage upserts lifecycle record", async () => {
    await store.setStage("c1", "qualified");
    expect(prisma.contactLifecycle.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contactId_orgId: { contactId: "c1", orgId: "org-1" } },
      }),
    );
  });

  it("isOptedOut returns false when no record exists", async () => {
    prisma.contactLifecycle.findUnique.mockResolvedValue(null);
    expect(await store.isOptedOut("c1")).toBe(false);
  });

  it("setOptOut upserts opt-out status", async () => {
    await store.setOptOut("c1", true);
    expect(prisma.contactLifecycle.upsert).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm --filter @switchboard/db test -- --run prisma-conversation-store`
Expected: FAIL

- [ ] **Step 3: Implement PrismaConversationStore**

Create `packages/db/src/stores/prisma-conversation-store.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";

// Local interfaces matching @switchboard/core ConversationStore shape.
// We don't import from core to keep structural typing approach
// consistent with PrismaDeliveryStore (avoids db→core layer violation).

type LifecycleStage = "lead" | "qualified" | "booked" | "treated" | "churned";

interface Message {
  id: string;
  contactId: string;
  direction: "inbound" | "outbound";
  content: string;
  timestamp: string;
  channel: "whatsapp" | "telegram" | "dashboard";
  metadata?: Record<string, unknown>;
}

export class PrismaConversationStore {
  constructor(
    private prisma: PrismaClient,
    private orgId: string,
  ) {}

  async getHistory(contactId: string): Promise<Message[]> {
    const rows = await this.prisma.conversationMessage.findMany({
      where: { contactId, orgId: this.orgId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((r) => ({
      id: r.id,
      contactId: r.contactId,
      direction: r.direction as "inbound" | "outbound",
      content: r.content,
      timestamp: r.createdAt.toISOString(),
      channel: r.channel as "whatsapp" | "telegram" | "dashboard",
      metadata: (r.metadata as Record<string, unknown>) ?? {},
    }));
  }

  async appendMessage(contactId: string, message: Message): Promise<void> {
    await this.prisma.conversationMessage.create({
      data: {
        id: message.id,
        contactId,
        orgId: this.orgId,
        direction: message.direction,
        content: message.content,
        channel: message.channel,
        metadata: (message.metadata as object) ?? {},
      },
    });
  }

  async getStage(contactId: string): Promise<LifecycleStage> {
    const record = await this.prisma.contactLifecycle.findUnique({
      where: { contactId_orgId: { contactId, orgId: this.orgId } },
    });
    return (record?.stage as LifecycleStage) ?? "lead";
  }

  async setStage(contactId: string, stage: LifecycleStage): Promise<void> {
    await this.prisma.contactLifecycle.upsert({
      where: { contactId_orgId: { contactId, orgId: this.orgId } },
      create: { contactId, orgId: this.orgId, stage },
      update: { stage },
    });
  }

  async isOptedOut(contactId: string): Promise<boolean> {
    const record = await this.prisma.contactLifecycle.findUnique({
      where: { contactId_orgId: { contactId, orgId: this.orgId } },
    });
    return record?.optedOut ?? false;
  }

  async setOptOut(contactId: string, optedOut: boolean): Promise<void> {
    await this.prisma.contactLifecycle.upsert({
      where: { contactId_orgId: { contactId, orgId: this.orgId } },
      create: { contactId, orgId: this.orgId, optedOut },
      update: { optedOut },
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm --filter @switchboard/db test -- --run prisma-conversation-store`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-conversation-store.ts packages/db/src/stores/__tests__/prisma-conversation-store.test.ts
git commit -m "feat(db): add PrismaConversationStore for message history and lifecycle"
```

---

## Task 10: PrismaAgentRegistryStore (Persistence Backing Layer)

**Files:**

- Create: `packages/db/src/stores/prisma-agent-registry.ts`
- Test: `packages/db/src/stores/__tests__/prisma-agent-registry.test.ts`

**Important:** This is a persistence backing layer for the existing in-memory `AgentRegistry`. It does NOT replace `AgentRegistry` — it persists registration data to DB and loads it back on startup. The in-memory `AgentRegistry` remains the runtime registry that `EventLoop` and `AgentRouter` use. The bootstrap wiring (Task 14) calls `loadFromDb()` on startup and `persistRegistration()` after each `register()`.

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/stores/__tests__/prisma-agent-registry.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaAgentRegistryStore } from "../prisma-agent-registry.js";

function mockPrisma() {
  return {
    agentRegistration: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({
        orgId: "org-1",
        agentId: "lead-responder",
        status: "active",
        executionMode: "realtime",
        config: {},
        capabilities: {},
        configVersion: 1,
      }),
    },
  };
}

describe("PrismaAgentRegistryStore", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let store: PrismaAgentRegistryStore;

  beforeEach(() => {
    prisma = mockPrisma();
    store = new PrismaAgentRegistryStore(prisma as never);
  });

  it("persistRegistration upserts agent data to DB", async () => {
    await store.persistRegistration("org-1", {
      agentId: "lead-responder",
      status: "active",
      executionMode: "realtime",
      config: { threshold: 40 },
      capabilities: {},
    });

    expect(prisma.agentRegistration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId_agentId: { orgId: "org-1", agentId: "lead-responder" } },
      }),
    );
  });

  it("loadAll returns all registrations for an org", async () => {
    prisma.agentRegistration.findMany.mockResolvedValue([
      {
        orgId: "org-1",
        agentId: "lead-responder",
        status: "active",
        executionMode: "realtime",
        config: { threshold: 40 },
        capabilities: { accepts: ["lead.received"] },
        configVersion: 2,
      },
    ]);

    const entries = await store.loadAll("org-1");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.agentId).toBe("lead-responder");
    expect(entries[0]!.configVersion).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm --filter @switchboard/db test -- --run prisma-agent-registry`
Expected: FAIL

- [ ] **Step 3: Implement PrismaAgentRegistryStore**

Create `packages/db/src/stores/prisma-agent-registry.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";

export interface PersistedRegistration {
  agentId: string;
  agentRole?: string;
  executionMode: string;
  status: string;
  config: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  configVersion: number;
}

export interface PersistInput {
  agentId: string;
  agentRole?: string;
  executionMode: string;
  status: string;
  config: Record<string, unknown>;
  capabilities: Record<string, unknown>;
}

export class PrismaAgentRegistryStore {
  constructor(private prisma: PrismaClient) {}

  async persistRegistration(orgId: string, input: PersistInput): Promise<void> {
    await this.prisma.agentRegistration.upsert({
      where: { orgId_agentId: { orgId, agentId: input.agentId } },
      create: {
        orgId,
        agentId: input.agentId,
        agentRole: input.agentRole ?? null,
        executionMode: input.executionMode,
        status: input.status,
        config: input.config as object,
        capabilities: input.capabilities as object,
        configVersion: 1,
      },
      update: {
        agentRole: input.agentRole ?? undefined,
        executionMode: input.executionMode,
        status: input.status,
        config: input.config as object,
        capabilities: input.capabilities as object,
        configVersion: { increment: 1 },
      },
    });
  }

  async loadAll(orgId: string): Promise<PersistedRegistration[]> {
    const rows = await this.prisma.agentRegistration.findMany({
      where: { orgId },
    });

    return rows.map((r) => ({
      agentId: r.agentId,
      agentRole: (r as { agentRole?: string | null }).agentRole ?? undefined,
      executionMode: r.executionMode,
      status: r.status,
      config: r.config as Record<string, unknown>,
      capabilities: r.capabilities as Record<string, unknown>,
      configVersion: r.configVersion,
    }));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm --filter @switchboard/db test -- --run prisma-agent-registry`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-agent-registry.ts packages/db/src/stores/__tests__/prisma-agent-registry.test.ts
git commit -m "feat(db): add PrismaAgentRegistryStore as persistence backing layer"
```

---

## Task 11: PrismaRoasStore

**Files:**

- Create: `packages/db/src/stores/prisma-roas-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-roas-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/stores/__tests__/prisma-roas-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaRoasStore } from "../prisma-roas-store.js";

function mockPrisma() {
  return {
    roasSnapshot: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("PrismaRoasStore", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let store: PrismaRoasStore;

  beforeEach(() => {
    prisma = mockPrisma();
    store = new PrismaRoasStore(prisma as never);
  });

  it("saveSnapshot upserts a daily snapshot", async () => {
    await store.saveSnapshot({
      orgId: "org-1",
      entityType: "campaign",
      entityId: "camp-1",
      platform: "meta",
      roas: 3.5,
      spend: 100,
      revenue: 350,
      snapshotDate: new Date("2026-03-22"),
    });

    expect(prisma.roasSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orgId_entityType_entityId_snapshotDate: {
            orgId: "org-1",
            entityType: "campaign",
            entityId: "camp-1",
            snapshotDate: new Date("2026-03-22"),
          },
        },
      }),
    );
  });

  it("getWindow returns snapshots within lookback days", async () => {
    prisma.roasSnapshot.findMany.mockResolvedValue([
      {
        roas: 3.0,
        spend: 100,
        revenue: 300,
        snapshotDate: new Date("2026-03-21"),
        platform: "meta",
        campaignStatus: null,
      },
    ]);

    const results = await store.getWindow("org-1", "campaign", "camp-1", 30);
    expect(results).toHaveLength(1);
    expect(prisma.roasSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org-1",
          entityType: "campaign",
          entityId: "camp-1",
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm --filter @switchboard/db test -- --run prisma-roas-store`
Expected: FAIL

- [ ] **Step 3: Implement PrismaRoasStore**

Create `packages/db/src/stores/prisma-roas-store.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";

export interface RoasSnapshotInput {
  orgId: string;
  entityType: string;
  entityId: string;
  platform: string;
  adAccountId?: string;
  roas: number;
  spend: number;
  revenue: number;
  currency?: string;
  campaignStatus?: string;
  attributionWindow?: string;
  dataFreshnessAt?: Date;
  snapshotDate: Date;
  optimizerRunId?: string;
}

export interface RoasSnapshotRow {
  roas: number;
  spend: number;
  revenue: number;
  snapshotDate: Date;
  platform: string;
  campaignStatus: string | null;
}

export class PrismaRoasStore {
  constructor(private prisma: PrismaClient) {}

  async saveSnapshot(input: RoasSnapshotInput): Promise<void> {
    await this.prisma.roasSnapshot.upsert({
      where: {
        orgId_entityType_entityId_snapshotDate: {
          orgId: input.orgId,
          entityType: input.entityType,
          entityId: input.entityId,
          snapshotDate: input.snapshotDate,
        },
      },
      create: {
        orgId: input.orgId,
        entityType: input.entityType,
        entityId: input.entityId,
        platform: input.platform,
        adAccountId: input.adAccountId ?? null,
        roas: input.roas,
        spend: input.spend,
        revenue: input.revenue,
        currency: input.currency ?? "USD",
        campaignStatus: input.campaignStatus ?? null,
        attributionWindow: input.attributionWindow ?? null,
        dataFreshnessAt: input.dataFreshnessAt ?? null,
        snapshotDate: input.snapshotDate,
        optimizerRunId: input.optimizerRunId ?? null,
      },
      update: {
        roas: input.roas,
        spend: input.spend,
        revenue: input.revenue,
        campaignStatus: input.campaignStatus ?? null,
        dataFreshnessAt: input.dataFreshnessAt ?? null,
        optimizerRunId: input.optimizerRunId ?? null,
      },
    });
  }

  async getWindow(
    orgId: string,
    entityType: string,
    entityId: string,
    lookbackDays: number,
  ): Promise<RoasSnapshotRow[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);

    const rows = await this.prisma.roasSnapshot.findMany({
      where: {
        orgId,
        entityType,
        entityId,
        snapshotDate: { gte: cutoff },
      },
      orderBy: { snapshotDate: "asc" },
    });

    return rows.map((r) => ({
      roas: r.roas,
      spend: r.spend,
      revenue: r.revenue,
      snapshotDate: r.snapshotDate,
      platform: r.platform,
      campaignStatus: r.campaignStatus,
    }));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm --filter @switchboard/db test -- --run prisma-roas-store`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-roas-store.ts packages/db/src/stores/__tests__/prisma-roas-store.test.ts
git commit -m "feat(db): add PrismaRoasStore for ROAS snapshot persistence"
```

---

## Task 12: Rate Limiter Middleware

**Files:**

- Create: `apps/api/src/middleware/rate-limiter.ts`
- Test: `apps/api/src/middleware/__tests__/rate-limiter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/middleware/__tests__/rate-limiter.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { OrgConcurrencyLimiter } from "../rate-limiter.js";

describe("OrgConcurrencyLimiter", () => {
  let limiter: OrgConcurrencyLimiter;

  beforeEach(() => {
    limiter = new OrgConcurrencyLimiter({ maxConcurrent: 2, queueTimeoutMs: 100 });
  });

  it("allows requests under concurrency limit", async () => {
    const release = await limiter.acquire("org-1");
    expect(release).toBeTypeOf("function");
    release();
  });

  it("queues requests over limit and processes in order", async () => {
    const r1 = await limiter.acquire("org-1");
    const r2 = await limiter.acquire("org-1");

    const p3 = limiter.acquire("org-1");
    r1();
    const r3 = await p3;
    expect(r3).toBeTypeOf("function");
    r2();
    r3();
  });

  it("rejects when queue timeout is exceeded", async () => {
    const r1 = await limiter.acquire("org-1");
    const r2 = await limiter.acquire("org-1");

    await expect(limiter.acquire("org-1")).rejects.toThrow("queue timeout");

    r1();
    r2();
  });

  it("allows independent concurrency for different orgs", async () => {
    const r1 = await limiter.acquire("org-1");
    const r2 = await limiter.acquire("org-1");
    const r3 = await limiter.acquire("org-2");

    expect(r3).toBeTypeOf("function");
    r1();
    r2();
    r3();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm --filter @switchboard/api test -- --run rate-limiter`
Expected: FAIL

- [ ] **Step 3: Implement OrgConcurrencyLimiter**

Create `apps/api/src/middleware/rate-limiter.ts`:

```typescript
export interface OrgConcurrencyLimiterConfig {
  maxConcurrent?: number;
  queueTimeoutMs?: number;
}

interface OrgState {
  active: number;
  queue: Array<{
    resolve: (release: () => void) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
}

export class OrgConcurrencyLimiter {
  private orgs = new Map<string, OrgState>();
  private maxConcurrent: number;
  private queueTimeoutMs: number;

  constructor(config: OrgConcurrencyLimiterConfig = {}) {
    this.maxConcurrent = config.maxConcurrent ?? 5;
    this.queueTimeoutMs = config.queueTimeoutMs ?? 30_000;
  }

  async acquire(orgId: string): Promise<() => void> {
    let state = this.orgs.get(orgId);
    if (!state) {
      state = { active: 0, queue: [] };
      this.orgs.set(orgId, state);
    }

    if (state.active < this.maxConcurrent) {
      state.active++;
      return () => this.release(orgId);
    }

    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = state!.queue.findIndex((q) => q.resolve === resolve);
        if (idx !== -1) state!.queue.splice(idx, 1);
        reject(new Error("queue timeout"));
      }, this.queueTimeoutMs);

      state!.queue.push({ resolve, reject, timer });
    });
  }

  private release(orgId: string): void {
    const state = this.orgs.get(orgId);
    if (!state) return;

    const next = state.queue.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(() => this.release(orgId));
    } else {
      state.active--;
      if (state.active === 0) {
        this.orgs.delete(orgId);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm --filter @switchboard/api test -- --run rate-limiter`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/middleware/rate-limiter.ts apps/api/src/middleware/__tests__/rate-limiter.test.ts
git commit -m "feat(api): add per-org concurrency limiter for LLM endpoints"
```

---

## Task 13: Remove Dispatcher (Dead Code Cleanup)

**Files:**

- Delete: `packages/agents/src/dispatcher.ts`
- Delete: `packages/agents/src/__tests__/dispatcher.test.ts`
- Modify: `packages/agents/src/index.ts`

**Clarification:** This removes only the agent-level `Dispatcher` class in `packages/agents/src/dispatcher.ts`. Cartridge-level dispatchers (`CAPIDispatcher`, `TikTokDispatcher`, `GoogleOfflineDispatcher` in `cartridges/revenue-growth/`) are completely unrelated and NOT affected.

- [ ] **Step 1: Verify Dispatcher is not imported anywhere except index.ts and tests**

Run:

```bash
grep -r "from.*dispatcher" packages/agents/src/ --include="*.ts" -l | grep -v node_modules | grep -v __tests__
```

Expected: Only `packages/agents/src/index.ts`. If other files import it, investigate before deleting.

Also verify no app-layer imports:

```bash
grep -r "Dispatcher.*@switchboard/agents" apps/ --include="*.ts" -l | grep -v node_modules
```

Expected: No results.

- [ ] **Step 2: Remove Dispatcher exports from index.ts**

Read `packages/agents/src/index.ts` and remove these lines:

```typescript
export {
  Dispatcher,
  type DestinationHandler,
  type DispatcherConfig,
  type DispatchResult,
} from "./dispatcher.js";
```

- [ ] **Step 3: Delete dispatcher.ts and its test**

```bash
rm packages/agents/src/dispatcher.ts
rm packages/agents/src/__tests__/dispatcher.test.ts
```

- [ ] **Step 4: Run typecheck**

Run: `npx pnpm typecheck`
Expected: No errors related to Dispatcher.

- [ ] **Step 5: Run tests**

Run: `npx pnpm --filter @switchboard/agents test`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/index.ts
git rm packages/agents/src/dispatcher.ts packages/agents/src/__tests__/dispatcher.test.ts
git commit -m "chore(agents): remove dead Dispatcher module — EventLoop is sole dispatch path"
```

---

## Task 14: Wire ConversationRouter & Persistence in Bootstrap

**Files:**

- Modify: `apps/api/src/agent-bootstrap.ts`

- [ ] **Step 1: Read current agent-bootstrap.ts**

Read `apps/api/src/agent-bootstrap.ts` to understand current wiring.

- [ ] **Step 2: Add new option types to AgentSystemOptions**

Add to the `AgentSystemOptions` interface:

```typescript
conversationStore?: {
  getStage(contactId: string): Promise<string>;
};
registryStore?: {
  persistRegistration(orgId: string, input: Record<string, unknown>): Promise<void>;
  loadAll(orgId: string): Promise<Array<Record<string, unknown>>>;
};
```

- [ ] **Step 3: Wire ConversationRouter using .then() chaining**

The `ConversionBusBridge.onEvent` is typed as `(envelope) => void` (synchronous), so we cannot use `async/await`. Instead, use `.then()` chaining:

```typescript
import { ConversationRouter } from "@switchboard/agents";

// Inside bootstrapAgentSystem():
let conversationRouter: ConversationRouter | undefined;
if (options.conversationStore) {
  conversationRouter = new ConversationRouter({
    getStage: async (contactId: string) => {
      const stage = await options.conversationStore!.getStage(contactId);
      return stage as LifecycleStage | undefined;
    },
  });
}
```

Update the `onEvent` callback in the ConversionBusBridge section:

```typescript
onEvent: (envelope) => {
  if (registry.listActive(envelope.organizationId).length === 0) {
    registerAgentsForOrg(registry, envelope.organizationId);
  }
  const context = { organizationId: envelope.organizationId };

  const processEnvelope = (transformed: RoutedEventEnvelope) => {
    eventLoop.process(transformed, context).catch((err) => {
      log.error("[agent-system] EventLoop error:", err);
    });
  };

  if (conversationRouter) {
    conversationRouter.transform(envelope).then(processEnvelope).catch((err) => {
      log.error("[agent-system] ConversationRouter error:", err);
      // Fallback: process original envelope without routing
      processEnvelope(envelope);
    });
  } else {
    processEnvelope(envelope);
  }
},
```

- [ ] **Step 4: Wire persistence backing for agent registration**

After `registerAgentsForOrg()` calls, persist to DB if `registryStore` provided:

```typescript
// In registerAgentsForOrg or after calling it:
if (options.registryStore) {
  // Persist each registration to DB (fire-and-forget)
  for (const port of ports) {
    options.registryStore
      .persistRegistration(organizationId, {
        agentId: port.agentId,
        status: isPurchased ? "active" : "disabled",
        executionMode: "realtime",
        config: {},
        capabilities: {
          accepts: port.inboundEvents,
          emits: port.outboundEvents,
          tools: port.tools.map((t) => t.name),
        },
      })
      .catch((err) => {
        log.error(`[agent-system] Failed to persist registration for ${port.agentId}:`, err);
      });
  }
}
```

- [ ] **Step 5: Return conversationRouter in AgentSystem**

Add `conversationRouter?: ConversationRouter` to the `AgentSystem` interface and return value.

- [ ] **Step 6: Run typecheck**

Run: `npx pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Run tests**

Run: `npx pnpm test`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/agent-bootstrap.ts
git commit -m "feat(api): wire ConversationRouter and persistence in agent bootstrap"
```

---

## Task 15: Wire EventLoop with ContactMutex

**Files:**

- Modify: `packages/agents/src/event-loop.ts`

- [ ] **Step 1: Read current event-loop.ts**

Read `packages/agents/src/event-loop.ts` to understand the `processAgent` method.

- [ ] **Step 2: Add optional ContactMutex to EventLoopConfig**

Add to the `EventLoopConfig` interface:

```typescript
contactMutex?: {
  acquire(orgId: string, contactId: string): Promise<() => void>;
};
```

Store it in the constructor:

```typescript
private contactMutex?: EventLoopConfig["contactMutex"];
```

- [ ] **Step 3: Wire mutex in processRecursive**

At the top of `processRecursive`, before processing destinations, extract contactId and acquire lock if available:

```typescript
// Inside processRecursive, before the destination loop:
const contactId = (event.payload as Record<string, unknown>)?.contactId as string | undefined;
let releaseMutex: (() => void) | undefined;

if (this.contactMutex && contactId && depth === 0) {
  releaseMutex = await this.contactMutex.acquire(event.organizationId, contactId);
}

try {
  // ... existing destination processing loop ...
} finally {
  if (releaseMutex) releaseMutex();
}
```

- [ ] **Step 4: Run existing event-loop tests**

Run: `npx pnpm --filter @switchboard/agents test -- --run event-loop`
Expected: All existing tests still PASS (mutex is optional, so no behavior change when not provided)

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/event-loop.ts
git commit -m "feat(agents): wire optional ContactMutex in EventLoop processing"
```

---

## Task 16: Update Agent Index Exports

**Files:**

- Modify: `packages/agents/src/index.ts`

- [ ] **Step 1: Add new exports to index.ts**

Add after the existing exports:

```typescript
export {
  ContactMutex,
  LoopDetector,
  type ContactMutexConfig,
  type LoopDetectorConfig,
} from "./concurrency.js";

export {
  EscalationService,
  type EscalateInput,
  type EscalateResult,
  type EscalationNotifier,
  type EscalationPriority,
  type EscalationReason,
  type EscalationRecord,
  type EscalationServiceConfig,
  type EscalationStatus,
  type EscalationStore,
} from "./escalation.js";
```

- [ ] **Step 2: Run typecheck**

Run: `npx pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/agents/src/index.ts
git commit -m "feat(agents): export concurrency and escalation modules"
```

---

## Task 17: Wire Rate Limiter in App

**Files:**

- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Read current app.ts**

Read `apps/api/src/app.ts` to find where routes are registered.

- [ ] **Step 2: Create and register the limiter**

Import and instantiate the limiter:

```typescript
import { OrgConcurrencyLimiter } from "./middleware/rate-limiter.js";

const llmLimiter = new OrgConcurrencyLimiter({ maxConcurrent: 5, queueTimeoutMs: 30_000 });
```

Add a Fastify `preHandler` hook on LLM-consuming routes (`/api/test-chat`, `/api/knowledge/upload`):

```typescript
app.addHook("preHandler", async (request, reply) => {
  const path = request.url;
  if (!path.startsWith("/api/test-chat") && !path.startsWith("/api/knowledge")) {
    return;
  }
  const orgId = (request as any).organizationId ?? "default";
  try {
    const release = await llmLimiter.acquire(orgId);
    request.raw.on("close", release);
  } catch {
    return reply.code(503).send({
      error: "Too many concurrent requests. Please retry.",
      statusCode: 503,
      retryAfter: 5,
    });
  }
});
```

- [ ] **Step 3: Run typecheck**

Run: `npx pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/app.ts
git commit -m "feat(api): register rate limiter on LLM-consuming routes"
```

---

## Task 18: Full Integration Typecheck & Test

- [ ] **Step 1: Run full typecheck**

Run: `npx pnpm typecheck`
Expected: All packages pass

- [ ] **Step 2: Run full test suite**

Run: `npx pnpm test`
Expected: All tests pass, no regressions

- [ ] **Step 3: Run lint**

Run: `npx pnpm lint`
Expected: No new errors

- [ ] **Step 4: Commit any lint fixes**

If lint auto-fixed anything:

```bash
git add -A
git commit -m "chore: lint fixes for architecture hardening"
```

---

## Task 19: Final Commit & PR

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b feat/architecture-hardening
```

- [ ] **Step 2: Push and create PR**

```bash
git push -u origin feat/architecture-hardening
gh pr create --title "feat: architecture hardening — LLM infra, persistence, escalation, safety" --body "$(cat <<'EOF'
## Summary
- Model Router with 3 slots (default/premium/embedding) + critical flag + fallback chain
- LLM Call Wrapper with retry, fallback, and usage reporting
- LLM usage logging (internal, fire-and-forget)
- Structured output parsing with Zod validation
- LLMAdapter updated to accept optional ModelConfig
- Per-contact mutex to prevent concurrent agent responses
- Loop detection for webhook echo loops
- EscalationService with durable records, dedup, fan-out notifications
- PrismaConversationStore for message history and lifecycle stages
- PrismaAgentRegistryStore as persistence backing layer for in-memory AgentRegistry
- PrismaRoasStore for ROAS snapshot persistence with daily dedup
- Per-org concurrency limiter for LLM endpoints, wired on LLM-consuming routes
- ConversationRouter wired in agent bootstrap (with .then() chaining for sync callback)
- ContactMutex wired in EventLoop (optional, no breaking changes)
- Dead Dispatcher module and tests removed

## Deferred
- Dashboard DLQ viewer status filter (frontend-only, separate PR)
- Cost guardrails threshold checker (needs usage data first)
- Task-appropriate fail-safe messages (per-handler, wired when handlers adopt LlmCallWrapper)

## Test plan
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (all new modules have co-located tests)
- [ ] `pnpm lint` passes
- [ ] Prisma migration applies cleanly
EOF
)"
```
