# FAQ Draft System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the FAQ draft lifecycle so auto-learned FAQs go through a pending → approved flow instead of going live immediately. Customers only see approved FAQs; owners can review/approve/reject from the API and dashboard.

**Architecture:** The infrastructure already exists — Prisma fields, scoped store interfaces, scoped store implementations, notification classifier. This plan connects 7 disconnected wires: (1) add `draftStatus`/`draftExpiresAt` to the `KnowledgeChunk` TypeScript type and SQL INSERT, (2) set them when auto-promoting FAQs, (3) filter them in vector search, (4) expose API routes for owner review, (5) add dashboard proxy routes, (6) add dashboard hooks, (7) add dashboard FAQ review UI component.

**Tech Stack:** TypeScript, Prisma, Fastify, Next.js 14, TanStack React Query, Tailwind, shadcn/ui

**Scope exclusions:** Gap 5 (auto-promotion via runtime worker) and Gap 6 (ActivityLog entries for FAQ events) are deferred to the runtime worker plan. This plan makes the draft lifecycle work for manual owner review only.

---

## File Map

| Action | File                                                                                                    | Responsibility                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Modify | `packages/core/src/knowledge-store.ts`                                                                  | Add `draftStatus`/`draftExpiresAt` to `KnowledgeChunk` interface                        |
| Modify | `packages/db/src/stores/prisma-knowledge-store.ts`                                                      | Add draft fields to local type, SQL INSERT, and draft filter to `search()`              |
| Modify | `packages/agents/src/memory/compounding-service.ts`                                                     | Set `draftStatus: "pending"` and `draftExpiresAt` when promoting FAQ to knowledge store |
| Modify | `apps/api/src/routes/deployment-memory.ts`                                                              | Add 3 FAQ draft endpoints: list, approve, reject                                        |
| Modify | `apps/dashboard/src/lib/api-client.ts`                                                                  | Add `listDraftFAQs`, `approveDraftFAQ`, `rejectDraftFAQ` methods to `SwitchboardClient` |
| Create | `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/faq-drafts/route.ts`                 | Next.js proxy route for FAQ draft list                                                  |
| Create | `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/faq-drafts/[faqId]/approve/route.ts` | Next.js proxy route for FAQ approve                                                     |
| Create | `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/faq-drafts/[faqId]/reject/route.ts`  | Next.js proxy route for FAQ reject                                                      |
| Modify | `apps/dashboard/src/hooks/use-marketplace.ts`                                                           | Add `useDraftFAQs`, `useApproveFAQ`, `useRejectFAQ` hooks                               |
| Modify | `apps/dashboard/src/lib/query-keys.ts`                                                                  | Add `faqDrafts` query key                                                               |
| Create | `apps/dashboard/src/components/marketplace/faq-review-queue.tsx`                                        | FAQ review queue component                                                              |
| Modify | `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx`                           | Mount FAQ review queue component                                                        |
| Modify | `packages/db/src/stores/__tests__/prisma-knowledge-store.test.ts`                                       | Test draft filtering in `search()`                                                      |
| Modify | `packages/agents/src/memory/__tests__/compounding-service.test.ts`                                      | Test draft fields set on FAQ promotion                                                  |

---

### Task 1: Add Draft Fields to KnowledgeChunk Type & SQL

**Files:**

- Modify: `packages/core/src/knowledge-store.ts:12-23`
- Modify: `packages/db/src/stores/prisma-knowledge-store.ts:9-20,59-71`

- [ ] **Step 1: Write the failing test for `store()` with draft fields**

In `packages/db/src/stores/__tests__/prisma-knowledge-store.test.ts`, add a new test after the existing `store()` test:

```typescript
it("includes draftStatus and draftExpiresAt in INSERT when provided", async () => {
  mockPrisma.$executeRaw.mockResolvedValue(1);
  const expiresAt = new Date("2026-05-01T00:00:00Z");

  await store.store({
    id: "chunk-draft",
    organizationId: "org-1",
    agentId: "employee-a",
    documentId: "doc-faq",
    content: "FAQ answer",
    sourceType: "learned",
    embedding: [0.1, 0.2, 0.3],
    chunkIndex: 0,
    metadata: {},
    draftStatus: "pending",
    draftExpiresAt: expiresAt,
  });

  expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-knowledge-store`
