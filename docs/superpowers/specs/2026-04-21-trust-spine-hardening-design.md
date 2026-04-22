# Trust Spine Hardening — Design Spec

> **Date:** 2026-04-21
> **Status:** Verified — ready for implementation plan
> **Goal:** Remove the five highest-risk trust breakers in the production execution spine.

---

## Scope

Surgical fixes only. No runtime convergence, no package splits, no new abstractions.

**In scope:** idempotency replay safety, durable execute approvals, patch-payload canonicalization, live governance wiring, SSRF guard for website scan.

**Out of scope:** creative-pipeline/ad-optimizer ingress migration, legacy orchestrator deletion, core package decomposition, chat/MCP/dashboard runtime normalization.

---

## Task 1: Enforce idempotency mismatch detection

### Bug

`idempotency.ts` keys cache entries on the raw `Idempotency-Key` header only (line 67). Two different routes or two different payloads sharing the same key will replay the first cached response.

### Semantic choice

Standard idempotency semantics — the key is the client's intent signal:

- **Same key + same method + same route + same body** → replay prior result (correct replay)
- **Same key + different route OR different body** → `409 Conflict` (key reuse mismatch)

This is reject-on-mismatch, not scope-by-body. A changed body with the same key is a client error, not a new request.

### Files

| File                                             | Action |
| ------------------------------------------------ | ------ |
| `apps/api/src/middleware/idempotency.ts`         | Modify |
| `apps/api/src/__tests__/api-idempotency.test.ts` | Modify |

### Implementation

Use the **recommended** approach: store entries keyed by raw idempotency key, persist a request fingerprint alongside the cached response.

1. Compute a deterministic request fingerprint from these fields (in this order):
   - `request.method` — always present
   - `request.routerPath ?? request.routeOptions.url ?? request.url` — normalized route template
   - `SHA-256(JSON.stringify(request.body ?? null))` — body hash

   **Scope decision:** Do NOT include `x-organization-id` or principal in the fingerprint. The idempotency key is the client's intent signal for a specific request shape. If the same client key arrives from a different org/principal with the same method+route+body, that is still a replay (same request). Org/principal are authentication concerns, not idempotency concerns. Including them would silently allow key reuse across tenants, which is the opposite of safety.

2. In `preHandler`: look up by raw idempotency key. On hit, compare stored fingerprint against current request fingerprint:
   - **Match** → replay the cached response (existing behavior, now with fingerprint validation)
   - **Mismatch** → return `409 Conflict` with `{ error: "Idempotency-Key reused with different request" }`
3. In `onSend`: store under the raw idempotency key. Persist `{ statusCode, body, fingerprint }` instead of just `{ statusCode, body }`.

### Tests

- `it("replays cached response for identical request")` — existing test, should still pass
- `it("returns 409 when the same key is used on a different route")` — new
- `it("returns 409 when the same key is used with a different payload")` — new
- `it("allows different keys on the same route")` — existing, should still pass

---

## Task 2: Make /api/execute create durable approval records

### Bug

When `PlatformIngress.submit()` returns `approvalRequired: true`, the execute route (lines 102-109) returns:

```ts
{
  outcome: "PENDING_APPROVAL",
  envelopeId: workUnit.id,
  traceId: workUnit.traceId,
  approvalId: result.approvalId,      // undefined — never set by submit()
  approvalRequest: result.outputs,    // {} — empty in pending path
}
```

No approval record is created. The propose route (`actions.ts:104`) calls `createApprovalForWorkUnit()` in this same situation — the execute route skips it.

### Root cause

Approval record creation is an app-layer responsibility (not ingress). `PlatformIngress.submit()` handles governance evaluation and trace persistence. The route is responsible for calling `createApprovalForWorkUnit()` when the ingress says approval is required. The propose route does this correctly; the execute route does not.

### Verification (2026-04-21)

Confirmed via codebase audit:

1. **`PlatformIngress.submit()` never persists approvals.** The `require_approval` branch (platform-ingress.ts:132-143) builds an in-memory `ExecutionResult` and calls `persistTrace()`, which writes only to `traceStore`. `GovernanceGate.evaluate()` is pure computation with no store writes.
2. **No downstream path creates approval rows.** `createApprovalForWorkUnit` is called only from `actions.ts:104` (propose route). The execute route reads `result.approvalId` (always `undefined`) and `result.outputs` (always `{}`) — no approval row exists.
3. **`createApprovalForWorkUnit` is safe to call from execute.** Single write (`approvalStore.save`), no notifications, no events. WorkUnit shape is identical between propose and execute (both come from `normalizeWorkUnit`). One cosmetic issue: `actionId` uses a `prop_` prefix (approval-factory.ts:47) — not a functional blocker but should be parameterized for clean audit trails.

### Files

