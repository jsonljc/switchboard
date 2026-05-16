# `fix/launch-agent-deployment-store-methods` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate direct `prisma.agentDeployment.updateMany` mutations from `governance.ts` (halt + resume) and `billing.ts` (subscription-canceled suspend) by introducing `DeploymentLifecycleStore` as the persistence boundary, with each mutation recorded transactionally as an `operator_mutation` `WorkTrace` row.

**Architecture:** A new core interface in `packages/core/src/platform` + a Prisma impl in `packages/db/src/stores`. Each method runs `findMany` (capture affected ids) + `updateMany` (status flip) + `recordOperatorMutation` (trace insert) inside one `prisma.$transaction`, then finalizes the trace post-tx via `workTraceStore.update`. Routes call `app.deploymentLifecycleStore` and pass an `Actor` resolved by the existing `resolveOperatorActor` helper (governance) or constructed inline as `{ type: "service", id: "stripe-webhook" }` (billing). Re-uses the entire WorkTrace plumbing Risk #1 shipped — no schema migration, no hash version bump.

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turborepo). Prisma + PostgreSQL. Fastify v4. Vitest. Existing `WorkTrace` integrity machinery from PRs #308 + #318.

**Spec:** `docs/superpowers/specs/2026-04-30-fix-launch-agent-deployment-store-methods-design.md` — read before starting.

**Branch / worktree:** Implementation lands on `fix/launch-agent-deployment-store-methods`. Create the worktree off latest `origin/main` only after this spec/plan PR merges:

```bash
cd /Users/jasonli/switchboard
git fetch origin
git worktree add .worktrees/fix-launch-agent-deployment-store-methods \
  -b fix/launch-agent-deployment-store-methods origin/main
```

---

## File map (locked decisions)

**Create**

- `packages/core/src/platform/deployment-lifecycle-store.ts` — `DeploymentLifecycleStore` interface + DTOs.
- `packages/db/src/stores/prisma-deployment-lifecycle-store.ts` — `PrismaDeploymentLifecycleStore` class.
- `packages/db/src/stores/__tests__/prisma-deployment-lifecycle-store.test.ts` — unit tests (mocked Prisma).
- `apps/api/src/__tests__/deployment-lifecycle-store.integration.test.ts` — integration test (skipIf no `DATABASE_URL`).

**Modify**

- `packages/core/src/platform/index.ts` — re-export `DeploymentLifecycleStore` types.
- `packages/db/src/index.ts` — re-export `PrismaDeploymentLifecycleStore`.
- `apps/api/src/app.ts` — augment `FastifyInstance`, construct + decorate `deploymentLifecycleStore`.
- `apps/api/src/routes/governance.ts` — refactor emergency-halt (line 184) and resume (line 318) handlers.
- `apps/api/src/routes/billing.ts` — refactor subscription-canceled branch (line 247).
- `apps/api/src/__tests__/api-governance.test.ts` — add `mockDeploymentLifecycleStore` decoration; assert it's called.
- `apps/api/src/routes/__tests__/billing.test.ts` — add `mockDeploymentLifecycleStore` decoration; assert it's called on `customer.subscription.updated` when `status: "canceled"`.
- `.audit/08-launch-blocker-sequence.md` — mark Risk #2 shipped (final task).

**Read-only references (do NOT modify)**

- `packages/core/src/platform/conversation-state-store.ts` — interface template.
- `packages/db/src/stores/prisma-conversation-state-store.ts` — implementation template (especially the `setOverride` tx + finalize pattern).
- `packages/db/src/stores/prisma-work-trace-store.ts` — `recordOperatorMutation` signature (line 102).
- `apps/api/src/routes/operator-actor.ts` — `resolveOperatorActor(request)` helper.

---

## Conventions followed throughout

- **TDD**: test first, watch it fail, implement, watch it pass, commit. No exceptions.
- **Conventional Commits**. Each task ends in one or more commits with prefixes `feat`, `fix`, `test`, `chore`, `refactor`.
- **ESM only**, `.js` extensions in relative imports for non-Next.js packages.
- **No `any`**, no `console.log`. Unused vars prefixed `_`.
- **No mutating bypass paths**: routes never call `prisma.agentDeployment.updateMany` after this plan completes.
- **Co-located tests**: `*.test.ts` next to the file or under `__tests__/` per existing package convention.
- **File size**: error at 600 lines. Split if any new file would cross 400.

---

## Task 1: Create `DeploymentLifecycleStore` core interface

**Files:**

- Create: `packages/core/src/platform/deployment-lifecycle-store.ts`
- Modify: `packages/core/src/platform/index.ts`

- [ ] **Step 1: Write the failing test** — create `packages/core/src/platform/__tests__/deployment-lifecycle-store.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type {
  DeploymentLifecycleActionKind,
  DeploymentLifecycleStore,
  HaltAllInput,
  ResumeInput,
  SuspendAllInput,
} from "../deployment-lifecycle-store.js";

describe("DeploymentLifecycleStore types", () => {
  it("exports the three action kinds", () => {
    const kinds: DeploymentLifecycleActionKind[] = [
      "agent_deployment.halt",
      "agent_deployment.resume",
      "agent_deployment.suspend",
    ];
    expect(kinds).toHaveLength(3);
  });

  it("HaltAllInput has organizationId, operator, reason", () => {
    const input: HaltAllInput = {
      organizationId: "org_1",
      operator: { type: "user", id: "u_1" },
      reason: null,
    };
    expect(input.organizationId).toBe("org_1");
  });

  it("ResumeInput requires skillSlug", () => {
    const input: ResumeInput = {
      organizationId: "org_1",
      skillSlug: "alex",
      operator: { type: "user", id: "u_1" },
    };
    expect(input.skillSlug).toBe("alex");
  });

  it("SuspendAllInput accepts service actor", () => {
    const input: SuspendAllInput = {
      organizationId: "org_1",
      operator: { type: "service", id: "stripe-webhook" },
      reason: "subscription_canceled",
    };
    expect(input.operator.type).toBe("service");
  });

  it("DeploymentLifecycleStore declares haltAll, resume, suspendAll", () => {
    const store: DeploymentLifecycleStore = {
      haltAll: async () => ({ workTraceId: "t", affectedDeploymentIds: [], count: 0 }),
      resume: async () => ({ workTraceId: "t", affectedDeploymentIds: [], count: 0 }),
      suspendAll: async () => ({ workTraceId: "t", affectedDeploymentIds: [], count: 0 }),
    };
    expect(typeof store.haltAll).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test packages/core/src/platform/__tests__/deployment-lifecycle-store.test.ts`
Expected: FAIL — module `../deployment-lifecycle-store.js` not found.

