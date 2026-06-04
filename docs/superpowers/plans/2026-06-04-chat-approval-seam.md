# Chat-Surface Approval Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No approve leg anywhere ends in bare `approveLifecycle`: the lifecycle fork of `respondToApproval` drives the same frozen-payload -> dispatch -> recovery chain as `respondToParkedLifecycle`, and the chat gateway replies honestly (ran-or-queued vs approved-but-did-not-run vs partial quorum) with a lifecycle fallback when the approval row is missing.

**Architecture:** Extract the invariant-bearing dispatch leg out of `respond-to-parked-lifecycle.ts` into `lifecycle-dispatch.ts`; rebuild `respondViaLifecycle` (moved to its own module `respond-via-lifecycle.ts`) in lifecycle-authority order around it, fixing the quorum bypass and the patch dead-end; extend `handleApprovalResponse` with honest reply mapping and a #877-style lifecycle fallback; prove the chat entry end to end through the #879 harness. Spec: `docs/superpowers/specs/2026-06-04-chat-approval-seam-design.md`.

**Tech Stack:** TypeScript ESM (`.js` relative imports), vitest, pnpm + Turborepo. Core tests use `InMemoryLifecycleStore`; no Postgres in CI.

**Delivery:** three sequential PRs off origin/main, each merged before the next branches. Never stack remotely. Full green gate before each push: `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check && pnpm arch:check`. Known full-suite flakes (rerun once before investigating): @switchboard/chat gateway-bridge-attribution, pg_advisory, bootstrap-smoke, api-auth prod-hardening.

---

## File structure

PR-1 `feat/approval-respond-unification` (core + api):

- Create: `packages/core/src/approval/lifecycle-dispatch.ts` (shared engine: `ExecuteApprovedLike`, `LifecycleDispatchDeps`, `writeApprovedPayloadToTrace`, `runDispatch`, `markRecoveryRequired`)
- Create: `packages/core/src/approval/respond-via-lifecycle.ts` (the rebuilt fork legs + `getWorkTrace` + `reconstructWorkUnit`)
- Create: `packages/core/src/approval/__tests__/respond-via-lifecycle.test.ts` (fork suite over a REAL `ApprovalLifecycleService`; absorbs the three self-approval cases)
- Modify: `packages/core/src/approval/respond-to-parked-lifecycle.ts` (import the moved functions; re-export `ExecuteApprovedLike`)
- Modify: `packages/core/src/approval/respond-to-approval.ts` (delegate fork to the new module; `auditLedger?` dep; `executionResult: ExecuteResult | null`)
- Delete: `packages/core/src/approval/__tests__/respond-to-approval-self-approval.test.ts` (cases absorbed; see Task 5)
- Modify: `apps/api/src/routes/approvals.ts` (pass `auditLedger`)

PR-2 `feat/chat-approval-honest-replies` (channel-gateway only):

- Modify: `packages/core/src/channel-gateway/handle-approval-response.ts` (reply mapping, new constants, error mapping, lifecycle fallback leg)
- Modify: `packages/core/src/channel-gateway/__tests__/handle-approval-response.test.ts` (real-lifecycle fixtures + new cases)

PR-3 `test/chat-approval-loop-proof` (api test layer only):

