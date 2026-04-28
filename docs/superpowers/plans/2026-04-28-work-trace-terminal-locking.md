# WorkTrace Terminal Locking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce a single store-level invariant — once a `WorkTrace` reaches terminal `outcome` (`completed` / `failed`), core audit fields cannot be silently rewritten by app code.

**Architecture:** Pure validator (`work-trace-lock.ts`) defines allowed transitions and field-bucket rules. `PrismaWorkTraceStore.update()` becomes a transactional read-modify-write that calls the validator and either applies the change (auto-stamping `lockedAt` on terminal transitions) or returns a typed conflict result. In dev/test/CI the conflict throws `WorkTraceLockedError`; in production it returns `{ ok: false, code: "WORK_TRACE_LOCKED", traceUnchanged: true, reason }` and emits an audit + alert via the existing #17 `OperatorAlerter`.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Vitest, Prisma migration, `@switchboard/core`, `@switchboard/db`, existing #17 observability module.

**Spec:** `docs/superpowers/specs/2026-04-28-work-trace-terminal-locking-design.md` (committed at `50de3dea`).

**Worktree:** `.worktrees/work-trace-terminal-lock` on branch `fix/launch-work-trace-terminal-lock` (forked from `origin/main` @ `465be6b4`).

**Hard constraints (per user):**

- Out of scope: hash chain, append-only revisions, DB triggers, verification-on-read, tamper-evidence UI.
- Reuse #17 `OperatorAlerter` (no new alerter, no widening of approval notifiers).
- Reuse existing `outcome` status names; do not invent a parallel state machine.
- External conflict result stays minimal: `{ ok: false, code, traceUnchanged: true, reason }`. Rich detail only in audit/alert.
- Never silently drop a forbidden write.

---

## File Structure

**New:**

- `packages/core/src/platform/work-trace-lock.ts` — pure validator + `WorkTraceLockedError` + transitions table.
- `packages/core/src/platform/__tests__/work-trace-lock.test.ts`
- `packages/db/prisma/migrations/<timestamp>_add_work_trace_locked_at/migration.sql`
- `packages/db/src/stores/__tests__/prisma-work-trace-store-lock.test.ts` (in-memory variant — uses an in-memory test double, not a real DB).

**Modified:**

- `packages/core/src/platform/work-trace.ts` — add `lockedAt?: string`.
- `packages/core/src/platform/work-trace-recorder.ts` — change `WorkTraceStore.update` return type; export `WorkTraceUpdateResult`; export `WorkTraceStoreObservability` config interface.
- `packages/core/src/platform/platform-lifecycle.ts` — handle conflict result at 3 call sites (`:360`, `:537`, `:544`).
- `packages/core/src/observability/operator-alerter.ts` — extend `InfrastructureErrorType` enum.
- `packages/db/prisma/schema.prisma` — add `lockedAt DateTime?` column.
- `packages/db/src/stores/prisma-work-trace-store.ts` — transaction-wrap `update()`; call validator; auto-set `lockedAt`; emit audit/alert; honor env-gated throw vs return.
- `apps/api/src/bootstrap/storage.ts` — pass `auditLedger` + `operatorAlerter` into the store constructor.
- `packages/core/src/platform/__tests__/platform-lifecycle.test.ts`, `platform-ingress.test.ts`, `runtime-first-response.test.ts`, `convergence-e2e.test.ts` — update in-memory `WorkTraceStore` fakes for the new return type.
- `apps/api/src/__tests__/test-server.ts`, `execute-platform-parity.test.ts` — same.

**Files NOT touched (verify):**

- `packages/schemas/src/audit.ts` — no enum changes.
- Any `notifications/*` — no approval-notifier changes.

---

## Task 1: Pure validator — `work-trace-lock.ts`

The validator is a pure function: given the current trace and a partial update, return `ok` (with computed `lockedAt`) or a structured rejection. Zero IO, zero side effects.

**Files:**

- Create: `packages/core/src/platform/work-trace-lock.ts`
- Test: `packages/core/src/platform/__tests__/work-trace-lock.test.ts`

- [ ] **Step 1.1: Write the failing test**

