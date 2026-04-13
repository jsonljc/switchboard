# Memory Foundation Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 issues from code review so the memory system both writes AND reads — agents actually use learned knowledge when responding.

**Architecture:** Wire `ContextBuilder` into `ChannelGateway` via a new `contextBuilder` config field. Add tiered priority sorting to `ContextBuilder`. Add `@@unique` constraint and `decayStale` to the memory store. Add source boost for `"learned"` type.

**Tech Stack:** TypeScript, Prisma, Vitest

---

## File Structure

| Action | Path                                                       | Changes                                                         |
| ------ | ---------------------------------------------------------- | --------------------------------------------------------------- |
| Modify | `packages/core/src/channel-gateway/types.ts`               | Add `contextBuilder` to `ChannelGatewayConfig`                  |
| Modify | `packages/core/src/channel-gateway/channel-gateway.ts`     | Build context before creating AgentRuntime, inject into persona |
| Modify | `apps/chat/src/gateway/gateway-bridge.ts`                  | Instantiate and wire ContextBuilder                             |
| Modify | `packages/agents/src/memory/context-builder.ts`            | Add tiered priority sorting                                     |
| Modify | `packages/db/prisma/schema.prisma`                         | Add `@@unique` constraint on DeploymentMemory                   |
| Modify | `packages/db/src/stores/prisma-deployment-memory-store.ts` | Add `decayStale` method                                         |

---

### Task 1: Wire ContextBuilder into ChannelGateway (C1 — Critical)

**Files:**

- Modify: `packages/core/src/channel-gateway/types.ts`
- Modify: `packages/core/src/channel-gateway/channel-gateway.ts`

- [ ] **Step 1: Add contextBuilder to ChannelGatewayConfig**

In `packages/core/src/channel-gateway/types.ts`, add to `ChannelGatewayConfig`:

```typescript
/** Builds knowledge context for agent responses. Optional — graceful degradation if not set. */
contextBuilder?: {
  build(input: {
    organizationId: string;
    agentId: string;
    deploymentId: string;
    query: string;
    contactId?: string;
  }): Promise<{
    retrievedChunks: Array<{ content: string; sourceType: string }>;
    learnedFacts: Array<{ content: string; category: string }>;
    recentSummaries: Array<{ summary: string; outcome: string }>;
  }>;
};
```

- [ ] **Step 2: Build and inject context in ChannelGateway**

In `packages/core/src/channel-gateway/channel-gateway.ts`, before the AgentRuntime creation (step 6), add knowledge context building:

```typescript
// 5.5 Build knowledge context (if available)
let knowledgeContext = "";
if (this.config.contextBuilder) {
  try {
    const ctx = await this.config.contextBuilder.build({
      organizationId: info.deployment.organizationId,
      agentId: info.deployment.listingId,
      deploymentId: info.deployment.id,
      query: message.text,
      contactId: message.visitor?.name,
    });

    const sections: string[] = [];
    if (ctx.learnedFacts.length > 0) {
      sections.push(
        "LEARNED FACTS (from past conversations):\n" +
          ctx.learnedFacts.map((f) => `- ${f.content} [${f.category}]`).join("\n"),
      );
    }
    if (ctx.retrievedChunks.length > 0) {
      sections.push("BUSINESS KNOWLEDGE:\n" + ctx.retrievedChunks.map((c) => c.content).join("\n"));
    }
    if (ctx.recentSummaries.length > 0) {
      sections.push(
        "RECENT INTERACTIONS:\n" +
          ctx.recentSummaries.map((s) => `- ${s.summary} (${s.outcome})`).join("\n"),
      );
    }
    knowledgeContext = sections.join("\n\n");
  } catch {
    // Graceful degradation — agent works without knowledge context
  }
}
```

Then inject it into the persona's `customInstructions` field (which is already included in the prompt assembly):

