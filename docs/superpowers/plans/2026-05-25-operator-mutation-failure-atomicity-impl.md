# Operator-Mutation Failure & Atomicity — Implementation Plan (#677)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two coupled operator-mutation defects from [#677](https://github.com/jsonljc/switchboard/issues/677): (PR-1) a thrown execution-path exception must still persist a `failed` WorkTrace before rethrowing, and (PR-2) the revenue handler's domain-write + outbox-write must be atomic.

**Architecture:** PR-1 wraps only the post-governance `modeRegistry.dispatch(...)` call in `PlatformIngress.submit()` in try/catch → persist a `failed` WorkTrace with a distinct `EXECUTION_EXCEPTION` platform code → `recordInfrastructureFailure` → rethrow the original error. PR-2 opens a `prisma.$transaction` in the app-layer revenue handler via an injected `runInTransaction` runner, threading the tx client (typed in core as an opaque `StoreTransactionContext`, narrowed to the existing `@switchboard/db` `PrismaDbClient` in the Prisma stores) into both `revenueStore.record` and `outboxWriter.write`.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Vitest, Prisma, Fastify. Monorepo layers: `schemas` → `core` → `db` → `apps/*`.

**Spec:** `docs/superpowers/specs/2026-05-25-operator-mutation-failure-atomicity-design.md`. Read it before starting.

**Two PRs, sequenced:** Land PR-1 first (Tasks 1–2; core ingress invariant; migration-free). Then PR-2 (Tasks 3–8; app+db atomicity; migration-free). Each PR is cut fresh from updated `origin/main`.

**Pre-flight (every task):** `git branch --show-current` to confirm context. Run `pnpm install` in the worktree if husky hooks haven't resolved. PR-1 verification: `pnpm --filter @switchboard/core test && pnpm --filter @switchboard/core typecheck`. PR-2 verification: add `--filter @switchboard/db` and `--filter @switchboard/api`. Final per-PR: `pnpm typecheck && pnpm test` (the `prisma-*-integrity` / advisory-lock db tests flake without Postgres — not a regression). Run `pnpm format:check` before pushing (CI lint runs prettier; local pre-commit does too).

---

## PR-1 — Execution-path exception → failed WorkTrace

> Branch: cut fresh from `origin/main`, e.g. `worktree-issue-677` (already active) or a dedicated `issue-677-pr1` branch. Scope: `packages/core` only.

### Task 1: Persist a failed WorkTrace and rethrow when dispatch throws

**Files:**

- Modify: `packages/core/src/observability/operator-alerter.ts:1-8` (widen `InfrastructureErrorType`)
- Modify: `packages/core/src/platform/platform-ingress.ts:290-310` (wrap dispatch; widen `recordInfrastructureFailure` param union at `:372-377`)
- Test: `packages/core/src/platform/__tests__/platform-ingress-execution-error.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/platform/__tests__/platform-ingress-execution-error.test.ts`. This mirrors the rich harness in `platform-ingress.test.ts` (real `IntentRegistry` + `ExecutionModeRegistry`, a throwing `ExecutionMode`, an execute-decision gate).

