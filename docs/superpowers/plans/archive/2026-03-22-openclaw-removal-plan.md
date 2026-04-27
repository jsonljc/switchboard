# Phase 1: OpenClaw Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all OpenClaw gateway code, leaving a clean codebase for the Switchboard-native runtime redesign.

**Architecture:** PR 156 introduced an OpenClaw external gateway integration (HTTP client, circuit breaker, session invocation worker, outcome persistence, health probes). This plan deletes all gateway-specific code while preserving the reusable session primitives (state machine, SessionManager core, Prisma models) that will be redesigned in Phase 3.

**Tech Stack:** TypeScript, Prisma, Fastify, Vitest, pnpm

**Spec:** `docs/superpowers/specs/2026-03-22-switchboard-native-runtime-design.md` (Section 3)

**Important context:**

- PR 156 was merged to `main` but the current working branch `feat/eventloop-conversation-architecture` does not have these changes yet. You must first merge main or rebase to get the PR 156 code before deleting it.
- This repo uses ESM with `.js` extensions in relative imports (except `apps/dashboard/`).
- Run `pnpm test` and `pnpm typecheck` after each task to verify nothing breaks.
- Conventional commits enforced: `chore:` prefix for removal tasks.

---

### Task 1: Sync Branch with Main

**Files:**

- No file changes — git operations only

- [ ] **Step 1: Pull latest main and rebase**

```bash
git fetch origin main
git rebase origin/main
```

If conflicts arise, resolve them — PR 156 changes will appear on the branch.

- [ ] **Step 2: Verify PR 156 files exist**

```bash
ls apps/api/src/gateway/gateway-client.ts
ls packages/core/src/sessions/apply-gateway-outcome.ts
ls packages/db/src/sessions/apply-gateway-outcome-locked.ts
```

All three should exist. If not, the rebase didn't pick up PR 156.

- [ ] **Step 3: Run tests to confirm clean baseline**

