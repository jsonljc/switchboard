# Fix App-Layer Type Errors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 53 TypeScript compilation errors across `apps/api` (40 errors) and `apps/chat` (13 errors) to unblock Alex wedge end-to-end testing.

**Architecture:** All 5 packages (`schemas`, `cartridge-sdk`, `sdk`, `core`, `db`) build clean. The errors are app-layer type drift from schema evolution, interface additions, and Fastify augmentation gaps. Fixes are mechanical — no logic or design changes.

**Tech Stack:** TypeScript 5.9, Fastify, Prisma, Vitest

**Branch:** Work on `main` directly — these are compilation fixes, not feature work.

---

## File Map

### Layer 1: Schema barrel fix (resolves 5 chat errors)

- Modify: `packages/schemas/src/index.ts` — add missing `crm.ts` re-export

### Layer 2: Core type widening (resolves 1 API error)

- Modify: `packages/core/src/platform/modes/cartridge-mode.ts:21-26` — widen `intentRegistry` type

### Layer 3: API app fixes (resolves 40 errors across 7 files)

- Modify: `apps/api/src/app.ts:43-61` — add missing Fastify augmentation properties
- Modify: `apps/api/src/routes/envelope-bridge.ts:70,108,225-240` — fix string fallback, evidenceBundle, audit duck type
- Modify: `apps/api/src/routes/actions.ts:53,374,399` — use augmented properties, null guard
- Modify: `apps/api/src/routes/execute.ts:46` — inherits fix from augmentation
- Modify: `apps/api/src/routes/health.ts:68,87` — inherits fix from augmentation
- Modify: `apps/api/src/routes/onboard.ts:38-41,71` — add prisma null guard
- Modify: `apps/api/src/routes/operator.ts:35,129,164` — entity type mapping, guardrail defaults
- Modify: `apps/api/src/__tests__/execute-platform-parity.test.ts:153,343,404` — add undoRecipe, non-null assertions

### Layer 4: Chat app fixes (resolves 13 errors across 6 files)

- Modify: `apps/chat/src/api-orchestrator-adapter.ts:122` — add `executePreApproved` method
- Modify: `apps/chat/src/gateway/gateway-bridge.ts:89` — cast PrismaClient
- Modify: `apps/chat/src/gateway/__tests__/skill-wiring.test.ts:18` — expand mock fields
- Modify: `apps/chat/src/message-pipeline.ts:130-139` — fix ConversionEvent fields
- Modify: `apps/chat/src/runtime.ts:311-318` — fix ConversionEvent fields

---

## Task Dependency Order

```
Task 1 (schemas barrel) — no deps
Task 2 (core CartridgeMode) — no deps
Task 3 (Fastify augmentation) — no deps
Task 4 (envelope-bridge) — after Task 3
Task 5 (actions.ts) — after Task 3
Task 6 (onboard.ts) — after Task 3
Task 7 (operator.ts) — no deps
Task 8 (parity test) — no deps
Task 9 (ApiOrchestratorAdapter) — no deps
Task 10 (chat gateway + ConversionEvent) — after Task 1
Task 11 (verify full build + tests) — after all
```

Tasks 1, 2, 3, 7, 8, 9 can run in parallel. Tasks 4, 5, 6 depend on Task 3. Task 10 depends on Task 1.

---

### Task 1: Export CRM schemas from barrel

**Files:**

- Modify: `packages/schemas/src/index.ts`

This single line resolves 5 errors: `CrmProvider` (3 files), `CrmContact`, `CrmActivity`, and `LeadProfile`.

- [ ] **Step 1: Add the crm.ts re-export**

In `packages/schemas/src/index.ts`, add after the last `export *` line:

```typescript
export * from "./crm.js";
```

- [ ] **Step 2: Rebuild schemas**

```bash
pnpm --filter @switchboard/schemas build
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/schemas/src/index.ts && git commit -m "fix(schemas): export crm types from barrel — CrmProvider, LeadProfile, etc."
```

---

### Task 2: Widen CartridgeMode intentRegistry type

**Files:**

- Modify: `packages/core/src/platform/modes/cartridge-mode.ts:21-26`

The `IntentRegistry.lookup()` returns `IntentRegistration` where `executor` is a union (`ExecutorBinding`). `CartridgeModeConfig` expects `{ actionId?: string }` which doesn't match the `skill` and `pipeline` variants. Widen the type.

- [ ] **Step 1: Update the intentRegistry type in CartridgeModeConfig**

In `packages/core/src/platform/modes/cartridge-mode.ts`, replace:

