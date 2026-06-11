# Creative dead-letter completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A retry-exhausted creative job (polished or ugc) reaches a terminal `failed` lifecycle state and surfaces to the operator as failed, by consuming the `creative.polished.failed` / `creative.ugc.failed` dead-letter the pipeline now emits.

**Architecture:** A new Inngest consumer (`creative-failure-recorder`) triggers on the dead-letter events, loads the job, and persists a terminal marker (`stageFailure` for polished, `failUgc` for ugc). The shared `makeOnFailureHandler` is extended to propagate the trigger payload (jobId) onto the emitted event so the consumer knows which job died. The status mapper and decision workflow treat `stageFailure` as terminal.

**Tech Stack:** TypeScript monorepo (pnpm/Turbo), Prisma (Postgres), Inngest, Zod, Vitest. ESM, `.js` import extensions.

**Spec:** `docs/superpowers/specs/2026-06-11-mira-deadletter-completion-design.md`

**Pre-flight (once, before Task 1):** In the implementation worktree, ensure deps are installed (`pnpm install` already run), schemas are built (`pnpm --filter @switchboard/schemas build`), and `DATABASE_URL` is available for Prisma (source from the repo-root `.env`). Run `pnpm db:generate` before `pnpm typecheck`.

---

### Task 1: Add the `stageFailure` terminal marker column (Prisma + Zod + migration)

**Files:**
- Modify: `packages/db/prisma/schema.prisma:1383-1386` (CreativeJob polished state block)
- Modify: `packages/schemas/src/creative-job.ts:229` (CreativeJobSchema)
- Create: `packages/db/prisma/migrations/20260611150000_creative_job_stage_failure/migration.sql`

- [ ] **Step 1: Add the Prisma column.** In `schema.prisma`, in the `// Pipeline state (polished)` block, after `productionTier String?` (line 1386), add:

```prisma
  // Terminal failure marker for a retry-exhausted polished render (dead-letter
  // consumer write). Mirrors ugcFailure; null = not failed.
  stageFailure   Json?
```

- [ ] **Step 2: Add the Zod field.** In `creative-job.ts`, in `CreativeJobSchema`, immediately after `stoppedAt: z.string().nullable(),` (line 229), add:

```typescript
  stageFailure: z.record(z.unknown()).nullable().optional(),
```

- [ ] **Step 3: Hand-write the migration** (migrate dev needs a TTY; mirror the latest migration's style). Read `packages/db/prisma/migrations/20260611120000_creative_job_revenue_proven_promoted_at/migration.sql` for the exact header style, then write `20260611150000_creative_job_stage_failure/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "CreativeJob" ADD COLUMN "stageFailure" JSONB;
```

- [ ] **Step 4: Apply + regenerate + verify no drift.**

Run (with `DATABASE_URL` exported from root `.env`):
```bash
pnpm db:migrate      # prisma migrate deploy: applies the new migration
pnpm db:generate     # regenerate the Prisma client
pnpm --filter @switchboard/schemas build
pnpm db:check-drift  # must report no drift
```
Expected: migrate deploy applies `20260611150000_creative_job_stage_failure`; check-drift is clean.

- [ ] **Step 5: Commit.**

```bash
git add packages/db/prisma/schema.prisma packages/schemas/src/creative-job.ts packages/db/prisma/migrations/20260611150000_creative_job_stage_failure
git commit -m "feat(db): add CreativeJob.stageFailure terminal marker column

Mirrors ugcFailure for the polished pipeline. D5-F1/D9-F2 dead-letter completion."
```

---

### Task 2: `failPolished` store method + `updateStage` clears `stageFailure` (TDD)

**Files:**
- Modify: `packages/db/src/stores/prisma-creative-job-store.ts` (add `failPolished`; edit `updateStage` ~129-146)
- Test: `packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts`

- [ ] **Step 1: Write the failing tests.** Mirror the existing mocked-Prisma pattern in this file (Prisma is mocked; CI has no Postgres). Add:

```typescript
describe("failPolished", () => {
  it("writes stageFailure org-scoped after asserting polished mode", async () => {
    const failure = { kind: "terminal", code: "ASYNC_JOB_FAILED", message: "boom" };
    prismaMock.creativeJob.findUnique.mockResolvedValueOnce({ mode: "polished" }); // assertMode
    prismaMock.creativeJob.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.creativeJob.findFirstOrThrow.mockResolvedValueOnce({ id: "job_1" });

    await store.failPolished("org_1", "job_1", failure);

    expect(prismaMock.creativeJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job_1", organizationId: "org_1" },
      data: { stageFailure: failure },
    });
  });

  it("throws StaleVersionError when no row matches (count 0)", async () => {
    prismaMock.creativeJob.findUnique.mockResolvedValueOnce({ mode: "polished" });
    prismaMock.creativeJob.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(store.failPolished("org_1", "missing", {})).rejects.toThrow(StaleVersionError);
  });

  it("rejects a ugc-mode job (assertMode)", async () => {
    prismaMock.creativeJob.findUnique.mockResolvedValueOnce({ mode: "ugc" });
    await expect(store.failPolished("org_1", "job_ugc", {})).rejects.toThrow(
      "Cannot update polished stage on a UGC-mode job",
    );
  });
});

