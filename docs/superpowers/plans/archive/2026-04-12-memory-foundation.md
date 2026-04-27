# Memory Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agents smarter after every conversation by adding three-tier deployment memory with a compounding loop.

**Architecture:** Two new Prisma models (`InteractionSummary`, `DeploymentMemory`), extend `KnowledgeChunk` with `deploymentId`, add conversation lifecycle hook to `ChannelGateway`, build `ConversationCompoundingService` that runs post-conversation LLM extraction, and add `ContextBuilder` for tiered context assembly with token budgets.

**Tech Stack:** TypeScript (ESM), Prisma + PostgreSQL + pgvector, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-04-12-architecture-rebalance-design.md` (Sections 3.1–3.6)

---

### Task 1: Add Prisma Models + Migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (add InteractionSummary, DeploymentMemory models; add deploymentId to KnowledgeChunk)

- [ ] **Step 1: Add `deploymentId` to KnowledgeChunk model**

In `packages/db/prisma/schema.prisma`, find the `KnowledgeChunk` model (~line 500) and add a nullable `deploymentId` column. Also update the compound index:

```prisma
model KnowledgeChunk {
  id              String   @id @default(uuid())
  organizationId  String
  agentId         String
  deploymentId    String?  // nullable for backward compat with org+agent scoped chunks
  documentId      String
  content         String
  sourceType      String   // "correction" | "wizard" | "document" | "learned"
  embedding       Unsupported("vector(1024)")
  chunkIndex      Int
  metadata        Json     @default("{}")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([organizationId, agentId])
  @@index([organizationId, deploymentId])
  @@index([documentId])
  @@index([sourceType])
}
```

- [ ] **Step 2: Add InteractionSummary model**

Add after the `KnowledgeChunk` model in schema.prisma:

```prisma
model InteractionSummary {
  id              String   @id @default(uuid())
  organizationId  String
  deploymentId    String
  channelType     String
  contactId       String?
  summary         String
  outcome         String   @default("info_request")
  extractedFacts  Json     @default("[]")
  questionsAsked  Json     @default("[]")
  duration        Int
  messageCount    Int
  createdAt       DateTime @default(now())

  @@index([organizationId, deploymentId])
  @@index([createdAt])
}
```

- [ ] **Step 3: Add DeploymentMemory model**

Add after the `InteractionSummary` model:

```prisma
model DeploymentMemory {
  id              String   @id @default(uuid())
  organizationId  String
  deploymentId    String
  category        String
  content         String
  confidence      Float    @default(0.5)
  sourceCount     Int      @default(1)
  lastSeenAt      DateTime
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([organizationId, deploymentId])
  @@index([confidence])
}
```

- [ ] **Step 4: Run Prisma migration**

```bash
npx pnpm@9.15.4 db:migrate -- --name add_deployment_memory
```

- [ ] **Step 5: Regenerate Prisma client**

```bash
npx pnpm@9.15.4 db:generate
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(db): add InteractionSummary, DeploymentMemory models + KnowledgeChunk.deploymentId"
```

---

### Task 2: Extend KnowledgeSourceType + KnowledgeStore Interface

**Files:**

- Modify: `packages/core/src/knowledge-store.ts`
- Modify: `packages/core/src/llm-adapter.ts:12-17` (RetrievedChunk sourceType)
- Modify: `packages/db/src/stores/prisma-knowledge-store.ts`
- Modify: `packages/agents/src/knowledge/retrieval.ts:19-23` (SOURCE_BOOST)
- Modify: `packages/agents/src/knowledge/ingestion-pipeline.ts:17-24` (IngestionInput)
- Test: `packages/core/src/__tests__/knowledge-store-extended.test.ts`
- Test: `packages/db/src/stores/__tests__/prisma-knowledge-store.test.ts` (if exists, else create)

- [ ] **Step 1: Write the test for extended KnowledgeSourceType**

Create `packages/core/src/__tests__/knowledge-store-extended.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { KnowledgeSourceType, KnowledgeSearchOptions } from "../knowledge-store.js";