```ts
import { describe, it, expect, vi } from "vitest";
import { PlatformIngress } from "../platform-ingress.js";
import type { PlatformIngressConfig, GovernanceGateInterface } from "../platform-ingress.js";
import { IntentRegistry } from "../intent-registry.js";
import { ExecutionModeRegistry } from "../execution-mode-registry.js";
import type { ExecutionMode } from "../execution-context.js";
import type { GovernanceDecision } from "../governance-types.js";
import type { WorkTraceStore } from "../work-trace-recorder.js";
import type { AuditLedger } from "../../audit/ledger.js";
import type { OperatorAlerter } from "../../observability/operator-alerter.js";

const testConstraints = { maxBudget: 100, allowedTools: [], timeoutMs: 30000 };

const testRegistration = {
  intent: "operator.test_mutation",
  defaultMode: "operator_mutation" as const,
  allowedModes: ["operator_mutation"],
  executor: { mode: "operator_mutation" as const },
  parameterSchema: {},
  mutationClass: "write" as const,
  budgetClass: "cheap" as const,
  approvalPolicy: "none" as const,
  approvalMode: "system_auto_approved" as const,
  idempotent: true,
  allowedTriggers: ["api" as const],
  timeoutMs: 30000,
  retryable: false,
};

function buildExecuteDecision(): GovernanceDecision {
  return {
    outcome: "execute",
    riskScore: 0.2,
    budgetProfile: "standard",
    constraints: testConstraints,
    matchedPolicies: ["default-policy"],
  } as GovernanceDecision;
}

function makeThrowingMode(err: Error): ExecutionMode {
  return { name: "operator_mutation", execute: vi.fn().mockRejectedValue(err) };
}

function makeTraceStore(): WorkTraceStore {
  return {
    persist: vi.fn().mockResolvedValue(undefined),
    getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    getByWorkUnitId: vi.fn().mockResolvedValue(null),
  } as unknown as WorkTraceStore;
}

function buildConfig(overrides: {
  mode: ExecutionMode;
  traceStore?: WorkTraceStore;
  alerter?: OperatorAlerter;
  auditLedger?: AuditLedger;
}): PlatformIngressConfig {
  const intentRegistry = new IntentRegistry();
  intentRegistry.register(testRegistration as never);
  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register(overrides.mode);
  const governanceGate: GovernanceGateInterface = {
    evaluate: vi.fn().mockResolvedValue(buildExecuteDecision()),
  };
  return {
    intentRegistry,
    modeRegistry,
    governanceGate,
    deploymentResolver: {
      resolve: vi.fn().mockResolvedValue({
        deploymentId: "dep-1",
        skillSlug: "test",
        trustScore: 42,
      }),
    } as never,
    traceStore: overrides.traceStore,
    operatorAlerter: overrides.alerter,
    auditLedger: overrides.auditLedger,
  };
}

const baseRequest = {
  intent: "operator.test_mutation",
  trigger: "api" as const,
  organizationId: "org_1",
  actor: { id: "actor_1", type: "user" as const },
  parameters: {},
  surface: { surface: "api" as const, requestId: "req_test" },
};

describe("PlatformIngress execution-path exception", () => {
  it("persists a failed WorkTrace with EXECUTION_EXCEPTION and rethrows the original error", async () => {
    const boom = new Error("db blip");
    const traceStore = makeTraceStore();
    const alerter = { alert: vi.fn().mockResolvedValue(undefined) } as unknown as OperatorAlerter;
    const auditLedger = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditLedger;
    const ingress = new PlatformIngress(
      buildConfig({ mode: makeThrowingMode(boom), traceStore, alerter, auditLedger }),
    );

    await expect(ingress.submit(baseRequest)).rejects.toBe(boom);

    expect(traceStore.persist).toHaveBeenCalledTimes(1);
    const persisted = (traceStore.persist as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(persisted.outcome).toBe("failed");
    expect(persisted.error?.code).toBe("EXECUTION_EXCEPTION");

    expect(
      (auditLedger.record as ReturnType<typeof vi.fn>).mock.calls[0]![0].snapshot,
    ).toMatchObject({
      errorType: "execution_exception",
      failureClass: "infrastructure",
      severity: "critical",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test platform-ingress-execution-error`
Expected: FAIL — `submit` rejects with `boom` but `traceStore.persist` was not called (exception escapes before persistTrace), so the persist/error-code assertions fail.

- [ ] **Step 3: Widen the `InfrastructureErrorType` union**

In `packages/core/src/observability/operator-alerter.ts`, add the new member:

```ts
export type InfrastructureErrorType =
  | "governance_eval_exception"
  | "trace_persist_failed"
  | "execution_exception"
  | "work_trace_locked_violation"
  | "work_trace_integrity_mismatch"
  | "work_trace_integrity_missing_anchor"
  | "integrity_check_unavailable"
  | "async_job_retry_exhausted";
```

(No change needed in `buildInfrastructureFailureAuditParams` — it is generic over `errorType` and interpolates it into the summary; there is no per-type switch.)

- [ ] **Step 4: Widen the `recordInfrastructureFailure` param union**

In `packages/core/src/platform/platform-ingress.ts`, the private method signature at ~`:372-377`:

```ts
  private async recordInfrastructureFailure(input: {
    errorType: "governance_eval_exception" | "trace_persist_failed" | "execution_exception";
    error: unknown;
    workUnit?: WorkUnit;
    retryable: boolean;
  }): Promise<void> {
```

- [ ] **Step 5: Wrap the dispatch boundary in try/catch**

In `packages/core/src/platform/platform-ingress.ts`, replace the `// 7. Execute` block (currently ~`:290-310`):

```ts
// 7. Execute
const executionStartedAt = new Date().toISOString();
let executionResult: ExecutionResult;
try {
  executionResult = await modeRegistry.dispatch(
    workUnit.resolvedMode,
    workUnit,
    decision.constraints,
    { traceId: workUnit.traceId, governanceDecision: decision },
  );
} catch (executionErr) {
  // Invariant (#677 §2.4): persistTrace never rethrows (it owns its own retry +
  // infra-failure audit), and recordInfrastructureFailure is non-throwing, so the
  // original executionErr always survives to the rethrow below — trace-persist
  // failure can never mask it. EXECUTION_EXCEPTION is a platform code, never a
  // domain code (#677 §2.3): it must not appear in OPERATOR_INTENT_ERROR_CODES.
  const completedAt = new Date().toISOString();
  const failed = this.buildFailedResult(workUnit, "EXECUTION_EXCEPTION", "Execution failed");
  await this.persistTrace(
    traceStore,
    workUnit,
    decision,
    governanceCompletedAt,
    failed,
    executionStartedAt,
    completedAt,
  );
  await this.recordInfrastructureFailure({
    errorType: "execution_exception",
    error: executionErr,
    workUnit,
    retryable: false,
  });
  throw executionErr;
}
const completedAt = new Date().toISOString();

await this.persistTrace(
  traceStore,
  workUnit,
  decision,
  governanceCompletedAt,
  executionResult,
  executionStartedAt,
  completedAt,
);

return { ok: true, result: executionResult, workUnit };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test platform-ingress-execution-error`
Expected: PASS.

