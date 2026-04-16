# UGC v2 SP2 — Mode Dispatcher + UGC Runner Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mode dispatcher that routes `job.submitted` events to either the polished or UGC runner. Build the UGC job runner skeleton with phase loop, no-op phases, approval gating, phase resume, error handling, and event contract.

**Architecture:** The mode dispatcher is a thin Inngest function that takes over the `job.submitted` trigger from the existing `creative-job-runner`. It re-emits either `polished.submitted` or `ugc.submitted`. The existing runner's trigger changes to `polished.submitted` (breaking change). The UGC runner implements the phase loop from spec Section 5.1 with no-op phase implementations (real phases come in SP3-SP5).

**Tech Stack:** Inngest (event-driven), TypeScript ESM, Vitest

**Spec:** `docs/superpowers/specs/2026-04-15-ugc-v2-creative-system-design.md` — Sections 2.2, 5.1, 5.7, 5.9, 5.10

---

## File Map

### New files

| File                                                                    | Responsibility                                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/core/src/creative-pipeline/mode-dispatcher.ts`                | Thin Inngest function: reads `mode` from event, dispatches to polished or UGC runner          |
| `packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts`             | UGC phase loop: load job → preload context → iterate phases → approval gates → error handling |
| `packages/core/src/creative-pipeline/ugc/approval-config.ts`            | `shouldRequireApproval()` + `DEFAULT_APPROVAL_CONFIG`                                         |
| `packages/core/src/creative-pipeline/__tests__/mode-dispatcher.test.ts` | Tests for mode dispatch routing                                                               |
| `packages/core/src/creative-pipeline/__tests__/ugc-job-runner.test.ts`  | Tests for phase loop, approval gates, resume, error handling                                  |
| `packages/core/src/creative-pipeline/__tests__/approval-config.test.ts` | Tests for approval threshold logic                                                            |

### Modified files

| File                                                         | Change                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `packages/core/src/creative-pipeline/inngest-client.ts`      | Add `polished.submitted`, `ugc.submitted`, UGC phase events to `CreativePipelineEvents` |
| `packages/core/src/creative-pipeline/creative-job-runner.ts` | Change trigger from `job.submitted` to `polished.submitted`                             |
| `packages/core/src/creative-pipeline/index.ts`               | Export mode dispatcher, UGC runner, approval config                                     |
| `apps/api/src/bootstrap/inngest.ts`                          | Register mode dispatcher + UGC runner alongside existing functions                      |

---

## Task 1: Extend Event Contract in inngest-client.ts

**Files:**

- Modify: `packages/core/src/creative-pipeline/inngest-client.ts`

- [ ] **Step 1: Add new event types**

In `inngest-client.ts`, extend `CreativePipelineEvents` to include mode dispatch and UGC events:

```typescript
export type CreativePipelineEvents = {
  // Entry point (consumed by mode dispatcher)
  "creative-pipeline/job.submitted": {
    data: {
      jobId: string;
      taskId: string;
      organizationId: string;
      deploymentId: string;
      mode?: string;
    };
  };
  // Polished pipeline (re-dispatched by mode dispatcher)
  "creative-pipeline/polished.submitted": {
    data: {
      jobId: string;
      taskId: string;
      organizationId: string;
      deploymentId: string;
      mode: "polished";
      dispatchedAt: Date;
    };
  };
  // Polished approval (existing)
  "creative-pipeline/stage.approved": {
    data: {
      jobId: string;
      action: "continue" | "stop";
    };
  };
  // UGC pipeline
  "creative-pipeline/ugc.submitted": {
    data: {
      jobId: string;
      taskId: string;
      organizationId: string;
      deploymentId: string;
      mode: "ugc";
      pipelineVersion: string;
      dispatchedAt: Date;
    };
  };
  "creative-pipeline/ugc-phase.completed": {
    data: {
      jobId: string;
      phase: string;
      durationMs: number;
      substagesCompleted: string[];
      resultSummary: Record<string, unknown>;
    };
  };
  "creative-pipeline/ugc-phase.approved": {
    data: {
      jobId: string;
      phase: string;
      action: "continue" | "stop";
    };
  };
  "creative-pipeline/ugc.completed": {
    data: {
      jobId: string;
      assetsProduced: number;
      failed: number;
    };
  };
  "creative-pipeline/ugc.stopped": {
    data: {
      jobId: string;
      stoppedAtPhase: string;
    };
  };
  "creative-pipeline/ugc.failed": {
    data: {
      jobId: string;
      phase: string;
      error: Record<string, unknown>;
    };
  };
};
```

Note: The `mode?` field on `job.submitted` is optional for backward compat — existing polished submissions don't send it.

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/creative-pipeline/inngest-client.ts
git commit -m "feat(core): extend CreativePipelineEvents with mode dispatch and UGC events"
```