Expected: TypeScript error — `draftStatus` and `draftExpiresAt` not in type

- [ ] **Step 3: Add draft fields to core `KnowledgeChunk` interface**

In `packages/core/src/knowledge-store.ts`, add two optional fields to the `KnowledgeChunk` interface (after line 22):

```typescript
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
  draftStatus?: string | null;
  draftExpiresAt?: Date | null;
}
```

- [ ] **Step 4: Add draft fields to db-layer local `KnowledgeChunk` interface**

In `packages/db/src/stores/prisma-knowledge-store.ts`, add the same two optional fields to the local interface (after line 19):

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
  draftStatus?: string | null;
  draftExpiresAt?: Date | null;
}
```

- [ ] **Step 5: Update `store()` SQL INSERT to include draft fields**

In `packages/db/src/stores/prisma-knowledge-store.ts`, replace the `store()` method (lines 59-72):

```typescript
async store(chunk: KnowledgeChunk): Promise<void> {
  const vectorStr = `[${chunk.embedding.join(",")}]`;
  await this.prisma.$executeRaw`
    INSERT INTO "KnowledgeChunk" (
      "id", "organizationId", "agentId", "deploymentId", "documentId",
      "content", "sourceType", "embedding", "chunkIndex",
      "metadata", "draftStatus", "draftExpiresAt", "createdAt", "updatedAt"
    ) VALUES (
      ${chunk.id}, ${chunk.organizationId}, ${chunk.agentId}, ${chunk.deploymentId ?? null}, ${chunk.documentId},
      ${chunk.content}, ${chunk.sourceType}, ${vectorStr}::vector, ${chunk.chunkIndex},
      ${JSON.stringify(chunk.metadata)}::jsonb, ${chunk.draftStatus ?? null}, ${chunk.draftExpiresAt ?? null}, NOW(), NOW()
    )
  `;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-knowledge-store`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/knowledge-store.ts packages/db/src/stores/prisma-knowledge-store.ts packages/db/src/stores/__tests__/prisma-knowledge-store.test.ts && git commit -m "$(cat <<'EOF'
feat: add draftStatus/draftExpiresAt to KnowledgeChunk type and SQL INSERT
EOF
)"
```

---

### Task 2: Add Draft Filter to `search()`

**Files:**

- Modify: `packages/db/src/stores/prisma-knowledge-store.ts:80-99`
- Modify: `packages/db/src/stores/__tests__/prisma-knowledge-store.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/db/src/stores/__tests__/prisma-knowledge-store.test.ts`, add a new test inside the `search()` describe block:

```typescript
it("excludes pending draft chunks from search results", async () => {
  mockPrisma.$queryRaw.mockResolvedValue([
    {
      id: "chunk-approved",
      organizationId: "org-1",
      agentId: "employee-a",
      deploymentId: null,
      documentId: "doc-1",
      content: "Approved FAQ",
      sourceType: "learned",
      chunkIndex: 0,
      metadata: "{}",
      similarity: 0.95,
    },
  ]);

  const results = await store.search([0.1, 0.2, 0.3], {
    organizationId: "org-1",
    agentId: "employee-a",
  });

  expect(results).toHaveLength(1);
  // Verify the raw SQL was called — the draft filter is in the SQL string
  expect(mockPrisma.$queryRaw).toHaveBeenCalledOnce();
});
```

Note: Since we're using raw SQL via tagged template literals, we can't easily assert on the SQL string content with mocks. The real validation is that the SQL contains the draft filter clause. We verify correctness structurally.

- [ ] **Step 2: Add draft filter to the `search()` SQL WHERE clause**

In `packages/db/src/stores/prisma-knowledge-store.ts`, modify the `search()` method's raw SQL query. Add a draft filter line after the deployment filter (line 96):

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
      AND ("draftStatus" IS NULL OR "draftStatus" = 'approved')
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
    similarity: row.similarity * (SOURCE_BOOST[row.sourceType] ?? 1.0),
  }));
}
```

The key addition is the single line:

```sql
AND ("draftStatus" IS NULL OR "draftStatus" = 'approved')
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-knowledge-store`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/stores/prisma-knowledge-store.ts packages/db/src/stores/__tests__/prisma-knowledge-store.test.ts && git commit -m "$(cat <<'EOF'
feat: filter pending draft FAQs from KnowledgeStore.search() results
EOF
)"
```

