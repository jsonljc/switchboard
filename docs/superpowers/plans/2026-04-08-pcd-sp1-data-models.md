# PCD SP1: Data Models + Marketplace Listing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `CreativeJob` Prisma model, Zod schemas, database store, seed the PCD marketplace listing, and create API routes for creative job CRUD.

**Architecture:** Follows the existing marketplace pattern — Zod schemas in `packages/schemas`, Prisma model in `packages/db/prisma/schema.prisma`, store class in `packages/db/src/stores/`, API routes in `apps/api/src/routes/`, seed data in `packages/db/prisma/seed-marketplace.ts`. The `CreativeJob` model links to `AgentTask` via a 1:1 relation (same pattern as `AgentPersona` linking to an org).

**Tech Stack:** Prisma, Zod, Fastify, TypeScript

---

### Task 1: Add Zod Schemas for CreativeJob + Stage Outputs

**Files:**

- Create: `packages/schemas/src/creative-job.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Create the creative-job schema file**

```typescript
// packages/schemas/src/creative-job.ts
import { z } from "zod";

// ── Enums ──

export const CreativeJobStage = z.enum([
  "trends",
  "hooks",
  "scripts",
  "storyboard",
  "production",
  "complete",
]);
export type CreativeJobStage = z.infer<typeof CreativeJobStage>;

export const CreativePlatform = z.enum(["meta", "youtube", "tiktok"]);
export type CreativePlatform = z.infer<typeof CreativePlatform>;

export const AwarenessLevel = z.enum([
  "unaware",
  "problem_aware",
  "solution_aware",
  "product_aware",
  "most_aware",
]);
export type AwarenessLevel = z.infer<typeof AwarenessLevel>;

export const HookType = z.enum(["pattern_interrupt", "question", "bold_statement"]);
export type HookType = z.infer<typeof HookType>;

// ── Stage Outputs ──

export const TrendAnalysisOutput = z.object({
  angles: z.array(
    z.object({
      theme: z.string(),
      motivator: z.string(),
      platformFit: z.string(),
      rationale: z.string(),
    }),
  ),
  audienceInsights: z.object({
    awarenessLevel: AwarenessLevel,
    topDrivers: z.array(z.string()),
    objections: z.array(z.string()),
  }),
  trendSignals: z.array(
    z.object({
      platform: z.string(),
      trend: z.string(),
      relevance: z.string(),
    }),
  ),
});
export type TrendAnalysisOutput = z.infer<typeof TrendAnalysisOutput>;

export const HookGeneratorOutput = z.object({
  hooks: z.array(
    z.object({
      angleRef: z.string(),
      text: z.string(),
      type: HookType,
      platformScore: z.number(),
      rationale: z.string(),
    }),
  ),
  topCombos: z.array(
    z.object({
      angleRef: z.string(),
      hookRef: z.string(),
      score: z.number(),
    }),
  ),
});
export type HookGeneratorOutput = z.infer<typeof HookGeneratorOutput>;

export const ScriptWriterOutput = z.object({
  scripts: z.array(
    z.object({
      hookRef: z.string(),
      fullScript: z.string(),
      timing: z.array(
        z.object({
          section: z.string(),
          startSec: z.number(),
          endSec: z.number(),
          content: z.string(),
        }),
      ),
      format: z.string(),
      platform: z.string(),
      productionNotes: z.string(),
    }),
  ),
});
export type ScriptWriterOutput = z.infer<typeof ScriptWriterOutput>;