- Modify: `apps/api/src/__tests__/recommendation-handoff-harness.ts` (move `buildLifecycleWorld` here from the #879 test)
- Modify: `apps/api/src/__tests__/recommendation-handoff-approval-loop.test.ts` (import `buildLifecycleWorld` from the harness)
- Create: `apps/api/src/__tests__/chat-approval-loop.test.ts` (chat entry end to end)

---

## PR-1: core respond unification

### Task 1: Branch and baseline

- [ ] **Step 1.1: Branch off current origin/main**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/chat-approval-seam
git fetch origin && git checkout -B feat/approval-respond-unification origin/main
git branch --show-current   # expect: feat/approval-respond-unification
```

- [ ] **Step 1.2: Baseline the two respond suites**

```bash
pnpm --filter @switchboard/core test -- src/approval/__tests__/respond-to-parked-lifecycle.test.ts src/approval/__tests__/respond-to-approval-self-approval.test.ts
```

Expected: PASS (13 + 3 cases).

### Task 2: Extract the shared dispatch engine (pure refactor, proven by the untouched 13-case suite)

**Files:**

- Create: `packages/core/src/approval/lifecycle-dispatch.ts`
- Modify: `packages/core/src/approval/respond-to-parked-lifecycle.ts`

- [ ] **Step 2.1: Create `lifecycle-dispatch.ts`**

```ts
// ---------------------------------------------------------------------------
// Shared lifecycle dispatch engine
// ---------------------------------------------------------------------------
//
// The invariant-bearing leg of every approve path: once a lifecycle is
// approved, the system MUST either execute the frozen payload or expose the
// failed execution for recovery (status "recovery_required"). Extracted from
// respond-to-parked-lifecycle.ts so the legacy-row fork
// (respond-via-lifecycle.ts) drives the SAME chain.
//
// CONTRACT (parked-approvals spec 4.1/4.2/4.4; chat-approval-seam spec 2.1):
// - writeApprovedPayloadToTrace commits ExecutableWorkUnit.frozenPayload
//   .parameters onto the WorkTrace (canonical persistence) BEFORE dispatch.
//   executeApproved dispatches FROM the trace, so by construction it executes
//   exactly the approved payload.
// - runDispatch creates a durable DispatchRecord with the deterministic
//   idempotency key `lifecycle-dispatch:<lifecycleId>:<revisionId>:attempt-<n>`
//   (the double-dispatch lock per attempt), then executeApproved, then
//   recordDispatchOutcome. Dispatch failure (throw OR success:false)
//   transitions the lifecycle to "recovery_required" so the operator gets a
//   Retry card; approved governed work must never vanish into logs.

import type { ExecuteResult, ExecutableWorkUnit } from "@switchboard/schemas";
import type { ApprovalLifecycleService } from "./lifecycle-service.js";
import type { LifecycleRecord } from "./lifecycle-types.js";
import type { WorkTraceStore } from "../platform/work-trace-recorder.js";

export interface ExecuteApprovedLike {
  executeApproved(workUnitId: string): Promise<ExecuteResult>;
}

export interface LifecycleDispatchDeps {
  lifecycleService: ApprovalLifecycleService;
  workTraceStore: WorkTraceStore;
  platformLifecycle: ExecuteApprovedLike;
  logger: {
    info(obj: Record<string, unknown>, msg: string): void;
    error(obj: Record<string, unknown>, msg: string): void;
  };
}

/**
 * Payload authority (spec 4.1): the trace MUST carry the approved frozen
 * payload before dispatch. Throws when the trace store rejects the update
 * (integrity-locked trace): the lifecycle stays approved but undispatched;
 * the store's own audit + operator alert is the operator-facing record.
 */
export async function writeApprovedPayloadToTrace(args: {
  deps: Pick<LifecycleDispatchDeps, "workTraceStore">;
  lifecycle: LifecycleRecord;
  executableWorkUnit: ExecutableWorkUnit;
  fallbackParameters: Record<string, unknown>;
  approvalOutcome: "approved" | "patched";
  respondedBy: string;
  respondedAt: string;
  caller: string;
}): Promise<void> {
  const { deps, lifecycle, executableWorkUnit } = args;
  const frozenParameters =
    (executableWorkUnit.frozenPayload["parameters"] as Record<string, unknown> | undefined) ??
    args.fallbackParameters;
  const traceUpdate = await deps.workTraceStore.update(
    lifecycle.actionEnvelopeId,
    {
      parameters: frozenParameters,
      approvalOutcome: args.approvalOutcome,
      approvalRespondedBy: args.respondedBy,
      approvalRespondedAt: args.respondedAt,
    },
    {
      caller: args.caller,
      organizationId: lifecycle.organizationId ?? undefined,
    },
  );
  if (!traceUpdate.ok) {
    throw new Error(`WorkTrace update rejected before dispatch: ${traceUpdate.reason}`);
  }
}

export async function runDispatch(
  deps: LifecycleDispatchDeps,
  lifecycle: LifecycleRecord,
  executableWorkUnitId: string,
  revisionId: string,
): Promise<ExecuteResult> {
  const { lifecycleService, platformLifecycle } = deps;
  const attemptNumber = (await lifecycleService.countDispatchAttempts(executableWorkUnitId)) + 1;
  const { dispatchRecord } = await lifecycleService.prepareDispatch({
    lifecycleId: lifecycle.id,
    executableWorkUnitId,
    idempotencyKey: `lifecycle-dispatch:${lifecycle.id}:${revisionId}:attempt-${attemptNumber}`,
    attemptNumber,
  });

  const startedAt = Date.now();
  let executionResult: ExecuteResult;
  try {
    // CONTRACT (spec 4.2): executeApproved takes the ORIGINAL WorkUnit id and
    // dispatches from the WorkTrace, which now carries the frozen payload (4.1).
    executionResult = await platformLifecycle.executeApproved(lifecycle.actionEnvelopeId);
  } catch (err) {
    await lifecycleService.recordDispatchOutcome({
      dispatchRecordId: dispatchRecord.id,
      state: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    await markRecoveryRequired(deps, lifecycle.id);
    throw err;
  }
  await lifecycleService.recordDispatchOutcome({
    dispatchRecordId: dispatchRecord.id,
    state: executionResult.success ? "succeeded" : "failed",
    outcome: executionResult.summary,
    ...(executionResult.success ? {} : { errorMessage: executionResult.summary }),
    durationMs: Date.now() - startedAt,
  });
  if (!executionResult.success) {
    await markRecoveryRequired(deps, lifecycle.id);
  }
  return executionResult;
}

/**
 * Review #3 (parked spec): an approved action whose dispatch failed must come
 * BACK to the operator (as a Retry card), never vanish into logs.
 */
export async function markRecoveryRequired(
  deps: Pick<LifecycleDispatchDeps, "lifecycleService" | "logger">,
  lifecycleId: string,
): Promise<void> {
  const fresh = await deps.lifecycleService.getLifecycleById(lifecycleId);
  if (!fresh || fresh.status !== "approved") return;
  try {
    await deps.lifecycleService.transitionStatus(fresh, "recovery_required");
  } catch (err) {
    deps.logger.error(
      { lifecycleId, err: err instanceof Error ? err.message : String(err) },
      "Failed to mark lifecycle recovery_required",
    );
  }
}
```

- [ ] **Step 2.2: Rewire `respond-to-parked-lifecycle.ts` onto the extraction**

In `packages/core/src/approval/respond-to-parked-lifecycle.ts`:

1. Replace the local `ExecuteApprovedLike` interface with a re-export:

```ts
import {
  runDispatch,
  markRecoveryRequired,
  writeApprovedPayloadToTrace,
  type ExecuteApprovedLike,
} from "./lifecycle-dispatch.js";

export type { ExecuteApprovedLike } from "./lifecycle-dispatch.js";
```

(`RespondToParkedLifecycleDeps` keeps its shape; it structurally satisfies `LifecycleDispatchDeps`.)

2. Delete the local `runDispatch` and `markRecoveryRequired` functions (moved verbatim in Step 2.1).

3. Replace the inline frozen-payload trace write (the block from `const frozenParameters =` through the `if (!traceUpdate.ok) throw` close) with:

```ts
await writeApprovedPayloadToTrace({
  deps: { workTraceStore },
  lifecycle: approved,
  executableWorkUnit,
  fallbackParameters: workUnit.parameters,
  approvalOutcome: "approved",
  respondedBy: params.respondedBy,
  respondedAt,
  caller: "respond_to_parked_lifecycle",
});
```

Note the call sites of `runDispatch(deps, ...)` inside this file keep passing the module's own `deps` object unchanged (structural subtype).

4. Remove now-unused imports (`ExecuteResult` stays: it types the result interface).

- [ ] **Step 2.3: Run the parked suite UNCHANGED to prove the refactor**

```bash
pnpm --filter @switchboard/core test -- src/approval/__tests__/respond-to-parked-lifecycle.test.ts
```

Expected: PASS, all 13 cases, zero edits to the test file. Then `git diff --stat packages/core/src/approval/__tests__/respond-to-parked-lifecycle.test.ts` prints nothing.

- [ ] **Step 2.4: Commit**

```bash
pnpm --filter @switchboard/core build && pnpm --filter @switchboard/core typecheck
git add packages/core/src/approval/lifecycle-dispatch.ts packages/core/src/approval/respond-to-parked-lifecycle.ts
git commit -m "refactor(core): extract shared lifecycle dispatch engine

Moves runDispatch, markRecoveryRequired, and the frozen-payload trace
write out of respond-to-parked-lifecycle into lifecycle-dispatch so the
legacy-row respond fork can drive the same approve-to-dispatch chain.
Pure move: the 13-case parked suite passes without edits."
```

### Task 3: RED suite for the unified fork

**Files:**

- Create: `packages/core/src/approval/__tests__/respond-via-lifecycle.test.ts`

- [ ] **Step 3.1: Write the failing fork suite**

The suite drives `respondToApproval` (the public entry) with a REAL `ApprovalLifecycleService` over `InMemoryLifecycleStore`, an in-memory trace store, literal approval/envelope stores, and a spy `executeApproved`. Full file:

```ts
// ---------------------------------------------------------------------------
// Unified lifecycle fork: approve/patch drive the SAME frozen-payload ->
// dispatch -> recovery chain as respondToParkedLifecycle (chat-approval-seam
// spec sections 2.2/2.3). Also pins the four-eyes guard (absorbed from
// respond-to-approval-self-approval.test.ts) and the quorum no-bypass fix.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { ApprovalLifecycleService, InMemoryLifecycleStore } from "../index.js";
import {
  respondToApproval,
  type RespondToApprovalDeps,
  type ApprovalRecordForResponse,
} from "../respond-to-approval.js";
import type { WorkTrace } from "../../platform/work-trace.js";
import type { ExecuteResult } from "@switchboard/schemas";

const ORG = "org-1";
const WORK_UNIT_ID = "env-1";

function makeTrace(originatorId: string, parameters: Record<string, unknown>): WorkTrace {
  return {
    workUnitId: WORK_UNIT_ID,
    requestedAt: new Date().toISOString(),
    organizationId: ORG,
    actor: { id: originatorId, type: "user" },
    intent: "test.action",
    parameters,
    deploymentContext: {
      deploymentId: "dep-1",
      skillSlug: "s",
      trustLevel: "supervised",
      trustScore: 0,
    },
    mode: "skill",
    traceId: "trace-1",
    trigger: "api",
    governanceConstraints: {},
  } as unknown as WorkTrace;
}

function okResult(): ExecuteResult {
  return {
    success: true,
    summary: "handler ran",
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: 1,
    undoRecipe: null,
  };
}

function failedResult(): ExecuteResult {
  return { ...okResult(), success: false, summary: "handler failed" };
}

async function makeWorld(opts?: {
  originatorId?: string;
  traceParameters?: Record<string, unknown>;
  quorum?: { required: number };
  executeApproved?: ReturnType<typeof vi.fn>;
  selfApprovalAllowed?: boolean;
  withAuditLedger?: boolean;
}) {
  const originatorId = opts?.originatorId ?? "user-orig";
  const traceParameters = opts?.traceParameters ?? { campaignId: "camp-1" };

  const store = new InMemoryLifecycleStore();
  const lifecycleService = new ApprovalLifecycleService({ store });
  const { lifecycle, revision } = await lifecycleService.createGatedLifecycle({
    actionEnvelopeId: WORK_UNIT_ID,
    organizationId: ORG,
    expiresAt: new Date(Date.now() + 3_600_000),
    initialRevision: {
      parametersSnapshot: traceParameters,
      approvalScopeSnapshot: {},
      bindingHash: "hash-rev-1",
      createdBy: originatorId,
    },
  });

  let trace = makeTrace(originatorId, traceParameters);
  const traceUpdates: Array<Record<string, unknown>> = [];
  const workTraceStore = {
    getByWorkUnitId: vi.fn(async (id: string) =>
      id === WORK_UNIT_ID ? { trace, integrity: { status: "ok" } } : null,
    ),
    update: vi.fn(async (_id: string, fields: Partial<WorkTrace>) => {
      trace = { ...trace, ...fields } as WorkTrace;
      traceUpdates.push(fields as Record<string, unknown>);
      return { ok: true, trace };
    }),
  };

  let envelope: { id: string; status: string } | null = {
    id: WORK_UNIT_ID,
    status: "pending_approval",
  };
  const envelopeStore = {
    getById: vi.fn(async () => envelope),
    update: vi.fn(async (_id: string, fields: { status?: string }) => {
      if (envelope) envelope = { ...envelope, ...fields };
      return envelope;
    }),
    save: vi.fn(),
  };

  const approvalUpdates: Array<{ status: string; version: number }> = [];
  const approvalStore = {
    save: vi.fn(),
    getById: vi.fn(),
    updateState: vi.fn(async (_id: string, newState: { status: string; version: number }) => {
      approvalUpdates.push({ status: newState.status, version: newState.version });
    }),
    listPending: vi.fn(),
  };

  const executeApproved = opts?.executeApproved ?? vi.fn(async () => okResult());
  const ledgerEvents: Array<{ eventType: string }> = [];
  const auditLedger = opts?.withAuditLedger
    ? ({
        record: vi.fn(async (e: { eventType: string }) => {
          ledgerEvents.push(e);
        }),
      } as never)
    : undefined;

  const deps = {
    approvalStore,
    envelopeStore,
    workTraceStore,
    lifecycleService,
    platformLifecycle: { respondToApproval: vi.fn(), executeApproved },
    sessionManager: null,
    logger: { info: vi.fn(), error: vi.fn() },
    selfApprovalAllowed: opts?.selfApprovalAllowed,
    auditLedger,
  } as unknown as RespondToApprovalDeps;

  const approval: ApprovalRecordForResponse = {
    request: {
      id: "appr-1",
      actionId: "act-1",
      createdAt: new Date(),
      bindingHash: revision.bindingHash,
    } as never,
    state: {
      status: "pending",
      version: 0,
      expiresAt: new Date(Date.now() + 3_600_000),
      respondedBy: null,
      respondedAt: null,
      patchValue: null,
      quorum: opts?.quorum ? { required: opts.quorum.required, approvalHashes: [] } : null,
    } as never,
    envelopeId: WORK_UNIT_ID,
    organizationId: ORG,
  };

  return {
    deps,
    approval,
    lifecycle,
    revision,
    lifecycleService,
    store,
    executeApproved,
    workTraceStore,
    approvalStore,
    approvalUpdates,
    traceUpdates,
    envelopeStore,
    getEnvelope: () => envelope,
    getTrace: () => trace,
    ledgerEvents,
  };
}

function approveParams(bindingHash: string) {
  return {
    approvalId: "appr-1",
    action: "approve" as const,
    respondedBy: "operator-jane",
    bindingHash,
  };
}

describe("respondToApproval lifecycle fork: unified dispatch chain", () => {
  it("approve drives approveLifecycle -> frozen payload -> envelope approved -> dispatch -> ExecuteResult", async () => {
    const w = await makeWorld();
    const result = await respondToApproval(
      w.deps,
      approveParams(w.revision.bindingHash),
      w.approval,
    );

    // THE HANDLER RAN (the invariant), with the original work unit id
    expect(w.executeApproved).toHaveBeenCalledWith(WORK_UNIT_ID);
    // executionResult is the real ExecuteResult, not { executableWorkUnitId }
    expect(result.executionResult).toMatchObject({ success: true, summary: "handler ran" });
    // lifecycle approved
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("approved");
    // frozen payload + approval fields written onto the trace BEFORE dispatch
    expect(w.getTrace().approvalOutcome).toBe("approved");
    expect(w.getTrace().approvalRespondedBy).toBe("operator-jane");
    // envelope flipped to approved (executeAfterApproval admission gate)
    expect(w.getEnvelope()?.status).toBe("approved");
    // legacy row synced as a side record
    expect(w.approvalUpdates).toEqual([{ status: "approved", version: 1 }]);
    // durable dispatch record, attempt 1, succeeded, deterministic key
    const records = w.store.listDispatchRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ attemptNumber: 1, state: "succeeded" });
    expect(records[0]?.idempotencyKey).toBe(
      `lifecycle-dispatch:${w.lifecycle.id}:${w.revision.id}:attempt-1`,
    );
  });

  it("payload authority: dispatch happens from the APPROVED revision snapshot, not stale trace params", async () => {
    const w = await makeWorld({ traceParameters: { campaignId: "approved" } });
    // Sabotage: the trace drifts AFTER the revision snapshot was taken
    (w.getTrace() as { parameters: Record<string, unknown> }).parameters = {
      campaignId: "old",
    };
    await respondToApproval(w.deps, approveParams(w.revision.bindingHash), w.approval);
    // The frozen payload (revision snapshot) was committed onto the trace pre-dispatch
    expect(w.getTrace().parameters).toEqual({ campaignId: "approved" });
    const payloadWrite = w.traceUpdates.find((u) => "parameters" in u);
    expect(payloadWrite?.["parameters"]).toEqual({ campaignId: "approved" });
  });

  it("dispatch returning success:false transitions the lifecycle to recovery_required", async () => {
    const w = await makeWorld({ executeApproved: vi.fn(async () => failedResult()) });
    const result = await respondToApproval(
      w.deps,
      approveParams(w.revision.bindingHash),
      w.approval,
    );
    expect(result.executionResult).toMatchObject({ success: false });
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe(
      "recovery_required",
    );
    expect(w.store.listDispatchRecords()[0]?.state).toBe("failed");
  });

  it("dispatch THROW records a failed dispatch, transitions to recovery_required, and rethrows", async () => {
    const w = await makeWorld({
      executeApproved: vi.fn(async () => {
        throw new Error("mode handler exploded");
      }),
    });
    await expect(
      respondToApproval(w.deps, approveParams(w.revision.bindingHash), w.approval),
    ).rejects.toThrow(/mode handler exploded/);
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe(
      "recovery_required",
    );
    expect(w.store.listDispatchRecords()[0]?.state).toBe("failed");
  });

  it("quorum 1-of-2 approve records a partial approval and does NOT touch the lifecycle", async () => {
    const w = await makeWorld({ quorum: { required: 2 } });
    const result = await respondToApproval(
      w.deps,
      approveParams(w.revision.bindingHash),
      w.approval,
    );
    expect(result.executionResult).toBeNull();
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("pending");
    expect(w.approvalUpdates).toHaveLength(1);
    expect(w.store.listDispatchRecords()).toHaveLength(0);
  });

  it("a stale binding hash refuses the approve and mutates nothing", async () => {
    const w = await makeWorld();
    await expect(
      respondToApproval(w.deps, approveParams("hash-stale"), w.approval),
    ).rejects.toThrow(/stale binding/i);
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("pending");
    expect(w.approvalUpdates).toHaveLength(0);
    expect(w.getEnvelope()?.status).toBe("pending_approval");
  });

  it("legacy-row sync failure after the authority commit does NOT prevent dispatch", async () => {
    const w = await makeWorld();
    (w.approvalStore.updateState as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("legacy row version race"),
    );
    const result = await respondToApproval(
      w.deps,
      approveParams(w.revision.bindingHash),
      w.approval,
    );
    expect(result.executionResult).toMatchObject({ success: true });
    expect(w.executeApproved).toHaveBeenCalledTimes(1);
  });

  it("patch creates a new revision and dispatches the PATCHED payload (payload authority on the patch path)", async () => {
    const w = await makeWorld({ traceParameters: { campaignId: "old", budget: 5 } });
    const result = await respondToApproval(
      w.deps,
      {
        approvalId: "appr-1",
        action: "patch",
        respondedBy: "operator-jane",
        bindingHash: w.revision.bindingHash,
        patchValue: { campaignId: "patched" },
      },
      w.approval,
    );
    // dispatched, and the dispatched payload is the patched one
    expect(w.executeApproved).toHaveBeenCalledWith(WORK_UNIT_ID);
    expect(result.executionResult).toMatchObject({ success: true });
    expect(w.getTrace().parameters).toEqual({ campaignId: "patched", budget: 5 });
    expect(w.getTrace().approvalOutcome).toBe("patched");
    // a second revision exists and is the dispatch authority
    const current = await w.lifecycleService.getCurrentRevision(w.lifecycle.id);
    expect(current?.parametersSnapshot).toEqual({ campaignId: "patched", budget: 5 });
    expect(current?.id).not.toBe(w.revision.id);
    // approvalState carries the NEW binding hash (client parity with the old fork)
    expect((result.approvalState as { bindingHash?: string }).bindingHash).toBe(
      current?.bindingHash,
    );
    // legacy row recorded the terminal patch response
    expect(w.approvalUpdates).toEqual([{ status: "patched", version: 1 }]);
  });

  it("a patch with a stale source binding hash dies at createRevision and mutates nothing", async () => {
    const w = await makeWorld();
    await expect(
      respondToApproval(
        w.deps,
        {
          approvalId: "appr-1",
          action: "patch",
          respondedBy: "operator-jane",
          bindingHash: "hash-stale",
          patchValue: { campaignId: "patched" },
        },
        w.approval,
      ),
    ).rejects.toThrow(/stale binding/i);
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("pending");
  });

  it("reject drives rejectLifecycle and the envelope to denied, no dispatch", async () => {
    const w = await makeWorld();
    const result = await respondToApproval(
      w.deps,
      {
        approvalId: "appr-1",
        action: "reject",
        respondedBy: "operator-jane",
        bindingHash: w.revision.bindingHash,
      },
      w.approval,
    );
    expect(result.executionResult).toBeNull();
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("rejected");
    expect(w.getEnvelope()?.status).toBe("denied");
  });

  it("records action.approved in the audit ledger when one is provided", async () => {
    const w = await makeWorld({ withAuditLedger: true });
    await respondToApproval(w.deps, approveParams(w.revision.bindingHash), w.approval);
    expect(w.ledgerEvents.map((e) => e.eventType)).toContain("action.approved");
  });

  // --- four-eyes (absorbed from respond-to-approval-self-approval.test.ts) ---

  it("rejects self-approval (responder === action originator) without mutating or executing", async () => {
    const w = await makeWorld({ originatorId: "operator-jane" });
    await expect(
      respondToApproval(w.deps, approveParams(w.revision.bindingHash), w.approval),
    ).rejects.toThrow(/self-approval/i);
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect(w.approvalUpdates).toHaveLength(0);
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("pending");
  });

  it("allows a different principal to approve (no false block)", async () => {
    const w = await makeWorld({ originatorId: "user-orig" });
    const result = await respondToApproval(
      w.deps,
      approveParams(w.revision.bindingHash),
      w.approval,
    );
    expect(result.executionResult).toMatchObject({ success: true });
  });

  it("honors the selfApprovalAllowed escape hatch", async () => {
    const w = await makeWorld({ originatorId: "operator-jane", selfApprovalAllowed: true });
    const result = await respondToApproval(
      w.deps,
      approveParams(w.revision.bindingHash),
      w.approval,
    );
    expect(result.executionResult).toMatchObject({ success: true });
  });
});
```

- [ ] **Step 3.2: Run to verify RED**

```bash
pnpm --filter @switchboard/core test -- src/approval/__tests__/respond-via-lifecycle.test.ts
```

Expected: FAIL. The unified-chain cases fail because the current fork returns `{ executableWorkUnitId }` and never calls `executeApproved`; the quorum case fails because the lifecycle gets approved; the patch case fails because nothing dispatches. The self-approval trio passes (guard already exists). Record which cases are red.

- [ ] **Step 3.3: Commit the red suite**

```bash
git add packages/core/src/approval/__tests__/respond-via-lifecycle.test.ts
git commit -m "test(core): red suite for the unified lifecycle respond fork"
```

### Task 4: Implement the unified fork

**Files:**

- Create: `packages/core/src/approval/respond-via-lifecycle.ts`
- Modify: `packages/core/src/approval/respond-to-approval.ts`

- [ ] **Step 4.1: Create `respond-via-lifecycle.ts`**

```ts
// ---------------------------------------------------------------------------
// Lifecycle-backed respond fork (legacy ApprovalRequest row + ApprovalLifecycle
// row for the same work unit)
// ---------------------------------------------------------------------------
//
// Extracted from respond-to-approval.ts and rebuilt in LIFECYCLE-AUTHORITY
// order (chat-approval-seam spec 2.2/2.3): approveLifecycle is the authority
// commit; every later step fails TOWARD dispatch-or-recovery, never away from
// it. The legacy ApprovalRequest row is a side record on this path: its sync
// happens after the authority commit and is best-effort (logged skew, never an
// abort). Approve and patch both end in the shared dispatch engine
// (lifecycle-dispatch.ts); patch keeps the legacy surface contract
// (patch responds AND executes) with revision-grade payload authority.

import type { ExecuteResult } from "@switchboard/schemas";
import type { ApprovalLifecycleService } from "./lifecycle-service.js";
import type { LifecycleRecord } from "./lifecycle-types.js";
import type { WorkTrace } from "../platform/work-trace.js";
import type { WorkTraceStore } from "../platform/work-trace-recorder.js";
import type { DeploymentContext } from "../platform/deployment-context.js";
import type { WorkUnit } from "../platform/work-unit.js";
import type { ApprovalStore, EnvelopeStore } from "../storage/interfaces.js";
import type { AuditLedger } from "../audit/ledger.js";
import { transitionApproval } from "./state-machine.js";
import { computeBindingHash, hashObject } from "./binding.js";
import {
  runDispatch,
  writeApprovedPayloadToTrace,
  type ExecuteApprovedLike,
} from "./lifecycle-dispatch.js";
import type { RespondToApprovalLogger, RespondToApprovalParams } from "./respond-to-approval.js";
import type { ApprovalRecordForResponse } from "./respond-to-approval.js";

export interface RespondViaLifecycleDeps {
  lifecycleService: ApprovalLifecycleService;
  approvalStore: ApprovalStore;
  envelopeStore: EnvelopeStore;
  workTraceStore: WorkTraceStore | null;
  platformLifecycle: ExecuteApprovedLike;
  auditLedger?: AuditLedger;
  logger: RespondToApprovalLogger;
}

export async function respondViaLifecycle(args: {
  deps: RespondViaLifecycleDeps;
  lifecycle: LifecycleRecord;
  approval: ApprovalRecordForResponse;
  params: RespondToApprovalParams;
}): Promise<{ envelope: unknown; approvalState: unknown; executionResult: ExecuteResult | null }> {
  const { deps, lifecycle, approval, params } = args;

  if (params.action === "reject") {
    return rejectViaLifecycle(deps, lifecycle, approval, params);
  }

  // PURE compute: throws on a non-pending legacy row (already-responded guard).
  // Persisted only AFTER the lifecycle authority commit (or immediately for a
  // quorum partial, which never touches the lifecycle).
  const newState = transitionApproval(
    approval.state,
    params.action,
    params.respondedBy,
    params.patchValue,
  );

  // Quorum short-circuit: a partial approval is recorded on the legacy row
  // only. The lifecycle stays pending; nothing materializes, nothing runs.
  if (params.action === "approve" && newState.status !== "approved") {
    await deps.approvalStore.updateState(
      approval.request.id,
      newState,
      approval.state.version,
      approval.organizationId ?? null,
    );
    deps.logger.info(
      { lifecycleId: lifecycle.id, approvalId: approval.request.id },
      "Partial quorum approval recorded; lifecycle untouched",
    );
    return { envelope: null, approvalState: newState, executionResult: null };
  }

  const trace = await getWorkTrace(deps.workTraceStore, approval.envelopeId);
  const workUnit = reconstructWorkUnit(trace, approval);
  const respondedAt = new Date().toISOString();

  // Patch first parks the patched payload as a NEW revision; the approve
  // commits to it. createRevision validates sourceBindingHash against the
  // current revision, so a stale patch dies before any mutation beyond the
  // revision row itself.
  let clientBindingHash = params.bindingHash;
  let patchedBindingHash: string | null = null;
  if (params.action === "patch") {
    if (!params.patchValue) {
      throw new Error("patchValue is required for patch action");
    }
    const patchedParams = { ...(trace?.parameters ?? {}), ...params.patchValue };
    const newBindingHash = computeBindingHash({
      envelopeId: approval.envelopeId,
      envelopeVersion: (approval.state.version ?? 0) + 1,
      actionId: approval.request.actionId,
      parameters: patchedParams,
      decisionTraceHash: hashObject({ governance: "patched" }),
      contextSnapshotHash: hashObject({ actor: params.respondedBy }),
    });
    const revision = await deps.lifecycleService.createRevision({
      lifecycleId: lifecycle.id,
      parametersSnapshot: patchedParams,
      approvalScopeSnapshot: {},
      bindingHash: newBindingHash,
      createdBy: params.respondedBy,
      sourceBindingHash: params.bindingHash,
      rationale: "Patched via approval respond",
    });
    clientBindingHash = revision.bindingHash;
    patchedBindingHash = revision.bindingHash;
    workUnit.parameters = patchedParams;
  }

  // THE authority commit: optimistic-locked, binding-hash-checked against the
  // CURRENT revision. Failure here mutates nothing else.
  const { lifecycle: approvedLifecycle, executableWorkUnit } =
    await deps.lifecycleService.approveLifecycle({
      lifecycleId: lifecycle.id,
      respondedBy: params.respondedBy,
      clientBindingHash,
      workUnit,
      actionEnvelopeId: approval.envelopeId,
      constraints: (trace?.governanceConstraints as unknown as Record<string, unknown>) ?? {},
    });

  // Payload authority (parked spec 4.1): the trace carries the frozen payload
  // before dispatch. Tolerates a missing trace store (legacy units dispatch
  // from the envelope payload) but never a rejected write.
  if (deps.workTraceStore) {
    await writeApprovedPayloadToTrace({
      deps: { workTraceStore: deps.workTraceStore },
      lifecycle: approvedLifecycle,
      executableWorkUnit,
      fallbackParameters: workUnit.parameters,
      approvalOutcome: params.action === "patch" ? "patched" : "approved",
      respondedBy: params.respondedBy,
      respondedAt,
      caller: "respond_via_lifecycle",
    });
  } else {
    deps.logger.error(
      { lifecycleId: lifecycle.id },
      "WorkTraceStore unavailable; dispatching from the envelope payload",
    );
  }

  // executeAfterApproval refuses to dispatch unless the envelope (when one
  // exists) is approved; flip it before dispatch.
  const envelope = await deps.envelopeStore.getById(approval.envelopeId);
  if (envelope) {
    await deps.envelopeStore.update(
      envelope.id,
      { status: "approved" },
      approval.organizationId ?? null,
    );
  }

  // Legacy row = side record: best-effort sync AFTER the authority commit.
  // Once the lifecycle is approved, nothing may stand between it and
  // dispatch-or-recovery; aborting here would recreate the bare-approve hole.
  try {
    await deps.approvalStore.updateState(
      approval.request.id,
      newState,
      approval.state.version,
      approval.organizationId ?? null,
    );
  } catch (err) {
    deps.logger.error(
      { err, approvalId: approval.request.id, lifecycleId: lifecycle.id },
      "Legacy approval-row sync failed after lifecycle approve; continuing to dispatch",
    );
  }

  const executionResult = await runDispatch(
    {
      lifecycleService: deps.lifecycleService,
      workTraceStore: deps.workTraceStore as WorkTraceStore,
      platformLifecycle: deps.platformLifecycle,
      logger: deps.logger,
    },
    approvedLifecycle,
    executableWorkUnit.id,
    executableWorkUnit.approvalRevisionId,
  );

  await recordLedger(deps.auditLedger, params, lifecycle, trace);
  deps.logger.info(
    {
      lifecycleId: lifecycle.id,
      workUnitId: approval.envelopeId,
      success: executionResult.success,
    },
    "Lifecycle-backed approval dispatched",
  );

  const updatedEnvelope = envelope
    ? ((await deps.envelopeStore.getById(envelope.id)) ?? envelope)
    : null;
  return {
    envelope: updatedEnvelope,
    approvalState: patchedBindingHash ? { ...newState, bindingHash: patchedBindingHash } : newState,
    executionResult,
  };
}

async function rejectViaLifecycle(
  deps: RespondViaLifecycleDeps,
  lifecycle: LifecycleRecord,
  approval: ApprovalRecordForResponse,
  params: RespondToApprovalParams,
): Promise<{ envelope: unknown; approvalState: unknown; executionResult: null }> {
  // Reject keeps the legacy-first order: no dispatch is at stake, and a raced
  // reject dying on the legacy row's optimistic lock leaves the lifecycle
  // pending (safe, retryable).
  const newState = transitionApproval(approval.state, "reject", params.respondedBy);
  await deps.approvalStore.updateState(
    approval.request.id,
    newState,
    approval.state.version,
    approval.organizationId ?? null,
  );

  if (!deps.workTraceStore) {
    throw new Error("WorkTraceStore not available for lifecycle rejection");
  }
  await deps.lifecycleService.rejectLifecycle({
    lifecycleId: lifecycle.id,
    respondedBy: params.respondedBy,
    traceStore: deps.workTraceStore,
    auditLedger: deps.auditLedger,
  });

  const envelope = await deps.envelopeStore.getById(approval.envelopeId);
  if (envelope) {
    await deps.envelopeStore.update(
      envelope.id,
      { status: "denied" },
      approval.organizationId ?? null,
    );
  }

  return { envelope: envelope ?? null, approvalState: newState, executionResult: null };
}

async function recordLedger(
  ledger: AuditLedger | undefined,
  params: RespondToApprovalParams,
  lifecycle: LifecycleRecord,
  trace: WorkTrace | null,
): Promise<void> {
  if (!ledger) return;
  const eventType = params.action === "patch" ? "action.patched" : "action.approved";
  await ledger.record({
    eventType,
    actorType: "user",
    actorId: params.respondedBy,
    entityType: "action",
    entityId: lifecycle.actionEnvelopeId,
    riskCategory: "medium",
    summary: `${params.action === "patch" ? "Action patched and approved" : "Action approved"} by ${params.respondedBy} (lifecycle-backed)`,
    snapshot: {
      lifecycleId: lifecycle.id,
      intent: trace?.intent ?? "unknown",
      ...(params.action === "patch" ? { patchValue: params.patchValue } : {}),
    },
    envelopeId: lifecycle.actionEnvelopeId,
    organizationId: lifecycle.organizationId ?? undefined,
    traceId: trace?.traceId,
  });
}

export async function getWorkTrace(
  workTraceStore: WorkTraceStore | null,
  workUnitId: string,
): Promise<WorkTrace | null> {
  if (!workTraceStore) return null;
  const result = await workTraceStore.getByWorkUnitId(workUnitId);
  return result?.trace ?? null;
}

function reconstructWorkUnit(
  trace: WorkTrace | null,
  approval: ApprovalRecordForResponse,
): WorkUnit {
  const fallbackDeployment: DeploymentContext = {
    deploymentId: "",
    skillSlug: "",
    trustLevel: "supervised",
    trustScore: 0,
  };

  if (!trace) {
    return {
      id: approval.envelopeId,
      requestedAt: approval.request.createdAt.toISOString(),
      organizationId: approval.organizationId ?? "",
      actor: { id: "system", type: "system" },
      intent: approval.request.actionId,
      parameters: {},
      deployment: fallbackDeployment,
      resolvedMode: "cartridge",
      traceId: approval.envelopeId,
      trigger: "api",
      priority: "normal",
    };
  }

  return {
    id: trace.workUnitId,
    requestedAt: trace.requestedAt,
    organizationId: trace.organizationId,
    actor: trace.actor,
    intent: trace.intent,
    parameters: trace.parameters ?? {},
    deployment: trace.deploymentContext ?? fallbackDeployment,
    resolvedMode: trace.mode,
    idempotencyKey: trace.idempotencyKey,
    parentWorkUnitId: trace.parentWorkUnitId,
    traceId: trace.traceId,
    trigger: trace.trigger,
    priority: "normal",
  };
}
```

- [ ] **Step 4.2: Slim `respond-to-approval.ts` down to the entry**

Replace the whole file body after the header comment (keep lines 1-13 of the header, updating the charter sentence) with:

```ts
import type { ApprovalRequest, ExecuteResult } from "@switchboard/schemas";
import type { ApprovalState } from "../approval/state-machine.js";
import type { ApprovalLifecycleService } from "../approval/lifecycle-service.js";
import type { WorkTraceStore } from "../platform/work-trace-recorder.js";
import type { ApprovalStore, EnvelopeStore } from "../storage/interfaces.js";
import type { AuditLedger } from "../audit/ledger.js";
import type { ExecuteApprovedLike } from "./lifecycle-dispatch.js";
import { respondViaLifecycle, getWorkTrace } from "./respond-via-lifecycle.js";

export interface PlatformLifecycleLike extends ExecuteApprovedLike {
  respondToApproval(params: {
    approvalId: string;
    action: "approve" | "reject" | "patch";
    respondedBy: string;
    bindingHash: string;
    patchValue?: Record<string, unknown>;
  }): Promise<{
    envelope: unknown;
    approvalState: unknown;
    executionResult: ExecuteResult | null;
  }>;
}
```

then keep `SessionManagerLike`, `RespondToApprovalLogger` unchanged, and update:

```ts
export interface RespondToApprovalDeps {
  approvalStore: ApprovalStore;
  envelopeStore: EnvelopeStore;
  /** Required for the lifecycle path; legacy path tolerates null. */
  workTraceStore: WorkTraceStore | null;
  /** Lifecycle-backed approvals route through this. Null when no lifecycle exists. */
  lifecycleService: ApprovalLifecycleService | null;
  /** Legacy fallback for approvals without a lifecycle record; also the dispatch engine. */
  platformLifecycle: PlatformLifecycleLike;
  /** Optional session-resume hook. Best-effort: failures surface as resumeWarning. */
  sessionManager: SessionManagerLike | null;
  /** Optional audit ledger: the lifecycle fork records action.approved/patched. */
  auditLedger?: AuditLedger;
  logger: RespondToApprovalLogger;
  selfApprovalAllowed?: boolean;
}
```

(keep the existing doc comment on `selfApprovalAllowed`), tighten the result:

```ts
export interface RespondToApprovalResult {
  envelope: unknown;
  approvalState: unknown;
  executionResult: ExecuteResult | null;
  resumeWarning?: string;
}
```

and rewire the body of `respondToApproval` so the lifecycle branch is:

```ts
  if (lifecycle && deps.lifecycleService) {
    // Four-eyes guard (A2): the action's own originator may not approve/patch
    // it on the lifecycle path unless selfApprovalAllowed. Runs BEFORE
    // respondViaLifecycle so a rejected self-approval mutates no state.
    await assertNotSelfApproval(deps, params, approval);

    response = await respondViaLifecycle({
      deps: {
        lifecycleService: deps.lifecycleService,
        approvalStore: deps.approvalStore,
        envelopeStore: deps.envelopeStore,
        workTraceStore: deps.workTraceStore,
        platformLifecycle: deps.platformLifecycle,
        auditLedger: deps.auditLedger,
        logger: deps.logger,
      },
      lifecycle,
      approval,
      params,
    });
  } else {
    ...unchanged legacy branch...
  }
```

Delete from this file: the old `respondViaLifecycle` function, `getWorkTrace`, `reconstructWorkUnit`, and the now-unused imports (`transitionApproval`, `computeBindingHash`, `hashObject`, `LifecycleRecord`, `WorkUnit`, `WorkTrace`, `DeploymentContext`). Keep `assertNotSelfApproval` (it now imports `getWorkTrace` from `./respond-via-lifecycle.js`). The `response` local's type becomes `{ envelope: unknown; approvalState: unknown; executionResult: ExecuteResult | null }`.

- [ ] **Step 4.3: Run the fork suite to verify GREEN**

```bash
pnpm --filter @switchboard/core test -- src/approval/__tests__/respond-via-lifecycle.test.ts src/approval/__tests__/respond-to-parked-lifecycle.test.ts
```

Expected: PASS (all cases both files).

- [ ] **Step 4.4: Delete the absorbed suite and run the package**

```bash
git rm packages/core/src/approval/__tests__/respond-to-approval-self-approval.test.ts
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/core build && pnpm --filter @switchboard/core typecheck
```

Expected: core suite PASS. If gateway tests in core fail on the `PlatformLifecycleLike` tightening (`executionResult: { ok: true }` mocks or a missing `executeApproved` member), fix ONLY mock shapes in `packages/core/src/channel-gateway/__tests__/handle-approval-response.test.ts`: add `executeApproved: vi.fn()` next to each mocked `platformLifecycle.respondToApproval` and change `executionResult: { ok: true }` to `executionResult: null`. Behavior assertions stay untouched (the full reply rebuild is PR-2).

- [ ] **Step 4.5: Mutation check the load-bearing assertions (engine level), then revert**

Protocol: apply each mutation, run the named test, confirm RED, revert, confirm GREEN.

1. In `respond-via-lifecycle.ts`, comment out the `runDispatch(...)` call and return a synthetic `okResult`-shaped object instead. Expected RED: "approve drives approveLifecycle -> ... -> dispatch" (executeApproved not called) and the dispatch-record assertions.
2. In `respond-via-lifecycle.ts`, comment out the `writeApprovedPayloadToTrace(...)` call. Expected RED: "payload authority: dispatch happens from the APPROVED revision snapshot".
3. In `lifecycle-dispatch.ts`, make `runDispatch` skip `markRecoveryRequired` on `success:false`. Expected RED: "success:false transitions the lifecycle to recovery_required".

```bash
git diff --stat   # after reverting: empty
```

- [ ] **Step 4.6: Commit**

```bash
git add packages/core/src/approval/respond-via-lifecycle.ts packages/core/src/approval/respond-to-approval.ts packages/core/src/approval/__tests__/
git commit -m "feat(core): unify the lifecycle respond fork onto the dispatch engine

The legacy-row lifecycle fork now drives the same chain as
respondToParkedLifecycle: approveLifecycle (authority commit) -> frozen
payload onto the trace -> envelope approved -> legacy-row sync (side
record, best-effort) -> prepareDispatch -> executeApproved ->
recordDispatchOutcome, with dispatch failure transitioning to
recovery_required. Fixes the quorum bypass (partial approvals no longer
touch the lifecycle) and the patch dead-end (patch now creates the
revision AND dispatches it, matching the legacy patch-executes
contract). executionResult is the real ExecuteResult."
```

### Task 5: Wire the audit ledger through the API route

**Files:**

- Modify: `apps/api/src/routes/approvals.ts:246-256`

- [ ] **Step 5.1: Pass `auditLedger` in the legacy-id respond call**

In the `respondToApproval` deps object add one line after `sessionManager`:

```ts
            sessionManager: app.sessionManager,
            auditLedger: app.auditLedger,
            logger: app.log,
```

- [ ] **Step 5.2: Run the api suite**

```bash
pnpm --filter api test
```

Expected: PASS (rerun bootstrap-smoke / api-auth prod-hardening once if they flake).

- [ ] **Step 5.3: Commit**

```bash
git add apps/api/src/routes/approvals.ts
git commit -m "feat(api): record lifecycle-fork approvals in the audit ledger"
```

### Task 6: PR-1 green gate, push, merge

- [ ] **Step 6.1: Full green gate**

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check && pnpm arch:check
```

Expected: all green (rerun known flakes once). `arch:check` matters: respond-to-approval.ts shrank, new files are ~200 and ~330 raw lines, all under 600.

- [ ] **Step 6.2: Push, PR, auto-merge, ancestry**

```bash
git push -u origin feat/approval-respond-unification
gh pr create --base main --title "feat(core): unify lifecycle respond fork onto the shared dispatch engine" --body "<summary per spec section 2; list the quorum + patch fixes; note the executionResult shape change and the absorbed self-approval suite>"
gh pr merge --squash --auto
# after checks pass:
git fetch origin main
gh pr view --json mergeCommit --jq .mergeCommit.oid   # capture SQUASH_SHA
git merge-base --is-ancestor <SQUASH_SHA> origin/main && echo ANCESTOR-OK
```

If `--auto` fails with "required status checks are expected", wait 20s and retry.

---

## PR-2: chat gateway honest replies + lifecycle fallback

### Task 7: Branch

- [ ] **Step 7.1:**

```bash
git fetch origin && git checkout -B feat/chat-approval-honest-replies origin/main
git branch --show-current
```

### Task 8: RED gateway suite

**Files:**

- Modify: `packages/core/src/channel-gateway/__tests__/handle-approval-response.test.ts`

- [ ] **Step 8.1: Add a real-lifecycle world builder + new cases**

Append to the existing test file (keep all current cases; update only the two success-reply imports/assertions and mock shapes per Step 4.4). New imports at top:

```ts
import {
  APPROVE_EXECUTED_MSG,
  APPROVE_DISPATCH_FAILED_MSG,
  PARTIAL_APPROVAL_MSG,
  SELF_APPROVAL_MSG,
} from "../handle-approval-response.js";
import { ApprovalLifecycleService, InMemoryLifecycleStore } from "../../approval/index.js";
import type { ExecuteResult } from "@switchboard/schemas";
```

(`APPROVE_SUCCESS_MSG` disappears; the two existing success-reply cases switch their expectation to `APPROVE_EXECUTED_MSG` once their mocks return a real ExecuteResult, see below.)

New builder (place after `makeRespondDeps`):

```ts
function okExec(): ExecuteResult {
  return {
    success: true,
    summary: "handler ran",
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: 1,
    undoRecipe: null,
  };
}

/**
 * A REAL ApprovalLifecycleService world reached through the gateway: the
 * legacy approval row and the lifecycle row share the same work unit id and
 * binding hash (the production coexistence shape). executeApproved is a spy:
 * the assertions below are about THE HANDLER RUNNING, not status flips.
 */
async function makeLifecycleWorld(opts?: { failDispatch?: boolean; noApprovalRow?: boolean }) {
  const store = new InMemoryLifecycleStore();
  const lifecycleService = new ApprovalLifecycleService({ store });
  const { lifecycle, revision } = await lifecycleService.createGatedLifecycle({
    actionEnvelopeId: "env_1",
    organizationId: "org-1",
    expiresAt: new Date(Date.now() + 3_600_000),
    initialRevision: {
      parametersSnapshot: { campaignId: "camp-1" },
      approvalScopeSnapshot: {},
      bindingHash: "hash123",
      createdBy: "user-orig",
    },
  });

  let trace = {
    workUnitId: "env_1",
    requestedAt: new Date().toISOString(),
    organizationId: "org-1",
    actor: { id: "user-orig", type: "user" as const },
    intent: "test.action",
    parameters: { campaignId: "camp-1" },
    mode: "skill",
    traceId: "trace-1",
    trigger: "api",
    governanceConstraints: {},
  };
  const workTraceStore = {
    getByWorkUnitId: vi.fn(async () => ({ trace, integrity: { status: "ok" } })),
    update: vi.fn(async (_id: string, fields: Record<string, unknown>) => {
      trace = { ...trace, ...fields } as typeof trace;
      return { ok: true, trace };
    }),
  } as never;

  const executeApproved = vi.fn(async () =>
    opts?.failDispatch ? { ...okExec(), success: false, summary: "boom" } : okExec(),
  );

  const approvalStore = makeStore(
    opts?.noApprovalRow
      ? vi.fn().mockResolvedValue(null)
      : vi.fn().mockResolvedValue(makeApproval()),
  );

  const respondDeps = {
    approvalStore,
    envelopeStore: {
      getById: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      save: vi.fn(),
    } as never,
    workTraceStore,
    lifecycleService,
    platformLifecycle: { respondToApproval: vi.fn(), executeApproved } as never,
    sessionManager: null,
    logger: { info: vi.fn(), error: vi.fn() },
  };

  return {
    respondDeps,
    approvalStore,
    lifecycleService,
    store,
    lifecycle,
    revision,
    executeApproved,
  };
}

function authorizedConfig(respondDeps: ReturnType<typeof makeRespondDeps>) {
  return {
    bindingStore: makeBindingStore({ principalId: "principal-1" } as never),
    identityStore: makeIdentityStore(makePrincipal(["operator"])),
    respondDeps,
  } as HandleApprovalResponseConfig;
}
```

New cases (the heart of the slice; the payload for the fallback cases carries the LIFECYCLE id):

```ts
describe("handleApprovalResponse: honest replies over a real lifecycle", () => {
  it("approve runs the dispatch and replies APPROVE_EXECUTED_MSG (the handler ran)", async () => {
    const w = await makeLifecycleWorld();
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: PAYLOAD,
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(w.executeApproved).toHaveBeenCalledWith("env_1");
    expect(sendSpy).toHaveBeenCalledWith(APPROVE_EXECUTED_MSG);
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("approved");
  });

  it("approve whose dispatch fails replies APPROVE_DISPATCH_FAILED_MSG and parks recovery_required", async () => {
    const w = await makeLifecycleWorld({ failDispatch: true });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: PAYLOAD,
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(w.executeApproved).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(APPROVE_DISPATCH_FAILED_MSG);
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe(
      "recovery_required",
    );
  });

  it("self-approval through chat replies SELF_APPROVAL_MSG and runs nothing", async () => {
    const w = await makeLifecycleWorld();
    const { sink, sendSpy } = makeReplySink();
    const config = {
      bindingStore: makeBindingStore({ principalId: "user-orig" } as never),
      identityStore: makeIdentityStore({ ...makePrincipal(["operator"]), id: "user-orig" }),
      respondDeps: w.respondDeps,
    } as HandleApprovalResponseConfig;
    await handleApprovalResponse({
      payload: PAYLOAD,
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config,
    });
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith(SELF_APPROVAL_MSG);
  });

  it("a post-patch (stale) button replies STALE_MSG, not the generic execution error", async () => {
    const w = await makeLifecycleWorld();
    // a patch moved the current revision; the chat button still carries hash123
    await w.lifecycleService.createRevision({
      lifecycleId: w.lifecycle.id,
      parametersSnapshot: { campaignId: "patched" },
      approvalScopeSnapshot: {},
      bindingHash: "hash456",
      createdBy: "operator-2",
      sourceBindingHash: "hash123",
    });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: PAYLOAD,
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(w.executeApproved).not.toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
  });
});

describe("handleApprovalResponse: lifecycle fallback when the approval row is missing", () => {
  function lifecyclePayload(w: Awaited<ReturnType<typeof makeLifecycleWorld>>) {
    return { action: "approve" as const, approvalId: w.lifecycle.id, bindingHash: "hash123" };
  }

  it("falls through to the lifecycle, dispatches, and replies APPROVE_EXECUTED_MSG", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: lifecyclePayload(w),
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(w.executeApproved).toHaveBeenCalledWith("env_1");
    expect(sendSpy).toHaveBeenCalledWith(APPROVE_EXECUTED_MSG);
  });

  it("approve on a recovery_required lifecycle IS retry (attempt 2) through the fallback", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true, failDispatch: true });
    const { sink } = makeReplySink();
    await handleApprovalResponse({
      payload: lifecyclePayload(w),
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe(
      "recovery_required",
    );
    // the handler is fixed now
    w.executeApproved.mockImplementation(async () => okExec());
    const second = makeReplySink();
    await handleApprovalResponse({
      payload: lifecyclePayload(w),
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: second.sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(second.sendSpy).toHaveBeenCalledWith(APPROVE_EXECUTED_MSG);
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("approved");
    expect(w.store.listDispatchRecords()).toHaveLength(2);
    expect(w.store.listDispatchRecords()[1]?.attemptNumber).toBe(2);
  });

  it("org mismatch on the lifecycle replies NOT_FOUND_MSG (no existence leak)", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: lifecyclePayload(w),
      ...BASE_ARGS,
      organizationId: "org-other",
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
    expect(w.executeApproved).not.toHaveBeenCalled();
  });

  it("a wrong hash against the current revision replies STALE_MSG without responding", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: { ...lifecyclePayload(w), bindingHash: "hashXX3" },
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
    expect(w.executeApproved).not.toHaveBeenCalled();
  });

  it("reject through the fallback works and replies REJECT_SUCCESS_MSG", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: { ...lifecyclePayload(w), action: "reject" as const },
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(sendSpy).toHaveBeenCalledWith(REJECT_SUCCESS_MSG);
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("rejected");
  });

  it("no binding on the fallback leg fails closed with NOT_AUTHORIZED_MSG", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: lifecyclePayload(w),
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: {
        bindingStore: makeBindingStore(null),
        identityStore: makeIdentityStore(makePrincipal(["operator"])),
        respondDeps: w.respondDeps,
      } as HandleApprovalResponseConfig,
    });
    expect(sendSpy).toHaveBeenCalledWith(NOT_AUTHORIZED_MSG);
    expect(w.executeApproved).not.toHaveBeenCalled();
  });

  it("an unknown id (no row, no lifecycle) still replies NOT_FOUND_MSG", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: { action: "approve", approvalId: "lc-unknown", bindingHash: "hash123" },
      ...BASE_ARGS,
      approvalStore: w.approvalStore,
      replySink: sink,
      config: authorizedConfig(w.respondDeps as never),
    });
    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
  });
});

describe("handleApprovalResponse: quorum partial", () => {
  it("an approve that leaves quorum open replies PARTIAL_APPROVAL_MSG", async () => {
    const respondDeps = makeRespondDeps();
    respondDeps.platformLifecycle.respondToApproval = vi.fn().mockResolvedValue({
      envelope: { id: "env_1" },
      approvalState: { status: "pending" },
      executionResult: null,
    });
    const { sink, sendSpy } = makeReplySink();
    await handleApprovalResponse({
      payload: PAYLOAD,
      ...BASE_ARGS,
      approvalStore: makeStore(vi.fn().mockResolvedValue(makeApproval())),
      replySink: sink,
      config: authorizedConfig(respondDeps),
    });
    expect(sendSpy).toHaveBeenCalledWith(PARTIAL_APPROVAL_MSG);
  });
});
```

Also update the two existing success-reply cases ("executes approve via shared helper..." and the legacy mocks): `makeRespondDeps`'s happy mock returns `executionResult: okExec()` and the approve case asserts `APPROVE_EXECUTED_MSG`; the reject case stays `REJECT_SUCCESS_MSG`.

- [ ] **Step 8.2: Run to verify RED**

```bash
pnpm --filter @switchboard/core test -- src/channel-gateway/__tests__/handle-approval-response.test.ts
```

Expected: FAIL on every new case (missing exports `APPROVE_EXECUTED_MSG` etc., NOT_FOUND on fallback cases, generic error reply on stale-binding case).

- [ ] **Step 8.3: Commit the red suite**

```bash
git add packages/core/src/channel-gateway/__tests__/handle-approval-response.test.ts
git commit -m "test(core): red suite for honest chat approval replies + lifecycle fallback"
```

### Task 9: Implement the gateway changes

**Files:**

- Modify: `packages/core/src/channel-gateway/handle-approval-response.ts`

- [ ] **Step 9.1: Rework the module**

Replace the constants block and the function body. Full target shape (keep the file header imports, adding):

```ts
import { timingSafeEqual } from "node:crypto";
import type { ExecuteResult, Principal } from "@switchboard/schemas";
import type { ApprovalStore } from "../storage/interfaces.js";
import type { ReplySink, HandleApprovalResponseConfig } from "./types.js";
import type { ParsedApprovalResponsePayload } from "./approval-response-payload.js";
import type { RespondToApprovalResult } from "../approval/respond-to-approval.js";
import { respondToApproval } from "../approval/respond-to-approval.js";
import { respondToParkedLifecycle } from "../approval/respond-to-parked-lifecycle.js";
import {
  ParkedLifecycleNotFoundError,
  ParkedLifecycleAlreadyRespondedError,
  ParkedLifecycleExpiredError,
} from "../approval/respond-to-parked-lifecycle.js";
import { StaleVersionError } from "../approval/state-machine.js";
```

Constants: keep `NOT_FOUND_MSG`, `STALE_MSG`, `NOT_AUTHORIZED_MSG`, `APPROVAL_LOOKUP_ERROR_MSG`, `ALREADY_RESPONDED_MSG`, `REJECT_SUCCESS_MSG`, `APPROVAL_EXECUTION_ERROR_MSG`. Remove `APPROVE_SUCCESS_MSG`. Add:

```ts
export const APPROVE_EXECUTED_MSG = "Approved. The action has run or is queued to run.";

export const APPROVE_DISPATCH_FAILED_MSG =
  "Approved, but the action did not run. It is waiting in your inbox as a Retry card. Approving it there retries it.";

export const PARTIAL_APPROVAL_MSG =
  "Your approval is recorded. More approvals are required before it runs.";

export const SELF_APPROVAL_MSG =
  "You cannot approve an action you initiated. Another operator must respond.";
```

Shared helpers inside the module:

```ts
function timingSafeMatch(stored: string | undefined | null, supplied: string): boolean {
  if (typeof stored !== "string" || stored.length === 0) return false;
  if (stored.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(stored, "utf8"), Buffer.from(supplied, "utf8"));
}

/**
 * Channel-possession alone is NOT authority: require an active
 * OperatorChannelBinding to a Principal carrying an approver role. Fail closed
 * when the binding stack is not wired. Replies NOT_AUTHORIZED itself and
 * returns null when refusing.
 */
async function authorizeOperator(args: {
  config: HandleApprovalResponseConfig | undefined;
  organizationId: string;
  channel: string;
  channelIdentifier: string;
  replySink: ReplySink;
}): Promise<string | null> {
  const { config } = args;
  if (!config) {
    await args.replySink.send(NOT_AUTHORIZED_MSG);
    return null;
  }
  const binding = await config.bindingStore.findActiveBinding({
    organizationId: args.organizationId,
    channel: args.channel,
    channelIdentifier: args.channelIdentifier,
  });
  if (!binding) {
    await args.replySink.send(NOT_AUTHORIZED_MSG);
    return null;
  }
  const principal = await config.identityStore.getPrincipal(binding.principalId);
  if (!principal || !principalHasApproverRole(principal)) {
    await args.replySink.send(NOT_AUTHORIZED_MSG);
    return null;
  }
  return binding.principalId;
}

/**
 * Honest outcome reply (chat-approval-seam spec section 3): the reply tracks
 * what actually happened, not what was requested. success covers completed
 * AND queued (#860 mapping); null execution on an approve means a quorum is
 * still open.
 */
function replyForOutcome(
  action: "approve" | "reject",
  executionResult: ExecuteResult | null,
): string {
  if (action === "reject") return REJECT_SUCCESS_MSG;
  if (executionResult === null) return PARTIAL_APPROVAL_MSG;
  return executionResult.success ? APPROVE_EXECUTED_MSG : APPROVE_DISPATCH_FAILED_MSG;
}

function replyForError(err: unknown): string {
  if (err instanceof StaleVersionError) return ALREADY_RESPONDED_MSG;
  if (err instanceof ParkedLifecycleNotFoundError) return NOT_FOUND_MSG;
  if (err instanceof ParkedLifecycleAlreadyRespondedError) return ALREADY_RESPONDED_MSG;
  if (err instanceof ParkedLifecycleExpiredError) return STALE_MSG;
  if (err instanceof Error && /lifecycle status is "/.test(err.message)) {
    return ALREADY_RESPONDED_MSG;
  }
  if (err instanceof Error && /stale binding/i.test(err.message)) return STALE_MSG;
  if (err instanceof Error && /self-approval/i.test(err.message)) return SELF_APPROVAL_MSG;
  return APPROVAL_EXECUTION_ERROR_MSG;
}
```

The main function keeps its current signature. New body order:

```ts
  let approval: Awaited<ReturnType<ApprovalStore["getById"]>>;
  try {
    approval = await approvalStore.getById(payload.approvalId);
  } catch {
    await replySink.send(APPROVAL_LOOKUP_ERROR_MSG);
    return;
  }

  if (!approval) {
    // Lifecycle fallback (mirrors the #877 route fallback): parked WorkUnits
    // and post-restart in-memory rows have no ApprovalRequest row; the id on
    // the button may be a lifecycle id. Approve on recovery_required IS retry.
    await respondViaLifecycleFallback(params);
    return;
  }

  ...org check, pre-check, hash check: UNCHANGED from today...

  const principalId = await authorizeOperator({
    config,
    organizationId,
    channel,
    channelIdentifier,
    replySink,
  });
  if (!principalId) return;

  let result: RespondToApprovalResult;
  try {
    result = await respondToApproval(
      config!.respondDeps,
      {
        approvalId: payload.approvalId,
        action: payload.action,
        respondedBy: principalId,
        bindingHash: supplied,
      },
      approval,
    );
  } catch (err) {
    await replySink.send(replyForError(err));
    return;
  }

  await replySink.send(replyForOutcome(payload.action, result.executionResult));
```

And the fallback leg:

```ts
async function respondViaLifecycleFallback(params: {
  payload: ParsedApprovalResponsePayload;
  organizationId: string;
  channel: string;
  channelIdentifier: string;
  replySink: ReplySink;
  config?: HandleApprovalResponseConfig;
}): Promise<void> {
  const { payload, organizationId, replySink, config } = params;
  const lifecycleService = config?.respondDeps.lifecycleService ?? null;
  const workTraceStore = config?.respondDeps.workTraceStore ?? null;
  if (!config || !lifecycleService || !workTraceStore) {
    await replySink.send(NOT_FOUND_MSG);
    return;
  }

  let lifecycle;
  try {
    lifecycle = await lifecycleService.getLifecycleById(payload.approvalId);
  } catch {
    await replySink.send(APPROVAL_LOOKUP_ERROR_MSG);
    return;
  }
  if (!lifecycle || lifecycle.organizationId !== organizationId) {
    await replySink.send(NOT_FOUND_MSG);
    return;
  }

  // Approve commits to the CURRENT revision; refuse a button whose hash no
  // longer matches it (e.g. after a patch) before any mutation.
  if (payload.action === "approve") {
    let revision;
    try {
      revision = await lifecycleService.getCurrentRevision(lifecycle.id);
    } catch {
      await replySink.send(APPROVAL_LOOKUP_ERROR_MSG);
      return;
    }
    if (!timingSafeMatch(revision?.bindingHash, payload.bindingHash)) {
      await replySink.send(STALE_MSG);
      return;
    }
  }

  const principalId = await authorizeOperator({
    config,
    organizationId,
    channel: params.channel,
    channelIdentifier: params.channelIdentifier,
    replySink,
  });
  if (!principalId) return;

  try {
    const result = await respondToParkedLifecycle(
      {
        lifecycleService,
        workTraceStore,
        platformLifecycle: config.respondDeps.platformLifecycle,
        auditLedger: config.respondDeps.auditLedger,
        logger: config.respondDeps.logger,
        selfApprovalAllowed: config.respondDeps.selfApprovalAllowed,
      },
      {
        lifecycleId: lifecycle.id,
        action: payload.action,
        respondedBy: principalId,
        bindingHash: payload.bindingHash,
      },
    );
    await replySink.send(replyForOutcome(payload.action, result.executionResult));
  } catch (err) {
    await replySink.send(replyForError(err));
  }
}
```

The existing inline hash-check block in the legacy leg collapses to `timingSafeMatch(stored, supplied)`; the existing binding/role block collapses to `authorizeOperator`. The `respondToParkedLifecycle` deps require a non-null `platformLifecycle.executeApproved`: `RespondToApprovalDeps.platformLifecycle` is `PlatformLifecycleLike`, which now extends `ExecuteApprovedLike` (PR-1), so it satisfies structurally. Pass `selfApprovalAllowed: config.respondDeps.selfApprovalAllowed` through to the parked deps (shown above) so the fallback leg keeps the four-eyes posture.

Also widen the barrel `packages/core/src/channel-gateway/index.ts` (verified: today it exports only `APPROVER_ROLES` from this module; PR-3 imports the function + constants from `@switchboard/core`):

```ts
export {
  APPROVER_ROLES,
  handleApprovalResponse,
  NOT_FOUND_MSG,
  STALE_MSG,
  NOT_AUTHORIZED_MSG,
  APPROVAL_LOOKUP_ERROR_MSG,
  ALREADY_RESPONDED_MSG,
  REJECT_SUCCESS_MSG,
  APPROVAL_EXECUTION_ERROR_MSG,
  APPROVE_EXECUTED_MSG,
  APPROVE_DISPATCH_FAILED_MSG,
  PARTIAL_APPROVAL_MSG,
  SELF_APPROVAL_MSG,
} from "./handle-approval-response.js";
```

(replacing the existing single-symbol `APPROVER_ROLES` export line; the barrel stays well under the 40-symbol flag threshold).

- [ ] **Step 9.2: Run to verify GREEN**

```bash
pnpm --filter @switchboard/core test -- src/channel-gateway/__tests__/handle-approval-response.test.ts
```

Expected: PASS, all old and new cases.

- [ ] **Step 9.3: Mutation check, then revert**

1. Make `replyForOutcome` return `APPROVE_EXECUTED_MSG` unconditionally for approve. Expected RED: the dispatch-failed case.
2. Skip the fallback's current-revision hash check. Expected RED: "wrong hash against the current revision".
   Revert both; rerun; GREEN.

- [ ] **Step 9.4: Full green gate, push, PR, merge (same protocol as Step 6.2)**

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check && pnpm arch:check
git add packages/core/src/channel-gateway/handle-approval-response.ts
git commit -m "feat(core): honest chat approval replies + lifecycle fallback

The chat reply now tracks what actually happened: ran-or-queued vs
approved-but-did-not-run (Retry card) vs partial quorum, with
stale-binding and self-approval mapped to their own replies. When the
approval row is missing the handler falls through to the lifecycle by
id (mirroring the #877 route fallback), which also makes approve on
recovery_required a chat-side retry."
git push -u origin feat/chat-approval-honest-replies
gh pr create --base main --title "feat(core): honest chat approval replies + lifecycle fallback" --body "<summary per spec sections 3-4>"
gh pr merge --squash --auto
# after merge: ancestry check as in Step 6.2
```

---

## PR-3: integration proof (chat entry, end to end)

### Task 10: Branch + harness extraction

- [ ] **Step 10.1: Branch**

```bash
git fetch origin && git checkout -B test/chat-approval-loop-proof origin/main
```

- [ ] **Step 10.2: Move `buildLifecycleWorld` into the harness**

Cut the `buildLifecycleWorld` function from `apps/api/src/__tests__/recommendation-handoff-approval-loop.test.ts` and add it (exported) to `apps/api/src/__tests__/recommendation-handoff-harness.ts`, moving its imports (`ApprovalLifecycleService`, `InMemoryLifecycleStore`, `createInMemoryStorage`, `AuditLedger`, `InMemoryLedgerStorage` from `@switchboard/core`; `PlatformLifecycle` from `@switchboard/core/platform`) into the harness:

```ts
export function buildLifecycleWorld() {
  const store = new InMemoryLifecycleStore();
  const lifecycleService = new ApprovalLifecycleService({ store });
  const harness = buildHarness([allowPolicy(), approvalPolicy()], { lifecycleService });
  const storage = createInMemoryStorage();
  const ledger = new AuditLedger(new InMemoryLedgerStorage());
  const platformLifecycle = new PlatformLifecycle({
    approvalStore: storage.approvals,
    envelopeStore: storage.envelopes,
    identityStore: storage.identity,
    modeRegistry: harness.modeRegistry,
    traceStore: harness.traceStore,
    ledger,
    trustAdapter: null,
    selfApprovalAllowed: false,
    approvalRateLimit: null,
  });
  const logger = { info: () => {}, error: () => {} };
  const deps = {
    lifecycleService,
    workTraceStore: harness.traceStore,
    platformLifecycle,
    auditLedger: ledger,
    logger,
  };
  return { store, lifecycleService, harness, storage, platformLifecycle, ledger, deps, logger };
}
```

(One addition: expose `storage` and `logger`, which the chat test needs.) Update the #879 test to `import { buildLifecycleWorld } from "./recommendation-handoff-harness.js"` and delete its local copy plus its now-unused imports. Run:

```bash
pnpm --filter api test -- src/__tests__/recommendation-handoff-approval-loop.test.ts
```

Expected: PASS unchanged (4 cases).

- [ ] **Step 10.3: Commit**

```bash
git add apps/api/src/__tests__/recommendation-handoff-harness.ts apps/api/src/__tests__/recommendation-handoff-approval-loop.test.ts
git commit -m "test(api): extract buildLifecycleWorld into the handoff harness"
```

### Task 11: The chat-approval loop test

**Files:**

- Create: `apps/api/src/__tests__/chat-approval-loop.test.ts`

- [ ] **Step 11.1: Write the test**

```ts
/**
 * Chat-surface twin of recommendation-handoff-approval-loop.test.ts: the SAME
 * guarantee (a human approves exactly one frozen action; the system executes
 * it or exposes recovery) driven through the CHAT entry,
 * handleApprovalResponse, instead of the API route. Two production shapes:
 *
 *  1. legacy+lifecycle coexistence: an ApprovalRequest row AND the lifecycle
 *     row share the work unit id + binding hash; the chat approve must run the
 *     REAL handoff handler through the unified fork (this was the
 *     approve-without-dispatch hole).
 *  2. lifecycle-only fallback: no approval row; the button carries the
 *     lifecycle id; the fallback leg responds, dispatches, and retries.
 *
 * The reply assertions are the operator-honesty contract: the chat reply
 * tracks what actually happened.
 */
import { describe, it, expect } from "vitest";
import {
  handleApprovalResponse,
  APPROVE_EXECUTED_MSG,
  APPROVE_DISPATCH_FAILED_MSG,
  createApprovalState,
} from "@switchboard/core";
import type {
  HandleApprovalResponseConfig,
  IdentityStore,
  OperatorChannelBindingStore,
  ReplySink,
} from "@switchboard/core";
import type { ApprovalRequest, Principal } from "@switchboard/schemas";
import { executeWeeklyAudit } from "@switchboard/ad-optimizer";
import { synthesizeCreativeBrief } from "../services/workflows/creative-brief-synthesis.js";
import {
  ORG,
  buildHarness,
  buildCronDeps,
  buildLifecycleWorld,
  allowPolicy,
  approvalPolicy,
  readerFor,
  step,
  type ParkedHandoff,
} from "./recommendation-handoff-harness.js";

const OPERATOR_PRINCIPAL = "principal-op-1";
const CHANNEL = "whatsapp";
const CHANNEL_IDENTIFIER = "+6591234567";

async function parkViaCron(w: ReturnType<typeof buildLifecycleWorld>) {
  const parked: ParkedHandoff[] = [];
  await executeWeeklyAudit(
    step as Parameters<typeof executeWeeklyAudit>[0],
    buildCronDeps(w.harness.ingress, parked),
  );
  expect(parked).toHaveLength(1);
  const res = parked[0]!.res;
  if (!res.ok) throw new Error("submit failed");
  return {
    workUnitId: res.workUnit.id,
    lifecycleId: (res as { lifecycleId: string }).lifecycleId,
    bindingHash: (res as { bindingHash: string }).bindingHash,
  };
}

/** Seed the legacy ApprovalRequest row that coexists with the lifecycle row. */
async function seedLegacyApprovalRow(
  w: ReturnType<typeof buildLifecycleWorld>,
  parked: { workUnitId: string; bindingHash: string },
): Promise<string> {
  const approvalId = "appr_chat_1";
  const expiresAt = new Date(Date.now() + 3_600_000);
  const request: ApprovalRequest = {
    id: approvalId,
    actionId: `prop_${parked.workUnitId}`,
    envelopeId: parked.workUnitId,
    conversationId: null,
    summary: "adoptimizer.recommendation.handoff (requested by system)",
    riskCategory: "medium",
    bindingHash: parked.bindingHash,
    evidenceBundle: { decisionTrace: null, contextSnapshot: {}, identitySnapshot: {} },
    suggestedButtons: [
      { label: "Approve", action: "approve" },
      { label: "Reject", action: "reject" },
    ],
    approvers: [OPERATOR_PRINCIPAL],
    fallbackApprover: null,
    status: "pending",
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt,
    expiredBehavior: "deny",
    createdAt: new Date(),
    quorum: null,
  } as unknown as ApprovalRequest;
  await w.storage.approvals.save({
    request,
    state: createApprovalState(expiresAt, null),
    envelopeId: parked.workUnitId,
    organizationId: ORG,
  });
  return approvalId;
}

function chatConfig(w: ReturnType<typeof buildLifecycleWorld>): HandleApprovalResponseConfig {
  const bindingStore: OperatorChannelBindingStore = {
    findActiveBinding: async (q) =>
      q.organizationId === ORG &&
      q.channel === CHANNEL &&
      q.channelIdentifier === CHANNEL_IDENTIFIER
        ? ({ principalId: OPERATOR_PRINCIPAL } as never)
        : null,
  };
  const principal: Principal = {
    id: OPERATOR_PRINCIPAL,
    type: "user",
    name: "Chat Operator",
    organizationId: ORG,
    roles: ["operator"],
  } as Principal;
  const identityStore = {
    getPrincipal: async (id: string) => (id === OPERATOR_PRINCIPAL ? principal : null),
  } as unknown as IdentityStore;
  return {
    bindingStore,
    identityStore,
    respondDeps: {
      approvalStore: w.storage.approvals,
      envelopeStore: w.storage.envelopes,
      workTraceStore: w.harness.traceStore,
      lifecycleService: w.lifecycleService,
      platformLifecycle: w.platformLifecycle,
      sessionManager: null,
      auditLedger: w.ledger,
      logger: { info: () => {}, error: () => {} },
    },
  };
}

function replyCapture(): { sink: ReplySink; replies: string[] } {
  const replies: string[] = [];
  return { sink: { send: async (text) => void replies.push(text) }, replies };
}

async function chatRespond(
  w: ReturnType<typeof buildLifecycleWorld>,
  payload: { action: "approve" | "reject"; approvalId: string; bindingHash: string },
) {
  const { sink, replies } = replyCapture();
  await handleApprovalResponse({
    payload,
    organizationId: ORG,
    channel: CHANNEL,
    channelIdentifier: CHANNEL_IDENTIFIER,
    approvalStore: w.storage.approvals,
    replySink: sink,
    config: chatConfig(w),
  });
  return replies;
}

describe("chat-surface approve drives the REAL lifecycle and the REAL dispatch", () => {
  it("legacy+lifecycle coexistence: chat approve runs the handoff handler and creates the Mira draft", async () => {
    const w = buildLifecycleWorld();
    const parked = await parkViaCron(w);
    const approvalId = await seedLegacyApprovalRow(w, parked);

    const replies = await chatRespond(w, {
      action: "approve",
      approvalId,
      bindingHash: parked.bindingHash,
    });

    // honest reply
    expect(replies).toEqual([APPROVE_EXECUTED_MSG]);
    // THE HANDLER RAN: the real workflow handler created the Mira job
    expect(w.harness.jobs).toHaveLength(1);
    const expectedBrief = synthesizeCreativeBrief(null);
    const rm = await readerFor(w.harness.jobs).read(ORG, { now: new Date(), timezone: "UTC" });
    expect(rm.jobs.find((j) => j.title === expectedBrief.productDescription)).toBeDefined();
    // canonical records
    const trace = (await w.harness.traceStore.getByWorkUnitId(parked.workUnitId))!.trace;
    expect(trace.outcome).toBe("completed");
    expect(trace.approvalOutcome).toBe("approved");
    expect(trace.approvalRespondedBy).toBe(OPERATOR_PRINCIPAL);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "approved",
    );
    const dispatches = w.store.listDispatchRecords();
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.state).toBe("succeeded");
  });

  it("dispatch failure: chat reply is honest, the unit parks as a Retry card, retry recovers", async () => {
    const w = buildLifecycleWorld();
    w.harness.breakHandoffHandlerOnce();
    const parked = await parkViaCron(w);
    const approvalId = await seedLegacyApprovalRow(w, parked);

    const replies = await chatRespond(w, {
      action: "approve",
      approvalId,
      bindingHash: parked.bindingHash,
    });
    expect(replies).toEqual([APPROVE_DISPATCH_FAILED_MSG]);
    expect(w.harness.jobs).toHaveLength(0);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "recovery_required",
    );

    // Retry through the canonical Inbox leg (respondToParkedLifecycle is what
    // the route fires) recovers with attempt 2.
    const { respondToParkedLifecycle } = await import("@switchboard/core");
    const second = await respondToParkedLifecycle(w.deps, {
      lifecycleId: parked.lifecycleId,
      action: "approve",
      respondedBy: OPERATOR_PRINCIPAL,
      bindingHash: parked.bindingHash,
    });
    expect(second.executionResult?.success).toBe(true);
    expect(w.harness.jobs).toHaveLength(1);
    const records = w.store.listDispatchRecords();
    expect(records).toHaveLength(2);
    expect(records[1]?.attemptNumber).toBe(2);
    expect(records[1]?.state).toBe("succeeded");
  });

  it("lifecycle-only fallback: a button carrying the lifecycle id approves, dispatches, and chat-side retry works", async () => {
    const w = buildLifecycleWorld();
    w.harness.breakHandoffHandlerOnce();
    const parked = await parkViaCron(w);
    // NO legacy approval row: the fallback leg must resolve the lifecycle id.

    const first = await chatRespond(w, {
      action: "approve",
      approvalId: parked.lifecycleId,
      bindingHash: parked.bindingHash,
    });
    expect(first).toEqual([APPROVE_DISPATCH_FAILED_MSG]);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "recovery_required",
    );

    // chat-side retry: the SAME button tap is approve-on-recovery_required
    const second = await chatRespond(w, {
      action: "approve",
      approvalId: parked.lifecycleId,
      bindingHash: parked.bindingHash,
    });
    expect(second).toEqual([APPROVE_EXECUTED_MSG]);
    expect(w.harness.jobs).toHaveLength(1);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "approved",
    );
  });

  it("chat reject of the parked handoff creates nothing and fails the trace", async () => {
    const w = buildLifecycleWorld();
    const parked = await parkViaCron(w);

    const replies = await chatRespond(w, {
      action: "reject",
      approvalId: parked.lifecycleId,
      bindingHash: parked.bindingHash,
    });
    expect(replies).toEqual(["Rejected."]);
    expect(w.harness.jobs).toHaveLength(0);
    const trace = (await w.harness.traceStore.getByWorkUnitId(parked.workUnitId))!.trace;
    expect(trace.outcome).toBe("failed");
    expect(trace.approvalOutcome).toBe("rejected");
  });
});
```

Note on imports: `handleApprovalResponse` and the reply constants are exported from the core barrel by PR-2 Task 9 (the `channel-gateway/index.ts` widening; `packages/core/src/index.ts` already does `export * from "./channel-gateway/index.js"`). `res.workUnit` is on the submit response (`SubmitWorkResponse` ok-shape).

- [ ] **Step 11.2: Build the api package deps, run the test**

```bash
pnpm --filter api test -- src/__tests__/chat-approval-loop.test.ts
```

Expected: PASS (4 cases). If the first case fails with NOT_AUTHORIZED, the binding/identity literals do not satisfy the interfaces; fix the casts, not the handler.

- [ ] **Step 11.3: End-to-end mutation check, then revert**

In `packages/core/src/approval/respond-via-lifecycle.ts`, replace the `runDispatch` call with a synthetic success result. Run the chat-approval-loop test. Expected RED: case 1 ("THE HANDLER RAN") fails on `jobs.toHaveLength(1)` while the reply still claims success: exactly the dishonesty this slice kills. Revert, rerun, GREEN. (Requires `pnpm --filter @switchboard/core build` between mutation and test run so the api package sees the mutated dist.)

- [ ] **Step 11.4: Commit, green gate, PR, merge**

```bash
git add apps/api/src/__tests__/chat-approval-loop.test.ts
git commit -m "test(api): chat-surface approval loop integration proof

