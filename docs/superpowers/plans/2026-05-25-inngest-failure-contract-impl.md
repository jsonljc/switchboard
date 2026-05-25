# Inngest Failure Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every registered Inngest function a standard `onFailure` handler that records an auditable exhausted-failure entry, emits a domain dead-letter event, and (for critical classes) alerts the operator — closing audit Cat 2.1.

**Architecture:** A single shared `AsyncFailureEnvelope` schema (in `@switchboard/schemas`) + a `buildAsyncFailureEnvelope` helper and a `makeOnFailureHandler` factory (in `@switchboard/core`). Each Inngest function factory receives an injected `AsyncFailureContext` (`auditLedger`, `operatorAlerter`, `inngest`) and adds one `onFailure:` line built from the shared factory plus its own static class parameters. No new DLQ table; the AuditLedger entry is the canonical record and a domain `*.failed` event is the dead-letter destination.

**Tech Stack:** TypeScript (ESM), Zod, Inngest v4.2.4, Vitest, Prisma. Monorepo packages: `schemas` → `core` → `db` → `apps/api`, `packages/creative-pipeline`, `packages/ad-optimizer`.

**Spec:** `docs/superpowers/specs/2026-05-25-inngest-failure-contract-design.md` (read it first; this plan implements it section-by-section).

---

## File Structure

**New files:**

- `packages/schemas/src/async-failure.ts` — `AsyncFailureEnvelopeSchema` + type (spec §1).
- `packages/schemas/src/__tests__/async-failure.test.ts` — schema tests.
- `packages/core/src/observability/async-failure-handler.ts` — `buildAsyncFailureEnvelope` + `makeOnFailureHandler` + `AsyncFailureContext` (spec §2).
- `packages/core/src/observability/__tests__/async-failure-handler.test.ts` — handler tests.

**Modified files:**

- `packages/schemas/src/audit.ts` — add `infrastructure.job.retry_exhausted` to `AuditEventTypeSchema`; add to `OPERATIONAL_AUDIT_EVENT_TYPES` (spec §8, §12).
- `packages/schemas/src/index.ts` — re-export the new schema.
- `packages/core/src/observability/operator-alerter.ts` — widen `source` union + generalize for async (spec §3).
- `packages/core/src/index.ts` — re-export the new handler helpers.
- The 15 function factory files (spec §5.2) — thread `AsyncFailureContext`, add `onFailure:`.
- `apps/api/src/bootstrap/inngest.ts` — construct the `AsyncFailureContext` once, pass it to every factory.
- `docs/DOCTRINE.md` — refine invariant §7 (spec §8).

**Class → function map (spec §5.2), used throughout:**

| Function id                          | Factory file                                              | Class | Domain event                                | Alert? |
| ------------------------------------ | --------------------------------------------------------- | ----- | ------------------------------------------- | ------ |
| `stripe-reconciliation-hourly`       | `apps/api/src/services/cron/reconciliation.ts`            | A     | `stripe-reconciliation.failed`              | yes    |
| `lead-retry`                         | `apps/api/src/services/cron/lead-retry.ts`                | A     | `lead-retry.failed`                         | yes    |
| `creative-mode-dispatcher`           | `packages/creative-pipeline/src/mode-dispatcher.ts`       | A     | `creative.dispatch.failed`                  | yes    |
| `reconciliation-daily`               | `apps/api/src/services/cron/reconciliation.ts`            | B     | `reconciliation.failed`                     | no     |
| `ad-optimizer-weekly-audit`          | `packages/ad-optimizer/src/inngest-functions.ts`          | B     | `ad-optimizer.weekly-audit.failed`          | no     |
| `ad-optimizer-daily-signal-health`   | `packages/ad-optimizer/src/inngest-functions.ts`          | B     | `ad-optimizer.signal-health.failed`         | no     |
| `meta-token-refresh`                 | `apps/api/src/services/cron/meta-token-refresh.ts`        | B     | `meta-token-refresh.failed`                 | no     |
| `creative-job-runner`                | `packages/creative-pipeline/src/creative-job-runner.ts`   | B     | `creative.polished.failed`                  | no     |
| `ugc-job-runner`                     | `packages/creative-pipeline/src/ugc/ugc-job-runner.ts`    | B     | `creative-pipeline/ugc.failed` (existing)   | no     |
| `riley-outcome-attribution-dispatch` | `packages/ad-optimizer/src/inngest-functions.ts`          | C     | `riley.outcome-attribution.dispatch.failed` | no     |
| `riley-outcome-attribution-worker`   | `apps/api/src/services/cron/riley-outcome-attribution.ts` | D     | `riley.outcome-attribution.failed`          | no     |
| `memory-daily-pattern-decay`         | `apps/api/src/bootstrap/inngest.ts` (inline)              | E     | (optional — none)                           | no     |
| `ad-optimizer-daily-check`           | `packages/ad-optimizer/src/inngest-functions.ts`          | E     | (optional — none)                           | no     |
| `lifecycle-stalled-sweep-hourly`     | `apps/api/src/services/cron/lifecycle-stalled-sweep.ts`   | E     | (optional — none)                           | no     |
| `pcd-registry-backfill`              | `apps/api/src/services/cron/pcd-registry-backfill.ts`     | E     | (optional — none)                           | no     |

---

## Task 0: Verify Inngest v4.2.4 onFailure + NonRetriableError contract (spike)

This is a verification spike (spec §12). No production code; capture findings as a comment block you will paste into Task 5.

**Files:**

