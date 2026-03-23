# Native Runtime Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 7 CI-blocking issues and 2 code quality warnings found during the native runtime audit — get typecheck + tests green.

**Architecture:** The fixes are isolated to `apps/api/` — no changes to `packages/core/`, `packages/schemas/`, or `packages/agents/`. The problems are: (1) missing npm dependencies not installed, (2) type mismatches between `TriggerWorkflowEngine` structural interface and the real `WorkflowEngine`, (3) incomplete test mocks, and (4) `app.ts` exceeding the 600-line file size limit.

**Tech Stack:** TypeScript, Vitest, pnpm, BullMQ, Fastify

---

## File Map

```
apps/api/
  src/
    app.ts                                      — MODIFY: remove roleManifests block, extract session bootstrap
    bootstrap/
      compile-role-checkpoint-validator.ts       — DELETE (OpenClaw leftover)
      role-manifests.ts                          — DELETE (OpenClaw leftover)
      session-bootstrap.ts                       — CREATE: extracted session runtime bootstrap
      scheduler-deps.ts                          — NO CHANGE (triggerHandler type already correct)
    scheduler/
      trigger-handler.ts                         — MODIFY: fix TriggerWorkflowEngine.actions type + narrow Job to { data }
      __tests__/
        bullmq-scheduler-service.test.ts         — MODIFY: add expireOverdue to mock
    routes/
      sessions.ts                               — MODIFY: remove roleManifests dependency
      __tests__/
        scheduler.test.ts                        — MODIFY: fix type annotations on test fixtures
```

---

### Task 1: Install Missing Dependencies

**Files:**

- Check: `apps/api/package.json` (already declares `jose` and `ajv`)

The `jose` and `ajv` packages are declared in `package.json` but not installed in `node_modules`. This causes `TS2307: Cannot find module` errors.

- [ ] **Step 1: Run pnpm install**

```bash
cd /Users/jasonljc/switchboard && npx pnpm install
```

Expected: lockfile updated, `jose` and `ajv` now in `node_modules`.

- [ ] **Step 2: Verify modules resolve**

```bash
ls node_modules/jose/package.json && ls node_modules/ajv/package.json
```

Expected: both files exist.

- [ ] **Step 3: Verify session-token test passes**

```bash
npx pnpm --filter @switchboard/api exec vitest run src/__tests__/session-token.test.ts
```

Expected: PASS (2 test suites).

- [ ] **Step 4: Commit**

```bash
git add pnpm-lock.yaml && git commit -m "fix: install missing jose and ajv dependencies"
```

---

### Task 2: Delete OpenClaw Leftover Files and Unwire roleManifests

**Files:**

- Delete: `apps/api/src/bootstrap/compile-role-checkpoint-validator.ts`
- Delete: `apps/api/src/bootstrap/role-manifests.ts`
- Modify: `apps/api/src/app.ts` (lines 66, 314–350)
- Modify: `apps/api/src/routes/sessions.ts` (line 32 — uses `app.roleManifests`)

The design spec (Section 3) marks `role-manifests.ts` and `compile-role-checkpoint-validator.ts` for deletion. These are used by the session runtime for checkpoint validation. After removal, the session create route (`POST /api/sessions`) can no longer look up role manifests by ID, so it must be updated.

**Approach:** The old session runtime is being phased out in favor of WorkflowEngine. Rather than preserving manifest loading, simplify the sessions route to return 503 ("Session runtime deprecated — use workflow API") when role manifests are unavailable. Get/cancel routes don't use manifests, so they're unaffected.

- [ ] **Step 1: Delete both files**

```bash
rm apps/api/src/bootstrap/compile-role-checkpoint-validator.ts
rm apps/api/src/bootstrap/role-manifests.ts
```

- [ ] **Step 2: Remove roleManifests from FastifyInstance and app.ts**

In `apps/api/src/app.ts`, make these changes:

**Line 66** — Delete the `roleManifests` type declaration from `FastifyInstance` interface:

```typescript
// DELETE this line:
roleManifests: Map<string, import("./bootstrap/role-manifests.js").LoadedManifest>;
```

**Lines 314–350** — Replace the entire session runtime bootstrap block with:

```typescript
// --- Session runtime bootstrap (optional — requires DATABASE_URL + SESSION_TOKEN_SECRET) ---
let sessionManager: import("@switchboard/core/sessions").SessionManager | null = null;

if (prismaClient && process.env["SESSION_TOKEN_SECRET"]) {
  const { SessionManager } = await import("@switchboard/core/sessions");
  const {
    PrismaSessionStore,
    PrismaRunStore,
    PrismaPauseStore,
    PrismaToolEventStore,
    PrismaRoleOverrideStore,
  } = await import("@switchboard/db");

  sessionManager = new SessionManager({
    sessions: new PrismaSessionStore(prismaClient),
    runs: new PrismaRunStore(prismaClient),
    pauses: new PrismaPauseStore(prismaClient),
    toolEvents: new PrismaToolEventStore(prismaClient),
    roleOverrides: new PrismaRoleOverrideStore(prismaClient),
    maxConcurrentSessions: parseInt(process.env["MAX_CONCURRENT_SESSIONS"] ?? "10", 10),
    getRoleCheckpointValidator: () => undefined,
  });

  app.log.info("Session runtime enabled (checkpoint validation skipped — use workflow API)");
}

app.decorate("sessionManager", sessionManager);
```

Remove the `app.decorate("roleManifests", roleManifests);` line entirely.

- [ ] **Step 3: Update sessions route to not depend on roleManifests**

In `apps/api/src/routes/sessions.ts`, the POST `/` handler uses `app.roleManifests.get(body.roleId)` at line 32 to look up manifest defaults for session creation. Since manifests are gone, replace the roleManifests lookup with hardcoded defaults.

Replace lines 31–49 of `apps/api/src/routes/sessions.ts`:

```typescript
      // Role manifests removed — use safe defaults for legacy session creation
      const manifestDefaults = {
        safetyEnvelope: {
          sessionTimeoutMs: 300_000,
          maxTurns: 20,
          maxToolCalls: 50,
        },
        toolPack: [],
        governanceProfile: undefined,
      };

      try {
        const { session, run } = await app.sessionManager.createSession({
          organizationId: body.organizationId,
          roleId: body.roleId,
          principalId: body.principalId,
          manifestDefaults,
          safetyEnvelopeOverride: body.safetyEnvelopeOverride,
          maxConcurrentSessionsForRole: 10,
        });
```

Also remove the `import { issueSessionToken }` if no longer needed — but it IS still used on line 55, so keep it.

- [ ] **Step 4: Verify typecheck passes for all modified files**

```bash
npx pnpm --filter @switchboard/api exec tsc --noEmit 2>&1 | grep -E "role-manifests|compile-role-checkpoint|roleManifests|sessions\.ts"
```

Expected: no output (no references remain).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix: remove OpenClaw leftover role-manifests and checkpoint-validator"
```

---

### Task 3: Fix TriggerWorkflowEngine Type Mismatch

**Files:**

- Modify: `apps/api/src/scheduler/trigger-handler.ts:1-33`

Two type issues: (1) `TriggerWorkflowEngine.createWorkflow` uses `actions: unknown[]` but `WorkflowEngine.createWorkflow` expects `actions: PendingAction[]`. (2) The handler function parameter is typed as `Job<SchedulerJobData>` but only accesses `job.data` — using the full `Job` type forces callers (like `app.ts` EventLoop wiring) to cast plain objects.

**Fix both by:** importing `PendingAction` for the actions type, and narrowing the handler param from `Job<T>` to `{ data: T }`.

- [ ] **Step 1: Verify the current typecheck fails**

```bash
npx pnpm --filter @switchboard/api exec tsc --noEmit 2>&1 | grep -E "app\.ts.*TriggerWorkflowEngine|scheduler-deps.*triggerHandler"
```

Expected: errors at app.ts:408 and scheduler-deps.ts:39.

- [ ] **Step 2: Rewrite trigger-handler.ts imports and interface**

Replace lines 1–33 of `apps/api/src/scheduler/trigger-handler.ts` with:

```typescript
import type { TriggerStore } from "@switchboard/core";
import type { PendingAction } from "@switchboard/schemas";
import type { SchedulerJobData } from "../queue/scheduler-queue.js";

// Structural typing for WorkflowEngine — only the methods trigger-handler needs.
// Uses PendingAction[] to match CreateWorkflowInput exactly.
export interface TriggerWorkflowEngine {
  createWorkflow(input: {
    organizationId: string;
    triggerType: "schedule";
    triggerRef: string;
    sourceAgent: string;
    actions: PendingAction[];
    strategy: "sequential";
    safetyEnvelope: {
      maxSteps: number;
      maxDollarsAtRisk: number;
      timeoutMs: number;
      maxReplans: number;
    };
    metadata: Record<string, unknown>;
  }): Promise<{ id: string }>;
  startWorkflow(workflowId: string): Promise<unknown>;
}