- [ ] **Step 3: Create the interface file** — `packages/core/src/platform/deployment-lifecycle-store.ts`:

```ts
import type { Actor } from "./types.js";

export type DeploymentLifecycleActionKind =
  | "agent_deployment.halt"
  | "agent_deployment.resume"
  | "agent_deployment.suspend";

export interface HaltAllInput {
  organizationId: string;
  operator: Actor;
  reason: string | null;
}

export interface HaltAllResult {
  workTraceId: string;
  affectedDeploymentIds: string[];
  count: number;
}

export interface ResumeInput {
  organizationId: string;
  skillSlug: string;
  operator: Actor;
}

export interface ResumeResult {
  workTraceId: string;
  affectedDeploymentIds: string[];
  count: number;
}

export interface SuspendAllInput {
  organizationId: string;
  operator: Actor;
  reason: string;
}

export interface SuspendAllResult {
  workTraceId: string;
  affectedDeploymentIds: string[];
  count: number;
}

export interface DeploymentLifecycleStore {
  haltAll(input: HaltAllInput): Promise<HaltAllResult>;
  resume(input: ResumeInput): Promise<ResumeResult>;
  suspendAll(input: SuspendAllInput): Promise<SuspendAllResult>;
}
```

- [ ] **Step 4: Re-export from the platform barrel** — append to `packages/core/src/platform/index.ts` (alongside the existing `ConversationStateStore` re-exports):

```ts
// Deployment Lifecycle Store
export type {
  DeploymentLifecycleStore,
  DeploymentLifecycleActionKind,
  HaltAllInput,
  HaltAllResult,
  ResumeInput,
  ResumeResult,
  SuspendAllInput,
  SuspendAllResult,
} from "./deployment-lifecycle-store.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test packages/core/src/platform/__tests__/deployment-lifecycle-store.test.ts`
Expected: PASS — 5 assertions.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/platform/deployment-lifecycle-store.ts \
  packages/core/src/platform/index.ts \
  packages/core/src/platform/__tests__/deployment-lifecycle-store.test.ts