describe("updateStage clears stageFailure", () => {
  it("nulls stageFailure on a successful stage save", async () => {
    prismaMock.creativeJob.findUnique.mockResolvedValueOnce({ mode: "polished" }); // assertMode
    prismaMock.creativeJob.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.creativeJob.findFirstOrThrow.mockResolvedValueOnce({ id: "job_1" });

    await store.updateStage("org_1", "job_1", "hooks", { trends: {} });

    expect(prismaMock.creativeJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job_1", organizationId: "org_1" },
      data: { currentStage: "hooks", stageOutputs: { trends: {} }, stageFailure: Prisma.JsonNull },
    });
  });
});
```
Match the existing test's mock-setup helpers/names (`prismaMock`, `store`, `StaleVersionError`, `Prisma` imports); read the top of the test file first and adapt the snippets to its exact harness.

- [ ] **Step 2: Run the tests, verify they fail.**

Run: `pnpm --filter @switchboard/db test -- prisma-creative-job-store`
Expected: FAIL (`failPolished` is not a function; updateStage data lacks stageFailure).

- [ ] **Step 3: Implement.** Add `failPolished` after `updateProductionTier` (~line 170), mirroring `failUgc`:

```typescript
  /**
   * Persist a terminal failure marker on a polished job (dead-letter consumer write).
   * Mirrors failUgc for the polished lifecycle. Org-scoped updateMany (doctrine #12);
   * count===0 ⇒ missing/cross-org ⇒ StaleVersionError.
   */
  async failPolished(
    organizationId: string,
    id: string,
    failure: Record<string, unknown>,
  ): Promise<CreativeJob> {
    await this.assertMode(id, "polished");
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: { stageFailure: failure as object },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    const row = await this.prisma.creativeJob.findFirstOrThrow({ where: { id, organizationId } });
    return row as unknown as CreativeJob;
  }
```

In `updateStage`, change the `data` block (line ~138-141) to clear any prior failure on forward progress:

```typescript
      data: {
        currentStage: stage,
        stageOutputs: stageOutputs as object,
        // A replayed run that progresses is no longer failed: clear any prior marker.
        stageFailure: Prisma.JsonNull,
      },
```

- [ ] **Step 4: Run the tests, verify they pass.**

Run: `pnpm --filter @switchboard/db test -- prisma-creative-job-store`
Expected: PASS.

- [ ] **Step 5: Run the api suite** (store-shape change can break app spies on updateStage; memory rule).

Run: `pnpm --filter api test`
Expected: PASS (fix any updateStage spy that asserts the old `data` shape by adding `stageFailure: Prisma.JsonNull`).

- [ ] **Step 6: Commit.**

```bash
git add packages/db/src/stores/prisma-creative-job-store.ts packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts
git commit -m "feat(db): failPolished marker + clear stageFailure on stage progress

