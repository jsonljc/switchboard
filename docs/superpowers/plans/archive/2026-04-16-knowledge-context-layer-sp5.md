# SP5: Knowledge/Context Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give skills scoped, curated knowledge (playbooks, policies, domain guidance) via declarative context contracts in frontmatter, so each agent gets the right context and only the right context.

**Architecture:** New `KnowledgeEntry` Prisma model stores org-scoped, versioned knowledge entries. Skills declare a `context:` block in frontmatter specifying which entries they need. A `ContextResolver` fetches matching entries and injects them as named template variables. Execution traces record what knowledge was loaded.

**Tech Stack:** Prisma (migration + store), Zod (schemas), Fastify (CRUD routes), Vitest (tests)

**Spec:** `docs/superpowers/specs/2026-04-16-knowledge-context-layer-design.md`

---

## File Map

| Action | File                                                                       | Responsibility                                                                                                                                     |
| ------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create | `packages/schemas/src/knowledge.ts`                                        | Zod schemas: `KnowledgeKindSchema`, `KnowledgeEntryCreateSchema`, `KnowledgeEntryUpdateSchema`, `KnowledgeEntrySchema`, `ContextRequirementSchema` |
| Modify | `packages/schemas/src/index.ts`                                            | Export new knowledge schemas                                                                                                                       |
| Create | `packages/db/prisma/migrations/YYYYMMDD_add_knowledge_entry/migration.sql` | Prisma migration: `KnowledgeKind` enum + `KnowledgeEntry` table                                                                                    |
| Modify | `packages/db/prisma/schema.prisma`                                         | Add `KnowledgeKind` enum + `KnowledgeEntry` model                                                                                                  |
| Create | `packages/db/src/stores/prisma-knowledge-entry-store.ts`                   | CRUD store: `findActive`, `create`, `update`, `deactivate`, `list`                                                                                 |
| Modify | `packages/db/src/index.ts`                                                 | Export `PrismaKnowledgeEntryStore`                                                                                                                 |
| Create | `packages/core/src/skill-runtime/context-resolver.ts`                      | Resolve context requirements → scoped knowledge variables                                                                                          |
| Modify | `packages/core/src/skill-runtime/types.ts`                                 | Add `context: ContextRequirement[]` to `SkillDefinition`, add `ContextResolutionError`                                                             |
| Modify | `packages/core/src/skill-runtime/skill-loader.ts`                          | Parse `context` block, validate, reject duplicate `injectAs`                                                                                       |
| Modify | `packages/core/src/skill-runtime/skill-handler.ts`                         | Inject `ContextResolver`, resolve between param build and execution                                                                                |
| Modify | `packages/core/src/skill-runtime/batch-skill-handler.ts`                   | Same context resolution for batch path                                                                                                             |
| Create | `apps/api/src/routes/knowledge-entries.ts`                                 | CRUD API routes for knowledge entries                                                                                                              |
| Modify | `apps/api/src/bootstrap/routes.ts`                                         | Register `knowledgeEntryRoutes`                                                                                                                    |
| Create | `packages/db/prisma/seed-knowledge.ts`                                     | Seed 5 default knowledge entries for demo org                                                                                                      |
| Modify | `packages/db/prisma/seed.ts`                                               | Call `seedKnowledge()`                                                                                                                             |
| Modify | `skills/sales-pipeline.md`                                                 | Add `context:` block + `{{PLAYBOOK_CONTEXT}}` / `{{POLICY_CONTEXT}}` template vars                                                                 |
| Create | `packages/schemas/src/__tests__/knowledge.test.ts`                         | Schema validation tests                                                                                                                            |
| Create | `packages/db/src/stores/__tests__/prisma-knowledge-entry-store.test.ts`    | Store CRUD tests                                                                                                                                   |
| Create | `packages/core/src/skill-runtime/__tests__/context-resolver.test.ts`       | Resolver unit tests                                                                                                                                |
| Create | `apps/api/src/routes/__tests__/knowledge-entries.test.ts`                  | Route integration tests                                                                                                                            |

---

### Task 1: Zod Schemas (`packages/schemas`)

**Files:**

- Create: `packages/schemas/src/knowledge.ts`
- Create: `packages/schemas/src/__tests__/knowledge.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/schemas/src/__tests__/knowledge.test.ts
import { describe, it, expect } from "vitest";
import {
  KnowledgeKindSchema,
  KnowledgeEntryCreateSchema,
  KnowledgeEntryUpdateSchema,
  KnowledgeEntrySchema,
  ContextRequirementSchema,
} from "../knowledge.js";

describe("KnowledgeKindSchema", () => {
  it("accepts valid kinds", () => {
    expect(KnowledgeKindSchema.parse("playbook")).toBe("playbook");
    expect(KnowledgeKindSchema.parse("policy")).toBe("policy");
    expect(KnowledgeKindSchema.parse("knowledge")).toBe("knowledge");
  });

  it("rejects invalid kinds", () => {
    expect(() => KnowledgeKindSchema.parse("playbok")).toThrow();
    expect(() => KnowledgeKindSchema.parse("")).toThrow();
  });
});

describe("KnowledgeEntryCreateSchema", () => {
  const valid = {
    organizationId: "org_dev",
    kind: "playbook" as const,
    scope: "objection-handling",
    title: "Objection Handling Playbook",
    content: "When a lead says price is too high...",
  };

  it("accepts valid create input", () => {
    const result = KnowledgeEntryCreateSchema.parse(valid);
    expect(result.priority).toBe(0); // default
  });

  it("enforces kebab-case scope", () => {
    expect(() =>
      KnowledgeEntryCreateSchema.parse({ ...valid, scope: "ObjectionHandling" }),
    ).toThrow(/kebab-case/);
    expect(() =>
      KnowledgeEntryCreateSchema.parse({ ...valid, scope: "objection_handling" }),
    ).toThrow(/kebab-case/);
  });

  it("rejects blank content", () => {
    expect(() => KnowledgeEntryCreateSchema.parse({ ...valid, content: "   " })).toThrow();
  });

  it("rejects blank title", () => {
    expect(() => KnowledgeEntryCreateSchema.parse({ ...valid, title: "  " })).toThrow();
  });

  it("rejects empty organizationId", () => {
    expect(() => KnowledgeEntryCreateSchema.parse({ ...valid, organizationId: "" })).toThrow();
  });
});

describe("KnowledgeEntryUpdateSchema", () => {
  it("accepts partial updates", () => {
    expect(KnowledgeEntryUpdateSchema.parse({ title: "New Title" })).toEqual({
      title: "New Title",
    });
  });

  it("rejects blank content on update", () => {
    expect(() => KnowledgeEntryUpdateSchema.parse({ content: "  " })).toThrow();
  });
});

describe("ContextRequirementSchema", () => {
  it("accepts valid requirement", () => {
    const result = ContextRequirementSchema.parse({
      kind: "playbook",
      scope: "objection-handling",
      injectAs: "PLAYBOOK_CONTEXT",
    });
    expect(result.required).toBe(true); // default
  });

  it("accepts optional requirement", () => {
    const result = ContextRequirementSchema.parse({
      kind: "knowledge",
      scope: "offer-catalog",
      injectAs: "KNOWLEDGE_CONTEXT",
      required: false,
    });
    expect(result.required).toBe(false);
  });

  it("enforces SCREAMING_SNAKE_CASE for injectAs", () => {
    expect(() =>
      ContextRequirementSchema.parse({
        kind: "playbook",
        scope: "test",
        injectAs: "playbookContext",
      }),
    ).toThrow();
  });

  it("enforces kebab-case for scope", () => {
    expect(() =>
      ContextRequirementSchema.parse({
        kind: "playbook",
        scope: "Objection_Handling",
        injectAs: "TEST",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run knowledge.test`