describe("KnowledgeSourceType extended", () => {
  it("accepts 'learned' as a valid source type", () => {
    const sourceType: KnowledgeSourceType = "learned";
    expect(sourceType).toBe("learned");
  });

  it("KnowledgeSearchOptions accepts optional deploymentId", () => {
    const opts: KnowledgeSearchOptions = {
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      topK: 5,
    };
    expect(opts.deploymentId).toBe("dep-1");
  });

  it("KnowledgeSearchOptions works without deploymentId", () => {
    const opts: KnowledgeSearchOptions = {
      organizationId: "org-1",
      agentId: "agent-1",
    };
    expect(opts.deploymentId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx pnpm@9.15.4 --filter @switchboard/core test -- --run knowledge-store-extended
```

Expected: FAIL — `"learned"` not assignable to `KnowledgeSourceType`, `deploymentId` not on `KnowledgeSearchOptions`.

- [ ] **Step 3: Update knowledge-store.ts**

In `packages/core/src/knowledge-store.ts`:

```typescript
export type KnowledgeSourceType = "correction" | "wizard" | "document" | "learned";

export interface KnowledgeChunk {
  id: string;
  organizationId: string;
  agentId: string;
  deploymentId?: string;
  documentId: string;
  content: string;
  sourceType: KnowledgeSourceType;
  embedding: number[];
  chunkIndex: number;
  metadata: Record<string, unknown>;
}

export interface KnowledgeSearchOptions {
  organizationId: string;
  agentId: string;
  deploymentId?: string;
  topK?: number;
}
```

- [ ] **Step 4: Update RetrievedChunk in llm-adapter.ts**

In `packages/core/src/llm-adapter.ts`, update the `RetrievedChunk` interface:

```typescript
export interface RetrievedChunk {
  content: string;
  sourceType: "correction" | "wizard" | "document" | "learned";
  similarity: number;
  metadata?: Record<string, unknown>;
}
```

- [ ] **Step 5: Update PrismaKnowledgeStore to filter by deploymentId**

In `packages/db/src/stores/prisma-knowledge-store.ts`, update the local type aliases to include `deploymentId` and update the `search` method:

Update the local `KnowledgeSourceType`:

```typescript
type KnowledgeSourceType = "correction" | "wizard" | "document" | "learned";
```

Update the local `KnowledgeChunk`:

```typescript
interface KnowledgeChunk {
  id: string;
  organizationId: string;
  agentId: string;
  deploymentId?: string;
  documentId: string;
  content: string;
  sourceType: KnowledgeSourceType;
  embedding: number[];
  chunkIndex: number;
  metadata: Record<string, unknown>;
}
```

Update the local `KnowledgeSearchOptions`:

```typescript
interface KnowledgeSearchOptions {
  organizationId: string;
  agentId: string;
  deploymentId?: string;
  topK?: number;
}
```

Update `RawSearchRow` to include `deploymentId`:

```typescript
interface RawSearchRow {
  id: string;
  organizationId: string;
  agentId: string;
  deploymentId: string | null;
  documentId: string;
  content: string;
  sourceType: string;
  chunkIndex: number;
  metadata: string | Record<string, unknown>;
  similarity: number;
}
```

Update the `store` method to include `deploymentId`:

```typescript
async store(chunk: KnowledgeChunk): Promise<void> {
  const vectorStr = `[${chunk.embedding.join(",")}]`;
  await this.prisma.$executeRaw`
    INSERT INTO "KnowledgeChunk" (
      "id", "organizationId", "agentId", "deploymentId", "documentId",
      "content", "sourceType", "embedding", "chunkIndex",
      "metadata", "createdAt", "updatedAt"
    ) VALUES (
      ${chunk.id}, ${chunk.organizationId}, ${chunk.agentId}, ${chunk.deploymentId ?? null}, ${chunk.documentId},
      ${chunk.content}, ${chunk.sourceType}, ${vectorStr}::vector, ${chunk.chunkIndex},
      ${JSON.stringify(chunk.metadata)}::jsonb, NOW(), NOW()
    )
  `;
}
```

Update the `search` method to optionally filter by `deploymentId`:

```typescript
async search(embedding: number[], options: KnowledgeSearchOptions): Promise<RetrievalResult[]> {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const vectorStr = `[${embedding.join(",")}]`;

  const deploymentFilter = options.deploymentId
    ? Prisma.sql`AND ("deploymentId" = ${options.deploymentId} OR "deploymentId" IS NULL)`
    : Prisma.empty;

  const rows = await this.prisma.$queryRaw<RawSearchRow[]>`
    SELECT
      "id", "organizationId", "agentId", "deploymentId", "documentId",
      "content", "sourceType", "chunkIndex", "metadata",
      1 - ("embedding" <=> ${vectorStr}::vector) AS similarity
    FROM "KnowledgeChunk"
    WHERE "organizationId" = ${options.organizationId}
      AND "agentId" = ${options.agentId}
      ${deploymentFilter}
    ORDER BY "embedding" <=> ${vectorStr}::vector
    LIMIT ${topK}
  `;

  return rows.map((row) => ({
    chunk: {
      id: row.id,
      organizationId: row.organizationId,
      agentId: row.agentId,
      deploymentId: row.deploymentId ?? undefined,
      documentId: row.documentId,
      content: row.content,
      sourceType: row.sourceType as KnowledgeSourceType,
      embedding: [],
      chunkIndex: row.chunkIndex,
      metadata:
        typeof row.metadata === "string"
          ? (JSON.parse(row.metadata) as Record<string, unknown>)
          : (row.metadata as Record<string, unknown>),
    },
    similarity: row.similarity,
  }));
}
```

Note: The existing file imports `PrismaClient` from `@prisma/client` as a type-only import. `Prisma.sql` and `Prisma.empty` are **runtime values**, not types, so you need a non-type import. Change the import to: `import { Prisma } from "@prisma/client"; import type { PrismaClient } from "@prisma/client";` (or `import { Prisma, type PrismaClient } from "@prisma/client";`). Do NOT change the constructor to accept `PrismaDbClient` — the `$queryRaw` method requires `PrismaClient` specifically.

- [ ] **Step 6: Update retrieval.ts — add "learned" boost**

In `packages/agents/src/knowledge/retrieval.ts`, update the `SOURCE_BOOST` map and `RetrievedChunk` cast:

```typescript
const SOURCE_BOOST: Record<KnowledgeSourceType, number> = {
  correction: 1.3,
  wizard: 1.15,
  learned: 1.1,
  document: 1.0,
};
```

- [ ] **Step 7: Update ingestion-pipeline.ts — accept deploymentId**

In `packages/agents/src/knowledge/ingestion-pipeline.ts`, add `deploymentId` to `IngestionInput`:

```typescript
export interface IngestionInput {
  organizationId: string;
  agentId: string;
  deploymentId?: string;
  documentId: string;
  content: string;
  sourceType: KnowledgeSourceType;
  metadata?: Record<string, unknown>;
}
```

Update the chunk construction in `ingest()` to include `deploymentId`:

```typescript
const chunks: KnowledgeChunk[] = textChunks.map((tc, i) => ({
  id: generateId(),
  organizationId: input.organizationId,
  agentId: input.agentId,
  deploymentId: input.deploymentId,
  documentId: input.documentId,
  content: tc.content,
  sourceType: input.sourceType,
  embedding: embeddings[i] ?? [],
  chunkIndex: tc.index,
  metadata: input.metadata ?? {},
}));
```

- [ ] **Step 8: Run tests to verify everything passes**

```bash
npx pnpm@9.15.4 --filter @switchboard/core test -- --run
npx pnpm@9.15.4 typecheck
```

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(core): extend KnowledgeSourceType with 'learned' + add deploymentId to search"
```

---

### Task 3: Deployment Memory Schemas (Zod)

**Files:**

- Create: `packages/schemas/src/deployment-memory.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/__tests__/deployment-memory.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/schemas/src/__tests__/deployment-memory.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  InteractionSummarySchema,
  DeploymentMemorySchema,
  DeploymentMemoryCategorySchema,
  InteractionOutcomeSchema,
  ConfidenceFormulaSchema,
  computeConfidenceScore,
} from "../deployment-memory.js";

describe("DeploymentMemoryCategorySchema", () => {
  it("accepts valid categories", () => {
    for (const cat of ["preference", "faq", "objection", "pattern", "fact"]) {
      expect(DeploymentMemoryCategorySchema.parse(cat)).toBe(cat);
    }
  });

  it("rejects invalid category", () => {
    expect(() => DeploymentMemoryCategorySchema.parse("invalid")).toThrow();
  });
});

describe("InteractionOutcomeSchema", () => {
  it("accepts valid outcomes", () => {
    for (const o of ["booked", "qualified", "lost", "info_request", "escalated"]) {
      expect(InteractionOutcomeSchema.parse(o)).toBe(o);
    }
  });
});

describe("InteractionSummarySchema", () => {
  it("parses a valid interaction summary", () => {
    const result = InteractionSummarySchema.parse({
      id: "sum-1",
      organizationId: "org-1",
      deploymentId: "dep-1",
      channelType: "telegram",
      summary: "Customer asked about teeth whitening pricing.",
      outcome: "info_request",
      duration: 120,
      messageCount: 8,
      createdAt: new Date(),
    });
    expect(result.organizationId).toBe("org-1");
    expect(result.extractedFacts).toEqual([]);
    expect(result.questionsAsked).toEqual([]);
  });
});

describe("DeploymentMemorySchema", () => {
  it("parses a valid deployment memory entry", () => {
    const result = DeploymentMemorySchema.parse({
      id: "mem-1",
      organizationId: "org-1",
      deploymentId: "dep-1",
      category: "preference",
      content: "Prefers SMS over email for reminders",
      confidence: 0.7,
      sourceCount: 3,
      lastSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.category).toBe("preference");
    expect(result.confidence).toBe(0.7);
  });

  it("applies default confidence and sourceCount", () => {
    const result = DeploymentMemorySchema.parse({
      id: "mem-1",
      organizationId: "org-1",
      deploymentId: "dep-1",
      category: "fact",
      content: "Closed on Sundays",
      lastSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.confidence).toBe(0.5);
    expect(result.sourceCount).toBe(1);
  });
});

describe("computeConfidenceScore", () => {
  it("returns 0.5 for sourceCount=1", () => {
    expect(computeConfidenceScore(1, false)).toBeCloseTo(0.5, 2);
  });

  it("returns ~0.60 for sourceCount=2", () => {
    expect(computeConfidenceScore(2, false)).toBeCloseTo(0.6, 1);
  });

  it("returns ~0.66 for sourceCount=3", () => {
    expect(computeConfidenceScore(3, false)).toBeCloseTo(0.66, 1);
  });

  it("caps at 0.95 for high sourceCount", () => {
    expect(computeConfidenceScore(100, false)).toBe(0.95);
  });

  it("returns 1.0 when owner-confirmed", () => {
    expect(computeConfidenceScore(1, true)).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run deployment-memory
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement deployment-memory.ts**

Create `packages/schemas/src/deployment-memory.ts`:

```typescript
import { z } from "zod";

// ---------------------------------------------------------------------------
// Deployment Memory — schemas for three-tier agent memory system
// ---------------------------------------------------------------------------

export const DeploymentMemoryCategorySchema = z.enum([
  "preference",
  "faq",
  "objection",
  "pattern",
  "fact",
]);
export type DeploymentMemoryCategory = z.infer<typeof DeploymentMemoryCategorySchema>;

export const InteractionOutcomeSchema = z.enum([
  "booked",
  "qualified",
  "lost",
  "info_request",
  "escalated",
]);
export type InteractionOutcome = z.infer<typeof InteractionOutcomeSchema>;

export const ExtractedFactSchema = z.object({
  fact: z.string(),
  confidence: z.number().min(0).max(1),
  category: DeploymentMemoryCategorySchema,
});
export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;

export const InteractionSummarySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  deploymentId: z.string().min(1),
  channelType: z.string().min(1),
  contactId: z.string().nullable().default(null),
  summary: z.string(),
  outcome: InteractionOutcomeSchema,
  extractedFacts: z.array(ExtractedFactSchema).default([]),
  questionsAsked: z.array(z.string()).default([]),
  duration: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
});
export type InteractionSummary = z.infer<typeof InteractionSummarySchema>;

export const DeploymentMemorySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  deploymentId: z.string().min(1),
  category: DeploymentMemoryCategorySchema,
  content: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
  sourceCount: z.number().int().positive().default(1),
  lastSeenAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type DeploymentMemory = z.infer<typeof DeploymentMemorySchema>;

export const ConfidenceFormulaSchema = z.object({
  sourceCount: z.number().int().positive(),
  ownerConfirmed: z.boolean(),
});

/**
 * confidence = ownerConfirmed ? 1.0 : min(0.95, 0.5 + 0.15 * ln(sourceCount))
 */
export function computeConfidenceScore(sourceCount: number, ownerConfirmed: boolean): number {
  if (ownerConfirmed) return 1.0;
  return Math.min(0.95, 0.5 + 0.15 * Math.log(sourceCount));
}

/** Memory is surfaced to customers only when it meets this threshold. */
export const SURFACING_THRESHOLD = { minSourceCount: 3, minConfidence: 0.66 } as const;

/** Max entries per deployment before oldest low-confidence entries are pruned. */
export const MAX_DEPLOYMENT_MEMORY_ENTRIES = 500;

/** Days without being seen before confidence decays by 0.1. */
export const DECAY_WINDOW_DAYS = 90;
export const PATTERN_DECAY_WINDOW_DAYS = 180;
```

- [ ] **Step 4: Export from schemas index**

In `packages/schemas/src/index.ts`, add:

```typescript
export * from "./deployment-memory.js";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run deployment-memory
```

- [ ] **Step 6: Run full typecheck**

```bash
npx pnpm@9.15.4 typecheck
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(schemas): add InteractionSummary, DeploymentMemory, confidence formula schemas"
```

---

### Task 4: Prisma Stores (InteractionSummary + DeploymentMemory)

**Files:**

- Create: `packages/db/src/stores/prisma-interaction-summary-store.ts`
- Create: `packages/db/src/stores/prisma-deployment-memory-store.ts`
- Modify: `packages/db/src/index.ts` (add exports)
- Test: `packages/db/src/stores/__tests__/prisma-interaction-summary-store.test.ts`
- Test: `packages/db/src/stores/__tests__/prisma-deployment-memory-store.test.ts`

- [ ] **Step 1: Write InteractionSummary store test**

Create `packages/db/src/stores/__tests__/prisma-interaction-summary-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaInteractionSummaryStore } from "../prisma-interaction-summary-store.js";

function createMockPrisma() {
  return {
    interactionSummary: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  } as unknown as Parameters<
    typeof PrismaInteractionSummaryStore extends new (p: infer P) => unknown ? P : never
  >[0];
}

describe("PrismaInteractionSummaryStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaInteractionSummaryStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaInteractionSummaryStore(prisma as never);
  });

  it("creates an interaction summary", async () => {
    const input = {
      organizationId: "org-1",
      deploymentId: "dep-1",
      channelType: "telegram",
      summary: "Customer asked about pricing.",
      outcome: "info_request",
      extractedFacts: [],
      questionsAsked: ["What is the price?"],
      duration: 120,
      messageCount: 6,
    };
    (prisma.interactionSummary.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sum-1",
      ...input,
      contactId: null,
      createdAt: new Date(),
    });

    const result = await store.create(input);
    expect(result.id).toBe("sum-1");
    expect(prisma.interactionSummary.create).toHaveBeenCalledOnce();
  });

  it("lists summaries by deployment", async () => {
    (prisma.interactionSummary.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await store.listByDeployment("org-1", "dep-1", { limit: 10 });
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-interaction-summary-store
```

- [ ] **Step 3: Implement PrismaInteractionSummaryStore**

Create `packages/db/src/stores/prisma-interaction-summary-store.ts`:

```typescript
import type { PrismaDbClient } from "../prisma-db.js";

export interface CreateInteractionSummaryInput {
  organizationId: string;
  deploymentId: string;
  channelType: string;
  contactId?: string;
  summary: string;
  outcome: string;
  extractedFacts: unknown[];
  questionsAsked: string[];
  duration: number;
  messageCount: number;
}

export class PrismaInteractionSummaryStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateInteractionSummaryInput) {
    return this.prisma.interactionSummary.create({
      data: {
        organizationId: input.organizationId,
        deploymentId: input.deploymentId,
        channelType: input.channelType,
        contactId: input.contactId ?? null,
        summary: input.summary,
        outcome: input.outcome,
        extractedFacts: input.extractedFacts as object[],
        questionsAsked: input.questionsAsked,
        duration: input.duration,
        messageCount: input.messageCount,
      },
    });
  }

  async listByDeployment(
    organizationId: string,
    deploymentId: string,
    options: { limit?: number; contactId?: string } = {},
  ) {
    return this.prisma.interactionSummary.findMany({
      where: {
        organizationId,
        deploymentId,
        ...(options.contactId ? { contactId: options.contactId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: options.limit ?? 20,
    });
  }

  async countByDeployment(organizationId: string, deploymentId: string): Promise<number> {
    return this.prisma.interactionSummary.count({
      where: { organizationId, deploymentId },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-interaction-summary-store
```

- [ ] **Step 5: Write DeploymentMemory store test**

Create `packages/db/src/stores/__tests__/prisma-deployment-memory-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaDeploymentMemoryStore } from "../prisma-deployment-memory-store.js";

function createMockPrisma() {
  return {
    deploymentMemory: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  } as unknown as Parameters<
    typeof PrismaDeploymentMemoryStore extends new (p: infer P) => unknown ? P : never
  >[0];
}

describe("PrismaDeploymentMemoryStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaDeploymentMemoryStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaDeploymentMemoryStore(prisma as never);
  });

  it("creates a memory entry", async () => {
    const input = {
      organizationId: "org-1",
      deploymentId: "dep-1",
      category: "fact" as const,
      content: "Closed on Sundays",
    };
    const now = new Date();
    (prisma.deploymentMemory.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "mem-1",
      ...input,
      confidence: 0.5,
      sourceCount: 1,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const result = await store.create(input);
    expect(result.id).toBe("mem-1");
  });

  it("increments sourceCount and updates confidence on upsert", async () => {
    const existing = {
      id: "mem-1",
      organizationId: "org-1",
      deploymentId: "dep-1",
      category: "fact",
      content: "Closed on Sundays",
      confidence: 0.5,
      sourceCount: 1,
      lastSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (prisma.deploymentMemory.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...existing,
      sourceCount: 2,
      confidence: 0.6,
    });

    const result = await store.incrementConfidence("mem-1", 0.6);
    expect(result.sourceCount).toBe(2);
  });

  it("lists high-confidence entries", async () => {
    (prisma.deploymentMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await store.listHighConfidence("org-1", "dep-1", 0.66, 3);
    expect(result).toEqual([]);
    expect(prisma.deploymentMemory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          confidence: { gte: 0.66 },
          sourceCount: { gte: 3 },
        }),
      }),
    );
  });
});
```

- [ ] **Step 6: Implement PrismaDeploymentMemoryStore**

Create `packages/db/src/stores/prisma-deployment-memory-store.ts`:

```typescript
import type { PrismaDbClient } from "../prisma-db.js";

export interface CreateDeploymentMemoryInput {
  organizationId: string;
  deploymentId: string;
  category: string;
  content: string;
  confidence?: number;
}

export class PrismaDeploymentMemoryStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateDeploymentMemoryInput) {
    const now = new Date();
    return this.prisma.deploymentMemory.create({
      data: {
        organizationId: input.organizationId,
        deploymentId: input.deploymentId,
        category: input.category,
        content: input.content,
        confidence: input.confidence ?? 0.5,
        sourceCount: 1,
        lastSeenAt: now,
      },
    });
  }

  async incrementConfidence(id: string, newConfidence: number) {
    return this.prisma.deploymentMemory.update({
      where: { id },
      data: {
        sourceCount: { increment: 1 },
        confidence: newConfidence,
        lastSeenAt: new Date(),
      },
    });
  }

  async listByDeployment(organizationId: string, deploymentId: string) {
    return this.prisma.deploymentMemory.findMany({
      where: { organizationId, deploymentId },
      orderBy: { confidence: "desc" },
    });
  }

  async listHighConfidence(
    organizationId: string,
    deploymentId: string,
    minConfidence: number,
    minSourceCount: number,
  ) {
    return this.prisma.deploymentMemory.findMany({
      where: {
        organizationId,
        deploymentId,
        confidence: { gte: minConfidence },
        sourceCount: { gte: minSourceCount },
      },
      orderBy: { confidence: "desc" },
    });
  }

  async findByContent(organizationId: string, deploymentId: string, category: string) {
    return this.prisma.deploymentMemory.findMany({
      where: { organizationId, deploymentId, category },
    });
  }

  async delete(id: string) {
    return this.prisma.deploymentMemory.delete({ where: { id } });
  }

  async countByDeployment(organizationId: string, deploymentId: string): Promise<number> {
    return this.prisma.deploymentMemory.count({
      where: { organizationId, deploymentId },
    });
  }
}
```

- [ ] **Step 7: Run store tests**

```bash
npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-deployment-memory-store
npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-interaction-summary-store
```

- [ ] **Step 8: Export from packages/db/src/index.ts**

Add to `packages/db/src/index.ts`:

```typescript
export { PrismaInteractionSummaryStore } from "./stores/prisma-interaction-summary-store.js";
export { PrismaDeploymentMemoryStore } from "./stores/prisma-deployment-memory-store.js";
```

- [ ] **Step 9: Run typecheck**

```bash
npx pnpm@9.15.4 typecheck
```

- [ ] **Step 10: Commit**

```bash
git commit -m "feat(db): add PrismaInteractionSummaryStore + PrismaDeploymentMemoryStore"
```

---

### Task 5: Conversation Lifecycle Hook

**Files:**

- Create: `packages/core/src/channel-gateway/conversation-lifecycle.ts`
- Modify: `packages/core/src/channel-gateway/index.ts` (export new types)
- Test: `packages/core/src/__tests__/conversation-lifecycle.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/core/src/__tests__/conversation-lifecycle.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ConversationLifecycleTracker,
  type ConversationEndHandler,
} from "../channel-gateway/conversation-lifecycle.js";