```typescript
// Inject knowledge context into persona
const enrichedPersona = knowledgeContext
  ? {
      ...info.persona,
      customInstructions: [info.persona.customInstructions, knowledgeContext]
        .filter(Boolean)
        .join("\n\n"),
    }
  : info.persona;
```

And use `enrichedPersona` instead of `info.persona` in the AgentRuntime constructor.

- [ ] **Step 3: Verify tests pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run`
Expected: All pass (contextBuilder is optional, existing tests don't set it)

- [ ] **Step 4: Commit**

```bash
git add packages/core/ && git commit -m "feat(core): wire contextBuilder into ChannelGateway for knowledge-enriched responses"
```

---

### Task 2: Wire ContextBuilder in Gateway Bridge

**Files:**

- Modify: `apps/chat/src/gateway/gateway-bridge.ts`

- [ ] **Step 1: Read the current gateway-bridge.ts**

Read `apps/chat/src/gateway/gateway-bridge.ts` to see current state.

- [ ] **Step 2: Import and instantiate ContextBuilder**

Add imports:

```typescript
import { ContextBuilder } from "@switchboard/agents";
```

Create the ContextBuilder with the existing stores:

```typescript
const contextBuilder = new ContextBuilder({
  knowledgeRetriever: {
    retrieve: async (query, options) => {
      // TODO: wire real embedding + knowledge store retrieval
      // For now, return empty — knowledge context will come from memory entries only
      return [];
    },
  },
  deploymentMemoryStore: new PrismaDeploymentMemoryStore(prisma),
  interactionSummaryStore: new PrismaInteractionSummaryStore(prisma),
});
```

Pass to ChannelGateway config:

```typescript
return new ChannelGateway({
  // ... existing config ...
  contextBuilder,
});
```

- [ ] **Step 3: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter chat typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/chat/ && git commit -m "feat(chat): wire ContextBuilder into gateway for knowledge-enriched responses"
```

---

### Task 3: Add Tiered Priority Sorting to ContextBuilder (I5)

**Files:**

- Modify: `packages/agents/src/memory/context-builder.ts`
- Modify: `packages/agents/src/memory/__tests__/context-builder.test.ts`

- [ ] **Step 1: Add priority sorting test**

Read existing tests at `packages/agents/src/memory/__tests__/context-builder.test.ts`. Add:

```typescript
it("sorts retrieved chunks by source type priority (corrections first)", async () => {
  const deps = createMockDeps();
  deps.knowledgeRetriever.retrieve.mockResolvedValue([
    { content: "from document", sourceType: "document", similarity: 0.95 },
    { content: "owner correction", sourceType: "correction", similarity: 0.8 },
    { content: "learned fact", sourceType: "learned", similarity: 0.9 },
    { content: "from wizard", sourceType: "wizard", similarity: 0.85 },
  ]);
  const builder = new ContextBuilder(deps);
  const result = await builder.build({
    organizationId: "org-1",
    agentId: "agent-1",
    deploymentId: "dep-1",
    query: "test",
  });
  expect(result.retrievedChunks[0].sourceType).toBe("correction");
  expect(result.retrievedChunks[1].sourceType).toBe("wizard");
  expect(result.retrievedChunks[2].sourceType).toBe("learned");
  expect(result.retrievedChunks[3].sourceType).toBe("document");
});
```

- [ ] **Step 2: Run test — verify fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/agents test -- --run context-builder`

- [ ] **Step 3: Add priority sorting to ContextBuilder**

In `packages/agents/src/memory/context-builder.ts`, add after the imports:

```typescript
const SOURCE_PRIORITY: Record<string, number> = {
  correction: 0,
  wizard: 1,
  learned: 2,
  document: 3,
};
```

In the `build` method, after fetching chunks, sort them before the token budget loop:

```typescript
// Sort by source type priority, then by similarity within same type
const sortedChunks = [...chunks].sort((a, b) => {
  const pDiff = (SOURCE_PRIORITY[a.sourceType] ?? 9) - (SOURCE_PRIORITY[b.sourceType] ?? 9);
  if (pDiff !== 0) return pDiff;
  return b.similarity - a.similarity;
});