---

### Task 3: Set Draft Fields on FAQ Promotion

**Files:**

- Modify: `packages/agents/src/memory/compounding-service.ts:49-62,218-231`
- Modify: `packages/agents/src/memory/__tests__/compounding-service.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/agents/src/memory/__tests__/compounding-service.test.ts`, modify the existing test "tracks questions as FAQ and promotes to knowledge store at 3+ occurrences" (line 185). Add an assertion that the `store()` call includes `draftStatus` and `draftExpiresAt`:

After the existing `expect(mockKnowledgeStore.store).toHaveBeenCalledWith(...)` assertion (line 234), add:

```typescript
const storeCall = mockKnowledgeStore.store.mock.calls[0]?.[0];
expect(storeCall).toHaveProperty("draftStatus", "pending");
expect(storeCall).toHaveProperty("draftExpiresAt");
expect(storeCall.draftExpiresAt).toBeInstanceOf(Date);
// Verify expiry is roughly 72 hours from now (within 1 minute tolerance)
const expectedExpiry = Date.now() + 72 * 60 * 60 * 1000;
expect(Math.abs(storeCall.draftExpiresAt.getTime() - expectedExpiry)).toBeLessThan(60_000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/agents test -- --run compounding-service`
Expected: FAIL — `storeCall` does not have property `draftStatus`

- [ ] **Step 3: Update CompoundingDeps `knowledgeStore` type to accept draft fields**

In `packages/agents/src/memory/compounding-service.ts`, update the `knowledgeStore` type in `CompoundingDeps` (lines 49-62). Add `draftStatus` and `draftExpiresAt` to the `store()` parameter type:

```typescript
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
    draftStatus?: string | null;
    draftExpiresAt?: Date | null;
  }): Promise<void>;
};
```

- [ ] **Step 4: Add draft fields to the FAQ promotion `store()` call**

In `packages/agents/src/memory/compounding-service.ts`, add a constant at the top of the file alongside the existing constants (after line 69):

```typescript
const FAQ_DRAFT_EXPIRY_MS = 72 * 60 * 60 * 1000; // 72 hours
```

Then update the `trackQuestion()` method's `knowledgeStore.store()` call (lines 220-231). Add `draftStatus` and `draftExpiresAt`:

```typescript
if (result.sourceCount >= FAQ_PROMOTION_THRESHOLD && this.knowledgeStore) {
  const embedding = await this.embedding.embed(entry.content);
  const draftExpiresAt = new Date(Date.now() + FAQ_DRAFT_EXPIRY_MS);
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
    draftStatus: "pending",
    draftExpiresAt,
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/agents test -- --run compounding-service`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/memory/compounding-service.ts packages/agents/src/memory/__tests__/compounding-service.test.ts && git commit -m "$(cat <<'EOF'
feat: set draftStatus=pending and 72h expiry on auto-promoted FAQs
EOF
)"
```

---

### Task 4: Add FAQ Draft API Routes

**Files:**

- Modify: `apps/api/src/routes/deployment-memory.ts`

The `PrismaOwnerMemoryStore` already implements `listDraftFAQs()`, `approveDraftFAQ()`, and `rejectDraftFAQ()`. We just need to expose them as HTTP endpoints.

- [ ] **Step 1: Add the three FAQ draft endpoints**

In `apps/api/src/routes/deployment-memory.ts`, add three new routes after the existing delete endpoint (after line 70), and add the `PrismaOwnerMemoryStore` import:

Add to imports at top:

```typescript
import { PrismaDeploymentMemoryStore, PrismaOwnerMemoryStore } from "@switchboard/db";
```

Add after the existing delete route (before the closing `};`):

```typescript
// List pending FAQ drafts for a deployment
app.get<{
  Params: { orgId: string; deploymentId: string };
}>("/:orgId/deployments/:deploymentId/faq-drafts", async (request, reply) => {
  if (!app.prisma) {
    return reply.code(503).send({ error: "Database not available" });
  }
  const ownerStore = new PrismaOwnerMemoryStore(app.prisma);
  const { orgId, deploymentId } = request.params;
  const drafts = await ownerStore.listDraftFAQs(orgId, deploymentId);
  return { data: drafts };
});

