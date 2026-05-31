# D1 Trace-Atomicity Claim-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the D1 double-spend window by making `PlatformIngress.submit()` claim the idempotency key (persist a `running` WorkTrace) _before_ dispatch and fail closed on an unresolved claim, so an idempotent retry can never re-execute a possibly-committed mutation.

**Architecture:** Add an atomic `WorkTraceStore.claim()` primitive (insert a `running` trace; report `P2002` instead of swallowing it). On the keyed execute path, `claim → dispatch → finalize` (`update running→completed/failed`). The replay guard fails closed when it sees a `running` trace. No-key and non-execute paths are unchanged. Reuses the existing `running` `WorkOutcome` and `running→{completed,failed}` transition — **no schema migration**.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), pnpm + Turborepo, Vitest, Prisma. Spec: `docs/superpowers/specs/2026-05-31-d1-trace-atomicity-design.md`.

**Guardrails (from spec review):**

- `idempotency_in_flight` is non-retryable by default; its message must say the prior attempt may have committed and must not be blindly retried. Distinct from claim-insert transient failure (retryable; nothing committed).
- `executionStartedAt` is ONE_SHOT — finalize must NOT re-send it (test asserts this).
- `claim()` must explicitly return `{ claimed: false }` on the idempotency `P2002` — that return is the concurrency lock; do not let `persist()`'s swallow leak in.
- Keyed-only scope. No-key requests keep single-persist; do not broaden into general trace durability.
- Handler-throw after claim must `update running→failed` and preserve the existing rethrow; if that update fails, the stale `running` row must block retry + alert.

**Working directory:** worktree `/Users/jasonli/switchboard/.claude/worktrees/d1-trace-atomicity`, branch `fix/d1-trace-atomicity-double-spend`. Before every commit run `git branch --show-current` and `git status --short`. Tests: `pnpm --filter @switchboard/core test -- --run <substring>` (substring filter, not a path). Format: `pnpm format:check`.

---

## Task 1: Add the `claim()` store primitive (interface + Prisma impl + conformance)

**Files:**

- Modify: `packages/core/src/platform/work-trace-recorder.ts` (add `WorkTraceClaimResult` + `claim()` to interface)
- Modify: `packages/db/src/stores/prisma-work-trace-store.ts` (implement `claim()`)
- Test: `packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts` (claim() behavior)
- Modify (conformance — add `claim` to every `WorkTraceStore` literal): `apps/api/src/app.ts:756`; and the test mocks in:
  - `packages/core/src/platform/__tests__/platform-ingress.test.ts`
  - `packages/core/src/platform/__tests__/platform-ingress-execution-error.test.ts`
  - `packages/core/src/platform/__tests__/platform-ingress-trace-retry.test.ts`
  - `packages/core/src/platform/__tests__/platform-ingress-governance-error.test.ts`
  - `packages/core/src/platform/__tests__/convergence-e2e.test.ts`
  - `packages/core/src/platform/__tests__/runtime-first-response.test.ts`
  - `packages/core/src/platform/__tests__/platform-lifecycle-integrity.test.ts`
  - `packages/core/src/platform/__tests__/platform-lifecycle.test.ts`
  - `packages/core/src/__tests__/work-trace-update-caller-rule.test.ts`
  - `packages/core/src/approval/__tests__/lifecycle-service.test.ts`
  - `packages/core/src/approval/__tests__/lifecycle-service-integrity.test.ts`
  - `apps/api/src/__tests__/execute-platform-parity.test.ts`
  - `apps/api/src/routes/__tests__/no-direct-conversation-state-mutation.test.ts`
  - `apps/api/src/routes/__tests__/escalations-reply-delivery.test.ts`
  - `apps/api/src/routes/__tests__/conversations-send.test.ts`

- [ ] **Step 1: Write the failing store test for `claim()`**

In `packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts`, the file already defines a `makeTrace(overrides)` helper and the `mockPrisma` shape (`workTrace.create` + `$transaction` callback). Add:

```ts
describe("PrismaWorkTraceStore.claim", () => {
  function makeClaimStore(create: ReturnType<typeof vi.fn>) {
    const mockPrisma = {
      workTrace: { create },
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({ workTrace: { create } })),
    };
    return new PrismaWorkTraceStore(mockPrisma as never, {
      auditLedger: new AuditLedger(new InMemoryLedgerStorage()),
      operatorAlerter: new NoopOperatorAlerter(),
    });
  }

  it("returns { claimed: true } on a fresh insert", async () => {
    const create = vi.fn().mockResolvedValue({});
    const store = makeClaimStore(create);
    await expect(
      store.claim(makeTrace({ idempotencyKey: "key-1", outcome: "running" })),
    ).resolves.toEqual({ claimed: true });
    expect(create).toHaveBeenCalledOnce();
  });

  it("returns { claimed: false } on an idempotency-key P2002 conflict (does NOT throw)", async () => {
    const create = vi.fn().mockRejectedValue({ code: "P2002" });
    const store = makeClaimStore(create);
    await expect(
      store.claim(makeTrace({ idempotencyKey: "key-1", outcome: "running" })),
    ).resolves.toEqual({ claimed: false });
  });

  it("rethrows non-P2002 store errors so the caller can retry", async () => {
    const create = vi.fn().mockRejectedValue(new Error("connection reset"));
    const store = makeClaimStore(create);
    await expect(
      store.claim(makeTrace({ idempotencyKey: "key-1", outcome: "running" })),
    ).rejects.toThrow("connection reset");
  });
});
```

- [ ] **Step 2: Run it — verify it fails (no `claim` method)**

Run: `pnpm --filter @switchboard/db test -- --run prisma-work-trace-store`
Expected: FAIL / type error — `claim` does not exist on `PrismaWorkTraceStore`.

- [ ] **Step 3: Add `WorkTraceClaimResult` + `claim()` to the interface**

In `packages/core/src/platform/work-trace-recorder.ts`, add after `WorkTraceReadResult`:

```ts
export type WorkTraceClaimResult = { claimed: true } | { claimed: false };
```

and add to the `WorkTraceStore` interface (above `getByWorkUnitId`):

```ts
  /**
   * Atomically claim an idempotency key by inserting a `running` WorkTrace
   * BEFORE the domain mutation (D1). Returns `{ claimed: false }` when the
   * (organizationId, idempotencyKey) unique already exists — the caller lost
   * the race or a prior attempt already claimed. Throws on transient store
   * errors so the caller can retry. This return value is the concurrency lock
   * for PlatformIngress's claim-first execute path; unlike persist(), it must
   * NOT swallow the idempotency P2002 to void.
   */
  claim(trace: WorkTrace): Promise<WorkTraceClaimResult>;
```

- [ ] **Step 4: Implement `PrismaWorkTraceStore.claim()`**

In `packages/db/src/stores/prisma-work-trace-store.ts`, add `WorkTraceClaimResult` to the type import from `@switchboard/core/platform`, then add this method (mirrors `persist()` but reports `P2002`):

```ts
  async claim(trace: WorkTrace): Promise<WorkTraceClaimResult> {
    const traceVersion = 1;
    const hashInputVersion = trace.hashInputVersion ?? WORK_TRACE_HASH_VERSION_LATEST;
    const contentHash = computeWorkTraceContentHash(trace, traceVersion);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.workTrace.create({
          data: this.buildWorkTraceCreateData(trace, {
            traceVersion,
            contentHash,
            hashInputVersion,
          }),
        });
        await this.auditLedger.record(
          {
            eventType: "work_trace.persisted",
            actorType: trace.actor.type === "service" ? "service_account" : trace.actor.type,
            actorId: trace.actor.id,
            entityType: "work_trace",
            entityId: trace.workUnitId,
            riskCategory: "low",
            visibilityLevel: "system",
            summary: `WorkTrace ${trace.workUnitId} claimed at v${traceVersion}`,
            organizationId: trace.organizationId,
            traceId: trace.traceId,
            snapshot: {
              workUnitId: trace.workUnitId,
              traceId: trace.traceId,
              contentHash,
              traceVersion,
              hashAlgorithm: "sha256",
              hashVersion: hashInputVersion,
            },
          },
          { tx },
        );
      });
      return { claimed: true };
    } catch (err: unknown) {
      // The idempotency-key unique conflict is the concurrency lock: report it,
      // do NOT swallow to void the way persist() does.
      if (this.isUniqueConstraintError(err) && trace.idempotencyKey) {
        return { claimed: false };
      }
      throw err;
    }
  }
```