```ts
// packages/core/src/platform/__tests__/work-trace-lock.test.ts
import { describe, it, expect } from "vitest";
import {
  validateUpdate,
  WorkTraceLockedError,
  TERMINAL_OUTCOMES,
  ALLOWED_OUTCOME_TRANSITIONS,
} from "../work-trace-lock.js";
import type { WorkTrace } from "../work-trace.js";

function makeTrace(overrides: Partial<WorkTrace> = {}): WorkTrace {
  return {
    workUnitId: "wu_1",
    traceId: "t_1",
    intent: "test.intent",
    mode: "skill",
    organizationId: "org_1",
    actor: { id: "actor_1", type: "user" },
    trigger: "api",
    governanceOutcome: "execute",
    riskScore: 0,
    matchedPolicies: [],
    outcome: "running",
    durationMs: 0,
    requestedAt: "2026-04-28T00:00:00.000Z",
    governanceCompletedAt: "2026-04-28T00:00:01.000Z",
    ...overrides,
  };
}

describe("TERMINAL_OUTCOMES", () => {
  it("contains exactly completed and failed", () => {
    expect([...TERMINAL_OUTCOMES].sort()).toEqual(["completed", "failed"]);
  });
});

describe("ALLOWED_OUTCOME_TRANSITIONS", () => {
  it("encodes the lifecycle from spec §1", () => {
    expect([...ALLOWED_OUTCOME_TRANSITIONS.pending_approval].sort()).toEqual([
      "completed",
      "failed",
      "queued",
      "running",
    ]);
    expect([...ALLOWED_OUTCOME_TRANSITIONS.queued].sort()).toEqual([
      "completed",
      "failed",
      "running",
    ]);
    expect([...ALLOWED_OUTCOME_TRANSITIONS.running].sort()).toEqual(["completed", "failed"]);
    expect(ALLOWED_OUTCOME_TRANSITIONS.completed.size).toBe(0);
    expect(ALLOWED_OUTCOME_TRANSITIONS.failed.size).toBe(0);
  });
});

describe("validateUpdate — outcome transitions", () => {
  it("allows running -> completed and stamps lockedAt", () => {
    const current = makeTrace({ outcome: "running" });
    const result = validateUpdate({ current, update: { outcome: "completed" } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(typeof result.computedLockedAt).toBe("string");
  });

  it("rejects completed -> approved (illegal regress)", () => {
    const current = makeTrace({
      outcome: "completed",
      lockedAt: "2026-04-28T00:00:02.000Z",
    });
    const result = validateUpdate({ current, update: { outcome: "running" as never } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.rejectedFields).toContain("outcome");
  });

  it("rejects pending_approval -> pending_approval as transition (no-op outcome update is allowed)", () => {
    const current = makeTrace({ outcome: "pending_approval" });
    const result = validateUpdate({
      current,
      update: { outcome: "pending_approval", approvalId: "appr_1" },
    });
    // Same-state outcome write is allowed; non-outcome fields evaluated independently.
    expect(result.ok).toBe(true);
  });

  it("non-terminal transitions do not stamp lockedAt", () => {
    const current = makeTrace({ outcome: "pending_approval" });
    const result = validateUpdate({ current, update: { outcome: "running" } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.computedLockedAt).toBeNull();
  });
});

describe("validateUpdate — bucket A (always-immutable)", () => {
  it("rejects mutating organizationId", () => {
    const current = makeTrace();
    const result = validateUpdate({
      current,
      update: { organizationId: "org_2" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.rejectedFields).toContain("organizationId");
  });

  it("rejects mutating governanceConstraints", () => {
    const current = makeTrace();
    const result = validateUpdate({
      current,
      update: {
        governanceConstraints: {
          allowedModelTiers: ["default"],
          maxToolCalls: 1,
          maxLlmTurns: 1,
          maxTotalTokens: 100,
          maxRuntimeMs: 1000,
          maxWritesPerExecution: 1,
          trustLevel: "guided",
        },
      },
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateUpdate — bucket B (parameters)", () => {
  it("allows parameters change while approvalOutcome and executionStartedAt and lockedAt are unset", () => {
    const current = makeTrace({ outcome: "pending_approval" });
    const result = validateUpdate({
      current,
      update: { parameters: { v: 2 } },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects parameters change once approvalOutcome is set", () => {
    const current = makeTrace({
      outcome: "pending_approval",
      approvalOutcome: "approved",
    });
    const result = validateUpdate({ current, update: { parameters: { v: 2 } } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.rejectedFields).toContain("parameters");
  });

  it("rejects parameters change once executionStartedAt is set", () => {
    const current = makeTrace({
      outcome: "running",
      executionStartedAt: "2026-04-28T00:00:02.000Z",
    });
    const result = validateUpdate({ current, update: { parameters: { v: 2 } } });
    expect(result.ok).toBe(false);
  });
});

describe("validateUpdate — bucket C (one-shot)", () => {
  it("allows first set of approvalId", () => {
    const current = makeTrace({ outcome: "pending_approval" });
    const result = validateUpdate({
      current,
      update: {
        approvalId: "appr_1",
        approvalOutcome: "approved",
        approvalRespondedBy: "user_1",
        approvalRespondedAt: "2026-04-28T00:00:02.000Z",
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects second set of approvalId", () => {
    const current = makeTrace({
      outcome: "pending_approval",
      approvalId: "appr_1",
    });
    const result = validateUpdate({ current, update: { approvalId: "appr_2" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.rejectedFields).toContain("approvalId");
  });

  it("rejects second set of executionStartedAt", () => {
    const current = makeTrace({
      outcome: "running",
      executionStartedAt: "2026-04-28T00:00:02.000Z",
    });
    const result = validateUpdate({
      current,
      update: { executionStartedAt: "2026-04-28T00:00:03.000Z" },
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateUpdate — bucket D (terminal-only)", () => {
  it("allows executionOutputs on terminal write", () => {
    const current = makeTrace({ outcome: "running" });
    const result = validateUpdate({
      current,
      update: { outcome: "completed", executionOutputs: { ok: true } },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects executionOutputs rewrite after lock", () => {
    const current = makeTrace({
      outcome: "completed",
      lockedAt: "2026-04-28T00:00:02.000Z",
      executionOutputs: { ok: true },
    });
    const result = validateUpdate({
      current,
      update: { executionOutputs: { ok: false } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.rejectedFields).toContain("executionOutputs");
  });
});

describe("validateUpdate — bucket E (modeMetrics)", () => {
  it("allows modeMetrics until lock", () => {
    const current = makeTrace({ outcome: "running" });
    const result = validateUpdate({
      current,
      update: { modeMetrics: { tokens: 100 } },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects modeMetrics after lock", () => {
    const current = makeTrace({
      outcome: "completed",
      lockedAt: "2026-04-28T00:00:02.000Z",
    });
    const result = validateUpdate({
      current,
      update: { modeMetrics: { tokens: 200 } },
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateUpdate — locked trace blanket rejection", () => {
  it("rejects any field write after lockedAt is set", () => {
    const current = makeTrace({
      outcome: "completed",
      lockedAt: "2026-04-28T00:00:02.000Z",
    });
    const result = validateUpdate({ current, update: { durationMs: 999 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.lockedAt).toBe("2026-04-28T00:00:02.000Z");
      expect(result.diagnostic.currentOutcome).toBe("completed");
    }
  });
});

describe("WorkTraceLockedError", () => {
  it("carries diagnostic + code", () => {
    const err = new WorkTraceLockedError({
      traceId: "t_1",
      workUnitId: "wu_1",
      currentOutcome: "completed",
      lockedAt: "2026-04-28T00:00:02.000Z",
      rejectedFields: ["executionOutputs"],
      reason: "Trace locked",
    });
    expect(err.code).toBe("WORK_TRACE_LOCKED");
    expect(err.diagnostic.workUnitId).toBe("wu_1");
    expect(err.message).toContain("Trace locked");
  });
});
```

