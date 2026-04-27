# Marketplace Data Models — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Prisma models, Zod schemas, DB stores, and API routes needed for the AI agent marketplace — agent listings, deployments, tasks, and trust scores.

**Architecture:** We add 4 new Prisma models (`AgentListing`, `AgentDeployment`, `AgentTask`, `TrustScoreRecord`) with corresponding Zod schemas and Prisma stores. We clean up `OrganizationConfig` to remove dead SMB fields. We add 4 new API route groups for marketplace CRUD. The existing `CompetenceTracker` is extended with a `TrustScoreEngine` wrapper that maps scores to autonomy levels and price tiers. Existing `AgentRoster` is kept for now (dashboard uses it) — `AgentDeployment` is the marketplace-native model; `AgentRoster` entries are auto-created from deployments in a future task.

**Tech Stack:** Prisma 6, Zod, Fastify, TypeScript ESM

---

## File Structure

### New files to create:

| File                                                  | Responsibility                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/schemas/src/marketplace.ts`                 | Zod schemas + types: AgentListing, AgentDeployment, AgentTask, TrustScoreRecord, enums |
| `packages/db/src/stores/prisma-listing-store.ts`      | CRUD for AgentListing model                                                            |
| `packages/db/src/stores/prisma-deployment-store.ts`   | CRUD for AgentDeployment model                                                         |
| `packages/db/src/stores/prisma-agent-task-store.ts`   | CRUD for AgentTask model                                                               |
| `packages/db/src/stores/prisma-trust-score-store.ts`  | CRUD for TrustScoreRecord model                                                        |
| `packages/core/src/marketplace/trust-score-engine.ts` | TrustScoreEngine — wraps CompetenceTracker, adds autonomy/pricing                      |
| `packages/core/src/marketplace/index.ts`              | Barrel export                                                                          |
| `apps/api/src/routes/marketplace.ts`                  | Marketplace API routes (listings, deployments, tasks, trust)                           |

### New test files:

| File                                                                 | Tests               |
| -------------------------------------------------------------------- | ------------------- |
| `packages/schemas/src/__tests__/marketplace.test.ts`                 | Schema validation   |
| `packages/db/src/stores/__tests__/prisma-listing-store.test.ts`      | Store unit tests    |
| `packages/db/src/stores/__tests__/prisma-deployment-store.test.ts`   | Store unit tests    |
| `packages/db/src/stores/__tests__/prisma-agent-task-store.test.ts`   | Store unit tests    |
| `packages/db/src/stores/__tests__/prisma-trust-score-store.test.ts`  | Store unit tests    |
| `packages/core/src/marketplace/__tests__/trust-score-engine.test.ts` | Engine unit tests   |
| `apps/api/src/routes/__tests__/marketplace.test.ts`                  | Route handler tests |

### Files to modify:

| File                               | Change                                               |
| ---------------------------------- | ---------------------------------------------------- |
| `packages/db/prisma/schema.prisma` | Add 4 models, clean up OrganizationConfig, add enums |
| `packages/schemas/src/index.ts`    | Add `export * from "./marketplace.js"`               |
| `packages/db/src/index.ts`         | Export new stores                                    |
| `packages/core/src/index.ts`       | Export marketplace module                            |
| `apps/api/src/bootstrap/routes.ts` | Register marketplace routes                          |

---

### Task 1: Add Zod schemas for marketplace types

**Files:**

- Create: `packages/schemas/src/marketplace.ts`
- Create: `packages/schemas/src/__tests__/marketplace.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/schemas/src/__tests__/marketplace.test.ts
import { describe, it, expect } from "vitest";
import {
  AgentListingSchema,
  AgentDeploymentSchema,
  AgentTaskSchema,
  TrustScoreRecordSchema,
  AgentType,
  AgentListingStatus,
  AutonomyLevel,
  PriceTier,
  AgentTaskStatus,
  DeploymentStatus,
} from "../marketplace.js";