// Approve a FAQ draft (with ownership verification)
app.post<{
  Params: { orgId: string; deploymentId: string; faqId: string };
}>("/:orgId/deployments/:deploymentId/faq-drafts/:faqId/approve", async (request, reply) => {
  if (!app.prisma) {
    return reply.code(503).send({ error: "Database not available" });
  }
  const ownerStore = new PrismaOwnerMemoryStore(app.prisma);
  const { orgId, deploymentId, faqId } = request.params;
  // Verify the FAQ belongs to this org+deployment
  const drafts = await ownerStore.listDraftFAQs(orgId, deploymentId);
  if (!drafts.some((d) => d.id === faqId)) {
    return reply.code(404).send({ error: "FAQ draft not found" });
  }
  await ownerStore.approveDraftFAQ(faqId);
  return { success: true };
});

// Reject (delete) a FAQ draft (with ownership verification)
app.post<{
  Params: { orgId: string; deploymentId: string; faqId: string };
}>("/:orgId/deployments/:deploymentId/faq-drafts/:faqId/reject", async (request, reply) => {
  if (!app.prisma) {
    return reply.code(503).send({ error: "Database not available" });
  }
  const ownerStore = new PrismaOwnerMemoryStore(app.prisma);
  const { orgId, deploymentId, faqId } = request.params;
  // Verify the FAQ belongs to this org+deployment
  const drafts = await ownerStore.listDraftFAQs(orgId, deploymentId);
  if (!drafts.some((d) => d.id === faqId)) {
    return reply.code(404).send({ error: "FAQ draft not found" });
  }
  await ownerStore.rejectDraftFAQ(faqId);
  return reply.status(204).send();
});
```

- [ ] **Step 2: Verify the import resolves**

Run: `npx pnpm@9.15.4 --filter @switchboard/api typecheck`
Expected: No errors (PrismaOwnerMemoryStore is already exported from `@switchboard/db`)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/deployment-memory.ts && git commit -m "$(cat <<'EOF'
feat: add FAQ draft list/approve/reject API routes
EOF
)"
```

---

### Task 5: Add SwitchboardClient Methods & Dashboard Proxy Routes

**Files:**

- Modify: `apps/dashboard/src/lib/api-client.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/faq-drafts/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/faq-drafts/[faqId]/approve/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/faq-drafts/[faqId]/reject/route.ts`

The dashboard uses a typed `SwitchboardClient` class (extends `SwitchboardClientBase`) where each API operation is a dedicated method calling `this.request<T>()`. Proxy routes call these typed methods. The `orgId` must be passed to the client methods since the backend routes use `:orgId` as a path parameter (same pattern as deployment-memory routes).

- [ ] **Step 1: Add three FAQ draft methods to `SwitchboardClient`**

In `apps/dashboard/src/lib/api-client.ts`, add a `DraftFAQ` type and three methods. Add the type near the top (after the other interface definitions, around line 87):

```typescript
export interface DraftFAQ {
  id: string;
  content: string;
  sourceType: string;
  draftStatus: string | null;
  draftExpiresAt: string | null;
  createdAt: string;
}
```

Then add three methods inside the `SwitchboardClient` class, in the Marketplace section (after `deploySalesPipeline`, around line 502):

```typescript
// ── FAQ Drafts ──

async listDraftFAQs(orgId: string, deploymentId: string) {
  return this.request<{ data: DraftFAQ[] }>(
    `/api/marketplace/${orgId}/deployments/${deploymentId}/faq-drafts`,
  );
}

async approveDraftFAQ(orgId: string, deploymentId: string, faqId: string) {
  return this.request<{ success: boolean }>(
    `/api/marketplace/${orgId}/deployments/${deploymentId}/faq-drafts/${faqId}/approve`,
    { method: "POST" },
  );
}

async rejectDraftFAQ(orgId: string, deploymentId: string, faqId: string) {
  return this.request<void>(
    `/api/marketplace/${orgId}/deployments/${deploymentId}/faq-drafts/${faqId}/reject`,
    { method: "POST" },
  );
}
```