- Read: `packages/creative-pipeline/node_modules/inngest/` type definitions (or the published v4.2.4 types).

- [ ] **Step 1: Confirm the `onFailure` handler argument shape**

Inspect the `createFunction` config type and the `onFailure` callback signature in Inngest v4.2.4. Confirm:

- `onFailure` is a config-object field: `createFunction({ id, onFailure, ... }, handler)`.
- The handler receives `{ error, event, events, runId, step }`. For a failure handler, `event` is the internal `inngest/function.failed` event and the **original** triggering event is at `event.data.event` (with `event.data.error` carrying the serialized error). Record the exact accessor path.

Run: `node -e "const i=require('inngest'); console.log(Object.keys(i))"` (from `packages/creative-pipeline/`)
Expected: output includes `NonRetriableError` and `Inngest`.

- [ ] **Step 2: Confirm `NonRetriableError` import**

Confirm `import { NonRetriableError } from "inngest";` resolves and that throwing it inside a function handler terminates without consuming remaining retries.

Run: `node -e "const {NonRetriableError}=require('inngest'); console.log(typeof NonRetriableError)"` (from `packages/creative-pipeline/`)
Expected: `function`

- [ ] **Step 3: Record findings**

Write the confirmed accessor paths (e.g. `event.data.error`, `event.data.event.name`, `runId`) into a scratch note you will transcribe into the `makeOnFailureHandler` doc comment in Task 5. No commit.

---

## Task 1: Add the new AuditEventType member

**Files:**

- Modify: `packages/schemas/src/audit.ts`
- Test: `packages/schemas/src/__tests__/audit.test.ts` (create if absent; otherwise add to the existing audit schema test)

- [ ] **Step 1: Write the failing test**

Add to `packages/schemas/src/__tests__/audit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AuditEventTypeSchema, OPERATIONAL_AUDIT_EVENT_TYPES } from "../audit.js";

describe("infrastructure.job.retry_exhausted event type", () => {
  it("is a valid AuditEventType", () => {
    expect(() => AuditEventTypeSchema.parse("infrastructure.job.retry_exhausted")).not.toThrow();
  });

  it("is in the operational allowlist so operators see it by default", () => {
    expect(OPERATIONAL_AUDIT_EVENT_TYPES).toContain("infrastructure.job.retry_exhausted");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test -- audit`
Expected: FAIL — `"infrastructure.job.retry_exhausted"` is not a valid enum value.

- [ ] **Step 3: Add the enum member and operational allowlist entry**

In `packages/schemas/src/audit.ts`, add `"infrastructure.job.retry_exhausted",` to the `AuditEventTypeSchema` `z.enum([...])` array (place it after the `work_trace.*` group). Then add the same string to the `OPERATIONAL_AUDIT_EVENT_TYPES` array (search the file for that export; it is the default-visible set).

```ts
// inside AuditEventTypeSchema z.enum([...]):
  "work_trace.integrity_override",
  "infrastructure.job.retry_exhausted",
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/schemas test -- audit`
Expected: PASS

- [ ] **Step 5: Build schemas so downstream packages see the new member**

Run: `pnpm --filter @switchboard/schemas build`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/audit.ts packages/schemas/src/__tests__/audit.test.ts
git commit -m "feat(schemas): add infrastructure.job.retry_exhausted audit event type"
```

---

## Task 2: Add the AsyncFailureEnvelope schema

**Files:**

- Create: `packages/schemas/src/async-failure.ts`
- Create: `packages/schemas/src/__tests__/async-failure.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/__tests__/async-failure.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AsyncFailureEnvelopeSchema } from "../async-failure.js";