git commit -m "feat(core): add DeploymentLifecycleStore interface and DTOs"
```

---

## Task 2: Implement `PrismaDeploymentLifecycleStore.haltAll`

**Files:**

- Create: `packages/db/src/stores/prisma-deployment-lifecycle-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-deployment-lifecycle-store.test.ts`

- [ ] **Step 1: Write the failing test** — create `packages/db/src/stores/__tests__/prisma-deployment-lifecycle-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, Prisma } from "@prisma/client";
import { PrismaDeploymentLifecycleStore } from "../prisma-deployment-lifecycle-store.js";
import type { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";

function makePrismaMock(opts: { findMany: unknown[]; updateCount: number }) {
  const tx = {
    agentDeployment: {
      findMany: vi.fn().mockResolvedValue(opts.findMany),
      updateMany: vi.fn().mockResolvedValue({ count: opts.updateCount }),
    },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient,
  };
}

function makeWorkTraceStoreMock() {
  return {
    recordOperatorMutation: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue({ ok: true, trace: {} }),
  } as unknown as PrismaWorkTraceStore;
}

describe("PrismaDeploymentLifecycleStore.haltAll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips active deployments to paused and writes an operator-mutation trace", async () => {
    const { prisma, tx } = makePrismaMock({
      findMany: [{ id: "d1" }, { id: "d2" }],
      updateCount: 2,
    });
    const wts = makeWorkTraceStoreMock();
    const store = new PrismaDeploymentLifecycleStore(prisma, wts);

    const result = await store.haltAll({
      organizationId: "org_1",
      operator: { type: "user", id: "u_1" },
      reason: "Security incident",
    });

    expect(result.count).toBe(2);
    expect(result.affectedDeploymentIds).toEqual(["d1", "d2"]);
    expect(result.workTraceId).toMatch(/^[0-9a-f-]{36}$/);

    expect(tx.agentDeployment.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", status: "active" },
      select: { id: true },
    });
    expect(tx.agentDeployment.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", status: "active" },
      data: { status: "paused" },
    });

    expect(wts.recordOperatorMutation).toHaveBeenCalledTimes(1);
    const [trace, ctx] = (wts.recordOperatorMutation as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(trace.intent).toBe("agent_deployment.halt");
    expect(trace.mode).toBe("operator_mutation");
    expect(trace.ingressPath).toBe("store_recorded_operator_mutation");
    expect(trace.hashInputVersion).toBe(2);
    expect(trace.outcome).toBe("running");
    expect(trace.actor).toEqual({ type: "user", id: "u_1" });
    expect(trace.parameters).toMatchObject({
      actionKind: "agent_deployment.halt",
      orgId: "org_1",
      before: { status: "active", ids: ["d1", "d2"] },
      after: { status: "paused", count: 2 },
      reason: "Security incident",
    });
    expect(ctx.tx).toBe(tx);

    expect(wts.update).toHaveBeenCalledTimes(1);
    const [updateId, fields] = (wts.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updateId).toBe(result.workTraceId);
    expect(fields).toMatchObject({ outcome: "completed" });
    expect(fields.completedAt).toBeDefined();
  });

  it("writes a trace even when no deployments match (count: 0)", async () => {
    const { prisma } = makePrismaMock({ findMany: [], updateCount: 0 });
    const wts = makeWorkTraceStoreMock();
    const store = new PrismaDeploymentLifecycleStore(prisma, wts);

    const result = await store.haltAll({
      organizationId: "org_empty",
      operator: { type: "user", id: "u_1" },
      reason: null,
    });

    expect(result.count).toBe(0);
    expect(result.affectedDeploymentIds).toEqual([]);
    expect(wts.recordOperatorMutation).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/db test packages/db/src/stores/__tests__/prisma-deployment-lifecycle-store.test.ts`
Expected: FAIL — module `../prisma-deployment-lifecycle-store.js` not found.

- [ ] **Step 3: Implement the store** — create `packages/db/src/stores/prisma-deployment-lifecycle-store.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import type {
  DeploymentLifecycleStore,
  HaltAllInput,
  HaltAllResult,
  ResumeInput,
  ResumeResult,
  SuspendAllInput,
  SuspendAllResult,
  WorkTrace,
} from "@switchboard/core/platform";
import type { PrismaWorkTraceStore } from "./prisma-work-trace-store.js";

export class PrismaDeploymentLifecycleStore implements DeploymentLifecycleStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly workTraceStore: PrismaWorkTraceStore,
  ) {}

  async haltAll(input: HaltAllInput): Promise<HaltAllResult> {
    const requestedAt = new Date();
    const executionStartedAt = new Date();

    const txResult = await this.prisma.$transaction(async (tx) => {
      const before = await tx.agentDeployment.findMany({
        where: { organizationId: input.organizationId, status: "active" },
        select: { id: true },
      });
      const ids = before.map((r) => r.id);

      const updateResult = await tx.agentDeployment.updateMany({
        where: { organizationId: input.organizationId, status: "active" },
        data: { status: "paused" },
      });

      const workUnitId = randomUUID();
      const trace: WorkTrace = {
        workUnitId,
        traceId: workUnitId,
        intent: "agent_deployment.halt",
        mode: "operator_mutation",
        organizationId: input.organizationId,
        actor: input.operator,
        trigger: "api",
        parameters: {
          actionKind: "agent_deployment.halt",
          orgId: input.organizationId,
          before: { status: "active", ids },
          after: { status: "paused", count: updateResult.count },
          reason: input.reason,
        },
        governanceOutcome: "execute",
        riskScore: 0,
        matchedPolicies: [],
        outcome: "running",
        durationMs: 0,
        executionSummary: `operator ${input.operator.id} halted ${updateResult.count} deployment(s) for org ${input.organizationId}`,
        modeMetrics: { governanceMode: "operator_auto_allow" },
        ingressPath: "store_recorded_operator_mutation",
        hashInputVersion: 2,
        requestedAt: requestedAt.toISOString(),
        governanceCompletedAt: requestedAt.toISOString(),
      };

      await this.workTraceStore.recordOperatorMutation(trace, {
        tx: tx as Prisma.TransactionClient,
      });

      return { workUnitId, ids, count: updateResult.count };
    });

    const completedAt = new Date();
    const finalize = await this.workTraceStore.update(
      txResult.workUnitId,
      {
        outcome: "completed",
        executionStartedAt: executionStartedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - executionStartedAt.getTime()),
      },
      { caller: "DeploymentLifecycleStore.haltAll" },
    );
    if (!finalize.ok) {
      console.warn(
        `[deployment-lifecycle-store] haltAll finalize rejected for ${txResult.workUnitId}: ${finalize.reason}`,
      );
    }

    return {
      workTraceId: txResult.workUnitId,
      affectedDeploymentIds: txResult.ids,
      count: txResult.count,
    };
  }

  async resume(_input: ResumeInput): Promise<ResumeResult> {
    throw new Error("not implemented yet — see Task 3");
  }

  async suspendAll(_input: SuspendAllInput): Promise<SuspendAllResult> {
    throw new Error("not implemented yet — see Task 4");
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/db test packages/db/src/stores/__tests__/prisma-deployment-lifecycle-store.test.ts`
Expected: PASS — 2 assertions for `haltAll`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-deployment-lifecycle-store.ts \
  packages/db/src/stores/__tests__/prisma-deployment-lifecycle-store.test.ts
git commit -m "feat(db): PrismaDeploymentLifecycleStore.haltAll with operator-mutation trace"
```

---

## Task 3: Implement `resume`

**Files:**

- Modify: `packages/db/src/stores/prisma-deployment-lifecycle-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-deployment-lifecycle-store.test.ts`

- [ ] **Step 1: Write the failing test** — append a new `describe` block to the test file:

```ts
describe("PrismaDeploymentLifecycleStore.resume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips paused deployments to active scoped to skillSlug", async () => {
    const { prisma, tx } = makePrismaMock({
      findMany: [{ id: "d1" }],
      updateCount: 1,
    });
    const wts = makeWorkTraceStoreMock();
    const store = new PrismaDeploymentLifecycleStore(prisma, wts);

    const result = await store.resume({
      organizationId: "org_1",
      skillSlug: "alex",
      operator: { type: "user", id: "u_1" },
    });

    expect(result.count).toBe(1);
    expect(result.affectedDeploymentIds).toEqual(["d1"]);

    expect(tx.agentDeployment.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", skillSlug: "alex", status: "paused" },
      select: { id: true },
    });
    expect(tx.agentDeployment.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", skillSlug: "alex", status: "paused" },
      data: { status: "active" },
    });

    const [trace] = (wts.recordOperatorMutation as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(trace.intent).toBe("agent_deployment.resume");
    expect(trace.parameters).toMatchObject({
      actionKind: "agent_deployment.resume",
      orgId: "org_1",
      skillSlug: "alex",
      before: { status: "paused", ids: ["d1"] },
      after: { status: "active", count: 1 },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/db test packages/db/src/stores/__tests__/prisma-deployment-lifecycle-store.test.ts -t resume`
Expected: FAIL — `not implemented yet`.

- [ ] **Step 3: Implement `resume`** — replace the placeholder body in `prisma-deployment-lifecycle-store.ts`:

```ts
  async resume(input: ResumeInput): Promise<ResumeResult> {
    const requestedAt = new Date();
    const executionStartedAt = new Date();

    const txResult = await this.prisma.$transaction(async (tx) => {
      const before = await tx.agentDeployment.findMany({
        where: {
          organizationId: input.organizationId,
          skillSlug: input.skillSlug,
          status: "paused",
        },
        select: { id: true },
      });
      const ids = before.map((r) => r.id);

      const updateResult = await tx.agentDeployment.updateMany({
        where: {
          organizationId: input.organizationId,
          skillSlug: input.skillSlug,
          status: "paused",
        },
        data: { status: "active" },
      });

      const workUnitId = randomUUID();
      const trace: WorkTrace = {
        workUnitId,
        traceId: workUnitId,
        intent: "agent_deployment.resume",
        mode: "operator_mutation",
        organizationId: input.organizationId,
        actor: input.operator,
        trigger: "api",
        parameters: {
          actionKind: "agent_deployment.resume",
          orgId: input.organizationId,
          skillSlug: input.skillSlug,
          before: { status: "paused", ids },
          after: { status: "active", count: updateResult.count },
        },
        governanceOutcome: "execute",
        riskScore: 0,
        matchedPolicies: [],
        outcome: "running",
        durationMs: 0,
        executionSummary: `operator ${input.operator.id} resumed ${updateResult.count} ${input.skillSlug} deployment(s) for org ${input.organizationId}`,
        modeMetrics: { governanceMode: "operator_auto_allow" },
        ingressPath: "store_recorded_operator_mutation",
        hashInputVersion: 2,
        requestedAt: requestedAt.toISOString(),
        governanceCompletedAt: requestedAt.toISOString(),
      };

      await this.workTraceStore.recordOperatorMutation(trace, {
        tx: tx as Prisma.TransactionClient,
      });

      return { workUnitId, ids, count: updateResult.count };
    });

    const completedAt = new Date();
    const finalize = await this.workTraceStore.update(
      txResult.workUnitId,
      {
        outcome: "completed",
        executionStartedAt: executionStartedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - executionStartedAt.getTime()),
      },
      { caller: "DeploymentLifecycleStore.resume" },
    );
    if (!finalize.ok) {
      console.warn(
        `[deployment-lifecycle-store] resume finalize rejected for ${txResult.workUnitId}: ${finalize.reason}`,
      );
    }

    return {
      workTraceId: txResult.workUnitId,
      affectedDeploymentIds: txResult.ids,
      count: txResult.count,
    };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/db test packages/db/src/stores/__tests__/prisma-deployment-lifecycle-store.test.ts`
Expected: PASS — both `haltAll` and `resume` describes green.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-deployment-lifecycle-store.ts \
  packages/db/src/stores/__tests__/prisma-deployment-lifecycle-store.test.ts
git commit -m "feat(db): PrismaDeploymentLifecycleStore.resume with operator-mutation trace"
```

---

## Task 4: Implement `suspendAll`

**Files:**

- Modify: `packages/db/src/stores/prisma-deployment-lifecycle-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-deployment-lifecycle-store.test.ts`

- [ ] **Step 1: Write the failing test** — append:

```ts
describe("PrismaDeploymentLifecycleStore.suspendAll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips active deployments to suspended and writes a service-actor trace", async () => {
    const { prisma, tx } = makePrismaMock({
      findMany: [{ id: "d1" }, { id: "d2" }, { id: "d3" }],
      updateCount: 3,
    });
    const wts = makeWorkTraceStoreMock();
    const store = new PrismaDeploymentLifecycleStore(prisma, wts);

    const result = await store.suspendAll({
      organizationId: "org_1",
      operator: { type: "service", id: "stripe-webhook" },
      reason: "subscription_canceled",
    });

    expect(result.count).toBe(3);
    expect(result.affectedDeploymentIds).toEqual(["d1", "d2", "d3"]);

    expect(tx.agentDeployment.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", status: "active" },
      data: { status: "suspended" },
    });

    const [trace] = (wts.recordOperatorMutation as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(trace.intent).toBe("agent_deployment.suspend");
    // "internal" matches the Trigger union (chat|api|schedule|internal) and the
    // existing Stripe-driven pattern in apps/api/src/bootstrap/contained-workflows.ts.
    expect(trace.trigger).toBe("internal");
    expect(trace.actor).toEqual({ type: "service", id: "stripe-webhook" });
    expect(trace.parameters).toMatchObject({
      actionKind: "agent_deployment.suspend",
      orgId: "org_1",
      before: { status: "active", ids: ["d1", "d2", "d3"] },
      after: { status: "suspended", count: 3 },
      reason: "subscription_canceled",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/db test packages/db/src/stores/__tests__/prisma-deployment-lifecycle-store.test.ts -t suspendAll`
Expected: FAIL — `not implemented yet`.

- [ ] **Step 3: Implement `suspendAll`** — replace the placeholder body:

```ts
  async suspendAll(input: SuspendAllInput): Promise<SuspendAllResult> {
    const requestedAt = new Date();
    const executionStartedAt = new Date();

    const txResult = await this.prisma.$transaction(async (tx) => {
      const before = await tx.agentDeployment.findMany({
        where: { organizationId: input.organizationId, status: "active" },
        select: { id: true },
      });
      const ids = before.map((r) => r.id);

      const updateResult = await tx.agentDeployment.updateMany({
        where: { organizationId: input.organizationId, status: "active" },
        data: { status: "suspended" },
      });

      const workUnitId = randomUUID();
      const trace: WorkTrace = {
        workUnitId,
        traceId: workUnitId,
        intent: "agent_deployment.suspend",
        mode: "operator_mutation",
        organizationId: input.organizationId,
        actor: input.operator,
        trigger: "internal",
        parameters: {
          actionKind: "agent_deployment.suspend",
          orgId: input.organizationId,
          before: { status: "active", ids },
          after: { status: "suspended", count: updateResult.count },
          reason: input.reason,
        },
        governanceOutcome: "execute",
        riskScore: 0,
        matchedPolicies: [],
        outcome: "running",
        durationMs: 0,
        executionSummary: `service ${input.operator.id} suspended ${updateResult.count} deployment(s) for org ${input.organizationId} (${input.reason})`,
        modeMetrics: { governanceMode: "operator_auto_allow" },
        ingressPath: "store_recorded_operator_mutation",
        hashInputVersion: 2,
        requestedAt: requestedAt.toISOString(),
        governanceCompletedAt: requestedAt.toISOString(),
      };

      await this.workTraceStore.recordOperatorMutation(trace, {
        tx: tx as Prisma.TransactionClient,
      });

      return { workUnitId, ids, count: updateResult.count };
    });

    const completedAt = new Date();
    const finalize = await this.workTraceStore.update(
      txResult.workUnitId,
      {
        outcome: "completed",
        executionStartedAt: executionStartedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - executionStartedAt.getTime()),
      },
      { caller: "DeploymentLifecycleStore.suspendAll" },
    );
    if (!finalize.ok) {
      console.warn(
        `[deployment-lifecycle-store] suspendAll finalize rejected for ${txResult.workUnitId}: ${finalize.reason}`,
      );
    }

    return {
      workTraceId: txResult.workUnitId,
      affectedDeploymentIds: txResult.ids,
      count: txResult.count,
    };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/db test packages/db/src/stores/__tests__/prisma-deployment-lifecycle-store.test.ts`
Expected: PASS — all three describes green.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-deployment-lifecycle-store.ts \
  packages/db/src/stores/__tests__/prisma-deployment-lifecycle-store.test.ts
git commit -m "feat(db): PrismaDeploymentLifecycleStore.suspendAll for billing-driven suspends"
```

---

## Task 5: Wire the store into the Fastify app

**Files:**

- Modify: `packages/db/src/index.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Re-export from `@switchboard/db` barrel** — append to `packages/db/src/index.ts` (alongside `PrismaConversationStateStore`):

```ts
export { PrismaDeploymentLifecycleStore } from "./stores/prisma-deployment-lifecycle-store.js";
```

- [ ] **Step 2: Augment `FastifyInstance`** — in `apps/api/src/app.ts`, find the `declare module "fastify"` block (around line 40–60) and add after `conversationStateStore`:

```ts
    deploymentLifecycleStore:
      import("@switchboard/core/platform").DeploymentLifecycleStore | null;
```

- [ ] **Step 3: Construct inside the existing `if (prismaClient)` block** — Risk #1 established the pattern at `apps/api/src/app.ts:419–425` of constructing every store that needs the concrete `PrismaWorkTraceStore` *inside the same block where `prismaWorkTraceStore` is in lexical scope*. Doing this avoids the public `WorkTraceStore` interface (which intentionally does not expose `recordOperatorMutation`) and removes the need for a downcast. Mirror that pattern exactly.

In the file (around lines 412–425 on `origin/main`), the existing block looks like:

```ts
  let workTraceStore: import("@switchboard/core/platform").WorkTraceStore | undefined;
  let deploymentResolver: import("@switchboard/core/platform").DeploymentResolver | null = null;
  let conversationStateStore:
    | import("@switchboard/core/platform").ConversationStateStore
    | null = null;
  if (prismaClient) {
    const { PrismaWorkTraceStore } = await import("@switchboard/db");
    const prismaWorkTraceStore = new PrismaWorkTraceStore(prismaClient, {
      auditLedger: ledger,
      operatorAlerter,
    });
    workTraceStore = prismaWorkTraceStore;
    conversationStateStore = new PrismaConversationStateStore(prismaClient, prismaWorkTraceStore);
    deploymentResolver = new PrismaDeploymentResolver(prismaClient as never);
  }
```

Add a third local declaration alongside `conversationStateStore`:

```ts
  let deploymentLifecycleStore:
    | import("@switchboard/core/platform").DeploymentLifecycleStore
    | null = null;
```

Then, **inside** the existing `if (prismaClient) { … }` block, immediately after the `conversationStateStore = new PrismaConversationStateStore(...)` line, add:

```ts
    const { PrismaDeploymentLifecycleStore } = await import("@switchboard/db");
    deploymentLifecycleStore = new PrismaDeploymentLifecycleStore(
      prismaClient,
      prismaWorkTraceStore,
    );
```

`prismaWorkTraceStore` is already typed as the concrete `PrismaWorkTraceStore` class in this scope, so `recordOperatorMutation` is statically visible — no cast needed.

After the block, alongside the existing `app.decorate("conversationStateStore", …)` decoration, add:

```ts
  app.decorate("deploymentLifecycleStore", deploymentLifecycleStore ?? null);
```

Do not introduce a separate `if (prismaClient && workTraceStore) { ... }` block — that loses the concrete-typed `prismaWorkTraceStore` reference and would force an `as unknown as never` cast (a code smell that hides actual contract violations and would break if `workTraceStore` is ever swapped for a non-`PrismaWorkTraceStore` impl).

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS.

- [ ] **Step 5: Run existing app tests to verify no regression**

Run: `pnpm --filter @switchboard/api test apps/api/src/__tests__/api-governance.test.ts`
Expected: PASS — existing tests still green (the new decoration is opt-in; they don't depend on it yet).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/index.ts apps/api/src/app.ts
git commit -m "feat(api): decorate app.deploymentLifecycleStore"
```

---

## Task 6: Refactor `governance.ts` emergency-halt route

**Files:**

- Modify: `apps/api/src/routes/governance.ts`
- Modify: `apps/api/src/__tests__/api-governance.test.ts`

- [ ] **Step 1: Update the test mock** — in `apps/api/src/__tests__/api-governance.test.ts`, add to the `describe` setup (alongside `mockGovernanceProfileStore`):

```ts
  const mockDeploymentLifecycleStore = {
    haltAll: vi.fn(),
    resume: vi.fn(),
    suspendAll: vi.fn(),
  };

  const mockAuditLedger = {
    record: vi.fn().mockResolvedValue(undefined),
  };
```

In the `beforeEach` block, add the decorations and **default resolved values** AFTER the existing `vi.clearAllMocks()` so the pre-existing happy-path tests (which never call `.mockResolvedValue` on the store mock themselves) don't crash when the route reads `result.count` / `result.affectedDeploymentIds` on `undefined`:

```ts
    // Default resolved values — pre-existing tests rely on the route receiving a
    // benign object so it can read `.count` / `.affectedDeploymentIds` without
    // throwing. Tests that care about specific values override via
    // mockDeploymentLifecycleStore.haltAll.mockResolvedValueOnce(...) inside the test body.
    mockDeploymentLifecycleStore.haltAll.mockResolvedValue({
      workTraceId: "wt_default_halt",
      affectedDeploymentIds: [],
      count: 0,
    });
    mockDeploymentLifecycleStore.resume.mockResolvedValue({
      workTraceId: "wt_default_resume",
      affectedDeploymentIds: [],
      count: 0,
    });
    mockDeploymentLifecycleStore.suspendAll.mockResolvedValue({
      workTraceId: "wt_default_suspend",
      affectedDeploymentIds: [],
      count: 0,
    });

    app.decorate("deploymentLifecycleStore", mockDeploymentLifecycleStore as unknown as never);
    app.decorate("auditLedger", mockAuditLedger as unknown as never);
```

- [ ] **Step 2: Add a failing test** — append to the `describe("POST /api/governance/emergency-halt", …)` block:

```ts
    it("calls deploymentLifecycleStore.haltAll and surfaces the count", async () => {
      mockGovernanceProfileStore.set.mockResolvedValue(undefined);
      mockCartridges.get.mockReturnValue(undefined);
      mockDeploymentLifecycleStore.haltAll.mockResolvedValue({
        workTraceId: "wt_halt_1",
        affectedDeploymentIds: ["d1", "d2"],
        count: 2,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        payload: { organizationId: "org_123", reason: "incident" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.deploymentsPaused).toBe(2);
      expect(mockDeploymentLifecycleStore.haltAll).toHaveBeenCalledWith({
        organizationId: "org_123",
        operator: { type: "user", id: "test-principal" },
        reason: "incident",
      });
    });

    it("returns 503 when deploymentLifecycleStore is null", async () => {
      const localApp = Fastify({ logger: false });
      localApp.decorate("governanceProfileStore", mockGovernanceProfileStore);
      localApp.decorate("storageContext", { cartridges: mockCartridges } as unknown as never);
      localApp.decorate("platformIngress", mockPlatformIngress as unknown as never);
      localApp.decorate("deploymentLifecycleStore", null);
      localApp.decorate("auditLedger", mockAuditLedger as unknown as never);
      localApp.decorateRequest("organizationIdFromAuth", "org_123");
      localApp.decorateRequest("principalIdFromAuth", "test-principal");
      await localApp.register(governanceRoutes, { prefix: "/api/governance" });

      const res = await localApp.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        payload: { organizationId: "org_123" },
      });

      expect(res.statusCode).toBe(503);
      await localApp.close();
    });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/api test apps/api/src/__tests__/api-governance.test.ts -t "deploymentLifecycleStore"`
Expected: FAIL — current route still calls `app.prisma.agentDeployment.updateMany`, not the store.

- [ ] **Step 4: Refactor the emergency-halt handler** — in `apps/api/src/routes/governance.ts`, replace the block at lines 178–202 (the `await store.set(orgId, "locked");` through the `await app.auditLedger.record({...})` for `agent.emergency-halted`):

```ts
      const store = app.governanceProfileStore;
      await store.set(orgId, "locked");

      // Halt all active deployments via the lifecycle store (writes WorkTrace).
      if (!app.deploymentLifecycleStore) {
        return reply
          .code(503)
          .send({ error: "Deployment store unavailable", statusCode: 503 });
      }

      const operator = resolveOperatorActor(request);
      const haltResult = await app.deploymentLifecycleStore.haltAll({
        organizationId: orgId,
        operator,
        reason: body.reason ?? null,
      });
      const deploymentsPaused = haltResult.count;

      // Domain-event audit row preserved for the /status reader (see spec §3 / §4.6).
      await app.auditLedger.record({
        eventType: "agent.emergency-halted",
        actorType: "user",
        actorId: operator.id,
        entityType: "organization",
        entityId: orgId,
        riskCategory: "high",
        organizationId: orgId,
        summary: `Emergency halt: locked governance and paused ${deploymentsPaused} deployment(s)`,
        snapshot: {
          reason: body.reason ?? null,
          deploymentsPaused,
          workTraceId: haltResult.workTraceId,
          affectedDeploymentIds: haltResult.affectedDeploymentIds,
        },
      });
```

Add the import at the top of the file (next to the existing imports):

```ts
import { resolveOperatorActor } from "./operator-actor.js";
```

Remove the now-dead `if (app.prisma) { ... }` wrapper around the deployment update + audit-record block; the store call is the new gate.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/api test apps/api/src/__tests__/api-governance.test.ts`
Expected: PASS — including the new `deploymentLifecycleStore` assertions and the 503 case. Existing assertions about `governanceProfile: "locked"` and `campaignsPaused` are unaffected.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/governance.ts apps/api/src/__tests__/api-governance.test.ts
git commit -m "refactor(api): governance emergency-halt routes through DeploymentLifecycleStore"
```

---

## Task 7: Refactor `governance.ts` resume route

**Files:**

- Modify: `apps/api/src/routes/governance.ts`
- Modify: `apps/api/src/__tests__/api-governance.test.ts`

**Test scoping decision:** the resume happy-path runs `buildReadinessContext` which queries 4 Prisma models (`agentDeployment`, `managedChannel`, `connection`, `agentListing`). Stubbing all four reliably is more brittle than valuable for a route-level test. We test the **store-call ordering** (the new bypass-fix) in the route test, and rely on the **integration test in Task 9** for true end-to-end resume coverage with a real Prisma client.

The route-level test asserts exactly one thing: when readiness passes, the route calls `deploymentLifecycleStore.resume` (not `prisma.agentDeployment.updateMany`). To do this without rewiring readiness, we mock `checkReadiness` itself.

- [ ] **Step 1: Add a failing test** — in `api-governance.test.ts`, append a new `describe` block:

```ts
  // The resume route calls checkReadiness() internally. We mock the function
  // module-level to bypass its multi-table Prisma dependency; what we are
  // verifying here is that the route delegates to deploymentLifecycleStore.resume
  // when readiness passes, not the readiness logic itself (covered elsewhere).
  vi.mock("../routes/readiness.js", async (importActual) => {
    const actual = await importActual<typeof import("../routes/readiness.js")>();
    return {
      ...actual,
      checkReadiness: vi.fn(() => ({ ready: true, checks: [] })),
      buildReadinessContext: vi.fn(async () => ({ deployment: { status: "paused" } })),
    };
  });

  describe("POST /api/governance/resume", () => {
    it("calls deploymentLifecycleStore.resume scoped to skillSlug=alex", async () => {
      mockGovernanceProfileStore.set.mockResolvedValue(undefined);
      mockDeploymentLifecycleStore.resume.mockResolvedValue({
        workTraceId: "wt_resume_1",
        affectedDeploymentIds: ["d_alex"],
        count: 1,
      });
      // Decorate a minimal prisma so the early-exit guard at line ~290 does not
      // short-circuit. The actual prisma calls are intercepted by the readiness mock above.
      app.decorate("prisma", {} as unknown as never);

      const res = await app.inject({
        method: "POST",
        url: "/api/governance/resume",
        payload: { organizationId: "org_123" },
      });

      expect(res.statusCode).toBe(200);
      expect(mockDeploymentLifecycleStore.resume).toHaveBeenCalledWith({
        organizationId: "org_123",
        skillSlug: "alex",
        operator: { type: "user", id: "test-principal" },
      });
      const body = res.json();
      expect(body.resumed).toBe(true);
      expect(body.profile).toBe("guarded");
    });

    it("returns 503 when deploymentLifecycleStore is null", async () => {
      const localApp = Fastify({ logger: false });
      localApp.decorate("governanceProfileStore", mockGovernanceProfileStore);
      localApp.decorate("storageContext", { cartridges: mockCartridges } as unknown as never);
      localApp.decorate("platformIngress", mockPlatformIngress as unknown as never);
      localApp.decorate("deploymentLifecycleStore", null);
      localApp.decorate("auditLedger", mockAuditLedger as unknown as never);
      localApp.decorate("prisma", {} as unknown as never);
      localApp.decorateRequest("organizationIdFromAuth", "org_123");
      localApp.decorateRequest("principalIdFromAuth", "test-principal");
      localApp.addHook("onRequest", async (request) => {
        (request as unknown as Record<string, unknown>).organizationIdFromAuth = "org_123";
        (request as unknown as Record<string, unknown>).principalIdFromAuth = "test-principal";
      });
      await localApp.register(governanceRoutes, { prefix: "/api/governance" });

      const res = await localApp.inject({
        method: "POST",
        url: "/api/governance/resume",
        payload: { organizationId: "org_123" },
      });

      // The store-null guard fires AFTER readiness passes (mocked to ready:true above).
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error).toMatch(/store unavailable/i);
      await localApp.close();
    });
  });
```

> **Caveat for executor:** Vitest hoists `vi.mock(...)` calls to the top of the file regardless of where they appear, but the hoist only works at module scope (NOT inside a `describe` block). Place the `vi.mock("../routes/readiness.js", …)` at the **top of the file**, immediately after the imports — that is the load-bearing version. If the mock factory cannot be made to satisfy both `checkReadiness` and `buildReadinessContext` consumers cleanly, see the coverage policy below before dropping the test.

> **Coverage policy (load-bearing — read before deciding to drop the happy-path test):** The "calls deploymentLifecycleStore.resume" assertion is the **only** test that proves the route delegates to the new store on the happy path. Task 9's integration test is `describe.skipIf(!process.env.DATABASE_URL)`, and the Switchboard CI for this repo does NOT export `DATABASE_URL` to the unit-test job (see `.github/workflows/` and `package.json` `test` scripts on `origin/main` — verify before executing). That means: in CI, dropping the route-level happy-path test leaves `resume` route delegation **uncovered until a developer manually runs the integration test locally**. **Do not drop this test.** If `vi.mock` hoisting at module top still fails after one good-faith attempt, escalate to the planner rather than dropping coverage. Acceptable fallback: stub `app.prisma` deeply enough to satisfy `buildReadinessContext` (the four models listed earlier) and call `checkReadiness` for real — slower than mocking, but unambiguous.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/api test apps/api/src/__tests__/api-governance.test.ts -t "resume"`
Expected: FAIL — current route still calls `app.prisma.agentDeployment.updateMany` directly.

- [ ] **Step 3: Refactor the resume handler** — in `apps/api/src/routes/governance.ts`, replace lines 313–334 (from `// Restore governance to guarded` through the existing `agentDeployment.updateMany` and the `auditLedger.record({eventType:"agent.resumed"…})` call):

```ts
      // Restore governance to guarded (safe default)
      const store = app.governanceProfileStore;
      await store.set(orgId, "guarded");

      // Reactivate paused deployment(s) for the alex skill via the lifecycle store.
      if (!app.deploymentLifecycleStore) {
        return reply
          .code(503)
          .send({ error: "Deployment store unavailable", statusCode: 503 });
      }
      const operator = resolveOperatorActor(request);
      const resumeResult = await app.deploymentLifecycleStore.resume({
        organizationId: orgId,
        skillSlug: "alex",
        operator,
      });

      // Domain-event audit row preserved.
      await app.auditLedger.record({
        eventType: "agent.resumed",
        actorType: "user",
        actorId: operator.id,
        entityType: "organization",
        entityId: orgId,
        riskCategory: "medium",
        organizationId: orgId,
        summary: `Agent resumed for organization ${orgId}`,
        snapshot: {
          previousProfile: "locked",
          newProfile: "guarded",
          workTraceId: resumeResult.workTraceId,
          affectedDeploymentIds: resumeResult.affectedDeploymentIds,
        },
      });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/api test apps/api/src/__tests__/api-governance.test.ts`
Expected: PASS — 503-null-store assertion green; pre-existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/governance.ts apps/api/src/__tests__/api-governance.test.ts
git commit -m "refactor(api): governance resume route uses DeploymentLifecycleStore"
```

---

## Task 8: Refactor `billing.ts` subscription-canceled branch

**Files:**

- Modify: `apps/api/src/routes/billing.ts`
- Modify: `apps/api/src/routes/__tests__/billing.test.ts`

- [ ] **Step 1: Update the test mock** — in `apps/api/src/routes/__tests__/billing.test.ts`, add alongside the existing mocks (around line 30):

```ts
const mockSuspendAll = vi.fn();
const mockDeploymentLifecycleStore = {
  haltAll: vi.fn(),
  resume: vi.fn(),
  suspendAll: mockSuspendAll,
};
```

In the file's existing top-level `beforeEach` (the one that already calls `vi.clearAllMocks()`), add a default resolved value so any future webhook test paths that flow through the canceled branch don't crash:

```ts
  mockSuspendAll.mockResolvedValue({
    workTraceId: "wt_default_suspend",
    affectedDeploymentIds: [],
    count: 0,
  });
```

In `buildTestApp`, add the decoration after `app.decorate("prisma", …)`:

```ts
  app.decorate(
    "deploymentLifecycleStore",
    mockDeploymentLifecycleStore as unknown as typeof app.deploymentLifecycleStore,
  );
```

- [ ] **Step 2: Add a failing test** — append to the existing `describe("billing routes", …)` (mirror the shape of the existing `customer.subscription.updated` test at lines ~277–315 of the on-disk file):

```ts
  it("webhook customer.subscription.updated → canceled calls suspendAll, not direct updateMany", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_cancel",
      type: "customer.subscription.updated",
      data: {
        object: {
          metadata: { organizationId: "org-1" },
          status: "canceled",
          items: { data: [{ price: { id: "price_pro" }, current_period_end: 1787875200 }] },
          cancel_at_period_end: false,
          trial_end: null,
        },
      },
    });
    mockUpdate.mockResolvedValue({});
    mockChannelUpdateMany.mockResolvedValue({ count: 0 });
    mockSuspendAll.mockResolvedValue({
      workTraceId: "wt_suspend_1",
      affectedDeploymentIds: ["d1"],
      count: 1,
    });

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/billing/webhook",
      headers: {
        "stripe-signature": "sig_valid",
        "content-type": "application/json",
      },
      payload: JSON.stringify({ id: "evt_cancel" }),
    });

    expect(res.statusCode).toBe(200);
    expect(mockSuspendAll).toHaveBeenCalledWith({
      organizationId: "org-1",
      operator: { type: "service", id: "stripe-webhook" },
      reason: "subscription_canceled",
    });
    // Direct updateMany must no longer be called by the canceled branch.
    expect(mockDeploymentUpdateMany).not.toHaveBeenCalled();
    // Channels are out of scope for this slice — channel updateMany is still direct.
    expect(mockChannelUpdateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", status: "active" },
      data: { status: "suspended" },
    });
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/api test apps/api/src/routes/__tests__/billing.test.ts -t "suspendAll"`
Expected: FAIL — route still calls `prisma.agentDeployment.updateMany`.

- [ ] **Step 4: Refactor the cancel branch** — in `apps/api/src/routes/billing.ts`, replace lines 246–252 (the `if (result.data.status === "canceled") { ... agentDeployment.updateMany ... managedChannel.updateMany ... }` block) with:

```ts
          if (result.data.status === "canceled") {
            if (app.deploymentLifecycleStore) {
              await app.deploymentLifecycleStore.suspendAll({
                organizationId: orgId,
                operator: { type: "service", id: "stripe-webhook" },
                reason: "subscription_canceled",
              });
            } else {
              app.log.warn(
                { orgId },
                "Subscription canceled but deploymentLifecycleStore unavailable; skipping deployment suspend",
              );
            }
            await app.prisma.managedChannel.updateMany({
              where: { organizationId: orgId, status: "active" },
              data: { status: "suspended" },
            });
            app.log.info({ orgId }, "Subscription canceled — suspended agents and channels");
          }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/api test apps/api/src/routes/__tests__/billing.test.ts`
Expected: PASS — new `suspendAll` test green; existing webhook tests unaffected (the mock returns a benign result).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/billing.ts apps/api/src/routes/__tests__/billing.test.ts
git commit -m "refactor(api): billing subscription-canceled branch uses DeploymentLifecycleStore"
```

---

## Task 9: Integration test (skipIf no DATABASE_URL)

**Files:**

- Create: `apps/api/src/__tests__/deployment-lifecycle-store.integration.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaWorkTraceStore } from "@switchboard/db";
import { PrismaDeploymentLifecycleStore } from "@switchboard/db";

const skip = !process.env.DATABASE_URL;

describe.skipIf(skip)("PrismaDeploymentLifecycleStore (integration)", () => {
  let prisma: PrismaClient;
  let workTraceStore: PrismaWorkTraceStore;
  let store: PrismaDeploymentLifecycleStore;
  let orgId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    // Minimal AuditLedger + OperatorAlerter stubs that satisfy the constructor.
    const auditLedger = {
      record: async () => undefined,
    } as unknown as ConstructorParameters<typeof PrismaWorkTraceStore>[1]["auditLedger"];
    const operatorAlerter = {
      alert: async () => undefined,
    } as unknown as ConstructorParameters<typeof PrismaWorkTraceStore>[1]["operatorAlerter"];
    workTraceStore = new PrismaWorkTraceStore(prisma, { auditLedger, operatorAlerter });
    store = new PrismaDeploymentLifecycleStore(prisma, workTraceStore);

    // Seed: create a fresh org + listing + 2 active deployments.
    orgId = `org_test_${Date.now()}`;
    await prisma.organization.create({
      data: { id: orgId, name: "lifecycle-store-test" },
    });
    const listing = await prisma.agentListing.create({
      data: { slug: "alex", title: "Alex", trustScore: 75, status: "active" },
    });
    await prisma.agentDeployment.createMany({
      data: [
        {
          organizationId: orgId,
          listingId: listing.id,
          status: "active",
          skillSlug: "alex",
        },
        {
          organizationId: orgId,
          listingId: listing.id,
          status: "active",
          skillSlug: "ops",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.workTrace.deleteMany({ where: { organizationId: orgId } });
    await prisma.agentDeployment.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it("haltAll persists a finalized operator-mutation trace", async () => {
    const result = await store.haltAll({
      organizationId: orgId,
      operator: { type: "user", id: "u_test" },
      reason: "integration test",
    });
    expect(result.count).toBe(2);

    const persisted = await prisma.workTrace.findUnique({
      where: { workUnitId: result.workTraceId },
    });
    expect(persisted).toBeTruthy();
    expect(persisted!.intent).toBe("agent_deployment.halt");
    expect(persisted!.mode).toBe("operator_mutation");
    expect(persisted!.ingressPath).toBe("store_recorded_operator_mutation");
    expect(persisted!.hashInputVersion).toBe(2);
    expect(persisted!.outcome).toBe("completed");
    expect(persisted!.contentHash).toBeTruthy();
    expect(persisted!.lockedAt).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test (no-DB run skips)**

Run: `pnpm --filter @switchboard/api test apps/api/src/__tests__/deployment-lifecycle-store.integration.test.ts`
Expected: SKIPPED (when `DATABASE_URL` unset) or PASS (when set).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/deployment-lifecycle-store.integration.test.ts
git commit -m "test(api): integration test for PrismaDeploymentLifecycleStore (skipped without DATABASE_URL)"
```

---

## Task 10: Audit-doc closeout

**Files:**

- Modify: `.audit/08-launch-blocker-sequence.md`

- [ ] **Step 1: Edit the launch-risks summary table** (around line 107) — change Risk #2's row:

```markdown
| 2   | AgentDeployment updateMany bypass                  | ✅ SHIPPED | PR #<spec-pr> spec/plan, PR #<impl-pr> implementation. `governance.ts` halt + resume and `billing.ts` subscription-canceled now route through `PrismaDeploymentLifecycleStore` with `intent: "agent_deployment.halt"|"resume"|"suspend"`, `mode: "operator_mutation"`, `ingressPath: "store_recorded_operator_mutation"` traces. Circuit-breaker write deferred (no current callsite). |
```

> Replace `<spec-pr>` with this spec/plan PR number (already known by the time the implementation worktree is created — read from the merged PR) and `<impl-pr>` with the implementation PR number after that PR is opened. Do not commit Task 10 until the impl PR number is known.

- [ ] **Step 2: Edit the priority list** (around line 119–125) — remove "Risk #2" from the open-work ordered list and renumber subsequent items.

- [ ] **Step 3: Add a Status block under the Risk #2 entry** (around line 540) — append to the Risk-2 entry:

```markdown
**Status — 2026-04-30:** ✅ SHIPPED. Implementation lands `PrismaDeploymentLifecycleStore` (`packages/db/src/stores/`) with `haltAll`/`resume`/`suspendAll` methods. Each method writes a transactional `operator_mutation` `WorkTrace`. Routes refactored:

- `apps/api/src/routes/governance.ts` `POST /emergency-halt` → `haltAll`.
- `apps/api/src/routes/governance.ts` `POST /resume` → `resume`.
- `apps/api/src/routes/billing.ts` `customer.subscription.updated → canceled` → `suspendAll`.

The pre-existing `auditLedger.record({eventType:"agent.emergency-halted"|"agent.resumed"})` writes are preserved — the `/api/governance/:orgId/status` reader still queries `AuditEntry` for halt history. Migrating that reader off `AuditEntry` and onto `WorkTrace` is a UI-touching follow-up not blocked by this slice.

Out of scope deferrals (see spec §3 / §7):

- `Store.updateCircuitBreaker()` — no current write callsite.
- `ManagedChannelLifecycleStore` for `billing.ts:248`.
- Stripe-event idempotency on `suspendAll` traces.
```

- [ ] **Step 4: Commit**

```bash
git add .audit/08-launch-blocker-sequence.md
git commit -m "chore(audit): mark Launch-Risk #2 (DeploymentLifecycleStore) shipped"
```

---

## Final verification

Before opening the PR, run from the implementation worktree:

- [ ] `pnpm typecheck` — must pass.
- [ ] `pnpm --filter @switchboard/core --filter @switchboard/db --filter @switchboard/api test` — must pass.
- [ ] `pnpm lint` on touched packages — must pass.
- [ ] `git grep "agentDeployment\.updateMany" apps/ packages/` — should return zero results in non-test, non-seed paths. Acceptable matches: seed scripts (`packages/db/prisma/seed-marketplace.*`) and the new `PrismaDeploymentLifecycleStore` itself.
- [ ] Manual sanity: `git log --oneline origin/main..HEAD` shows ~10 conventional commits in task order, no merge commits.

PR description should reference:

- This plan: `docs/superpowers/plans/2026-04-30-fix-launch-agent-deployment-store-methods-plan.md`
- The spec: `docs/superpowers/specs/2026-04-30-fix-launch-agent-deployment-store-methods-design.md`
- The audit entry: `.audit/08-launch-blocker-sequence.md` Launch-Risk #2.