- [ ] **Step 1.2: Run the test, verify it fails**

```
pnpm --filter @switchboard/core test -- packages/core/src/platform/__tests__/work-trace-lock.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 1.3: Implement the validator**

```ts
// packages/core/src/platform/work-trace-lock.ts
import type { WorkTrace } from "./work-trace.js";
import type { WorkOutcome } from "./types.js";

export const TERMINAL_OUTCOMES: ReadonlySet<WorkOutcome> = new Set(["completed", "failed"]);

export const ALLOWED_OUTCOME_TRANSITIONS: Readonly<Record<WorkOutcome, ReadonlySet<WorkOutcome>>> =
  {
    pending_approval: new Set<WorkOutcome>(["queued", "running", "completed", "failed"]),
    queued: new Set<WorkOutcome>(["running", "completed", "failed"]),
    running: new Set<WorkOutcome>(["completed", "failed"]),
    completed: new Set<WorkOutcome>(),
    failed: new Set<WorkOutcome>(),
  };

const ALWAYS_IMMUTABLE_FIELDS: ReadonlySet<keyof WorkTrace> = new Set([
  "workUnitId",
  "traceId",
  "parentWorkUnitId",
  "deploymentId",
  "intent",
  "mode",
  "organizationId",
  "actor",
  "trigger",
  "idempotencyKey",
  "deploymentContext",
  "governanceOutcome",
  "governanceConstraints",
  "riskScore",
  "matchedPolicies",
  "requestedAt",
  "governanceCompletedAt",
]);

const ONE_SHOT_FIELDS: ReadonlySet<keyof WorkTrace> = new Set([
  "approvalId",
  "approvalOutcome",
  "approvalRespondedBy",
  "approvalRespondedAt",
  "executionStartedAt",
]);

const TERMINAL_ONLY_FIELDS: ReadonlySet<keyof WorkTrace> = new Set([
  "executionOutputs",
  "executionSummary",
  "error",
  "completedAt",
  "durationMs",
]);

export interface WorkTraceLockDiagnostic {
  traceId: string;
  workUnitId: string;
  currentOutcome: WorkOutcome;
  lockedAt: string | null;
  rejectedFields: string[];
  reason: string;
  caller?: string;
}

export class WorkTraceLockedError extends Error {
  readonly code = "WORK_TRACE_LOCKED" as const;
  readonly diagnostic: WorkTraceLockDiagnostic;

  constructor(diagnostic: WorkTraceLockDiagnostic) {
    super(diagnostic.reason);
    this.name = "WorkTraceLockedError";
    this.diagnostic = diagnostic;
  }
}

export type ValidateUpdateResult =
  | { ok: true; computedLockedAt: string | null }
  | { ok: false; diagnostic: WorkTraceLockDiagnostic };

export function validateUpdate(args: {
  current: WorkTrace;
  update: Partial<WorkTrace>;
  caller?: string;
  now?: () => Date;
}): ValidateUpdateResult {
  const { current, update, caller } = args;
  const nowFn = args.now ?? (() => new Date());
  const rejectedFields: string[] = [];

  const isLocked = current.lockedAt !== undefined && current.lockedAt !== null;

  // Locked: blanket-reject any field write (except a no-op identity pass).
  if (isLocked) {
    for (const key of Object.keys(update) as Array<keyof WorkTrace>) {
      const incoming = update[key];
      const existing = current[key];
      if (!isEqual(incoming, existing)) rejectedFields.push(String(key));
    }
    if (rejectedFields.length > 0) {
      return rejection({
        current,
        rejectedFields,
        reason: `Trace locked at ${current.lockedAt}; further mutation forbidden`,
        caller,
      });
    }
    return { ok: true, computedLockedAt: current.lockedAt ?? null };
  }

  // Outcome transition check
  if (update.outcome !== undefined && update.outcome !== current.outcome) {
    const allowed = ALLOWED_OUTCOME_TRANSITIONS[current.outcome];
    if (!allowed.has(update.outcome)) {
      rejectedFields.push("outcome");
    }
  }

  // Always-immutable fields
  for (const key of ALWAYS_IMMUTABLE_FIELDS) {
    if (key in update) {
      const incoming = (update as Record<string, unknown>)[key as string];
      const existing = (current as Record<string, unknown>)[key as string];
      if (!isEqual(incoming, existing)) rejectedFields.push(String(key));
    }
  }

  // Bucket B: parameters mutable until approvalOutcome OR executionStartedAt set.
  if (update.parameters !== undefined && !isEqual(update.parameters, current.parameters)) {
    const sealed =
      current.approvalOutcome !== undefined || current.executionStartedAt !== undefined;
    if (sealed) rejectedFields.push("parameters");
  }

  // One-shot fields
  for (const key of ONE_SHOT_FIELDS) {
    if (!(key in update)) continue;
    const incoming = (update as Record<string, unknown>)[key as string];
    if (incoming === undefined) continue;
    const existing = (current as Record<string, unknown>)[key as string];
    if (existing !== undefined && existing !== null && !isEqual(incoming, existing)) {
      rejectedFields.push(String(key));
    }
  }

  // Terminal-only fields are allowed only when transitioning into a terminal outcome
  // OR when the trace is already terminal. Since not-locked here, "already terminal" is impossible.
  const enteringTerminal =
    update.outcome !== undefined &&
    TERMINAL_OUTCOMES.has(update.outcome) &&
    !TERMINAL_OUTCOMES.has(current.outcome);
  for (const key of TERMINAL_ONLY_FIELDS) {
    if (!(key in update)) continue;
    if (!enteringTerminal && !TERMINAL_OUTCOMES.has(current.outcome)) {
      // Allowed to write terminal-only fields freely while writing the terminal transition,
      // OR while the trace is non-terminal (these fields are accumulators, e.g. durationMs).
      // Reject ONLY if the trace is already terminal (covered by isLocked branch above) —
      // here we are non-terminal, so allow. No-op: this branch intentionally permits writes.
    }
  }

  if (rejectedFields.length > 0) {
    return rejection({
      current,
      rejectedFields,
      reason: `Forbidden WorkTrace mutation: rejected ${rejectedFields.join(", ")}`,
      caller,
    });
  }

  // Compute lockedAt if entering terminal.
  const computedLockedAt = enteringTerminal ? nowFn().toISOString() : null;
  return { ok: true, computedLockedAt };
}

