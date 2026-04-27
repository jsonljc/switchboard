# Platform Convergence Phase 5 — Migrate Creative Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Creative pipeline jobs enter through the platform contract via PipelineMode, which wraps the existing Inngest event dispatch.

**Architecture:** PipelineMode dispatches Inngest events internally and returns `ExecutionResult` with `outcome: "queued"` and a `jobId`. The Inngest job runner is unchanged — it's a good engine. PipelineMode also handles mode dispatch (polished vs UGC) using the existing `executeModeDispatch()`. Creative intents auto-register at boot.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-16-platform-convergence-design.md` (Phase 5)

---

## Key Design Decision

Pipeline work is async. Unlike skill/cartridge modes that return a completed result synchronously, PipelineMode dispatches an Inngest event and returns immediately with `outcome: "queued"`. The actual execution happens asynchronously via the Inngest job runner. The platform contract handles this via the `jobId` field on `ExecutionResult`.

---

## File Map

| File                                                                     | Action | Responsibility                                |
| ------------------------------------------------------------------------ | ------ | --------------------------------------------- |
| `packages/core/src/platform/modes/pipeline-mode.ts`                      | Create | ExecutionMode wrapping Inngest event dispatch |
| `packages/core/src/platform/pipeline-intent-registrar.ts`                | Create | Auto-register creative pipeline intents       |
| `packages/core/src/platform/modes/index.ts`                              | Modify | Add PipelineMode export                       |
| `packages/core/src/platform/index.ts`                                    | Modify | Add pipeline registrar export                 |
| `packages/core/src/platform/__tests__/pipeline-mode.test.ts`             | Create | PipelineMode unit tests                       |
| `packages/core/src/platform/__tests__/pipeline-intent-registrar.test.ts` | Create | Auto-registration tests                       |

---

## Task 1: Build PipelineMode

**Files:**

- Create: `packages/core/src/platform/modes/pipeline-mode.ts`
- Create: `packages/core/src/platform/__tests__/pipeline-mode.test.ts`

- [ ] **Step 1: Read existing pipeline files**

Read these to understand how Inngest events are dispatched:

- `packages/core/src/creative-pipeline/inngest-client.ts` — event types
- `packages/core/src/creative-pipeline/mode-dispatcher.ts` — executeModeDispatch()
- `packages/core/src/platform/execution-context.ts` — ExecutionMode interface
- `packages/core/src/platform/modes/skill-mode.ts` — pattern to follow

- [ ] **Step 2: Write the test**

Test cases:

1. "dispatches Inngest event and returns queued result" — mock event sender, verify outcome "queued" with jobId
2. "dispatches polished event for polished mode" — verify event name "creative-pipeline/job.submitted" with mode "polished"
3. "dispatches UGC event when parameters specify ugc mode" — verify mode "ugc" in event data
4. "includes workUnit metadata in event data" — verify jobId, organizationId, deploymentId in event data
5. "returns failed when event dispatch throws" — mock sender to throw, verify outcome "failed"

Use a mock event sender:

```typescript
const mockSendEvent = vi.fn().mockResolvedValue(undefined);
```

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/platform/modes/pipeline-mode.ts
import type { ExecutionMode, ExecutionContext } from "../execution-context.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";
import type { WorkUnit } from "../work-unit.js";

export interface PipelineEventSender {
  send(event: { name: string; data: Record<string, unknown> }): Promise<void>;
}

export interface PipelineModeConfig {
  eventSender: PipelineEventSender;
}

export class PipelineMode implements ExecutionMode {
  name = "pipeline" as const;

  constructor(private config: PipelineModeConfig) {}