describe("ConversationLifecycleTracker", () => {
  let handler: ConversationEndHandler;
  let tracker: ConversationLifecycleTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    handler = vi.fn().mockResolvedValue(undefined);
    tracker = new ConversationLifecycleTracker({
      onConversationEnd: handler,
      inactivityTimeoutMs: 5000,
    });
  });

  it("fires end event after inactivity timeout", async () => {
    tracker.recordMessage({
      sessionKey: "dep-1:telegram:session-1",
      deploymentId: "dep-1",
      organizationId: "org-1",
      channelType: "telegram",
      sessionId: "session-1",
      role: "user",
      content: "Hello",
    });

    vi.advanceTimersByTime(5000);
    // Allow async handler to run
    await vi.runAllTimersAsync();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dep-1",
        organizationId: "org-1",
        channelType: "telegram",
        endReason: "inactivity",
      }),
    );
  });

  it("resets timer on new message", async () => {
    tracker.recordMessage({
      sessionKey: "dep-1:telegram:session-1",
      deploymentId: "dep-1",
      organizationId: "org-1",
      channelType: "telegram",
      sessionId: "session-1",
      role: "user",
      content: "Hello",
    });

    vi.advanceTimersByTime(3000);
    expect(handler).not.toHaveBeenCalled();

    tracker.recordMessage({
      sessionKey: "dep-1:telegram:session-1",
      deploymentId: "dep-1",
      organizationId: "org-1",
      channelType: "telegram",
      sessionId: "session-1",
      role: "assistant",
      content: "Hi there!",
    });

    vi.advanceTimersByTime(3000);
    expect(handler).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    await vi.runAllTimersAsync();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("tracks message count and computes duration", async () => {
    tracker.recordMessage({
      sessionKey: "dep-1:telegram:session-1",
      deploymentId: "dep-1",
      organizationId: "org-1",
      channelType: "telegram",
      sessionId: "session-1",
      role: "user",
      content: "Hello",
    });

    vi.advanceTimersByTime(2000);

    tracker.recordMessage({
      sessionKey: "dep-1:telegram:session-1",
      deploymentId: "dep-1",
      organizationId: "org-1",
      channelType: "telegram",
      sessionId: "session-1",
      role: "assistant",
      content: "Hi there!",
    });

    vi.advanceTimersByTime(5000);
    await vi.runAllTimersAsync();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        messageCount: 2,
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
      }),
    );
  });

  it("fires end event on explicit close", async () => {
    tracker.recordMessage({
      sessionKey: "dep-1:telegram:session-1",
      deploymentId: "dep-1",
      organizationId: "org-1",
      channelType: "telegram",
      sessionId: "session-1",
      role: "user",
      content: "Hello",
    });

    await tracker.closeConversation("dep-1:telegram:session-1", "won");

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        endReason: "won",
      }),
    );
  });

  it("cleans up session after end event fires", async () => {
    tracker.recordMessage({
      sessionKey: "dep-1:telegram:session-1",
      deploymentId: "dep-1",
      organizationId: "org-1",
      channelType: "telegram",
      sessionId: "session-1",
      role: "user",
      content: "Hello",
    });

    vi.advanceTimersByTime(5000);
    await vi.runAllTimersAsync();

    expect(tracker.activeSessionCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx pnpm@9.15.4 --filter @switchboard/core test -- --run conversation-lifecycle
```

- [ ] **Step 3: Implement ConversationLifecycleTracker**

Create `packages/core/src/channel-gateway/conversation-lifecycle.ts`:

```typescript
// ---------------------------------------------------------------------------
// Conversation Lifecycle Tracker — detects conversation end via inactivity
// ---------------------------------------------------------------------------
// Tracks active sessions. Fires ConversationEndEvent when:
//   1. Inactivity timeout expires (default 30 minutes)
//   2. Explicit close (thread stage → won/lost, or channel close signal)
// ---------------------------------------------------------------------------

export type ConversationEndReason = "inactivity" | "explicit_close" | "won" | "lost";

export interface ConversationEndEvent {
  deploymentId: string;
  organizationId: string;
  contactId: string | null;
  channelType: string;
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
  duration: number;
  messageCount: number;
  endReason: ConversationEndReason;
}

export type ConversationEndHandler = (event: ConversationEndEvent) => Promise<void>;

export interface ConversationLifecycleConfig {
  onConversationEnd: ConversationEndHandler;
  inactivityTimeoutMs?: number;
}

export interface RecordMessageInput {
  sessionKey: string;
  deploymentId: string;
  organizationId: string;
  channelType: string;
  sessionId: string;
  contactId?: string;
  role: string;
  content: string;
}

interface ActiveSession {
  deploymentId: string;
  organizationId: string;
  channelType: string;
  sessionId: string;
  contactId: string | null;
  messages: Array<{ role: string; content: string }>;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class ConversationLifecycleTracker {
  private sessions = new Map<string, ActiveSession>();
  private readonly timeoutMs: number;
  private readonly handler: ConversationEndHandler;

  constructor(config: ConversationLifecycleConfig) {
    this.handler = config.onConversationEnd;
    this.timeoutMs = config.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
  }

  recordMessage(input: RecordMessageInput): void {
    const existing = this.sessions.get(input.sessionKey);

    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push({ role: input.role, content: input.content });
      if (input.contactId) existing.contactId = input.contactId;
      existing.timer = this.startTimer(input.sessionKey);
    } else {
      this.sessions.set(input.sessionKey, {
        deploymentId: input.deploymentId,
        organizationId: input.organizationId,
        channelType: input.channelType,
        sessionId: input.sessionId,
        contactId: input.contactId ?? null,
        messages: [{ role: input.role, content: input.content }],
        startedAt: Date.now(),
        timer: this.startTimer(input.sessionKey),
      });
    }
  }

  async closeConversation(sessionKey: string, reason: ConversationEndReason): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) return;
    clearTimeout(session.timer);
    await this.fireEnd(sessionKey, session, reason);
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      clearTimeout(session.timer);
    }
    this.sessions.clear();
  }

  private startTimer(sessionKey: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const session = this.sessions.get(sessionKey);
      if (session) {
        void this.fireEnd(sessionKey, session, "inactivity");
      }
    }, this.timeoutMs);
  }

  private async fireEnd(
    sessionKey: string,
    session: ActiveSession,
    reason: ConversationEndReason,
  ): Promise<void> {
    this.sessions.delete(sessionKey);

    const event: ConversationEndEvent = {
      deploymentId: session.deploymentId,
      organizationId: session.organizationId,
      contactId: session.contactId,
      channelType: session.channelType,
      sessionId: session.sessionId,
      messages: session.messages,
      duration: Math.round((Date.now() - session.startedAt) / 1000),
      messageCount: session.messages.length,
      endReason: reason,
    };

    try {
      await this.handler(event);
    } catch (err) {
      console.error("[ConversationLifecycleTracker] Error in end handler:", err);
    }
  }
}
```

- [ ] **Step 4: Export from channel-gateway index**

In `packages/core/src/channel-gateway/index.ts`, add:

```typescript
export { ConversationLifecycleTracker } from "./conversation-lifecycle.js";
export type {
  ConversationEndEvent,
  ConversationEndHandler,
  ConversationEndReason,
  ConversationLifecycleConfig,
  RecordMessageInput,
} from "./conversation-lifecycle.js";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx pnpm@9.15.4 --filter @switchboard/core test -- --run conversation-lifecycle
```

- [ ] **Step 6: Run typecheck**

```bash
npx pnpm@9.15.4 typecheck
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(core): add ConversationLifecycleTracker with inactivity timeout"
```

---

### Task 6: Compounding Loop Service

**Files:**

- Create: `packages/agents/src/memory/compounding-service.ts`
- Create: `packages/agents/src/memory/extraction-prompts.ts`
- Test: `packages/agents/src/memory/__tests__/compounding-service.test.ts`

**Prerequisite:** Create the memory directory:

```bash
mkdir -p packages/agents/src/memory/__tests__
```

- [ ] **Step 1: Write the test**

Create `packages/agents/src/memory/__tests__/compounding-service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConversationCompoundingService } from "../compounding-service.js";
import type { ConversationEndEvent } from "@switchboard/core";