- [ ] **Step 7: Run the full core suite + typecheck**

Run: `pnpm --filter @switchboard/core test && pnpm --filter @switchboard/core typecheck`
Expected: PASS (pre-existing advisory-lock integrity flakes excepted).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/observability/operator-alerter.ts \
        packages/core/src/platform/platform-ingress.ts \
        packages/core/src/platform/__tests__/platform-ingress-execution-error.test.ts
git commit -m "$(printf 'fix(core): persist failed WorkTrace when ingress dispatch throws (#677)\n\nWrap the post-governance modeRegistry.dispatch in try/catch: on throw,\npersist a failed WorkTrace with the distinct EXECUTION_EXCEPTION platform\ncode, record an execution_exception infra failure, then rethrow the\noriginal error (scrubbed 500 via the global handler). Closes the audit\ngap where an infra-faulted operator mutation produced no WorkTrace.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Replay, domain-unchanged, and persist-mask regression tests

**Files:**

- Test: `packages/core/src/platform/__tests__/platform-ingress-execution-error.test.ts` (extend)

- [ ] **Step 1: Add the three regression tests**

Append inside the `describe` block:

```ts
it("same-key replay returns the stored failure and does not re-dispatch", async () => {
  const boom = new Error("db blip");
  const mode = makeThrowingMode(boom);
  const failedTrace = {
    workUnitId: "wu_1",
    outcome: "failed" as const,
    mode: "operator_mutation",
    traceId: "t_1",
    organizationId: "org_1",
    actor: baseRequest.actor,
    intent: baseRequest.intent,
    parameters: {},
    requestedAt: new Date().toISOString(),
    idempotencyKey: "key-1",
    executionSummary: "Execution failed",
    executionOutputs: {},
    error: { code: "EXECUTION_EXCEPTION", message: "Execution failed" },
    deploymentContext: { deploymentId: "dep-1" },
  };
  const traceStore = makeTraceStore();
  (traceStore.getByIdempotencyKey as ReturnType<typeof vi.fn>).mockResolvedValue({
    trace: failedTrace,
  });
  const ingress = new PlatformIngress(buildConfig({ mode, traceStore }));

  const res = await ingress.submit({ ...baseRequest, idempotencyKey: "key-1" });

  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.result.outcome).toBe("failed");
  expect(mode.execute).not.toHaveBeenCalled();
});

it("a handler that RETURNS outcome:failed is not classified as EXECUTION_EXCEPTION", async () => {
  const domainFailMode: ExecutionMode = {
    name: "operator_mutation",
    execute: vi.fn().mockResolvedValue({
      workUnitId: "wu_1",
      outcome: "failed",
      summary: "not found",
      outputs: {},
      mode: "operator_mutation",
      durationMs: 1,
      traceId: "t_1",
      error: { code: "OPPORTUNITY_NOT_FOUND", message: "not found" },
    }),
  };
  const traceStore = makeTraceStore();
  const ingress = new PlatformIngress(buildConfig({ mode: domainFailMode, traceStore }));

  const res = await ingress.submit(baseRequest);

  expect(res.ok).toBe(true);
  const persisted = (traceStore.persist as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  expect(persisted.outcome).toBe("failed");
  expect(persisted.error?.code).toBe("OPPORTUNITY_NOT_FOUND");
  expect(persisted.error?.code).not.toBe("EXECUTION_EXCEPTION");
});

it("trace-persist failure does not mask the original execution exception", async () => {
  const boom = new Error("handler boom");
  const traceStore = makeTraceStore();
  // Force every persist attempt to throw — persistTrace must swallow these.
  (traceStore.persist as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("trace store down"));
  const alerter = { alert: vi.fn().mockResolvedValue(undefined) } as unknown as OperatorAlerter;
  const auditLedger = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditLedger;
  const ingress = new PlatformIngress(
    buildConfig({
      mode: makeThrowingMode(boom),
      traceStore,
      alerter,
      auditLedger,
      // delayFn no-op so the persist retry loop does not actually sleep
    }) as PlatformIngressConfig,
  );

  // The rejection must be the ORIGINAL handler error, not "trace store down".
  await expect(ingress.submit(baseRequest)).rejects.toBe(boom);
});
```

Note for the persist-mask test: `persistTrace` retries with `delayFn`; inject a no-op delay to keep the test fast. Add `delayFn: async () => {}` to the `buildConfig` overrides (extend the `buildConfig` `overrides` type + pass-through) so this test does not wait on real timers.

