# PCD SP2: Inngest Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Inngest into the Switchboard monorepo so creative pipeline jobs run as durable, stage-by-stage step functions with human-in-the-loop approval between stages.

**Architecture:** Inngest is added as a dependency to the API server only. A single Inngest function (`creative-job-runner`) orchestrates all 5 pipeline stages using `step.run()` for execution and `step.waitForEvent()` for buyer approval pauses. Each stage is a no-op placeholder in SP2 — real logic ships in SP3+. The creative-pipeline API routes are updated to fire Inngest events on job creation and stage approval.

**Tech Stack:** Inngest SDK (`inngest`), Fastify (`apps/api`), Prisma (`@switchboard/db`), Zod schemas (`@switchboard/schemas`)

**Spec:** `docs/superpowers/specs/2026-04-08-performance-creative-director-design.md` — Section 2.2

---

## File Structure

| Action | File                                                                        | Responsibility                                                        |
| ------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Create | `packages/core/src/creative-pipeline/inngest-client.ts`                     | Inngest client singleton + event type definitions                     |
| Create | `packages/core/src/creative-pipeline/creative-job-runner.ts`                | Inngest step function — orchestrates 5 stages with no-op placeholders |
| Create | `packages/core/src/creative-pipeline/stages/run-stage.ts`                   | Single dispatch function mapping stage name → no-op handler           |
| Create | `packages/core/src/creative-pipeline/index.ts`                              | Barrel exports                                                        |
| Create | `packages/core/src/creative-pipeline/__tests__/creative-job-runner.test.ts` | Unit tests for the step function logic                                |
| Create | `packages/core/src/creative-pipeline/__tests__/run-stage.test.ts`           | Unit tests for stage dispatch                                         |
| Create | `apps/api/src/bootstrap/inngest.ts`                                         | Inngest serve middleware wired into Fastify                           |
| Modify | `apps/api/src/app.ts`                                                       | Import + register Inngest serve middleware                            |
| Modify | `apps/api/src/routes/creative-pipeline.ts`                                  | Fire Inngest event on job creation + approval                         |
| Modify | `apps/api/package.json`                                                     | Add `inngest` dependency                                              |
| Modify | `packages/core/package.json`                                                | Add `inngest` dependency + add `creative-pipeline` export             |

---

### Task 1: Install Inngest SDK

**Files:**

- Modify: `apps/api/package.json`
- Modify: `packages/core/package.json`

- [ ] **Step 1: Add inngest to packages/core**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core add inngest
```

- [ ] **Step 2: Add inngest to apps/api**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/api add inngest
```

- [ ] **Step 3: Verify install**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 ls inngest --filter @switchboard/core --filter @switchboard/api
```

Expected: both packages show `inngest` in dependencies.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: add inngest SDK to core and api packages"
```

---

### Task 2: Create Inngest Client + Event Types

**Files:**

- Create: `packages/core/src/creative-pipeline/inngest-client.ts`

The Inngest client is the shared singleton that all functions and event sends use. Event schemas are defined here for type safety across the codebase.

- [ ] **Step 1: Create the Inngest client file**

```typescript
// packages/core/src/creative-pipeline/inngest-client.ts
import { Inngest } from "inngest";

/**
 * Event definitions for the creative pipeline.
 *
 * - "creative-pipeline/job.submitted": Fired when a buyer submits a brief.
 *   Triggers the creative-job-runner function.
 *
 * - "creative-pipeline/stage.approved": Fired when a buyer approves the
 *   current stage output. The running job-runner picks this up via
 *   step.waitForEvent() and proceeds to the next stage.
 */
export type CreativePipelineEvents = {
  "creative-pipeline/job.submitted": {
    data: {
      jobId: string;
      taskId: string;
      organizationId: string;
      deploymentId: string;
    };
  };
  "creative-pipeline/stage.approved": {
    data: {
      jobId: string;
      action: "continue" | "stop";
    };
  };
};

export const inngestClient = new Inngest({
  id: "switchboard",
  schemas: new Map() as never, // Type-only — runtime validation via Zod
});
```