export const StoryboardOutput = z.object({
  storyboards: z.array(
    z.object({
      scriptRef: z.string(),
      scenes: z.array(
        z.object({
          sceneNumber: z.number(),
          description: z.string(),
          visualDirection: z.string(),
          duration: z.number(),
          textOverlay: z.string().nullable(),
          referenceImageUrl: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type StoryboardOutput = z.infer<typeof StoryboardOutput>;

export const VideoProducerOutput = z.object({
  videos: z.array(
    z.object({
      storyboardRef: z.string(),
      videoUrl: z.string(),
      thumbnailUrl: z.string(),
      format: z.string(),
      duration: z.number(),
      platform: z.string(),
    }),
  ),
  staticFallbacks: z.array(
    z.object({
      imageUrl: z.string(),
      platform: z.string(),
    }),
  ),
});
export type VideoProducerOutput = z.infer<typeof VideoProducerOutput>;

export const StageOutputs = z.object({
  trends: TrendAnalysisOutput.optional(),
  hooks: HookGeneratorOutput.optional(),
  scripts: ScriptWriterOutput.optional(),
  storyboard: StoryboardOutput.optional(),
  production: VideoProducerOutput.optional(),
});
export type StageOutputs = z.infer<typeof StageOutputs>;

// ── Creative Brief (input) ──

export const CreativeBriefInput = z.object({
  productDescription: z.string().min(1),
  targetAudience: z.string().min(1),
  platforms: z.array(CreativePlatform).min(1),
  brandVoice: z.string().nullable().optional(),
  productImages: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
  pastPerformance: z.record(z.unknown()).nullable().optional(),
});
export type CreativeBriefInput = z.infer<typeof CreativeBriefInput>;

// ── Creative Job (full record) ──

export const CreativeJobSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  organizationId: z.string(),
  deploymentId: z.string(),
  productDescription: z.string(),
  targetAudience: z.string(),
  platforms: z.array(z.string()),
  brandVoice: z.string().nullable(),
  productImages: z.array(z.string()),
  references: z.array(z.string()),
  pastPerformance: z.record(z.unknown()).nullable(),
  currentStage: CreativeJobStage,
  stageOutputs: z.record(z.unknown()),
  stoppedAt: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type CreativeJob = z.infer<typeof CreativeJobSchema>;
```

- [ ] **Step 2: Export from schemas barrel**

Add to `packages/schemas/src/index.ts`:

```typescript
// Creative Pipeline (Performance Creative Director)
export * from "./creative-job.js";
```

- [ ] **Step 3: Verify types compile**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(schemas): add CreativeJob Zod schemas and stage output types"
```

---

### Task 2: Add CreativeJob Prisma Model

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add CreativeJob model to schema.prisma**

Add after the `AgentPersona` model (line ~865):

```prisma
// ── Creative Pipeline: Creative Jobs (PCD per-job data) ──

model CreativeJob {
  id              String   @id @default(cuid())
  taskId          String   @unique
  organizationId  String
  deploymentId    String

  // Brief (input)
  productDescription  String
  targetAudience      String
  platforms           String[]
  brandVoice          String?
  productImages       String[]   @default([])
  references          String[]   @default([])
  pastPerformance     Json?

  // Pipeline state
  currentStage    String   @default("trends")
  stageOutputs    Json     @default("{}")
  stoppedAt       String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  task AgentTask @relation(fields: [taskId], references: [id])

  @@index([organizationId])
  @@index([deploymentId])
}
```

- [ ] **Step 2: Add the reverse relation on AgentTask**

In the `AgentTask` model (line ~745), add after the `listing` relation:

```prisma
  creativeJob CreativeJob?
```

- [ ] **Step 3: Generate Prisma client and create migration**

Run:

```bash
npx pnpm@9.15.4 --filter @switchboard/db run db:generate
npx pnpm@9.15.4 --filter @switchboard/db exec prisma migrate dev --name add-creative-job
```

Expected: Migration created successfully. Prisma client regenerated.

- [ ] **Step 4: Verify Prisma client compiles**

Run: `npx pnpm@9.15.4 --filter @switchboard/db run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(db): add CreativeJob Prisma model with migration"
```

---

### Task 3: Create PrismaCreativeJobStore

**Files:**

- Create: `packages/db/src/stores/prisma-creative-job-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCreativeJobStore } from "../prisma-creative-job-store.js";

function makeMockPrisma() {
  return {
    creativeJob: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

type MockPrisma = ReturnType<typeof makeMockPrisma>;

describe("PrismaCreativeJobStore", () => {
  let prisma: MockPrisma;
  let store: PrismaCreativeJobStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaCreativeJobStore(prisma as never);
  });

  describe("create", () => {
    it("creates a creative job linked to a task", async () => {
      const input = {
        taskId: "task_1",
        organizationId: "org_1",
        deploymentId: "dep_1",
        productDescription: "AI scheduling tool",
        targetAudience: "Small business owners",
        platforms: ["meta", "youtube"],
        brandVoice: null,
        productImages: [],
        references: [],
        pastPerformance: null,
      };

      const expected = {
        id: "cj_1",
        ...input,
        currentStage: "trends",
        stageOutputs: {},
        stoppedAt: null,
      };
      prisma.creativeJob.create.mockResolvedValue(expected);

      const result = await store.create(input);
      expect(result).toEqual(expected);
      expect(prisma.creativeJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: "task_1",
          productDescription: "AI scheduling tool",
        }),
      });
    });
  });

  describe("findByTaskId", () => {
    it("returns job by taskId", async () => {
      const job = { id: "cj_1", taskId: "task_1" };
      prisma.creativeJob.findUnique.mockResolvedValue(job);

      const result = await store.findByTaskId("task_1");
      expect(result).toEqual(job);
      expect(prisma.creativeJob.findUnique).toHaveBeenCalledWith({
        where: { taskId: "task_1" },
      });
    });

    it("returns null when not found", async () => {
      prisma.creativeJob.findUnique.mockResolvedValue(null);
      const result = await store.findByTaskId("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("listByOrg", () => {
    it("lists jobs for an organization", async () => {
      const jobs = [{ id: "cj_1" }, { id: "cj_2" }];
      prisma.creativeJob.findMany.mockResolvedValue(jobs);

      const result = await store.listByOrg("org_1");
      expect(result).toHaveLength(2);
    });

    it("filters by deploymentId", async () => {
      prisma.creativeJob.findMany.mockResolvedValue([]);
      await store.listByOrg("org_1", { deploymentId: "dep_1" });

      expect(prisma.creativeJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: "org_1",
            deploymentId: "dep_1",
          }),
        }),
      );
    });
  });

  describe("updateStage", () => {
    it("updates current stage and merges stage output", async () => {
      const updated = {
        id: "cj_1",
        currentStage: "hooks",
        stageOutputs: { trends: { angles: [] } },
      };
      prisma.creativeJob.update.mockResolvedValue(updated);

      const result = await store.updateStage("cj_1", "hooks", { trends: { angles: [] } });
      expect(result.currentStage).toBe("hooks");
    });
  });

  describe("stop", () => {
    it("sets stoppedAt to current stage", async () => {
      const stopped = { id: "cj_1", stoppedAt: "hooks" };
      prisma.creativeJob.update.mockResolvedValue(stopped);

      const result = await store.stop("cj_1", "hooks");
      expect(result.stoppedAt).toBe("hooks");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-creative-job-store`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

```typescript
// packages/db/src/stores/prisma-creative-job-store.ts
import type { PrismaDbClient } from "../prisma-db.js";
import type { CreativeJob } from "@switchboard/schemas";

interface CreateCreativeJobInput {
  taskId: string;
  organizationId: string;
  deploymentId: string;
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  brandVoice: string | null;
  productImages: string[];
  references: string[];
  pastPerformance: Record<string, unknown> | null;
}

interface CreativeJobFilters {
  deploymentId?: string;
  currentStage?: string;
  limit?: number;
  offset?: number;
}

export class PrismaCreativeJobStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateCreativeJobInput): Promise<CreativeJob> {
    return this.prisma.creativeJob.create({
      data: {
        taskId: input.taskId,
        organizationId: input.organizationId,
        deploymentId: input.deploymentId,
        productDescription: input.productDescription,
        targetAudience: input.targetAudience,
        platforms: input.platforms,
        brandVoice: input.brandVoice,
        productImages: input.productImages,
        references: input.references,
        pastPerformance: input.pastPerformance ? (input.pastPerformance as object) : null,
      },
    }) as unknown as CreativeJob;
  }

  async findById(id: string): Promise<CreativeJob | null> {
    return this.prisma.creativeJob.findUnique({
      where: { id },
    }) as unknown as CreativeJob | null;
  }

  async findByTaskId(taskId: string): Promise<CreativeJob | null> {
    return this.prisma.creativeJob.findUnique({
      where: { taskId },
    }) as unknown as CreativeJob | null;
  }

  async listByOrg(organizationId: string, filters?: CreativeJobFilters): Promise<CreativeJob[]> {
    return this.prisma.creativeJob.findMany({
      where: {
        organizationId,
        ...(filters?.deploymentId ? { deploymentId: filters.deploymentId } : {}),
        ...(filters?.currentStage ? { currentStage: filters.currentStage } : {}),
      },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
      orderBy: { createdAt: "desc" },
    }) as unknown as CreativeJob[];
  }

  async updateStage(
    id: string,
    stage: string,
    stageOutputs: Record<string, unknown>,
  ): Promise<CreativeJob> {
    return this.prisma.creativeJob.update({
      where: { id },
      data: {
        currentStage: stage,
        stageOutputs: stageOutputs as object,
      },
    }) as unknown as CreativeJob;
  }

  async stop(id: string, stoppedAt: string): Promise<CreativeJob> {
    return this.prisma.creativeJob.update({
      where: { id },
      data: { stoppedAt },
    }) as unknown as CreativeJob;
  }
}
```

- [ ] **Step 4: Export from db barrel**

Add to `packages/db/src/index.ts`:

```typescript
export { PrismaCreativeJobStore } from "./stores/prisma-creative-job-store.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-creative-job-store`
Expected: All 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(db): add PrismaCreativeJobStore with tests"
```

---

### Task 4: Seed PCD Marketplace Listing

**Files:**

- Modify: `packages/db/prisma/seed-marketplace.ts`

- [ ] **Step 1: Update FUTURE_FAMILIES with PCD listing**

In `seed-marketplace.ts`, replace the "Creative" entry in `FUTURE_FAMILIES` with the real PCD listing. Add `taskCategories` as a field on each entry so the loop stays generic. Find the `FUTURE_FAMILIES` array and replace it entirely:

```typescript
const FUTURE_FAMILIES = [
  {
    name: "Performance Creative Director",
    slug: "performance-creative-director",
    description:
      "Full creative pipeline — from trend analysis and hooks to scripts, storyboards, and produced video ads. Stop at any stage.",
    taskCategories: ["creative_strategy", "hooks", "scripts", "storyboard", "production"],
    metadata: {
      isBundle: false,
      family: "creative",
      stages: ["trends", "hooks", "scripts", "storyboard", "production"],
    },
  },
  {
    name: "Trading",
    slug: "trading-family",
    description: "Market analysis, alerts, execution. Coming soon.",
    taskCategories: [] as string[],
    metadata: { isBundle: true, family: "trading" },
  },
  {
    name: "Finance",
    slug: "finance-family",
    description: "Bookkeeping, invoicing, expenses. Coming soon.",
    taskCategories: [] as string[],
    metadata: { isBundle: true, family: "finance" },
  },
];
```

Then update the `for` loop to use each entry's `taskCategories`:

```typescript
      create: {
        ...family,
        type: "switchboard_native",
        status: "pending_review",
        trustScore: 0,
        autonomyLevel: "supervised",
        priceTier: "free",
        priceMonthly: 0,
      },
```

- [ ] **Step 1b: Clean up stale creative-family record**

Add before the `for (const family of FUTURE_FAMILIES)` loop:

```typescript
// Remove old placeholder that was renamed
await prisma.agentListing.deleteMany({
  where: { slug: "creative-family" },
});
```

- [ ] **Step 2: Run seed to verify**

Run: `npx pnpm@9.15.4 --filter @switchboard/db run db:seed`
Expected: Output includes `Seeded placeholder: Performance Creative Director (...)`.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(db): seed Performance Creative Director marketplace listing"
```

---

### Task 5: Add Creative Pipeline API Routes

**Files:**

- Create: `apps/api/src/routes/creative-pipeline.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1: Create the route file**

```typescript
// apps/api/src/routes/creative-pipeline.ts
// ---------------------------------------------------------------------------
// Creative Pipeline routes — CRUD for CreativeJob (PCD)
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { PrismaCreativeJobStore, PrismaAgentTaskStore } from "@switchboard/db";
import { CreativeBriefInput } from "@switchboard/schemas";
import { z } from "zod";

const SubmitBriefInput = z.object({
  deploymentId: z.string().min(1),
  listingId: z.string().min(1),
  brief: CreativeBriefInput,
});

const ApproveStageInput = z.object({
  action: z.enum(["continue", "stop"]),
});

export const creativePipelineRoutes: FastifyPluginAsync = async (app) => {
  // POST /creative-jobs — submit a brief, create AgentTask + CreativeJob
  app.post("/creative-jobs", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const parsed = SubmitBriefInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error });
    }

    const { deploymentId, listingId, brief } = parsed.data;

    // Create the AgentTask
    const taskStore = new PrismaAgentTaskStore(app.prisma);
    const task = await taskStore.create({
      deploymentId,
      organizationId: orgId,
      listingId,
      category: "creative_strategy",
      input: brief as unknown as Record<string, unknown>,
    });

    // Create the CreativeJob
    const jobStore = new PrismaCreativeJobStore(app.prisma);
    const job = await jobStore.create({
      taskId: task.id,
      organizationId: orgId,
      deploymentId,
      productDescription: brief.productDescription,
      targetAudience: brief.targetAudience,
      platforms: brief.platforms,
      brandVoice: brief.brandVoice ?? null,
      productImages: brief.productImages,
      references: brief.references,
      pastPerformance: brief.pastPerformance ?? null,
    });

    return reply.code(201).send({ task, job });
  });

  // GET /creative-jobs — list jobs for org
  app.get("/creative-jobs", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const query = request.query as { deploymentId?: string; limit?: string };
    const jobStore = new PrismaCreativeJobStore(app.prisma);
    const jobs = await jobStore.listByOrg(orgId, {
      deploymentId: query.deploymentId,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });

    return reply.send({ jobs });
  });

  // GET /creative-jobs/:id — get single job with stage outputs
  app.get("/creative-jobs/:id", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const { id } = request.params as { id: string };
    const jobStore = new PrismaCreativeJobStore(app.prisma);
    const job = await jobStore.findById(id);

    if (!job || job.organizationId !== orgId) {
      return reply.code(404).send({ error: "Creative job not found" });
    }

    return reply.send({ job });
  });

  // POST /creative-jobs/:id/approve — continue or stop pipeline
  app.post("/creative-jobs/:id/approve", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const { id } = request.params as { id: string };
    const parsed = ApproveStageInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error });
    }

    const jobStore = new PrismaCreativeJobStore(app.prisma);
    const job = await jobStore.findById(id);

    if (!job || job.organizationId !== orgId) {
      return reply.code(404).send({ error: "Creative job not found" });
    }

    if (parsed.data.action === "stop") {
      const stopped = await jobStore.stop(id, job.currentStage);
      return reply.send({ job: stopped, action: "stopped" });
    }

    // "continue" — in SP2 this will fire an Inngest event.
    // For now, just acknowledge the approval.
    return reply.send({
      job,
      action: "approved",
      note: "Pipeline continuation will be wired in SP2 (Inngest)",
    });
  });
};
```

- [ ] **Step 2: Register routes in bootstrap**

In `apps/api/src/bootstrap/routes.ts`, add:

Import:

```typescript
import { creativePipelineRoutes } from "../routes/creative-pipeline.js";
```

Registration (after marketplace persona routes):

```typescript
await app.register(creativePipelineRoutes, { prefix: "/api/marketplace" });
```

- [ ] **Step 3: Verify build**

Run: `npx pnpm@9.15.4 --filter @switchboard/api run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(api): add creative pipeline routes for job CRUD"
```

---

### Task 6: Add Dashboard API Client Methods

**Files:**

- Modify: `apps/dashboard/src/lib/api-client.ts`

- [ ] **Step 1: Add CreativeJob type and client methods**

Add after the `MarketplaceTask` interface:

```typescript
export interface CreativeJobSummary {
  id: string;
  taskId: string;
  organizationId: string;
  deploymentId: string;
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  brandVoice: string | null;
  productImages: string[];
  references: string[];
  pastPerformance: Record<string, unknown> | null;
  currentStage: string;
  stoppedAt: string | null;
  stageOutputs: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

Add methods to the `SwitchboardClient` class:

```typescript
  // ── Creative Pipeline ──

  async submitCreativeBrief(body: {
    deploymentId: string;
    listingId: string;
    brief: {
      productDescription: string;
      targetAudience: string;
      platforms: string[];
      brandVoice?: string | null;
      productImages?: string[];
      references?: string[];
      pastPerformance?: Record<string, unknown> | null;
    };
  }) {
    return this.request<{ task: MarketplaceTask; job: CreativeJobSummary }>(
      "/api/marketplace/creative-jobs",
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  async listCreativeJobs(filters?: { deploymentId?: string; limit?: number }) {
    const params = new URLSearchParams();
    if (filters?.deploymentId) params.set("deploymentId", filters.deploymentId);
    if (filters?.limit) params.set("limit", String(filters.limit));
    const qs = params.toString();
    return this.request<{ jobs: CreativeJobSummary[] }>(
      `/api/marketplace/creative-jobs${qs ? `?${qs}` : ""}`,
    );
  }

  async getCreativeJob(id: string) {
    return this.request<{ job: CreativeJobSummary }>(
      `/api/marketplace/creative-jobs/${id}`,
    );
  }

  async approveCreativeJobStage(id: string, action: "continue" | "stop") {
    return this.request<{ job: CreativeJobSummary; action: string }>(
      `/api/marketplace/creative-jobs/${id}/approve`,
      { method: "POST", body: JSON.stringify({ action }) },
    );
  }
```

- [ ] **Step 2: Verify dashboard builds**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(dashboard): add creative pipeline API client methods"
```

---

### Task 7: Run Full Test Suite + Type Check

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npx pnpm@9.15.4 test`
Expected: All tests pass (including new creative job store tests).

- [ ] **Step 2: Run type check**

Run: `npx pnpm@9.15.4 typecheck`
Expected: No type errors.

- [ ] **Step 3: Run lint**

Run: `npx pnpm@9.15.4 lint`
Expected: No lint errors.