---

## Task 2: Mode Dispatcher

**Files:**

- Create: `packages/core/src/creative-pipeline/mode-dispatcher.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/mode-dispatcher.test.ts`

- [ ] **Step 1: Write test for mode-dispatcher**

Create `packages/core/src/creative-pipeline/__tests__/mode-dispatcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeModeDispatch } from "../mode-dispatcher.js";

function createMockStep() {
  return {
    sendEvent: vi.fn(),
  };
}

describe("executeModeDispatch", () => {
  let step: ReturnType<typeof createMockStep>;

  const baseEvent = {
    jobId: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
  };

  beforeEach(() => {
    step = createMockStep();
  });

  it("dispatches to UGC runner when mode is 'ugc'", async () => {
    await executeModeDispatch({ ...baseEvent, mode: "ugc" }, step as never);

    expect(step.sendEvent).toHaveBeenCalledWith("dispatch-ugc", {
      name: "creative-pipeline/ugc.submitted",
      data: expect.objectContaining({
        jobId: "job_1",
        mode: "ugc",
        pipelineVersion: "ugc_v2",
      }),
    });
  });

  it("dispatches to polished runner when mode is 'polished'", async () => {
    await executeModeDispatch({ ...baseEvent, mode: "polished" }, step as never);

    expect(step.sendEvent).toHaveBeenCalledWith("dispatch-polished", {
      name: "creative-pipeline/polished.submitted",
      data: expect.objectContaining({
        jobId: "job_1",
        mode: "polished",
      }),
    });
  });

  it("defaults to polished when mode is not specified", async () => {
    await executeModeDispatch(baseEvent, step as never);

    expect(step.sendEvent).toHaveBeenCalledWith("dispatch-polished", {
      name: "creative-pipeline/polished.submitted",
      data: expect.objectContaining({
        mode: "polished",
      }),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run mode-dispatcher
```

- [ ] **Step 3: Implement mode-dispatcher.ts**

Create `packages/core/src/creative-pipeline/mode-dispatcher.ts`:

```typescript
// packages/core/src/creative-pipeline/mode-dispatcher.ts
import { inngestClient } from "./inngest-client.js";

interface DispatchEventData {
  jobId: string;
  taskId: string;
  organizationId: string;
  deploymentId: string;
  mode?: string;
}

interface DispatchStepTools {
  sendEvent: (id: string, event: { name: string; data: Record<string, unknown> }) => Promise<void>;
}

/**
 * Core dispatch logic extracted for testability.
 */
export async function executeModeDispatch(
  eventData: DispatchEventData,
  step: DispatchStepTools,
): Promise<void> {
  const mode = eventData.mode ?? "polished";

  if (mode === "ugc") {
    await step.sendEvent("dispatch-ugc", {
      name: "creative-pipeline/ugc.submitted",
      data: {
        ...eventData,
        mode: "ugc",
        pipelineVersion: "ugc_v2",
        dispatchedAt: new Date(),
      },
    });
  } else {
    await step.sendEvent("dispatch-polished", {
      name: "creative-pipeline/polished.submitted",
      data: {
        ...eventData,
        mode: "polished",
        dispatchedAt: new Date(),
      },
    });
  }
}

/**
 * Inngest function definition for the mode dispatcher.
 * Takes over the `job.submitted` trigger as the single entry point.
 */
export function createModeDispatcher() {
  return inngestClient.createFunction(
    {
      id: "creative-mode-dispatcher",
      name: "Creative Pipeline Mode Dispatcher",
      retries: 3,
      triggers: [{ event: "creative-pipeline/job.submitted" }],
    },
    async ({ event, step }: { event: { data: DispatchEventData }; step: DispatchStepTools }) => {
      await executeModeDispatch(event.data, step);
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run mode-dispatcher
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/mode-dispatcher.ts packages/core/src/creative-pipeline/__tests__/mode-dispatcher.test.ts
git commit -m "feat(core): add mode dispatcher — routes job.submitted to polished or UGC runner"
```