Expected: FAIL — module `../knowledge.js` not found

- [ ] **Step 3: Create the schema file**

```typescript
// packages/schemas/src/knowledge.ts
import { z } from "zod";

// ---------------------------------------------------------------------------
// Knowledge Entry — org-scoped, versioned curated knowledge
// ---------------------------------------------------------------------------

export const KnowledgeKindSchema = z.enum(["playbook", "policy", "knowledge"]);
export type KnowledgeKind = z.infer<typeof KnowledgeKindSchema>;

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SCREAMING_SNAKE = /^[A-Z][A-Z0-9_]*$/;

export const KnowledgeEntryCreateSchema = z.object({
  organizationId: z.string().min(1),
  kind: KnowledgeKindSchema,
  scope: z.string().regex(KEBAB_CASE, "Scope must be lowercase kebab-case"),
  title: z.string().trim().min(1),
  content: z.string().trim().min(1, "Content must not be blank"),
  priority: z.number().int().min(0).default(0),
});
export type KnowledgeEntryCreate = z.infer<typeof KnowledgeEntryCreateSchema>;

export const KnowledgeEntryUpdateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1, "Content must not be blank").optional(),
  priority: z.number().int().min(0).optional(),
});
export type KnowledgeEntryUpdate = z.infer<typeof KnowledgeEntryUpdateSchema>;

export const KnowledgeEntrySchema = KnowledgeEntryCreateSchema.extend({
  id: z.string().min(1),
  version: z.number().int().positive(),
  active: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>;

// ---------------------------------------------------------------------------
// Context Contract — skill-level knowledge requirements
// ---------------------------------------------------------------------------

export const ContextRequirementSchema = z.object({
  kind: KnowledgeKindSchema,
  scope: z.string().regex(KEBAB_CASE, "Scope must be lowercase kebab-case"),
  injectAs: z.string().regex(SCREAMING_SNAKE, "injectAs must be SCREAMING_SNAKE_CASE"),
  required: z.boolean().default(true),
});
export type ContextRequirement = z.infer<typeof ContextRequirementSchema>;
```

- [ ] **Step 4: Add export to barrel file**

Add to `packages/schemas/src/index.ts`:

```typescript
// Knowledge entries (curated playbooks, policies, domain guidance)
export * from "./knowledge.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run knowledge.test`
Expected: All tests PASS

- [ ] **Step 6: Run full schema package checks**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas typecheck && npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/schemas/src/knowledge.ts packages/schemas/src/__tests__/knowledge.test.ts packages/schemas/src/index.ts && git commit -m "feat(schemas): add KnowledgeEntry and ContextRequirement Zod schemas"
```

---

### Task 2: Prisma Migration + Model

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add KnowledgeKind enum and KnowledgeEntry model to schema.prisma**

Append to the end of `packages/db/prisma/schema.prisma`:

```prisma
// ---------------------------------------------------------------------------
// Knowledge Entry — org-scoped, versioned curated knowledge
// ---------------------------------------------------------------------------

enum KnowledgeKind {
  playbook
  policy
  knowledge
}

model KnowledgeEntry {
  id             String        @id @default(cuid())
  organizationId String
  kind           KnowledgeKind
  scope          String
  title          String
  content        String        @db.Text
  version        Int           @default(1)
  active         Boolean       @default(true)
  priority       Int           @default(0)
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  @@unique([organizationId, kind, scope, version])
  @@index([organizationId, kind, scope, active])
}
```

- [ ] **Step 2: Generate Prisma client**

Run: `npx pnpm@9.15.4 --filter @switchboard/db db:generate`
Expected: Prisma client generated successfully

- [ ] **Step 3: Create migration**

Run: `cd packages/db && npx prisma migrate dev --name add_knowledge_entry`
Expected: Migration created and applied

- [ ] **Step 4: Verify migration**

Run: `npx pnpm@9.15.4 --filter @switchboard/db typecheck`
Expected: PASS — Prisma types include `KnowledgeEntry` and `KnowledgeKind`

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ && git commit -m "feat(db): add KnowledgeEntry model and migration"
```

---

### Task 3: Knowledge Entry Store (`packages/db`)

**Files:**