describe("Marketplace schemas", () => {
  describe("AgentListingSchema", () => {
    it("validates a complete listing", () => {
      const listing = {
        id: "lst_abc",
        name: "Email Outreach Agent",
        slug: "email-outreach",
        description: "Sends personalized cold emails",
        type: "switchboard_native" as const,
        status: "listed" as const,
        taskCategories: ["email", "outreach"],
        trustScore: 72.5,
        autonomyLevel: "guided" as const,
        priceTier: "pro" as const,
        priceMonthly: 299,
        webhookUrl: "https://agent.example.com/hook",
        webhookSecret: "whsec_xxx",
        vettingNotes: "Passed review 2026-04-01",
        sourceUrl: "https://github.com/example/agent",
        metadata: { version: "1.2.0" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = AgentListingSchema.safeParse(listing);
      expect(result.success).toBe(true);
    });

    it("applies defaults for optional fields", () => {
      const minimal = {
        id: "lst_abc",
        name: "Test Agent",
        slug: "test-agent",
        description: "A test",
        type: "switchboard_native" as const,
        status: "pending_review" as const,
        taskCategories: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = AgentListingSchema.parse(minimal);
      expect(result.trustScore).toBe(50);
      expect(result.autonomyLevel).toBe("supervised");
      expect(result.priceTier).toBe("free");
      expect(result.priceMonthly).toBe(0);
    });
  });

  describe("AgentDeploymentSchema", () => {
    it("validates a deployment", () => {
      const deployment = {
        id: "dep_abc",
        organizationId: "org_123",
        listingId: "lst_abc",
        status: "active" as const,
        inputConfig: { targetAudience: "SaaS founders" },
        governanceSettings: { maxSpendPerDay: 100 },
        outputDestination: { type: "webhook", url: "https://example.com" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = AgentDeploymentSchema.safeParse(deployment);
      expect(result.success).toBe(true);
    });
  });

  describe("AgentTaskSchema", () => {
    it("validates a task", () => {
      const task = {
        id: "tsk_abc",
        deploymentId: "dep_abc",
        organizationId: "org_123",
        listingId: "lst_abc",
        category: "email",
        status: "pending" as const,
        input: { subject: "Hello" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = AgentTaskSchema.safeParse(task);
      expect(result.success).toBe(true);
    });
  });

  describe("TrustScoreRecordSchema", () => {
    it("validates a trust score record", () => {
      const record = {
        id: "tsr_abc",
        listingId: "lst_abc",
        taskCategory: "email",
        score: 72.5,
        totalApprovals: 45,
        totalRejections: 3,
        consecutiveApprovals: 12,
        lastActivityAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = TrustScoreRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });
  });

  describe("Enum values", () => {
    it("exports correct enum values", () => {
      expect(AgentType.options).toEqual(["open_source", "third_party", "switchboard_native"]);
      expect(AutonomyLevel.options).toEqual(["supervised", "guided", "autonomous"]);
      expect(PriceTier.options).toEqual(["free", "basic", "pro", "elite"]);
      expect(AgentTaskStatus.options).toEqual([
        "pending",
        "running",
        "completed",
        "awaiting_review",
        "approved",
        "rejected",
        "failed",
        "cancelled",
      ]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run src/__tests__/marketplace.test.ts
```

Expected: FAIL — module `../marketplace.js` not found

- [ ] **Step 3: Write the schema file**

```typescript
// packages/schemas/src/marketplace.ts
import { z } from "zod";

// ── Enums ──

export const AgentType = z.enum(["open_source", "third_party", "switchboard_native"]);
export type AgentType = z.infer<typeof AgentType>;

export const AgentListingStatus = z.enum(["pending_review", "listed", "suspended", "deprecated"]);
export type AgentListingStatus = z.infer<typeof AgentListingStatus>;

export const AutonomyLevel = z.enum(["supervised", "guided", "autonomous"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

export const PriceTier = z.enum(["free", "basic", "pro", "elite"]);
export type PriceTier = z.infer<typeof PriceTier>;

export const AgentTaskStatus = z.enum([
  "pending",
  "running",
  "completed",
  "awaiting_review",
  "approved",
  "rejected",
  "failed",
  "cancelled",
]);
export type AgentTaskStatus = z.infer<typeof AgentTaskStatus>;

export const DeploymentStatus = z.enum(["provisioning", "active", "paused", "deactivated"]);
export type DeploymentStatus = z.infer<typeof DeploymentStatus>;

// ── Agent Listing (global marketplace catalog) ──

export const AgentListingSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  type: AgentType,
  status: AgentListingStatus,
  taskCategories: z.array(z.string()),
  trustScore: z.number().min(0).max(100).default(50),
  autonomyLevel: AutonomyLevel.default("supervised"),
  priceTier: PriceTier.default("free"),
  priceMonthly: z.number().nonnegative().default(0),
  webhookUrl: z.string().url().nullable().optional(),
  webhookSecret: z.string().nullable().optional(),
  vettingNotes: z.string().nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AgentListing = z.infer<typeof AgentListingSchema>;

// ── Agent Deployment (founder's instance of a listing) ──

export const AgentDeploymentSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  listingId: z.string(),
  status: DeploymentStatus.default("provisioning"),
  inputConfig: z.record(z.unknown()).default({}),
  governanceSettings: z.record(z.unknown()).default({}),
  outputDestination: z.record(z.unknown()).nullable().optional(),
  connectionIds: z.array(z.string()).default([]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AgentDeployment = z.infer<typeof AgentDeploymentSchema>;

// ── Agent Task (unit of work) ──

export const AgentTaskSchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  organizationId: z.string(),
  listingId: z.string(),
  category: z.string(),
  status: AgentTaskStatus.default("pending"),
  input: z.record(z.unknown()).default({}),
  output: z.record(z.unknown()).nullable().optional(),
  acceptanceCriteria: z.string().nullable().optional(),
  reviewResult: z.string().nullable().optional(),
  reviewedBy: z.string().nullable().optional(),
  reviewedAt: z.coerce.date().nullable().optional(),
  completedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AgentTask = z.infer<typeof AgentTaskSchema>;

// ── Trust Score Record (per-listing per-category) ──

export const TrustScoreRecordSchema = z.object({
  id: z.string(),
  listingId: z.string(),
  taskCategory: z.string(),
  score: z.number().min(0).max(100),
  totalApprovals: z.number().int().nonnegative().default(0),
  totalRejections: z.number().int().nonnegative().default(0),
  consecutiveApprovals: z.number().int().nonnegative().default(0),
  lastActivityAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type TrustScoreRecord = z.infer<typeof TrustScoreRecordSchema>;
```

- [ ] **Step 4: Add barrel export**

In `packages/schemas/src/index.ts`, add at the end:

```typescript
// Marketplace types (Agent Listings, Deployments, Tasks, Trust Scores)
export * from "./marketplace.js";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run src/__tests__/marketplace.test.ts
```

Expected: PASS

- [ ] **Step 6: Run full schemas typecheck**

```bash
npx pnpm@9.15.4 --filter @switchboard/schemas typecheck
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat: add Zod schemas for marketplace types

New schemas: AgentListing, AgentDeployment, AgentTask, TrustScoreRecord
New enums: AgentType, AgentListingStatus, AutonomyLevel, PriceTier,
AgentTaskStatus, DeploymentStatus
EOF
)"
```

---

### Task 2: Add Prisma models and clean up OrganizationConfig

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Read the schema to find insertion point**

Read `packages/db/prisma/schema.prisma`. New models go after the existing `AgentRegistration` model (around line 694).

- [ ] **Step 2: Clean up OrganizationConfig — remove SMB fields**

In `packages/db/prisma/schema.prisma`, find the `OrganizationConfig` model (line 323) and remove these fields:

```
  tier                 String   @default("smb") // smb, enterprise
  smbOwnerId           String?
  smbPerActionLimit    Float?
  smbDailyLimit        Float?
  smbAllowedActions    String[] @default([])
  smbBlockedActions    String[] @default([])
  selectedCartridgeId  String?
  skinId               String?
```

These are remnants of the old SMB product direction.

- [ ] **Step 3: Add marketplace models to schema**

Append after `AgentRegistration` model:

```prisma
// ── Marketplace: Agent Listings (global catalog) ──

model AgentListing {
  id              String   @id @default(cuid())
  name            String
  slug            String   @unique
  description     String
  type            String   @default("switchboard_native") // open_source, third_party, switchboard_native
  status          String   @default("pending_review") // pending_review, listed, suspended, deprecated
  taskCategories  String[] @default([])
  trustScore      Float    @default(50)
  autonomyLevel   String   @default("supervised") // supervised, guided, autonomous
  priceTier       String   @default("free") // free, basic, pro, elite
  priceMonthly    Float    @default(0)
  webhookUrl      String?
  webhookSecret   String?
  vettingNotes    String?
  sourceUrl       String?
  metadata        Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  deployments      AgentDeployment[]
  tasks            AgentTask[]
  trustScoreRecords TrustScoreRecord[]

  @@index([status])
  @@index([type])
}

// ── Marketplace: Agent Deployments (founder's instance) ──

model AgentDeployment {
  id                  String   @id @default(cuid())
  organizationId      String
  listingId           String
  status              String   @default("provisioning") // provisioning, active, paused, deactivated
  inputConfig         Json     @default("{}")
  governanceSettings  Json     @default("{}")
  outputDestination   Json?
  connectionIds       String[] @default([])
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  listing AgentListing @relation(fields: [listingId], references: [id])
  tasks   AgentTask[]

  @@unique([organizationId, listingId])
  @@index([organizationId])
  @@index([status])
}

// ── Marketplace: Agent Tasks (units of work) ──

model AgentTask {
  id                 String    @id @default(cuid())
  deploymentId       String
  organizationId     String
  listingId          String
  category           String
  status             String    @default("pending") // pending, running, completed, awaiting_review, approved, rejected, failed, cancelled
  input              Json      @default("{}")
  output             Json?
  acceptanceCriteria String?
  reviewResult       String?
  reviewedBy         String?
  reviewedAt         DateTime?
  completedAt        DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  deployment AgentDeployment @relation(fields: [deploymentId], references: [id])
  listing    AgentListing    @relation(fields: [listingId], references: [id])

  @@index([deploymentId])
  @@index([organizationId])
  @@index([status])
  @@index([listingId, category])
}

// ── Marketplace: Trust Score Records (per-listing per-category) ──

model TrustScoreRecord {
  id                    String   @id @default(cuid())
  listingId             String
  taskCategory          String
  score                 Float    @default(50)
  totalApprovals        Int      @default(0)
  totalRejections       Int      @default(0)
  consecutiveApprovals  Int      @default(0)
  lastActivityAt        DateTime @default(now())
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  listing AgentListing @relation(fields: [listingId], references: [id])

  @@unique([listingId, taskCategory])
  @@index([listingId])
}
```

- [ ] **Step 4: Generate Prisma client**

```bash
npx pnpm@9.15.4 db:generate
```

Expected: Prisma Client generated successfully

- [ ] **Step 5: Run typecheck**

```bash
npx pnpm@9.15.4 --filter @switchboard/db typecheck
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat: add marketplace Prisma models, clean up OrganizationConfig

New models: AgentListing, AgentDeployment, AgentTask, TrustScoreRecord
Removed dead SMB fields from OrganizationConfig (tier, smbOwnerId,
smbPerActionLimit, smbDailyLimit, smbAllowedActions, smbBlockedActions,
selectedCartridgeId, skinId).
EOF
)"
```

---

### Task 3: Create Prisma stores for marketplace models

**Files:**

- Create: `packages/db/src/stores/prisma-listing-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-listing-store.test.ts`
- Create: `packages/db/src/stores/prisma-deployment-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-deployment-store.test.ts`
- Create: `packages/db/src/stores/prisma-agent-task-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-agent-task-store.test.ts`
- Create: `packages/db/src/stores/prisma-trust-score-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-trust-score-store.test.ts`
- Modify: `packages/db/src/index.ts`

This is a large task but all four stores follow identical patterns. Each store implements:

- `create(input)` → record
- `findById(id)` → record | null
- `list(filters)` → record[]
- `update(id, data)` → record
- `delete(id)` → void

Plus model-specific methods (e.g., `findBySlug` for listings, `findByOrg` for deployments).

- [ ] **Step 1: Write tests for PrismaListingStore**

Follow the existing test pattern (see `packages/db/src/stores/__tests__/prisma-contact-store.test.ts` for style). Tests should mock the Prisma client and verify the store calls the correct Prisma methods with correct arguments.

```typescript
// packages/db/src/stores/__tests__/prisma-listing-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaListingStore } from "../prisma-listing-store.js";

function createMockPrisma() {
  return {
    agentListing: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  } as unknown as Parameters<
    typeof PrismaListingStore extends new (p: infer P) => unknown ? P : never
  >[0];
}

describe("PrismaListingStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaListingStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaListingStore(prisma as never);
  });

  it("creates a listing", async () => {
    const input = {
      name: "Email Agent",
      slug: "email-agent",
      description: "Sends emails",
      type: "switchboard_native" as const,
      taskCategories: ["email"],
    };
    prisma.agentListing.create.mockResolvedValue({
      id: "lst_1",
      ...input,
      status: "pending_review",
    });
    const result = await store.create(input);
    expect(prisma.agentListing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Email Agent", slug: "email-agent" }),
    });
    expect(result.id).toBe("lst_1");
  });

  it("finds by slug", async () => {
    prisma.agentListing.findUnique.mockResolvedValue({ id: "lst_1", slug: "email-agent" });
    const result = await store.findBySlug("email-agent");
    expect(prisma.agentListing.findUnique).toHaveBeenCalledWith({ where: { slug: "email-agent" } });
    expect(result?.id).toBe("lst_1");
  });

  it("lists with status filter", async () => {
    prisma.agentListing.findMany.mockResolvedValue([]);
    await store.list({ status: "listed" });
    expect(prisma.agentListing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "listed" },
      }),
    );
  });
});
```

- [ ] **Step 2: Write PrismaListingStore**

```typescript
// packages/db/src/stores/prisma-listing-store.ts
import type { PrismaDbClient } from "../prisma-db.js";
import type { AgentListing, AgentListingStatus, AgentType } from "@switchboard/schemas";

interface CreateListingInput {
  name: string;
  slug: string;
  description: string;
  type: AgentType;
  taskCategories: string[];
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface ListingFilters {
  status?: AgentListingStatus;
  type?: AgentType;
  limit?: number;
  offset?: number;
}

export class PrismaListingStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateListingInput): Promise<AgentListing> {
    return this.prisma.agentListing.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        type: input.type,
        taskCategories: input.taskCategories,
        webhookUrl: input.webhookUrl ?? null,
        webhookSecret: input.webhookSecret ?? null,
        sourceUrl: input.sourceUrl ?? null,
        metadata: input.metadata ? (input.metadata as object) : undefined,
      },
    }) as unknown as AgentListing;
  }

  async findById(id: string): Promise<AgentListing | null> {
    return this.prisma.agentListing.findUnique({ where: { id } }) as unknown as AgentListing | null;
  }

  async findBySlug(slug: string): Promise<AgentListing | null> {
    return this.prisma.agentListing.findUnique({
      where: { slug },
    }) as unknown as AgentListing | null;
  }

  async list(filters?: ListingFilters): Promise<AgentListing[]> {
    return this.prisma.agentListing.findMany({
      where: {
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.type ? { type: filters.type } : {}),
      },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
      orderBy: { createdAt: "desc" },
    }) as unknown as AgentListing[];
  }

  async update(
    id: string,
    data: Partial<Omit<AgentListing, "id" | "createdAt">>,
  ): Promise<AgentListing> {
    return this.prisma.agentListing.update({
      where: { id },
      data: data as never,
    }) as unknown as AgentListing;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.agentListing.delete({ where: { id } });
  }
}
```

- [ ] **Step 3: Write PrismaDeploymentStore (same pattern)**

```typescript
// packages/db/src/stores/prisma-deployment-store.ts
import type { PrismaDbClient } from "../prisma-db.js";
import type { AgentDeployment, DeploymentStatus } from "@switchboard/schemas";

interface CreateDeploymentInput {
  organizationId: string;
  listingId: string;
  inputConfig?: Record<string, unknown>;
  governanceSettings?: Record<string, unknown>;
  outputDestination?: Record<string, unknown> | null;
  connectionIds?: string[];
}

export class PrismaDeploymentStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateDeploymentInput): Promise<AgentDeployment> {
    return this.prisma.agentDeployment.create({
      data: {
        organizationId: input.organizationId,
        listingId: input.listingId,
        inputConfig: input.inputConfig ? (input.inputConfig as object) : undefined,
        governanceSettings: input.governanceSettings
          ? (input.governanceSettings as object)
          : undefined,
        outputDestination: input.outputDestination
          ? (input.outputDestination as object)
          : undefined,
        connectionIds: input.connectionIds ?? [],
      },
    }) as unknown as AgentDeployment;
  }

  async findById(id: string): Promise<AgentDeployment | null> {
    return this.prisma.agentDeployment.findUnique({
      where: { id },
    }) as unknown as AgentDeployment | null;
  }

  async listByOrg(organizationId: string, status?: DeploymentStatus): Promise<AgentDeployment[]> {
    return this.prisma.agentDeployment.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
    }) as unknown as AgentDeployment[];
  }

  async updateStatus(id: string, status: DeploymentStatus): Promise<AgentDeployment> {
    return this.prisma.agentDeployment.update({
      where: { id },
      data: { status },
    }) as unknown as AgentDeployment;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.agentDeployment.delete({ where: { id } });
  }
}
```

- [ ] **Step 4: Write PrismaAgentTaskStore**

```typescript
// packages/db/src/stores/prisma-agent-task-store.ts
import type { PrismaDbClient } from "../prisma-db.js";
import type { AgentTask, AgentTaskStatus } from "@switchboard/schemas";

interface CreateTaskInput {
  deploymentId: string;
  organizationId: string;
  listingId: string;
  category: string;
  input?: Record<string, unknown>;
  acceptanceCriteria?: string | null;
}

interface TaskFilters {
  status?: AgentTaskStatus;
  category?: string;
  limit?: number;
  offset?: number;
}

export class PrismaAgentTaskStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateTaskInput): Promise<AgentTask> {
    return this.prisma.agentTask.create({
      data: {
        deploymentId: input.deploymentId,
        organizationId: input.organizationId,
        listingId: input.listingId,
        category: input.category,
        input: input.input ? (input.input as object) : undefined,
        acceptanceCriteria: input.acceptanceCriteria ?? null,
      },
    }) as unknown as AgentTask;
  }

  async findById(id: string): Promise<AgentTask | null> {
    return this.prisma.agentTask.findUnique({ where: { id } }) as unknown as AgentTask | null;
  }

  async listByDeployment(deploymentId: string, filters?: TaskFilters): Promise<AgentTask[]> {
    return this.prisma.agentTask.findMany({
      where: {
        deploymentId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.category ? { category: filters.category } : {}),
      },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
      orderBy: { createdAt: "desc" },
    }) as unknown as AgentTask[];
  }

  async listByOrg(organizationId: string, filters?: TaskFilters): Promise<AgentTask[]> {
    return this.prisma.agentTask.findMany({
      where: {
        organizationId,
        ...(filters?.status ? { status: filters.status } : {}),
      },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
      orderBy: { createdAt: "desc" },
    }) as unknown as AgentTask[];
  }

  async updateStatus(id: string, status: AgentTaskStatus): Promise<AgentTask> {
    return this.prisma.agentTask.update({
      where: { id },
      data: { status },
    }) as unknown as AgentTask;
  }

  async submitOutput(id: string, output: Record<string, unknown>): Promise<AgentTask> {
    return this.prisma.agentTask.update({
      where: { id },
      data: { output: output as object, status: "awaiting_review", completedAt: new Date() },
    }) as unknown as AgentTask;
  }

  async review(
    id: string,
    result: "approved" | "rejected",
    reviewedBy: string,
    reviewResult?: string,
  ): Promise<AgentTask> {
    return this.prisma.agentTask.update({
      where: { id },
      data: {
        status: result,
        reviewedBy,
        reviewedAt: new Date(),
        reviewResult: reviewResult ?? null,
      },
    }) as unknown as AgentTask;
  }
}
```

- [ ] **Step 5: Write PrismaTrustScoreStore**

```typescript
// packages/db/src/stores/prisma-trust-score-store.ts
import type { PrismaDbClient } from "../prisma-db.js";
import type { TrustScoreRecord } from "@switchboard/schemas";