---

## Task 3: Migrate Polished Runner Trigger

**Files:**

- Modify: `packages/core/src/creative-pipeline/creative-job-runner.ts`
- Modify: `packages/core/src/creative-pipeline/__tests__/creative-job-runner.test.ts`

- [ ] **Step 1: Change trigger from `job.submitted` to `polished.submitted`**

In `creative-job-runner.ts`, find line 130:

```typescript
      triggers: [{ event: "creative-pipeline/job.submitted" }],
```

Replace with:

```typescript
      triggers: [{ event: "creative-pipeline/polished.submitted" }],
```

This is the breaking change — the mode dispatcher now owns `job.submitted`.

- [ ] **Step 2: Verify existing tests still pass**

The existing tests test `executeCreativePipeline` directly (not the trigger), so they should pass without changes:

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run creative-job-runner
```

Expected: All 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/creative-pipeline/creative-job-runner.ts
git commit -m "feat(core): migrate polished runner trigger from job.submitted to polished.submitted"
```

---

## Task 4: Approval Config

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/approval-config.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/approval-config.test.ts`

- [ ] **Step 1: Write tests for approval config**

Create `packages/core/src/creative-pipeline/__tests__/approval-config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { shouldRequireApproval } from "../ugc/approval-config.js";

describe("shouldRequireApproval", () => {
  it("requires approval for planning when trust < 55", () => {
    expect(
      shouldRequireApproval({ phase: "planning", trustLevel: 30, deploymentType: "standard" }),
    ).toBe(true);
  });

  it("skips approval for planning when trust >= 55", () => {
    expect(
      shouldRequireApproval({ phase: "planning", trustLevel: 55, deploymentType: "standard" }),
    ).toBe(false);
  });

  it("requires approval for production when trust < 80", () => {
    expect(
      shouldRequireApproval({ phase: "production", trustLevel: 70, deploymentType: "standard" }),
    ).toBe(true);
  });

  it("skips approval for production when trust >= 80", () => {
    expect(
      shouldRequireApproval({ phase: "production", trustLevel: 80, deploymentType: "standard" }),
    ).toBe(false);
  });

  it("requires approval for delivery when trust < 80", () => {
    expect(
      shouldRequireApproval({ phase: "delivery", trustLevel: 79, deploymentType: "standard" }),
    ).toBe(true);
  });

  it("skips approval for delivery when trust >= 80", () => {
    expect(
      shouldRequireApproval({ phase: "delivery", trustLevel: 80, deploymentType: "standard" }),
    ).toBe(false);
  });

  it("always requires approval for zero trust", () => {
    expect(
      shouldRequireApproval({ phase: "planning", trustLevel: 0, deploymentType: "standard" }),
    ).toBe(true);
    expect(
      shouldRequireApproval({ phase: "scripting", trustLevel: 0, deploymentType: "standard" }),
    ).toBe(true);
    expect(
      shouldRequireApproval({ phase: "production", trustLevel: 0, deploymentType: "standard" }),
    ).toBe(true);
    expect(
      shouldRequireApproval({ phase: "delivery", trustLevel: 0, deploymentType: "standard" }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run approval-config
```

- [ ] **Step 3: Create the ugc directory and implement approval-config.ts**

```bash
mkdir -p /Users/jasonljc/switchboard/packages/core/src/creative-pipeline/ugc
```

Create `packages/core/src/creative-pipeline/ugc/approval-config.ts`:

```typescript
// packages/core/src/creative-pipeline/ugc/approval-config.ts

const UGC_PHASE_ORDER = ["planning", "scripting", "production", "delivery"] as const;
export type UgcPhase = (typeof UGC_PHASE_ORDER)[number];
export { UGC_PHASE_ORDER };

export interface ApprovalConfig {
  autoApproveThresholds: Record<UgcPhase, number>;
  alwaysRequireApproval: UgcPhase[];
}

export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  autoApproveThresholds: {
    planning: 55,
    scripting: 55,
    production: 80,
    delivery: 80,
  },
  alwaysRequireApproval: [],
};

export function shouldRequireApproval(ctx: {
  phase: string;
  trustLevel: number;
  deploymentType: string;
}): boolean {
  const config = DEFAULT_APPROVAL_CONFIG;
  const phase = ctx.phase as UgcPhase;
  if (config.alwaysRequireApproval.includes(phase)) return true;
  const threshold = config.autoApproveThresholds[phase];
  if (threshold === undefined) return true; // unknown phase → require approval
  return ctx.trustLevel < threshold;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run approval-config
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/approval-config.ts packages/core/src/creative-pipeline/__tests__/approval-config.test.ts
git commit -m "feat(core): add UGC approval config with trust-level-aware thresholds"
```

---

## Task 5: UGC Job Runner Skeleton

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/ugc-job-runner.test.ts`

- [ ] **Step 1: Write tests for UGC job runner**

Create `packages/core/src/creative-pipeline/__tests__/ugc-job-runner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeUgcPipeline } from "../ugc/ugc-job-runner.js";

function createMockStep() {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
    waitForEvent: vi.fn(() => ({ data: { action: "continue", phase: "planning" } })),
    sendEvent: vi.fn(),
  };
}

function createMockDeps() {
  return {
    jobStore: {
      findById: vi.fn(),
      updateUgcPhase: vi.fn(),
      stopUgc: vi.fn(),
      failUgc: vi.fn(),
    },
    creatorStore: { findByDeployment: vi.fn().mockResolvedValue([]) },
    deploymentStore: {
      findById: vi.fn().mockResolvedValue({ listing: { trustScore: 0 }, type: "standard" }),
    },
  };
}

describe("executeUgcPipeline", () => {
  let step: ReturnType<typeof createMockStep>;
  let deps: ReturnType<typeof createMockDeps>;

  const eventData = {
    jobId: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
  };

  const mockUgcJob = {
    id: "job_1",
    deploymentId: "dep_1",
    mode: "ugc",
    ugcPhase: null,
    ugcPhaseOutputs: null,
    ugcConfig: {},
  };

  beforeEach(() => {
    step = createMockStep();
    deps = createMockDeps();
    deps.jobStore.findById.mockResolvedValue(mockUgcJob);
    deps.jobStore.updateUgcPhase.mockResolvedValue(mockUgcJob);
  });

  it("runs all 4 phases when approval is granted at each gate", async () => {
    await executeUgcPipeline(eventData, step as never, deps as never);

    // load-job + preload-context + 4 phase runs + 4 saves = 10 step.run calls
    expect(step.run).toHaveBeenCalledTimes(10);

    // 4 phase completion events + 1 final completed event = 5 sendEvent calls
    expect(step.sendEvent).toHaveBeenCalledTimes(5);

    // 4 approval waits (one per phase, trust=0 requires all)
    expect(step.waitForEvent).toHaveBeenCalledTimes(4);

    // Final event is ugc.completed
    const lastSendCall = step.sendEvent.mock.calls[4];
    expect(lastSendCall[1]).toMatchObject({
      name: "creative-pipeline/ugc.completed",
    });
  });

  it("stops pipeline when approval returns stop", async () => {
    step.waitForEvent
      .mockResolvedValueOnce({ data: { action: "continue", phase: "planning" } })
      .mockResolvedValueOnce({ data: { action: "stop", phase: "scripting" } });

    await executeUgcPipeline(eventData, step as never, deps as never);

    // load-job + preload + planning run + save + scripting run + save + stop = 7
    expect(step.run).toHaveBeenCalledTimes(7);
    expect(deps.jobStore.stopUgc).toHaveBeenCalledWith("job_1", "scripting");
  });

  it("stops pipeline on approval timeout (null)", async () => {
    step.waitForEvent.mockResolvedValueOnce(null);

    await executeUgcPipeline(eventData, step as never, deps as never);

    expect(deps.jobStore.stopUgc).toHaveBeenCalledWith("job_1", "planning");
  });

  it("throws if job not found", async () => {
    deps.jobStore.findById.mockResolvedValue(null);

    await expect(executeUgcPipeline(eventData, step as never, deps as never)).rejects.toThrow(
      "UGC job not found: job_1",
    );
  });

  it("resumes from last completed phase", async () => {
    const resumeJob = {
      ...mockUgcJob,
      ugcPhase: "scripting",
      ugcPhaseOutputs: { planning: { done: true } },
    };
    deps.jobStore.findById.mockResolvedValue(resumeJob);

    await executeUgcPipeline(eventData, step as never, deps as never);

    // load-job + preload + scripting run + save + production run + save + delivery run + save = 8
    // (skips planning entirely)
    expect(step.run).toHaveBeenCalledTimes(8);

    // Verify first phase run is scripting, not planning
    const phaseRunCalls = step.run.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].startsWith("phase-"),
    );
    expect(phaseRunCalls[0][0]).toBe("phase-scripting");
  });

  it("skips approval gates when trust level is high enough", async () => {
    // Trust 80 = autonomous for planning+scripting (threshold 55), still gated for production+delivery (threshold 80)
    deps.deploymentStore.findById.mockResolvedValue({
      listing: { trustScore: 80 },
      type: "standard",
    });

    await executeUgcPipeline(eventData, step as never, deps as never);

    // Only 0 approval waits — trust 80 meets all thresholds (planning=55, scripting=55, production=80, delivery=80)
    expect(step.waitForEvent).toHaveBeenCalledTimes(0);
  });

  it("emits ugc-phase.completed event after each phase", async () => {
    await executeUgcPipeline(eventData, step as never, deps as never);

    const phaseCompleteEvents = step.sendEvent.mock.calls.filter(
      (c) => c[1]?.name === "creative-pipeline/ugc-phase.completed",
    );
    expect(phaseCompleteEvents).toHaveLength(4);
    expect(phaseCompleteEvents[0][1].data.phase).toBe("planning");
    expect(phaseCompleteEvents[1][1].data.phase).toBe("scripting");
    expect(phaseCompleteEvents[2][1].data.phase).toBe("production");
    expect(phaseCompleteEvents[3][1].data.phase).toBe("delivery");
  });

  it("matches approval event on both jobId and phase", async () => {
    await executeUgcPipeline(eventData, step as never, deps as never);

    const firstWait = step.waitForEvent.mock.calls[0];
    expect(firstWait[1]).toMatchObject({
      event: "creative-pipeline/ugc-phase.approved",
      match: "data.jobId",
    });
    // The `if` clause should filter by phase
    expect(firstWait[1].if).toContain("planning");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run ugc-job-runner
```

- [ ] **Step 3: Implement ugc-job-runner.ts**

Create `packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts`:

```typescript
// packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts
import { inngestClient } from "../inngest-client.js";
import { shouldRequireApproval, UGC_PHASE_ORDER } from "./approval-config.js";
import type { UgcPhase } from "./approval-config.js";
import type { CreativeJob } from "@switchboard/schemas";

// ── Interfaces ──

interface UgcJobEventData {
  jobId: string;
  taskId: string;
  organizationId: string;
  deploymentId: string;
}

interface UgcStepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
  waitForEvent: (
    id: string,
    opts: { event: string; timeout: string; match: string; if?: string },
  ) => Promise<{ data: { action: string; phase?: string } } | null>;
  sendEvent: (id: string, event: { name: string; data: Record<string, unknown> }) => Promise<void>;
}

interface UgcJobStore {
  findById(id: string): Promise<CreativeJob | null>;
  updateUgcPhase(id: string, phase: string, outputs: Record<string, unknown>): Promise<CreativeJob>;
  stopUgc(id: string, phase: string): Promise<CreativeJob>;
  failUgc(id: string, phase: string, error: Record<string, unknown>): Promise<CreativeJob>;
}

interface CreatorStore {
  findByDeployment(deploymentId: string): Promise<unknown[]>;
}

interface DeploymentStore {
  findById(id: string): Promise<{ listing?: { trustScore?: number }; type?: string } | null>;
}

interface UgcPipelineDeps {
  jobStore: UgcJobStore;
  creatorStore: CreatorStore;
  deploymentStore: DeploymentStore;
}

interface UgcPipelineContext {
  creatorPool: unknown[];
  trustLevel: number;
  deploymentType: string;
}

// ── Phase execution (no-op stubs for SP2) ──

function executePhase(
  phase: UgcPhase,
  _ctx: {
    job: CreativeJob;
    context: UgcPipelineContext;
    previousPhaseOutputs: Record<string, unknown>;
  },
): Record<string, unknown> {
  // SP3-SP5 replace these with real implementations
  return { phase, status: "no-op", completedAt: new Date().toISOString() };
}

function getNextPhase(phase: UgcPhase): string {
  const idx = UGC_PHASE_ORDER.indexOf(phase);
  if (idx === UGC_PHASE_ORDER.length - 1) return "complete";
  return UGC_PHASE_ORDER[idx + 1];
}

// ── Preload context ──

async function preloadContext(
  job: CreativeJob,
  deps: UgcPipelineDeps,
): Promise<UgcPipelineContext> {
  const [creatorPool, deployment] = await Promise.all([
    deps.creatorStore.findByDeployment(job.deploymentId),
    deps.deploymentStore.findById(job.deploymentId),
  ]);

  return {
    creatorPool,
    trustLevel: deployment?.listing?.trustScore ?? 0,
    deploymentType: deployment?.type ?? "standard",
  };
}

// ── Core pipeline logic ──

const APPROVAL_TIMEOUT = "24h";

export async function executeUgcPipeline(
  eventData: UgcJobEventData,
  step: UgcStepTools,
  deps: UgcPipelineDeps,
): Promise<void> {
  const job = await step.run("load-job", () => deps.jobStore.findById(eventData.jobId));
  if (!job) throw new Error(`UGC job not found: ${eventData.jobId}`);

  const context = await step.run("preload-context", () => preloadContext(job, deps));

  let phaseOutputs: Record<string, unknown> = (job.ugcPhaseOutputs ?? {}) as Record<
    string,
    unknown
  >;

  // Resume from last completed phase
  const startPhase = (job.ugcPhase as UgcPhase) ?? "planning";
  const startIdx = UGC_PHASE_ORDER.indexOf(startPhase);

  for (let i = startIdx; i < UGC_PHASE_ORDER.length; i++) {
    const phase = UGC_PHASE_ORDER[i];
    const startedAt = Date.now();

    // Execute phase
    const output = await step.run(`phase-${phase}`, () =>
      executePhase(phase, { job, context, previousPhaseOutputs: phaseOutputs }),
    );

    const durationMs = Date.now() - startedAt;

    // Persist
    phaseOutputs = { ...phaseOutputs, [phase]: output };
    const nextPhase = getNextPhase(phase);

    await step.run(`save-${phase}`, () =>
      deps.jobStore.updateUgcPhase(job.id, nextPhase, phaseOutputs),
    );

    // Emit phase completion event
    await step.sendEvent(`emit-${phase}-complete`, {
      name: "creative-pipeline/ugc-phase.completed",
      data: {
        jobId: job.id,
        phase,
        durationMs,
        substagesCompleted: [],
        resultSummary: {},
      },
    });

    // Approval gate
    if (
      shouldRequireApproval({
        phase,
        trustLevel: context.trustLevel,
        deploymentType: context.deploymentType,
      })
    ) {
      const approval = await step.waitForEvent(`wait-approval-${phase}`, {
        event: "creative-pipeline/ugc-phase.approved",
        timeout: APPROVAL_TIMEOUT,
        match: "data.jobId",
        if: `async.data.phase == '${phase}'`,
      });

      if (!approval || approval.data.action === "stop") {
        await step.run(`stop-at-${phase}`, () => deps.jobStore.stopUgc(job.id, phase));

        await step.sendEvent(`emit-stopped`, {
          name: "creative-pipeline/ugc.stopped",
          data: { jobId: job.id, stoppedAtPhase: phase },
        });
        return;
      }
    }

    if (nextPhase === "complete") break;
  }

  // Emit final completion event
  await step.sendEvent("emit-completed", {
    name: "creative-pipeline/ugc.completed",
    data: { jobId: job.id, assetsProduced: 0, failed: 0 },
  });
}

// ── Inngest function definition ──

export function createUgcJobRunner(deps: UgcPipelineDeps) {
  return inngestClient.createFunction(
    {
      id: "ugc-job-runner",
      name: "UGC Pipeline Job Runner",
      retries: 3,
      triggers: [{ event: "creative-pipeline/ugc.submitted" }],
    },
    async ({ event, step }: { event: { data: UgcJobEventData }; step: UgcStepTools }) => {
      await executeUgcPipeline(event.data, step, deps);
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run ugc-job-runner
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts packages/core/src/creative-pipeline/__tests__/ugc-job-runner.test.ts
git commit -m "feat(core): add UGC job runner skeleton with phase loop, approval gates, and resume"
```

---

## Task 6: Barrel Exports + Inngest Wiring

**Files:**

- Modify: `packages/core/src/creative-pipeline/index.ts`
- Modify: `apps/api/src/bootstrap/inngest.ts`

- [ ] **Step 1: Add exports to creative-pipeline barrel**

Add to `packages/core/src/creative-pipeline/index.ts`:

```typescript
export { createModeDispatcher, executeModeDispatch } from "./mode-dispatcher.js";
export { createUgcJobRunner, executeUgcPipeline } from "./ugc/ugc-job-runner.js";
export { shouldRequireApproval, DEFAULT_APPROVAL_CONFIG } from "./ugc/approval-config.js";
export type { UgcPhase, ApprovalConfig } from "./ugc/approval-config.js";
```

- [ ] **Step 2: Wire mode dispatcher + UGC runner into inngest.ts**

In `apps/api/src/bootstrap/inngest.ts`:

Add imports:

```typescript
import {
  inngestClient,
  createCreativeJobRunner,
  createModeDispatcher,
  createUgcJobRunner,
} from "@switchboard/core/creative-pipeline";
import {
  PrismaCreativeJobStore,
  PrismaDeploymentStore,
  PrismaListingStore,
  PrismaDeploymentConnectionStore,
  PrismaAgentTaskStore,
  PrismaCreatorIdentityStore,
  decryptCredentials,
} from "@switchboard/db";
```

After the existing `jobStore` creation (line 38), add:

```typescript
const creatorStore = new PrismaCreatorIdentityStore(app.prisma);
```

Update the `functions` array (line 102-106) to include mode dispatcher and UGC runner:

```typescript
    functions: [
      createModeDispatcher(),
      createCreativeJobRunner(jobStore, { apiKey }, openaiApiKey ? { openaiApiKey } : undefined),
      createUgcJobRunner({ jobStore, creatorStore, deploymentStore }),
      createWeeklyAuditCron(adOptimizerDeps),
      createDailyCheckCron(adOptimizerDeps),
    ],
```

- [ ] **Step 3: Build to verify**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core build && npx pnpm@9.15.4 --filter @switchboard/api build
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/creative-pipeline/index.ts apps/api/src/bootstrap/inngest.ts
git commit -m "feat(core): export UGC modules and wire mode dispatcher + runner into Inngest"
```

---

## Task 7: Full Build + Test Verification

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 test
```

Expected: All tests pass. No regressions in existing creative pipeline tests.

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck
```

- [ ] **Step 3: Run lint**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 lint
```

- [ ] **Step 4: Fix any issues, commit if needed**