- [ ] **Step 2: Create the list drafts proxy route**

Create `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/faq-drafts/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orgId = request.nextUrl.searchParams.get("orgId") ?? "";
    const client = await getApiClient();
    const data = await client.listDraftFAQs(orgId, id);
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

**Note:** The `orgId` is passed as a query parameter from the dashboard hooks. The dashboard knows the orgId from the deployment data (deployment.organizationId). This matches how other deployment-scoped operations work — read the existing proxy routes to confirm the exact pattern for passing orgId before implementing.

- [ ] **Step 3: Create the approve proxy route**

Create `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/faq-drafts/[faqId]/approve/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; faqId: string }> },
) {
  try {
    const { id, faqId } = await params;
    const orgId = request.nextUrl.searchParams.get("orgId") ?? "";
    const client = await getApiClient();
    const data = await client.approveDraftFAQ(orgId, id, faqId);
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

- [ ] **Step 4: Create the reject proxy route**

Create `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/faq-drafts/[faqId]/reject/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; faqId: string }> },
) {
  try {
    const { id, faqId } = await params;
    const orgId = request.nextUrl.searchParams.get("orgId") ?? "";
    const client = await getApiClient();
    const data = await client.rejectDraftFAQ(orgId, id, faqId);
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

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/marketplace/deployments/\[id\]/faq-drafts/ && git commit -m "$(cat <<'EOF'
feat: add dashboard proxy routes for FAQ draft management
EOF
)"
```

---

### Task 6: Add Dashboard Hooks & Query Keys

**Files:**

- Modify: `apps/dashboard/src/lib/query-keys.ts`
- Modify: `apps/dashboard/src/hooks/use-marketplace.ts`

- [ ] **Step 1: Add FAQ draft query keys**

In `apps/dashboard/src/lib/query-keys.ts`, add `faqDrafts` inside the `marketplace` object (after line 88, before the closing `},`):

```typescript
faqDrafts: (deploymentId: string) => ["marketplace", "faq-drafts", deploymentId] as const,
```

- [ ] **Step 2: Add FAQ draft hooks**

In `apps/dashboard/src/hooks/use-marketplace.ts`, add three hooks at the end of the file. Note: `useMutation`, `useQuery`, and `useQueryClient` are already imported on line 3 — no import changes needed.

Add at the bottom of the file:

```typescript
// ── FAQ Drafts ──

interface DraftFAQ {
  id: string;
  content: string;
  sourceType: string;
  draftStatus: string | null;
  draftExpiresAt: string | null;
  createdAt: string;
}

export function useDraftFAQs(deploymentId: string) {
  return useQuery({
    queryKey: queryKeys.marketplace.faqDrafts(deploymentId),
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/marketplace/deployments/${deploymentId}/faq-drafts`);
      if (!res.ok) throw new Error("Failed to fetch FAQ drafts");
      const data = await res.json();
      return data.data as DraftFAQ[];
    },
    enabled: !!deploymentId,
  });
}

export function useApproveFAQ(deploymentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (faqId: string) => {
      const res = await fetch(
        `/api/dashboard/marketplace/deployments/${deploymentId}/faq-drafts/${faqId}/approve`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to approve FAQ");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.marketplace.faqDrafts(deploymentId),
      });
    },
  });
}

export function useRejectFAQ(deploymentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (faqId: string) => {
      const res = await fetch(
        `/api/dashboard/marketplace/deployments/${deploymentId}/faq-drafts/${faqId}/reject`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to reject FAQ");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.marketplace.faqDrafts(deploymentId),
      });
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/lib/query-keys.ts apps/dashboard/src/hooks/use-marketplace.ts && git commit -m "$(cat <<'EOF'
feat: add dashboard hooks and query keys for FAQ drafts
EOF
)"
```

---

### Task 7: Add FAQ Review Queue Component

**Files:**

- Create: `apps/dashboard/src/components/marketplace/faq-review-queue.tsx`

- [ ] **Step 1: Create the FAQ review queue component**

Create `apps/dashboard/src/components/marketplace/faq-review-queue.tsx`:

```tsx
"use client";