- [ ] **Step 5: Add `claim` to every `WorkTraceStore` literal (conformance)**

`apps/api/src/app.ts` (~`:756`), add to the inline fallback object:

```ts
      claim: async () => ({ claimed: true as const }),
```

In each test file listed under **Files**, every object literal typed as `WorkTraceStore` (the ones with `persist:`/`getByIdempotencyKey:`) gets:

```ts
      claim: vi.fn().mockResolvedValue({ claimed: true }),
```

(For `makeTraceStore()`-style helpers, add it once in the helper.)

- [ ] **Step 6: Run the store test + full core/db/api typecheck**

Run: `pnpm --filter @switchboard/db test -- --run prisma-work-trace-store`
Expected: PASS (3 new claim tests).
Run: `pnpm typecheck`
Expected: PASS (all `WorkTraceStore` literals now satisfy the interface).

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # expect: fix/d1-trace-atomicity-double-spend
git add -A
git commit -m "feat(core): add WorkTraceStore.claim() atomic idempotency primitive"
```

---

## Task 2: Add `buildClaimTrace()` + the `idempotency_in_flight` ingress error

**Files:**

- Modify: `packages/core/src/platform/work-trace-recorder.ts` (add `buildClaimTrace`)
- Test: `packages/core/src/platform/__tests__/work-trace-recorder.test.ts`
- Modify: `packages/core/src/platform/ingress-error.ts` (add error type)

- [ ] **Step 1: Write the failing test for `buildClaimTrace`**

In `work-trace-recorder.test.ts` (it already has a `baseInput` with `workUnit`, `governanceDecision`, `governanceCompletedAt`), add:

```ts
describe("buildClaimTrace", () => {
  it("produces a running claim with sealed executionStartedAt and no execution fields", () => {
    const t = buildClaimTrace({
      workUnit: baseInput.workUnit,
      governanceDecision: baseInput.governanceDecision,
      governanceCompletedAt: baseInput.governanceCompletedAt,
      executionStartedAt: "2026-05-31T00:00:00.000Z",
    });
    expect(t.outcome).toBe("running");
    expect(t.executionStartedAt).toBe("2026-05-31T00:00:00.000Z");
    expect(t.completedAt).toBeUndefined();
    expect(t.executionOutputs).toBeUndefined();
    expect(t.error).toBeUndefined();
    expect(t.durationMs).toBe(0);
    expect(t.ingressPath).toBe("platform_ingress");
    expect(t.idempotencyKey).toBe(baseInput.workUnit.idempotencyKey);
  });
});
```

(Ensure `buildClaimTrace` is added to the import from `../work-trace-recorder.js`.)

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run work-trace-recorder`
Expected: FAIL — `buildClaimTrace` is not exported.

- [ ] **Step 3: Implement `buildClaimTrace`**

In `work-trace-recorder.ts`, add (it can reference the same `ExecutionConstraints` narrowing as `buildWorkTrace`):