export class PrismaTrustScoreStore {
  constructor(private prisma: PrismaDbClient) {}

  async getOrCreate(listingId: string, taskCategory: string): Promise<TrustScoreRecord> {
    const existing = await this.prisma.trustScoreRecord.findUnique({
      where: { listingId_taskCategory: { listingId, taskCategory } },
    });
    if (existing) return existing as unknown as TrustScoreRecord;

    return this.prisma.trustScoreRecord.create({
      data: { listingId, taskCategory, score: 50 },
    }) as unknown as TrustScoreRecord;
  }

  async update(
    id: string,
    data: Partial<
      Pick<
        TrustScoreRecord,
        "score" | "totalApprovals" | "totalRejections" | "consecutiveApprovals" | "lastActivityAt"
      >
    >,
  ): Promise<TrustScoreRecord> {
    return this.prisma.trustScoreRecord.update({
      where: { id },
      data: data as never,
    }) as unknown as TrustScoreRecord;
  }

  async listByListing(listingId: string): Promise<TrustScoreRecord[]> {
    return this.prisma.trustScoreRecord.findMany({
      where: { listingId },
      orderBy: { score: "desc" },
    }) as unknown as TrustScoreRecord[];
  }

  async getAggregateScore(listingId: string): Promise<number> {
    const result = await this.prisma.trustScoreRecord.aggregate({
      where: { listingId },
      _avg: { score: true },
    });
    return result._avg.score ?? 50;
  }
}
```

- [ ] **Step 6: Write tests for remaining stores**

Create test files for `prisma-deployment-store.test.ts`, `prisma-agent-task-store.test.ts`, and `prisma-trust-score-store.test.ts` following the same mock pattern as the listing store test (Step 1).

- [ ] **Step 7: Add exports to db barrel**

In `packages/db/src/index.ts`, add:

```typescript
export { PrismaListingStore } from "./stores/prisma-listing-store.js";
export { PrismaDeploymentStore } from "./stores/prisma-deployment-store.js";
export { PrismaAgentTaskStore } from "./stores/prisma-agent-task-store.js";
export { PrismaTrustScoreStore } from "./stores/prisma-trust-score-store.js";
```

- [ ] **Step 8: Run tests and typecheck**

```bash
npx pnpm@9.15.4 --filter @switchboard/db test && npx pnpm@9.15.4 --filter @switchboard/db typecheck
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat: add Prisma stores for marketplace models

