# Foundation Gaps — Design Spec

**Date:** 2026-04-13
**Status:** Approved
**Goal:** Close three functional gaps in the Memory Foundation and wire the orphaned Model Router, turning stubs into working production code.

---

## 1. Problem

Memory Foundation (PR #189) shipped the structural skeleton — Prisma models, stores, compounding service, context builder, lifecycle tracker — but stubs prevent it from working in production:

| Gap                                                                                                | Impact                                                                                                   |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Embedding adapter is zero-vector stub (used by **both** `CompoundingService` and `ContextBuilder`) | Cosine similarity dedup always returns 0 — every fact is treated as unique, memory fills with duplicates |
| Knowledge retriever returns `[]`                                                                   | RAG retrieval is inert — `ContextBuilder` never surfaces business knowledge documents                    |
| Model Router not exported or wired                                                                 | Every LLM call uses Sonnet regardless of complexity — no cost optimization                               |

**Note:** The zero-vector embedding stub appears in two places in `gateway-bridge.ts`: the `compoundingService` (line 54-56) and the `contextBuilder`'s knowledge retriever (line 68). Both must be wired to the real adapter.

These are wiring gaps, not design gaps. All the components exist — they just aren't connected.

---

## 2. Architecture (Current → Target)

### Current State

```
gateway-bridge.ts
  ├── compoundingService.embeddingAdapter: { embed: () => [0,0,...,0] }  ← STUB (dedup broken)
  ├── contextBuilder.knowledgeRetriever: { retrieve: () => [] }          ← STUB (RAG inert)
  └── llmAdapterFactory: () => createAnthropicAdapter()                  ← always Sonnet
```

### Target State

```
gateway-bridge.ts
  ├── embeddingAdapter: VoyageEmbeddingAdapter(VOYAGE_API_KEY)
  │     fallback → zero-vector stub when key not set
  │     shared by compoundingService AND knowledgeRetriever
  ├── compoundingService: uses shared embeddingAdapter (dedup works)
  ├── contextBuilder.knowledgeRetriever: KnowledgeRetriever(embedding, PrismaKnowledgeStore)
  │     → boosted vector search (correction 1.3x > wizard 1.15x > learned 1.1x > document 1.0x)
  └── llmAdapterFactory: wraps createAnthropicAdapter() with ModelRouter config
        default=Haiku, critical=Sonnet, embedding=Voyage
```

---

## 3. Task 1: Voyage Embedding Adapter

### What Exists

- `EmbeddingAdapter` interface in `packages/core/src/embedding-adapter.ts` — `embed()`, `embedBatch()`, `dimensions`
- `ClaudeEmbeddingAdapter` in `packages/agents/src/llm/claude-embedding-adapter.ts` — uses `claude-embed-1` (doesn't exist as a real model)
- `VOYAGE_API_KEY` already in `.env.example`
- `ModelRouter` already references `voyage-3-large` in the embedding slot

### Design

Create `VoyageEmbeddingAdapter` implementing `EmbeddingAdapter`:

```typescript
// packages/agents/src/llm/voyage-embedding-adapter.ts
export class VoyageEmbeddingAdapter implements EmbeddingAdapter {
  readonly dimensions = 1024;

  constructor(private config: { apiKey: string; model?: string }) {}

  async embed(text: string): Promise<number[]> {
    /* POST to Voyage API */
  }
  async embedBatch(texts: string[]): Promise<number[][]> {
    /* batch endpoint */
  }
}
```

**API:** `POST https://api.voyageai.com/v1/embeddings` with `{ input: string[], model: "voyage-3-large" }`.

**Wiring:** In `gateway-bridge.ts`, create the embedding adapter once and share it across both `compoundingService` and `knowledgeRetriever`:

```typescript
const embeddingAdapter = process.env.VOYAGE_API_KEY
  ? new VoyageEmbeddingAdapter({ apiKey: process.env.VOYAGE_API_KEY })
  : {
      embed: async () => new Array(1024).fill(0),
      embedBatch: async (t) => t.map(() => new Array(1024).fill(0)),
      dimensions: 1024,
    };

if (!process.env.VOYAGE_API_KEY) {
  console.warn(
    "[gateway] VOYAGE_API_KEY not set — using zero-vector stubs (memory dedup and RAG disabled)",
  );
}
```

This preserves local dev experience (no API key needed) while enabling production embeddings.

**File:** `packages/agents/src/llm/voyage-embedding-adapter.ts` (new, ~50 lines)

---

## 4. Task 2: Wire Knowledge Retriever

### What Exists

- `KnowledgeRetriever` in `packages/agents/src/knowledge/retrieval.ts` — takes `EmbeddingAdapter` + `KnowledgeStore`, returns boosted `RetrievedChunk[]`
- `PrismaKnowledgeStore` in `packages/db/src/stores/prisma-knowledge-store.ts` — pgvector search with source boosting
- `ContextBuilder` expects `ContextBuilderKnowledgeRetriever` interface: `retrieve(query, { organizationId, agentId, deploymentId? }) → ContextRetrievedChunk[]`

### Interface Gap

`KnowledgeRetriever.retrieve()` returns `RetrievedChunk[]` (`{ content, sourceType, similarity, metadata }`).  
`ContextBuilderKnowledgeRetriever` expects `ContextRetrievedChunk[]` (`{ content, sourceType, similarity, metadata? }`).

These are structurally identical — `RetrievedChunk` satisfies `ContextRetrievedChunk`. No adapter needed, just type assertion or structural compatibility.

### Design

In `gateway-bridge.ts`, replace the placeholder with:

```typescript
const knowledgeStore = new PrismaKnowledgeStore(prisma);
const retriever = new KnowledgeRetriever({ embedding: embeddingAdapter, store: knowledgeStore });

const contextBuilder = new ContextBuilder({
  knowledgeRetriever: {
    retrieve: async (query, options) => retriever.retrieve(query, options),
  },
  deploymentMemoryStore: new PrismaDeploymentMemoryStore(prisma),
  interactionSummaryStore: new PrismaInteractionSummaryStore(prisma),
});
```

The `KnowledgeRetriever.retrieve()` `RetrieveOptions` interface has `{ organizationId, agentId }` but not `deploymentId`. The `ContextBuilderKnowledgeRetriever` passes `{ organizationId, agentId, deploymentId? }`. The extra `deploymentId` is harmlessly ignored by `KnowledgeRetriever`, so no changes needed to the retriever itself.

**Note:** When `VOYAGE_API_KEY` is not set (zero-vector fallback), `KnowledgeRetriever` will still run but vector search results will be meaningless. This is acceptable — the zero-vector path is for local dev only.

**Files:** `apps/chat/src/gateway/gateway-bridge.ts` (edit)

---

## 5. Task 3: Export + Wire Model Router

### What Exists

- `ModelRouter` in `packages/core/src/model-router.ts` — 3 slots (default=Haiku, premium=Sonnet, embedding=Voyage), `resolve(slot, options)` returns `ModelConfig`
- `createAnthropicAdapter().generateReply()` already accepts `ModelConfig` as second argument
- `ChannelGateway` calls `this.config.llmAdapterFactory()` once per message at line 103
- `AgentRuntime` receives `llmAdapter` and calls `generateReply()` — but currently without `ModelConfig`

### Design

**Step 1:** Export `ModelRouter` from `packages/core/src/index.ts`:

```typescript
export { ModelRouter } from "./model-router.js";
export type { ModelSlot, ModelConfig, ResolveOptions } from "./model-router.js";
```

**Step 2:** Wire model routing in `gateway-bridge.ts` via adapter wrapper.

The `createAnthropicAdapter().generateReply()` already accepts `ModelConfig` as its second parameter. Rather than threading `ModelConfig` through `ChannelGateway` → `AgentRuntime` (which would require interface changes in multiple packages), wrap the adapter at the factory level:

```typescript
// gateway-bridge.ts
import { ModelRouter } from "@switchboard/core";
const modelRouter = new ModelRouter();

llmAdapterFactory: () => {
  const adapter = createAnthropicAdapter();
  const config = modelRouter.resolve("default");
  return {
    generateReply: (prompt: ConversationPrompt, overrideConfig?: ModelConfig) =>
      adapter.generateReply(prompt, overrideConfig ?? config),
  };
},
```

This keeps the change localized to `gateway-bridge.ts`. The factory bakes in a default model config (Haiku for cost savings) while still allowing overrides from callers that pass `ModelConfig`. Since `LLMAdapter` is a single-method interface (`generateReply`), the structural typing is safe.

**Files:** `packages/core/src/index.ts` (add export), `apps/chat/src/gateway/gateway-bridge.ts` (edit)

---

## 6. Task 4: Tests + Validation

### New Tests

- `packages/agents/src/llm/__tests__/voyage-embedding-adapter.test.ts` — mock HTTP, verify embed/embedBatch, error handling
- Update `apps/chat/src/gateway/__tests__/gateway-bridge.test.ts` (if exists) or add integration assertions

### Validation

- `pnpm typecheck` — full type checking
- `pnpm test` — all tests pass
- `pnpm lint` — clean

---

## 7. Files Changed Summary

| File                                                                 | Action | Lines (est.)                                            |
| -------------------------------------------------------------------- | ------ | ------------------------------------------------------- |
| `packages/agents/src/llm/voyage-embedding-adapter.ts`                | New    | ~50                                                     |
| `packages/agents/src/llm/__tests__/voyage-embedding-adapter.test.ts` | New    | ~80                                                     |
| `packages/agents/src/llm/index.ts`                                   | Edit   | +1 export (VoyageEmbeddingAdapter)                      |
| `apps/chat/src/gateway/gateway-bridge.ts`                            | Edit   | ~30 changed (shared embedding, retriever, model router) |
| `packages/core/src/index.ts`                                         | Edit   | +3 lines (ModelRouter + types export)                   |

**Total:** ~2 new files, ~3 edits, ~160 lines of new code.

**Already exported (no changes needed):**

- `PrismaKnowledgeStore` — already exported from `@switchboard/db`
- `KnowledgeRetriever` — already exported from `@switchboard/agents`

---

## 8. Non-Goals

- Phase 2 memory intelligence (FAQ dashboard, temporal patterns, repeat customer recognition)
- Governance simplification (separate workstream)
- `agentContext` merge from ConversationThread (deferred — requires ConversationThread schema changes)
- Changing `ClaudeEmbeddingAdapter` — it stays as-is, Voyage is the production path
