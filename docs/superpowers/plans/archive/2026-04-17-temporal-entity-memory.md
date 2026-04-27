# Temporal Entity Memory (SP7) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add entity-addressable temporal memory (`TemporalFact`) so agents know what is currently true about an account, campaign, or contact — and what changed over time.

**Architecture:** New `TemporalFact` Prisma model with temporal supersession logic (one active fact per entity+subject, versioned). `TemporalFactService` handles canonical equality and source precedence. Subject registry validates writes. Context builder gains a fourth retrieval path (`entityFacts`) alongside existing RAG, DeploymentMemory, and summaries. API routes for CRUD. No agent inference writes in v1.

**Tech Stack:** TypeScript, Prisma (PostgreSQL), Zod, Vitest, Fastify

**Spec:** `docs/superpowers/specs/2026-04-17-temporal-entity-memory-design.md`

---

## File Map

| File                                                                        | Action | Responsibility                                            |
| --------------------------------------------------------------------------- | ------ | --------------------------------------------------------- |
| `packages/schemas/src/temporal-fact.ts`                                     | Create | Zod schemas, enums, types for TemporalFact                |
| `packages/schemas/src/index.ts`                                             | Modify | Export temporal-fact schemas                              |
| `packages/db/prisma/schema.prisma`                                          | Modify | Add TemporalFact model + 5 enums                          |
| `packages/db/src/stores/prisma-temporal-fact-store.ts`                      | Create | Store with transactional supersession                     |
| `packages/db/src/stores/__tests__/prisma-temporal-fact-store.test.ts`       | Create | Store tests                                               |
| `packages/db/src/index.ts`                                                  | Modify | Export PrismaTemporalFactStore                            |
| `packages/core/src/memory/subject-registry.ts`                              | Create | Central subject definitions                               |
| `packages/core/src/memory/temporal-fact-service.ts`                         | Create | Canonical equality, source precedence, subject validation |
| `packages/core/src/memory/__tests__/temporal-fact-service.test.ts`          | Create | Service tests                                             |
| `packages/core/src/memory/index.ts`                                         | Modify | Export new types                                          |
| `packages/agents/src/memory/context-builder.ts`                             | Modify | Add entityFacts retrieval path                            |
| `packages/agents/src/memory/__tests__/context-builder-entity-facts.test.ts` | Create | Entity facts context tests                                |
| `apps/api/src/routes/entity-facts.ts`                                       | Create | CRUD API routes                                           |
| `apps/api/src/routes/__tests__/entity-facts.test.ts`                        | Create | Route tests                                               |
| `apps/api/src/app.ts`                                                       | Modify | Register entity-facts routes                              |

---

### Task 1: Zod Schemas and Types

**Files:**

- Create: `packages/schemas/src/temporal-fact.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/schemas/src/__tests__/temporal-fact.test.ts
import { describe, it, expect } from "vitest";
import {
  FactEntityTypeSchema,
  FactCategorySchema,
  FactStatusSchema,
  FactSourceSchema,
  FactValueTypeSchema,
  RecordFactInputSchema,
  TemporalFactSchema,
} from "../temporal-fact.js";

describe("TemporalFact schemas", () => {
  describe("enums", () => {
    it("validates entity types", () => {
      expect(FactEntityTypeSchema.parse("account")).toBe("account");
      expect(FactEntityTypeSchema.parse("campaign")).toBe("campaign");
      expect(FactEntityTypeSchema.parse("contact")).toBe("contact");
      expect(() => FactEntityTypeSchema.parse("order")).toThrow();
    });

    it("validates categories", () => {
      expect(FactCategorySchema.parse("configuration")).toBe("configuration");
      expect(FactCategorySchema.parse("performance")).toBe("performance");
      expect(FactCategorySchema.parse("status")).toBe("status");
      expect(FactCategorySchema.parse("relationship")).toBe("relationship");
      expect(FactCategorySchema.parse("human_assertion")).toBe("human_assertion");
      expect(() => FactCategorySchema.parse("random")).toThrow();
    });

    it("validates statuses", () => {
      expect(FactStatusSchema.parse("active")).toBe("active");
      expect(FactStatusSchema.parse("superseded")).toBe("superseded");
      expect(FactStatusSchema.parse("retracted")).toBe("retracted");
    });

    it("validates sources", () => {
      expect(FactSourceSchema.parse("system")).toBe("system");
      expect(FactSourceSchema.parse("api")).toBe("api");
      expect(FactSourceSchema.parse("human")).toBe("human");
      expect(() => FactSourceSchema.parse("agent")).toThrow();
    });

    it("validates value types", () => {
      expect(FactValueTypeSchema.parse("string")).toBe("string");
      expect(FactValueTypeSchema.parse("number")).toBe("number");
      expect(FactValueTypeSchema.parse("boolean")).toBe("boolean");
      expect(FactValueTypeSchema.parse("json")).toBe("json");
      expect(FactValueTypeSchema.parse("enum_value")).toBe("enum_value");
    });
  });

  describe("RecordFactInputSchema", () => {
    const validInput = {
      organizationId: "org_1",
      deploymentId: "dep_1",
      entityType: "campaign",
      entityId: "camp_123",
      category: "configuration",
      subject: "bidding-strategy",
      valueText: "ASC",
      valueType: "enum_value",
      source: "system",
    };

    it("accepts valid input", () => {
      const result = RecordFactInputSchema.parse(validInput);
      expect(result.subject).toBe("bidding-strategy");
      expect(result.confidence).toBe(1.0);
    });

    it("enforces kebab-case subject", () => {
      expect(() =>
        RecordFactInputSchema.parse({ ...validInput, subject: "BiddingStrategy" }),
      ).toThrow();
      expect(() =>
        RecordFactInputSchema.parse({ ...validInput, subject: "bidding_strategy" }),
      ).toThrow();
    });

    it("requires at least valueText or valueJson", () => {
      const { valueText: _, ...noValue } = validInput;
      expect(() => RecordFactInputSchema.parse(noValue)).toThrow();
    });

    it("allows optional fields", () => {
      const result = RecordFactInputSchema.parse({
        ...validInput,
        validFrom: "2026-04-17T00:00:00.000Z",
        observedAt: "2026-04-17T00:00:00.000Z",
        sourceDetail: "campaign-sync-job",
        changeReason: "api_refresh",
      });
      expect(result.sourceDetail).toBe("campaign-sync-job");
    });
  });

  describe("TemporalFactSchema", () => {
    it("accepts a full temporal fact", () => {
      const result = TemporalFactSchema.parse({
        id: "fact_1",
        organizationId: "org_1",
        deploymentId: "dep_1",
        entityType: "campaign",
        entityId: "camp_123",
        category: "configuration",
        subject: "bidding-strategy",
        valueText: "ASC",
        valueType: "enum_value",
        status: "active",
        confidence: 1.0,
        source: "system",
        validFrom: "2026-04-17T00:00:00.000Z",
        createdAt: "2026-04-17T00:00:00.000Z",
      });
      expect(result.id).toBe("fact_1");
      expect(result.status).toBe("active");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run temporal-fact`