export interface TriggerHandlerDeps {
  store: TriggerStore;
  workflowEngine: TriggerWorkflowEngine;
}

export function createTriggerHandler(deps: TriggerHandlerDeps) {
  const { store, workflowEngine } = deps;

  return async function handleTriggerFired(job: { data: SchedulerJobData }): Promise<void> {
    const { triggerId, organizationId, action } = job.data;
```

Key changes:

- Removed `import type { Job } from "bullmq"` — handler only needs `{ data: T }`
- Added `import type { PendingAction } from "@switchboard/schemas"`
- Changed `actions: unknown[]` → `actions: PendingAction[]`
- Changed `job: Job<SchedulerJobData>` → `job: { data: SchedulerJobData }`

The rest of the function (lines 34–72) stays unchanged.

- [ ] **Step 3: Verify typecheck passes**

```bash
npx pnpm --filter @switchboard/api exec tsc --noEmit 2>&1 | grep -E "app\.ts.*Trigger|scheduler-deps|trigger-handler"
```

Expected: no output. The `SchedulerDeps.triggerHandler` type is already `(job: { data: SchedulerJobData }) => Promise<void>` which now matches the handler's return type. The `TriggerWorkflowEngine` now accepts `PendingAction[]` so `WorkflowEngine` satisfies it structurally. The BullMQ `Worker` still works because `Job<T>` structurally satisfies `{ data: T }`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "fix: align TriggerWorkflowEngine types and narrow handler param"
```

---

### Task 4: Fix Test Mock Missing expireOverdue

**Files:**

- Modify: `apps/api/src/scheduler/__tests__/bullmq-scheduler-service.test.ts:25-26`

The mock `TriggerStore` is missing the `expireOverdue` method added to the `TriggerStore` interface.

- [ ] **Step 1: Add expireOverdue to mock store**

In `apps/api/src/scheduler/__tests__/bullmq-scheduler-service.test.ts`, add `expireOverdue` after the `deleteExpired` line (line 25):

```typescript
    deleteExpired: vi.fn(async () => 0),
    expireOverdue: vi.fn(async () => 0),
```

- [ ] **Step 2: Verify test passes**

```bash
npx pnpm --filter @switchboard/api exec vitest run src/scheduler/__tests__/bullmq-scheduler-service.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "fix: add missing expireOverdue to BullMQ scheduler test mock"
```

---

### Task 5: Fix Scheduler Route Test Types

**Files:**

- Modify: `apps/api/src/routes/__tests__/scheduler.test.ts:24,116-118,154-168`

Three type errors: (1) `request` parameter implicitly has `any` type (line 24), (2) incomplete mock trigger objects inferred as `never` (lines 117, 155).

- [ ] **Step 1: Fix onRequest hook type (line 24)**

Change:

```typescript
    app.addHook("onRequest", async (request) => {
```

to:

```typescript
    app.addHook("onRequest", async (request: import("fastify").FastifyRequest) => {
```

- [ ] **Step 2: Fix DELETE test mock trigger (lines 116-118)**

Replace the incomplete mock with a full `ScheduledTrigger` object:

```typescript
scheduler.listPendingTriggers.mockResolvedValue([
  {
    id: "trig-1",
    organizationId: "org-1",
    type: "timer" as const,
    status: "active" as const,
    action: { type: "spawn_workflow" as const, payload: {} },
    fireAt: new Date(),
    cronExpression: null,
    eventPattern: null,
    sourceWorkflowId: null,
    createdAt: new Date(),
    expiresAt: null,
  },
]);
```

- [ ] **Step 3: Add `as const` to GET test mock trigger (lines 154-168)**

Change `type: "timer"` → `type: "timer" as const`, `status: "active"` → `status: "active" as const`, and `type: "spawn_workflow"` → `type: "spawn_workflow" as const` in the existing mock object.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx pnpm --filter @switchboard/api exec vitest run src/routes/__tests__/scheduler.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix: add type annotations to scheduler route test fixtures"
```

---

### Task 6: Verify Full Typecheck + Test Suite

**Files:** None — validation only.

- [ ] **Step 1: Run full typecheck**

```bash
npx pnpm typecheck
```

Expected: 25/25 tasks successful, 0 failed.

- [ ] **Step 2: Run full test suite**

```bash
npx pnpm test
```

Expected: all suites pass (841+ tests, 0 failures).

- [ ] **Step 3: If jose still fails, reinstall**

```bash
npx pnpm --filter @switchboard/api add jose@^6.2.2
```

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A && git commit -m "fix: resolve remaining typecheck and test failures"
```

---

### Task 7: Split app.ts Below 600-Line Limit

**Files:**

- Create: `apps/api/src/bootstrap/session-bootstrap.ts`
- Modify: `apps/api/src/app.ts`

After Tasks 2-3, `app.ts` will be ~600 lines (removed ~33 lines from roleManifests + manifest loading block). To ensure it stays under the 600-line error threshold, extract session runtime bootstrap.

**Note:** Task 7 depends on Task 2 completing first (the session block modified by Task 2 is what gets extracted here).

- [ ] **Step 1: Count current app.ts lines**

```bash
wc -l apps/api/src/app.ts
```

If already under 600, skip this task. Otherwise continue.

- [ ] **Step 2: Create session-bootstrap.ts**

Create `apps/api/src/bootstrap/session-bootstrap.ts`:

```typescript
import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@switchboard/db";
import type { SessionManager } from "@switchboard/core/sessions";

export interface SessionBootstrapResult {
  sessionManager: SessionManager;
}

export async function bootstrapSessionRuntime(
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
): Promise<SessionBootstrapResult | null> {
  const sessionTokenSecret = process.env["SESSION_TOKEN_SECRET"];
  if (!sessionTokenSecret) return null;

  const { SessionManager } = await import("@switchboard/core/sessions");
  const {
    PrismaSessionStore,
    PrismaRunStore,
    PrismaPauseStore,
    PrismaToolEventStore,
    PrismaRoleOverrideStore,
  } = await import("@switchboard/db");

  const maxConcurrent = parseInt(process.env["MAX_CONCURRENT_SESSIONS"] ?? "10", 10);

  const sessionManager = new SessionManager({
    sessions: new PrismaSessionStore(prisma),
    runs: new PrismaRunStore(prisma),
    pauses: new PrismaPauseStore(prisma),
    toolEvents: new PrismaToolEventStore(prisma),
    roleOverrides: new PrismaRoleOverrideStore(prisma),
    maxConcurrentSessions: maxConcurrent,
    getRoleCheckpointValidator: () => undefined,
  });

  logger.info("Session runtime enabled");
  return { sessionManager };
}
```

- [ ] **Step 3: Replace session block in app.ts**

Replace the session runtime bootstrap block in `app.ts` with:

```typescript
// --- Session runtime bootstrap (optional — requires DATABASE_URL + SESSION_TOKEN_SECRET) ---
let sessionManager: import("@switchboard/core/sessions").SessionManager | null = null;
if (prismaClient) {
  const { bootstrapSessionRuntime } = await import("./bootstrap/session-bootstrap.js");
  const sessionResult = await bootstrapSessionRuntime(prismaClient, app.log);
  sessionManager = sessionResult?.sessionManager ?? null;
}
app.decorate("sessionManager", sessionManager);
```

Keep the `sessionManager` type on the `FastifyInstance` interface — only the `roleManifests` line was removed in Task 2.

- [ ] **Step 4: Verify app.ts is under 600 lines**

```bash
wc -l apps/api/src/app.ts
```

Expected: under 600 lines. If still over, also extract the operator deps block (lines 426-437) into `operator-deps.ts` `bootstrapOperatorDeps()`.

- [ ] **Step 5: Run typecheck + tests**

```bash
npx pnpm --filter @switchboard/api exec tsc --noEmit && npx pnpm --filter @switchboard/api test
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor: extract session bootstrap from app.ts to stay under 600-line limit"
```

---

## Summary

| Task | What                                             | Fixes                                                                      | Depends On |
| ---- | ------------------------------------------------ | -------------------------------------------------------------------------- | ---------- |
| 1    | Install missing deps                             | `jose` TS2307, `ajv` TS2307                                                | —          |
| 2    | Delete OpenClaw leftovers + unwire roleManifests | `role-manifests.ts`, `compile-role-checkpoint-validator.ts`, `sessions.ts` | 1          |
| 3    | Fix trigger-handler types                        | `TriggerWorkflowEngine` TS2345, handler `Job` vs `{ data }` TS2322         | —          |
| 4    | Fix test mock                                    | `expireOverdue` missing TS2741                                             | —          |
| 5    | Fix test types                                   | Scheduler route test TS7006, TS2322                                        | —          |
| 6    | Verify green CI                                  | Full typecheck + test suite                                                | 1-5        |
| 7    | Split app.ts                                     | Below 600-line limit                                                       | 2          |