Drives handleApprovalResponse end to end over the #879 harness: the
REAL ApprovalLifecycleService, REAL PlatformLifecycle, REAL
ExecutionModeRegistry, and the REAL handoff handler, for both the
legacy+lifecycle coexistence shape and the lifecycle-only fallback,
including the dispatch-failure leg (honest reply + recovery_required +
retry attempt 2) and reject."
pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check && pnpm arch:check
git push -u origin test/chat-approval-loop-proof
gh pr create --base main --title "test(api): chat-surface approval loop integration proof" --body "<summary per spec section 5>"
gh pr merge --squash --auto
# ancestry check as in Step 6.2
```

---

## Post-merge cleanup (after PR-3 is an ancestor of origin/main)

- [ ] Code-review cycle per PR happened before each merge (superpowers:requesting-code-review).
- [ ] `git fetch origin main:main` in the primary checkout (only if fast-forwardable; never force).
- [ ] Remove the worktree: exit it first, then `git worktree remove .claude/worktrees/chat-approval-seam && git worktree prune`.
- [ ] Delete local + remote branches: `git branch -D feat/approval-respond-unification feat/chat-approval-honest-replies test/chat-approval-loop-proof docs/chat-approval-seam-spec` and `git push origin --delete ...` for any not auto-deleted by the squash merges.
- [ ] Verify no other session's worktrees/branches were touched: `git worktree list`, `gh pr list`.