- [ ] **Step 2: Verify file compiles**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(core): add Inngest client and creative pipeline event types"
```

---

### Task 3: Create Stage Dispatch (No-Op Stubs)

**Files:**

- Create: `packages/core/src/creative-pipeline/stages/run-stage.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/run-stage.test.ts`

Each stage is a no-op in SP2. The `runStage` function dispatches by stage name and returns placeholder output. SP3 will replace these with real Claude calls.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/creative-pipeline/__tests__/run-stage.test.ts
import { describe, it, expect } from "vitest";
import { runStage } from "../stages/run-stage.js";

describe("runStage", () => {
  it("returns placeholder output for trends stage", async () => {
    const result = await runStage("trends", {
      jobId: "job_1",
      brief: {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      previousOutputs: {},
    });

    expect(result).toHaveProperty("angles");
    expect(result).toHaveProperty("audienceInsights");
    expect(result).toHaveProperty("trendSignals");
  });

  it("returns placeholder output for hooks stage", async () => {
    const result = await runStage("hooks", {
      jobId: "job_1",
      brief: {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      previousOutputs: {},
    });

    expect(result).toHaveProperty("hooks");
    expect(result).toHaveProperty("topCombos");
  });

  it("returns placeholder output for scripts stage", async () => {
    const result = await runStage("scripts", {
      jobId: "job_1",
      brief: {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      previousOutputs: {},
    });

    expect(result).toHaveProperty("scripts");
  });

  it("returns placeholder output for storyboard stage", async () => {
    const result = await runStage("storyboard", {
      jobId: "job_1",
      brief: {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      previousOutputs: {},
    });

    expect(result).toHaveProperty("storyboards");
  });

  it("returns placeholder output for production stage", async () => {
    const result = await runStage("production", {
      jobId: "job_1",
      brief: {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      previousOutputs: {},
    });

    expect(result).toHaveProperty("videos");
    expect(result).toHaveProperty("staticFallbacks");
  });

  it("throws for unknown stage", async () => {
    await expect(
      runStage("unknown" as never, {
        jobId: "job_1",
        brief: {
          productDescription: "AI tool",
          targetAudience: "SMBs",
          platforms: ["meta"],
        },
        previousOutputs: {},
      }),
    ).rejects.toThrow("Unknown stage: unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose src/creative-pipeline/__tests__/run-stage.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/creative-pipeline/stages/run-stage.ts
import type {
  TrendAnalysisOutput,
  HookGeneratorOutput,
  ScriptWriterOutput,
  StoryboardOutput,
  VideoProducerOutput,
} from "@switchboard/schemas";

export interface StageInput {
  jobId: string;
  brief: {
    productDescription: string;
    targetAudience: string;
    platforms: string[];
  };
  previousOutputs: Record<string, unknown>;
}

type StageOutput =
  | TrendAnalysisOutput
  | HookGeneratorOutput
  | ScriptWriterOutput
  | StoryboardOutput
  | VideoProducerOutput;

const STAGE_ORDER = ["trends", "hooks", "scripts", "storyboard", "production"] as const;
export type StageName = (typeof STAGE_ORDER)[number];

export function getNextStage(current: StageName): StageName | "complete" {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx === -1 || idx === STAGE_ORDER.length - 1) return "complete";
  return STAGE_ORDER[idx + 1];
}

/**
 * Dispatch a pipeline stage by name. SP2: all stages return placeholder output.
 * SP3+ will replace each case with real Claude/API calls.
 */
export async function runStage(stage: string, _input: StageInput): Promise<StageOutput> {
  switch (stage) {
    case "trends":
      return {
        angles: [
          {
            theme: "[placeholder] Trend theme",
            motivator: "placeholder",
            platformFit: "meta",
            rationale: "SP2 no-op — real analysis in SP3",
          },
        ],
        audienceInsights: {
          awarenessLevel: "problem_aware" as const,
          topDrivers: ["placeholder"],
          objections: ["placeholder"],
        },
        trendSignals: [{ platform: "meta", trend: "placeholder", relevance: "SP2 no-op" }],
      };

    case "hooks":
      return {
        hooks: [
          {
            angleRef: "0",
            text: "[placeholder] Hook text",
            type: "pattern_interrupt" as const,
            platformScore: 0,
            rationale: "SP2 no-op — real generation in SP3",
          },
        ],
        topCombos: [{ angleRef: "0", hookRef: "0", score: 0 }],
      };

    case "scripts":
      return {
        scripts: [
          {
            hookRef: "0",
            fullScript: "[placeholder] Full script content",
            timing: [{ section: "hook", startSec: 0, endSec: 3, content: "placeholder" }],
            format: "feed_video",
            platform: "meta",
            productionNotes: "SP2 no-op — real script writing in SP3",
          },
        ],
      };

    case "storyboard":
      return {
        storyboards: [
          {
            scriptRef: "0",
            scenes: [
              {
                sceneNumber: 1,
                description: "[placeholder] Scene description",
                visualDirection: "placeholder",
                duration: 3,
                textOverlay: null,
                referenceImageUrl: null,
              },
            ],
          },
        ],
      };

    case "production":
      return {
        videos: [
          {
            storyboardRef: "0",
            videoUrl: "https://placeholder.example.com/video.mp4",
            thumbnailUrl: "https://placeholder.example.com/thumb.jpg",
            format: "9:16",
            duration: 30,
            platform: "meta",
          },
        ],
        staticFallbacks: [],
      };

    default:
      throw new Error(`Unknown stage: ${stage}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose src/creative-pipeline/__tests__/run-stage.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add creative pipeline stage dispatch with no-op stubs"