New stores: PrismaListingStore, PrismaDeploymentStore,
PrismaAgentTaskStore, PrismaTrustScoreStore.
Each with CRUD methods and model-specific queries.
EOF
)"
```

---

### Task 4: Create TrustScoreEngine in core

**Files:**

- Create: `packages/core/src/marketplace/trust-score-engine.ts`
- Create: `packages/core/src/marketplace/index.ts`
- Create: `packages/core/src/marketplace/__tests__/trust-score-engine.test.ts`
- Modify: `packages/core/src/index.ts`

The TrustScoreEngine wraps the existing CompetenceTracker pattern but is purpose-built for the marketplace. It maps trust scores to autonomy levels and price tiers.

- [ ] **Step 1: Write the test file**

```typescript
// packages/core/src/marketplace/__tests__/trust-score-engine.test.ts
import { describe, it, expect } from "vitest";
import {
  TrustScoreEngine,
  DEFAULT_TRUST_THRESHOLDS,
  scoreToAutonomyLevel,
  scoreToPriceTier,
} from "../trust-score-engine.js";

describe("scoreToAutonomyLevel", () => {
  it("returns supervised for score < 40", () => {
    expect(scoreToAutonomyLevel(0)).toBe("supervised");
    expect(scoreToAutonomyLevel(39)).toBe("supervised");
  });

  it("returns guided for score 40-69", () => {
    expect(scoreToAutonomyLevel(40)).toBe("guided");
    expect(scoreToAutonomyLevel(69)).toBe("guided");
  });

  it("returns autonomous for score >= 70", () => {
    expect(scoreToAutonomyLevel(70)).toBe("autonomous");
    expect(scoreToAutonomyLevel(100)).toBe("autonomous");
  });
});