Expected: FAIL — module not found

- [ ] **Step 3: Write the schemas**

```typescript
// packages/schemas/src/temporal-fact.ts
import { z } from "zod";

// --- Enums ---

export const FactEntityTypeSchema = z.enum(["account", "campaign", "contact"]);
export type FactEntityType = z.infer<typeof FactEntityTypeSchema>;

export const FactCategorySchema = z.enum([
  "configuration",
  "performance",
  "status",
  "relationship",
  "human_assertion",
]);
export type FactCategory = z.infer<typeof FactCategorySchema>;

export const FactStatusSchema = z.enum(["active", "superseded", "retracted"]);
export type FactStatus = z.infer<typeof FactStatusSchema>;

// v1: agent source excluded — agent inference does not write temporal facts
export const FactSourceSchema = z.enum(["system", "api", "human"]);
export type FactSource = z.infer<typeof FactSourceSchema>;

export const FactValueTypeSchema = z.enum(["string", "number", "boolean", "json", "enum_value"]);
export type FactValueType = z.infer<typeof FactValueTypeSchema>;

// --- Source precedence (higher number = higher trust) ---

export const SOURCE_TRUST_ORDER: Record<FactSource, number> = {
  system: 3,
  api: 2,
  human: 1,
};

// --- Input schemas ---

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const RecordFactInputSchema = z
  .object({
    organizationId: z.string().min(1),
    deploymentId: z.string().min(1),
    entityType: FactEntityTypeSchema,
    entityId: z.string().min(1),
    category: FactCategorySchema,
    subject: z.string().regex(KEBAB_CASE, "Subject must be lowercase kebab-case"),
    valueText: z.string().optional(),
    valueJson: z.unknown().optional(),
    valueType: FactValueTypeSchema.default("string"),
    confidence: z.number().min(0).max(1).default(1.0),
    source: FactSourceSchema,
    sourceDetail: z.string().optional(),
    changeReason: z.string().optional(),
    validFrom: z.coerce.date().optional(),
    observedAt: z.coerce.date().optional(),
  })
  .refine((data) => data.valueText !== undefined || data.valueJson !== undefined, {
    message: "At least one of valueText or valueJson must be provided",
  });
export type RecordFactInput = z.infer<typeof RecordFactInputSchema>;

export const RetractFactInputSchema = z.object({
  reason: z.string().min(1),
});

// --- Output schema ---

export const TemporalFactSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string(),
  deploymentId: z.string(),
  entityType: FactEntityTypeSchema,
  entityId: z.string(),
  category: FactCategorySchema,
  subject: z.string(),
  valueText: z.string().nullable().optional(),
  valueJson: z.unknown().nullable().optional(),
  valueType: FactValueTypeSchema,
  status: FactStatusSchema,
  confidence: z.number(),
  source: FactSourceSchema,
  sourceDetail: z.string().nullable().optional(),
  changeReason: z.string().nullable().optional(),
  supersededById: z.string().nullable().optional(),
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date().nullable().optional(),
  observedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
});
export type TemporalFact = z.infer<typeof TemporalFactSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run temporal-fact`
Expected: PASS

- [ ] **Step 5: Export from schemas barrel**

Add to `packages/schemas/src/index.ts`:

```typescript
export * from "./temporal-fact.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/temporal-fact.ts packages/schemas/src/__tests__/temporal-fact.test.ts packages/schemas/src/index.ts
git commit -m "$(cat <<'EOF'
feat(schemas): add TemporalFact Zod schemas and types

Defines enums (FactEntityType, FactCategory, FactStatus, FactSource,
FactValueType), RecordFactInput with kebab-case subject validation,
source trust ordering, and TemporalFact output schema. Agent source
excluded in v1 — only system/api/human write temporal facts.
EOF
)"
```

---

### Task 2: Prisma Model + Store

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/stores/prisma-temporal-fact-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-temporal-fact-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/db/src/stores/__tests__/prisma-temporal-fact-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaTemporalFactStore } from "../prisma-temporal-fact-store.js";

function makeFact(overrides: Record<string, unknown> = {}) {
  return {
    id: "fact_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
    entityType: "campaign",
    entityId: "camp_123",
    category: "configuration",
    subject: "bidding-strategy",
    valueText: "ASC",
    valueJson: null,
    valueType: "enum_value",
    status: "active",
    confidence: 1.0,
    source: "system",
    sourceDetail: null,
    changeReason: null,
    supersededById: null,
    validFrom: new Date("2026-04-01"),
    validUntil: null,
    observedAt: null,
    createdAt: new Date("2026-04-01"),
    ...overrides,
  };
}