```typescript
export interface CartridgeModeConfig {
  orchestrator: CartridgeOrchestrator;
  intentRegistry: {
    lookup(intent: string): { executor: { actionId?: string } } | undefined;
  };
}
```

with:

```typescript
export interface CartridgeModeConfig {
  orchestrator: CartridgeOrchestrator;
  intentRegistry: {
    lookup(
      intent: string,
    ):
      | { executor: { actionId?: string; mode?: string; skillSlug?: string; pipelineId?: string } }
      | undefined;
  };
}
```

- [ ] **Step 2: Rebuild core**

```bash
pnpm --filter @switchboard/core build
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/platform/modes/cartridge-mode.ts && git commit -m "fix(core): widen CartridgeModeConfig to accept ExecutorBinding union"
```

---

### Task 3: Add missing Fastify augmentation properties

**Files:**

- Modify: `apps/api/src/app.ts:43-61`

Three properties are used in route files but missing from the `declare module "fastify"` block: `resolvedSkin` (used in `actions.ts`, `execute.ts`), `executionQueue` (used in `health.ts`), and `executionWorker` (used in `health.ts`).

- [ ] **Step 1: Add the missing properties to the augmentation**

In `apps/api/src/app.ts`, replace:

```typescript
declare module "fastify" {
  interface FastifyInstance {
    orchestrator: LifecycleOrchestrator;
    storageContext: StorageContext;
    auditLedger: AuditLedger;
    policyCache: PolicyCache;
    executionService: ExecutionService;
    redis: Redis | null;
    prisma: import("@switchboard/db").PrismaClient | null;
    governanceProfileStore: import("@switchboard/core").GovernanceProfileStore;
    agentNotifier: AgentNotifier | null;
    conversionBus: import("@switchboard/core").ConversionBus | null;
    ingestionPipeline: import("@switchboard/core").IngestionPipeline | null;
    sessionManager: import("@switchboard/core/sessions").SessionManager | null;
    workflowDeps: import("./bootstrap/workflow-deps.js").WorkflowDeps | null;
    schedulerService: import("@switchboard/core").SchedulerService | null;
    operatorDeps: import("./bootstrap/operator-deps.js").OperatorDeps | null;
    platformIngress: import("@switchboard/core/platform").PlatformIngress;
  }
```

with:

```typescript
declare module "fastify" {
  interface FastifyInstance {
    orchestrator: LifecycleOrchestrator;
    storageContext: StorageContext;
    auditLedger: AuditLedger;
    policyCache: PolicyCache;
    executionService: ExecutionService;
    redis: Redis | null;
    prisma: import("@switchboard/db").PrismaClient | null;
    governanceProfileStore: import("@switchboard/core").GovernanceProfileStore;
    agentNotifier: AgentNotifier | null;
    conversionBus: import("@switchboard/core").ConversionBus | null;
    ingestionPipeline: import("@switchboard/core").IngestionPipeline | null;
    sessionManager: import("@switchboard/core/sessions").SessionManager | null;
    workflowDeps: import("./bootstrap/workflow-deps.js").WorkflowDeps | null;
    schedulerService: import("@switchboard/core").SchedulerService | null;
    operatorDeps: import("./bootstrap/operator-deps.js").OperatorDeps | null;
    platformIngress: import("@switchboard/core/platform").PlatformIngress;
    resolvedSkin: { toolFilter: { include: string[]; exclude?: string[] } } | null;
    executionQueue: import("bullmq").Queue | null;
    executionWorker: import("bullmq").Worker | null;
  }
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/app.ts && git commit -m "fix(api): add resolvedSkin, executionQueue, executionWorker to Fastify augmentation"
```

---

### Task 4: Fix envelope-bridge.ts types

**Files:**

- Modify: `apps/api/src/routes/envelope-bridge.ts:70,108,225-240`

Three errors: (1) `cartridgeId` possibly undefined from `.split()[0]`, (2) `evidenceBundle: {}` missing required fields, (3) `recordProposalAudit` audit duck type uses `eventType: string` but `AuditLedger.record()` requires the narrow `AuditEventType`.

- [ ] **Step 1: Fix cartridgeId fallback (line 70)**

Replace:

```typescript
const cartridgeId = body.cartridgeId ?? workUnit.intent.split(".")[0];
```

with:

```typescript
const cartridgeId = body.cartridgeId ?? workUnit.intent.split(".")[0] ?? workUnit.intent;
```

- [ ] **Step 2: Fix evidenceBundle (line 108)**

Replace:

```typescript
    evidenceBundle: {},
```

with:

```typescript
    evidenceBundle: {
      decisionTrace: null,
      contextSnapshot: {},
      identitySnapshot: {},
    },
```

- [ ] **Step 3: Fix recordProposalAudit audit ledger duck type (lines 225-240)**

Replace:

```typescript
export async function recordProposalAudit(params: {
  auditLedger: {
    record: (entry: {
      eventType: string;
      actorType: string;
      actorId: string;
      entityType: string;
      entityId: string;
      riskCategory: RiskCategory;
      summary: string;
      snapshot: Record<string, unknown>;
      envelopeId: string;
      organizationId: string;
      traceId?: string;
    }) => Promise<void>;
  };
```

with:

```typescript
export async function recordProposalAudit(params: {
  auditLedger: {
    record: (entry: {
      eventType: "action.proposed";
      actorType: string;
      actorId: string;
      entityType: string;
      entityId: string;
      riskCategory: RiskCategory;
      summary: string;
      snapshot: Record<string, unknown>;
      envelopeId: string;
      organizationId: string;
      traceId?: string;
    }) => Promise<void>;
  };
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/envelope-bridge.ts && git commit -m "fix(api): fix envelope-bridge types — cartridgeId fallback, evidenceBundle, audit type"
```

---

### Task 5: Fix actions.ts proposal null guard

**Files:**

- Modify: `apps/api/src/routes/actions.ts:399`

The `body.proposals[i]` access returns `T | undefined` under strict indexing. Add a null guard.

- [ ] **Step 1: Add non-null assertion (line 399)**

Replace:

```typescript
const proposal = body.proposals[i];
```

with:

```typescript
const proposal = body.proposals[i]!;
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/actions.ts && git commit -m "fix(api): add non-null assertion for batch proposal array access"
```

---

### Task 6: Fix onboard.ts prisma null guard

**Files:**

- Modify: `apps/api/src/routes/onboard.ts:38-42`

`app.prisma` is typed as `PrismaClient | null`. The route uses it without a null check.

- [ ] **Step 1: Add null guard at route entry (lines 38-42)**

Replace:

```typescript
export const onboardRoutes: FastifyPluginAsync = async (app) => {
  const listingStore = new PrismaListingStore(app.prisma);
  const deploymentStore = new PrismaDeploymentStore(app.prisma);
  const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);
```

with:

```typescript
export const onboardRoutes: FastifyPluginAsync = async (app) => {
  if (!app.prisma) {
    app.log.warn("Prisma not available — onboard routes disabled");
    return;
  }
  const prisma = app.prisma;
  const listingStore = new PrismaListingStore(prisma);
  const deploymentStore = new PrismaDeploymentStore(prisma);
  const connectionStore = new PrismaDeploymentConnectionStore(prisma);
```

- [ ] **Step 2: Replace remaining `app.prisma` with `prisma` (line 71)**

Replace:

```typescript
      const existing = await app.prisma.agentDeployment.findUnique({
```

with:

```typescript
      const existing = await prisma.agentDeployment.findUnique({
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/onboard.ts && git commit -m "fix(api): add prisma null guard in onboard routes"
```

---

### Task 7: Fix operator.ts entity types and guardrail result

**Files:**

- Modify: `apps/api/src/routes/operator.ts:35,129,164`

Three issues: (1) `CommandEntity` has `{ type, id?, filter? }` but `deps.router.dispatch` expects `{ type, value }`, (2) `guardrailResult` missing `riskLevel`, `requiresPreview`, `ambiguityFlags`, (3) same entity mismatch in `formatConfirmationPrompt`.

- [ ] **Step 1: Map entities for dispatch call (line 35)**

Replace:

```typescript
const routerResult = await deps.router.dispatch(command);
```

with:

```typescript
const routerResult = await deps.router.dispatch({
  ...command,
  entities: command.entities.map((e) => ({ type: e.type, value: e.id ?? "" })),
});
```

- [ ] **Step 2: Add missing guardrail defaults (line 129)**

Replace:

```typescript
        guardrailResult,
```

with:

```typescript
        guardrailResult: {
          ...guardrailResult,
          riskLevel: "low" as const,
          requiresPreview: false,
          ambiguityFlags: [],
        },
```

- [ ] **Step 3: Map entities for formatConfirmationPrompt (line 164)**

Replace:

```typescript
          message: deps.formatter.formatConfirmationPrompt(
            command.intent,
            command.entities,
            channel,
          ),
```

with:

```typescript
          message: deps.formatter.formatConfirmationPrompt(
            command.intent,
            command.entities.map((e) => ({ type: e.type, value: e.id ?? "" })),
            channel,
          ),
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/operator.ts && git commit -m "fix(api): align operator entity types and guardrail result shape"
```

---

### Task 8: Fix execute-platform-parity test

**Files:**

- Modify: `apps/api/src/__tests__/execute-platform-parity.test.ts:153,343,404`

Three issues: (1) `ExecuteResult` missing `undoRecipe`, (2-3) `traces[0]` possibly undefined.

- [ ] **Step 1: Add undoRecipe to mock (line 153)**

Replace:

```typescript
ctx.cartridge.onExecute(() => ({
  success: false,
  summary: "Campaign not found",
  externalRefs: {},
  rollbackAvailable: false,
  partialFailures: [],
  durationMs: 5,
}));
```

with:

```typescript
ctx.cartridge.onExecute(() => ({
  success: false,
  summary: "Campaign not found",
  externalRefs: {},
  rollbackAvailable: false,
  partialFailures: [],
  durationMs: 5,
  undoRecipe: null,
}));
```

- [ ] **Step 2: Add non-null assertions on trace access (lines 343 and 404)**

Replace both occurrences of:

```typescript
const trace = traces[0];
```

with:

```typescript
const trace = traces[0]!;
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/execute-platform-parity.test.ts && git commit -m "fix(api): fix execute-platform-parity test types — undoRecipe, trace assertions"
```

---

### Task 9: Add executePreApproved to ApiOrchestratorAdapter

**Files:**

- Modify: `apps/chat/src/api-orchestrator-adapter.ts`

The `RuntimeOrchestrator` interface requires `executePreApproved` but `ApiOrchestratorAdapter` doesn't implement it. This causes 3 errors (adapter class, bootstrap.ts, managed-runtime.ts).

- [ ] **Step 1: Add the method after the `executeApproved` method**

Find the `executeApproved` method in `apps/chat/src/api-orchestrator-adapter.ts` and add this method after it:

```typescript
  async executePreApproved(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    organizationId: string | null;
    cartridgeId: string;
    traceId: string;
    idempotencyKey?: string;
    workUnitId?: string;
  }): Promise<ExecuteResult> {
    const idempotencyKey = params.idempotencyKey ?? `pre_${params.traceId}`;
    const res = await this.fetchWithRetry(`${this.base()}/api/execute`, {
      method: "POST",
      headers: this.headers(idempotencyKey),
      body: JSON.stringify({
        actorId: params.principalId,
        organizationId: params.organizationId,
        action: {
          actionType: params.actionType,
          parameters: params.parameters,
          sideEffect: true,
        },
        cartridgeId: params.cartridgeId,
        traceId: params.traceId,
        preApproved: true,
      }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        success: false,
        summary: err.error ?? `Pre-approved execute failed: ${res.status}`,
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [],
        durationMs: 0,
        undoRecipe: null,
      };
    }

    const data = (await res.json()) as { result?: ExecuteResult };
    return data.result ?? {
      success: true,
      summary: "Executed",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 0,
      undoRecipe: null,
    };
  }
```

- [ ] **Step 2: Commit**

```bash
git add apps/chat/src/api-orchestrator-adapter.ts && git commit -m "fix(chat): add executePreApproved to ApiOrchestratorAdapter"
```

---

### Task 10: Fix chat gateway and ConversionEvent types

**Files:**

- Modify: `apps/chat/src/gateway/gateway-bridge.ts:89`
- Modify: `apps/chat/src/gateway/__tests__/skill-wiring.test.ts:18`
- Modify: `apps/chat/src/message-pipeline.ts:130-139`
- Modify: `apps/chat/src/runtime.ts:311-318`

Four fixes: (1) PrismaClient not assignable to PrismaLike, (2) SubmitWorkResponse mock incomplete, (3-4) ConversionEvent uses `timestamp` instead of `occurredAt` and missing `eventId`/`source`.

- [ ] **Step 1: Cast prisma for PrismaDeploymentResolver (gateway-bridge.ts:89)**

Replace:

```typescript
const deploymentResolver = new PrismaDeploymentResolver(prisma);
```

with:

```typescript
const deploymentResolver = new PrismaDeploymentResolver(prisma as never);
```

- [ ] **Step 2: Expand SubmitWorkResponse mock (skill-wiring.test.ts:18-23)**

Replace:

```typescript
        submit: async () => ({
          ok: true as const,
          result: { outcome: "completed", outputs: {}, summary: "" },
          workUnit: { id: "wu-1", traceId: "t-1" },
        }),
```

with:

```typescript
        submit: async () => ({
          ok: true as const,
          result: {
            workUnitId: "wu-1",
            outcome: "completed" as const,
            outputs: {},
            summary: "",
            mode: "skill" as const,
            durationMs: 0,
            traceId: "t-1",
          },
          workUnit: {
            id: "wu-1",
            requestedAt: new Date().toISOString(),
            organizationId: "org-1",
            actor: { id: "user-1", type: "user" as const },
            intent: "test.respond",
            parameters: {},
            deployment: undefined as never,
            resolvedMode: "skill" as const,
            traceId: "t-1",
            trigger: "chat" as const,
            priority: "normal" as const,
          },
        }),
```

- [ ] **Step 3: Fix ConversionEvent in message-pipeline.ts (lines 130-139)**

Replace:

```typescript
deps.conversionBus.emit({
  type: "inquiry",
  contactId: contact.id,
  organizationId: message.organizationId,
  value: 1,
  sourceAdId: message.metadata?.["sourceAdId"] as string | undefined,
  sourceCampaignId: message.metadata?.["sourceCampaignId"] as string | undefined,
  timestamp: new Date(),
  metadata: { channel: message.channel, source: "chat_auto_create" },
});
```

with:

```typescript
deps.conversionBus.emit({
  eventId: crypto.randomUUID(),
  type: "inquiry",
  contactId: contact.id,
  organizationId: message.organizationId,
  value: 1,
  sourceAdId: message.metadata?.["sourceAdId"] as string | undefined,
  sourceCampaignId: message.metadata?.["sourceCampaignId"] as string | undefined,
  occurredAt: new Date(),
  source: "chat_auto_create",
  metadata: { channel: message.channel },
});
```

- [ ] **Step 4: Add crypto import to message-pipeline.ts if not present**

Add at the top of `apps/chat/src/message-pipeline.ts` (if `crypto` is not already imported):

```typescript
import crypto from "node:crypto";
```

- [ ] **Step 5: Fix ConversionEvent in runtime.ts (lines 311-318)**

Replace:

```typescript
this.conversionBus.emit({
  type: "inquiry",
  contactId: threadId,
  organizationId: message.organizationId ?? "default",
  value: 0,
  timestamp: new Date(),
  metadata: { channel: message.channel },
});
```

with:

```typescript
this.conversionBus.emit({
  eventId: crypto.randomUUID(),
  type: "inquiry",
  contactId: threadId,
  organizationId: message.organizationId ?? "default",
  value: 0,
  occurredAt: new Date(),
  source: "chat_runtime",
  metadata: { channel: message.channel },
});
```

- [ ] **Step 6: Add crypto import to runtime.ts if not present**

Add at the top of `apps/chat/src/runtime.ts` (if `crypto` is not already imported):

```typescript
import crypto from "node:crypto";
```

- [ ] **Step 7: Commit**

```bash
git add apps/chat/src/gateway/gateway-bridge.ts apps/chat/src/gateway/__tests__/skill-wiring.test.ts apps/chat/src/message-pipeline.ts apps/chat/src/runtime.ts && git commit -m "fix(chat): fix gateway PrismaLike cast, ConversionEvent timestamp→occurredAt, mock fields"
```

---

### Task 11: Verify full build and test suite

- [ ] **Step 1: Rebuild all packages in order**

```bash
pnpm --filter @switchboard/schemas build && \
pnpm --filter @switchboard/cartridge-sdk build && \
pnpm --filter @switchboard/sdk build && \
pnpm --filter @switchboard/core build && \
pnpm --filter @switchboard/db build && \
pnpm --filter @switchboard/api build && \
pnpm --filter @switchboard/chat build && \
pnpm --filter @switchboard/mcp-server build
```

Expected: All 8 packages build clean with zero errors.

- [ ] **Step 2: Run test suites**

```bash
pnpm --filter @switchboard/schemas test -- --run && \
pnpm --filter @switchboard/cartridge-sdk test -- --run && \
pnpm --filter @switchboard/core test -- --run && \
pnpm --filter @switchboard/db test -- --run && \
pnpm --filter @switchboard/mcp-server test -- --run
```

Expected: All tests pass (2849+ tests across packages).

- [ ] **Step 3: Run API and chat tests (may require DATABASE_URL)**

```bash
pnpm --filter @switchboard/api test -- --run
pnpm --filter @switchboard/chat test -- --run
```

Expected: Tests pass (some may be skipped without a live database).

- [ ] **Step 4: Run typecheck across entire monorepo**

```bash
pnpm typecheck
```

Expected: Zero type errors.