function createMockDeps() {
  return {
    llmClient: {
      complete: vi.fn(),
    },
    embeddingAdapter: {
      embed: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
      embedBatch: vi.fn().mockResolvedValue([new Array(1024).fill(0)]),
    },
    interactionSummaryStore: {
      create: vi.fn().mockResolvedValue({ id: "sum-1" }),
    },
    deploymentMemoryStore: {
      findByContent: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "mem-1" }),
      incrementConfidence: vi.fn().mockResolvedValue({ id: "mem-1", sourceCount: 2 }),
      countByDeployment: vi.fn().mockResolvedValue(0),
    },
    knowledgeStore: {
      search: vi.fn().mockResolvedValue([]),
      store: vi.fn(),
      storeBatch: vi.fn(),
      deleteByDocument: vi.fn(),
    },
  };
}

const baseEvent: ConversationEndEvent = {
  deploymentId: "dep-1",
  organizationId: "org-1",
  contactId: null,
  channelType: "telegram",
  sessionId: "session-1",
  messages: [
    { role: "user", content: "What services do you offer?" },
    { role: "assistant", content: "We offer teeth whitening and cleaning." },
    { role: "user", content: "How much is teeth whitening?" },
    { role: "assistant", content: "Teeth whitening starts at $299." },
  ],
  duration: 120,
  messageCount: 4,
  endReason: "inactivity",
};