```ts
export interface ClaimTraceInput {
  workUnit: WorkUnit;
  governanceDecision: GovernanceDecision;
  governanceCompletedAt: string;
  executionStartedAt: string;
}

/**
 * Build the `running` WorkTrace persisted as an idempotency CLAIM before the
 * domain mutation (D1). Unlike buildWorkTrace, there is no executionResult yet:
 * outcome is `running`, executionStartedAt is sealed here (ONE_SHOT — never
 * re-sent at finalize), and completedAt/error/outputs are intentionally absent.
 */
export function buildClaimTrace(input: ClaimTraceInput): WorkTrace {
  const { workUnit, governanceDecision } = input;
  let governanceConstraints: import("./governance-types.js").ExecutionConstraints | undefined;
  if ("constraints" in governanceDecision) {
    governanceConstraints = governanceDecision.constraints;
  }
  return {
    workUnitId: workUnit.id,
    traceId: workUnit.traceId,
    parentWorkUnitId: workUnit.parentWorkUnitId,
    deploymentId: workUnit.deployment?.deploymentId,
    intent: workUnit.intent,
    mode: workUnit.resolvedMode,
    organizationId: workUnit.organizationId,
    actor: workUnit.actor,
    trigger: workUnit.trigger,
    idempotencyKey: workUnit.idempotencyKey,

    parameters: workUnit.parameters,
    deploymentContext: workUnit.deployment,
    governanceConstraints,

    governanceOutcome: governanceDecision.outcome,
    riskScore: governanceDecision.riskScore,
    matchedPolicies: governanceDecision.matchedPolicies,
    outcome: "running",
    durationMs: 0,
    injectedPatternIds: [],
    requestedAt: workUnit.requestedAt,
    governanceCompletedAt: input.governanceCompletedAt,
    executionStartedAt: input.executionStartedAt,
    ingressPath: "platform_ingress",
    hashInputVersion: WORK_TRACE_HASH_VERSION_LATEST,
  };
}
```

- [ ] **Step 4: Add the `idempotency_in_flight` ingress error type**

In `packages/core/src/platform/ingress-error.ts`, add `"idempotency_in_flight"` to `IngressErrorTypeBase`:

```ts
type IngressErrorTypeBase =
  | "intent_not_found"
  | "validation_failed"
  | "trigger_not_allowed"
  | "deployment_not_found"
  | "upstream_error"
  | "network_error"
  | "idempotency_in_flight";
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @switchboard/core test -- --run work-trace-recorder`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git branch --show-current
git add -A
git commit -m "feat(core): add buildClaimTrace and idempotency_in_flight ingress error"
```

---

## Task 3: Wire claim-first into `PlatformIngress.submit` (close the double-spend)

**Files:**

- Modify: `packages/core/src/platform/platform-ingress.ts`
- Test: `packages/core/src/platform/__tests__/platform-ingress-trace-atomicity.test.ts` (the Phase-0 repro, already present + new regressions)

- [ ] **Step 1: Add imports + the `running` replay-guard branch**

In `platform-ingress.ts`, add `buildClaimTrace` to the existing import from `./work-trace-recorder.js`. Inside the `if (existingResult) {` block (step 0), BEFORE building the cached result, add:

```ts
// D1: a `running` trace is an unresolved CLAIM from a prior keyed
// attempt — committed-but-unconfirmed, or a concurrent in-flight
// submit. The prior mutation may have committed, so we must never
// re-execute. Fail closed (non-retryable; needs reconciliation).
if (existingTrace.outcome === "running") {
  return {
    ok: false,
    error: {
      type: "idempotency_in_flight",
      intent: request.intent,
      message:
        `A prior attempt for idempotency key "${request.idempotencyKey}" is unresolved and ` +
        `may have already committed. Not re-executing to avoid a double-apply; manual ` +
        `reconciliation required.`,
      retryable: false,
    },
  };
}
```

- [ ] **Step 2: Replace the execute leg (current lines ~293-340) with the claim-first flow**

```ts
// 7. Execute — claim-first for keyed requests (D1). For keyed requests we
// persist a `running` claim BEFORE dispatch so a retry can never see
// "nothing happened"; we finalize the claim (running -> terminal) after.
// No-key requests keep the legacy single-persist path.
const executionStartedAt = new Date().toISOString();
const claim = await this.claimIdempotency(
  traceStore,
  workUnit,
  decision,
  governanceCompletedAt,
  executionStartedAt,
);
if (claim.kind === "conflict") {
  return {
    ok: false,
    error: {
      type: "idempotency_in_flight",
      intent: request.intent,
      message:
        `A concurrent attempt for idempotency key "${request.idempotencyKey}" is in progress. ` +
        `Not executing a duplicate; the prior attempt may commit — reconcile if it does not complete.`,
      retryable: false,
    },
  };
}
if (claim.kind === "claim_failed") {
  // The canonical claim could not be recorded; nothing was dispatched, so
  // no mutation committed. Safe to retry (distinct from idempotency_in_flight).
  return {
    ok: false,
    error: {
      type: "upstream_error",
      intent: request.intent,
      message:
        "Could not record the idempotency claim before execution; no action was taken. Safe to retry.",
      retryable: true,
    },
  };
}
const keyed = claim.kind === "claimed";

let executionResult: ExecutionResult;
try {
  executionResult = await modeRegistry.dispatch(
    workUnit.resolvedMode,
    workUnit,
    decision.constraints,
    { traceId: workUnit.traceId, governanceDecision: decision },
  );
} catch (executionErr) {
  const completedAt = new Date().toISOString();
  const failed = this.buildFailedResult(workUnit, "EXECUTION_EXCEPTION", "Execution failed");
  if (keyed) {
    // Update the running claim -> failed. If THIS fails, the running claim
    // remains and a retry fails closed (no double spend).
    await this.finalizeTrace(traceStore, workUnit, failed, completedAt);
  } else {
    await this.persistTrace(
      traceStore,
      workUnit,
      decision,
      governanceCompletedAt,
      failed,
      executionStartedAt,
      completedAt,
    );
  }
  await this.recordInfrastructureFailure({
    errorType: "execution_exception",
    error: executionErr,
    workUnit,
    retryable: false,
  });
  throw executionErr;
}
const completedAt = new Date().toISOString();

if (keyed) {
  // Domain mutation committed. Finalize the claim; if finalize fails we
  // STILL return success (the mutation happened) and leave the running
  // claim for reconciliation — the retry, not this call, prevents the
  // double spend.
  await this.finalizeTrace(traceStore, workUnit, executionResult, completedAt);
} else {
  await this.persistTrace(
    traceStore,
    workUnit,
    decision,
    governanceCompletedAt,
    executionResult,
    executionStartedAt,
    completedAt,
  );
}

return { ok: true, result: executionResult, workUnit };
```

- [ ] **Step 3: Add the `runWithRetry` helper and refactor `persistTrace` to use it**

Replace the inline retry loop in `persistTrace` (lines ~377-399) so the loop logic lives in a reusable helper. Add:

```ts
  /**
   * Run `fn` with the trace-persist retry policy (jittered backoff). Returns
   * the value on success, or the last error if every attempt threw. Never
   * throws — callers decide how a terminal failure is surfaced.
   */
  private async runWithRetry<T>(
    fn: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    const delayFn = this.config.delayFn ?? defaultDelayFn;
    const { maxAttempts } = TRACE_PERSIST_RETRY_POLICY;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        await delayFn(jitteredDelayMs(attempt));
      }
      try {
        return { ok: true, value: await fn() };
      } catch (err) {
        lastError = err;
      }
    }
    return { ok: false, error: lastError };
  }