describe("scoreToPriceTier", () => {
  it("returns free for score < 30", () => {
    expect(scoreToPriceTier(0)).toBe("free");
    expect(scoreToPriceTier(29)).toBe("free");
  });

  it("returns basic for score 30-54", () => {
    expect(scoreToPriceTier(30)).toBe("basic");
    expect(scoreToPriceTier(54)).toBe("basic");
  });

  it("returns pro for score 55-79", () => {
    expect(scoreToPriceTier(55)).toBe("pro");
    expect(scoreToPriceTier(79)).toBe("pro");
  });

  it("returns elite for score >= 80", () => {
    expect(scoreToPriceTier(80)).toBe("elite");
    expect(scoreToPriceTier(100)).toBe("elite");
  });
});

describe("TrustScoreEngine", () => {
  function createMockStore() {
    const records = new Map<
      string,
      {
        id: string;
        listingId: string;
        taskCategory: string;
        score: number;
        totalApprovals: number;
        totalRejections: number;
        consecutiveApprovals: number;
        lastActivityAt: Date;
        createdAt: Date;
        updatedAt: Date;
      }
    >();
    return {
      getOrCreate: async (listingId: string, taskCategory: string) => {
        const key = `${listingId}:${taskCategory}`;
        if (!records.has(key)) {
          const now = new Date();
          records.set(key, {
            id: key,
            listingId,
            taskCategory,
            score: 50,
            totalApprovals: 0,
            totalRejections: 0,
            consecutiveApprovals: 0,
            lastActivityAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }
        return records.get(key)!;
      },
      update: async (id: string, data: Record<string, unknown>) => {
        const record = records.get(id);
        if (!record) throw new Error("not found");
        Object.assign(record, data);
        return record;
      },
      listByListing: async (listingId: string) =>
        [...records.values()].filter((r) => r.listingId === listingId),
      getAggregateScore: async (listingId: string) => {
        const listing = [...records.values()].filter((r) => r.listingId === listingId);
        if (listing.length === 0) return 50;
        return listing.reduce((sum, r) => sum + r.score, 0) / listing.length;
      },
    };
  }

  it("records an approval and increments score", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);

    await engine.recordApproval("lst_1", "email");
    const record = await store.getOrCreate("lst_1", "email");

    expect(record.score).toBeGreaterThan(50);
    expect(record.totalApprovals).toBe(1);
    expect(record.consecutiveApprovals).toBe(1);
  });

  it("records a rejection and decrements score", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);

    await engine.recordRejection("lst_1", "email");
    const record = await store.getOrCreate("lst_1", "email");

    expect(record.score).toBeLessThan(50);
    expect(record.totalRejections).toBe(1);
    expect(record.consecutiveApprovals).toBe(0);
  });

  it("gets autonomy level for a listing+category", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);

    const level = await engine.getAutonomyLevel("lst_1", "email");
    expect(level).toBe("guided"); // default score 50 → guided
  });

  it("gets price tier for a listing", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);

    const tier = await engine.getPriceTier("lst_1");
    expect(tier).toBe("basic"); // default aggregate score 50 → basic
  });

  it("caps score at 100", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);

    // Record many approvals to push score above 100
    for (let i = 0; i < 50; i++) {
      await engine.recordApproval("lst_1", "email");
    }
    const record = await store.getOrCreate("lst_1", "email");
    expect(record.score).toBeLessThanOrEqual(100);
  });

  it("floors score at 0", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);

    // Record many rejections to push score below 0
    for (let i = 0; i < 20; i++) {
      await engine.recordRejection("lst_1", "email");
    }
    const record = await store.getOrCreate("lst_1", "email");
    expect(record.score).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/marketplace/__tests__/trust-score-engine.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Write TrustScoreEngine**