| File                                                     | Action |
| -------------------------------------------------------- | ------ |
| `apps/api/src/routes/execute.ts`                         | Modify |
| `apps/api/src/__tests__/api-execute.test.ts`             | Modify |
| `apps/api/src/__tests__/execute-platform-parity.test.ts` | Modify |

### Implementation

In the `approvalRequired` branch of execute.ts, call `createApprovalForWorkUnit()` — the same helper the propose route uses. Return `approvalId` and `bindingHash` in the response. Match the propose route's response shape.

```ts
import { createApprovalForWorkUnit } from "./approval-factory.js";

if ("approvalRequired" in response && response.approvalRequired) {
  const { approvalId, bindingHash } = await createApprovalForWorkUnit({
    workUnit,
    storageContext: app.storageContext,
    routingConfig: app.orchestrator.routingConfig,
  });

  return reply.code(200).send({
    outcome: "PENDING_APPROVAL",
    envelopeId: workUnit.id,
    traceId: workUnit.traceId,
    approvalRequest: { id: approvalId, bindingHash },
  });
}
```

No second persistence path. One helper, two call sites.

**Optional cleanup:** `approval-factory.ts:47` hardcodes `actionId: \`prop\_${workUnit.id}\``. Consider accepting an optional `actionIdPrefix`parameter (defaulting to`"prop"`) so execute-originated approvals use `"exec"`. Not blocking — `respondToApproval`looks up by`approvalId`, not actionId pattern — but improves audit trail clarity.

### Tests

- `it("persists an approval record when execution returns PENDING_APPROVAL")` — assert `storageContext.approvals.getById(approvalId)` returns a non-null record
- `it("returns approvalRequest with id and bindingHash")` — assert response shape
- Update `execute-platform-parity.test.ts` to assert `approvalRequest.id` and `approvalRequest.bindingHash` are truthy

---

## Task 3: Make patch approval execute the patched payload

### Bug

In `platform-lifecycle.ts` (lines 157-176), the patch branch:

1. Applies `applyPatch()` to `envelope.proposals[0].parameters` ✓
2. Persists patched envelope via `envelopeStore.update()` ✓
3. Calls `updateWorkTraceApproval()` — but only writes approval metadata, **not parameters** ✗
4. Calls `executeAfterApproval()` which reads `trace?.parameters ?? proposal?.parameters` — trace has stale params ✗

The execution _happens_ to work because `proposal?.parameters` has the patched values (step 2). But the trace retains pre-patch parameters, which means:

- Audit/debugging reads stale data from the trace
- Any code path that prefers `trace.parameters` over `proposal.parameters` will execute stale params

### Root cause

`updateWorkTraceApproval()` has a narrow typed `fields` parameter (lines 539-548) that doesn't include `parameters`. But `traceStore.update()` accepts `Partial<WorkTrace>`, which does include `parameters`. The constraint is only in the private method's type.

### Files

| File                                                              | Action |
| ----------------------------------------------------------------- | ------ |
| `packages/core/src/platform/platform-lifecycle.ts`                | Modify |
| `packages/core/src/platform/__tests__/platform-lifecycle.test.ts` | Modify |

### Implementation

1. Extend `updateWorkTraceApproval`'s `fields` type to include `parameters?: Record<string, unknown>`. No schema or store changes needed — `traceStore.update()` already accepts `Partial<WorkTrace>`.

2. In the patch branch, pass `parameters: patchedParameters` to `updateWorkTraceApproval()`:

```ts
await this.updateWorkTraceApproval(workUnitId, {
  approvalId: params.approvalId,
  approvalOutcome: "patched",
  approvalRespondedBy: params.respondedBy,
  approvalRespondedAt: respondedAt,
  parameters: patchedParameters,
});
```

3. `executeAfterApproval()` already reads `trace?.parameters` first (line 318). Once the trace is updated, that becomes the canonical source. No changes needed there.

### Tests

- `it("executes the patched parameters after patch approval")` — assert `modeRegistry.dispatch` was called with patched `parameters` and `traceStore.update` was called with patched `parameters`
- `it("stored trace reflects patched parameters")` — assert `traceStore.getByWorkUnitId()` returns the patched values after approval response

---

## Task 4: Wire governance hook into live skill-mode bootstrap

### Bug

`skill-mode.ts` (line 164) constructs `SkillExecutorImpl(adapter, toolsMap)` with only two arguments. The constructor accepts `hooks: SkillHook[] = []` as the fourth parameter. `GovernanceHook` exists in `@switchboard/core/skill-runtime` and is tested in `skill-executor.test.ts`, but is never instantiated in the production boot path.

### Files

| File                                                             | Action |
| ---------------------------------------------------------------- | ------ |
| `apps/api/src/bootstrap/skill-mode.ts`                           | Modify |
| `apps/api/src/bootstrap/__tests__/skill-mode-governance.test.ts` | Create |