```

and change `persistTrace`'s body (after building `trace`) to:

```ts
const result = await this.runWithRetry(() => traceStore.persist(trace));
if (!result.ok) {
  await this.recordInfrastructureFailure({
    errorType: "trace_persist_failed",
    error: result.error,
    workUnit,
    retryable: false,
  });
}
```

- [ ] **Step 4: Add `claimIdempotency` and `finalizeTrace` helpers**

```ts
  /**
   * Claim the idempotency key by persisting a `running` trace before dispatch.
   * - skipped: no key (or no store) -> legacy single-persist path.
   * - claimed: running claim persisted; caller must finalize via update.
   * - conflict: lost the race (P2002) -> caller fails closed.
   * - claim_failed: transient store error before any mutation -> caller returns retryable.
   */
  private async claimIdempotency(
    traceStore: WorkTraceStore | undefined,
    workUnit: WorkUnit,
    decision: GovernanceDecision,
    governanceCompletedAt: string,
    executionStartedAt: string,
  ): Promise<{ kind: "skipped" | "claimed" | "conflict" | "claim_failed" }> {
    if (!traceStore || !workUnit.idempotencyKey) return { kind: "skipped" };
    const claimTrace = buildClaimTrace({
      workUnit,
      governanceDecision: decision,
      governanceCompletedAt,
      executionStartedAt,
    });
    const result = await this.runWithRetry(() => traceStore.claim(claimTrace));
    if (!result.ok) {
      await this.recordInfrastructureFailure({
        errorType: "trace_persist_failed",
        error: result.error,
        workUnit,
        retryable: true,
      });
      return { kind: "claim_failed" };
    }
    return result.value.claimed ? { kind: "claimed" } : { kind: "conflict" };
  }

  /**
   * Finalize a `running` claim by updating it to its terminal outcome. Never
   * throws: a terminal update failure leaves the running claim in place (a
   * retry then fails closed) and records an infra-failure. executionStartedAt
   * is NOT re-sent — it is ONE_SHOT and was sealed at claim time.
   */
  private async finalizeTrace(
    traceStore: WorkTraceStore | undefined,
    workUnit: WorkUnit,
    executionResult: ExecutionResult,
    completedAt: string,
  ): Promise<void> {
    if (!traceStore) return;
    const result = await this.runWithRetry(() =>
      traceStore.update(
        workUnit.id,
        {
          outcome: executionResult.outcome,
          durationMs: executionResult.durationMs,
          executionSummary: executionResult.summary,
          executionOutputs: executionResult.outputs,
          error: executionResult.error,
          injectedPatternIds: executionResult.injectedPatternIds ?? [],
          completedAt,
        },
        { caller: "platform_ingress_finalize", organizationId: workUnit.organizationId },
      ),
    );
    if (!result.ok) {
      await this.recordInfrastructureFailure({
        errorType: "trace_persist_failed",
        error: result.error,
        workUnit,
        retryable: false,
      });
      return;
    }
    if (!result.value.ok) {
      await this.recordInfrastructureFailure({
        errorType: "trace_persist_failed",
        error: new Error(`finalize update rejected: ${result.value.reason}`),
        workUnit,
        retryable: false,
      });
    }
  }
```

- [ ] **Step 5: Run the Phase-0 reproduction — verify it now PASSES**

Run: `pnpm --filter @switchboard/core test -- --run trace-atomicity`
Expected: PASS — handler dispatched once; second submit returns `idempotency_in_flight`; ledger length 1.

> NOTE: the repro test currently asserts `second.ok === true`. Update that assertion to expect the fail-closed response (see Step 6), since the corrected behavior returns `{ ok: false, error.type: "idempotency_in_flight" }`.

- [ ] **Step 6: Update the repro assertions + add regression tests**

In `platform-ingress-trace-atomicity.test.ts`, change the retry expectation in the existing test to:

```ts
const second = await ingress.submit(request);
expect(second.ok).toBe(false);
if (!second.ok) {
  expect(second.error.type).toBe("idempotency_in_flight");
  expect(second.error.retryable).toBe(false);
}
// The money handler ran exactly once across both submissions.
expect(ledger).toHaveLength(1);
expect(vi.mocked(mode.execute)).toHaveBeenCalledTimes(1);
```

Add these regression cases (reuse the file's `InMemoryTraceStore`, `makeRevenueMode`, `buildConfig`):

```ts
it("a successful keyed submit finalizes the claim running -> completed without re-sending executionStartedAt", async () => {
  const ledger: RevenueRow[] = [];
  const traceStore = new InMemoryTraceStore();
  const updateSpy = vi.spyOn(traceStore, "update");
  const ingress = new PlatformIngress(buildConfig(traceStore, makeRevenueMode(ledger)));

  const res = await ingress.submit({ ...baseRequest, idempotencyKey: "ok-key" });
  expect(res.ok).toBe(true);
  const finalized = await traceStore.getByIdempotencyKey("org-1", "ok-key");
  expect(finalized?.trace.outcome).toBe("completed");
  // ONE_SHOT guardrail: finalize update must NOT carry executionStartedAt.
  expect(updateSpy).toHaveBeenCalledTimes(1);
  expect(updateSpy.mock.calls[0]![1]).not.toHaveProperty("executionStartedAt");
  expect(ledger).toHaveLength(1);
});