- Create: `packages/db/src/stores/prisma-knowledge-entry-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-knowledge-entry-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/db/src/stores/__tests__/prisma-knowledge-entry-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaKnowledgeEntryStore } from "../prisma-knowledge-entry-store.js";

// Follows the established mock pattern (see prisma-listing-store.test.ts)
function createMockPrisma() {
  return {
    knowledgeEntry: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      $transaction: vi.fn(),
    },
    $transaction: vi.fn(),
  };
}

describe("PrismaKnowledgeEntryStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaKnowledgeEntryStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaKnowledgeEntryStore(prisma as never);
  });

  describe("create", () => {
    it("creates an entry with version 1 and active true", async () => {
      const input = {
        organizationId: "org_test",
        kind: "playbook" as const,
        scope: "objection-handling",
        title: "Objection Playbook",
        content: "When price is too high...",
        priority: 0,
      };
      prisma.knowledgeEntry.create.mockResolvedValue({
        id: "ke_1",
        ...input,
        version: 1,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await store.create(input);

      expect(prisma.knowledgeEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: "org_test",
          kind: "playbook",
          scope: "objection-handling",
          version: 1,
          active: true,
        }),
      });
      expect(result.id).toBe("ke_1");
      expect(result.version).toBe(1);
    });
  });

  describe("findActive", () => {
    it("returns only active entries matching filters", async () => {
      prisma.knowledgeEntry.findMany.mockResolvedValue([
        { id: "ke_1", kind: "playbook", scope: "objection-handling", active: true },
      ]);

      const results = await store.findActive("org_test", [
        { kind: "playbook", scope: "objection-handling" },
      ]);

      expect(prisma.knowledgeEntry.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org_test",
          active: true,
          OR: [{ kind: "playbook", scope: "objection-handling" }],
        },
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      });
      expect(results).toHaveLength(1);
    });

    it("returns empty array for empty filters", async () => {
      const results = await store.findActive("org_test", []);
      expect(results).toEqual([]);
      expect(prisma.knowledgeEntry.findMany).not.toHaveBeenCalled();
    });
  });

  describe("update (append-only versioning)", () => {
    it("creates new version and deactivates predecessor", async () => {
      const existing = {
        id: "ke_1",
        organizationId: "org_test",
        kind: "playbook",
        scope: "update-test",
        title: "V1 Title",
        content: "V1 Content",
        priority: 0,
        version: 1,
        active: true,
      };
      prisma.knowledgeEntry.findFirst.mockResolvedValue(existing);
      const newEntry = { ...existing, id: "ke_2", version: 2, title: "V2 Title" };
      prisma.$transaction.mockResolvedValue([{ ...existing, active: false }, newEntry]);

      const result = await store.update("ke_1", "org_test", { title: "V2 Title" });

      expect(result.version).toBe(2);
      expect(result.title).toBe("V2 Title");
      expect(result.content).toBe("V1 Content"); // unchanged fields copied
    });

    it("throws when entry not found", async () => {
      prisma.knowledgeEntry.findFirst.mockResolvedValue(null);
      await expect(store.update("ke_none", "org_test", { title: "X" })).rejects.toThrow(
        /not found/,
      );
    });
  });

  describe("deactivate", () => {
    it("soft-deletes by setting active to false", async () => {
      prisma.knowledgeEntry.updateMany.mockResolvedValue({ count: 1 });
      await store.deactivate("ke_1", "org_test");
      expect(prisma.knowledgeEntry.updateMany).toHaveBeenCalledWith({
        where: { id: "ke_1", organizationId: "org_test" },
        data: { active: false },
      });
    });

    it("throws when entry not found (cross-org protection)", async () => {
      prisma.knowledgeEntry.updateMany.mockResolvedValue({ count: 0 });
      await expect(store.deactivate("ke_1", "other_org")).rejects.toThrow(/not found/);
    });
  });

  describe("list", () => {
    it("lists entries with optional kind filter", async () => {
      prisma.knowledgeEntry.findMany.mockResolvedValue([]);
      await store.list("org_test", { kind: "playbook" });
      expect(prisma.knowledgeEntry.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org_test", kind: "playbook" },
        orderBy: { createdAt: "desc" },
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-knowledge-entry-store.test`
Expected: FAIL — module not found

- [ ] **Step 3: Create the store**

```typescript
// packages/db/src/stores/prisma-knowledge-entry-store.ts
import type { PrismaDbClient } from "../prisma-db.js";
import type { KnowledgeKind } from "@switchboard/schemas";

interface KnowledgeEntryCreateInput {
  organizationId: string;
  kind: KnowledgeKind;
  scope: string;
  title: string;
  content: string;
  priority: number;
}

interface KnowledgeEntryUpdateInput {
  title?: string;
  content?: string;
  priority?: number;
}

interface KnowledgeEntryFilter {
  kind?: KnowledgeKind;
  scope?: string;
}

export class PrismaKnowledgeEntryStore {
  constructor(private prisma: PrismaDbClient) {}

  async findActive(orgId: string, filters: Array<{ kind: KnowledgeKind; scope: string }>) {
    if (filters.length === 0) return [];

    const orConditions = filters.map((f) => ({
      kind: f.kind,
      scope: f.scope,
    }));

    return this.prisma.knowledgeEntry.findMany({
      where: {
        organizationId: orgId,
        active: true,
        OR: orConditions,
      },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    });
  }

  async create(input: KnowledgeEntryCreateInput) {
    return this.prisma.knowledgeEntry.create({
      data: {
        organizationId: input.organizationId,
        kind: input.kind,
        scope: input.scope,
        title: input.title,
        content: input.content,
        priority: input.priority,
        version: 1,
        active: true,
      },
    });
  }

  async update(id: string, orgId: string, data: KnowledgeEntryUpdateInput) {
    const existing = await this.prisma.knowledgeEntry.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!existing) {
      throw new Error(`KnowledgeEntry ${id} not found for org ${orgId}`);
    }

    // Append-only: create new version, deactivate predecessor
    const [, newEntry] = await this.prisma.$transaction([
      this.prisma.knowledgeEntry.update({
        where: { id },
        data: { active: false },
      }),
      this.prisma.knowledgeEntry.create({
        data: {
          organizationId: existing.organizationId,
          kind: existing.kind,
          scope: existing.scope,
          title: data.title ?? existing.title,
          content: data.content ?? existing.content,
          priority: data.priority ?? existing.priority,
          version: existing.version + 1,
          active: true,
        },
      }),
    ]);

    return newEntry;
  }

  async deactivate(id: string, orgId: string) {
    const result = await this.prisma.knowledgeEntry.updateMany({
      where: { id, organizationId: orgId },
      data: { active: false },
    });

    if (result.count === 0) {
      throw new Error(`KnowledgeEntry ${id} not found for org ${orgId}`);
    }
  }

  async list(orgId: string, filters?: KnowledgeEntryFilter) {
    return this.prisma.knowledgeEntry.findMany({
      where: {
        organizationId: orgId,
        ...(filters?.kind ? { kind: filters.kind } : {}),
        ...(filters?.scope ? { scope: filters.scope } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
```

- [ ] **Step 4: Export from barrel file**

Add to `packages/db/src/index.ts`:

```typescript
export { PrismaKnowledgeEntryStore } from "./stores/prisma-knowledge-entry-store.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-knowledge-entry-store.test`
Expected: All tests PASS

- [ ] **Step 6: Run full db package checks**

Run: `npx pnpm@9.15.4 --filter @switchboard/db typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/stores/prisma-knowledge-entry-store.ts packages/db/src/stores/__tests__/prisma-knowledge-entry-store.test.ts packages/db/src/index.ts && git commit -m "feat(db): add PrismaKnowledgeEntryStore with append-only versioning"
```

---

### Task 4: ContextResolver (`packages/core`)

**Files:**