describe("AsyncFailureEnvelopeSchema", () => {
  const valid = {
    code: "UPSTREAM_TIMEOUT",
    message: "Stripe API timed out",
    functionId: "stripe-reconciliation-hourly",
    eventName: "0 * * * *",
    attempts: 3,
    retryable: true,
    occurredAt: "2026-05-25T07:00:00.000Z",
  };

  it("accepts a minimal valid envelope", () => {
    expect(() => AsyncFailureEnvelopeSchema.parse(valid)).not.toThrow();
  });

  it("requires the shared ExecutionError core (code + message)", () => {
    const { code: _c, ...noCode } = valid;
    expect(() => AsyncFailureEnvelopeSchema.parse(noCode)).toThrow();
  });

  it("accepts optional org/deployment/runId/stage", () => {
    const full = {
      ...valid,
      stage: "fetch",
      runId: "01H...",
      organizationId: "org_1",
      deploymentId: "dep_1",
    };
    expect(() => AsyncFailureEnvelopeSchema.parse(full)).not.toThrow();
  });

  it("rejects a non-ISO occurredAt", () => {
    expect(() =>
      AsyncFailureEnvelopeSchema.parse({ ...valid, occurredAt: "not-a-date" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test -- async-failure`
Expected: FAIL — cannot import `AsyncFailureEnvelopeSchema`.

- [ ] **Step 3: Create the schema**

Create `packages/schemas/src/async-failure.ts`:

```ts
import { z } from "zod";

/**
 * The shared shape for every async (Inngest) function failure on retry-exhaustion.
 * Shares the { code, message, stage? } core with core's ExecutionError (the
 * Route Governance Contract §13 seam); adds async-specific metadata.
 */
export const AsyncFailureEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  stage: z.string().optional(),
  functionId: z.string(),
  eventName: z.string(),
  runId: z.string().optional(),
  attempts: z.number().int(),
  retryable: z.boolean(),
  organizationId: z.string().optional(),
  deploymentId: z.string().optional(),
  occurredAt: z.string().datetime(),
});

export type AsyncFailureEnvelope = z.infer<typeof AsyncFailureEnvelopeSchema>;
```

- [ ] **Step 4: Re-export from the barrel**

In `packages/schemas/src/index.ts`, add (in the same style as adjacent exports):

```ts
export * from "./async-failure.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/schemas test -- async-failure`
Expected: PASS

- [ ] **Step 6: Build schemas**

Run: `pnpm --filter @switchboard/schemas build`
Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add packages/schemas/src/async-failure.ts packages/schemas/src/__tests__/async-failure.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add AsyncFailureEnvelope for the Inngest failure contract"
```

---

## Task 3: Widen OperatorAlerter for the async source

**Files:**

- Modify: `packages/core/src/observability/operator-alerter.ts`
- Test: `packages/core/src/observability/__tests__/operator-alerter.test.ts` (add to existing)

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/observability/__tests__/operator-alerter.test.ts`:

```ts
import { NoopOperatorAlerter } from "../operator-alerter.js";

describe("inngest_function alert source", () => {
  it("accepts an alert sourced from an inngest function", async () => {
    const alerter = new NoopOperatorAlerter();
    await expect(
      alerter.alert({
        errorType: "async_job_retry_exhausted",
        severity: "critical",
        errorMessage: "lead-retry exhausted",
        retryable: true,
        occurredAt: "2026-05-25T07:00:00.000Z",
        source: "inngest_function",
      }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- operator-alerter`
Expected: FAIL — TypeScript rejects `source: "inngest_function"` and `errorType: "async_job_retry_exhausted"`.

- [ ] **Step 3: Widen the union**

In `packages/core/src/observability/operator-alerter.ts`:

- Add `| "async_job_retry_exhausted"` to the `InfrastructureErrorType` union.
- Change `source: "platform_ingress";` to `source: "platform_ingress" | "inngest_function";` in `InfrastructureFailureAlert`.

```ts
export type InfrastructureErrorType =
  | "governance_eval_exception"
  | "trace_persist_failed"
  | "work_trace_locked_violation"
  | "work_trace_integrity_mismatch"
  | "work_trace_integrity_missing_anchor"
  | "integrity_check_unavailable"
  | "async_job_retry_exhausted";

export interface InfrastructureFailureAlert {
  // ... unchanged fields ...
  source: "platform_ingress" | "inngest_function";
}
```

- [ ] **Step 4: Run test + existing suite to verify no regression**

Run: `pnpm --filter @switchboard/core test -- operator-alerter`
Expected: PASS (new test + all existing alerter tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/observability/operator-alerter.ts packages/core/src/observability/__tests__/operator-alerter.test.ts
git commit -m "feat(core): widen OperatorAlerter for inngest_function async failures"
```

---

## Task 4: buildAsyncFailureEnvelope helper

**Files:**

- Create: `packages/core/src/observability/async-failure-handler.ts`
- Create: `packages/core/src/observability/__tests__/async-failure-handler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/observability/__tests__/async-failure-handler.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildAsyncFailureEnvelope } from "../async-failure-handler.js";

describe("buildAsyncFailureEnvelope", () => {
  it("maps an Error + metadata into the envelope shape", () => {
    const env = buildAsyncFailureEnvelope({
      functionId: "stripe-reconciliation-hourly",
      eventName: "0 * * * *",
      attempts: 3,
      retryable: true,
      error: new Error("boom"),
      occurredAt: "2026-05-25T07:00:00.000Z",
    });
    expect(env.code).toBe("ASYNC_JOB_FAILED"); // default code when error has none
    expect(env.message).toBe("boom");
    expect(env.functionId).toBe("stripe-reconciliation-hourly");
    expect(env.attempts).toBe(3);
    expect(env.retryable).toBe(true);
  });

  it("uses a string error's value as the message", () => {
    const env = buildAsyncFailureEnvelope({
      functionId: "x",
      eventName: "e",
      attempts: 1,
      retryable: false,
      error: "raw failure",
      occurredAt: "2026-05-25T07:00:00.000Z",
    });
    expect(env.message).toBe("raw failure");
  });

  it("threads optional org/deployment/stage/runId", () => {
    const env = buildAsyncFailureEnvelope({
      functionId: "x",
      eventName: "e",
      attempts: 1,
      retryable: false,
      error: new Error("e"),
      occurredAt: "2026-05-25T07:00:00.000Z",
      organizationId: "org_1",
      deploymentId: "dep_1",
      stage: "fetch",
      runId: "r1",
    });
    expect(env).toMatchObject({
      organizationId: "org_1",
      deploymentId: "dep_1",
      stage: "fetch",
      runId: "r1",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- async-failure-handler`
Expected: FAIL — cannot import `buildAsyncFailureEnvelope`.

- [ ] **Step 3: Implement the helper**

Create `packages/core/src/observability/async-failure-handler.ts`:

```ts
import type { AsyncFailureEnvelope } from "@switchboard/schemas";

const DEFAULT_FAILURE_CODE = "ASYNC_JOB_FAILED";

export interface BuildAsyncFailureInput {
  functionId: string;
  eventName: string;
  attempts: number;
  retryable: boolean;
  error: unknown;
  occurredAt: string;
  stage?: string;
  runId?: string;
  organizationId?: string;
  deploymentId?: string;
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function codeOf(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return DEFAULT_FAILURE_CODE;
}

/** Build the canonical async-failure envelope (spec §1). Message is the raw
 *  error text; callers are responsible for not throwing secrets into errors. */
export function buildAsyncFailureEnvelope(input: BuildAsyncFailureInput): AsyncFailureEnvelope {
  return {
    code: codeOf(input.error),
    message: messageOf(input.error),
    ...(input.stage !== undefined ? { stage: input.stage } : {}),
    functionId: input.functionId,
    eventName: input.eventName,
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    attempts: input.attempts,
    retryable: input.retryable,
    ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
    ...(input.deploymentId !== undefined ? { deploymentId: input.deploymentId } : {}),
    occurredAt: input.occurredAt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- async-failure-handler`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/observability/async-failure-handler.ts packages/core/src/observability/__tests__/async-failure-handler.test.ts
git commit -m "feat(core): add buildAsyncFailureEnvelope helper"
```

---

## Task 5: makeOnFailureHandler factory + AsyncFailureContext

**Files:**

- Modify: `packages/core/src/observability/async-failure-handler.ts`
- Modify: `packages/core/src/observability/__tests__/async-failure-handler.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/observability/__tests__/async-failure-handler.test.ts`:

```ts
import { makeOnFailureHandler } from "../async-failure-handler.js";
import type { AuditLedger } from "../../audit/ledger.js";
import type { OperatorAlerter } from "../operator-alerter.js";

function makeCtx() {
  const recorded: unknown[] = [];
  const sent: unknown[] = [];
  const alerted: unknown[] = [];
  const ctx = {
    auditLedger: {
      record: async (p: unknown) => {
        recorded.push(p);
        return {} as never;
      },
    } as unknown as AuditLedger,
    operatorAlerter: {
      alert: async (p: unknown) => {
        alerted.push(p);
      },
    } as OperatorAlerter,
    inngest: {
      send: async (e: unknown) => {
        sent.push(e);
      },
    },
  };
  return { ctx, recorded, sent, alerted };
}

// onFailure arg shape per Task 0 findings (Inngest v4.2.4):
const failureArg = {
  error: new Error("boom"),
  event: { data: { event: { name: "0 * * * *" } }, id: "evt" },
  runId: "run_1",
};

describe("makeOnFailureHandler", () => {
  it("Class A: records audit + sends domain event + alerts", async () => {
    const { ctx, recorded, sent, alerted } = makeCtx();
    const onFailure = makeOnFailureHandler(
      {
        functionId: "stripe-reconciliation-hourly",
        eventDomain: "stripe-reconciliation",
        riskCategory: "high",
        alert: true,
      },
      ctx,
    );
    await onFailure(failureArg as never);
    expect(recorded).toHaveLength(1);
    expect((recorded[0] as { eventType: string }).eventType).toBe(
      "infrastructure.job.retry_exhausted",
    );
    expect((sent[0] as { name: string }).name).toBe("stripe-reconciliation.failed");
    expect(alerted).toHaveLength(1);
  });

  it("Class E: records audit only (no event, no alert) when emitEvent is false", async () => {
    const { ctx, recorded, sent, alerted } = makeCtx();
    const onFailure = makeOnFailureHandler(
      {
        functionId: "memory-daily-pattern-decay",
        riskCategory: "low",
        alert: false,
        emitEvent: false,
      },
      ctx,
    );
    await onFailure(failureArg as never);
    expect(recorded).toHaveLength(1);
    expect(sent).toHaveLength(0);
    expect(alerted).toHaveLength(0);
  });

  it("never throws out of onFailure even if audit recording fails", async () => {
    const ctx = {
      auditLedger: {
        record: async () => {
          throw new Error("audit down");
        },
      } as unknown as AuditLedger,
      operatorAlerter: { alert: async () => {} } as OperatorAlerter,
      inngest: { send: async () => {} },
    };
    const onFailure = makeOnFailureHandler(
      { functionId: "x", eventDomain: "x", riskCategory: "low", alert: false },
      ctx,
    );
    await expect(onFailure(failureArg as never)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- async-failure-handler`
Expected: FAIL — cannot import `makeOnFailureHandler`.

- [ ] **Step 3: Implement the factory**

Append to `packages/core/src/observability/async-failure-handler.ts`:

```ts
import type { AuditLedger } from "../audit/ledger.js";
import type { OperatorAlerter } from "./operator-alerter.js";

/** Minimal Inngest client surface the handler needs (avoids a hard SDK type dep). */
export interface AsyncEventSender {
  send(event: { name: string; data: Record<string, unknown> }): Promise<unknown>;
}

export interface AsyncFailureContext {
  auditLedger: AuditLedger;
  operatorAlerter: OperatorAlerter;
  inngest: AsyncEventSender;
}

export interface OnFailureParams {
  functionId: string;
  /** Domain prefix for the `<domain>.failed` event; omit with emitEvent:false for Class E. */
  eventDomain?: string;
  riskCategory: "low" | "medium" | "high";
  /** Class A/D-critical → true: fire OperatorAlerter. */
  alert: boolean;
  /** Class A–D → true (default); Class E with no consumer → false. */
  emitEvent?: boolean;
  /** Alert severity when alert:true. Default "critical". */
  severity?: "critical" | "warning";
}

// Inngest v4.2.4 onFailure arg (confirmed in Task 0): the ORIGINAL trigger is at
// arg.event.data.event; arg.runId is the run id; arg.error is the thrown error.
interface InngestOnFailureArg {
  error: unknown;
  event: { data?: { event?: { name?: string } } };
  runId?: string;
}

/** Build a standard onFailure handler (spec §2). Never throws — failure handling
 *  must not itself crash the function-failed pipeline. */
export function makeOnFailureHandler(params: OnFailureParams, ctx: AsyncFailureContext) {
  const emitEvent = params.emitEvent ?? true;
  return async (arg: InngestOnFailureArg): Promise<void> => {
    const occurredAt = new Date().toISOString();
    const eventName = arg.event?.data?.event?.name ?? params.functionId;
    const envelope = buildAsyncFailureEnvelope({
      functionId: params.functionId,
      eventName,
      attempts: 0, // Inngest does not surface attempt count in onFailure; 0 = "exhausted".
      retryable: !(arg.error instanceof Error && arg.error.name === "NonRetriableError"),
      error: arg.error,
      occurredAt,
      ...(arg.runId !== undefined ? { runId: arg.runId } : {}),
    });

    // (a) ALWAYS — canonical audit record (spec §2a).
    try {
      await ctx.auditLedger.record({
        eventType: "infrastructure.job.retry_exhausted",
        actorType: "system",
        actorId: params.functionId,
        entityType: "async_job",
        entityId:
          envelope.runId ?? `${envelope.functionId}:${envelope.eventName}:${envelope.occurredAt}`,
        riskCategory: params.riskCategory,
        summary: `async job ${params.functionId} exhausted retries: ${envelope.code}`,
        snapshot: envelope as unknown as Record<string, unknown>,
        ...(envelope.organizationId !== undefined
          ? { organizationId: envelope.organizationId }
          : {}),
      });
    } catch (err) {
      console.error(`[async-failure] audit record failed for ${params.functionId}`, err);
    }

    // (b) dead-letter destination — domain event (spec §2b; optional for Class E).
    if (emitEvent && params.eventDomain) {
      try {
        await ctx.inngest.send({
          name: `${params.eventDomain}.failed`,
          data: envelope as unknown as Record<string, unknown>,
        });
      } catch (err) {
        console.error(`[async-failure] .failed emit failed for ${params.functionId}`, err);
      }
    }

    // (c) alert classes only (spec §2c).
    if (params.alert) {
      try {
        await ctx.operatorAlerter.alert({
          errorType: "async_job_retry_exhausted",
          severity: params.severity ?? "critical",
          errorMessage: `${params.functionId}: ${envelope.message}`,
          retryable: envelope.retryable,
          occurredAt,
          source: "inngest_function",
          ...(envelope.organizationId !== undefined
            ? { organizationId: envelope.organizationId }
            : {}),
          ...(envelope.deploymentId !== undefined ? { deploymentId: envelope.deploymentId } : {}),
        });
      } catch (err) {
        console.error(`[async-failure] operator alert failed for ${params.functionId}`, err);
      }
    }
  };
}
```

- [ ] **Step 4: Re-export from the core barrel**

In `packages/core/src/index.ts`, add (next to the existing observability exports):

```ts
export * from "./observability/async-failure-handler.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- async-failure-handler`
Expected: PASS

- [ ] **Step 6: Build core**

Run: `pnpm --filter @switchboard/core build`
Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/observability/async-failure-handler.ts packages/core/src/observability/__tests__/async-failure-handler.test.ts packages/core/src/index.ts
git commit -m "feat(core): add makeOnFailureHandler + AsyncFailureContext"
```

---

## Task 6: Construct the AsyncFailureContext once in bootstrap

**Files:**

- Modify: `apps/api/src/bootstrap/inngest.ts`

- [ ] **Step 1: Build the context near the function registrations**

In `apps/api/src/bootstrap/inngest.ts`, before the `await app.register(inngestFastify, { ... })` call, construct the shared context. `app.auditLedger` and `app.operatorAlerter` are the existing decorators (verify their decorator names with `rg "app.decorate\(.*[Aa]lerter|[Ll]edger" apps/api/src`; if the operator alerter is not yet decorated, instantiate `new NoopOperatorAlerter()` as the fallback, matching how the ingress path resolves its alerter):

```ts
import { type AsyncFailureContext } from "@switchboard/core";
// ... inside registerInngest(), before app.register:
const asyncFailure: AsyncFailureContext = {
  auditLedger: app.auditLedger,
  operatorAlerter: app.operatorAlerter ?? new NoopOperatorAlerter(),
  inngest: inngestClient,
};
```

- [ ] **Step 2: Verify it typechecks (no wiring into factories yet)**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: exit 0 (the `asyncFailure` const is unused for now — prefix with `void asyncFailure;` if the no-unused rule complains, removed in Task 7).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/bootstrap/inngest.ts
git commit -m "chore(api): construct shared AsyncFailureContext in inngest bootstrap"
```

---

## Task 7: Wire Class A functions (stripe-reconciliation, lead-retry, creative-mode-dispatcher)

Each Class A factory gains a `failure: AsyncFailureContext` dependency and an `onFailure:` config line. The pattern is identical; the per-function params come from the class map.

**Files:**

- Modify: `apps/api/src/services/cron/reconciliation.ts` (stripe), `apps/api/src/services/cron/lead-retry.ts`, `packages/creative-pipeline/src/mode-dispatcher.ts`
- Modify: `apps/api/src/bootstrap/inngest.ts` (pass `asyncFailure` into each factory)
- Test: the co-located `*.test.ts` for each factory

- [ ] **Step 1: Write a failing test for stripe-reconciliation onFailure wiring**

In `apps/api/src/services/cron/__tests__/reconciliation.test.ts`, add:

```ts
it("registers an onFailure handler on the stripe reconciliation function", () => {
  const captured: { config?: { onFailure?: unknown } } = {};
  const fakeClient = {
    createFunction: (config: never, _h: never) => {
      captured.config = config;
      return {};
    },
  };
  // If the factory uses the module-level inngestClient, assert via the returned
  // function's definition instead: spy on inngestClient.createFunction.
  // Minimal assertion: the config object passed to createFunction has onFailure.
  // (Adapt to the existing test's construction style.)
  expect(captured).toBeDefined();
});
```

Note: the existing tests call the factory and assert on behavior; the simplest durable assertion is that `createFunction` is invoked with a config containing `onFailure`. Spy on `inngestClient.createFunction` (imported from `@switchboard/creative-pipeline`) with `vi.spyOn`, call `createStripeReconciliationCron({ ...deps, failure })`, and assert `spy.mock.calls[0][0].onFailure` is a function.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- reconciliation`
Expected: FAIL — `onFailure` is undefined / factory does not accept `failure`.

- [ ] **Step 3: Add `failure` to deps and `onFailure` to the config (stripe)**

In `apps/api/src/services/cron/reconciliation.ts`:

- Add `failure: AsyncFailureContext;` to `StripeReconciliationDeps` (import the type from `@switchboard/core`).
- Add the `onFailure` line to `createStripeReconciliationCron`'s config:

```ts
import { makeOnFailureHandler, type AsyncFailureContext } from "@switchboard/core";

export function createStripeReconciliationCron(deps: StripeReconciliationDeps) {
  return inngestClient.createFunction(
    {
      id: "stripe-reconciliation-hourly",
      name: "Stripe Subscription Reconciliation",
      retries: 2,
      triggers: [{ cron: "0 * * * *" }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "stripe-reconciliation-hourly",
          eventDomain: "stripe-reconciliation",
          riskCategory: "high",
          alert: true,
        },
        deps.failure,
      ),
    },
    async ({ step }) => executeStripeReconciliation(step as unknown as StepTools, deps),
  );
}
```

- [ ] **Step 4: Repeat for lead-retry**

In `apps/api/src/services/cron/lead-retry.ts`: add `failure: AsyncFailureContext` to `LeadRetryDeps`, import the helpers, add to the config:

```ts
onFailure: makeOnFailureHandler(
  { functionId: "lead-retry", eventDomain: "lead-retry", riskCategory: "high", alert: true },
  deps.failure,
),
```

- [ ] **Step 5: Repeat for creative-mode-dispatcher**

In `packages/creative-pipeline/src/mode-dispatcher.ts`: the factory is `createModeDispatcher()` and takes no deps today. Add a `failure: AsyncFailureContext` parameter: `createModeDispatcher(failure: AsyncFailureContext)`. Add to the config:

```ts
onFailure: makeOnFailureHandler(
  { functionId: "creative-mode-dispatcher", eventDomain: "creative.dispatch", riskCategory: "high", alert: true },
  failure,
),
```

(`@switchboard/core` is a dependency of `creative-pipeline`? — NO: creative-pipeline is Layer 2, core is Layer 3, so creative-pipeline MUST NOT import core. Instead, import `makeOnFailureHandler`/`AsyncFailureContext` is not allowed here. **Resolution:** for the creative-pipeline functions, the bootstrap (apps/api, Layer 5) builds the handler and passes the ready-made `onFailure` function INTO the factory: change the factory param to `onFailure?: (arg: unknown) => Promise<void>` and have bootstrap pass `makeOnFailureHandler(...)`. Apply this same inversion to all `packages/creative-pipeline` and `packages/ad-optimizer` factories. `apps/api/src/services/cron/*` may import core directly.)

- [ ] **Step 6: Pass deps from bootstrap**

In `apps/api/src/bootstrap/inngest.ts`, thread `asyncFailure`:

- For api-cron factories: add `failure: asyncFailure` to their deps object literals (`stripeReconciliationDeps`, `leadRetryDeps`).
- For `createModeDispatcher()`: pass the prebuilt handler — `createModeDispatcher(makeOnFailureHandler({ functionId: "creative-mode-dispatcher", eventDomain: "creative.dispatch", riskCategory: "high", alert: true }, asyncFailure))`.

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter @switchboard/api test -- reconciliation lead-retry && pnpm --filter @switchboard/creative-pipeline test && pnpm --filter @switchboard/api typecheck`
Expected: PASS / exit 0

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/cron/reconciliation.ts apps/api/src/services/cron/lead-retry.ts packages/creative-pipeline/src/mode-dispatcher.ts apps/api/src/bootstrap/inngest.ts apps/api/src/services/cron/__tests__/
git commit -m "feat(reliability): add onFailure to Class A inngest functions"
```

---

## Task 8: Wire Class B functions

Same mechanics as Task 7 with `alert: false`. Functions: `reconciliation-daily` (api-cron, may import core directly), `meta-token-refresh` (api-cron), `ad-optimizer-weekly-audit` + `ad-optimizer-daily-signal-health` (ad-optimizer — Layer 2, use the passed-in-handler inversion), `creative-job-runner` + `ugc-job-runner` (creative-pipeline — inversion).

**Files:**

- Modify: `apps/api/src/services/cron/reconciliation.ts`, `apps/api/src/services/cron/meta-token-refresh.ts`, `packages/ad-optimizer/src/inngest-functions.ts`, `packages/creative-pipeline/src/creative-job-runner.ts`, `packages/creative-pipeline/src/ugc/ugc-job-runner.ts`, `apps/api/src/bootstrap/inngest.ts`
- Test: co-located tests for each.

- [ ] **Step 1: Per-function params (apply the Task 7 pattern with these values)**

| Function                         | functionId                         | eventDomain                  | riskCategory | alert |
| -------------------------------- | ---------------------------------- | ---------------------------- | ------------ | ----- |
| reconciliation-daily             | `reconciliation-daily`             | `reconciliation`             | medium       | false |
| meta-token-refresh               | `meta-token-refresh`               | `meta-token-refresh`         | medium       | false |
| ad-optimizer-weekly-audit        | `ad-optimizer-weekly-audit`        | `ad-optimizer.weekly-audit`  | medium       | false |
| ad-optimizer-daily-signal-health | `ad-optimizer-daily-signal-health` | `ad-optimizer.signal-health` | medium       | false |
| creative-job-runner              | `creative-job-runner`              | `creative.polished`          | medium       | false |
| ugc-job-runner                   | `ugc-job-runner`                   | (see step 2)                 | medium       | false |

- [ ] **Step 2: ugc-job-runner keeps its existing event**

`ugc-job-runner` already emits `creative-pipeline/ugc.failed` from its internal phase try/catch. Do NOT add a second domain event. Set `emitEvent: false` on its `makeOnFailureHandler` params so the contract adds only the audit record + (no) alert, leaving the existing event as the dead-letter destination:

```ts
// in bootstrap, passing the handler into createUgcJobRunner:
makeOnFailureHandler(
  { functionId: "ugc-job-runner", riskCategory: "medium", alert: false, emitEvent: false },
  asyncFailure,
);
```

- [ ] **Step 3: Write a failing onFailure-wiring test for one api-cron (meta-token-refresh) and one ad-optimizer function (weekly-audit)**

Use the `vi.spyOn(inngestClient, "createFunction")` assertion from Task 7 Step 1 for each; assert `config.onFailure` is a function.

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @switchboard/api test -- meta-token-refresh && pnpm --filter @switchboard/ad-optimizer test`
Expected: FAIL

- [ ] **Step 5: Implement (apply Task 7 inversion rules)**

- api-cron files (`reconciliation.ts` `createReconciliationCron`, `meta-token-refresh.ts`): import core, add `failure` to deps, add `onFailure`.
- ad-optimizer factories (`createWeeklyAuditCron`, `createDailySignalHealthCron`): add `onFailure?: (arg: unknown) => Promise<void>` param (NOT a core import — Layer 2), add `onFailure` to config when provided.
- creative-pipeline factories (`createCreativeJobRunner`, `createUgcJobRunner`): add the same `onFailure?` param.
- bootstrap: build each handler with `makeOnFailureHandler(...)` and pass it in; for api-cron deps, add `failure: asyncFailure`.

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @switchboard/api test && pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/creative-pipeline test && pnpm --filter @switchboard/api typecheck`
Expected: PASS / exit 0

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(reliability): add onFailure to Class B inngest functions"
```

---

## Task 9: Wire Class C + D functions (riley dispatch + worker)

**Files:**

- Modify: `packages/ad-optimizer/src/inngest-functions.ts` (`createRileyOutcomeAttributionDispatch`), `apps/api/src/services/cron/riley-outcome-attribution.ts` (`createRileyOutcomeAttributionWorker`), `apps/api/src/bootstrap/inngest.ts`
- Test: co-located.

- [ ] **Step 1: Set explicit retries on the worker (Class D rule, spec §5.3)**

`createRileyOutcomeAttributionWorker` has no `retries` field today (inherits Inngest default 4). Add `retries: 2` to its config so its retry budget is explicit:

```ts
{ id: "riley-outcome-attribution-worker", retries: 2, triggers: [{ event: "riley.outcome.attribute" }] }
```

- [ ] **Step 2: Add onFailure to dispatch (Class C) and worker (Class D)**

- Dispatch (ad-optimizer, Layer 2 → handler-injection): `onFailure?` param; params `{ functionId: "riley-outcome-attribution-dispatch", eventDomain: "riley.outcome-attribution.dispatch", riskCategory: "low", alert: false }`.
- Worker (api-cron → may import core): add `failure: AsyncFailureContext` to `RileyOutcomeAttributionWorkerDeps`; params `{ functionId: "riley-outcome-attribution-worker", eventDomain: "riley.outcome-attribution", riskCategory: "medium", alert: false }`.

- [ ] **Step 3: Write failing wiring tests (spy on createFunction.onFailure) for both**

Run: `pnpm --filter @switchboard/api test -- riley-outcome-attribution && pnpm --filter @switchboard/ad-optimizer test`
Expected: FAIL

- [ ] **Step 4: Implement + thread from bootstrap**

Apply the inversion rules; pass `failure: asyncFailure` into the worker deps and the prebuilt handler into the dispatch factory.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @switchboard/api test -- riley-outcome-attribution && pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/api typecheck`
Expected: PASS / exit 0

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(reliability): add onFailure to riley dispatch (C) + worker (D), set explicit worker retries"
```

---

## Task 10: Wire Class E functions (audit-only, no domain event)

Class E (`memory-daily-pattern-decay`, `ad-optimizer-daily-check`, `lifecycle-stalled-sweep-hourly`, `pcd-registry-backfill`) records the audit entry but emits NO domain event (`emitEvent: false`, no `eventDomain`) and no alert (spec §2b, §5.1).

**Files:**

- Modify: `apps/api/src/bootstrap/inngest.ts` (pattern-decay is defined inline here), `packages/ad-optimizer/src/inngest-functions.ts` (`createDailyCheckCron`), `apps/api/src/services/cron/lifecycle-stalled-sweep.ts`, `apps/api/src/services/cron/pcd-registry-backfill.ts`
- Test: co-located where the factory lives; for the inline pattern-decay, add an assertion in the inngest bootstrap test if one exists, else skip the unit test and rely on typecheck.

- [ ] **Step 1: Per-function params**

All four use: `{ functionId: <id>, riskCategory: "low", alert: false, emitEvent: false }`.

- [ ] **Step 2: pattern-decay (inline in bootstrap)**

Add the `onFailure` line directly to the inline `dailyPatternDecayCron` config (the handler can reference the already-built `asyncFailure`):

```ts
onFailure: makeOnFailureHandler(
  { functionId: "memory-daily-pattern-decay", riskCategory: "low", alert: false, emitEvent: false },
  asyncFailure,
),
```

- [ ] **Step 3: daily-check (ad-optimizer, handler-injection), lifecycle-stalled-sweep + pcd-registry-backfill (api-cron, core import)**

Apply the inversion rules; for api-cron factories add `failure: AsyncFailureContext` to deps and `onFailure: makeOnFailureHandler({...}, deps.failure)`; for `createDailyCheckCron` add the `onFailure?` param and pass the prebuilt handler from bootstrap.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @switchboard/api test && pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/api typecheck`
Expected: PASS / exit 0

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(reliability): add audit-only onFailure to Class E inngest functions"
```

---

## Task 11: Refine DOCTRINE invariant §7

**Files:**

- Modify: `docs/DOCTRINE.md`

- [ ] **Step 1: Add the Inngest clause to invariant §7**

Under `### 7. Dead-letter for every async path`, append:

```markdown
**Inngest functions.** Every Inngest function with `retries > 1` MUST define an `onFailure` handler that (a) records an `infrastructure.job.retry_exhausted` AuditLedger entry carrying the `AsyncFailureEnvelope`, and (b) for classes A–D emits a domain-readable `*.failed` dead-letter event (Class E may omit the event when no downstream consumer exists). Critical-class functions additionally raise an `OperatorAlerter` alert. See `docs/superpowers/specs/2026-05-25-inngest-failure-contract-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/DOCTRINE.md
git commit -m "docs(doctrine): operationalize invariant §7 for Inngest onFailure"
```

---

## Task 12: Full-suite verification

- [ ] **Step 1: Typecheck the whole monorepo**

Run: `pnpm typecheck`
Expected: exit 0. If missing-export errors mention `@switchboard/schemas`/`@switchboard/core`, run `pnpm reset` first (CLAUDE.md), then re-run.

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: PASS, except the known pg-advisory-lock flakes (`prisma-work-trace-store-integrity` / `prisma-ledger-storage` / `prisma-greeting-signal-store`) which fail only without Postgres — not a regression.

- [ ] **Step 3: Lint + format**

Run: `pnpm lint && pnpm format:check`
Expected: exit 0 (CI runs prettier; run `pnpm format:write` if format:check fails).

- [ ] **Step 4: Confirm coverage of all 15 functions**

Run: `rg "onFailure" apps/api/src/services/cron apps/api/src/bootstrap/inngest.ts packages/creative-pipeline/src packages/ad-optimizer/src/inngest-functions.ts -c`
Expected: an `onFailure` reference for every factory file in the class map (15 functions). Cross-check against the `functions: [...]` array in `bootstrap/inngest.ts`.

- [ ] **Step 5: Final commit if any format fixes were applied**

```bash
git add -A
git commit -m "chore(reliability): format + lint fixes for inngest failure contract"
```

---

## Self-Review notes (for the executor)

- **Layer rule is load-bearing:** `packages/creative-pipeline` and `packages/ad-optimizer` are Layer 2 and MUST NOT import `@switchboard/core` (Layer 3). For those functions, the bootstrap (Layer 5) builds the handler via `makeOnFailureHandler` and passes the ready-made `onFailure` function into the factory as an `onFailure?: (arg: unknown) => Promise<void>` parameter. Only `apps/api/src/services/cron/*` and `apps/api/src/bootstrap/inngest.ts` import `makeOnFailureHandler`/`AsyncFailureContext` directly. Verify with `pnpm lint` (the dependency-layer check) after Tasks 7–10.
- **`attempts` is set to 0** because Inngest's `onFailure` does not surface the attempt count; the envelope's presence already means "exhausted." If Task 0 finds an attempt count on the arg, thread it instead.
- **`retryable` is derived** from whether the terminal error was a `NonRetriableError` (fail-fast = `false`, exhausted-after-retries = `true`), per spec §6.
- **Idempotency:** `onFailure` may itself be retried by Inngest; the audit `entityId` is deterministic (`runId` or the composite) so duplicate records are detectable, and all three side-effects are wrapped in try/catch so a partial failure never throws.
- **Do not** create a `FailedJobStore` — spec §13 explicitly defers operable queue semantics.
- **`/activity` banding is deferred UI:** Task 1 adds the new event to `OPERATIONAL_AUDIT_EVENT_TYPES` so it is operator-visible by default, but does NOT add it to a visual band in `apps/dashboard/.../activity/event-bands.ts`. The event will render unbanded until a follow-up UI pass groups it — out of scope for this reliability contract (spec §12 flags it as optional).
- **`riskCategory` values** (`low`/`medium`/`high`) must match the `RiskCategory` type exported from `@switchboard/schemas`; if Task 12's typecheck rejects one, align to the real union (the ingress path already uses `"high"`, confirming `high` is valid).

```

```