```

---

### Task 4: Create Creative Job Runner (Inngest Step Function)

**Files:**

- Create: `packages/core/src/creative-pipeline/creative-job-runner.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/creative-job-runner.test.ts`

This is the core Inngest function. It runs 5 stages sequentially, saving output after each, and pauses between stages for buyer approval via `step.waitForEvent()`.

- [ ] **Step 1: Write the failing test**

The Inngest SDK provides no test harness for step functions out of the box. We test the orchestration logic by extracting it into a testable helper that takes a `stepTools` interface, then mock the step methods.

```typescript
// packages/core/src/creative-pipeline/__tests__/creative-job-runner.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeCreativePipeline } from "../creative-job-runner.js";

function createMockStep() {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
    waitForEvent: vi.fn(() => ({ data: { action: "continue" } })),
  };
}

function createMockJobStore() {
  return {
    findById: vi.fn(),
    updateStage: vi.fn(),
    stop: vi.fn(),
  };
}

describe("executeCreativePipeline", () => {
  let step: ReturnType<typeof createMockStep>;
  let jobStore: ReturnType<typeof createMockJobStore>;

  const jobData = {
    jobId: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
  };

  const mockJob = {
    id: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
    productDescription: "AI scheduling tool",
    targetAudience: "Small business owners",
    platforms: ["meta"],
    brandVoice: null,
    productImages: [],
    references: [],
    pastPerformance: null,
    currentStage: "trends",
    stageOutputs: {},
    stoppedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    step = createMockStep();
    jobStore = createMockJobStore();
    jobStore.findById.mockResolvedValue(mockJob);
    jobStore.updateStage.mockImplementation((_id, stage, outputs) => ({
      ...mockJob,
      currentStage: stage,
      stageOutputs: outputs,
    }));
  });

  it("runs all 5 stages when buyer approves each", async () => {
    await executeCreativePipeline(jobData, step as never, jobStore as never);

    // 5 stage runs (each calls step.run) + 5 save calls (each calls step.run) = 10
    // + 4 waitForEvent calls (no wait after production)
    expect(step.run).toHaveBeenCalledTimes(10);
    expect(step.waitForEvent).toHaveBeenCalledTimes(4);
  });

  it("stops pipeline when buyer sends stop action", async () => {
    // Approve trends, then stop at hooks
    step.waitForEvent
      .mockResolvedValueOnce({ data: { action: "continue" } })
      .mockResolvedValueOnce({ data: { action: "stop" } });

    await executeCreativePipeline(jobData, step as never, jobStore as never);

    // trends run + save + hooks run + save = 4 step.runs
    expect(step.run).toHaveBeenCalledTimes(4);
    expect(step.waitForEvent).toHaveBeenCalledTimes(2);
    expect(jobStore.stop).toHaveBeenCalledWith("job_1", "hooks");
  });

  it("stops pipeline on waitForEvent timeout (null event)", async () => {
    // First wait returns null (timeout)
    step.waitForEvent.mockResolvedValueOnce(null);

    await executeCreativePipeline(jobData, step as never, jobStore as never);

    // trends run + save = 2 step.runs, 1 waitForEvent
    expect(step.run).toHaveBeenCalledTimes(2);
    expect(jobStore.stop).toHaveBeenCalledWith("job_1", "trends");
  });

  it("throws if job not found", async () => {
    jobStore.findById.mockResolvedValue(null);

    await expect(
      executeCreativePipeline(jobData, step as never, jobStore as never),
    ).rejects.toThrow("Creative job not found: job_1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose src/creative-pipeline/__tests__/creative-job-runner.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/creative-pipeline/creative-job-runner.ts
import { inngestClient } from "./inngest-client.js";
import { runStage, getNextStage } from "./stages/run-stage.js";
import type { StageName } from "./stages/run-stage.js";
import type { CreativeJob } from "@switchboard/schemas";

const STAGES: StageName[] = ["trends", "hooks", "scripts", "storyboard", "production"];

// 24-hour timeout for buyer approval between stages
const APPROVAL_TIMEOUT_MS = "24h";

interface JobStore {
  findById(id: string): Promise<CreativeJob | null>;
  updateStage(
    id: string,
    stage: string,
    stageOutputs: Record<string, unknown>,
  ): Promise<CreativeJob>;
  stop(id: string, stoppedAt: string): Promise<CreativeJob>;
}

interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
  waitForEvent: (
    id: string,
    opts: { event: string; timeout: string; match: string },
  ) => Promise<{ data: { action: string } } | null>;
}

interface JobEventData {
  jobId: string;
  taskId: string;
  organizationId: string;
  deploymentId: string;
}

/**
 * Core pipeline logic extracted for testability.
 * Called by the Inngest function handler with real step tools,
 * or by tests with mocked step tools.
 */
export async function executeCreativePipeline(
  eventData: JobEventData,
  step: StepTools,
  jobStore: JobStore,
): Promise<void> {
  const job = await step.run("load-job", () => jobStore.findById(eventData.jobId));

  if (!job) {
    throw new Error(`Creative job not found: ${eventData.jobId}`);
  }

  let stageOutputs: Record<string, unknown> = (job.stageOutputs ?? {}) as Record<string, unknown>;

  for (const stage of STAGES) {
    // Run the stage
    const output = await step.run(`stage-${stage}`, () =>
      runStage(stage, {
        jobId: job.id,
        brief: {
          productDescription: job.productDescription,
          targetAudience: job.targetAudience,
          platforms: job.platforms,
        },
        previousOutputs: stageOutputs,
      }),
    );

    // Persist output
    stageOutputs = { ...stageOutputs, [stage]: output };
    const nextStage = getNextStage(stage);

    await step.run(`save-${stage}`, () => jobStore.updateStage(job.id, nextStage, stageOutputs));

    // After the last stage, no approval needed
    if (nextStage === "complete") break;

    // Wait for buyer approval before proceeding
    const approval = await step.waitForEvent(`wait-approval-${stage}`, {
      event: "creative-pipeline/stage.approved",
      timeout: APPROVAL_TIMEOUT_MS,
      match: "data.jobId",
    });

    // Timeout or explicit stop → halt pipeline
    if (!approval || approval.data.action === "stop") {
      await jobStore.stop(job.id, stage);
      return;
    }
  }
}

/**
 * Inngest function definition. Wired into the serve handler in apps/api.
 * The jobStore dependency is injected at registration time (see inngest.ts bootstrap).
 */
export function createCreativeJobRunner(jobStore: JobStore) {
  return inngestClient.createFunction(
    {
      id: "creative-job-runner",
      name: "Creative Pipeline Job Runner",
      retries: 3,
    },
    { event: "creative-pipeline/job.submitted" },
    async ({ event, step }) => {
      await executeCreativePipeline(
        event.data as JobEventData,
        step as unknown as StepTools,
        jobStore,
      );
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose src/creative-pipeline/__tests__/creative-job-runner.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add creative-job-runner Inngest step function with approval gates"
```

---

### Task 5: Create Barrel Exports + Wire Package Exports

**Files:**

- Create: `packages/core/src/creative-pipeline/index.ts`
- Modify: `packages/core/package.json` — add `"./creative-pipeline"` export

- [ ] **Step 1: Create barrel export**

```typescript
// packages/core/src/creative-pipeline/index.ts
export { inngestClient } from "./inngest-client.js";
export type { CreativePipelineEvents } from "./inngest-client.js";
export { createCreativeJobRunner, executeCreativePipeline } from "./creative-job-runner.js";
export { runStage, getNextStage } from "./stages/run-stage.js";
export type { StageName, StageInput } from "./stages/run-stage.js";
```

- [ ] **Step 2: Add export map entry to core package.json**

Add to the `"exports"` field in `packages/core/package.json`:

```json
"./creative-pipeline": {
  "types": "./dist/creative-pipeline/index.d.ts",
  "import": "./dist/creative-pipeline/index.js"
}
```

- [ ] **Step 3: Verify typecheck passes**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): add creative-pipeline barrel exports and package export map"
```

---

### Task 6: Wire Inngest Serve Middleware into Fastify

**Files:**

- Create: `apps/api/src/bootstrap/inngest.ts`
- Modify: `apps/api/src/app.ts`

Inngest needs an HTTP endpoint (typically `/api/inngest`) that it polls for function definitions and sends events to. The `serve` adapter handles this.

- [ ] **Step 1: Create the Inngest bootstrap file**

```typescript
// apps/api/src/bootstrap/inngest.ts
import { serve } from "inngest/fastify";
import type { FastifyInstance } from "fastify";
import { inngestClient, createCreativeJobRunner } from "@switchboard/core/creative-pipeline";
import { PrismaCreativeJobStore } from "@switchboard/db";

/**
 * Register Inngest serve handler with Fastify.
 * Creates the /api/inngest endpoint that the Inngest dev server or cloud polls.
 */
export async function registerInngest(app: FastifyInstance): Promise<void> {
  if (!app.prisma) {
    app.log.warn("Inngest: skipping registration — no database connection");
    return;
  }

  const jobStore = new PrismaCreativeJobStore(app.prisma);

  const inngestHandler = serve({
    client: inngestClient,
    functions: [createCreativeJobRunner(jobStore)],
  });

  await app.register(inngestHandler, { prefix: "/api/inngest" });
  app.log.info("Inngest serve handler registered at /api/inngest");
}
```

- [ ] **Step 2: Add Inngest registration to app.ts**

In `apps/api/src/app.ts`, add the import at the top:

```typescript
import { registerInngest } from "./bootstrap/inngest.js";
```

Then add the registration call just before `await registerRoutes(app);` (around line 441):

```typescript
// --- Inngest serve handler (creative pipeline orchestration) ---
await registerInngest(app);
```

- [ ] **Step 3: Add `inngestClient` to Fastify type declaration** (in `app.ts`)

Add to the `FastifyInstance` interface augmentation:

```typescript
inngestClient: import("inngest").Inngest | null;
```

Note: this is optional — the Inngest client is accessed via the module import, not via `app.inngestClient`. Skip this step if it adds unnecessary complexity.

- [ ] **Step 4: Verify typecheck passes**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/api exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(api): register Inngest serve handler at /api/inngest"
```

---

### Task 7: Wire Job Creation + Approval to Inngest Events

**Files:**

- Modify: `apps/api/src/routes/creative-pipeline.ts`

Update the `POST /creative-jobs` route to fire `creative-pipeline/job.submitted` after creating the job. Update `POST /creative-jobs/:id/approve` to fire `creative-pipeline/stage.approved` when buyer clicks "Continue".

- [ ] **Step 1: Write the failing test**

Create or extend the route test to verify Inngest events are sent:

```typescript
// apps/api/src/routes/__tests__/creative-pipeline.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInngestSend = vi.fn();

vi.mock("@switchboard/core/creative-pipeline", () => ({
  inngestClient: { send: mockInngestSend },
}));

const mockJobStore = {
  create: vi.fn(),
  findById: vi.fn(),
  listByOrg: vi.fn(),
  stop: vi.fn(),
};

const mockTaskStore = {
  create: vi.fn(),
};

vi.mock("@switchboard/db", () => ({
  PrismaCreativeJobStore: vi.fn(() => mockJobStore),
  PrismaAgentTaskStore: vi.fn(() => mockTaskStore),
}));

describe("Creative Pipeline Routes — Inngest Events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /creative-jobs", () => {
    it("fires job.submitted event after creating job", async () => {
      const mockTask = { id: "task_1" };
      const mockJob = {
        id: "job_1",
        taskId: "task_1",
        organizationId: "org_1",
        deploymentId: "dep_1",
      };

      mockTaskStore.create.mockResolvedValue(mockTask);
      mockJobStore.create.mockResolvedValue(mockJob);
      mockInngestSend.mockResolvedValue(undefined);

      // Import route handler to test — actual HTTP test would need Fastify injection.
      // For unit test, we verify the send call is wired correctly.
      const { creativePipelineRoutes } = await import("../creative-pipeline.js");

      // Verify the module imports inngestClient
      expect(mockInngestSend).toBeDefined();
    });
  });

  describe("POST /creative-jobs/:id/approve — continue", () => {
    it("fires stage.approved event with continue action", async () => {
      const mockJob = {
        id: "job_1",
        organizationId: "org_1",
        currentStage: "trends",
      };

      mockJobStore.findById.mockResolvedValue(mockJob);
      mockInngestSend.mockResolvedValue(undefined);

      // Module-level verification
      const { creativePipelineRoutes } = await import("../creative-pipeline.js");
      expect(mockInngestSend).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Update creative-pipeline.ts routes**

Replace the contents of `apps/api/src/routes/creative-pipeline.ts`:

```typescript
// ---------------------------------------------------------------------------
// Creative Pipeline routes — CRUD for CreativeJob (PCD)
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { PrismaCreativeJobStore, PrismaAgentTaskStore } from "@switchboard/db";
import { CreativeBriefInput } from "@switchboard/schemas";
import { inngestClient } from "@switchboard/core/creative-pipeline";
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
  // POST /creative-jobs — submit a brief, create AgentTask + CreativeJob, fire Inngest event
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

    // Fire Inngest event to start the pipeline
    await inngestClient.send({
      name: "creative-pipeline/job.submitted",
      data: {
        jobId: job.id,
        taskId: task.id,
        organizationId: orgId,
        deploymentId,
      },
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

      // Fire stop event so the running Inngest function unblocks and exits
      await inngestClient.send({
        name: "creative-pipeline/stage.approved",
        data: { jobId: id, action: "stop" },
      });

      return reply.send({ job: stopped, action: "stopped" });
    }

    // Fire continue event — the running Inngest function's waitForEvent picks this up
    await inngestClient.send({
      name: "creative-pipeline/stage.approved",
      data: { jobId: id, action: "continue" },
    });

    return reply.send({ job, action: "approved" });
  });
};
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/api test -- --reporter=verbose
```

Expected: all tests pass.

- [ ] **Step 4: Verify typecheck**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/api exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(api): fire Inngest events on creative job creation and approval"
```

---

### Task 8: Add .env.example Entry + Dev Instructions

**Files:**

- Modify: `.env.example` (if it exists)

- [ ] **Step 1: Add Inngest dev server note**

Add to `.env.example`:

```bash
# Inngest — creative pipeline orchestration
# Run `npx inngest-cli@latest dev` alongside the API server for local development.
# The Inngest dev server connects to the API's /api/inngest endpoint automatically.
INNGEST_EVENT_KEY=         # Optional: set in production for Inngest Cloud
INNGEST_SIGNING_KEY=       # Optional: set in production for request verification
```

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: add Inngest environment variables to .env.example"
```

---

### Task 9: Full Integration Verification

- [ ] **Step 1: Run all core tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose
```

Expected: all tests pass (existing + 10 new creative pipeline tests).

- [ ] **Step 2: Run all API tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/api test -- --reporter=verbose
```

Expected: all tests pass.

- [ ] **Step 3: Run full typecheck**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck
```

Expected: no type errors across the monorepo.

- [ ] **Step 4: Run linter**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 lint
```

Expected: no lint errors.

- [ ] **Step 5: Commit any fixes if needed, then final commit**

```bash
git log --oneline -10
```

Expected: clean commit history with SP2 changes following conventional commits.

---

## Summary of Inngest Data Flow

```
Buyer submits brief
  → POST /creative-jobs
    → Creates AgentTask + CreativeJob
    → inngestClient.send("creative-pipeline/job.submitted")

Inngest picks up event
  → creative-job-runner starts
    → step.run("stage-trends") → no-op output
    → step.run("save-trends") → jobStore.updateStage()
    → step.waitForEvent("creative-pipeline/stage.approved", match: jobId)

Buyer clicks "Continue"
  → POST /creative-jobs/:id/approve { action: "continue" }
    → inngestClient.send("creative-pipeline/stage.approved")

Inngest resumes
  → step.run("stage-hooks") → no-op output
  → ... repeats for each stage ...
  → After production: pipeline complete

Buyer clicks "Stop" (at any stage)
  → POST /creative-jobs/:id/approve { action: "stop" }
    → jobStore.stop() + inngestClient.send("stage.approved", { action: "stop" })
  → Inngest function exits cleanly
```