- Create: `packages/core/src/skill-runtime/context-resolver.ts`
- Create: `packages/core/src/skill-runtime/__tests__/context-resolver.test.ts`
- Modify: `packages/core/src/skill-runtime/types.ts`

- [ ] **Step 1: Add types to `types.ts`**

Modify `packages/core/src/skill-runtime/types.ts`:

Add `context` field to the `SkillDefinition` interface, after the `output` field (line 22):

```typescript
  context: ContextRequirement[];
```

Add the import at the top:

```typescript
import type { ContextRequirement } from "@switchboard/schemas";
```

At the end of the file, add:

```typescript
export class ContextResolutionError extends Error {
  constructor(
    public readonly kind: string,
    public readonly scope: string,
  ) {
    super(`Required knowledge not found: kind=${kind}, scope=${scope}`);
    this.name = "ContextResolutionError";
  }
}
```

- [ ] **Step 2: Write the test file**

```typescript
// packages/core/src/skill-runtime/__tests__/context-resolver.test.ts
import { describe, it, expect, vi } from "vitest";
import { ContextResolverImpl } from "../context-resolver.js";
import type { ContextRequirement, KnowledgeKind } from "@switchboard/schemas";
import { ContextResolutionError } from "../types.js";

function mockStore(
  entries: Array<{
    kind: KnowledgeKind;
    scope: string;
    content: string;
    priority: number;
    updatedAt: Date;
  }>,
) {
  return {
    findActive: vi.fn().mockResolvedValue(
      entries.map((e, i) => ({
        id: `entry_${i}`,
        organizationId: "org_test",
        kind: e.kind,
        scope: e.scope,
        title: `Title ${i}`,
        content: e.content,
        version: 1,
        active: true,
        priority: e.priority,
        updatedAt: e.updatedAt,
        createdAt: new Date(),
      })),
    ),
  };
}

describe("ContextResolverImpl", () => {
  it("resolves single requirement to named variable", async () => {
    const store = mockStore([
      {
        kind: "playbook",
        scope: "objection-handling",
        content: "Handle price objections by...",
        priority: 0,
        updatedAt: new Date(),
      },
    ]);
    const resolver = new ContextResolverImpl(store);

    const result = await resolver.resolve("org_test", [
      {
        kind: "playbook",
        scope: "objection-handling",
        injectAs: "PLAYBOOK_CONTEXT",
        required: true,
      },
    ]);

    expect(result.variables.PLAYBOOK_CONTEXT).toBe("Handle price objections by...");
    expect(result.metadata).toHaveLength(1);
    expect(result.metadata[0]!.entriesFound).toBe(1);
  });

  it("concatenates multiple entries for same scope by priority DESC", async () => {
    const store = mockStore([
      {
        kind: "playbook",
        scope: "objection-handling",
        content: "High priority content",
        priority: 10,
        updatedAt: new Date(),
      },
      {
        kind: "playbook",
        scope: "objection-handling",
        content: "Low priority content",
        priority: 0,
        updatedAt: new Date(),
      },
    ]);
    const resolver = new ContextResolverImpl(store);

    const result = await resolver.resolve("org_test", [
      {
        kind: "playbook",
        scope: "objection-handling",
        injectAs: "PLAYBOOK_CONTEXT",
        required: true,
      },
    ]);

    expect(result.variables.PLAYBOOK_CONTEXT).toBe(
      "High priority content\n---\nLow priority content",
    );
    expect(result.metadata[0]!.entriesFound).toBe(2);
  });

  it("throws ContextResolutionError for missing required knowledge", async () => {
    const store = mockStore([]);
    const resolver = new ContextResolverImpl(store);

    await expect(
      resolver.resolve("org_test", [
        { kind: "playbook", scope: "nonexistent", injectAs: "PLAYBOOK_CONTEXT", required: true },
      ]),
    ).rejects.toThrow(ContextResolutionError);
  });

  it("omits missing optional knowledge from variables", async () => {
    const store = mockStore([]);
    const resolver = new ContextResolverImpl(store);

    const result = await resolver.resolve("org_test", [
      { kind: "knowledge", scope: "offer-catalog", injectAs: "KNOWLEDGE_CONTEXT", required: false },
    ]);

    expect(result.variables).not.toHaveProperty("KNOWLEDGE_CONTEXT");
    expect(result.metadata[0]!.entriesFound).toBe(0);
  });

  it("resolves multiple requirements into separate variables", async () => {
    const store = {
      findActive: vi.fn().mockResolvedValue([
        {
          id: "1",
          organizationId: "org_test",
          kind: "playbook",
          scope: "objection-handling",
          title: "T1",
          content: "Playbook content",
          version: 1,
          active: true,
          priority: 0,
          updatedAt: new Date(),
          createdAt: new Date(),
        },
        {
          id: "2",
          organizationId: "org_test",
          kind: "policy",
          scope: "messaging-rules",
          title: "T2",
          content: "Policy content",
          version: 1,
          active: true,
          priority: 0,
          updatedAt: new Date(),
          createdAt: new Date(),
        },
      ]),
    };
    const resolver = new ContextResolverImpl(store);

    const result = await resolver.resolve("org_test", [
      {
        kind: "playbook",
        scope: "objection-handling",
        injectAs: "PLAYBOOK_CONTEXT",
        required: true,
      },
      { kind: "policy", scope: "messaging-rules", injectAs: "POLICY_CONTEXT", required: true },
    ]);

    expect(result.variables.PLAYBOOK_CONTEXT).toBe("Playbook content");
    expect(result.variables.POLICY_CONTEXT).toBe("Policy content");
    expect(result.metadata).toHaveLength(2);
  });

  it("returns empty variables and metadata for empty requirements", async () => {
    const store = mockStore([]);
    const resolver = new ContextResolverImpl(store);

    const result = await resolver.resolve("org_test", []);

    expect(result.variables).toEqual({});
    expect(result.metadata).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run context-resolver.test`
Expected: FAIL — module not found

- [ ] **Step 4: Create the resolver**