describe("ConversationCompoundingService", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let service: ConversationCompoundingService;

  beforeEach(() => {
    deps = createMockDeps();
    service = new ConversationCompoundingService(deps);
  });

  it("creates an interaction summary from LLM output", async () => {
    deps.llmClient.complete
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: "Customer inquired about teeth whitening pricing.",
          outcome: "info_request",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: "Teeth whitening costs $299", confidence: 0.8, category: "fact" }],
          questions: ["What services do you offer?", "How much is teeth whitening?"],
        }),
      );

    await service.processConversationEnd(baseEvent);

    expect(deps.interactionSummaryStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        deploymentId: "dep-1",
        summary: "Customer inquired about teeth whitening pricing.",
        outcome: "info_request",
      }),
    );
  });

  it("creates deployment memory entries for extracted facts", async () => {
    deps.llmClient.complete
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: "Customer asked about pricing.",
          outcome: "info_request",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: "Closed on Sundays", confidence: 0.7, category: "fact" }],
          questions: [],
        }),
      );

    await service.processConversationEnd(baseEvent);

    expect(deps.deploymentMemoryStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Closed on Sundays",
        category: "fact",
      }),
    );
  });

  it("increments existing memory when similar fact found via embedding", async () => {
    const existingMemory = {
      id: "mem-existing",
      content: "They are closed on Sundays",
      category: "fact",
      confidence: 0.5,
      sourceCount: 1,
    };
    deps.deploymentMemoryStore.findByContent.mockResolvedValue([existingMemory]);
    // Mock embedding similarity — return vectors that would be similar
    deps.embeddingAdapter.embed
      .mockResolvedValueOnce(new Array(1024).fill(0.5)) // new fact
      .mockResolvedValueOnce(new Array(1024).fill(0.5)); // existing fact (same = cosine 1.0)

    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "Quick chat.", outcome: "info_request" }))
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: "Closed on Sundays", confidence: 0.7, category: "fact" }],
          questions: [],
        }),
      );

    await service.processConversationEnd(baseEvent);

    expect(deps.deploymentMemoryStore.incrementConfidence).toHaveBeenCalledWith(
      "mem-existing",
      expect.any(Number),
    );
    expect(deps.deploymentMemoryStore.create).not.toHaveBeenCalled();
  });

  it("handles LLM errors gracefully without throwing", async () => {
    deps.llmClient.complete.mockRejectedValue(new Error("LLM timeout"));

    await expect(service.processConversationEnd(baseEvent)).resolves.not.toThrow();
  });

  it("skips conversations with fewer than 2 messages", async () => {
    const shortEvent = {
      ...baseEvent,
      messages: [{ role: "user", content: "hi" }],
      messageCount: 1,
    };
    await service.processConversationEnd(shortEvent);
    expect(deps.llmClient.complete).not.toHaveBeenCalled();
  });

  it("skips fact creation when deployment memory cap is reached", async () => {
    deps.deploymentMemoryStore.countByDeployment.mockResolvedValue(500);
    deps.llmClient.complete
      .mockResolvedValueOnce(JSON.stringify({ summary: "Chat.", outcome: "info_request" }))
      .mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: "New fact", confidence: 0.8, category: "fact" }],
          questions: [],
        }),
      );

    await service.processConversationEnd(baseEvent);

    expect(deps.deploymentMemoryStore.create).not.toHaveBeenCalled();
  });

  it("tracks questions as FAQ and promotes to knowledge store at 3+ occurrences", async () => {
    const mockKnowledgeStore = { store: vi.fn().mockResolvedValue(undefined) };
    service = new ConversationCompoundingService({
      ...deps,
      knowledgeStore: mockKnowledgeStore,
      agentId: "agent-1",
    });

    // Existing FAQ entry with sourceCount=2 (one more hit promotes it)
    const existingFaq = {
      id: "faq-1",
      content: "What services do you offer?",
      category: "faq",
      confidence: 0.6,
      sourceCount: 2,
    };
    deps.deploymentMemoryStore.findByContent.mockImplementation((_org, _dep, cat) =>
      Promise.resolve(cat === "faq" ? [existingFaq] : []),
    );
    deps.deploymentMemoryStore.incrementConfidence.mockResolvedValue({
      id: "faq-1",
      sourceCount: 3,
    });
    deps.embeddingAdapter.embed
      .mockResolvedValueOnce(new Array(1024).fill(0.5)) // new question
      .mockResolvedValueOnce(new Array(1024).fill(0.5)); // existing question (same = cosine 1.0)

    deps.llmClient.complete
      .mockResolvedValueOnce(
        JSON.stringify({ summary: "Asked about services.", outcome: "info_request" }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ facts: [], questions: ["What services do you offer?"] }),
      );

    await service.processConversationEnd(baseEvent);

    expect(deps.deploymentMemoryStore.incrementConfidence).toHaveBeenCalledWith(
      "faq-1",
      expect.any(Number),
    );
    expect(mockKnowledgeStore.store).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "learned",
        content: expect.stringContaining("Frequently asked question"),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx pnpm@9.15.4 --filter @switchboard/agents test -- --run compounding-service
```

- [ ] **Step 3: Create extraction prompts**

Create `packages/agents/src/memory/extraction-prompts.ts`:

```typescript
// ---------------------------------------------------------------------------
// LLM prompts for post-conversation fact extraction
// ---------------------------------------------------------------------------

export function buildSummarizationPrompt(
  messages: Array<{ role: string; content: string }>,
): string {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Customer" : "Agent"}: ${m.content}`)
    .join("\n");

  return `Summarize this conversation between a customer and an AI agent. Return JSON only.

<transcript>
${transcript}
</transcript>

Return exactly this JSON structure (no markdown, no explanation):
{
  "summary": "1-2 sentence summary of what happened",
  "outcome": "booked|qualified|lost|info_request|escalated"
}`;
}

export function buildFactExtractionPrompt(
  messages: Array<{ role: string; content: string }>,
): string {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Customer" : "Agent"}: ${m.content}`)
    .join("\n");

  return `Extract factual information about the business and customer preferences from this conversation. Only extract facts that are explicitly stated or strongly implied. Do NOT hallucinate or infer facts that aren't supported by the text.

<transcript>
${transcript}
</transcript>

Return exactly this JSON structure (no markdown, no explanation):
{
  "facts": [
    {
      "fact": "concise statement of the fact",
      "confidence": 0.5-1.0,
      "category": "preference|faq|objection|pattern|fact"
    }
  ],
  "questions": ["questions the customer asked, verbatim or close to it"]
}

If no facts can be extracted, return {"facts": [], "questions": []}.`;
}
```

- [ ] **Step 4: Implement ConversationCompoundingService**

Create `packages/agents/src/memory/compounding-service.ts`:

```typescript
// ---------------------------------------------------------------------------
// Conversation Compounding Service — post-conversation memory extraction
// ---------------------------------------------------------------------------
// Runs after each conversation ends. Extracts facts, creates summaries,
// and upserts deployment memory entries with similarity-based dedup.
// ---------------------------------------------------------------------------

import type { ConversationEndEvent, EmbeddingAdapter } from "@switchboard/core";
import { computeConfidenceScore } from "@switchboard/schemas";
import { buildSummarizationPrompt, buildFactExtractionPrompt } from "./extraction-prompts.js";

export interface CompoundingLLMClient {
  complete(prompt: string): Promise<string>;
}

export interface CompoundingInteractionSummaryStore {
  create(input: {
    organizationId: string;
    deploymentId: string;
    channelType: string;
    contactId?: string;
    summary: string;
    outcome: string;
    extractedFacts: unknown[];
    questionsAsked: string[];
    duration: number;
    messageCount: number;
  }): Promise<{ id: string }>;
}

export interface CompoundingDeploymentMemoryStore {
  findByContent(
    organizationId: string,
    deploymentId: string,
    category: string,
  ): Promise<Array<{ id: string; content: string; sourceCount: number; confidence: number }>>;
  create(input: {
    organizationId: string;
    deploymentId: string;
    category: string;
    content: string;
    confidence?: number;
  }): Promise<{ id: string }>;
  incrementConfidence(
    id: string,
    newConfidence: number,
  ): Promise<{ id: string; sourceCount: number }>;
  countByDeployment(organizationId: string, deploymentId: string): Promise<number>;
}

export interface CompoundingDeps {
  llmClient: CompoundingLLMClient;
  embeddingAdapter: EmbeddingAdapter;
  interactionSummaryStore: CompoundingInteractionSummaryStore;
  deploymentMemoryStore: CompoundingDeploymentMemoryStore;
  knowledgeStore?: {
    store(chunk: {
      id: string;
      organizationId: string;
      agentId: string;
      deploymentId?: string;
      documentId: string;
      content: string;
      sourceType: string;
      embedding: number[];
      chunkIndex: number;
      metadata: Record<string, unknown>;
    }): Promise<void>;
  };
  agentId?: string;
}

const MIN_MESSAGES = 2;
const SIMILARITY_THRESHOLD = 0.92;
const MAX_MEMORY_ENTRIES = 500;
const FAQ_PROMOTION_THRESHOLD = 3;

interface SummarizationResult {
  summary: string;
  outcome: string;
}

interface ExtractionResult {
  facts: Array<{ fact: string; confidence: number; category: string }>;
  questions: string[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    magA += (a[i] ?? 0) ** 2;
    magB += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export class ConversationCompoundingService {
  private readonly llm: CompoundingLLMClient;
  private readonly embedding: EmbeddingAdapter;
  private readonly summaryStore: CompoundingInteractionSummaryStore;
  private readonly memoryStore: CompoundingDeploymentMemoryStore;
  private readonly knowledgeStore: CompoundingDeps["knowledgeStore"];
  private readonly agentId: string;

  constructor(deps: CompoundingDeps) {
    this.llm = deps.llmClient;
    this.embedding = deps.embeddingAdapter;
    this.summaryStore = deps.interactionSummaryStore;
    this.memoryStore = deps.deploymentMemoryStore;
    this.knowledgeStore = deps.knowledgeStore;
    this.agentId = deps.agentId ?? "default";
  }

  async processConversationEnd(event: ConversationEndEvent): Promise<void> {
    if (event.messages.length < MIN_MESSAGES) return;

    try {
      // Step 1 + 2: Summarize and extract in parallel
      const [summarization, extraction] = await Promise.all([
        this.summarize(event.messages),
        this.extractFacts(event.messages),
      ]);

      // Step 3: Store interaction summary
      await this.summaryStore.create({
        organizationId: event.organizationId,
        deploymentId: event.deploymentId,
        channelType: event.channelType,
        contactId: event.contactId ?? undefined,
        summary: summarization.summary,
        outcome: summarization.outcome,
        extractedFacts: extraction.facts,
        questionsAsked: extraction.questions,
        duration: event.duration,
        messageCount: event.messageCount,
      });

      // Step 4: Upsert facts into deployment memory
      for (const fact of extraction.facts) {
        await this.upsertFact(event.organizationId, event.deploymentId, fact);
      }

      // Step 5: Track FAQ questions — promote to Tier 2 knowledge at 3+ occurrences
      for (const question of extraction.questions) {
        await this.trackQuestion(event.organizationId, event.deploymentId, question);
      }
    } catch (err) {
      console.error("[CompoundingService] Failed to process conversation end:", err);
    }
  }

  private async summarize(
    messages: Array<{ role: string; content: string }>,
  ): Promise<SummarizationResult> {
    const prompt = buildSummarizationPrompt(messages);
    const raw = await this.llm.complete(prompt);
    return JSON.parse(raw) as SummarizationResult;
  }

  private async extractFacts(
    messages: Array<{ role: string; content: string }>,
  ): Promise<ExtractionResult> {
    const prompt = buildFactExtractionPrompt(messages);
    const raw = await this.llm.complete(prompt);
    return JSON.parse(raw) as ExtractionResult;
  }

  private async upsertFact(
    organizationId: string,
    deploymentId: string,
    fact: { fact: string; confidence: number; category: string },
  ): Promise<void> {
    // Check entry cap
    const count = await this.memoryStore.countByDeployment(organizationId, deploymentId);
    if (count >= MAX_MEMORY_ENTRIES) return;

    // Find existing entries in same category for similarity check
    const existing = await this.memoryStore.findByContent(
      organizationId,
      deploymentId,
      fact.category,
    );

    if (existing.length > 0) {
      const newEmbedding = await this.embedding.embed(fact.fact);

      for (const entry of existing) {
        const entryEmbedding = await this.embedding.embed(entry.content);
        const similarity = cosineSimilarity(newEmbedding, entryEmbedding);

        if (similarity >= SIMILARITY_THRESHOLD) {
          // Similar fact exists — increment confidence
          const newSourceCount = entry.sourceCount + 1;
          const newConfidence = computeConfidenceScore(newSourceCount, false);
          await this.memoryStore.incrementConfidence(entry.id, newConfidence);
          return;
        }
      }
    }

    // No similar fact found — create new entry
    await this.memoryStore.create({
      organizationId,
      deploymentId,
      category: fact.category,
      content: fact.fact,
    });
  }

  private async trackQuestion(
    organizationId: string,
    deploymentId: string,
    question: string,
  ): Promise<void> {
    // Use DeploymentMemory with category "faq" to track question frequency
    const existing = await this.memoryStore.findByContent(organizationId, deploymentId, "faq");

    if (existing.length > 0) {
      const questionEmbedding = await this.embedding.embed(question);

      for (const entry of existing) {
        const entryEmbedding = await this.embedding.embed(entry.content);
        const similarity = cosineSimilarity(questionEmbedding, entryEmbedding);

        if (similarity >= SIMILARITY_THRESHOLD) {
          const newSourceCount = entry.sourceCount + 1;
          const newConfidence = computeConfidenceScore(newSourceCount, false);
          const result = await this.memoryStore.incrementConfidence(entry.id, newConfidence);

          // Promote to Tier 2 knowledge when asked 3+ times
          if (result.sourceCount >= FAQ_PROMOTION_THRESHOLD && this.knowledgeStore) {
            const embedding = await this.embedding.embed(entry.content);
            await this.knowledgeStore.store({
              id: crypto.randomUUID(),
              organizationId,
              agentId: this.agentId,
              deploymentId,
              documentId: `faq-${entry.id}`,
              content: `Frequently asked question: ${entry.content}`,
              sourceType: "learned",
              embedding,
              chunkIndex: 0,
              metadata: { source: "faq-auto", sourceCount: result.sourceCount },
            });
          }
          return;
        }
      }
    }

    // New question — track it
    await this.memoryStore.create({
      organizationId,
      deploymentId,
      category: "faq",
      content: question,
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx pnpm@9.15.4 --filter @switchboard/agents test -- --run compounding-service
```

- [ ] **Step 6: Run typecheck**

```bash
npx pnpm@9.15.4 typecheck
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(agents): add ConversationCompoundingService with LLM fact extraction"
```

---

### Task 7: Context Builder

**Files:**

- Create: `packages/agents/src/memory/context-builder.ts`
- Test: `packages/agents/src/memory/__tests__/context-builder.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/agents/src/memory/__tests__/context-builder.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContextBuilder } from "../context-builder.js";

function createMockDeps() {
  return {
    knowledgeRetriever: {
      retrieve: vi.fn().mockResolvedValue([]),
    },
    deploymentMemoryStore: {
      listHighConfidence: vi.fn().mockResolvedValue([]),
    },
    interactionSummaryStore: {
      listByDeployment: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("ContextBuilder", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let builder: ContextBuilder;

  beforeEach(() => {
    deps = createMockDeps();
    builder = new ContextBuilder(deps);
  });

  it("returns empty context when no data exists", async () => {
    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "What services do you offer?",
    });

    expect(result.retrievedChunks).toEqual([]);
    expect(result.learnedFacts).toEqual([]);
    expect(result.recentSummaries).toEqual([]);
    expect(result.totalTokenEstimate).toBe(0);
  });

  it("includes retrieved knowledge chunks", async () => {
    deps.knowledgeRetriever.retrieve.mockResolvedValue([
      { content: "We offer teeth whitening.", sourceType: "wizard", similarity: 0.9, metadata: {} },
    ]);

    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "What services?",
    });

    expect(result.retrievedChunks).toHaveLength(1);
    expect(result.retrievedChunks[0]?.content).toBe("We offer teeth whitening.");
  });

  it("includes high-confidence deployment memory", async () => {
    deps.deploymentMemoryStore.listHighConfidence.mockResolvedValue([
      {
        id: "m1",
        content: "Closed on Sundays",
        category: "fact",
        confidence: 0.85,
        sourceCount: 5,
      },
    ]);

    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "Are you open today?",
    });

    expect(result.learnedFacts).toHaveLength(1);
    expect(result.learnedFacts[0]?.content).toBe("Closed on Sundays");
  });

  it("respects token budget — truncates when over limit", async () => {
    // Each fact ~ 25 chars = ~6 tokens. Fill 700 facts to exceed 4000 token budget.
    const manyFacts = Array.from({ length: 700 }, (_, i) => ({
      id: `m${i}`,
      content: `Fact number ${i} about biz`,
      category: "fact",
      confidence: 0.9,
      sourceCount: 10,
    }));
    deps.deploymentMemoryStore.listHighConfidence.mockResolvedValue(manyFacts);

    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "Tell me everything",
      tokenBudget: 4000,
    });

    expect(result.totalTokenEstimate).toBeLessThanOrEqual(4000);
    expect(result.learnedFacts.length).toBeLessThan(700);
  });

  it("includes repeat customer summaries when contactId provided", async () => {
    deps.interactionSummaryStore.listByDeployment.mockResolvedValue([
      {
        id: "s1",
        summary: "Customer asked about teeth whitening.",
        outcome: "info_request",
        createdAt: new Date(),
      },
    ]);

    const result = await builder.build({
      organizationId: "org-1",
      agentId: "agent-1",
      deploymentId: "dep-1",
      query: "Hello",
      contactId: "contact-1",
    });

    expect(result.recentSummaries).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx pnpm@9.15.4 --filter @switchboard/agents test -- --run context-builder
```

- [ ] **Step 3: Implement ContextBuilder**

Create `packages/agents/src/memory/context-builder.ts`:

```typescript
// ---------------------------------------------------------------------------
// Context Builder — assembles tiered context with token budget
// ---------------------------------------------------------------------------
// Priority: corrections > wizard > learned > document > patterns
// Token estimate: 1 token ≈ 4 characters
// ---------------------------------------------------------------------------

import { SURFACING_THRESHOLD } from "@switchboard/schemas";

export interface ContextRetrievedChunk {
  content: string;
  sourceType: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export interface ContextLearnedFact {
  content: string;
  category: string;
  confidence: number;
  sourceCount: number;
}

export interface ContextSummary {
  summary: string;
  outcome: string;
  createdAt: Date;
}

export interface BuiltContext {
  retrievedChunks: ContextRetrievedChunk[];
  learnedFacts: ContextLearnedFact[];
  recentSummaries: ContextSummary[];
  totalTokenEstimate: number;
}

export interface ContextBuildInput {
  organizationId: string;
  agentId: string;
  deploymentId: string;
  query: string;
  contactId?: string;
  tokenBudget?: number;
}

export interface ContextBuilderKnowledgeRetriever {
  retrieve(
    query: string,
    options: { organizationId: string; agentId: string; deploymentId?: string },
  ): Promise<ContextRetrievedChunk[]>;
}

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
    }>
  >;
}

export interface ContextBuilderInteractionSummaryStore {
  listByDeployment(
    organizationId: string,
    deploymentId: string,
    options?: { limit?: number; contactId?: string },
  ): Promise<Array<{ id: string; summary: string; outcome: string; createdAt: Date }>>;
}

export interface ContextBuilderDeps {
  knowledgeRetriever: ContextBuilderKnowledgeRetriever;
  deploymentMemoryStore: ContextBuilderDeploymentMemoryStore;
  interactionSummaryStore: ContextBuilderInteractionSummaryStore;
}

const DEFAULT_TOKEN_BUDGET = 4000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class ContextBuilder {
  constructor(private deps: ContextBuilderDeps) {}

  async build(input: ContextBuildInput): Promise<BuiltContext> {
    const budget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    let tokensUsed = 0;

    // Fetch all sources in parallel
    const [chunks, memories, summaries] = await Promise.all([
      this.deps.knowledgeRetriever.retrieve(input.query, {
        organizationId: input.organizationId,
        agentId: input.agentId,
        deploymentId: input.deploymentId,
      }),
      this.deps.deploymentMemoryStore.listHighConfidence(
        input.organizationId,
        input.deploymentId,
        SURFACING_THRESHOLD.minConfidence,
        SURFACING_THRESHOLD.minSourceCount,
      ),
      input.contactId
        ? this.deps.interactionSummaryStore.listByDeployment(
            input.organizationId,
            input.deploymentId,
            { limit: 3, contactId: input.contactId },
          )
        : Promise.resolve([]),
    ]);

    // Assemble with budget — priority: chunks (corrections first) > facts > summaries
    const retrievedChunks: ContextRetrievedChunk[] = [];
    for (const chunk of chunks) {
      const tokens = estimateTokens(chunk.content);
      if (tokensUsed + tokens > budget) break;
      retrievedChunks.push(chunk);
      tokensUsed += tokens;
    }

    const learnedFacts: ContextLearnedFact[] = [];
    for (const mem of memories) {
      const tokens = estimateTokens(mem.content);
      if (tokensUsed + tokens > budget) break;
      learnedFacts.push({
        content: mem.content,
        category: mem.category,
        confidence: mem.confidence,
        sourceCount: mem.sourceCount,
      });
      tokensUsed += tokens;
    }

    const recentSummaries: ContextSummary[] = [];
    for (const sum of summaries) {
      const tokens = estimateTokens(sum.summary);
      if (tokensUsed + tokens > budget) break;
      recentSummaries.push({
        summary: sum.summary,
        outcome: sum.outcome,
        createdAt: sum.createdAt,
      });
      tokensUsed += tokens;
    }

    return {
      retrievedChunks,
      learnedFacts,
      recentSummaries,
      totalTokenEstimate: tokensUsed,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx pnpm@9.15.4 --filter @switchboard/agents test -- --run context-builder
```

- [ ] **Step 5: Run typecheck**

```bash
npx pnpm@9.15.4 typecheck
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(agents): add ContextBuilder with tiered priority and token budget"
```

---

### Task 8: Owner Correction API

**Files:**

- Create: `apps/api/src/routes/deployment-memory.ts`
- Modify: `apps/api/src/app.ts` (register route)
- Test: `apps/api/src/routes/__tests__/deployment-memory.test.ts`

- [ ] **Step 1: Check app.ts for route registration pattern**

Read `apps/api/src/app.ts` to understand how routes are registered (look for `fastify.register`).

- [ ] **Step 2: Write the route test**

Create `apps/api/src/routes/__tests__/deployment-memory.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

// Validate input schemas match what the route expects
const CorrectMemoryInput = z.object({
  content: z.string().min(1),
  category: z.string().min(1),
});

describe("deployment-memory route input validation", () => {
  it("accepts valid correction input", () => {
    const result = CorrectMemoryInput.parse({
      content: "Closed on Sundays",
      category: "fact",
    });
    expect(result.content).toBe("Closed on Sundays");
  });

  it("rejects empty content", () => {
    expect(() => CorrectMemoryInput.parse({ content: "", category: "fact" })).toThrow();
  });

  it("rejects missing category", () => {
    expect(() => CorrectMemoryInput.parse({ content: "test" })).toThrow();
  });
});
```

Note: Full HTTP integration tests require the Fastify app wired with a test DB. The stores themselves are unit-tested in Task 4. This test validates the Zod input schemas used by the route.

- [ ] **Step 3: Implement deployment-memory route**

Create `apps/api/src/routes/deployment-memory.ts`:

```typescript
// ---------------------------------------------------------------------------
// Deployment Memory routes — owner view/correct/delete learned facts
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { PrismaDeploymentMemoryStore } from "@switchboard/db";
import { z } from "zod";

const CorrectMemoryInput = z.object({
  content: z.string().min(1),
  category: z.string().min(1),
});

export const deploymentMemoryRoutes: FastifyPluginAsync = async (app) => {
  // List all learned memories for a deployment
  app.get<{
    Params: { orgId: string; deploymentId: string };
  }>("/:orgId/deployments/:deploymentId/memory", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }
    const store = new PrismaDeploymentMemoryStore(app.prisma);
    const { orgId, deploymentId } = request.params;
    const entries = await store.listByDeployment(orgId, deploymentId);
    return { data: entries };
  });

  // Add an owner correction (confidence = 1.0)
  app.post<{
    Params: { orgId: string; deploymentId: string };
    Body: z.infer<typeof CorrectMemoryInput>;
  }>("/:orgId/deployments/:deploymentId/memory", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }
    const store = new PrismaDeploymentMemoryStore(app.prisma);
    const { orgId, deploymentId } = request.params;
    const body = CorrectMemoryInput.parse(request.body);
    const entry = await store.create({
      organizationId: orgId,
      deploymentId,
      category: body.category,
      content: body.content,
      confidence: 1.0,
    });
    return reply.status(201).send({ data: entry });
  });

  // Delete a memory entry (owner override)
  app.delete<{
    Params: { orgId: string; deploymentId: string; memoryId: string };
  }>("/:orgId/deployments/:deploymentId/memory/:memoryId", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }
    const store = new PrismaDeploymentMemoryStore(app.prisma);
    const { memoryId } = request.params;
    await store.delete(memoryId);
    return reply.status(204).send();
  });
};
```

- [ ] **Step 4: Register route in apps/api/src/bootstrap/routes.ts**

Add import and registration following the existing pattern:

```typescript
import { deploymentMemoryRoutes } from "../routes/deployment-memory.js";
```

And in the `registerRoutes` function, add after the marketplace routes:

```typescript
await app.register(deploymentMemoryRoutes, { prefix: "/api/marketplace" });
```

- [ ] **Step 5: Run typecheck**

```bash
npx pnpm@9.15.4 typecheck
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(api): add deployment memory owner correction routes"
```

---

### Task 9: Wire Lifecycle Tracker into Chat App

**Files:**

- Modify: `apps/chat/src/gateway/gateway-bridge.ts` (where `ChannelGateway` is instantiated)
- Modify: `packages/agents/src/index.ts` (export memory module)

- [ ] **Step 1: Export memory module from @switchboard/agents**

Add to `packages/agents/src/index.ts`:

```typescript
// Memory (post-conversation compounding, context building)
export {
  ConversationCompoundingService,
  type CompoundingDeps,
  type CompoundingLLMClient,
} from "./memory/compounding-service.js";
export {
  ContextBuilder,
  type BuiltContext,
  type ContextBuildInput,
  type ContextBuilderDeps,
} from "./memory/context-builder.js";
```

- [ ] **Step 2: Wire ConversationLifecycleTracker into gateway-bridge.ts**

Modify `apps/chat/src/gateway/gateway-bridge.ts`. The file currently creates a `ChannelGateway` and hooks `onMessageRecorded` to a `TaskRecorder`. Add the lifecycle tracker alongside it:

```typescript
import type { PrismaClient } from "@switchboard/db";
import {
  PrismaDeploymentStateStore,
  PrismaActionRequestStore,
  PrismaAgentTaskStore,
  PrismaInteractionSummaryStore,
  PrismaDeploymentMemoryStore,
} from "@switchboard/db";
import { ChannelGateway, ConversationLifecycleTracker } from "@switchboard/core";
import { createAnthropicAdapter } from "@switchboard/core/agent-runtime";
import { ConversationCompoundingService, ClaudeEmbeddingAdapter } from "@switchboard/agents";
import { PrismaDeploymentLookup } from "./deployment-lookup.js";
import { PrismaGatewayConversationStore } from "./gateway-conversation-store.js";
import { TaskRecorder } from "./task-recorder.js";

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

  // Memory compounding — extract facts after each conversation
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
    embeddingAdapter: new ClaudeEmbeddingAdapter({
      createEmbedding: async (params) => {
        // TODO: wire real Anthropic embedding client here
        // For now, return zero vectors — compounding still works,
        // but similarity dedup will treat all facts as dissimilar
        return { embeddings: params.texts.map(() => new Array(1024).fill(0)) };
      },
    }),
    interactionSummaryStore: new PrismaInteractionSummaryStore(prisma),
    deploymentMemoryStore: new PrismaDeploymentMemoryStore(prisma),
  });

  const lifecycleTracker = new ConversationLifecycleTracker({
    onConversationEnd: (event) => compoundingService.processConversationEnd(event),
  });

  return new ChannelGateway({
    deploymentLookup: new PrismaDeploymentLookup(prisma),
    conversationStore: new PrismaGatewayConversationStore(prisma),
    stateStore: new PrismaDeploymentStateStore(prisma),
    actionRequestStore: new PrismaActionRequestStore(prisma),
    llmAdapterFactory: () => createAnthropicAdapter(),
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

Key differences from the original `gateway-bridge.ts`:

- `ClaudeEmbeddingAdapter` is imported from `@switchboard/agents` (not `@switchboard/core/agent-runtime`)
- `ClaudeEmbeddingAdapter` constructor takes `{ createEmbedding: (params) => Promise<{ embeddings: number[][] }> }` — not `{ client: ... }`
- `conversationHistory` uses the `Message` type which requires `{ id, contactId, direction, content, timestamp, channel }` — not `{ role, content }`
- The embedding `createEmbedding` is a placeholder (returns zero vectors). This means similarity dedup won't work until a real embedding client is wired. Facts will still be stored, just not deduplicated. Wire the real client as a fast follow-up.

- [ ] **Step 3: Run typecheck + full test suite**

```bash
npx pnpm@9.15.4 typecheck
npx pnpm@9.15.4 test
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(chat): wire ConversationLifecycleTracker + compounding loop into gateway"
```

---

### Task 10: Final Validation

- [ ] **Step 1: Run full test suite**

```bash
npx pnpm@9.15.4 test
```

- [ ] **Step 2: Run typecheck**

```bash
npx pnpm@9.15.4 typecheck
```

- [ ] **Step 3: Run lint**

```bash
npx pnpm@9.15.4 lint
```

- [ ] **Step 4: Verify no file exceeds 400 lines**

Check that all new files are under 400 lines:

```bash
wc -l packages/agents/src/memory/compounding-service.ts packages/agents/src/memory/context-builder.ts packages/agents/src/memory/extraction-prompts.ts packages/core/src/channel-gateway/conversation-lifecycle.ts packages/schemas/src/deployment-memory.ts packages/db/src/stores/prisma-interaction-summary-store.ts packages/db/src/stores/prisma-deployment-memory-store.ts apps/api/src/routes/deployment-memory.ts
```

All should be under 200 lines individually.

- [ ] **Step 5: Commit any remaining fixes**

```bash
git commit -m "chore: fix lint/type issues from memory foundation implementation"
```