describe("PrismaTemporalFactStore", () => {
  let store: PrismaTemporalFactStore;
  let mockPrisma: Record<string, unknown>;
  let mockTx: Record<string, unknown>;

  beforeEach(() => {
    mockTx = {
      temporalFact: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "fact_new", ...data })),
        update: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    mockPrisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(mockTx)),
      temporalFact: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    store = new PrismaTemporalFactStore(mockPrisma as never);
  });

  describe("recordFact", () => {
    it("inserts a new fact when no active predecessor exists", async () => {
      const result = await store.recordFact({
        organizationId: "org_1",
        deploymentId: "dep_1",
        entityType: "campaign",
        entityId: "camp_123",
        category: "configuration",
        subject: "bidding-strategy",
        valueText: "ASC",
        valueType: "enum_value",
        source: "system",
        confidence: 1.0,
      });

      expect(mockTx.temporalFact.create).toHaveBeenCalledOnce();
      const createCall = (mockTx.temporalFact.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(createCall.data.status).toBe("active");
      expect(createCall.data.validUntil).toBeNull();
    });

    it("supersedes an existing active fact when value differs", async () => {
      const existing = makeFact({ valueText: "manual" });
      (mockTx.temporalFact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(existing);

      await store.recordFact({
        organizationId: "org_1",
        deploymentId: "dep_1",
        entityType: "campaign",
        entityId: "camp_123",
        category: "configuration",
        subject: "bidding-strategy",
        valueText: "ASC",
        valueType: "enum_value",
        source: "system",
        confidence: 1.0,
      });

      expect(mockTx.temporalFact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "fact_1" },
          data: expect.objectContaining({ status: "superseded" }),
        }),
      );
      expect(mockTx.temporalFact.create).toHaveBeenCalledOnce();
    });

    it("updates observedAt when value is canonically identical", async () => {
      const existing = makeFact({ valueText: "ASC" });
      (mockTx.temporalFact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(existing);

      const result = await store.recordFact({
        organizationId: "org_1",
        deploymentId: "dep_1",
        entityType: "campaign",
        entityId: "camp_123",
        category: "configuration",
        subject: "bidding-strategy",
        valueText: "asc",
        valueType: "enum_value",
        source: "system",
        confidence: 1.0,
      });

      expect(mockTx.temporalFact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "fact_1" },
          data: expect.objectContaining({ observedAt: expect.any(Date) }),
        }),
      );
      expect(mockTx.temporalFact.create).not.toHaveBeenCalled();
    });
  });

    it("rejects supersession when incoming source has lower trust than existing", async () => {
      const existing = makeFact({ source: "system" });
      (mockTx.temporalFact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(existing);

      await expect(
        store.recordFact({
          organizationId: "org_1",
          deploymentId: "dep_1",
          entityType: "campaign",
          entityId: "camp_123",
          category: "configuration",
          subject: "bidding-strategy",
          valueText: "manual",
          valueType: "enum_value",
          source: "human",
          confidence: 1.0,
        }),
      ).rejects.toThrow("lower-trust source");
    });
  });

  describe("retractFact", () => {
    it("sets status to retracted with reason", async () => {
      await store.retractFact("fact_1", "org_1", "api_refresh");

      expect(mockPrisma.temporalFact.update).toHaveBeenCalledWith({
        where: { id: "fact_1" },
        data: expect.objectContaining({
          status: "retracted",
          changeReason: "api_refresh",
        }),
      });
    });
  });

  describe("getActiveFacts", () => {
    it("queries active facts for entity", async () => {
      await store.getActiveFacts("org_1", "dep_1", "campaign", "camp_123");

      expect(mockPrisma.temporalFact.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org_1",
          deploymentId: "dep_1",
          entityType: "campaign",
          entityId: "camp_123",
          status: "active",
        },
        orderBy: [{ category: "asc" }, { subject: "asc" }],
      });
    });
  });

  describe("getFactHistory", () => {
    it("returns all facts for a subject ordered by validFrom desc", async () => {
      await store.getFactHistory("org_1", "dep_1", "campaign", "camp_123", "bidding-strategy");

      expect(mockPrisma.temporalFact.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org_1",
          deploymentId: "dep_1",
          entityType: "campaign",
          entityId: "camp_123",
          subject: "bidding-strategy",
        },
        orderBy: { validFrom: "desc" },
      });
    });
  });

  describe("getFactsAsOf", () => {
    it("queries facts valid at a specific date", async () => {
      const asOf = new Date("2026-03-15");
      await store.getFactsAsOf("org_1", "dep_1", "campaign", "camp_123", asOf);

      expect(mockPrisma.temporalFact.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org_1",
          deploymentId: "dep_1",
          entityType: "campaign",
          entityId: "camp_123",
          validFrom: { lte: asOf },
          OR: [{ validUntil: null }, { validUntil: { gt: asOf } }],
        },
        orderBy: [{ category: "asc" }, { subject: "asc" }],
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-temporal-fact-store`
Expected: FAIL — module not found

- [ ] **Step 3: Add Prisma model and enums**

Add to `packages/db/prisma/schema.prisma`:

```prisma
enum FactEntityType {
  account
  campaign
  contact
}

enum FactCategory {
  configuration
  performance
  status
  relationship
  human_assertion
}

enum FactStatus {
  active
  superseded
  retracted
}

enum FactSource {
  system
  human
  api
}

enum FactValueType {
  string
  number
  boolean
  json
  enum_value
}

model TemporalFact {
  id               String          @id @default(cuid())
  organizationId   String
  deploymentId     String
  entityType       FactEntityType
  entityId         String
  category         FactCategory
  subject          String
  valueText        String?
  valueJson        Json?
  valueType        FactValueType   @default(string)
  status           FactStatus      @default(active)
  confidence       Float           @default(1.0)
  source           FactSource
  sourceDetail     String?
  changeReason     String?
  supersededById   String?
  validFrom        DateTime
  validUntil       DateTime?
  observedAt       DateTime?
  createdAt        DateTime        @default(now())

  @@unique([organizationId, deploymentId, entityType, entityId, subject, validFrom])
  @@index([organizationId, entityType, entityId, status])
  @@index([organizationId, deploymentId, entityType, status])
  @@index([supersededById])
}
```

- [ ] **Step 4: Generate Prisma client**

Run: `npx pnpm@9.15.4 db:generate`

- [ ] **Step 5: Write the store implementation**

```typescript
// packages/db/src/stores/prisma-temporal-fact-store.ts
import type { PrismaClient } from "@prisma/client";

type FactEntityType = "account" | "campaign" | "contact";

interface RecordFactParams {
  organizationId: string;
  deploymentId: string;
  entityType: string;
  entityId: string;
  category: string;
  subject: string;
  valueText?: string;
  valueJson?: unknown;
  valueType: string;
  source: string;
  sourceDetail?: string;
  changeReason?: string;
  confidence: number;
  validFrom?: Date;
  observedAt?: Date;
}

export class PrismaTemporalFactStore {
  constructor(private readonly prisma: PrismaClient) {}

  async recordFact(params: RecordFactParams) {
    const now = new Date();
    const validFrom = params.validFrom ?? now;
    const observedAt = params.observedAt ?? now;

    return this.prisma.$transaction(async (tx) => {
      // 1. SELECT ... FOR UPDATE equivalent: findFirst in transaction
      const existing = await tx.temporalFact.findFirst({
        where: {
          organizationId: params.organizationId,
          deploymentId: params.deploymentId,
          entityType: params.entityType as FactEntityType,
          entityId: params.entityId,
          subject: params.subject,
          status: "active",
          validUntil: null,
        },
      });

      // 2. Canonical equality check
      if (existing && this.isCanonicallyEqual(existing, params)) {
        await tx.temporalFact.update({
          where: { id: existing.id },
          data: { observedAt },
        });
        return existing;
      }

      // 3. Source precedence check
      if (existing) {
        const trustOrder: Record<string, number> = { system: 3, api: 2, human: 1 };
        const existingTrust = trustOrder[existing.source] ?? 0;
        const incomingTrust = trustOrder[params.source] ?? 0;
        if (incomingTrust < existingTrust) {
          throw new Error(
            `Cannot supersede ${existing.source}-sourced fact with lower-trust source ${params.source}`,
          );
        }
      }

      // 4. Supersede existing if value differs
      if (existing) {
        await tx.temporalFact.update({
          where: { id: existing.id },
          data: {
            status: "superseded",
            validUntil: now,
            changeReason: params.changeReason ?? null,
          },
        });
      }

      // 5. Insert new active fact
      const newFact = await tx.temporalFact.create({
        data: {
          organizationId: params.organizationId,
          deploymentId: params.deploymentId,
          entityType: params.entityType as FactEntityType,
          entityId: params.entityId,
          category: params.category as never,
          subject: params.subject,
          valueText: params.valueText ?? null,
          valueJson: params.valueJson ?? undefined,
          valueType: params.valueType as never,
          status: "active",
          confidence: params.confidence,
          source: params.source as never,
          sourceDetail: params.sourceDetail ?? null,
          changeReason: params.changeReason ?? null,
          supersededById: null,
          validFrom,
          validUntil: null,
          observedAt,
        },
      });

      // 6. Link superseded fact to new one
      if (existing) {
        await tx.temporalFact.update({
          where: { id: existing.id },
          data: { supersededById: newFact.id },
        });
      }

      return newFact;
    });
  }

  async retractFact(id: string, orgId: string, reason: string): Promise<void> {
    await this.prisma.temporalFact.update({
      where: { id },
      data: {
        status: "retracted",
        validUntil: new Date(),
        changeReason: reason,
      },
    });
  }

  async getActiveFacts(orgId: string, deploymentId: string, entityType: string, entityId: string) {
    return this.prisma.temporalFact.findMany({
      where: {
        organizationId: orgId,
        deploymentId,
        entityType: entityType as FactEntityType,
        entityId,
        status: "active",
      },
      orderBy: [{ category: "asc" }, { subject: "asc" }],
    });
  }

  async getActiveFactBySubject(
    orgId: string,
    deploymentId: string,
    entityType: string,
    entityId: string,
    subject: string,
  ) {
    return this.prisma.temporalFact.findFirst({
      where: {
        organizationId: orgId,
        deploymentId,
        entityType: entityType as FactEntityType,
        entityId,
        subject,
        status: "active",
      },
    });
  }

  async getFactHistory(
    orgId: string,
    deploymentId: string,
    entityType: string,
    entityId: string,
    subject: string,
  ) {
    return this.prisma.temporalFact.findMany({
      where: {
        organizationId: orgId,
        deploymentId,
        entityType: entityType as FactEntityType,
        entityId,
        subject,
      },
      orderBy: { validFrom: "desc" },
    });
  }

  async getFactsAsOf(
    orgId: string,
    deploymentId: string,
    entityType: string,
    entityId: string,
    asOf: Date,
  ) {
    return this.prisma.temporalFact.findMany({
      where: {
        organizationId: orgId,
        deploymentId,
        entityType: entityType as FactEntityType,
        entityId,
        validFrom: { lte: asOf },
        OR: [{ validUntil: null }, { validUntil: { gt: asOf } }],
      },
      orderBy: [{ category: "asc" }, { subject: "asc" }],
    });
  }

  private isCanonicallyEqual(
    existing: { valueText: string | null; valueJson: unknown; valueType: string },
    incoming: { valueText?: string; valueJson?: unknown; valueType: string },
  ): boolean {
    const type = incoming.valueType;

    if (type === "json") {
      const existingJson =
        typeof existing.valueJson === "string"
          ? existing.valueJson
          : JSON.stringify(existing.valueJson, Object.keys(existing.valueJson as object).sort());
      const incomingJson =
        typeof incoming.valueJson === "string"
          ? incoming.valueJson
          : JSON.stringify(
              incoming.valueJson,
              Object.keys((incoming.valueJson ?? {}) as object).sort(),
            );
      return existingJson === incomingJson;
    }

    const existingText = (existing.valueText ?? "").trim().toLowerCase();
    const incomingText = (incoming.valueText ?? "").trim().toLowerCase();

    if (type === "number") {
      return Number(existingText) === Number(incomingText);
    }

    return existingText === incomingText;
  }
}
```

Note: The `isCanonicallyEqual` method normalizes values before comparison. For strings/enums: trim + lowercase. For numbers: parse to number. For JSON: stable stringify with sorted keys. This prevents fake supersessions from formatting differences.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-temporal-fact-store`
Expected: PASS

- [ ] **Step 7: Export from db barrel**

Add to `packages/db/src/index.ts`:

```typescript
export { PrismaTemporalFactStore } from "./stores/prisma-temporal-fact-store.js";
```

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/src/stores/prisma-temporal-fact-store.ts packages/db/src/stores/__tests__/prisma-temporal-fact-store.test.ts packages/db/src/index.ts
git commit -m "$(cat <<'EOF'
feat(db): add TemporalFact Prisma model and store

Transactional supersession: one active fact per entity+subject.
Canonical equality prevents fake supersessions from formatting
differences. Supports getActiveFacts, getFactHistory, getFactsAsOf.
EOF
)"
```

---

### Task 3: Subject Registry

**Files:**

- Create: `packages/core/src/memory/subject-registry.ts`
- Create: `packages/core/src/memory/__tests__/subject-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/memory/__tests__/subject-registry.test.ts
import { describe, it, expect } from "vitest";
import {
  validateSubject,
  getSubjectDefinition,
  listSubjectsForEntityType,
} from "../subject-registry.js";

describe("SubjectRegistry", () => {
  it("validates a known subject for the correct entity type", () => {
    expect(validateSubject("bidding-strategy", "campaign")).toBe(true);
  });

  it("rejects a known subject for the wrong entity type", () => {
    expect(validateSubject("bidding-strategy", "contact")).toBe(false);
  });

  it("rejects an unknown subject", () => {
    expect(validateSubject("nonexistent-subject", "campaign")).toBe(false);
  });

  it("returns definition for a known subject", () => {
    const def = getSubjectDefinition("bidding-strategy");
    expect(def).not.toBeNull();
    expect(def!.valueType).toBe("enum_value");
    expect(def!.entityTypes).toContain("campaign");
  });

  it("returns null for unknown subject", () => {
    expect(getSubjectDefinition("nonexistent")).toBeNull();
  });

  it("lists subjects for campaign entity type", () => {
    const subjects = listSubjectsForEntityType("campaign");
    expect(subjects.length).toBeGreaterThan(0);
    expect(subjects.some((s) => s.subject === "bidding-strategy")).toBe(true);
    expect(subjects.some((s) => s.subject === "daily-budget")).toBe(true);
  });

  it("lists subjects for contact entity type", () => {
    const subjects = listSubjectsForEntityType("contact");
    expect(subjects.some((s) => s.subject === "lead-stage")).toBe(true);
    expect(subjects.some((s) => s.subject === "preferred-channel")).toBe(true);
  });

  it("lists subjects for account entity type", () => {
    const subjects = listSubjectsForEntityType("account");
    expect(subjects.some((s) => s.subject === "vertical")).toBe(true);
    expect(subjects.some((s) => s.subject === "optimization-goal")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run subject-registry`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/memory/subject-registry.ts
import type { FactEntityType, FactValueType } from "@switchboard/schemas";

export interface SubjectDefinition {
  subject: string;
  entityTypes: FactEntityType[];
  valueType: FactValueType;
  description: string;
}

const SUBJECT_REGISTRY: SubjectDefinition[] = [
  // Ads domain
  {
    subject: "bidding-strategy",
    entityTypes: ["campaign"],
    valueType: "enum_value",
    description: "Campaign bidding strategy (manual, CBO, ASC)",
  },
  {
    subject: "daily-budget",
    entityTypes: ["campaign"],
    valueType: "json",
    description: "Daily budget with amount and currency",
  },
  {
    subject: "objective",
    entityTypes: ["campaign", "account"],
    valueType: "enum_value",
    description: "Campaign or account optimization objective",
  },
  // CRM / sales domain
  {
    subject: "lead-stage",
    entityTypes: ["contact"],
    valueType: "enum_value",
    description: "Current stage in sales pipeline",
  },
  {
    subject: "preferred-channel",
    entityTypes: ["contact"],
    valueType: "enum_value",
    description: "Contact's preferred communication channel",
  },
  {
    subject: "booking-status",
    entityTypes: ["contact"],
    valueType: "enum_value",
    description: "Whether contact has a booked appointment",
  },
  // Retention domain
  {
    subject: "subscription-status",
    entityTypes: ["contact", "account"],
    valueType: "enum_value",
    description: "Active, paused, churned",
  },
  {
    subject: "churn-risk",
    entityTypes: ["account"],
    valueType: "enum_value",
    description: "Low, medium, high churn risk assessment",
  },
  // General
  {
    subject: "vertical",
    entityTypes: ["account"],
    valueType: "string",
    description: "Business vertical / industry",
  },
  {
    subject: "optimization-goal",
    entityTypes: ["account"],
    valueType: "enum_value",
    description: "Primary optimization goal (ROAS, CPA, volume)",
  },
];

const subjectMap = new Map(SUBJECT_REGISTRY.map((d) => [d.subject, d]));

export function validateSubject(subject: string, entityType: FactEntityType): boolean {
  const def = subjectMap.get(subject);
  if (!def) return false;
  return def.entityTypes.includes(entityType);
}

export function getSubjectDefinition(subject: string): SubjectDefinition | null {
  return subjectMap.get(subject) ?? null;
}

export function listSubjectsForEntityType(entityType: FactEntityType): SubjectDefinition[] {
  return SUBJECT_REGISTRY.filter((d) => d.entityTypes.includes(entityType));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run subject-registry`
Expected: PASS

- [ ] **Step 5: Export from memory barrel**

Add to `packages/core/src/memory/index.ts`:

```typescript
export {
  validateSubject,
  getSubjectDefinition,
  listSubjectsForEntityType,
} from "./subject-registry.js";
export type { SubjectDefinition } from "./subject-registry.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/memory/subject-registry.ts packages/core/src/memory/__tests__/subject-registry.test.ts packages/core/src/memory/index.ts
git commit -m "$(cat <<'EOF'
feat(core): add subject registry for temporal facts

Central registry of valid subjects per domain (ads, CRM, retention,
general). Validates subject+entityType pairs. Prevents drift across
agents. Static TypeScript constant for v1.
EOF
)"
```

---

### Task 4: TemporalFactService (Business Logic)

**Files:**

- Create: `packages/core/src/memory/temporal-fact-service.ts`
- Create: `packages/core/src/memory/__tests__/temporal-fact-service.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/memory/__tests__/temporal-fact-service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TemporalFactService } from "../temporal-fact-service.js";

describe("TemporalFactService", () => {
  const mockStore = {
    recordFact: vi.fn().mockResolvedValue({ id: "fact_1" }),
    retractFact: vi.fn().mockResolvedValue(undefined),
    getActiveFacts: vi.fn().mockResolvedValue([]),
    getActiveFactBySubject: vi.fn().mockResolvedValue(null),
    getFactHistory: vi.fn().mockResolvedValue([]),
    getFactsAsOf: vi.fn().mockResolvedValue([]),
  };

  let service: TemporalFactService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TemporalFactService(mockStore as never);
  });

  describe("recordFact", () => {
    it("records a fact with a valid subject", async () => {
      await service.recordFact({
        organizationId: "org_1",
        deploymentId: "dep_1",
        entityType: "campaign",
        entityId: "camp_123",
        category: "configuration",
        subject: "bidding-strategy",
        valueText: "ASC",
        valueType: "enum_value",
        source: "system",
        confidence: 1.0,
      });

      expect(mockStore.recordFact).toHaveBeenCalledOnce();
    });

    it("rejects an unknown subject", async () => {
      await expect(
        service.recordFact({
          organizationId: "org_1",
          deploymentId: "dep_1",
          entityType: "campaign",
          entityId: "camp_123",
          category: "configuration",
          subject: "unknown-subject",
          valueText: "something",
          valueType: "string",
          source: "system",
          confidence: 1.0,
        }),
      ).rejects.toThrow("Unknown subject");
    });

    it("rejects a subject used with the wrong entity type", async () => {
      await expect(
        service.recordFact({
          organizationId: "org_1",
          deploymentId: "dep_1",
          entityType: "contact",
          entityId: "cont_1",
          category: "configuration",
          subject: "bidding-strategy",
          valueText: "ASC",
          valueType: "enum_value",
          source: "system",
          confidence: 1.0,
        }),
      ).rejects.toThrow("not valid for entity type");
    });

    it("validates input via RecordFactInputSchema", async () => {
      await expect(
        service.recordFact({
          organizationId: "org_1",
          deploymentId: "dep_1",
          entityType: "campaign",
          entityId: "camp_123",
          category: "configuration",
          subject: "BadCamelCase",
          valueText: "ASC",
          valueType: "enum_value",
          source: "system",
          confidence: 1.0,
        }),
      ).rejects.toThrow();
    });
  });

  describe("read operations", () => {
    it("delegates getActiveFacts to store", async () => {
      await service.getActiveFacts("org_1", "dep_1", "campaign", "camp_123");
      expect(mockStore.getActiveFacts).toHaveBeenCalledWith(
        "org_1",
        "dep_1",
        "campaign",
        "camp_123",
      );
    });

    it("delegates getFactHistory to store", async () => {
      await service.getFactHistory("org_1", "dep_1", "campaign", "camp_123", "bidding-strategy");
      expect(mockStore.getFactHistory).toHaveBeenCalledWith(
        "org_1",
        "dep_1",
        "campaign",
        "camp_123",
        "bidding-strategy",
      );
    });

    it("delegates getFactsAsOf to store", async () => {
      const asOf = new Date("2026-03-15");
      await service.getFactsAsOf("org_1", "dep_1", "campaign", "camp_123", asOf);
      expect(mockStore.getFactsAsOf).toHaveBeenCalledWith(
        "org_1",
        "dep_1",
        "campaign",
        "camp_123",
        asOf,
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run temporal-fact-service`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/memory/temporal-fact-service.ts
import { RecordFactInputSchema } from "@switchboard/schemas";
import type { FactEntityType, RecordFactInput, TemporalFact } from "@switchboard/schemas";
import { validateSubject } from "./subject-registry.js";

export interface TemporalFactStore {
  recordFact(params: RecordFactInput): Promise<TemporalFact>;
  retractFact(id: string, orgId: string, reason: string): Promise<void>;
  getActiveFacts(
    orgId: string,
    deploymentId: string,
    entityType: string,
    entityId: string,
  ): Promise<TemporalFact[]>;
  getActiveFactBySubject(
    orgId: string,
    deploymentId: string,
    entityType: string,
    entityId: string,
    subject: string,
  ): Promise<TemporalFact | null>;
  getFactHistory(
    orgId: string,
    deploymentId: string,
    entityType: string,
    entityId: string,
    subject: string,
  ): Promise<TemporalFact[]>;
  getFactsAsOf(
    orgId: string,
    deploymentId: string,
    entityType: string,
    entityId: string,
    asOf: Date,
  ): Promise<TemporalFact[]>;
}

export class TemporalFactService {
  constructor(private readonly store: TemporalFactStore) {}

  async recordFact(input: RecordFactInput): Promise<TemporalFact> {
    const parsed = RecordFactInputSchema.parse(input);

    if (!validateSubject(parsed.subject, parsed.entityType as FactEntityType)) {
      const msg = validateSubject(parsed.subject, parsed.entityType as FactEntityType)
        ? ""
        : !require("./subject-registry.js").getSubjectDefinition(parsed.subject)
          ? `Unknown subject: "${parsed.subject}"`
          : `Subject "${parsed.subject}" is not valid for entity type "${parsed.entityType}"`;
      throw new Error(msg);
    }

    return this.store.recordFact(parsed);
  }

  async retractFact(id: string, orgId: string, reason: string): Promise<void> {
    return this.store.retractFact(id, orgId, reason);
  }

  async getActiveFacts(
    orgId: string,
    deploymentId: string,
    entityType: string,
    entityId: string,
  ): Promise<TemporalFact[]> {
    return this.store.getActiveFacts(orgId, deploymentId, entityType, entityId);
  }

  async getActiveFactBySubject(
    orgId: string,
    deploymentId: string,
    entityType: string,
    entityId: string,
    subject: string,
  ): Promise<TemporalFact | null> {
    return this.store.getActiveFactBySubject(orgId, deploymentId, entityType, entityId, subject);
  }

  async getFactHistory(
    orgId: string,
    deploymentId: string,
    entityType: string,
    entityId: string,
    subject: string,
  ): Promise<TemporalFact[]> {
    return this.store.getFactHistory(orgId, deploymentId, entityType, entityId, subject);
  }

  async getFactsAsOf(
    orgId: string,
    deploymentId: string,
    entityType: string,
    entityId: string,
    asOf: Date,
  ): Promise<TemporalFact[]> {
    return this.store.getFactsAsOf(orgId, deploymentId, entityType, entityId, asOf);
  }
}
```

Note: The `recordFact` method has a bug in the error message logic above — fix it during implementation. The correct approach:

```typescript
import { getSubjectDefinition } from "./subject-registry.js";

async recordFact(input: RecordFactInput): Promise<TemporalFact> {
  const parsed = RecordFactInputSchema.parse(input);
  const def = getSubjectDefinition(parsed.subject);
  if (!def) {
    throw new Error(`Unknown subject: "${parsed.subject}"`);
  }
  if (!def.entityTypes.includes(parsed.entityType as FactEntityType)) {
    throw new Error(
      `Subject "${parsed.subject}" is not valid for entity type "${parsed.entityType}"`,
    );
  }
  return this.store.recordFact(parsed);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run temporal-fact-service`
Expected: PASS

- [ ] **Step 5: Export from memory barrel**

Add to `packages/core/src/memory/index.ts`:

```typescript
export { TemporalFactService } from "./temporal-fact-service.js";
export type { TemporalFactStore } from "./temporal-fact-service.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/memory/temporal-fact-service.ts packages/core/src/memory/__tests__/temporal-fact-service.test.ts packages/core/src/memory/index.ts
git commit -m "$(cat <<'EOF'
feat(core): add TemporalFactService with subject validation

Business logic layer for temporal facts. Validates subjects against
the registry, delegates to store for persistence. Read operations
pass through directly.
EOF
)"
```

---

### Task 5: Context Builder — Entity Facts Retrieval

**Files:**

- Modify: `packages/agents/src/memory/context-builder.ts`
- Create: `packages/agents/src/memory/__tests__/context-builder-entity-facts.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/agents/src/memory/__tests__/context-builder-entity-facts.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContextBuilder } from "../context-builder.js";

describe("ContextBuilder — entity facts", () => {
  const mockDeps = {
    knowledgeRetriever: { retrieve: vi.fn().mockResolvedValue([]) },
    deploymentMemoryStore: {
      listHighConfidence: vi.fn().mockResolvedValue([]),
    },
    interactionSummaryStore: {
      listByDeployment: vi.fn().mockResolvedValue([]),
    },
    temporalFactStore: {
      getActiveFacts: vi.fn().mockResolvedValue([]),
    },
  };

  let builder: ContextBuilder;

  beforeEach(() => {
    vi.clearAllMocks();
    builder = new ContextBuilder(mockDeps as never);
  });

  it("includes entity facts when entityRefs are provided", async () => {
    mockDeps.temporalFactStore.getActiveFacts.mockResolvedValue([
      {
        subject: "bidding-strategy",
        valueText: "ASC",
        valueType: "enum_value",
        category: "configuration",
        source: "api",
        validFrom: new Date("2026-03-28"),
      },
    ]);

    const result = await builder.build({
      organizationId: "org_1",
      agentId: "agent_1",
      deploymentId: "dep_1",
      query: "check campaign",
      entityRefs: [{ entityType: "campaign", entityId: "camp_123" }],
    });

    expect(result.entityFacts).toHaveLength(1);
    expect(result.entityFacts![0]!.entityType).toBe("campaign");
    expect(result.entityFacts![0]!.facts).toHaveLength(1);
    expect(mockDeps.temporalFactStore.getActiveFacts).toHaveBeenCalledWith(
      "org_1",
      "dep_1",
      "campaign",
      "camp_123",
    );
  });

  it("limits to max 3 entities", async () => {
    const result = await builder.build({
      organizationId: "org_1",
      agentId: "agent_1",
      deploymentId: "dep_1",
      query: "check all",
      entityRefs: [
        { entityType: "campaign", entityId: "camp_1" },
        { entityType: "campaign", entityId: "camp_2" },
        { entityType: "campaign", entityId: "camp_3" },
        { entityType: "campaign", entityId: "camp_4" },
      ],
    });

    expect(mockDeps.temporalFactStore.getActiveFacts).toHaveBeenCalledTimes(3);
  });

  it("limits to max 15 facts per entity", async () => {
    const manyFacts = Array.from({ length: 20 }, (_, i) => ({
      subject: `subject-${i}`,
      valueText: `value-${i}`,
      valueType: "string",
      category: "configuration",
      source: "system",
      validFrom: new Date(),
    }));
    mockDeps.temporalFactStore.getActiveFacts.mockResolvedValue(manyFacts);

    const result = await builder.build({
      organizationId: "org_1",
      agentId: "agent_1",
      deploymentId: "dep_1",
      query: "check",
      entityRefs: [{ entityType: "campaign", entityId: "camp_1" }],
    });

    expect(result.entityFacts![0]!.facts.length).toBeLessThanOrEqual(15);
  });

  it("returns empty entityFacts when no entityRefs provided", async () => {
    const result = await builder.build({
      organizationId: "org_1",
      agentId: "agent_1",
      deploymentId: "dep_1",
      query: "general question",
    });

    expect(result.entityFacts).toBeUndefined();
    expect(mockDeps.temporalFactStore.getActiveFacts).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/agents test -- --run context-builder-entity-facts`
Expected: FAIL — `entityRefs` not in `ContextBuildInput`, `entityFacts` not in `BuiltContext`

- [ ] **Step 3: Modify the context builder**

Read `packages/agents/src/memory/context-builder.ts` fully. Then make these changes:

**Add to types:**

```typescript
// Add to ContextBuildInput
interface ContextBuildInput {
  // ... existing fields
  entityRefs?: Array<{ entityType: string; entityId: string }>;
}

// Add entity fact types
interface ContextEntityFact {
  subject: string;
  valueText: string | null;
  valueJson: unknown;
  valueType: string;
  category: string;
  source: string;
  validFrom: Date;
}

interface ContextEntityBlock {
  entityType: string;
  entityId: string;
  facts: ContextEntityFact[];
}

// Add to BuiltContext
interface BuiltContext {
  // ... existing fields
  entityFacts?: ContextEntityBlock[];
}
```

**Add to ContextBuilderDeps:**

```typescript
interface ContextBuilderTemporalFactStore {
  getActiveFacts(
    orgId: string,
    deploymentId: string,
    entityType: string,
    entityId: string,
  ): Promise<
    Array<{
      subject: string;
      valueText: string | null;
      valueJson: unknown;
      valueType: string;
      category: string;
      source: string;
      validFrom: Date;
    }>
  >;
}

interface ContextBuilderDeps {
  // ... existing fields
  temporalFactStore?: ContextBuilderTemporalFactStore;
}
```

**Add constants:**

```typescript
const MAX_ENTITIES_PER_CONTEXT = 3;
const MAX_FACTS_PER_ENTITY = 15;
const ENTITY_FACTS_TOKEN_BUDGET = 500;
```

**Add entity facts retrieval to `build()` method** (after the existing parallel fetch, before the return):

```typescript
// Entity facts retrieval
let entityFacts: ContextEntityBlock[] | undefined;
if (input.entityRefs?.length && this.deps.temporalFactStore) {
  const refs = input.entityRefs.slice(0, MAX_ENTITIES_PER_CONTEXT);
  const blocks = await Promise.all(
    refs.map(async (ref) => {
      const facts = await this.deps.temporalFactStore!.getActiveFacts(
        input.organizationId,
        input.deploymentId,
        ref.entityType,
        ref.entityId,
      );
      return {
        entityType: ref.entityType,
        entityId: ref.entityId,
        facts: facts.slice(0, MAX_FACTS_PER_ENTITY).map((f) => ({
          subject: f.subject,
          valueText: f.valueText,
          valueJson: f.valueJson,
          valueType: f.valueType,
          category: f.category,
          source: f.source,
          validFrom: f.validFrom,
        })),
      };
    }),
  );
  entityFacts = blocks.filter((b) => b.facts.length > 0);
}

// Add to return value
return {
  retrievedChunks: packedChunks,
  learnedFacts: packedFacts,
  recentSummaries: packedSummaries,
  entityFacts,
  totalTokenEstimate: usedTokens,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/agents test -- --run context-builder-entity-facts`
Expected: PASS

- [ ] **Step 5: Run all agents tests for regressions**

Run: `npx pnpm@9.15.4 --filter @switchboard/agents test -- --run`
Expected: PASS — existing tests unaffected since `temporalFactStore` is optional and `entityRefs` defaults to undefined

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/memory/context-builder.ts packages/agents/src/memory/__tests__/context-builder-entity-facts.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): add entity facts to context builder

Fourth retrieval path alongside RAG, DeploymentMemory, and summaries.
Entity facts are loaded for explicitly referenced entities with
guards: max 3 entities, max 15 facts per entity, 500-token budget.
Optional — no impact when entityRefs not provided.
EOF
)"
```

---

### Task 6: API Routes for Entity Facts

**Files:**

- Create: `apps/api/src/routes/entity-facts.ts`
- Create: `apps/api/src/routes/__tests__/entity-facts.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/routes/__tests__/entity-facts.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { entityFactRoutes } from "../entity-facts.js";

describe("Entity Facts Routes", () => {
  let app: FastifyInstance;
  const mockService = {
    recordFact: vi.fn().mockResolvedValue({
      id: "fact_1",
      subject: "bidding-strategy",
      valueText: "ASC",
      status: "active",
    }),
    retractFact: vi.fn().mockResolvedValue(undefined),
    getActiveFacts: vi.fn().mockResolvedValue([]),
    getFactHistory: vi.fn().mockResolvedValue([]),
    getFactsAsOf: vi.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.decorate("temporalFactService", mockService);
    await app.register(entityFactRoutes, { prefix: "/api/orgs" });
    await app.ready();
  });

  it("GET /:orgId/entities/:entityType/:entityId/facts returns active facts", async () => {
    mockService.getActiveFacts.mockResolvedValue([
      { id: "fact_1", subject: "bidding-strategy", valueText: "ASC" },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/orgs/org_1/entities/campaign/camp_123/facts",
      headers: { "x-deployment-id": "dep_1" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].subject).toBe("bidding-strategy");
  });

  it("POST /:orgId/entities/:entityType/:entityId/facts records a fact", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/orgs/org_1/entities/campaign/camp_123/facts",
      headers: { "x-deployment-id": "dep_1" },
      payload: {
        category: "configuration",
        subject: "bidding-strategy",
        valueText: "ASC",
        valueType: "enum_value",
        source: "human",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(mockService.recordFact).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        entityType: "campaign",
        entityId: "camp_123",
        subject: "bidding-strategy",
      }),
    );
  });

  it("DELETE /:orgId/entities/:entityType/:entityId/facts/:factId retracts a fact", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/orgs/org_1/entities/campaign/camp_123/facts/fact_1",
      payload: { reason: "human_correction" },
    });

    expect(res.statusCode).toBe(204);
    expect(mockService.retractFact).toHaveBeenCalledWith("fact_1", "org_1", "human_correction");
  });

  it("GET with ?subject= returns fact history", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/orgs/org_1/entities/campaign/camp_123/facts?subject=bidding-strategy&history=true",
      headers: { "x-deployment-id": "dep_1" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockService.getFactHistory).toHaveBeenCalledWith(
      "org_1",
      "dep_1",
      "campaign",
      "camp_123",
      "bidding-strategy",
    );
  });

  it("rejects invalid entity type", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/orgs/org_1/entities/order/ord_123/facts",
      headers: { "x-deployment-id": "dep_1" },
    });

    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run entity-facts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the route implementation**

```typescript
// apps/api/src/routes/entity-facts.ts
import type { FastifyPluginAsync } from "fastify";
import {
  FactEntityTypeSchema,
  RecordFactInputSchema,
  RetractFactInputSchema,
} from "@switchboard/schemas";

const VALID_ENTITY_TYPES = new Set(["account", "campaign", "contact"]);

export const entityFactRoutes: FastifyPluginAsync = async (app) => {
  // GET /:orgId/entities/:entityType/:entityId/facts
  app.get("/:orgId/entities/:entityType/:entityId/facts", async (request, reply) => {
    const { orgId, entityType, entityId } = request.params as {
      orgId: string;
      entityType: string;
      entityId: string;
    };
    const { subject, history, asOf } = request.query as {
      subject?: string;
      history?: string;
      asOf?: string;
    };

    if (!VALID_ENTITY_TYPES.has(entityType)) {
      return reply.code(400).send({ error: `Invalid entity type: ${entityType}` });
    }

    const deploymentId = request.headers["x-deployment-id"] as string;
    if (!deploymentId) {
      return reply.code(400).send({ error: "x-deployment-id header required" });
    }

    if (subject && history === "true") {
      const facts = await app.temporalFactService.getFactHistory(
        orgId,
        deploymentId,
        entityType,
        entityId,
        subject,
      );
      return reply.send(facts);
    }

    if (asOf) {
      const facts = await app.temporalFactService.getFactsAsOf(
        orgId,
        deploymentId,
        entityType,
        entityId,
        new Date(asOf),
      );
      return reply.send(facts);
    }

    const facts = await app.temporalFactService.getActiveFacts(
      orgId,
      deploymentId,
      entityType,
      entityId,
    );
    return reply.send(facts);
  });

  // POST /:orgId/entities/:entityType/:entityId/facts
  app.post("/:orgId/entities/:entityType/:entityId/facts", async (request, reply) => {
    const { orgId, entityType, entityId } = request.params as {
      orgId: string;
      entityType: string;
      entityId: string;
    };

    if (!VALID_ENTITY_TYPES.has(entityType)) {
      return reply.code(400).send({ error: `Invalid entity type: ${entityType}` });
    }

    const deploymentId = request.headers["x-deployment-id"] as string;
    if (!deploymentId) {
      return reply.code(400).send({ error: "x-deployment-id header required" });
    }

    const body = request.body as Record<string, unknown>;

    try {
      const result = await app.temporalFactService.recordFact({
        organizationId: orgId,
        deploymentId,
        entityType: entityType as "account" | "campaign" | "contact",
        entityId,
        ...body,
      });
      return reply.code(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });

  // DELETE /:orgId/entities/:entityType/:entityId/facts/:factId
  app.delete("/:orgId/entities/:entityType/:entityId/facts/:factId", async (request, reply) => {
    const { orgId, factId } = request.params as { orgId: string; factId: string };
    const body = request.body as { reason?: string } | undefined;
    const reason = body?.reason ?? "manual_retraction";

    try {
      await app.temporalFactService.retractFact(factId, orgId, reason);
      return reply.code(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });
};
```

- [ ] **Step 4: Add Fastify type declaration and register routes**

Add to the `FastifyInstance` interface in `apps/api/src/app.ts`:

```typescript
temporalFactService: import("@switchboard/core").TemporalFactService;
```

Register the routes in `app.ts` alongside other route registrations:

```typescript
import { entityFactRoutes } from "./routes/entity-facts.js";
// ... in the route registration section:
await app.register(entityFactRoutes, { prefix: "/api/orgs" });
```

Wire the service in `app.ts` after bootstrap:

```typescript
import { TemporalFactService } from "@switchboard/core";
import { PrismaTemporalFactStore } from "@switchboard/db";

// After prisma is available:
const temporalFactStore = prismaClient ? new PrismaTemporalFactStore(prismaClient) : null;
const temporalFactService = temporalFactStore ? new TemporalFactService(temporalFactStore) : null;
if (temporalFactService) {
  app.decorate("temporalFactService", temporalFactService);
}
```

Note: Read `app.ts` to find the exact location for route registration and service wiring. Follow existing patterns.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run entity-facts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/entity-facts.ts apps/api/src/routes/__tests__/entity-facts.test.ts apps/api/src/app.ts
git commit -m "$(cat <<'EOF'
feat(api): add entity facts CRUD routes

GET/POST/DELETE for temporal facts scoped to org + entity.
Supports history queries (?subject=X&history=true) and
point-in-time queries (?asOf=date). Validates entity types.
EOF
)"
```

---

### Task 7: Gateway Bridge — Pass Entity Refs to Context Builder

**Files:**

- Modify: `apps/chat/src/gateway/gateway-bridge.ts`

- [ ] **Step 1: Read current gateway-bridge.ts**

Read the file to understand how context builder is called and where entity refs are available.

- [ ] **Step 2: Modify to pass entity refs**

Find where `contextBuilder.build()` is called. Add `entityRefs` from conversation state if available. The conversation thread's `agentContext` JSON field may contain entity references.

```typescript
// Where contextBuilder.build() is called, add:
const entityRefs = info.thread?.agentContext?.entityRefs ?? [];

const ctx = await contextBuilder.build({
  organizationId: info.deployment.organizationId,
  agentId: info.deployment.listingId,
  deploymentId: info.deployment.id,
  query: message.text,
  contactId: message.visitor?.name,
  entityRefs,
});
```

Also wire `PrismaTemporalFactStore` into the context builder deps:

```typescript
const contextBuilder = new ContextBuilder({
  knowledgeRetriever: {
    retrieve: async (query, options) => knowledgeRetriever.retrieve(query, options),
  },
  deploymentMemoryStore: new PrismaDeploymentMemoryStore(prisma),
  interactionSummaryStore: new PrismaInteractionSummaryStore(prisma),
  temporalFactStore: new PrismaTemporalFactStore(prisma),
});
```

Note: Read the actual file to find the exact code structure. The above is the conceptual change — adapt to match existing patterns.

- [ ] **Step 3: Verify typecheck passes**

Run: `npx pnpm@9.15.4 typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/chat/src/gateway/gateway-bridge.ts
git commit -m "$(cat <<'EOF'
feat(chat): pass entity refs to context builder for temporal facts

Wires PrismaTemporalFactStore into context builder deps and passes
entity refs from conversation state to enable entity fact retrieval
during chat message handling.
EOF
)"
```

---

### Task 8: Full Test Suite Verification

- [ ] **Step 1: Run all tests**

Run: `npx pnpm@9.15.4 test`

- [ ] **Step 2: Run typecheck**

Run: `npx pnpm@9.15.4 typecheck`

- [ ] **Step 3: Run lint**

Run: `npx pnpm@9.15.4 lint`

- [ ] **Step 4: Fix any issues and commit**

If any migration-related failures are found, fix and commit.