  async execute(
    workUnit: WorkUnit,
    _constraints: ExecutionConstraints,
    _context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const pipelineMode = (workUnit.parameters.mode as string) ?? "polished";

    try {
      await this.config.eventSender.send({
        name: "creative-pipeline/job.submitted",
        data: {
          jobId: workUnit.id,
          taskId: workUnit.id,
          organizationId: workUnit.organizationId,
          deploymentId: workUnit.parameters.deploymentId ?? workUnit.id,
          mode: pipelineMode,
        },
      });

      return {
        workUnitId: workUnit.id,
        outcome: "queued",
        summary: `Creative pipeline job queued (${pipelineMode} mode)`,
        outputs: { pipelineMode },
        mode: "pipeline",
        durationMs: Date.now() - startTime,
        traceId: workUnit.traceId,
        jobId: workUnit.id,
      };
    } catch (err) {
      return {
        workUnitId: workUnit.id,
        outcome: "failed",
        summary: err instanceof Error ? err.message : "Pipeline dispatch failed",
        outputs: {},
        mode: "pipeline",
        durationMs: Date.now() - startTime,
        traceId: workUnit.traceId,
        error: {
          code: "PIPELINE_DISPATCH_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- pipeline-mode`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add PipelineMode — ExecutionMode wrapping Inngest dispatch"
```

---

## Task 2: Build pipeline intent registrar

**Files:**

- Create: `packages/core/src/platform/pipeline-intent-registrar.ts`
- Create: `packages/core/src/platform/__tests__/pipeline-intent-registrar.test.ts`

- [ ] **Step 1: Write the test**

Test cases:

1. "registers creative.produce intent" — default polished pipeline
2. "registers creative.ugc.produce intent" — UGC pipeline
3. "sets executor binding to pipeline mode" — executor: { mode: "pipeline", pipelineId: "polished" }
4. "sets budgetClass to expensive" — creative jobs use LLM + video generation
5. "allows all triggers"

- [ ] **Step 2: Write the implementation**

```typescript
// packages/core/src/platform/pipeline-intent-registrar.ts
import type { IntentRegistry } from "./intent-registry.js";
import type { IntentRegistration } from "./intent-registration.js";

export interface PipelineDefinition {
  id: string;
  intent: string;
  description: string;
  timeoutMs?: number;
}

const DEFAULT_PIPELINES: PipelineDefinition[] = [
  {
    id: "polished",
    intent: "creative.produce",
    description: "Produce polished video ad from brief",
    timeoutMs: 300_000,
  },
  {
    id: "ugc",
    intent: "creative.ugc.produce",
    description: "Produce UGC-style video ad from brief",
    timeoutMs: 300_000,
  },
];

export function registerPipelineIntents(
  registry: IntentRegistry,
  pipelines: PipelineDefinition[] = DEFAULT_PIPELINES,
): void {
  for (const pipeline of pipelines) {
    const registration: IntentRegistration = {
      intent: pipeline.intent,
      defaultMode: "pipeline",
      allowedModes: ["pipeline"],
      executor: { mode: "pipeline", pipelineId: pipeline.id },
      parameterSchema: { type: "object" },
      mutationClass: "write",
      budgetClass: "expensive",
      approvalPolicy: "threshold",
      idempotent: false,
      allowedTriggers: ["chat", "api", "schedule", "internal"],
      timeoutMs: pipeline.timeoutMs ?? 300_000,
      retryable: false,
    };
    registry.register(registration);
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- pipeline-intent-registrar`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): add pipeline intent registrar for creative pipeline"
```

---

## Task 3: Barrel exports and verification

**Files:**

- Modify: `packages/core/src/platform/modes/index.ts`
- Modify: `packages/core/src/platform/index.ts`

- [ ] **Step 1: Add PipelineMode to modes barrel**

Add to `packages/core/src/platform/modes/index.ts`:

```typescript
export { PipelineMode } from "./pipeline-mode.js";
export type { PipelineModeConfig, PipelineEventSender } from "./pipeline-mode.js";
```

- [ ] **Step 2: Add pipeline registrar to platform barrel**

Add to `packages/core/src/platform/index.ts`:

```typescript
// Pipeline mode
export { PipelineMode } from "./modes/index.js";
export type { PipelineModeConfig, PipelineEventSender } from "./modes/index.js";

// Pipeline registrar
export { registerPipelineIntents } from "./pipeline-intent-registrar.js";
export type { PipelineDefinition } from "./pipeline-intent-registrar.js";
```

- [ ] **Step 3: Run full test suite**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): add PipelineMode and pipeline registrar to platform exports"
```