const retrievedChunks: ContextRetrievedChunk[] = [];
for (const chunk of sortedChunks) {
```

Replace `chunks` with `sortedChunks` in the loop.

- [ ] **Step 4: Run tests — verify pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/agents test -- --run context-builder`

- [ ] **Step 5: Commit**

```bash
git add packages/agents/ && git commit -m "feat(agents): add tiered priority sorting to ContextBuilder"
```

---

### Task 4: Add @@unique Constraint + decayStale (I2, I3)

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/stores/prisma-deployment-memory-store.ts`

- [ ] **Step 1: Add unique constraint to DeploymentMemory**

In `packages/db/prisma/schema.prisma`, in the `DeploymentMemory` model, add before the closing `}`:

```prisma
  @@unique([organizationId, deploymentId, category, content])
```

- [ ] **Step 2: Add decayStale method to the store**

In `packages/db/src/stores/prisma-deployment-memory-store.ts`, add:

```typescript
async decayStale(cutoffDate: Date, decayAmount: number): Promise<number> {
  const result = await this.prisma.deploymentMemory.updateMany({
    where: {
      lastSeenAt: { lt: cutoffDate },
      confidence: { gt: 0 },
    },
    data: {
      confidence: { decrement: decayAmount },
    },
  });
  return result.count;
}
```

- [ ] **Step 3: Generate migration**

```bash
npx pnpm@9.15.4 db:generate
npx pnpm@9.15.4 --filter @switchboard/db exec prisma migrate dev --name add-memory-unique-constraint --create-only
```

If shadow DB blocks, hand-write: `CREATE UNIQUE INDEX "DeploymentMemory_org_dep_cat_content_key" ON "DeploymentMemory"("organizationId", "deploymentId", "category", "content");`

- [ ] **Step 4: Verify**

Run: `npx pnpm@9.15.4 db:generate`

- [ ] **Step 5: Commit**

```bash
git add packages/db/ && git commit -m "feat(db): add unique constraint + decayStale to DeploymentMemory"
```

---

### Task 5: Add Source Boost for "learned" Type (I6)

**Files:**

- Modify: `packages/db/src/stores/prisma-knowledge-store.ts`

- [ ] **Step 1: Read the knowledge store**

Read `packages/db/src/stores/prisma-knowledge-store.ts` to find where search results are returned.

- [ ] **Step 2: Apply source-type boost multipliers**

After the raw search query returns results, apply boost multipliers before returning:

```typescript
const SOURCE_BOOST: Record<string, number> = {
  correction: 1.3,
  wizard: 1.15,
  learned: 1.1,
  document: 1.0,
};

// After the raw query, before return:
return rows.map((row) => ({
  chunk: {
    /* existing mapping */
  },
  similarity: row.similarity * (SOURCE_BOOST[row.sourceType] ?? 1.0),
}));
```

- [ ] **Step 3: Verify tests pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-knowledge-store`

- [ ] **Step 4: Commit**

```bash
git add packages/db/ && git commit -m "feat(db): add source-type boost multipliers to knowledge search"
```

---

## Verification Checklist

1. `npx pnpm@9.15.4 --filter @switchboard/core test -- --run` — all pass
2. `npx pnpm@9.15.4 --filter @switchboard/agents test -- --run` — all pass
3. `npx pnpm@9.15.4 --filter @switchboard/db test -- --run` — all pass
4. ContextBuilder is wired and called on every incoming message
5. Knowledge context appears in agent system prompt via `customInstructions`
6. Chunks are sorted by priority: corrections > wizard > learned > document
7. DeploymentMemory has unique constraint preventing duplicate entries
8. `decayStale` method exists for scheduled confidence decay
9. Knowledge search applies source boost multipliers