D5-F1/D9-F2: terminal polished failure persistence; self-heal on replay."
```

---

### Task 3: status-mapper maps `stageFailure` to `failed` (TDD)

**Files:**
- Modify: `packages/core/src/creative-read-model/status-mapper.ts:46-67`
- Test: `packages/core/src/creative-read-model/__tests__/status-mapper.test.ts`

- [ ] **Step 1: Write the failing test.** Read the existing test to reuse its `CreativeJob` factory/fixture, then add:

```typescript
it("maps a polished job with stageFailure to failed (beats awaiting_review)", () => {
  const job = makeJob({
    mode: "polished",
    currentStage: "hooks",
    stageOutputs: { trends: { ok: true } }, // would otherwise be awaiting_review
    stageFailure: { kind: "terminal", code: "ASYNC_JOB_FAILED", message: "boom" },
  });
  expect(mapCreativeJobToMiraStatus(job)).toBe("failed");
});

it("ignores a null stageFailure (still awaiting_review)", () => {
  const job = makeJob({
    mode: "polished",
    currentStage: "hooks",
    stageOutputs: { trends: { ok: true } },
    stageFailure: null,
  });
  expect(mapCreativeJobToMiraStatus(job)).toBe("awaiting_review");
});
```
(Use whatever the file's job factory is named; if it builds jobs inline, follow that.)

- [ ] **Step 2: Run, verify it fails.**

Run: `pnpm --filter @switchboard/core test -- status-mapper`
Expected: FAIL (returns `awaiting_review` for the stageFailure case).

- [ ] **Step 3: Implement.** In `mapCreativeJobToMiraStatus`, in the mode-agnostic failure section, add the polished failure rule right after the existing polished `productionErrorsWithoutVideo` line (line 52), before the `stoppedAt` check (line 53):

```typescript
  if (job.mode !== "ugc" && job.stageFailure != null) return "failed";
```

- [ ] **Step 4: Run, verify it passes.**

Run: `pnpm --filter @switchboard/core test -- status-mapper`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/creative-read-model/status-mapper.ts packages/core/src/creative-read-model/__tests__/status-mapper.test.ts
git commit -m "feat(core): map polished stageFailure to failed status

D5-F1: retry-exhausted polished job reads as failed, drops from inFlight."
```

---

### Task 4: decision-workflow rejects continue/stop on a failed polished job (TDD)

**Files:**
- Modify: `apps/api/src/services/workflows/creative-job-decision-workflow.ts:35`
- Test: `apps/api/src/services/workflows/__tests__/creative-job-decision-workflow.test.ts`

- [ ] **Step 1: Write the failing test.** Reuse the existing test's job-store mock/fixtures, then add:

```typescript
it("rejects continue on a polished job carrying stageFailure", async () => {
  const job = makeJob({ mode: "polished", currentStage: "hooks", stageFailure: { code: "X" } });
  jobStoreMock.findById.mockResolvedValue(job);
  const wf = buildCreativeJobDecisionWorkflow(prismaStub, "continue");

  const res = await wf.execute(makeWorkUnit({ jobId: job.id, action: "continue" }));

  expect(res.outcome).toBe("failed");
  expect(res.error?.code).toBe("CREATIVE_JOB_NOT_AWAITING_APPROVAL");
});
```
(Adapt `makeJob`/`makeWorkUnit`/`jobStoreMock`/`prismaStub` to the file's actual harness; read it first.)

- [ ] **Step 2: Run, verify it fails.**

Run: `pnpm --filter api test -- creative-job-decision-workflow`
Expected: FAIL (the guard does not yet treat stageFailure as terminal; it proceeds to queue).

- [ ] **Step 3: Implement.** Change the `polishedDone` guard (line 35):

```typescript
      const polishedDone =
        job.mode !== "ugc" && (job.currentStage === "complete" || job.stageFailure != null);
```

- [ ] **Step 4: Run, verify it passes.**

Run: `pnpm --filter api test -- creative-job-decision-workflow`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/services/workflows/creative-job-decision-workflow.ts apps/api/src/services/workflows/__tests__/creative-job-decision-workflow.test.ts
git commit -m "feat(api): reject creative continue/stop on a failed polished job

D5-F1: stageFailure is terminal; a forced continue no longer phantom-queues."
```

---

### Task 5: `makeOnFailureHandler` propagates the trigger payload onto the dead-letter event (TDD)

**Files:**
- Modify: `packages/core/src/observability/async-failure-handler.ts:77-80,120-130`
- Test: `packages/core/src/observability/__tests__/async-failure-handler.test.ts`

- [ ] **Step 1: Write the failing test.** Reuse the existing test's fake context (capturing `inngest.send`), then add:

```typescript
it("includes the original trigger payload on the emitted .failed event", async () => {
  const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
  const ctx = makeCtx({ send: async (e) => void sent.push(e) });
  const handler = makeOnFailureHandler(
    { functionId: "creative-job-runner", eventDomain: "creative.polished", riskCategory: "medium", alert: false },
    ctx,
  );

  await handler({
    error: new Error("boom"),
    event: { data: { run_id: "run_1", event: { name: "creative-pipeline/polished.submitted", data: { jobId: "job_1", organizationId: "org_1" } } } },
  });

  expect(sent).toHaveLength(1);
  expect(sent[0]!.name).toBe("creative.polished.failed");
  expect(sent[0]!.data.trigger).toEqual({ jobId: "job_1", organizationId: "org_1" });
  expect(sent[0]!.data.code).toBe("ASYNC_JOB_FAILED"); // envelope fields still present
});

it("emits cleanly with no trigger key when the original payload is absent", async () => {
  const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
  const ctx = makeCtx({ send: async (e) => void sent.push(e) });
  const handler = makeOnFailureHandler(
    { functionId: "creative-job-runner", eventDomain: "creative.polished", riskCategory: "medium", alert: false },
    ctx,
  );
  await handler({ error: new Error("boom"), event: { data: { run_id: "run_1" } } });
  expect(sent[0]!.data).not.toHaveProperty("trigger");
});
```
(Adapt `makeCtx` to the test's existing helper for building an `AsyncFailureContext`.)

- [ ] **Step 2: Run, verify it fails.**

Run: `pnpm --filter @switchboard/core test -- async-failure-handler`
Expected: FAIL (`data.trigger` is undefined).

- [ ] **Step 3: Implement.** Extend the `InngestOnFailureArg` type to expose the original trigger data:

```typescript
interface InngestOnFailureArg {
  error: unknown;
  event?: { data?: { run_id?: string; event?: { name?: string; data?: Record<string, unknown> } } };
}
```

In the emit branch (the `if (emitEvent && params.eventDomain)` block), capture the trigger and attach it:

```typescript
    // (b) dead-letter destination — domain event (spec §2b; optional for Class E).
    if (emitEvent && params.eventDomain) {
      const trigger = arg.event?.data?.event?.data;
      try {
        await ctx.inngest.send({
          name: `${params.eventDomain}.failed`,
          data: {
            ...(envelope as unknown as Record<string, unknown>),
            ...(trigger ? { trigger } : {}),
          },
        });
      } catch (err) {
        console.error(`[async-failure] .failed emit failed for ${params.functionId}`, err);
      }
    }
```

- [ ] **Step 4: Run, verify it passes.**

Run: `pnpm --filter @switchboard/core test -- async-failure-handler`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/observability/async-failure-handler.ts packages/core/src/observability/__tests__/async-failure-handler.test.ts
git commit -m "feat(core): propagate trigger payload onto the dead-letter event

D5-F1: the .failed event now carries jobId so a consumer can act on it."
```

---

### Task 6: the `creative-failure-recorder` consumer (TDD)

**Files:**
- Create: `apps/api/src/services/creative-failure-recorder.ts`
- Test: `apps/api/src/services/__tests__/creative-failure-recorder.test.ts`

- [ ] **Step 1: Write the failing tests.** Mirror `creative-publish-function.test.ts` (a fake `step.run` that invokes its fn, a deps stub):

```typescript
import { describe, it, expect, vi } from "vitest";
import { executeCreativeFailureRecorder, CREATIVE_FAILURE_RECORDER_FAILURE_PARAMS } from "../creative-failure-recorder.js";

const step = { run: async <T>(_n: string, fn: () => T | Promise<T>) => fn() };
function makeDeps(job: unknown) {
  return {
    jobStore: {
      findById: vi.fn().mockResolvedValue(job),
      failPolished: vi.fn().mockResolvedValue({}),
      failUgc: vi.fn().mockResolvedValue({}),
    },
  };
}
const polishedEvent = {
  trigger: { jobId: "job_1" },
  code: "ASYNC_JOB_FAILED",
  message: "boom",
  functionId: "creative-job-runner",
  occurredAt: "2026-06-11T00:00:00.000Z",
};

it("records a polished failure via failPolished", async () => {
  const deps = makeDeps({ id: "job_1", organizationId: "org_1", mode: "polished", currentStage: "hooks", stageOutputs: {} });
  await executeCreativeFailureRecorder(polishedEvent, step, deps);
  expect(deps.jobStore.failPolished).toHaveBeenCalledWith(
    "org_1",
    "job_1",
    expect.objectContaining({ kind: "terminal", code: "ASYNC_JOB_FAILED", message: "boom" }),
  );
  expect(deps.jobStore.failUgc).not.toHaveBeenCalled();
});

it("records a ugc failure via failUgc at the job's current phase", async () => {
  const deps = makeDeps({ id: "job_1", organizationId: "org_1", mode: "ugc", ugcPhase: "scripting" });
  await executeCreativeFailureRecorder({ ...polishedEvent, functionId: "ugc-job-runner" }, step, deps);
  expect(deps.jobStore.failUgc).toHaveBeenCalledWith("org_1", "job_1", "scripting", expect.any(Object));
  expect(deps.jobStore.failPolished).not.toHaveBeenCalled();
});

it("skips a job that is already terminal", async () => {
  const deps = makeDeps({ id: "job_1", organizationId: "org_1", mode: "polished", stageFailure: { code: "X" } });
  await executeCreativeFailureRecorder(polishedEvent, step, deps);
  expect(deps.jobStore.failPolished).not.toHaveBeenCalled();
});

it("skips when the trigger has no jobId", async () => {
  const deps = makeDeps(null);
  await executeCreativeFailureRecorder({ code: "X" }, step, deps);
  expect(deps.jobStore.findById).not.toHaveBeenCalled();
});

it("skips when the job is not found", async () => {
  const deps = makeDeps(null);
  await executeCreativeFailureRecorder(polishedEvent, step, deps);
  expect(deps.jobStore.failPolished).not.toHaveBeenCalled();
});

it("declares a Class-E doctrine-#7 contract (audit-only, no recursion)", () => {
  expect(CREATIVE_FAILURE_RECORDER_FAILURE_PARAMS).toMatchObject({
    functionId: "creative-failure-recorder",
    alert: false,
    emitEvent: false,
  });
});
```

- [ ] **Step 2: Run, verify it fails.**

Run: `pnpm --filter api test -- creative-failure-recorder`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement** `creative-failure-recorder.ts` (mirror `creative-publish-function.ts` structure):

```typescript
import { z } from "zod";
import { makeOnFailureHandler, type AsyncFailureContext } from "@switchboard/core";
import { inngestClient } from "@switchboard/creative-pipeline";
import type { PrismaCreativeJobStore } from "@switchboard/db";

/** Minimal Inngest step surface used here. */
export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

/** The dead-letter event data: the AsyncFailureEnvelope plus the trigger passthrough. */
const FailureEventSchema = z.object({
  trigger: z.object({ jobId: z.string() }).optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  stage: z.string().optional(),
  occurredAt: z.string().optional(),
  functionId: z.string().optional(),
});

export interface CreativeFailureRecorderDeps {
  jobStore: Pick<PrismaCreativeJobStore, "findById" | "failPolished" | "failUgc">;
  failure: AsyncFailureContext;
}

/**
 * Failure-contract Class E (audit-only): a recorder failure must not recurse into
 * another `.failed` event. Exported so a test locks the doctrine-#7 contract.
 */
export const CREATIVE_FAILURE_RECORDER_FAILURE_PARAMS = {
  functionId: "creative-failure-recorder",
  riskCategory: "low",
  alert: false,
  emitEvent: false,
} as const;

function isTerminal(job: {
  mode: string;
  stoppedAt?: string | null;
  currentStage?: string | null;
  stageFailure?: unknown;
  ugcPhase?: string | null;
  ugcFailure?: unknown;
}): boolean {
  if (job.stoppedAt != null) return true;
  if (job.mode === "ugc") return job.ugcPhase === "complete" || job.ugcFailure != null;
  return job.currentStage === "complete" || job.stageFailure != null;
}

/**
 * Consume a creative dead-letter and persist a terminal failure marker on the row
 * (D5-F1/D9-F2). Mode-agnostic: branches on the LOADED job.mode, so one consumer
 * closes the polished and ugc zombies in one place. Idempotent: an already-terminal
 * job is skipped.
 */
export async function executeCreativeFailureRecorder(
  eventData: unknown,
  step: StepTools,
  deps: CreativeFailureRecorderDeps,
): Promise<void> {
  const parsed = FailureEventSchema.safeParse(eventData);
  const jobId = parsed.success ? parsed.data.trigger?.jobId : undefined;
  if (!jobId) {
    // No identity on the dead-letter (already audited by makeOnFailureHandler); nothing to act on.
    return;
  }

  const job = await step.run("load-job", () => deps.jobStore.findById(jobId));
  if (!job) return; // vanished

  if (isTerminal(job)) return; // already terminal; do not clobber

  const env = parsed.success ? parsed.data : {};
  const failure: Record<string, unknown> = {
    kind: "terminal",
    code: env.code ?? "ASYNC_JOB_FAILED",
    message: env.message ?? "async job exhausted retries",
    ...(env.stage ? { stage: env.stage } : {}),
    ...(env.functionId ? { functionId: env.functionId } : {}),
    ...(env.occurredAt ? { occurredAt: env.occurredAt } : {}),
  };

  if (job.mode === "ugc") {
    await step.run("fail-ugc", () =>
      deps.jobStore.failUgc(job.organizationId, jobId, job.ugcPhase ?? "planning", failure),
    );
  } else {
    await step.run("fail-polished", () =>
      deps.jobStore.failPolished(job.organizationId, jobId, failure),
    );
  }
}

/**
 * Inngest function: triggers on both creative dead-letters. A polished runner failure
 * emits creative.polished.failed; a ugc runner out-of-band failure emits
 * creative.ugc.failed (the in-band phase failure persists failUgc itself, so the two
 * paths are mutually exclusive).
 */
export function createCreativeFailureRecorder(deps: CreativeFailureRecorderDeps) {
  return inngestClient.createFunction(
    {
      id: "creative-failure-recorder",
      name: "Creative Failure Recorder",
      retries: 3,
      triggers: [{ event: "creative.polished.failed" }, { event: "creative.ugc.failed" }],
      onFailure: makeOnFailureHandler(CREATIVE_FAILURE_RECORDER_FAILURE_PARAMS, deps.failure) as (
        arg: unknown,
      ) => Promise<void>,
    },
    async ({ event, step }: { event: { data: unknown }; step: unknown }) => {
      await executeCreativeFailureRecorder(event.data, step as unknown as StepTools, deps);
    },
  );
}
```

- [ ] **Step 4: Run, verify it passes.**

Run: `pnpm --filter api test -- creative-failure-recorder`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/services/creative-failure-recorder.ts apps/api/src/services/__tests__/creative-failure-recorder.test.ts
git commit -m "feat(api): creative-failure-recorder consumes the dead-letter

D5-F1/D5-F4/D9-F2: marks a retry-exhausted polished or ugc job terminally failed."
```

---

### Task 7: wire the consumer + flip the ugc dead-letter to emit (no test; bootstrap glue)

**Files:**
- Modify: `apps/api/src/bootstrap/inngest.ts` (imports ~99; ugc onFailure ~1199-1204; functions array ~1248)

- [ ] **Step 1: Import the factory.** Near the `createCreativePublishFunction` import (line ~99), add to the `@switchboard/...` / local imports the new factory:

```typescript
import { createCreativeFailureRecorder } from "../services/creative-failure-recorder.js";
```
(Place it with the other `../services/...` imports; confirm the exact import group by reading lines 90-105.)

- [ ] **Step 2: Flip the ugc runner onFailure to emit `creative.ugc.failed`.** Change the `createUgcJobRunner` onFailure params (lines ~1200-1205) from:

```typescript
          {
            functionId: "ugc-job-runner",
            riskCategory: "medium",
            alert: false,
            emitEvent: false,
          },
```
to:
```typescript
          {
            functionId: "ugc-job-runner",
            eventDomain: "creative.ugc",
            riskCategory: "medium",
            alert: false,
          },
```

- [ ] **Step 3: Register the consumer.** In the `functions: [...]` array, on the line after `createCreativePublishFunction(creativePublishFunctionDeps),` (line ~1248), add:

```typescript
      createCreativeFailureRecorder({ jobStore, failure: asyncFailure }),
```
(`jobStore` and `asyncFailure` are already in scope at this registration site.)

- [ ] **Step 4: Typecheck + build the api app.**

Run: `pnpm --filter @switchboard/db build && pnpm --filter @switchboard/core build && pnpm --filter api typecheck && pnpm --filter api build`
Expected: clean (build type-checks dead/registration files; `vi.fn` typing in tests must already be sound).

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/bootstrap/inngest.ts
git commit -m "feat(api): register creative-failure-recorder; ugc runner emits its dead-letter

D5-F4: ugc out-of-band failures now emit creative.ugc.failed for the recorder."
```

---

### Task 8: full verification gate

- [ ] **Step 1: Reset + build the lower layers** (avoid stale-artifact false alarms):

```bash
pnpm db:generate
pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/core build && pnpm --filter @switchboard/db build
```

- [ ] **Step 2: Typecheck the whole repo.**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Affected package + app tests.**

Run:
```bash
pnpm --filter @switchboard/schemas test
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/db test
pnpm --filter api test
```
Expected: all green.

- [ ] **Step 4: Lint, format, arch, drift.**

Run:
```bash
pnpm lint
pnpm format:check
pnpm arch:check
pnpm db:check-drift
```
Expected: all clean. (`arch:check` counts raw .ts lines; the new file is small.)

- [ ] **Step 5: Final commit if any fixups, then proceed to PR + code review.**

---

## Self-review notes

- Spec coverage: every spec component (trigger passthrough, stageFailure column, failPolished + clear-on-progress, consumer, ugc parity, status-mapper, decision-workflow) has a task. Out-of-scope items (alerting, D5-F2 replay guard, dispatcher, dashboard reason card) are deliberately absent.
- Type consistency: `failPolished(orgId, id, failure)`, `failUgc(orgId, id, phase, failure)`, `stageFailure` (column + Zod + reads), `creative.polished.failed` / `creative.ugc.failed` event names, and `CREATIVE_FAILURE_RECORDER_FAILURE_PARAMS` are used consistently across tasks.
- TDD: every behavioral change (store, status-mapper, decision-workflow, handler, consumer) has a failing test before implementation. Task 1 (schema) and Task 7 (bootstrap glue) are non-behavioral and verified by drift/build.