```bash
pnpm test
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 4: Commit if rebase created merge artifacts**

Only if needed. No commit if rebase was clean.

---

### Task 2: Delete Gateway Directory

**Files:**

- Delete: `apps/api/src/gateway/` (entire directory — 12 source files + 6 test files)

The gateway directory contains: `gateway-client.ts`, `http-gateway-client.ts`, `resilient-gateway-client.ts`, `mock-gateway-client.ts`, `gateway-errors.ts`, `circuit-breaker.ts`, `openclaw-gateway-protocol.ts`, `openclaw-health-probe.ts`, `session-gateway-inflight.ts`, `callback-to-response.ts`, and their `__tests__/` counterparts.

- [ ] **Step 1: Delete the entire gateway directory**

```bash
rm -rf apps/api/src/gateway
```

- [ ] **Step 2: Verify deletion**

```bash
ls apps/api/src/gateway 2>&1
```

Expected: "No such file or directory"

- [ ] **Step 3: Do NOT run tests yet — downstream files still import from gateway. Continue to Task 3.**

---

### Task 3: Delete Gateway-Adjacent Files

**Files:**

- Delete: `apps/api/src/sessions/cancel-session-gateway.ts`
- Delete: `apps/api/src/sessions/__tests__/cancel-session-gateway.test.ts`
- Delete: `apps/api/src/bootstrap/compile-role-checkpoint-validator.ts`
- Delete: `apps/api/src/bootstrap/role-manifests.ts`
- Delete: `apps/api/src/test-utils/session-test-stores.ts`
- Delete: `apps/api/src/jobs/__tests__/session-invocation.test.ts`

- [ ] **Step 1: Delete gateway-adjacent API files**

```bash
rm -f apps/api/src/sessions/cancel-session-gateway.ts
rm -f apps/api/src/sessions/__tests__/cancel-session-gateway.test.ts
rm -f apps/api/src/bootstrap/compile-role-checkpoint-validator.ts
rm -f apps/api/src/bootstrap/role-manifests.ts
rm -f apps/api/src/test-utils/session-test-stores.ts
rm -f apps/api/src/jobs/__tests__/session-invocation.test.ts
```

- [ ] **Step 2: Check if `apps/api/src/sessions/` directory is now empty (except `__tests__/` which may be empty too). If so, remove the directory.**

```bash
ls apps/api/src/sessions/
```

If empty or only empty `__tests__/`, delete it:

```bash
rm -rf apps/api/src/sessions
```

- [ ] **Step 3: Do NOT run tests yet — continue to Task 4.**

---

### Task 4: Delete Core Gateway Outcome Files

**Files:**

- Delete: `packages/core/src/sessions/apply-gateway-outcome.ts`
- Delete: `packages/core/src/sessions/__tests__/apply-gateway-outcome.test.ts`
- Delete: `packages/core/src/sessions/bullmq-attempts.ts`
- Delete: `packages/core/src/sessions/__tests__/bullmq-attempts.test.ts`

- [ ] **Step 1: Delete core gateway files**

```bash
rm -f packages/core/src/sessions/apply-gateway-outcome.ts
rm -f packages/core/src/sessions/__tests__/apply-gateway-outcome.test.ts
rm -f packages/core/src/sessions/bullmq-attempts.ts
rm -f packages/core/src/sessions/__tests__/bullmq-attempts.test.ts
```

- [ ] **Step 2: Update the barrel export in `packages/core/src/sessions/index.ts`**

Remove these two lines:

```typescript
// REMOVE these lines:
export { applyGatewayOutcomeToSession } from "./apply-gateway-outcome.js";
export type { GatewayOutcomeLogger } from "./apply-gateway-outcome.js";
export { isFinalBullMqJobAttempt } from "./bullmq-attempts.js";
```

The remaining exports (SessionManager, state machine, checkpoint validator, store interfaces, role config merger, resume payload builder) stay — they'll be redesigned in Phase 3.

- [ ] **Step 3: Do NOT run tests yet — continue to Task 5.**

---

### Task 5: Delete DB Gateway Outcome Files

**Files:**

- Delete: `packages/db/src/sessions/apply-gateway-outcome-locked.ts`
- Delete: `packages/db/src/sessions/__tests__/apply-gateway-outcome-locked.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Delete DB gateway files**

```bash
rm -f packages/db/src/sessions/apply-gateway-outcome-locked.ts
rm -f packages/db/src/sessions/__tests__/apply-gateway-outcome-locked.test.ts
```

- [ ] **Step 2: Check if `packages/db/src/sessions/` is now empty. If so, remove it.**

```bash
ls packages/db/src/sessions/
```

If empty or only empty `__tests__/`:

```bash
rm -rf packages/db/src/sessions
```

- [ ] **Step 3: Update `packages/db/src/index.ts` — remove gateway exports**

Remove these lines from the barrel export:

```typescript
// REMOVE these lines:
export {
  applyGatewayOutcomeForRunWithAdvisoryLock,
  advisoryLockInt32Pair,
  createSessionManagerForPrismaClient,
  isTerminalSessionStatusForGatewayCallback,
  RunCallbackRunNotFoundError,
  RunCallbackSessionMismatchError,
  RunCallbackSessionNotFoundError,
} from "./sessions/apply-gateway-outcome-locked.js";
export type { ApplyGatewayOutcomeForRunParams } from "./sessions/apply-gateway-outcome-locked.js";
```

Keep all other exports unchanged.

- [ ] **Step 4: Do NOT run tests yet — continue to Task 6.**

---

### Task 6: Remove Gateway Schemas

**Files:**

- Modify: `packages/schemas/src/session.ts`

- [ ] **Step 1: Read the current file**

Read `packages/schemas/src/session.ts` to identify the exact line ranges for gateway types.

- [ ] **Step 2: Remove gateway-specific schemas**

Remove all schemas/types from line ~200 onward that are gateway-specific. These include:

- `GatewayInvokeRequestSharedSchema`
- `GatewayInitialInvokeRequestSchema` / `GatewayInitialInvokeRequest`
- `GatewayResumeInvokeRequestSchema` / `GatewayResumeInvokeRequest`
- `GatewayInvokeRequestSchema` / `GatewayInvokeRequest`
- `GatewayToolCallInputSchema` / `GatewayToolCallInput`
- `GatewayCorrelationMetaSchema` / `GatewayCorrelationMeta`
- `GatewayInvokeResponseSchema` / `GatewayInvokeResponse`
- `GatewayHealthResponseSchema` / `GatewayHealthResponse`
- `SessionRunCallbackBodySchema` / `SessionRunCallbackBody`
- `sessionCallbackBodyToGatewayResponse` (if it's here vs callback-to-response.ts)

Keep everything above the gateway section: `SessionStatus`, `RunTriggerType`, `RunOutcome`, `ResumeStatus`, `SafetyEnvelope`, `AgentCheckpoint`, `ToolEvent`, `AgentSession`, `AgentRun`, `AgentPause`, `ResumePayload`, `CreateSessionRequest`.

- [ ] **Step 3: Remove `gatewayIdempotencyKey` from `ToolEventSchema`**

In the `ToolEventSchema` definition, remove the line:

```typescript
gatewayIdempotencyKey: z.string().min(1).optional(),
```

This field was gateway-specific. The Phase 3 workflow redesign will add its own idempotency approach.

- [ ] **Step 4: Check for a schemas barrel file (`packages/schemas/src/index.ts`) that re-exports gateway types and clean it up.**

- [ ] **Step 5: Do NOT run tests yet — continue to Task 7.**

---

### Task 7: Clean Up `session-invocation.ts`

**Files:**

- Modify: `apps/api/src/jobs/session-invocation.ts`

This file was the BullMQ worker that called the OpenClaw gateway. The `createSessionInvocationQueue` and `createSessionInvocationWorker` are referenced from `app.ts`.

- [ ] **Step 1: Read the current file**

Read `apps/api/src/jobs/session-invocation.ts`.

- [ ] **Step 2: Gut the file — keep queue definition, remove worker**

The file should become a minimal stub that only exports the queue type (still referenced from `app.ts` for now). Replace the full file with:

```typescript
import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";

export interface SessionInvocationJobData {
  sessionId: string;
  runId: string;
  resumeToken: string;
  attempt: number;
}

export const SESSION_INVOCATION_QUEUE = "session-invocation";

export function createSessionInvocationQueue(connection: ConnectionOptions): Queue {
  return new Queue<SessionInvocationJobData>(SESSION_INVOCATION_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 500 },
      removeOnFail: false,
    },
  });
}

// Gateway invocation worker removed — will be replaced by WorkflowEngine in Phase 3.
// Queue kept for session creation route compatibility.
```

Remove all imports of gateway types, `SessionManager`, `buildResumePayload`, `issueSessionToken`, `LoadedManifest`, `GatewayInvokeRequest`, `GatewayInvokeResponse`, etc.

Also remove the `ApplyGatewayOutcomeForRunFn` type export if it was defined here.

- [ ] **Step 3: Do NOT run tests yet — continue to Task 8.**

---

### Task 8: Clean Up `app.ts`

**Files:**

- Modify: `apps/api/src/app.ts`

This is the largest change. The file is ~681 lines and has ~80 lines of gateway-specific wiring.

- [ ] **Step 1: Read the full file**

Read `apps/api/src/app.ts` to understand the full context around gateway code.

- [ ] **Step 2: Remove gateway-related Fastify decorations from the type declaration**

In the `declare module "fastify"` block, remove:

```typescript
// REMOVE:
applyGatewayOutcomeForRun:
  | import("./jobs/session-invocation.js").ApplyGatewayOutcomeForRunFn
  | null;
sessionInvocationQueue: import("bullmq").Queue | null;
roleManifests: Map<string, import("./bootstrap/role-manifests.js").LoadedManifest>;
cancelSessionWithGateway: ((sessionId: string) => Promise<void>) | null;
```

Keep `sessionManager` — it's reusable.

- [ ] **Step 3: Remove gateway initialization block from `buildServer()`**

Find the block that starts around line 307 with `const roleManifests = new Map<...>()` and runs through the gateway client setup, session invocation worker creation, health probe start, and decoration (through ~line 461). Remove the entire block.

Specifically remove:

- `roleManifests` map creation and population
- `applyGatewayOutcomeForRun` variable and assignment
- `sessionInvocationQueue`, `sessionInvocationWorker`, `cancelSessionWithGateway`, `stopOpenClawGatewayHealthProbe` variables
- `gatewayUrl` env var read
- The entire `if (sessionManager && ... && gatewayUrl && ...)` block that imports and wires `HttpGatewayClient`, `ResilientGatewayClient`, `GatewayCircuitBreaker`, `SessionGatewayInflightRegistry`, `startOpenClawGatewayHealthProbes`, `cancelSessionWithGatewayPropagation`
- The `app.decorate` calls for `applyGatewayOutcomeForRun`, `roleManifests`, `sessionInvocationQueue`, `cancelSessionWithGateway`

- [ ] **Step 4: Remove gateway shutdown from the close handler**

Find the shutdown block (around line 576) and remove:

```typescript
// REMOVE:
if (stopOpenClawGatewayHealthProbe) {
  stopOpenClawGatewayHealthProbe();
  stopOpenClawGatewayHealthProbe = null;
}
if (sessionInvocationWorker) {
  await sessionInvocationWorker.close();
}
if (sessionInvocationQueue) {
  await sessionInvocationQueue.close();
}
```

- [ ] **Step 5: Remove any remaining gateway imports at the top of the file**

Check for imports from deleted modules and remove them:

- `./gateway/*`
- `./sessions/cancel-session-gateway.js`
- `./bootstrap/role-manifests.js`
- `./bootstrap/compile-role-checkpoint-validator.js`

- [ ] **Step 6: Do NOT run tests yet — continue to Task 9.**

---

### Task 9: Clean Up Session Routes

**Files:**

- Modify: `apps/api/src/routes/sessions.ts`

- [ ] **Step 1: Read the current file**

Read `apps/api/src/routes/sessions.ts`.

- [ ] **Step 2: Remove the gateway callback route**

Remove the entire `POST /:sessionId/runs/:runId/callback` route handler. This was the endpoint OpenClaw called to report outcomes.

Also remove these imports that are now unused:

- `SessionRunCallbackBodySchema` from `@switchboard/schemas`
- `requireSessionToken`, `getSessionTokenClaims` from `../auth/require-session-token.js`
- `RunCallbackRunNotFoundError`, `RunCallbackSessionMismatchError`, `RunCallbackSessionNotFoundError` from `@switchboard/db`
- `sessionCallbackBodyToGatewayResponse` from `../gateway/callback-to-response.js`

- [ ] **Step 3: Simplify the cancel route**

In the `POST /:id/cancel` handler, replace the gateway-aware cancel with direct SessionManager cancel:

```typescript
// Replace this:
if (app.cancelSessionWithGateway) {
  await app.cancelSessionWithGateway(id);
} else {
  await app.sessionManager.cancelSession(id);
}

// With this:
await app.sessionManager.cancelSession(id);
```

- [ ] **Step 4: Remove the `sessionInvocationQueue.add` call from the create route**

In the `POST /` handler, remove:

```typescript
// REMOVE:
if (app.sessionInvocationQueue) {
  await app.sessionInvocationQueue.add("invoke", {
    sessionId: session.id,
    runId: run.id,
    resumeToken: "",
    attempt: 0,
  });
}
```

Sessions will be created but not automatically dispatched to a gateway. Phase 3 will add WorkflowEngine dispatch.

- [ ] **Step 5: Do NOT run tests yet — continue to Task 10.**

---

### Task 10: Delete Documentation and Dev Tooling

**Files:**

- Delete: `docs/full-capability-spec.md`
- Delete: `docs/openclaw-gateway-contract.md`
- Delete: `docs/superpowers/specs/2026-03-21-openclaw-session-runtime-design.md`
- Delete: `.claude/skills/` (entire directory committed in PR 156)
- Delete: `.claude/commands/` (committed in PR 156)
- Delete: `.claude/hooks/` (committed in PR 156)

- [ ] **Step 1: Delete OpenClaw-era docs**

```bash
rm -f docs/full-capability-spec.md
rm -f docs/openclaw-gateway-contract.md
rm -f docs/superpowers/specs/2026-03-21-openclaw-session-runtime-design.md
```

- [ ] **Step 2: Delete committed dev tooling**

```bash
rm -rf .claude/skills
rm -rf .claude/commands
rm -rf .claude/hooks
```

**Important:** Do NOT delete `.claude/settings.local.json` — that is actual project config.

- [ ] **Step 3: Do NOT run tests yet — continue to Task 11.**

---

### Task 11: Clean Up Environment Variables

**Files:**

- Modify: `.env.example`

- [ ] **Step 1: Read `.env.example`**

- [ ] **Step 2: Remove OpenClaw-specific env vars**

Remove these lines:

```
# OpenClaw session gateway (apps/api worker). Requires REDIS_URL + SESSION_TOKEN_SECRET + DATABASE_URL.
OPENCLAW_GATEWAY_URL=
OPENCLAW_GATEWAY_FETCH_TIMEOUT_MS=120000
OPENCLAW_GATEWAY_MAX_RETRIES=2
OPENCLAW_GATEWAY_RETRY_DELAY_MS=500
OPENCLAW_GATEWAY_BREAKER_FAILURE_THRESHOLD=5
OPENCLAW_GATEWAY_BREAKER_COOLDOWN_MS=30000
# Periodic GET /health on the gateway client (0 disables) — feeds circuit recovery in-process
OPENCLAW_GATEWAY_HEALTH_PROBE_INTERVAL_MS=30000
```

Keep `SESSION_TOKEN_SECRET=` — it will be reused for workflow-scoped auth in Phase 3.

---

### Task 12: Clean Up Prisma Schema

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Read the Prisma schema section for session models**

Read `packages/db/prisma/schema.prisma` and find the `AgentSession`, `ToolEvent` models.

- [ ] **Step 2: Remove gateway-specific columns from `AgentSession`**

Remove these fields that were added in PR 156 specifically for the gateway:

```prisma
// REMOVE from AgentSession:
allowedToolPack   String[]  @default([])
governanceProfile String    @default("")
errorMessage      String?
errorCode         String?
```

Keep all other fields (`id`, `organizationId`, `roleId`, `principalId`, `status`, `safetyEnvelope`, `toolCallCount`, `mutationCount`, `dollarsAtRisk`, `currentStep`, `toolHistory`, `checkpoint`, `traceId`, `startedAt`, `completedAt`, relations). These will be redesigned in Phase 3 but removing them now would break existing tests.

- [ ] **Step 3: Remove gateway idempotency from `ToolEvent`**

Remove this field:

```prisma
// REMOVE from ToolEvent:
gatewayIdempotencyKey String?
```

And remove this unique constraint:

```prisma
// REMOVE:
@@unique([sessionId, gatewayIdempotencyKey])
```

- [ ] **Step 4: Create a migration for the schema changes**

```bash
cd packages/db && npx prisma migrate dev --name remove_openclaw_gateway_fields
```

- [ ] **Step 5: Generate Prisma client**

```bash
pnpm db:generate
```

---

### Task 13: Update SessionManager and Store Types

**Files:**

- Modify: `packages/core/src/sessions/session-manager.ts`
- Modify: `packages/core/src/sessions/store-interfaces.ts`
- Modify: `packages/core/src/sessions/__tests__/session-manager.test.ts`
- Modify: `packages/core/src/sessions/__tests__/test-stores.ts`

The SessionManager was modified in PR 156 to add gateway-specific features. Revert those additions while keeping the core pause/resume logic.

- [ ] **Step 1: Read the current SessionManager**

Read `packages/core/src/sessions/session-manager.ts`.

- [ ] **Step 2: Remove gateway-specific additions**

In `SessionManager`:

- Remove `allowedToolPack` validation in `recordToolCall` (if the tool-pack check was added)
- Remove `errorCode` parameter from `failSession` (revert to just `error?: string`)
- Remove `gatewayIdempotencyKey` from `RecordToolCallInput` type
- Remove `listRunsForSession` if it was added only for `cancel-session-gateway.ts`
- Remove `getRoleCheckpointValidator` from `SessionManagerDeps` if it was added for gateway
- Remove `maxConcurrentSessionsForRole` from `CreateSessionInput` if gateway-specific

Check each field against the pre-PR-156 state. If unsure, err on the side of keeping it — Phase 3 will redesign everything.

- [ ] **Step 3: Update `store-interfaces.ts`**

Remove any gateway-specific store methods that were added (e.g., idempotency key lookups on ToolEventStore).

- [ ] **Step 4: Update test stores and session manager tests**

In `test-stores.ts`, remove mock implementations for deleted store methods.
In `session-manager.test.ts`, remove tests for gateway-specific features (allowedToolPack validation, errorCode, idempotency). Keep all core tests (create, pause, resume, complete, fail, cancel, safety envelope).

- [ ] **Step 5: Run tests for core package**

```bash
pnpm --filter @switchboard/core test
```

Expected: all pass.

---

### Task 14: Update Prisma Store Implementations

**Files:**

- Modify: `packages/db/src/storage/prisma-session-store.ts`
- Modify: `packages/db/src/storage/prisma-tool-event-store.ts`
- Possibly modify: `packages/db/src/storage/prisma-run-store.ts`

- [ ] **Step 1: Read the Prisma store files**

Check each for references to removed fields (`allowedToolPack`, `governanceProfile`, `errorMessage`, `errorCode`, `gatewayIdempotencyKey`).

- [ ] **Step 2: Remove gateway field mappings**

In `PrismaSessionStore`: remove `allowedToolPack`, `governanceProfile`, `errorMessage`, `errorCode` from create/update/read mappings.

In `PrismaToolEventStore`: remove `gatewayIdempotencyKey` from create/read mappings. Remove any idempotency-key-based lookup methods.

- [ ] **Step 3: Run DB package tests**

```bash
pnpm --filter @switchboard/db test
```

Expected: all pass (or some gateway-specific tests already deleted in Task 5).

---

### Task 15: Update API Package.json (if needed)

**Files:**

- Modify: `apps/api/package.json`

- [ ] **Step 1: Read the file**

Check if PR 156 added any gateway-specific dependencies.

- [ ] **Step 2: Remove unused dependencies**

If any packages were added solely for gateway (unlikely — it mostly used built-in `fetch`), remove them.

---

### Task 16: Full Test Suite + Type Check

**Files:** None — verification only

- [ ] **Step 1: Run type checking**

```bash
pnpm typecheck --force
```

The `--force` flag bypasses Turborepo cache to catch real errors. Expected: all pass.

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: all pass. If any tests fail, they reference deleted gateway code — fix by removing the test or updating the import.

- [ ] **Step 3: Run linting**

```bash
pnpm lint
```

Expected: all pass.

- [ ] **Step 4: Run format check**

```bash
pnpm format:check
```

Expected: all pass.

---

### Task 17: Commit

- [ ] **Step 1: Stage all changes**

```bash
git add -A
```

Review staged files to ensure no accidental deletions of non-gateway code:

```bash
git diff --cached --stat
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: remove OpenClaw gateway integration

Delete all external gateway code (HTTP client, circuit breaker, protocol,
health probes, outcome persistence, cancel propagation). Preserve session
core (state machine, SessionManager, Prisma models) for Phase 3 workflow
engine redesign. Clean up schemas, env vars, and dev tooling committed
in PR 156.

BREAKING CHANGE: POST /api/sessions/:id/runs/:id/callback removed.
Session creation no longer dispatches to external gateway.
EOF
)"
```

- [ ] **Step 3: Verify clean state**

```bash
git status
pnpm typecheck --force && pnpm test && pnpm lint
```

Expected: clean working tree, all checks pass.
