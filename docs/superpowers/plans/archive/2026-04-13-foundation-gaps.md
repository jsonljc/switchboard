# Foundation Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real embeddings (Voyage), RAG retrieval, and model routing into the gateway bridge — turning memory dedup, knowledge retrieval, and cost optimization from stubs into working production code.

**Architecture:** Create `VoyageEmbeddingAdapter` (HTTP client for Voyage API), share it across both `CompoundingService` and `KnowledgeRetriever` in `gateway-bridge.ts`, wire `KnowledgeRetriever` → `ContextBuilder`, and wrap `createAnthropicAdapter()` with `ModelRouter` config (default=Haiku).

**Tech Stack:** TypeScript, Voyage AI API, Vitest, existing `EmbeddingAdapter`/`KnowledgeRetriever`/`ModelRouter` interfaces

**Spec:** `docs/superpowers/specs/2026-04-13-foundation-gaps-design.md`

---

### Task 1: Voyage Embedding Adapter

**Files:**

- Create: `packages/agents/src/llm/voyage-embedding-adapter.ts`
- Create: `packages/agents/src/llm/__tests__/voyage-embedding-adapter.test.ts`
- Modify: `packages/agents/src/llm/index.ts`
- Modify: `packages/agents/src/index.ts` (add VoyageEmbeddingAdapter to re-exports)

- [ ] **Step 1: Write the test file**

```typescript
// packages/agents/src/llm/__tests__/voyage-embedding-adapter.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VoyageEmbeddingAdapter } from "../voyage-embedding-adapter.js";

// We'll mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createAdapter(): VoyageEmbeddingAdapter {
  return new VoyageEmbeddingAdapter({ apiKey: "test-key" });
}

describe("VoyageEmbeddingAdapter", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("has 1024 dimensions", () => {
    expect(createAdapter().dimensions).toBe(1024);
  });

  it("embeds a single text via Voyage API", async () => {
    const fakeEmbedding = new Array(1024).fill(0).map((_, i) => i * 0.001);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: fakeEmbedding }] }),
    });

    const result = await createAdapter().embed("Hello world");

    expect(result).toHaveLength(1024);
    expect(mockFetch).toHaveBeenCalledWith("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-key",
      },
      body: JSON.stringify({
        input: ["Hello world"],
        model: "voyage-3-large",
      }),
    });
  });

  it("embeds a batch of texts", async () => {
    const fakeEmbeddings = [new Array(1024).fill(0.1), new Array(1024).fill(0.2)];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: fakeEmbeddings.map((e) => ({ embedding: e })),
      }),
    });

    const results = await createAdapter().embedBatch(["text 1", "text 2"]);

    expect(results).toHaveLength(2);
    expect(results[0]).toHaveLength(1024);
    expect(results[1]).toHaveLength(1024);
  });

  it("uses custom model when provided", async () => {
    const adapter = new VoyageEmbeddingAdapter({
      apiKey: "test-key",
      model: "voyage-3-lite",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: new Array(1024).fill(0) }] }),
    });

    await adapter.embed("test");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("voyage-3-lite");
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "rate limited",
    });

    await expect(createAdapter().embed("test")).rejects.toThrow(
      "Voyage API error 429: rate limited",
    );
  });

  it("throws on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network unreachable"));

    await expect(createAdapter().embed("test")).rejects.toThrow("Network unreachable");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/agents test -- --run voyage-embedding`
Expected: FAIL — `voyage-embedding-adapter.js` does not exist

- [ ] **Step 3: Write the implementation**

```typescript
// packages/agents/src/llm/voyage-embedding-adapter.ts
import type { EmbeddingAdapter } from "@switchboard/core";

export interface VoyageEmbeddingAdapterConfig {
  apiKey: string;
  model?: string;
}

interface VoyageResponse {
  data: Array<{ embedding: number[] }>;
}

const DEFAULT_MODEL = "voyage-3-large";
const DIMENSIONS = 1024;
const API_URL = "https://api.voyageai.com/v1/embeddings";

export class VoyageEmbeddingAdapter implements EmbeddingAdapter {
  readonly dimensions = DIMENSIONS;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: VoyageEmbeddingAdapterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.callApi([text]);
    return result[0] ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.callApi(texts);
  }

  private async callApi(input: string[]): Promise<number[][]> {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input, model: this.model }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Voyage API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as VoyageResponse;
    return data.data.map((d) => d.embedding);
  }
}
```