import { Check, X, FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDraftFAQs, useApproveFAQ, useRejectFAQ } from "@/hooks/use-marketplace";

interface FAQReviewQueueProps {
  deploymentId: string;
}

function formatTimeLeft(expiresAt: string | null): string {
  if (!expiresAt) return "";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours >= 24) return `${Math.floor(hours / 24)}d left`;
  return `${hours}h left`;
}

export function FAQReviewQueue({ deploymentId }: FAQReviewQueueProps) {
  const { data: drafts, isLoading } = useDraftFAQs(deploymentId);
  const approveMutation = useApproveFAQ(deploymentId);
  const rejectMutation = useRejectFAQ(deploymentId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileQuestion className="h-4 w-4" />
            FAQ Drafts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!drafts || drafts.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileQuestion className="h-4 w-4" />
          FAQ Drafts
          <Badge variant="secondary">{drafts.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {drafts.map((draft) => (
          <div
            key={draft.id}
            className="flex items-start justify-between gap-3 rounded-md border p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm">{draft.content}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {formatTimeLeft(draft.draftExpiresAt)}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => approveMutation.mutate(draft.id)}
                disabled={approveMutation.isPending}
              >
                <Check className="h-4 w-4 text-green-600" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => rejectMutation.mutate(draft.id)}
                disabled={rejectMutation.isPending}
              >
                <X className="h-4 w-4 text-red-600" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/components/marketplace/faq-review-queue.tsx && git commit -m "$(cat <<'EOF'
feat: add FAQ review queue component for deployment detail page
EOF
)"
```

---

### Task 8: Mount FAQ Review Queue in Deployment Detail

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx`

- [ ] **Step 1: Read the full deployment detail client to find the right insertion point**

Read `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx` fully to understand the layout and find where to mount the FAQ review queue.

- [ ] **Step 2: Add import and mount the component**

Add import at the top of the file:

```typescript
import { FAQReviewQueue } from "@/components/marketplace/faq-review-queue";
```

Mount `<FAQReviewQueue deploymentId={deploymentId} />` in the deployment detail layout, after the work log or channels section (pick the most logical spot based on the current layout). The component self-hides when there are no drafts, so it's safe to always render.

- [ ] **Step 3: Verify it renders**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard build`
Expected: Build succeeds with no TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/deployments/\[id\]/deployment-detail-client.tsx && git commit -m "$(cat <<'EOF'
feat: mount FAQ review queue in deployment detail page
EOF
)"
```

---

### Task 9: Full Verification

- [ ] **Step 1: Run all tests**

```bash
npx pnpm@9.15.4 test
```

Expected: All tests pass

- [ ] **Step 2: Run typecheck**

```bash
npx pnpm@9.15.4 typecheck
```

Expected: No errors

- [ ] **Step 3: Run lint**

```bash
npx pnpm@9.15.4 lint
```

Expected: No errors

- [ ] **Step 4: Verify the data flow end-to-end**

Trace the flow mentally:

1. Customer asks the same question 3+ times → `CompoundingService.trackQuestion()` promotes to KnowledgeChunk with `draftStatus: "pending"`, `draftExpiresAt: now+72h`
2. `PrismaKnowledgeStore.search()` excludes chunks where `draftStatus = "pending"` → customer never sees unreviewed FAQs
3. `PrismaCustomerMemoryStore.getBusinessKnowledge()` already filters `draftStatus: "approved" OR null` → double-safe
4. Owner calls `GET /api/marketplace/:orgId/deployments/:depId/faq-drafts` → sees pending drafts
5. Owner calls `POST .../faq-drafts/:faqId/approve` → `draftStatus` set to `"approved"` → FAQ now visible to customers
6. Owner calls `POST .../faq-drafts/:faqId/reject` → chunk deleted → FAQ never surfaces
7. Dashboard shows the review queue when drafts exist, hides when empty