```typescript
// packages/core/src/skill-runtime/context-resolver.ts
import type { ContextRequirement, KnowledgeKind } from "@switchboard/schemas";
import { ContextResolutionError } from "./types.js";

export interface ContextResolutionMeta {
  injectAs: string;
  kind: KnowledgeKind;
  scope: string;
  entriesFound: number;
  totalChars: number;
}

export interface ResolvedContext {
  variables: Record<string, string>;
  metadata: ContextResolutionMeta[];
}

interface KnowledgeEntryRow {
  kind: KnowledgeKind;
  scope: string;
  content: string;
  priority: number;
  updatedAt: Date;
}

export interface KnowledgeEntryStoreForResolver {
  findActive(
    orgId: string,
    filters: Array<{ kind: KnowledgeKind; scope: string }>,
  ): Promise<KnowledgeEntryRow[]>;
}

export class ContextResolverImpl {
  constructor(private store: KnowledgeEntryStoreForResolver) {}

  async resolve(orgId: string, requirements: ContextRequirement[]): Promise<ResolvedContext> {
    if (requirements.length === 0) {
      return { variables: {}, metadata: [] };
    }

    const filters = requirements.map((r) => ({ kind: r.kind, scope: r.scope }));
    const entries = await this.store.findActive(orgId, filters);

    // Group entries by (kind, scope) key
    const grouped = new Map<string, KnowledgeEntryRow[]>();
    for (const entry of entries) {
      const key = `${entry.kind}::${entry.scope}`;
      const group = grouped.get(key) ?? [];
      group.push(entry);
      grouped.set(key, group);
    }

    const variables: Record<string, string> = {};
    const metadata: ContextResolutionMeta[] = [];

    for (const req of requirements) {
      const key = `${req.kind}::${req.scope}`;
      const group = grouped.get(key) ?? [];

      // Entries already sorted by store (priority DESC, updatedAt DESC)
      const concatenated = group.map((e) => e.content).join("\n---\n");

      if (group.length === 0 && req.required) {
        throw new ContextResolutionError(req.kind, req.scope);
      }

      if (group.length > 0) {
        variables[req.injectAs] = concatenated;
      }

      metadata.push({
        injectAs: req.injectAs,
        kind: req.kind,
        scope: req.scope,
        entriesFound: group.length,
        totalChars: concatenated.length,
      });
    }

    return { variables, metadata };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run context-resolver.test`
Expected: All tests PASS

- [ ] **Step 6: Run full core package checks**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skill-runtime/context-resolver.ts packages/core/src/skill-runtime/__tests__/context-resolver.test.ts packages/core/src/skill-runtime/types.ts && git commit -m "feat(core): add ContextResolver for skill-scoped knowledge injection"
```

---

### Task 5: Skill Loader — Parse Context Block

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-loader.ts`
- Modify: `packages/core/src/skill-runtime/__tests__/skill-loader.test.ts` (extend existing tests)

- [ ] **Step 1: Add context parsing tests**

Add these test cases to the existing `skill-loader.test.ts`:

```typescript
import { ContextRequirementSchema } from "@switchboard/schemas";

describe("context block parsing", () => {
  it("parses valid context block from frontmatter", () => {
    // Create a test skill file with context block, or use inline parsing
    // The skill should have context: [...] in frontmatter
    const skill = loadSkill("test-with-context", testSkillsDir);
    expect(skill.context).toHaveLength(2);
    expect(skill.context[0]!.injectAs).toBe("PLAYBOOK_CONTEXT");
    expect(skill.context[0]!.required).toBe(true);
    expect(skill.context[1]!.required).toBe(false);
  });

  it("defaults to empty context array when no context block", () => {
    const skill = loadSkill("sales-pipeline", skillsDir);
    expect(skill.context).toEqual([]);
  });

  it("rejects duplicate injectAs values", () => {
    expect(() => loadSkill("test-duplicate-inject-as", testSkillsDir)).toThrow(
      /Duplicate injectAs/,
    );
  });

  it("normalizes inject_as to injectAs", () => {
    const skill = loadSkill("test-with-context", testSkillsDir);
    // YAML uses inject_as, TypeScript gets injectAs
    expect(skill.context[0]).toHaveProperty("injectAs");
    expect(skill.context[0]).not.toHaveProperty("inject_as");
  });
});
```

Create test fixture skill files in the test fixtures directory:

**`test-with-context.md`:**

```markdown
---
name: test-with-context
slug: test-with-context
version: 1.0.0
description: Test skill with context block
author: test
parameters: []
tools: []
context:
  - kind: playbook
    scope: objection-handling
    inject_as: PLAYBOOK_CONTEXT
  - kind: knowledge
    scope: offer-catalog
    inject_as: KNOWLEDGE_CONTEXT
    required: false
---

Test body with {{PLAYBOOK_CONTEXT}} and {{KNOWLEDGE_CONTEXT}}.
```

**`test-duplicate-inject-as.md`:**

```markdown
---
name: test-duplicate-inject-as
slug: test-duplicate-inject-as
version: 1.0.0
description: Test skill with duplicate injectAs
author: test
parameters: []
tools: []
context:
  - kind: playbook
    scope: objection-handling
    inject_as: PLAYBOOK_CONTEXT
  - kind: policy
    scope: messaging-rules
    inject_as: PLAYBOOK_CONTEXT
---

Test body.
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run skill-loader.test`
Expected: FAIL — `context` property not on SkillDefinition

- [ ] **Step 3: Modify skill-loader.ts**

In `packages/core/src/skill-runtime/skill-loader.ts`:

1. Add import:

```typescript
import { ContextRequirementSchema } from "@switchboard/schemas";
import type { ContextRequirement } from "@switchboard/schemas";
```

2. Add context schema to `SkillFrontmatterSchema` (after `tools` at line 33):

```typescript
  context: z.array(z.object({
    kind: z.string(),
    scope: z.string(),
    inject_as: z.string(),
    required: z.boolean().default(true),
  })).default([]),
```

3. Add validation function after `validateToolReferences`:

```typescript
function validateContext(
  rawContext: Array<{ kind: string; scope: string; inject_as: string; required: boolean }>,
): { normalized: ContextRequirement[]; issues: string[] } {
  const issues: string[] = [];
  const normalized: ContextRequirement[] = [];
  const injectAsNames = new Set<string>();

  for (const entry of rawContext) {
    // Normalize inject_as → injectAs
    const req = {
      kind: entry.kind,
      scope: entry.scope,
      injectAs: entry.inject_as,
      required: entry.required,
    };
    const parsed = ContextRequirementSchema.safeParse(req);
    if (!parsed.success) {
      issues.push(...parsed.error.issues.map((i) => `context[${entry.inject_as}]: ${i.message}`));
      continue;
    }

    if (injectAsNames.has(parsed.data.injectAs)) {
      issues.push(`Duplicate injectAs value: ${parsed.data.injectAs}`);
    }
    injectAsNames.add(parsed.data.injectAs);
    normalized.push(parsed.data);
  }

  return { normalized, issues };
}
```

4. In `loadSkill()`, after line 116 (`issues.push(...validateParameters(...))`), add:

```typescript
const { normalized: context, issues: contextIssues } = validateContext(frontmatter.context);
issues.push(...contextIssues);
```

5. In the return statement (line 130-141), add `context`:

```typescript
return {
  // ... existing fields
  context,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run skill-loader.test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/skill-loader.ts packages/core/src/skill-runtime/__tests__/skill-loader.test.ts && git commit -m "feat(core): parse context block in skill frontmatter with duplicate injectAs validation"
```

---

### Task 6: Wire ContextResolver into SkillHandler

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-handler.ts`
- Modify: `packages/core/src/skill-runtime/__tests__/skill-handler.test.ts` (extend)

- [ ] **Step 1: Add integration test**

Add to existing `skill-handler.test.ts`:

```typescript
describe("context resolution integration", () => {
  it("merges resolved context variables into execution parameters", async () => {
    // Create a SkillHandler with a mock ContextResolver
    // Verify that resolved.variables are merged into the parameters
    // passed to executor.execute()
    // ...
  });

  it("fails before LLM call when required context is missing", async () => {
    // Create a SkillHandler with a resolver that throws ContextResolutionError
    // Verify handler sends error message to chat, does not call executor
    // ...
  });

  it("proceeds normally when no context requirements exist", async () => {
    // skill.context = [] — resolver returns empty, execution works as before
    // ...
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run skill-handler.test`
Expected: FAIL — ContextResolver not wired

- [ ] **Step 3: Modify skill-handler.ts**

1. Add imports at top:

```typescript
import type { ContextResolverImpl } from "./context-resolver.js";
import { ContextResolutionError } from "./types.js";
```

2. Add `contextResolver` to constructor (after `outcomeLinker` at line 43):

```typescript
    private contextResolver: { resolve: ContextResolverImpl["resolve"] },
```

3. After the parameter builder block (after line 81), add context resolution:

```typescript
// Resolve curated knowledge context
let contextVariables: Record<string, string> = {};
try {
  const resolved = await this.contextResolver.resolve(this.config.orgId, this.skill.context);
  contextVariables = resolved.variables;
} catch (err) {
  if (err instanceof ContextResolutionError) {
    await ctx.chat.send(
      "I'm missing some required setup. Please contact your admin to configure knowledge entries.",
    );
    console.error(`Context resolution failed: ${err.message}`);
    return;
  }
  throw err;
}

// Merge runtime params + knowledge context
const mergedParameters = { ...parameters, ...contextVariables };
```

4. Replace `parameters` with `mergedParameters` in the `executor.execute()` call (line 92):

```typescript
result = await this.executor.execute({
  skill: this.skill,
  parameters: mergedParameters,
  // ...rest unchanged
});
```

5. Update `inputParametersHash` to hash merged parameters (lines 111 and 141):

```typescript
    inputParametersHash: hashParameters(mergedParameters),
```

6. **Add context resolution metadata to execution traces.** In both the success trace (line 135-154) and error trace (line 103-122), add `contextResolution` to the metadata. The `SkillExecutionTrace` interface already stores trace data — add a `contextResolution` field. In the success path, capture `resolved.metadata`:

```typescript
// After resolving context, save metadata for trace
const contextResolutionMeta = resolved.metadata;
```

Then include it in the trace assembly. Since `SkillExecutionTrace` stores to a JSON metadata column in `prisma-execution-trace-store.ts`, the field is serialized alongside existing trace data.

7. **Update caller site** in `packages/core/src/channel-gateway/channel-gateway.ts` (line 157-172). Add `contextResolver` as the last argument to `new SkillHandler(...)`:

```typescript
      return new SkillHandler(
        skill,
        executor,
        skillRuntime.builderMap,
        skillRuntime.stores,
        { deploymentId: ..., orgId: ..., contactId: ..., sessionId: ... },
        skillRuntime.traceStore,
        skillRuntime.circuitBreaker,
        skillRuntime.blastRadiusLimiter,
        skillRuntime.outcomeLinker,
        skillRuntime.contextResolver,  // NEW
      );
```

This requires adding `contextResolver` to the `skillRuntime` config object (in `ChannelGatewayConfig` or wherever `skillRuntime` is assembled in bootstrap).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run skill-handler.test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/skill-handler.ts packages/core/src/skill-runtime/__tests__/skill-handler.test.ts && git commit -m "feat(core): wire ContextResolver into SkillHandler between param build and execution"
```

---

### Task 7: Wire ContextResolver into BatchSkillHandler

**Files:**

- Modify: `packages/core/src/skill-runtime/batch-skill-handler.ts`

- [ ] **Step 1: Add import and dependency**

Add import:

```typescript
import type { ContextResolverImpl } from "./context-resolver.js";
```

Add to `BatchSkillHandlerConfig` interface (after `outcomeLinker` at line 34):

```typescript
contextResolver: {
  resolve: ContextResolverImpl["resolve"];
}
```

- [ ] **Step 2: Add context resolution after builder call**

After line 69 (the builder call), add:

```typescript
// Resolve curated knowledge context
const resolved = await this.config.contextResolver.resolve(
  execConfig.orgId,
  this.config.skill.context,
);
const mergedParameters = { ...parameters, ...resolved.variables };
```

- [ ] **Step 3: Replace `parameters` with `mergedParameters`**

In the `executor.execute()` call (line 72-80), replace `parameters` with `mergedParameters`.

In `hashParameters` call (line 140), replace `parameters` with `mergedParameters`.

- [ ] **Step 4: Update all existing BatchSkillHandler test mocks**

In `packages/core/src/skill-runtime/batch-skill-handler.test.ts`, add `contextResolver` to every `new BatchSkillHandler({...})` call:

```typescript
contextResolver: { resolve: vi.fn().mockResolvedValue({ variables: {}, metadata: [] }) },
```

Also update any production code that constructs `BatchSkillHandler` (search for `new BatchSkillHandler(` — likely in Inngest functions in `apps/api/src/bootstrap/inngest.ts`).

- [ ] **Step 5: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run batch-skill-handler.test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/batch-skill-handler.ts && git commit -m "feat(core): wire ContextResolver into BatchSkillHandler"
```

---

### Task 8: API Routes for Knowledge Entries

**Files:**

- Create: `apps/api/src/routes/knowledge-entries.ts`
- Create: `apps/api/src/routes/__tests__/knowledge-entries.test.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

**Note:** The existing `/api/knowledge` prefix is used by the RAG/KnowledgeChunk system (`apps/api/src/routes/knowledge.ts`). These new routes use `/api/knowledge-entries` to avoid collision.

- [ ] **Step 1: Write the route test file**

```typescript
// apps/api/src/routes/__tests__/knowledge-entries.test.ts
// Follow the test pattern from other route tests in this directory.
// Use the app test helper to create a Fastify instance with auth and prisma mocked.
// Tests should verify:
//
// POST /api/knowledge-entries:
//   - 201 on valid input (kind, scope, title, content)
//   - 400 on blank content
//   - 400 on non-kebab-case scope
//   - 400 on invalid kind
//   - orgId injected from auth, not from body
//
// GET /api/knowledge-entries:
//   - 200 returns entries array
//   - supports ?kind= and ?scope= query filters
//   - returns only entries for the authenticated org
//
// GET /api/knowledge-entries/:id:
//   - 200 on found
//   - 404 on not found or wrong org
//
// PATCH /api/knowledge-entries/:id:
//   - 200 returns new versioned entry
//   - 404 on not found
//   - 400 on blank content
//
// DELETE /api/knowledge-entries/:id:
//   - 204 on success
//   - 404 on not found or wrong org
//
// Implementation: mock PrismaKnowledgeEntryStore methods via vi.fn(),
// inject mock prisma on app instance, set organizationIdFromAuth via
// test auth middleware. See existing route tests for exact patterns.
import { describe, it, expect, vi } from "vitest";

describe("knowledge-entries routes", () => {
  // Implementation follows the pattern in existing route test files.
  // The implementer should:
  // 1. Look at an existing route test (e.g., marketplace routes) for the app setup pattern
  // 2. Mock PrismaKnowledgeEntryStore methods
  // 3. Write one test per endpoint covering success + key error cases
  it.todo("POST / creates entry with valid input");
  it.todo("POST / returns 400 on blank content");
  it.todo("POST / returns 400 on non-kebab-case scope");
  it.todo("GET / returns entries with optional filters");
  it.todo("GET /:id returns 404 for wrong org");
  it.todo("PATCH /:id creates new version");
  it.todo("DELETE /:id returns 204 on success");
});
```

- [ ] **Step 2: Create the routes file**

```typescript
// apps/api/src/routes/knowledge-entries.ts
import type { FastifyPluginAsync } from "fastify";
import { PrismaKnowledgeEntryStore } from "@switchboard/db";
import {
  KnowledgeEntryCreateSchema,
  KnowledgeEntryUpdateSchema,
  KnowledgeKindSchema,
} from "@switchboard/schemas";
import { requireOrganizationScope } from "../utils/require-org.js";

export const knowledgeEntryRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/knowledge-entries
  app.get("/", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const query = request.query as { kind?: string; scope?: string };
    const store = new PrismaKnowledgeEntryStore(app.prisma);

    const kindParse = query.kind ? KnowledgeKindSchema.safeParse(query.kind) : undefined;
    if (query.kind && !kindParse?.success) {
      return reply.code(400).send({ error: "Invalid kind filter", statusCode: 400 });
    }

    const entries = await store.list(orgId, {
      kind: kindParse?.data,
      scope: query.scope,
    });

    return reply.send({ entries });
  });

  // GET /api/knowledge-entries/:id
  app.get("/:id", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };
    const entry = await app.prisma.knowledgeEntry.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!entry) {
      return reply.code(404).send({ error: "Not found", statusCode: 404 });
    }

    return reply.send({ entry });
  });

  // POST /api/knowledge-entries
  app.post("/", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const parsed = KnowledgeEntryCreateSchema.safeParse({
      ...(request.body as object),
      organizationId: orgId,
    });

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        statusCode: 400,
      });
    }

    const store = new PrismaKnowledgeEntryStore(app.prisma);
    const entry = await store.create(parsed.data);

    return reply.code(201).send({ entry });
  });

  // PATCH /api/knowledge-entries/:id
  app.patch("/:id", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };
    const parsed = KnowledgeEntryUpdateSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        statusCode: 400,
      });
    }

    const store = new PrismaKnowledgeEntryStore(app.prisma);
    try {
      const entry = await store.update(id, orgId, parsed.data);
      return reply.send({ entry });
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message, statusCode: 404 });
    }
  });

  // DELETE /api/knowledge-entries/:id
  app.delete("/:id", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };
    const store = new PrismaKnowledgeEntryStore(app.prisma);

    try {
      await store.deactivate(id, orgId);
      return reply.code(204).send();
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message, statusCode: 404 });
    }
  });
};
```

- [ ] **Step 3: Register routes**

In `apps/api/src/bootstrap/routes.ts`, add import:

```typescript
import { knowledgeEntryRoutes } from "../routes/knowledge-entries.js";
```

Add registration (after the existing `knowledgeRoutes` line 60):

```typescript
await app.register(knowledgeEntryRoutes, { prefix: "/api/knowledge-entries" });
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run knowledge-entries.test`
Expected: PASS

- [ ] **Step 5: Run full API typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/api typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/knowledge-entries.ts apps/api/src/routes/__tests__/knowledge-entries.test.ts apps/api/src/bootstrap/routes.ts && git commit -m "feat(api): add CRUD routes for knowledge entries at /api/knowledge-entries"
```

---

### Task 9: Seeds

**Files:**

- Create: `packages/db/prisma/seed-knowledge.ts`
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Create seed file**

```typescript
// packages/db/prisma/seed-knowledge.ts
/* eslint-disable no-console */
import type { PrismaClient } from "@prisma/client";

const KNOWLEDGE_SEEDS = [
  {
    kind: "playbook" as const,
    scope: "objection-handling",
    title: "Standard objection handling patterns",
    content: `## Price Objections
- Reframe around value and ROI, not cost
- Mention payment plans or flexible options if available
- Ask what budget they had in mind — sometimes the gap is small

## Timing Objections
- Create urgency through value, not pressure
- Tie to their stated timeline or goals
- Suggest a specific next step with a deadline

## Trust Objections
- Share relevant proof points, case studies, or guarantees
- Offer a trial or low-risk entry point
- Be transparent about what you can and cannot do

## Competitor Objections
- Differentiate on strengths, never disparage
- Ask what specifically they liked about the competitor
- Focus on fit for their specific situation

## "Need to Think" Objections
- Suggest a specific next step with a timeline
- Ask what information would help them decide
- Offer to send a summary they can review`,
    priority: 0,
  },
  {
    kind: "policy" as const,
    scope: "messaging-rules",
    title: "Default messaging policy",
    content: `## Messaging Rules
- Keep first messages under 3 sentences
- Never use ALL CAPS or excessive punctuation
- Do not send more than 1 follow-up per 24 hours
- Always personalize — reference something specific to the lead
- Respect opt-out immediately and completely
- Never fabricate statistics, case studies, or testimonials
- Avoid industry jargon unless the lead uses it first
- End messages with a clear, single call to action`,
    priority: 0,
  },
  {
    kind: "knowledge" as const,
    scope: "offer-catalog",
    title: "Demo service catalog",
    content: `## Available Services

### Starter Package — $499/month
- Social media management (3 platforms)
- Monthly performance report
- Basic ad campaign management

### Growth Package — $999/month
- Everything in Starter
- SEO optimization
- Weekly performance reports
- A/B testing for ads

### Enterprise Package — Custom pricing
- Everything in Growth
- Dedicated account manager
- Custom integrations
- Priority support`,
    priority: 0,
  },
  {
    kind: "playbook" as const,
    scope: "qualification-framework",
    title: "Lead qualification playbook",
    content: `## Qualification Criteria
Qualify leads by gathering these signals through natural conversation:

1. **Need** — Do they have a problem your offering solves?
2. **Budget** — Can they afford the solution? (Don't ask directly — infer from business size, current spend)
3. **Authority** — Are they the decision maker? If not, who is?
4. **Timeline** — When do they need a solution? Urgent = higher priority
5. **Fit** — Is their business a good fit for your service?

## Scoring
- 4-5 criteria met → Qualified (move to quoted stage)
- 2-3 criteria met → Needs nurturing (stay in interested)
- 0-1 criteria met → Likely not a fit (politely close)

## Hard Disqualifiers
- Explicitly states no budget
- Business type outside service area
- Looking for something you don't offer
- Spam or bot behavior`,
    priority: 0,
  },
  {
    kind: "playbook" as const,
    scope: "nurture-cadence",
    title: "Re-engagement playbook",
    content: `## Nurture Cadence (5-touch sequence)

### Touch 1: Value Reminder (Day 1)
Highlight what they were originally interested in.
Reference their specific situation or pain point.

### Touch 2: New Angle (Day 3)
Present the offering from a different perspective.
Share a relevant insight or industry trend.

### Touch 3: Social Proof (Day 7)
Share a relevant success story or testimonial.
Keep it specific to their industry or situation.

### Touch 4: Soft Check-in (Day 14)
Ask if their situation has changed.
Offer to answer any new questions.

### Touch 5: Final Touch (Day 30)
Let them know you're here if they need anything.
No pressure — leave the door open.

## Rules
- One follow-up per 24 hours maximum
- If they re-engage with buying signals → move to qualified
- If they say stop → stop immediately, log opt-out
- After Touch 5 with no reply → stop outreach`,
    priority: 0,
  },
];

export async function seedKnowledge(prisma: PrismaClient): Promise<void> {
  for (const seed of KNOWLEDGE_SEEDS) {
    await prisma.knowledgeEntry.upsert({
      where: {
        organizationId_kind_scope_version: {
          organizationId: "org_dev",
          kind: seed.kind,
          scope: seed.scope,
          version: 1,
        },
      },
      update: {},
      create: {
        organizationId: "org_dev",
        kind: seed.kind,
        scope: seed.scope,
        title: seed.title,
        content: seed.content,
        priority: seed.priority,
        version: 1,
        active: true,
      },
    });
  }

  console.warn(`Seeded ${KNOWLEDGE_SEEDS.length} knowledge entries for org_dev`);
}
```

- [ ] **Step 2: Wire into seed.ts**

In `packages/db/prisma/seed.ts`:

Add import (after line 5):

```typescript
import { seedKnowledge } from "./seed-knowledge.js";
```

Add call before the closing of `main()` (before line 576):

```typescript
// ── Knowledge Entries ──
console.log("\n--- Knowledge Entries ---");
await seedKnowledge(prisma);
```

- [ ] **Step 3: Run seed**

Run: `npx pnpm@9.15.4 --filter @switchboard/db db:seed`
Expected: "Seeded 5 knowledge entries for org_dev"

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/seed-knowledge.ts packages/db/prisma/seed.ts && git commit -m "feat(db): add knowledge entry seeds for demo org"
```

---

### Task 10: Update sales-pipeline.md with Context Block

**Files:**

- Modify: `skills/sales-pipeline.md`

- [ ] **Step 1: Add context block to frontmatter**

In `skills/sales-pipeline.md`, add after the `tools:` block (after line 49):

```yaml
context:
  - kind: playbook
    scope: objection-handling
    inject_as: PLAYBOOK_CONTEXT
  - kind: policy
    scope: messaging-rules
    inject_as: POLICY_CONTEXT
  - kind: knowledge
    scope: offer-catalog
    inject_as: KNOWLEDGE_CONTEXT
    required: false
  - kind: playbook
    scope: qualification-framework
    inject_as: QUALIFICATION_CONTEXT
  - kind: playbook
    scope: nurture-cadence
    inject_as: NURTURE_CONTEXT
```

- [ ] **Step 2: Add template variable references in body**

Replace the hardcoded objection handling section (lines 96-104) with:

```markdown
**Objection handling:**
{{PLAYBOOK_CONTEXT}}
```

After the "Tone" section at the bottom, add:

```markdown
## Messaging Policy

{{POLICY_CONTEXT}}

## Available Services

{{KNOWLEDGE_CONTEXT}}
```

In the "interested" stage section, after `**Qualification framework:**`, add:

```markdown
{{QUALIFICATION_CONTEXT}}
```

In the "nurturing" stage section, replace the hardcoded approach cadence with:

```markdown
{{NURTURE_CONTEXT}}
```

- [ ] **Step 3: Verify skill loads**

Run a quick smoke test (typecheck or existing skill-loader tests):
Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run skill-loader.test`
Expected: PASS — sales-pipeline.md loads with context block

- [ ] **Step 4: Commit**

```bash
git add skills/sales-pipeline.md && git commit -m "feat(skills): add context declarations to sales-pipeline skill"
```

---

### Task 11: Full Integration Test + Final Checks

**Files:** No new files — validation only

- [ ] **Step 1: Run all tests across affected packages**

```bash
npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run
npx pnpm@9.15.4 --filter @switchboard/db test -- --run
npx pnpm@9.15.4 --filter @switchboard/core test -- --run
npx pnpm@9.15.4 --filter @switchboard/api test -- --run
```

Expected: All PASS

- [ ] **Step 2: Run typecheck across all packages**

Run: `npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npx pnpm@9.15.4 lint`
Expected: PASS

- [ ] **Step 4: Run full build**

Run: `npx pnpm@9.15.4 build`
Expected: PASS

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A && git commit -m "chore: fix lint/type issues from SP5 knowledge layer integration"
```