it("a lost claim (concurrent winner) fails closed without dispatching", async () => {
  const ledger: RevenueRow[] = [];
  const mode = makeRevenueMode(ledger);
  const traceStore = new InMemoryTraceStore();
  vi.spyOn(traceStore, "claim").mockResolvedValue({ claimed: false });
  const ingress = new PlatformIngress(buildConfig(traceStore, mode));

  const res = await ingress.submit({ ...baseRequest, idempotencyKey: "race-key" });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error.type).toBe("idempotency_in_flight");
  expect(vi.mocked(mode.execute)).not.toHaveBeenCalled();
  expect(ledger).toHaveLength(0);
});

it("a transient claim failure aborts before dispatch and is retryable", async () => {
  const ledger: RevenueRow[] = [];
  const mode = makeRevenueMode(ledger);
  const traceStore = new InMemoryTraceStore();
  vi.spyOn(traceStore, "claim").mockRejectedValue(new Error("store down"));
  const ingress = new PlatformIngress(buildConfig(traceStore, mode));

  const res = await ingress.submit({ ...baseRequest, idempotencyKey: "blip-key" });
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.error.type).toBe("upstream_error");
    expect(res.error.retryable).toBe(true);
  }
  expect(vi.mocked(mode.execute)).not.toHaveBeenCalled();
  expect(ledger).toHaveLength(0);
});

it("a keyed handler throw updates the claim running -> failed, then rethrows; retry fails closed", async () => {
  const traceStore = new InMemoryTraceStore();
  const boom = new Error("handler boom");
  const throwingMode = {
    name: "operator_mutation" as const,
    execute: vi.fn().mockRejectedValue(boom),
  };
  const ingress = new PlatformIngress(buildConfig(traceStore, throwingMode));
  const request = { ...baseRequest, idempotencyKey: "throw-key" };

  await expect(ingress.submit(request)).rejects.toBe(boom);
  const t = await traceStore.getByIdempotencyKey("org-1", "throw-key");
  expect(t?.trace.outcome).toBe("failed");

  // Replay of a finalized failure returns cached failed (no re-dispatch).
  const replay = await ingress.submit(request);
  expect(replay.ok).toBe(true);
  if (replay.ok) expect(replay.result.outcome).toBe("failed");
  expect(throwingMode.execute).toHaveBeenCalledTimes(1);
});

it("a no-key submit keeps the legacy single-persist path (no claim)", async () => {
  const ledger: RevenueRow[] = [];
  const traceStore = new InMemoryTraceStore();
  const claimSpy = vi.spyOn(traceStore, "claim");
  const persistSpy = vi.spyOn(traceStore, "persist");
  const ingress = new PlatformIngress(buildConfig(traceStore, makeRevenueMode(ledger)));

  const res = await ingress.submit({ ...baseRequest }); // no idempotencyKey
  expect(res.ok).toBe(true);
  expect(claimSpy).not.toHaveBeenCalled();
  expect(persistSpy).toHaveBeenCalledTimes(1);
  expect(ledger).toHaveLength(1);
});
```

> The `InMemoryTraceStore` already implements `update` (returns `{ ok: true, trace: {} as WorkTrace }`). For the finalize-success test to round-trip `outcome: "completed"`, extend `InMemoryTraceStore.update` to apply the patched fields to the stored trace and return it. Add this minimal body:

```ts
  async update(
    workUnitId: string,
    fields: Partial<WorkTrace>,
  ): Promise<{ ok: true; trace: WorkTrace }> {
    const current = this.byWorkUnit.get(workUnitId);
    const merged = { ...(current ?? ({} as WorkTrace)), ...fields } as WorkTrace;
    if (current) {
      this.byWorkUnit.set(workUnitId, merged);
      if (merged.idempotencyKey) {
        this.byKey.set(this.idemKey(merged.organizationId, merged.idempotencyKey), merged);
      }
    }
    return { ok: true, trace: merged };
  }