- [ ] **Step 4: Export from barrel files**

Add to `packages/agents/src/llm/index.ts`:

```typescript
export {
  VoyageEmbeddingAdapter,
  type VoyageEmbeddingAdapterConfig,
} from "./voyage-embedding-adapter.js";
```

Then add to the `./llm/index.js` re-export block in `packages/agents/src/index.ts` (around line 126-133, the "LLM Adapters" section):

```typescript
export {
  ClaudeLLMAdapter,
  ClaudeEmbeddingAdapter,
  VoyageEmbeddingAdapter,
  type ClaudeLLMAdapterConfig,
  type LLMCompleteFn,
  type ClaudeEmbeddingAdapterConfig,
  type EmbeddingClient,
  type VoyageEmbeddingAdapterConfig,
} from "./llm/index.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/agents test -- --run voyage-embedding`
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/llm/voyage-embedding-adapter.ts packages/agents/src/llm/__tests__/voyage-embedding-adapter.test.ts packages/agents/src/llm/index.ts packages/agents/src/index.ts && git commit -m "feat: add VoyageEmbeddingAdapter for production embeddings"
```

---

### Task 2: Export ModelRouter from @switchboard/core

**Files:**

- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add ModelRouter exports**

Add to `packages/core/src/index.ts` after the `LLM Adapter` section (around line 180):

```typescript
// Model Router (slot-based model selection)
export { ModelRouter } from "./model-router.js";
export type { ModelSlot, ModelConfig, ResolveOptions } from "./model-router.js";
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core run typecheck`
Expected: PASS — no type errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts && git commit -m "feat: export ModelRouter from @switchboard/core"
```

---

### Task 3: Wire everything into gateway bridge

**Files:**

- Modify: `apps/chat/src/gateway/gateway-bridge.ts`

This is the main wiring task. Three changes in one file:

1. Shared embedding adapter (Voyage or zero-vector fallback)
2. Real KnowledgeRetriever for ContextBuilder
3. ModelRouter-wrapped LLM adapter factory

- [ ] **Step 1: Update imports**

Replace the current imports at the top of `apps/chat/src/gateway/gateway-bridge.ts`:

```typescript
import type { PrismaClient } from "@switchboard/db";
import {
  PrismaDeploymentStateStore,
  PrismaActionRequestStore,
  PrismaAgentTaskStore,
  PrismaInteractionSummaryStore,
  PrismaDeploymentMemoryStore,
  PrismaKnowledgeStore,
} from "@switchboard/db";
import { ChannelGateway, ConversationLifecycleTracker, ModelRouter } from "@switchboard/core";
import type { ConversationPrompt, ModelConfig } from "@switchboard/core";
import { createAnthropicAdapter } from "@switchboard/core/agent-runtime";
import {
  ConversationCompoundingService,
  ContextBuilder,
  KnowledgeRetriever,
  VoyageEmbeddingAdapter,
} from "@switchboard/agents";
import type { EmbeddingAdapter } from "@switchboard/core";
import { PrismaDeploymentLookup } from "./deployment-lookup.js";
import { PrismaGatewayConversationStore } from "./gateway-conversation-store.js";
import { TaskRecorder } from "./task-recorder.js";
```

- [ ] **Step 2: Create shared embedding adapter**

Add after imports, before `createGatewayBridge`:

```typescript
function createEmbeddingAdapter(): EmbeddingAdapter {
  if (process.env.VOYAGE_API_KEY) {
    return new VoyageEmbeddingAdapter({ apiKey: process.env.VOYAGE_API_KEY });
  }
  console.warn(
    "[gateway] VOYAGE_API_KEY not set — using zero-vector stubs (memory dedup and RAG disabled)",
  );
  return {
    embed: async (_text: string) => new Array(1024).fill(0) as number[],
    embedBatch: async (texts: string[]) => texts.map(() => new Array(1024).fill(0) as number[]),
    dimensions: 1024,
  };
}
```

- [ ] **Step 3: Rewrite createGatewayBridge function**

Replace the entire `createGatewayBridge` function body:

```typescript
export function createGatewayBridge(prisma: PrismaClient): ChannelGateway {
  const taskStore = new PrismaAgentTaskStore(prisma);

  const taskRecorder = new TaskRecorder({
    createTask: (input) =>
      taskStore.create({
        deploymentId: input.deploymentId,
        organizationId: input.organizationId ?? "",
        listingId: input.listingId,
        category: input.category,
        input: input.input,
      }),
    submitOutput: (taskId, output) => taskStore.submitOutput(taskId, output),
  });

  // Shared embedding adapter — Voyage in production, zero-vector in dev
  const embeddingAdapter = createEmbeddingAdapter();

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
  });

  const lifecycleTracker = new ConversationLifecycleTracker({
    onConversationEnd: (event) => compoundingService.processConversationEnd(event),
  });

  // Wire KnowledgeRetriever with shared embedding adapter
  const knowledgeStore = new PrismaKnowledgeStore(prisma);
  const knowledgeRetriever = new KnowledgeRetriever({
    embedding: embeddingAdapter,
    store: knowledgeStore,
  });

  const contextBuilder = new ContextBuilder({
    knowledgeRetriever: {
      retrieve: async (query, options) => knowledgeRetriever.retrieve(query, options),
    },
    deploymentMemoryStore: new PrismaDeploymentMemoryStore(prisma),
    interactionSummaryStore: new PrismaInteractionSummaryStore(prisma),
  });

  // Model-aware LLM adapter — default slot uses Haiku for cost savings
  const modelRouter = new ModelRouter();

  return new ChannelGateway({
    deploymentLookup: new PrismaDeploymentLookup(prisma),
    conversationStore: new PrismaGatewayConversationStore(prisma),
    stateStore: new PrismaDeploymentStateStore(prisma),
    actionRequestStore: new PrismaActionRequestStore(prisma),
    llmAdapterFactory: () => {
      const adapter = createAnthropicAdapter();
      const defaultConfig = modelRouter.resolve("default");
      return {
        generateReply: (prompt: ConversationPrompt, overrideConfig?: ModelConfig) =>
          adapter.generateReply(prompt, overrideConfig ?? defaultConfig),
      };
    },
    contextBuilder,
    onMessageRecorded: (info) => {
      taskRecorder.recordMessage(info);
      lifecycleTracker.recordMessage({
        sessionKey: `${info.deploymentId}:${info.channel}:${info.sessionId}`,
        deploymentId: info.deploymentId,
        organizationId: info.organizationId,
        channelType: info.channel,
        sessionId: info.sessionId,
        role: info.role,
        content: info.content,
      });
    },
  });
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: PASS across all packages

- [ ] **Step 5: Run full test suite**

Run: `npx pnpm@9.15.4 test -- --run`
Expected: All tests pass. No regressions.

- [ ] **Step 6: Commit**

```bash
git add apps/chat/src/gateway/gateway-bridge.ts && git commit -m "feat: wire real embeddings, RAG retrieval, and model routing into gateway"
```

---

### Task 4: Final Validation

- [ ] **Step 1: Run full lint**

Run: `npx pnpm@9.15.4 lint`
Expected: PASS — no lint errors

- [ ] **Step 2: Run typecheck across all packages**

Run: `npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 3: Run full test suite with coverage**

Run: `npx pnpm@9.15.4 test -- --run --coverage`
Expected: All tests pass, coverage thresholds met

- [ ] **Step 4: Verify build**

Run: `npx pnpm@9.15.4 build`
Expected: Clean build, no errors