### Implementation

Import `GovernanceHook` and pass it as the hooks array:

```ts
const hooks = [new GovernanceHook(toolsMap)];
const skillExecutor = new SkillExecutorImpl(adapter, toolsMap, undefined, hooks);
```

### Tests

Assert governance wiring through behavior, not constructor position:

- `it("constructs SkillExecutorImpl with a governance hook")` — mock `SkillExecutorImpl`, then inspect the constructed instance for a hooks property or named hook. If the class doesn't expose hooks as a readable property, assert via a spy on `GovernanceHook` constructor that it was instantiated with the tools map, and that the resulting instance was passed to `SkillExecutorImpl`.
- Avoid: `mock.calls[0]?.[3]` positional assertions. If the constructor signature changes, positional tests break silently.

**Fallback if instance inspection isn't possible:** Assert that `GovernanceHook` was constructed exactly once with the expected `toolsMap`, and that `SkillExecutorImpl` was constructed exactly once. This proves wiring without coupling to arg position.

---

## Task 5: Block SSRF in website scan route

### Bug

`website-scan.ts` calls `fetch(url)` directly (line 31) with no SSRF protection. `assertSafeUrl()` and `SSRFError` exist in `apps/api/src/utils/ssrf-guard.ts` and are tested in `ssrf-guard.test.ts`, but are not imported or called in the website scan route.

### Files

| File                                          | Action |
| --------------------------------------------- | ------ |
| `apps/api/src/routes/website-scan.ts`         | Modify |
| `apps/api/src/__tests__/website-scan.test.ts` | Create |

### Implementation

```ts
import { assertSafeUrl, SSRFError } from "../utils/ssrf-guard.js";

// before fetch()
try {
  await assertSafeUrl(url);
} catch (err) {
  if (err instanceof SSRFError) {
    return reply.code(400).send({ error: err.message });
  }
  throw err;
}
```

### Tests

- `it("rejects localhost URLs before attempting fetch")` — stub global `fetch`, assert it was never called
- `it("rejects private IP URLs")` — e.g., `http://169.254.169.254/metadata`
- `it("allows valid public HTTPS URLs")` — assert fetch was called
- Existing `ssrf-guard.test.ts` should remain green unchanged

---

## Verification

### Targeted suite

```bash
pnpm vitest run \
  apps/api/src/__tests__/api-idempotency.test.ts \
  apps/api/src/__tests__/api-execute.test.ts \
  apps/api/src/__tests__/execute-platform-parity.test.ts \
  apps/api/src/__tests__/website-scan.test.ts \
  apps/api/src/__tests__/ssrf-guard.test.ts \
  apps/api/src/bootstrap/__tests__/skill-mode-governance.test.ts \
  packages/core/src/platform/__tests__/platform-lifecycle.test.ts \
  packages/core/src/skill-runtime/skill-executor.test.ts
```

### Regression slice

```bash
pnpm vitest run \
  apps/api/src/__tests__/api-approvals.test.ts \
  apps/api/src/__tests__/persistence-truth.test.ts \
  apps/api/src/__tests__/api-hardening.test.ts
```

---

## Correction log

Changes from the original plan, with rationale:

| Task | Original                                 | Revised                                                              | Why                                                                                                                                                                                      |
| ---- | ---------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Body-hash scoping (silent new execution) | 409 Conflict on mismatch                                             | Standard idempotency semantics. Body-hash scoping silently changes the contract from "key = intent" to "key = scope".                                                                    |
| 2    | "Ingress should persist approvals"       | Route calls `createApprovalForWorkUnit()` (same as propose)          | Approval creation is app-layer, not ingress. Ingress handles governance + trace. Both propose and execute routes need to call the factory. Not double-persist — it's the _only_ persist. |
| 3    | "Persist patched params" (hand-waved)    | Extend `updateWorkTraceApproval` fields type to include `parameters` | `traceStore.update()` already accepts `Partial<WorkTrace>`. The constraint is the private method's typed interface, not the store. One-line type change + one-line call-site change.     |
| 4    | Constructor-position assertion           | Behavior/instance assertion                                          | Positional assertions (`mock.calls[0]?.[3]`) couple tests to signature order. Assert via constructor spy or instance property instead.                                                   |
| 5    | Unchanged                                | Unchanged                                                            | Standalone bug — SSRF guard exists but isn't wired. Independent of other tasks.                                                                                                          |

**Key finding during review:** Initial critique of Task 2 ("double-persist risk") was wrong. `PlatformIngress.submit()` does NOT create approval records — it only persists a WorkTrace. Approval record creation is an app-layer responsibility handled by `createApprovalForWorkUnit()` in the route. The propose route does this; the execute route skips it. The original plan's fix was directionally correct, but the framing implied the ingress was responsible. Corrected framing: one factory, two call sites, zero double-persist.