```

(Also add a `claim()` to `InMemoryTraceStore` that round-trips like `persist` but returns `{ claimed: boolean }` based on whether the idempotency key already exists — so the default reproduction path exercises a real claim. Default `failPersistCount` still drives the original window: the FIRST `claim` should fail when `failPersistCount > 0`, leaving no claim — matching the Phase-0 scenario where the claim/persist write is what blips.)

Reconcile the Phase-0 test with claim-first: the original test set `failPersistCount = 3` to model the trace write failing. Under claim-first the _claim_ is the pre-dispatch write — so model the window as "claim succeeds, dispatch commits, finalize fails." Update the test setup to: let `claim` succeed, let the mode commit, and force `update` (finalize) to throw 3×. Then the running claim persists, the first submit returns `ok:true` with the result, and the retry sees `running` → `idempotency_in_flight`. Implement by adding a `failFinalizeCount` to `InMemoryTraceStore.update` mirroring `failPersistCount`.

- [ ] **Step 7: Run the atomicity suite + the prior ingress suites**

Run: `pnpm --filter @switchboard/core test -- --run platform-ingress`
Expected: PASS — repro + all 6 regressions green; existing ingress/execution-error/trace-retry/governance-error tests still green (no-key paths unchanged).

- [ ] **Step 8: Commit**

```bash
git branch --show-current
git add -A
git commit -m "fix(core): claim-first fail-closed replay guard closes D1 double-spend"
```

---

## Task 4: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (If it reports phantom missing exports from `@switchboard/{schemas,db,core}`, run `pnpm reset` first, then re-run.)

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: PASS. Known-flaky (ignore if they fail in isolation only): `pg_advisory_xact_lock` integrity tests, api `bootstrap-smoke` npm-warn, gateway-bridge-attribution under full load.

- [ ] **Step 3: Format check (CI runs prettier; local lint does not)**

Run: `pnpm format:check`
Expected: PASS. If it fails, run `pnpm format` (or `prettier --write`) and re-stage.

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit any formatting fixups**

```bash
git branch --show-current
git status --short
git add -A && git commit -m "chore(core): formatting for d1 claim-first fix" # only if needed
```

---

## Self-review notes (coverage map)

- Spec §3.1 `claim()` → Task 1. §3.2 `buildClaimTrace` → Task 2. §3.3 flow (replay `running` branch, claim→dispatch→finalize, finalize-failure returns success, claim-failed retryable) → Task 3 Steps 1-4. §3.4 keyed-only scope → Task 3 (`claimIdempotency` returns `skipped` with no key; no-key regression in Step 6). §3.5 unchanged deny/approval → preserved (execute leg only changed); regression coverage via existing suites in Task 3 Step 7. §4 safety table → Task 3 regressions (lost claim, transient claim fail, handler-throw, finalize-fail-window via repro). §5 tests → Tasks 1-3. §7 affected files → Tasks 1-3. Guardrails: non-retryable `idempotency_in_flight` (Task 3 Steps 1-2 + repro assert), executionStartedAt-not-resent (Task 3 Step 6 first regression), `{claimed:false}` lock (Task 1 Step 1 + Task 3 lost-claim regression), keyed-only (no-key regression), handler-throw (regression).
- Out of scope (NOT in this plan): reconciliation sweeper, domain-level idempotency keys, D4 deterministic child key, revenue-tx atomicity.