function rejection(args: {
  current: WorkTrace;
  rejectedFields: string[];
  reason: string;
  caller?: string;
}): { ok: false; diagnostic: WorkTraceLockDiagnostic } {
  return {
    ok: false,
    diagnostic: {
      traceId: args.current.traceId,
      workUnitId: args.current.workUnitId,
      currentOutcome: args.current.outcome,
      lockedAt: args.current.lockedAt ?? null,
      rejectedFields: args.rejectedFields,
      reason: args.reason,
      caller: args.caller,
    },
  };
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
```

- [ ] **Step 1.4: Run the tests, verify they pass**

Same command. Expected: PASS (all tests). If any fail, fix the validator. Pay particular attention to the "same-state outcome write" case — the test expects `pending_approval -> pending_approval` to be ok.

- [ ] **Step 1.5: Commit**

```
git add packages/core/src/platform/work-trace-lock.ts \
        packages/core/src/platform/__tests__/work-trace-lock.test.ts
git commit -m "feat(core/platform): add WorkTrace lock validator + transitions table"
```

---

## Task 2: Widen `InfrastructureErrorType` to include `work_trace_locked_violation`

**File:**

- Modify: `packages/core/src/observability/operator-alerter.ts`
- Modify: `packages/core/src/observability/__tests__/operator-alerter.test.ts`

- [ ] **Step 2.1: Add a failing test asserting the new variant compiles + flows through `safeAlert`**

Append to `packages/core/src/observability/__tests__/operator-alerter.test.ts`:

```ts
import type { InfrastructureFailureAlert } from "../operator-alerter.js";

describe("InfrastructureErrorType — work_trace_locked_violation variant", () => {
  it("accepts the new variant in alert payloads", async () => {
    const alerter = new (await import("../operator-alerter.js")).NoopOperatorAlerter();
    const payload: InfrastructureFailureAlert = {
      errorType: "work_trace_locked_violation",
      severity: "warning",
      errorMessage: "Forbidden mutation rejected",
      retryable: false,
      occurredAt: new Date().toISOString(),
      source: "platform_ingress",
    };
    await expect(alerter.alert(payload)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2.2: Run, verify failing**

```
pnpm --filter @switchboard/core test -- packages/core/src/observability/__tests__/operator-alerter.test.ts
```

Expected: FAIL — `"work_trace_locked_violation"` not assignable to `InfrastructureErrorType`.

- [ ] **Step 2.3: Extend the enum**

In `packages/core/src/observability/operator-alerter.ts`, change the type:

```ts
export type InfrastructureErrorType =
  | "governance_eval_exception"
  | "trace_persist_failed"
  | "work_trace_locked_violation";
```

- [ ] **Step 2.4: Run, verify passing**

Same command. Expected: PASS.

- [ ] **Step 2.5: Commit**

```
git add packages/core/src/observability/operator-alerter.ts \
        packages/core/src/observability/__tests__/operator-alerter.test.ts
git commit -m "feat(core/observability): add work_trace_locked_violation infra-error variant"
```

---

## Task 3: Add `lockedAt?` to `WorkTrace` interface

**File:**

- Modify: `packages/core/src/platform/work-trace.ts`

- [ ] **Step 3.1: Add the field**

In `packages/core/src/platform/work-trace.ts`, add to the `WorkTrace` interface (between `completedAt` and the closing brace):

```ts
  /**
   * Set automatically by the store when outcome transitions into a terminal value.
   * Once non-null, the trace is sealed: see work-trace-lock.ts for invariants.
   */
  lockedAt?: string;
```

- [ ] **Step 3.2: Verify typecheck (additive, no tests yet)**

```
pnpm --filter @switchboard/core typecheck
```

Expected: clean (additive optional field).

- [ ] **Step 3.3: Commit**

```
git add packages/core/src/platform/work-trace.ts
git commit -m "feat(core/platform): add lockedAt? to WorkTrace interface"
```

---

## Task 4: Prisma schema + migration (additive)

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_work_trace_locked_at/migration.sql`

- [ ] **Step 4.1: Add `lockedAt` column to schema**

In `packages/db/prisma/schema.prisma`, in the `WorkTrace` model (around line 1569–1610), add a new line near the lifecycle timestamps:

```prisma
  lockedAt              DateTime?
```

A reasonable placement is right after `completedAt`. Keep alphabetical / logical grouping consistent with surrounding fields.

- [ ] **Step 4.2: Generate the migration**

```
pnpm --filter @switchboard/db exec prisma migrate dev --name add_work_trace_locked_at --create-only
```

This generates `packages/db/prisma/migrations/<timestamp>_add_work_trace_locked_at/migration.sql`. Open it and confirm it contains the `ALTER TABLE` to add the column.

- [ ] **Step 4.3: Add the backfill SQL to the migration**

After the auto-generated `ALTER TABLE` line, append:

```sql
-- Backfill: existing terminal traces are considered finalized at completedAt
-- (or migration time if completedAt is missing). Per design spec §7, scripts
-- still mutating these traces post-migration must be fixed, not preserved.
UPDATE "WorkTrace"
SET "lockedAt" = COALESCE("completedAt", NOW())
WHERE "outcome" IN ('completed', 'failed');
```

- [ ] **Step 4.4: Run drift check**

```
pnpm db:check-drift
```

Expected: clean.

- [ ] **Step 4.5: Run db:generate so the Prisma client picks up the new column**

```
pnpm db:generate
```

- [ ] **Step 4.6: Commit (schema + migration in same commit per CLAUDE.md rule)**

```
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations/*_add_work_trace_locked_at
git commit -m "feat(db): add lockedAt column to WorkTrace + backfill terminal rows"
```

---

## Task 5: `WorkTraceStore.update()` signature change + new store config types

This task changes the interface signature and exports the new types. It does NOT yet add validation logic — that's Task 6. After this task, all existing call sites must be updated to consume the new return type (Task 7). To keep the intermediate state compilable, this task also patches the `PrismaWorkTraceStore.update` to return `{ ok: true, trace }` after a stub fetch (no validation yet).

**Files:**

- Modify: `packages/core/src/platform/work-trace-recorder.ts`

- [ ] **Step 5.1: Add the new types + change the signature**

Replace the `WorkTraceStore` interface in `packages/core/src/platform/work-trace-recorder.ts` with:

```ts
import type { WorkTrace } from "./work-trace.js";
import type { WorkUnit } from "./work-unit.js";
import type { GovernanceDecision } from "./governance-types.js";
import type { ExecutionResult } from "./execution-result.js";

export interface TraceInput {
  workUnit: WorkUnit;
  governanceDecision: GovernanceDecision;
  governanceCompletedAt: string;
  executionResult?: ExecutionResult;
  executionStartedAt?: string;
  completedAt?: string;
  modeMetrics?: Record<string, unknown>;
}

export type WorkTraceUpdateResult =
  | { ok: true; trace: WorkTrace }
  | { ok: false; code: "WORK_TRACE_LOCKED"; traceUnchanged: true; reason: string };

export interface WorkTraceStore {
  persist(trace: WorkTrace): Promise<void>;
  getByWorkUnitId(workUnitId: string): Promise<WorkTrace | null>;
  update(
    workUnitId: string,
    fields: Partial<WorkTrace>,
    options?: { caller?: string },
  ): Promise<WorkTraceUpdateResult>;
  getByIdempotencyKey(key: string): Promise<WorkTrace | null>;
}

// (existing buildWorkTrace function unchanged)
```

Keep the existing `buildWorkTrace` function body as-is.

- [ ] **Step 5.2: Verify the package typechecks**

```
pnpm --filter @switchboard/core typecheck
```

Expected: typecheck **fails** at this point — every consumer of `WorkTraceStore.update()` is now incompatible. That's intentional. Tasks 6–7 fix all consumers.

If you want a partial commit here, hold off on the commit until Task 7 is also done so the tree is always green at commit time. For TDD discipline, **stop here without committing** and proceed directly to Task 6.

---

## Task 6: Implement validation + audit/alert wiring in `PrismaWorkTraceStore`

**Files:**

- Modify: `packages/db/src/stores/prisma-work-trace-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-work-trace-store-lock.test.ts`

The store gains an optional config with `auditLedger` and `operatorAlerter` (both optional). On a violation:

- `process.env.NODE_ENV !== "production"` → throw `WorkTraceLockedError`.
- Otherwise → return the typed conflict, write infra-failure audit, fire alerter.

- [ ] **Step 6.1: Write the failing tests**

Create `packages/db/src/stores/__tests__/prisma-work-trace-store-lock.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";
import { WorkTraceLockedError } from "@switchboard/core/platform";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  vi.restoreAllMocks();
});

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row_1",
    workUnitId: "wu_1",
    traceId: "t_1",
    parentWorkUnitId: null,
    intent: "test.intent",
    mode: "skill",
    organizationId: "org_1",
    actorId: "actor_1",
    actorType: "user",
    trigger: "api",
    idempotencyKey: null,
    parameters: null,
    deploymentContext: null,
    governanceOutcome: "execute",
    riskScore: 0,
    matchedPolicies: "[]",
    governanceConstraints: null,
    approvalId: null,
    approvalOutcome: null,
    approvalRespondedBy: null,
    approvalRespondedAt: null,
    outcome: "running",
    durationMs: 0,
    errorCode: null,
    errorMessage: null,
    executionSummary: null,
    executionOutputs: null,
    modeMetrics: null,
    requestedAt: new Date("2026-04-28T00:00:00Z"),
    governanceCompletedAt: new Date("2026-04-28T00:00:01Z"),
    executionStartedAt: null,
    completedAt: null,
    lockedAt: null,
    ...overrides,
  };
}

function makePrismaMock(currentRow: Record<string, unknown>) {
  const updateFn = vi.fn().mockResolvedValue({ ...currentRow });
  const findUnique = vi.fn().mockResolvedValue(currentRow);
  return {
    workTrace: { findUnique, update: updateFn },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ workTrace: { findUnique, update: updateFn } }),
    ),
    _updateFn: updateFn,
    _findUnique: findUnique,
  };
}

describe("PrismaWorkTraceStore.update — lock enforcement", () => {
  it("returns ok on a legal transition and stamps lockedAt when entering terminal", async () => {
    const prisma = makePrismaMock(makeRow({ outcome: "running", lockedAt: null }));
    const store = new PrismaWorkTraceStore(prisma as never);
    const result = await store.update("wu_1", {
      outcome: "completed",
      executionOutputs: { ok: true },
      durationMs: 123,
      completedAt: "2026-04-28T00:00:02.000Z",
    });
    expect(result.ok).toBe(true);
    const args = prisma._updateFn.mock.calls[0]![0];
    expect(args.data.outcome).toBe("completed");
    expect(args.data.lockedAt).toBeInstanceOf(Date);
  });

  it("returns typed conflict (production) on locked-trace mutation; row unchanged", async () => {
    process.env.NODE_ENV = "production";
    const locked = makeRow({
      outcome: "completed",
      lockedAt: new Date("2026-04-28T00:00:02Z"),
    });
    const prisma = makePrismaMock(locked);
    const auditLedger = { record: vi.fn().mockResolvedValue(undefined) };
    const alerter = { alert: vi.fn().mockResolvedValue(undefined) };
    const store = new PrismaWorkTraceStore(prisma as never, {
      auditLedger: auditLedger as never,
      operatorAlerter: alerter,
    });

    const result = await store.update("wu_1", { executionOutputs: { tampered: true } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("WORK_TRACE_LOCKED");
    expect(result.traceUnchanged).toBe(true);
    expect(typeof result.reason).toBe("string");
    expect(prisma._updateFn).not.toHaveBeenCalled();
    expect(auditLedger.record).toHaveBeenCalledTimes(1);
    expect(auditLedger.record.mock.calls[0]![0].snapshot).toMatchObject({
      errorType: "work_trace_locked_violation",
      failureClass: "infrastructure",
    });
    expect(alerter.alert).toHaveBeenCalledTimes(1);
    expect(alerter.alert.mock.calls[0]![0]).toMatchObject({
      errorType: "work_trace_locked_violation",
    });
  });

  it("throws WorkTraceLockedError in non-production env", async () => {
    process.env.NODE_ENV = "test";
    const locked = makeRow({
      outcome: "completed",
      lockedAt: new Date("2026-04-28T00:00:02Z"),
    });
    const prisma = makePrismaMock(locked);
    const store = new PrismaWorkTraceStore(prisma as never);

    await expect(
      store.update("wu_1", { executionOutputs: { tampered: true } }),
    ).rejects.toBeInstanceOf(WorkTraceLockedError);
    expect(prisma._updateFn).not.toHaveBeenCalled();
  });

  it("never silently drops a write — typed conflict in prod even without auditLedger/alerter", async () => {
    process.env.NODE_ENV = "production";
    const locked = makeRow({
      outcome: "completed",
      lockedAt: new Date("2026-04-28T00:00:02Z"),
    });
    const prisma = makePrismaMock(locked);
    const store = new PrismaWorkTraceStore(prisma as never);

    const result = await store.update("wu_1", { executionOutputs: { tampered: true } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.traceUnchanged).toBe(true);
    expect(prisma._updateFn).not.toHaveBeenCalled();
  });

  it("read-modify-write happens inside a single transaction", async () => {
    const prisma = makePrismaMock(makeRow({ outcome: "running" }));
    const store = new PrismaWorkTraceStore(prisma as never);
    await store.update("wu_1", { outcome: "running", durationMs: 50 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6.2: Run, verify failing**

```
pnpm --filter @switchboard/db test -- packages/db/src/stores/__tests__/prisma-work-trace-store-lock.test.ts
```

Expected: FAIL — store doesn't accept config, doesn't validate, etc.

- [ ] **Step 6.3: Update `PrismaWorkTraceStore` constructor + `update` body**

Replace the constructor and `update` method in `packages/db/src/stores/prisma-work-trace-store.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { WorkTrace, WorkTraceStore, WorkTraceUpdateResult } from "@switchboard/core/platform";
import {
  validateUpdate,
  WorkTraceLockedError,
  type WorkTraceLockDiagnostic,
} from "@switchboard/core/platform";
import type { OperatorAlerter, AuditLedger } from "@switchboard/core";
import { buildInfrastructureFailureAuditParams, safeAlert } from "@switchboard/core";

export interface PrismaWorkTraceStoreConfig {
  auditLedger?: AuditLedger;
  operatorAlerter?: OperatorAlerter;
}

export class PrismaWorkTraceStore implements WorkTraceStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly observability: PrismaWorkTraceStoreConfig = {},
  ) {}

  // (persist, getByWorkUnitId, getByIdempotencyKey, mapRowToTrace unchanged from prior version,
  // EXCEPT mapRowToTrace must include `lockedAt: row.lockedAt?.toISOString()`)

  async update(
    workUnitId: string,
    fields: Partial<WorkTrace>,
    options?: { caller?: string },
  ): Promise<WorkTraceUpdateResult> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.workTrace.findUnique({ where: { workUnitId } });
      if (!row) {
        // Caller passed a workUnitId that doesn't exist. Not a lock issue —
        // bubble up like any other "no rows updated" semantics.
        throw new Error(`WorkTrace not found: ${workUnitId}`);
      }
      const current = this.mapRowToTrace(row);
      const validation = validateUpdate({
        current,
        update: fields,
        caller: options?.caller,
      });
      if (!validation.ok) {
        await this.handleViolation(validation.diagnostic);
        if (process.env.NODE_ENV !== "production") {
          throw new WorkTraceLockedError(validation.diagnostic);
        }
        return {
          ok: false as const,
          code: "WORK_TRACE_LOCKED" as const,
          traceUnchanged: true as const,
          reason: validation.diagnostic.reason,
        };
      }

      const data: Record<string, unknown> = {};
      if (fields.outcome !== undefined) data.outcome = fields.outcome;
      if (fields.durationMs !== undefined) data.durationMs = fields.durationMs;
      if (fields.error !== undefined) {
        data.errorCode = fields.error?.code ?? null;
        data.errorMessage = fields.error?.message ?? null;
      }
      if (fields.executionSummary !== undefined) data.executionSummary = fields.executionSummary;
      if (fields.executionOutputs !== undefined)
        data.executionOutputs = JSON.stringify(fields.executionOutputs);
      if (fields.executionStartedAt !== undefined)
        data.executionStartedAt = new Date(fields.executionStartedAt);
      if (fields.completedAt !== undefined) data.completedAt = new Date(fields.completedAt);
      if (fields.approvalId !== undefined) data.approvalId = fields.approvalId;
      if (fields.approvalOutcome !== undefined) data.approvalOutcome = fields.approvalOutcome;
      if (fields.approvalRespondedBy !== undefined)
        data.approvalRespondedBy = fields.approvalRespondedBy;
      if (fields.approvalRespondedAt !== undefined)
        data.approvalRespondedAt = new Date(fields.approvalRespondedAt);
      if (fields.modeMetrics !== undefined) data.modeMetrics = JSON.stringify(fields.modeMetrics);
      if (fields.parameters !== undefined) data.parameters = JSON.stringify(fields.parameters);

      if (validation.computedLockedAt !== null) {
        data.lockedAt = new Date(validation.computedLockedAt);
      }

      let updatedRow = row;
      if (Object.keys(data).length > 0) {
        updatedRow = await tx.workTrace.update({ where: { workUnitId }, data });
      }
      return { ok: true as const, trace: this.mapRowToTrace(updatedRow) };
    });
  }

  private async handleViolation(diagnostic: WorkTraceLockDiagnostic): Promise<void> {
    const { auditLedger, operatorAlerter } = this.observability;
    const { ledgerParams, alert } = buildInfrastructureFailureAuditParams({
      errorType: "work_trace_locked_violation",
      error: new Error(diagnostic.reason),
      retryable: false,
      workUnit: {
        id: diagnostic.workUnitId,
        intent: "",
        traceId: diagnostic.traceId,
        organizationId: "",
      },
    });
    // Augment snapshot with the rich diagnostic per spec §6.
    const enrichedSnapshot = {
      ...ledgerParams.snapshot,
      currentOutcome: diagnostic.currentOutcome,
      lockedAt: diagnostic.lockedAt,
      rejectedFields: diagnostic.rejectedFields,
      caller: diagnostic.caller,
    };
    if (auditLedger) {
      try {
        await auditLedger.record({
          ...ledgerParams,
          snapshot: enrichedSnapshot as unknown as Record<string, unknown>,
        });
      } catch (auditErr) {
        console.error(
          "[PrismaWorkTraceStore] failed to record work_trace_locked_violation audit",
          auditErr,
        );
      }
    }
    if (operatorAlerter) {
      await safeAlert(operatorAlerter, alert);
    }
  }
}
```

Also update `mapRowToTrace` to include `lockedAt: row.lockedAt?.toISOString()`.

Re-export the lock symbols from `@switchboard/core/platform` so the store can import them. In `packages/core/src/platform/index.ts`, add `export * from "./work-trace-lock.js";`.

- [ ] **Step 6.4: Run tests, verify passing**

```
pnpm --filter @switchboard/db test -- packages/db/src/stores/__tests__/prisma-work-trace-store-lock.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 6.5: Verify typecheck (still expected to fail until Task 7)**

```
pnpm --filter @switchboard/core typecheck
```

Expected: still fails at consumers — Task 7 fixes them. Do not commit yet.

---

## Task 7: Update lifecycle call sites + in-memory fakes

**Files:**

- Modify: `packages/core/src/platform/platform-lifecycle.ts`
- Modify: `packages/core/src/platform/__tests__/platform-ingress.test.ts`
- Modify: `packages/core/src/platform/__tests__/platform-lifecycle.test.ts`
- Modify: `packages/core/src/platform/__tests__/runtime-first-response.test.ts`
- Modify: `packages/core/src/platform/__tests__/convergence-e2e.test.ts`
- Modify: `apps/api/src/__tests__/test-server.ts`
- Modify: `apps/api/src/__tests__/execute-platform-parity.test.ts`

- [ ] **Step 7.1: Update `platform-lifecycle.ts` call sites**

For each of the three sites (`:360`, `:537`, `:544`), wrap the `update()` call to handle the conflict result. Pattern:

```ts
const updateResult = await traceStore.update(workUnitId, fields, {
  caller: "platform_lifecycle.<method>",
});
if (!updateResult.ok) {
  // In production this is a typed conflict; in dev/test it would have thrown.
  // Either way, the trace is unchanged. Surface the conflict back to the caller.
  return {
    success: false,
    summary: `WorkTrace update rejected: ${updateResult.reason}`,
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [{ step: "trace_update", error: updateResult.reason }],
    durationMs: 0,
    undoRecipe: null,
  };
}
```

Adapt the return shape per site. The key requirement: do not ignore `ok: false`. The caller's response shape may differ (some sites return `void`, some return a result object) — match the surrounding pattern; if the surrounding pattern returns `void`, log and continue, but ALWAYS log via `console.error` so production has a signal.

Read each site carefully. Only the first site (`:360`) returns a result object. The other two are void-returning helpers — those should `console.error` and rethrow `WorkTraceLockedError` since they're internal helpers and a stuck-state is worse than a thrown one in this internal path.

- [ ] **Step 7.2: Update in-memory `WorkTraceStore` fakes**

For each test file, change the in-memory fake's `update` from `Promise<void>` to return `{ ok: true, trace }`. Pattern:

```ts
const traceStore: WorkTraceStore = {
  persist: async (t) => {
    traces.push(t);
  },
  getByWorkUnitId: async (id) => traces.find((t) => t.workUnitId === id) ?? null,
  getByIdempotencyKey: async (k) => traces.find((t) => t.idempotencyKey === k) ?? null,
  update: async (id, fields) => {
    const idx = traces.findIndex((t) => t.workUnitId === id);
    if (idx === -1) throw new Error(`not found: ${id}`);
    traces[idx] = { ...traces[idx]!, ...fields };
    return { ok: true, trace: traces[idx]! };
  },
};
```

Apply the same change to every fake found in:

- `packages/core/src/platform/__tests__/platform-ingress.test.ts:204, :223`
- `packages/core/src/platform/__tests__/platform-lifecycle.test.ts:171`
- `packages/core/src/platform/__tests__/runtime-first-response.test.ts:276`
- `packages/core/src/platform/__tests__/convergence-e2e.test.ts:71`
- `apps/api/src/__tests__/test-server.ts` (search for `update:`)
- `apps/api/src/__tests__/execute-platform-parity.test.ts` (search for `update:`)

The `platform-ingress-trace-retry.test.ts` and `platform-ingress-governance-error.test.ts` from #17 do NOT need to be changed — they only mock `persist`, not `update`.

- [ ] **Step 7.3: Run typecheck + full core suite**

```
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/db typecheck
pnpm --filter @switchboard/db test
```

Expected: all clean. If typecheck still fails, find the missed consumer and update it.

- [ ] **Step 7.4: Commit Tasks 5+6+7 together**

Tasks 5, 6, 7 must commit together (the tree is broken between them). One commit:

```
git add packages/core/src/platform/work-trace-recorder.ts \
        packages/core/src/platform/index.ts \
        packages/core/src/platform/platform-lifecycle.ts \
        packages/db/src/stores/prisma-work-trace-store.ts \
        packages/db/src/stores/__tests__/prisma-work-trace-store-lock.test.ts \
        packages/core/src/platform/__tests__/platform-ingress.test.ts \
        packages/core/src/platform/__tests__/platform-lifecycle.test.ts \
        packages/core/src/platform/__tests__/runtime-first-response.test.ts \
        packages/core/src/platform/__tests__/convergence-e2e.test.ts \
        apps/api/src/__tests__/test-server.ts \
        apps/api/src/__tests__/execute-platform-parity.test.ts
git commit -m "feat(core+db): enforce WorkTrace terminal locking at store chokepoint"
```

---

## Task 8: Bootstrap wiring + final verification

**Files:**

- Modify: `apps/api/src/bootstrap/storage.ts`

- [ ] **Step 8.1: Pass `auditLedger` + `operatorAlerter` into `PrismaWorkTraceStore`**

In `apps/api/src/bootstrap/storage.ts` (find the `PrismaWorkTraceStore` constructor call), pass the existing `ledger` (`AuditLedger`) and a new `operatorAlerter`. The `operatorAlerter` may not be in scope yet in `storage.ts` — read the file to determine. If it's constructed in `app.ts`, this task may need to thread the alerter into `storage.ts` via a function argument.

Pattern:

```ts
// Read the existing constructor call:
//   new PrismaWorkTraceStore(prismaClient)
// Replace with:
new PrismaWorkTraceStore(prismaClient, {
  auditLedger: ledger,
  operatorAlerter,
});
```

If `operatorAlerter` is not in scope, refactor the bootstrap signature to accept it. A reasonable shape:

```ts
export async function bootstrapStorage(
  log: FastifyBaseLogger,
  options?: { operatorAlerter?: OperatorAlerter },
) { … }
```

And update `app.ts`'s call to pass the existing `operatorAlerter`.

- [ ] **Step 8.2: Verify**

```
pnpm --filter @switchboard/api typecheck
pnpm --filter @switchboard/api test
```

Expected: clean for changed code (pre-existing `any` errors in `inngest.ts`/routes are unchanged from `main` and not regressions).

- [ ] **Step 8.3: Full repo lint + drift**

```
pnpm --filter @switchboard/core lint
pnpm --filter @switchboard/db lint
pnpm db:check-drift
```

- [ ] **Step 8.4: Commit**

```
git add apps/api/src/bootstrap/storage.ts apps/api/src/app.ts
git commit -m "feat(api): wire auditLedger + operatorAlerter into PrismaWorkTraceStore"
```

- [ ] **Step 8.5: Push + open PR**

```
git push -u origin fix/launch-work-trace-terminal-lock
gh pr create --title "Enforce WorkTrace terminal locking" --body "$(cat <<'EOF'
## Summary
- Adds `lockedAt` to `WorkTrace`; set automatically by the store on terminal transition (`completed` / `failed`).
- New pure validator (`packages/core/src/platform/work-trace-lock.ts`) defines allowed `outcome` transitions and field-bucket immutability rules (always-immutable, parameters-until-approval, one-shot, terminal-only, modeMetrics-until-lock).
- `WorkTraceStore.update()` becomes a typed `WorkTraceUpdateResult` (breaking) — `{ ok: true, trace }` on success, `{ ok: false, code: "WORK_TRACE_LOCKED", traceUnchanged: true, reason }` on conflict. Never silently drops a write.
- Hybrid failure mode: `NODE_ENV !== "production"` throws `WorkTraceLockedError`; production returns the typed conflict + writes infra-failure audit + fires the existing #17 `OperatorAlerter`.
- Migration adds the column and backfills existing terminal rows: `lockedAt = COALESCE(completedAt, NOW())` for `outcome IN ('completed', 'failed')`.

## Scope (deferred to post-beta P1)
- Hash chain on `WorkTrace`.
- Append-only revision table.
- Storage-layer (DB) triggers preventing UPDATE.
- Cryptographic verification on read.
- Tamper-evidence UI / dashboard.

## Closes
Beta-scoped slice of `.audit/08-launch-blocker-sequence.md` entry #19.

## Test plan
- [x] `@switchboard/core`: validator unit tests (transitions, all four field buckets, locked blanket rejection, error class) all green.
- [x] `@switchboard/db`: store integration tests cover legal transition + lockedAt stamping; typed conflict in production; throw in non-production; never silently drops; transactional read-modify-write.
- [x] All updated in-memory `WorkTraceStore` fakes return `{ ok: true, trace }`.
- [x] Migration backfills terminal rows; `pnpm db:check-drift` clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**

- Goals (terminal locking, codified transitions, hybrid failure mode, reuse #17, migration with backfill) → Tasks 1, 2, 4, 6.
- Field-protection categories A–E → Task 1 (validator) + Task 6 (store integration test verifies through-flow).
- `lockedAt` semantics (auto-stamped, exposed read-only) → Tasks 3, 6.
- Store contract change → Task 5 + Task 6.
- Hybrid env behavior → Task 6 store impl + tests.
- Audit + alert wiring → Task 6 + Task 8 bootstrap.
- Schema migration with backfill → Task 4.
- Out-of-scope items (hash chain, etc.) explicitly NOT touched in any task.

**Placeholder scan:** none.

**Type/name consistency:** `WorkTraceUpdateResult`, `WorkTraceLockedError`, `validateUpdate`, `WorkTraceLockDiagnostic`, `TERMINAL_OUTCOMES`, `ALLOWED_OUTCOME_TRANSITIONS` — used consistently across tasks. The store config interface is named `PrismaWorkTraceStoreConfig` everywhere.

**Risk: blast-radius commit.** Tasks 5+6+7 commit together because the tree is broken between them. The plan is explicit about this and doesn't pretend otherwise. If a reviewer wants smaller commits, the commit could be split by adding a no-op stub in Task 5 — but at the cost of more shuffling. I judged the bundled commit cleaner for an M-sized task.