- [ ] **Step 2: Extend `buildConfig` to accept `delayFn`**

In the test's `buildConfig`, add `delayFn?: (ms: number) => Promise<void>` to the overrides type and pass it into the returned config. Pass `delayFn: async () => {}` in the persist-mask test.

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @switchboard/core test platform-ingress-execution-error`
Expected: PASS (all 4 tests).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/platform/__tests__/platform-ingress-execution-error.test.ts
git commit -m "$(printf 'test(core): regression guards for execution-exception WorkTrace (#677)\n\nReplay returns stored failure without re-dispatch; a handler that RETURNS\noutcome:failed stays a domain failure (not EXECUTION_EXCEPTION); trace-persist\nfailure never masks the original execution exception.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

- [ ] **Step 5: Open PR-1**

```bash
git push -u origin <pr1-branch>
gh pr create --base main --title "fix(core): persist failed WorkTrace when ingress dispatch throws (#677)" \
  --body "PR-1 of #677. Closes the audit gap where a thrown operator-mutation handler produced no WorkTrace. Spec §2. Reviewed as a core ingress-invariant fix."
gh pr merge <pr#> --squash --auto
```

---

## PR-2 — Revenue transactional outbox

> Branch: cut fresh from `origin/main` AFTER PR-1 merges, e.g. `issue-677-pr2`. Scope: `packages/core` (interface), `packages/db` (store signatures), `apps/api` (handler + bootstrap).

### Task 3: Thread an optional tx client through `PrismaRevenueStore.record`

**Files:**

- Modify: `packages/db/src/stores/prisma-revenue-store.ts:40-96`
- Test: `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts` (new or existing — mirror an existing mocked-Prisma store test such as `prisma-workflow-store.test.ts`)

- [ ] **Step 1: Write the failing test**

The store must use the passed-in client (the tx) rather than `this.prisma` when a tx is provided. With a mocked Prisma, assert the tx client's `create` is the one invoked.

```ts
import { describe, it, expect, vi } from "vitest";
import { PrismaRevenueStore } from "../prisma-revenue-store.js";

function makeClient() {
  return {
    lifecycleRevenueEvent: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: "rev_1",
        organizationId: "org_1",
        contactId: "c_1",
        opportunityId: "opp_1",
        amount: 100,
        currency: "SGD",
        type: "payment",
        status: "confirmed",
        recordedBy: "owner",
        externalReference: null,
        verified: false,
        sourceCampaignId: null,
        sourceAdId: null,
        recordedAt: new Date(),
        createdAt: new Date(),
      }),
    },
  };
}

const input = {
  organizationId: "org_1",
  contactId: "c_1",
  opportunityId: "opp_1",
  amount: 100,
  type: "payment" as const,
  recordedBy: "owner" as const,
};