```typescript
// packages/core/src/marketplace/trust-score-engine.ts
import type { AutonomyLevel, PriceTier, TrustScoreRecord } from "@switchboard/schemas";

export interface TrustScoreStore {
  getOrCreate(listingId: string, taskCategory: string): Promise<TrustScoreRecord>;
  update(
    id: string,
    data: Partial<
      Pick<
        TrustScoreRecord,
        "score" | "totalApprovals" | "totalRejections" | "consecutiveApprovals" | "lastActivityAt"
      >
    >,
  ): Promise<TrustScoreRecord>;
  listByListing(listingId: string): Promise<TrustScoreRecord[]>;
  getAggregateScore(listingId: string): Promise<number>;
}

export interface TrustThresholds {
  approvalPoints: number;
  rejectionPoints: number;
  streakBonusPerStep: number;
  streakBonusCap: number;
  scoreCeiling: number;
  scoreFloor: number;
  supervisedCeiling: number;
  guidedCeiling: number;
  autonomousFloor: number;
  freeCeiling: number;
  basicCeiling: number;
  proCeiling: number;
  eliteFloor: number;
}

export const DEFAULT_TRUST_THRESHOLDS: TrustThresholds = {
  approvalPoints: 3,
  rejectionPoints: 10,
  streakBonusPerStep: 0.5,
  streakBonusCap: 5,
  scoreCeiling: 100,
  scoreFloor: 0,
  supervisedCeiling: 39,
  guidedCeiling: 69,
  autonomousFloor: 70,
  freeCeiling: 29,
  basicCeiling: 54,
  proCeiling: 79,
  eliteFloor: 80,
};

export function scoreToAutonomyLevel(
  score: number,
  thresholds: TrustThresholds = DEFAULT_TRUST_THRESHOLDS,
): AutonomyLevel {
  if (score >= thresholds.autonomousFloor) return "autonomous";
  if (score > thresholds.supervisedCeiling) return "guided";
  return "supervised";
}

export function scoreToPriceTier(
  score: number,
  thresholds: TrustThresholds = DEFAULT_TRUST_THRESHOLDS,
): PriceTier {
  if (score >= thresholds.eliteFloor) return "elite";
  if (score > thresholds.basicCeiling) return "pro";
  if (score > thresholds.freeCeiling) return "basic";
  return "free";
}

export class TrustScoreEngine {
  constructor(
    private store: TrustScoreStore,
    private thresholds: TrustThresholds = DEFAULT_TRUST_THRESHOLDS,
  ) {}

  async recordApproval(listingId: string, taskCategory: string): Promise<TrustScoreRecord> {
    const record = await this.store.getOrCreate(listingId, taskCategory);
    const streak = record.consecutiveApprovals + 1;
    const bonus = Math.min(
      streak * this.thresholds.streakBonusPerStep,
      this.thresholds.streakBonusCap,
    );
    const newScore = Math.min(
      record.score + this.thresholds.approvalPoints + bonus,
      this.thresholds.scoreCeiling,
    );

    return this.store.update(record.id, {
      score: newScore,
      totalApprovals: record.totalApprovals + 1,
      consecutiveApprovals: streak,
      lastActivityAt: new Date(),
    });
  }

  async recordRejection(listingId: string, taskCategory: string): Promise<TrustScoreRecord> {
    const record = await this.store.getOrCreate(listingId, taskCategory);
    const newScore = Math.max(
      record.score - this.thresholds.rejectionPoints,
      this.thresholds.scoreFloor,
    );

    return this.store.update(record.id, {
      score: newScore,
      totalRejections: record.totalRejections + 1,
      consecutiveApprovals: 0,
      lastActivityAt: new Date(),
    });
  }

  async getAutonomyLevel(listingId: string, taskCategory: string): Promise<AutonomyLevel> {
    const record = await this.store.getOrCreate(listingId, taskCategory);
    return scoreToAutonomyLevel(record.score, this.thresholds);
  }

  async getPriceTier(listingId: string): Promise<PriceTier> {
    const avgScore = await this.store.getAggregateScore(listingId);
    return scoreToPriceTier(avgScore, this.thresholds);
  }

  async getScoreBreakdown(listingId: string): Promise<
    {
      category: string;
      score: number;
      autonomyLevel: AutonomyLevel;
      approvals: number;
      rejections: number;
    }[]
  > {
    const records = await this.store.listByListing(listingId);
    return records.map((r) => ({
      category: r.taskCategory,
      score: r.score,
      autonomyLevel: scoreToAutonomyLevel(r.score, this.thresholds),
      approvals: r.totalApprovals,
      rejections: r.totalRejections,
    }));
  }
}
```