describe("PrismaRevenueStore.record tx threading", () => {
  it("writes via the passed-in tx client, not the root prisma client", async () => {
    const root = makeClient();
    const tx = makeClient();
    const store = new PrismaRevenueStore(root as never);

    await store.record(input, tx as never);

    expect(tx.lifecycleRevenueEvent.create).toHaveBeenCalledTimes(1);
    expect(root.lifecycleRevenueEvent.create).not.toHaveBeenCalled();
  });

  it("falls back to the root client when no tx is passed", async () => {
    const root = makeClient();
    const store = new PrismaRevenueStore(root as never);

    await store.record(input);

    expect(root.lifecycleRevenueEvent.create).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test prisma-revenue-store`
Expected: FAIL — `record` ignores the second arg and always uses `this.prisma`, so `tx...create` is never called.

- [ ] **Step 3: Thread the client**

In `packages/db/src/stores/prisma-revenue-store.ts`, import the client type and update `record`. Use the existing `PrismaDbClient` (already `PrismaClient | Prisma.TransactionClient`):

```ts
import type { PrismaDbClient } from "../prisma-db.js";
```

```ts
  async record(input: RecordRevenueInput, tx?: PrismaDbClient): Promise<LifecycleRevenueEvent> {
    const client = tx ?? this.prisma;
    if (input.externalReference) {
      const existing = await client.lifecycleRevenueEvent.findFirst({
        where: {
          opportunityId: input.opportunityId,
          externalReference: input.externalReference,
        },
      });
      if (existing) return mapRowToRevenueEvent(existing);
    }

    const id = randomUUID();
    const now = new Date();

    const created = await client.lifecycleRevenueEvent.create({
      // …unchanged data block…
    });

    return mapRowToRevenueEvent(created);
  }
```

(Only `this.prisma` → `client` inside `record`. Leave the read methods unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/db test prisma-revenue-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-revenue-store.ts \
        packages/db/src/stores/__tests__/prisma-revenue-store.test.ts
git commit -m "$(printf 'feat(db): thread optional tx client through PrismaRevenueStore.record (#677)\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Thread an optional tx client through `PrismaOutboxStore.write`

**Files:**

- Modify: `packages/db/src/stores/prisma-outbox-store.ts:8-17`
- Test: `packages/db/src/stores/__tests__/prisma-outbox-store.test.ts` (new or existing)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { PrismaOutboxStore } from "../prisma-outbox-store.js";

function makeClient() {
  return { outboxEvent: { create: vi.fn().mockResolvedValue({ id: "o_1" }) } };
}

describe("PrismaOutboxStore.write tx threading", () => {
  it("writes via the passed-in tx client when provided", async () => {
    const root = makeClient();
    const tx = makeClient();
    const store = new PrismaOutboxStore(root as never);

    await store.write("evt_1", "purchased", { a: 1 }, tx as never);

    expect(tx.outboxEvent.create).toHaveBeenCalledTimes(1);
    expect(root.outboxEvent.create).not.toHaveBeenCalled();
  });

  it("falls back to the root client when no tx is passed", async () => {
    const root = makeClient();
    const store = new PrismaOutboxStore(root as never);
    await store.write("evt_1", "purchased", { a: 1 });
    expect(root.outboxEvent.create).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test prisma-outbox-store`
Expected: FAIL — `write` takes only 3 params and uses `this.prisma`.

- [ ] **Step 3: Thread the client**

In `packages/db/src/stores/prisma-outbox-store.ts`:

```ts
import type { PrismaDbClient } from "../prisma-db.js";
```

```ts
  async write(
    eventId: string,
    type: string,
    payload: Record<string, unknown>,
    tx?: PrismaDbClient,
  ) {
    const client = tx ?? this.prisma;
    return client.outboxEvent.create({
      data: {
        eventId,
        type,
        payload: payload as Record<string, string | number | boolean | null>,
        status: "pending",
      },
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/db test prisma-outbox-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-outbox-store.ts \
        packages/db/src/stores/__tests__/prisma-outbox-store.test.ts
git commit -m "$(printf 'feat(db): thread optional tx client through PrismaOutboxStore.write (#677)\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: Add the opaque `StoreTransactionContext` to core's `RevenueStore`

**Files:**

- Modify: `packages/core/src/lifecycle/revenue-store.ts:1-40`
- Modify: `packages/core/src/lifecycle/index.ts` (export the new type)

- [ ] **Step 1: Define the opaque context type and widen `record`**

In `packages/core/src/lifecycle/revenue-store.ts`, above the `RevenueStore` interface:

```ts
/**
 * Opaque transaction context threaded from an app-layer `runInTransaction`
 * runner into store calls (#677 §3.2). Core never inspects or constructs it —
 * it only forwards it. The concrete Prisma narrowing (`PrismaDbClient`) lives
 * in `@switchboard/db`; core stays Prisma-free (Layer 3 must not import db).
 */
export type StoreTransactionContext = unknown;
```

Update the interface method:

```ts
export interface RevenueStore {
  record(input: RecordRevenueInput, tx?: StoreTransactionContext): Promise<LifecycleRevenueEvent>;
  findByOpportunity(orgId: string, opportunityId: string): Promise<LifecycleRevenueEvent[]>;
  findByContact(orgId: string, contactId: string): Promise<LifecycleRevenueEvent[]>;
  sumByOrg(orgId: string, dateRange?: DateRange): Promise<RevenueSummary>;
  sumByCampaign(orgId: string, dateRange?: DateRange): Promise<CampaignRevenueSummary[]>;
}
```

- [ ] **Step 2: Export the type from the lifecycle barrel**

In `packages/core/src/lifecycle/index.ts`, add to the existing `revenue-store.js` re-export:

```ts
export type { RevenueStore, RecordRevenueInput, StoreTransactionContext } from "./revenue-store.js";
```

(Match the existing export style in that file — add `StoreTransactionContext` to whatever `export type { … } from "./revenue-store.js"` line already exists; if `RevenueStore`/`RecordRevenueInput` are exported elsewhere, just add `StoreTransactionContext` alongside.)

- [ ] **Step 3: Verify typecheck (no test — pure type change)**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS. `PrismaDbClient` (used in Tasks 3–4) is structurally assignable to `unknown`, so the Prisma stores still satisfy the core interface.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/lifecycle/revenue-store.ts packages/core/src/lifecycle/index.ts
git commit -m "$(printf 'feat(core): opaque StoreTransactionContext on RevenueStore.record (#677)\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: Make the revenue handler write inside one transaction

**Files:**

- Modify: `apps/api/src/bootstrap/operator-intents/revenue.ts`
- Test: `apps/api/src/bootstrap/operator-intents/__tests__/revenue-handler.test.ts` (new; if a `revenue.test.ts` already covers the handler factory, extend it instead)

- [ ] **Step 1: Write the failing tests**

Cover: (a) both writes receive the same tx context; (b) revenue-throws → outbox not called + handler rejects; (c) success returns the event.

```ts
import { describe, it, expect, vi } from "vitest";
import { buildRecordRevenueHandler } from "../revenue.js";

const SENTINEL = { __tx: true };

function makeDeps(over?: { recordImpl?: () => Promise<unknown>; writeImpl?: () => Promise<void> }) {
  const revenueStore = {
    record: vi.fn(over?.recordImpl ?? (async () => ({ id: "rev_1" }))),
  };
  const outboxWriter = { write: vi.fn(over?.writeImpl ?? (async () => {})) };
  const runInTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(SENTINEL));
  return { revenueStore, outboxWriter, runInTransaction };
}

const workUnit = {
  organizationId: "org_1",
  parameters: {
    contactId: "c_1",
    amount: 100,
    currency: "SGD",
    type: "payment",
    recordedBy: "owner",
  },
} as never;

describe("buildRecordRevenueHandler atomicity", () => {
  it("passes the same tx context to record and outbox write", async () => {
    const { revenueStore, outboxWriter, runInTransaction } = makeDeps();
    const handler = buildRecordRevenueHandler(
      revenueStore as never,
      outboxWriter as never,
      runInTransaction,
    );

    await handler.execute(workUnit);

    expect(revenueStore.record).toHaveBeenCalledWith(expect.any(Object), SENTINEL);
    expect(outboxWriter.write).toHaveBeenCalledWith(
      "evt_rev_rev_1",
      "purchased",
      expect.any(Object),
      SENTINEL,
    );
  });

  it("does not write the outbox event when the revenue record throws", async () => {
    const { revenueStore, outboxWriter, runInTransaction } = makeDeps({
      recordImpl: async () => {
        throw new Error("record failed");
      },
    });
    const handler = buildRecordRevenueHandler(
      revenueStore as never,
      outboxWriter as never,
      runInTransaction,
    );

    await expect(handler.execute(workUnit)).rejects.toThrow("record failed");
    expect(outboxWriter.write).not.toHaveBeenCalled();
  });

  it("returns completed with the created event on success", async () => {
    const { revenueStore, outboxWriter, runInTransaction } = makeDeps();
    const handler = buildRecordRevenueHandler(
      revenueStore as never,
      outboxWriter as never,
      runInTransaction,
    );

    const result = await handler.execute(workUnit);

    expect(result.outcome).toBe("completed");
    expect(result.outputs?.event).toEqual({ id: "rev_1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test revenue-handler`
Expected: FAIL — `buildRecordRevenueHandler` takes 2 args today and does not use a transaction runner.

- [ ] **Step 3: Update the handler factory + `OutboxWriter` interface**

In `apps/api/src/bootstrap/operator-intents/revenue.ts`:

```ts
import type { RevenueStore, StoreTransactionContext } from "@switchboard/core";
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { RecordRevenueParametersSchema } from "../../routes/operator-intents-schemas.js";

/** Minimal outbox-writer surface (concrete PrismaOutboxStore wired at bootstrap). */
export interface OutboxWriter {
  write(
    eventId: string,
    type: string,
    payload: Record<string, unknown>,
    tx?: StoreTransactionContext,
  ): Promise<void>;
}

/** Runs `fn` inside a single store transaction, forwarding the opaque tx context. */
export type RunInTransaction = <T>(fn: (tx: StoreTransactionContext) => Promise<T>) => Promise<T>;

export function buildRecordRevenueHandler(
  revenueStore: RevenueStore,
  outboxWriter: OutboxWriter,
  runInTransaction: RunInTransaction,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = RecordRevenueParametersSchema.parse(workUnit.parameters);
      const resolvedOpportunityId = params.opportunityId ?? `rev-${params.contactId}-${Date.now()}`;

      const event = await runInTransaction(async (tx) => {
        const created = await revenueStore.record(
          {
            organizationId: workUnit.organizationId,
            contactId: params.contactId,
            opportunityId: resolvedOpportunityId,
            amount: params.amount,
            currency: params.currency,
            type: params.type,
            recordedBy: params.recordedBy,
            externalReference: params.externalReference ?? null,
            sourceCampaignId: params.sourceCampaignId ?? null,
            sourceAdId: params.sourceAdId ?? null,
          },
          tx,
        );
        await outboxWriter.write(
          `evt_rev_${created.id}`,
          "purchased",
          {
            type: "purchased",
            contactId: params.contactId,
            organizationId: workUnit.organizationId,
            value: params.amount,
            sourceAdId: params.sourceAdId ?? null,
            sourceCampaignId: params.sourceCampaignId ?? null,
            occurredAt: new Date().toISOString(),
            source: "revenue-api",
            metadata: {
              opportunityId: resolvedOpportunityId,
              currency: params.currency,
              revenueType: params.type,
            },
          },
          tx,
        );
        return created;
      });

      return {
        outcome: "completed" as const,
        summary: `Recorded ${params.type} of ${params.amount} ${params.currency} for contact ${params.contactId}`,
        outputs: { event },
      };
    },
  };
}
```

Note: `RevenueStore` is imported from `@switchboard/core` (Task 5 exports `StoreTransactionContext` from there too). Keep the `revenueStore: RevenueStore` param type — do NOT switch to the concrete `PrismaRevenueStore` (preserves the test-mock seam).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api test revenue-handler`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/operator-intents/revenue.ts \
        apps/api/src/bootstrap/operator-intents/__tests__/revenue-handler.test.ts
git commit -m "$(printf 'feat(api): wrap revenue record + outbox write in one transaction (#677)\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: Wire `runInTransaction` at bootstrap (app + test-server)

**Files:**

- Modify: `apps/api/src/bootstrap/operator-intents.ts` (thread `runInTransaction` through `bootstrapOperatorIntents`)
- Modify: `apps/api/src/app.ts:706-724`
- Modify: `apps/api/src/__tests__/test-server.ts:127-138, 443-452`

- [ ] **Step 1: Thread `runInTransaction` through `bootstrapOperatorIntents`**

In `apps/api/src/bootstrap/operator-intents.ts`:

- import the `RunInTransaction` type from `./operator-intents/revenue.js` (re-export it alongside `OutboxWriter` if needed);
- add `runInTransaction?: RunInTransaction;` to `OperatorIntentsBootstrapDeps`;
- gate the revenue registration on it. Update the revenue block:

```ts
if (revenueStore && outboxWriter && runInTransaction) {
  handlers.set(
    RECORD_REVENUE_INTENT,
    buildRecordRevenueHandler(revenueStore, outboxWriter, runInTransaction),
  );
}
```

and the matching `registerOperatorIntent` + `intentCount` guards (replace `revenueStore && outboxWriter` with `revenueStore && outboxWriter && runInTransaction` in all three places).

- [ ] **Step 2: Supply the real runner in `app.ts`**

In `apps/api/src/app.ts`, inside the `if (prismaClient)` block (~`:706-724`), add the runner and pass it. The outbox adapter's `write` gains a `tx` pass-through:

```ts
bootstrapOperatorIntents({
  intentRegistry,
  modeRegistry,
  opportunityStore: app.opportunityStore,
  recommendationStore: app.recommendationStore,
  disqualificationHook: app.disqualificationHook ?? undefined,
  consentService: skillModeConsentService ?? undefined,
  revenueStore: app.revenueEventStore,
  outboxWriter: {
    write: (eventId, type, payload, tx) =>
      prismaOutbox.write(eventId, type, payload, tx as never).then(() => {}),
  },
  runInTransaction: (fn) => prismaClient.$transaction((tx) => fn(tx)),
  logger: app.log,
});
```

(`tx as never` bridges the opaque `StoreTransactionContext` to the db store's `PrismaDbClient` param at the app boundary, which is allowed to know both. The `$transaction` callback's `tx` is a `Prisma.TransactionClient`, assignable to `PrismaDbClient`.)

- [ ] **Step 2b: Run a quick typecheck before touching tests**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS (test-server still compiles — `runInTransaction` is optional in the deps).

- [ ] **Step 3: Supply a sentinel runner in `test-server.ts`**

In `apps/api/src/__tests__/test-server.ts`, the `bootstrapOperatorIntents` call (~`:443`): add a default sentinel runner so the revenue intent registers whenever `revenueStore` + `outboxWriter` are provided:

```ts
bootstrapOperatorIntents({
  intentRegistry,
  modeRegistry,
  opportunityStore: app.opportunityStore ?? undefined,
  recommendationStore: app.recommendationStore,
  disqualificationHook: app.disqualificationHook ?? undefined,
  consentService: options.consentService,
  revenueStore: app.revenueEventStore ?? undefined,
  outboxWriter: options.outboxWriter,
  runInTransaction: options.runInTransaction ?? (async (fn) => fn(undefined)),
});
```

Add `runInTransaction?: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;` to `BuildTestServerOptions` (near the `revenueStore`/`outboxWriter` options ~`:135-138`), documenting that the default no-op runner invokes the callback with `undefined`, so mock stores fall back to their root client / ignore the tx.

- [ ] **Step 4: Run the api suite + typecheck**

Run: `pnpm --filter @switchboard/api typecheck && pnpm --filter @switchboard/api test`
Expected: PASS (existing `revenue-ingress.test.ts` still green — it injects its own `revenueStore` + `outboxWriter` and now picks up the default sentinel runner).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/operator-intents.ts apps/api/src/app.ts apps/api/src/__tests__/test-server.ts
git commit -m "$(printf 'feat(api): inject runInTransaction into revenue intent bootstrap (#677)\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 8: Success-path + rollback coverage through the route

**Files:**

- Modify: `apps/api/src/routes/__tests__/revenue-ingress.test.ts`

- [ ] **Step 1: Add the success-path both-rows assertion**

Using the existing `buildTestServer` revenue harness, assert that on a successful POST the injected `outboxWriter.write` was called with `evt_rev_<id>` / `"purchased"`. (The harness already lets tests pass their own `revenueStore` + `outboxWriter` mocks; assert on the outbox mock's call args.)

```ts
it("emits the purchased outbox event keyed evt_rev_<id> on success", async () => {
  const writes: Array<{ eventId: string; type: string }> = [];
  const outboxWriter = {
    write: async (eventId: string, type: string) => {
      writes.push({ eventId, type });
    },
  };
  // build server with a revenueStore mock returning { id: "rev_abc" } and this outboxWriter
  // …POST /api/revenue with a valid body + Idempotency-Key…
  expect(writes).toEqual([{ eventId: "evt_rev_rev_abc", type: "purchased" }]);
});
```

- [ ] **Step 2: Add a tx-scope rollback assertion (no-Postgres unit level)**

Inject a runner that only "commits" recorded writes if the callback resolves, and a revenueStore whose `record` resolves but an `outboxWriter.write` that throws. Assert the route 500s AND a `failed` WorkTrace was persisted (via the harness `lastIngressTrace` seam — this is PR-1 composing with PR-2). True DB-level rollback is covered by the Postgres-gated integration test in Step 3.

```ts
it("rolls back both writes and persists a failed WorkTrace when the outbox write throws", async () => {
  const committed: string[] = [];
  const runInTransaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const staged: string[] = [];
    const tx = { stage: (id: string) => staged.push(id) };
    const out = await fn(tx); // throws → staged discarded
    committed.push(...staged);
    return out;
  };
  const revenueStore = {
    record: async (_input: unknown, tx: { stage: (id: string) => void }) => {
      tx.stage("revenue");
      return { id: "rev_x" };
    },
    // …other methods stubbed…
  };
  const outboxWriter = {
    write: async (_e: string, _t: string, _p: unknown, tx: { stage: (id: string) => void }) => {
      tx.stage("outbox");
      throw new Error("outbox down");
    },
  };
  // build server with these + runInTransaction; POST /api/revenue with Idempotency-Key
  // expect HTTP 500 (scrubbed), committed === [] (both staged writes discarded),
  // and the harness lastIngressTrace.outcome === "failed" with error.code "EXECUTION_EXCEPTION".
});
```

- [ ] **Step 3: (Postgres-gated) real-transaction rollback integration test**

Add an integration test (same `describe.skipIf(!process.env.DATABASE_URL)` guard pattern the existing Postgres-dependent tests use) that runs against a real `PrismaClient.$transaction`, forces the outbox `create` to throw mid-transaction, and asserts **no** `LifecycleRevenueEvent` row was committed. This is the only test that proves true atomicity; it is expected to be skipped in the no-Postgres CI lane (like the `prisma-*-integrity` tests).

- [ ] **Step 4: Run the api suite**

Run: `pnpm --filter @switchboard/api test revenue-ingress`
Expected: PASS (the Postgres-gated test skips without `DATABASE_URL`).

- [ ] **Step 5: Commit + open PR-2**

```bash
git add apps/api/src/routes/__tests__/revenue-ingress.test.ts
git commit -m "$(printf 'test(api): revenue transactional-outbox success + rollback coverage (#677)\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
git push -u origin <pr2-branch>
gh pr create --base main --title "feat(api,db): revenue transactional outbox (#677)" \
  --body "PR-2 of #677. record + outbox write now share one prisma.\$transaction via an injected runInTransaction runner. Spec §3. Reviewed as an atomicity fix."
gh pr merge <pr#> --squash --auto
```

---

## Self-review (spec coverage)

- Spec §2.1–2.2 (try/catch, rethrow, code) → Task 1. §2.3 (distinct code, not in OPERATOR_INTENT_ERROR_CODES) → Task 1 Step 5 comment + Task 2 domain-unchanged test. §2.4 (persist cannot mask) → Task 1 comment + Task 2 persist-mask test. §2.5 (idempotency replay) → Task 2 replay test. §2.6 (type widening) → Task 1 Steps 3–4.
- Spec §3.1 (atomicity contract) → Tasks 6–8. §3.2 (opaque `StoreTransactionContext`, Prisma stays in db/app) → Task 5 + `PrismaDbClient` in Tasks 3–4. §3.3 (injected runner, app real / test sentinel) → Tasks 6–7. §3.4 (deterministic key out of scope) → unchanged; not touched. §3.5 (composition with Part 1) → Task 8 Step 2.
- Spec §4.1 tests (4) → Tasks 1–2. §4.2 tests (4): threading → Task 6; rollback → Task 8 Steps 2–3; record-throws-no-outbox → Task 6; success both rows → Task 8 Step 1.
- Spec §5 sequencing (PR-1 then PR-2, both migration-free) → plan structure.

No placeholders remain except the deliberately-abbreviated `// …` inside test bodies where the surrounding harness (`buildTestServer`) is established and re-shown in the referenced files; the executing worker reads `revenue-ingress.test.ts` for the exact server-build call.