- [ ] **Step 4: Write barrel export**

```typescript
// packages/core/src/marketplace/index.ts
export {
  TrustScoreEngine,
  scoreToAutonomyLevel,
  scoreToPriceTier,
  DEFAULT_TRUST_THRESHOLDS,
} from "./trust-score-engine.js";
export type { TrustScoreStore, TrustThresholds } from "./trust-score-engine.js";
```

- [ ] **Step 5: Add to core barrel**

In `packages/core/src/index.ts`, add at the end:

```typescript
// Marketplace (Trust Score Engine)
export * from "./marketplace/index.js";
```

- [ ] **Step 6: Run tests**

```bash
npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/marketplace/__tests__/trust-score-engine.test.ts
```

Expected: PASS

- [ ] **Step 7: Run full core typecheck and tests**

```bash
npx pnpm@9.15.4 --filter @switchboard/core typecheck && npx pnpm@9.15.4 --filter @switchboard/core test
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat: add TrustScoreEngine to core

Maps trust scores to autonomy levels (supervised/guided/autonomous)
and price tiers (free/basic/pro/elite). Records approval/rejection
outcomes with streak bonuses. Wraps a TrustScoreStore interface
implemented by PrismaTrustScoreStore.
EOF
)"
```

---

### Task 5: Add marketplace API routes

**Files:**

- Create: `apps/api/src/routes/marketplace.ts`
- Create: `apps/api/src/routes/__tests__/marketplace.test.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1: Write the route file**

```typescript
// apps/api/src/routes/marketplace.ts
import type { FastifyInstance } from "fastify";
import {
  PrismaListingStore,
  PrismaDeploymentStore,
  PrismaAgentTaskStore,
  PrismaTrustScoreStore,
} from "@switchboard/db";
import { TrustScoreEngine } from "@switchboard/core";

export async function marketplaceRoutes(app: FastifyInstance): Promise<void> {
  // ── Agent Listings ──

  app.get("/listings", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database not available" });
    const store = new PrismaListingStore(app.prisma);
    const { status, type, limit, offset } = request.query as Record<string, string | undefined>;
    const listings = await store.list({
      status: status as never,
      type: type as never,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return reply.send({ listings });
  });

  app.get("/listings/:id", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database not available" });
    const store = new PrismaListingStore(app.prisma);
    const { id } = request.params as { id: string };
    const listing = await store.findById(id);
    if (!listing) return reply.code(404).send({ error: "Listing not found" });
    return reply.send({ listing });
  });

  app.post("/listings", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database not available" });
    const store = new PrismaListingStore(app.prisma);
    const listing = await store.create(request.body as never);
    return reply.code(201).send({ listing });
  });

  // ── Trust Scores ──

  app.get("/listings/:id/trust", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database not available" });
    const trustStore = new PrismaTrustScoreStore(app.prisma);
    const engine = new TrustScoreEngine(trustStore);
    const { id } = request.params as { id: string };
    const breakdown = await engine.getScoreBreakdown(id);
    const priceTier = await engine.getPriceTier(id);
    return reply.send({ listingId: id, priceTier, breakdown });
  });

  // ── Deployments ──

  app.post("/listings/:id/deploy", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database not available" });
    const store = new PrismaDeploymentStore(app.prisma);
    const { id } = request.params as { id: string };
    const orgId = request.organizationIdFromAuth;
    if (!orgId) return reply.code(401).send({ error: "Organization required" });
    const deployment = await store.create({
      organizationId: orgId,
      listingId: id,
      ...(request.body as Record<string, unknown>),
    });
    return reply.code(201).send({ deployment });
  });

  app.get("/deployments", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database not available" });
    const store = new PrismaDeploymentStore(app.prisma);
    const orgId = request.organizationIdFromAuth;
    if (!orgId) return reply.code(401).send({ error: "Organization required" });
    const deployments = await store.listByOrg(orgId);
    return reply.send({ deployments });
  });

  // ── Tasks ──

  app.post("/tasks", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database not available" });
    const store = new PrismaAgentTaskStore(app.prisma);
    const task = await store.create(request.body as never);
    return reply.code(201).send({ task });
  });

  app.get("/tasks", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database not available" });
    const store = new PrismaAgentTaskStore(app.prisma);
    const orgId = request.organizationIdFromAuth;
    if (!orgId) return reply.code(401).send({ error: "Organization required" });
    const { status } = request.query as Record<string, string | undefined>;
    const tasks = await store.listByOrg(orgId, { status: status as never });
    return reply.send({ tasks });
  });

  app.post("/tasks/:id/submit", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database not available" });
    const store = new PrismaAgentTaskStore(app.prisma);
    const { id } = request.params as { id: string };
    const { output } = request.body as { output: Record<string, unknown> };
    const task = await store.submitOutput(id, output);
    return reply.send({ task });
  });

  app.post("/tasks/:id/review", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database not available" });
    const taskStore = new PrismaAgentTaskStore(app.prisma);
    const trustStore = new PrismaTrustScoreStore(app.prisma);
    const engine = new TrustScoreEngine(trustStore);

    const { id } = request.params as { id: string };
    const { result, reviewResult } = request.body as {
      result: "approved" | "rejected";
      reviewResult?: string;
    };
    const reviewedBy = request.principalIdFromAuth ?? "unknown";

    const task = await taskStore.findById(id);
    if (!task) return reply.code(404).send({ error: "Task not found" });

    const updated = await taskStore.review(id, result, reviewedBy, reviewResult);

    // Update trust score based on review outcome
    if (result === "approved") {
      await engine.recordApproval(task.listingId, task.category);
    } else {
      await engine.recordRejection(task.listingId, task.category);
    }

    return reply.send({ task: updated });
  });
}
```

- [ ] **Step 2: Register the route**

In `apps/api/src/bootstrap/routes.ts`, add import:

```typescript
import { marketplaceRoutes } from "../routes/marketplace.js";
```

Add registration:

```typescript
await app.register(marketplaceRoutes, { prefix: "/api/marketplace" });
```

- [ ] **Step 3: Write route tests**

Create `apps/api/src/routes/__tests__/marketplace.test.ts` with basic handler tests (mock Prisma, verify status codes and response shapes). Follow the pattern used in other route tests in the same directory.

- [ ] **Step 4: Run typecheck**

```bash
npx pnpm@9.15.4 --filter @switchboard/api typecheck
```

Note: pre-existing errors in `operator.ts` may appear. Our new code should not introduce new errors.

- [ ] **Step 5: Run tests**

```bash
npx pnpm@9.15.4 --filter @switchboard/api test -- --run src/routes/__tests__/marketplace.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat: add marketplace API routes

New route group at /api/marketplace with endpoints:
- GET/POST /listings — browse and create agent listings
- GET /listings/:id — listing detail
- GET /listings/:id/trust — trust score breakdown
- POST /listings/:id/deploy — one-click deploy
- GET /deployments — active deployments for org
- GET/POST /tasks — task management
- POST /tasks/:id/submit — submit agent output
- POST /tasks/:id/review — approve/reject with trust score update
EOF
)"
```

---

### Task 6: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

```bash
npx pnpm@9.15.4 typecheck
```

- [ ] **Step 2: Run full test suite**

```bash
npx pnpm@9.15.4 test
```

Expected: all existing + new tests pass

- [ ] **Step 3: Verify schema is consistent**

```bash
npx pnpm@9.15.4 db:generate
```

Expected: Prisma Client generated without errors

- [ ] **Step 4: Run core tests specifically**

```bash
npx pnpm@9.15.4 --filter @switchboard/core test
```

Expected: all governance + marketplace tests pass

---

## Summary

| What                    | Count                                                          |
| ----------------------- | -------------------------------------------------------------- |
| New Prisma models       | 4 (AgentListing, AgentDeployment, AgentTask, TrustScoreRecord) |
| New Zod schemas         | 4 + 6 enums                                                    |
| New Prisma stores       | 4                                                              |
| New core module         | 1 (TrustScoreEngine)                                           |
| New API route group     | 1 (/api/marketplace with 8 endpoints)                          |
| Schema fields removed   | 8 (SMB remnants from OrganizationConfig)                       |
| New test files          | 7                                                              |
| Existing files modified | 5 (barrel exports + route registration)                        |
