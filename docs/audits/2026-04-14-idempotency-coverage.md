# Idempotency Coverage Audit

**Date:** 2026-04-14  
**Scope:** All execution paths in `packages/` and `apps/`  
**Status:** Gap confirmed — `ActionExecutor` has no deduplication guard

---

## 1. Executive Summary

Switchboard uses idempotency controls at two well-covered layers: the HTTP API middleware
(Redis-backed, key from `Idempotency-Key` header) and the orchestrator's `propose()` pipeline
(`IdempotencyGuard` in `packages/core`). Both layers prevent duplicate governance evaluations and
duplicate API responses.

**Key finding:** `ActionExecutor.execute()` in `packages/agents/src/action-executor.ts` has
no idempotency check. When the agent event loop retries a failed event — or when the same event is
delivered more than once at depth > 0 — each retry fires the registered action handler independently.
Side effects (external API calls, database writes, notifications) may execute multiple times with no
deduplication.

---

## 2. Execution Paths

### 2.1 HTTP Middleware Layer — `apps/api/src/middleware/idempotency.ts`

A Fastify plugin registered globally in `apps/api/src/app.ts`. Intercepts all POST requests.

**Mechanism:**

- `preHandler` hook reads the `Idempotency-Key` request header.
- Looks up the key in a Redis backend (falls back to in-memory when `REDIS_URL` is absent).
- If found, replays the cached `{ statusCode, body }` without touching business logic.
- `onSend` hook stores the response under the key with a 5-minute TTL on first execution.

**Coverage:** All HTTP POST routes — `/execute`, `/propose`, marketplace endpoints.  
**Key length limit:** 256 characters, enforced with a 400 error.  
**Persistence:** Redis (shared across API instances); degrades gracefully to in-memory.

### 2.2 Orchestrator Propose Pipeline — `packages/core/src/orchestrator/propose-pipeline.ts`

`ProposePipeline.propose()` integrates `IdempotencyGuard` from
`packages/core/src/idempotency/guard.ts`.

**Mechanism:**

- At the top of `propose()`, if `params.idempotencyKey` is set and an `IdempotencyGuard` instance
  is configured on `SharedContext`, calls `checkDuplicate(principalId, actionType, parameters)`.
- Key is `sha256(principalId + actionType + JSON(parameters sorted by key))`.
- If a cached response exists, returns it immediately — no policy evaluation, no cartridge call.
- After a successful `proposeInner()`, calls `recordResponse()` to cache the result.
- Default TTL: 5 minutes (configurable via `IdempotencyGuard` constructor).
- The guard is optional: `OrchestratorConfig.idempotencyGuard` defaults to `null` if not
  supplied, making the check a no-op.

**Coverage:** The `propose()` → governance → cartridge pipeline.  
**Not covered:** The guard is only invoked when a key is explicitly passed. Callers that omit
`idempotencyKey` (e.g., internal scheduled triggers) bypass deduplication entirely.

### 2.3 Agent Event Loop — `packages/agents/src/event-loop.ts`

The event loop performs in-flight deduplication using `seenKeys: Set<string>` scoped to a single
`process()` call (lines 102, 246–249). This prevents the same `event.idempotencyKey` from being
dispatched twice within one recursive tree traversal.

**Coverage:** Prevents cycles and duplicate fan-out within a single event processing call.  
**Not covered:** Cross-call deduplication. If the same event is redelivered by an external queue or
if `process()` is called again for the same event (e.g., after a worker crash and restart), the
`seenKeys` set is empty and the event is processed again.

### 2.4 Action Executor — `packages/agents/src/action-executor.ts`

`ActionExecutor.execute()` receives an `ActionRequest`, evaluates it against the policy bridge, and
dispatches to a registered `ActionHandler`. There is no idempotency check at this layer.

**Mechanism (current):**

1. Look up the handler by `action.actionType`.
2. Call `policyBridge.evaluate()` — not idempotent, but read-only.
3. Call `handler(action.parameters, context)` — potentially mutating external state.
4. Return `ActionResult`.

No key is generated, no store is consulted, no cache is written. Every call to `execute()` runs the
handler unconditionally.

---

## 3. Coverage Matrix

| Execution Path                        | Mechanism                                            | Backed By                                | Covered?                   |
| ------------------------------------- | ---------------------------------------------------- | ---------------------------------------- | -------------------------- |
| HTTP API POST requests                | `idempotencyMiddleware` Fastify plugin               | Redis / in-memory                        | Yes                        |
| Orchestrator `propose()` pipeline     | `IdempotencyGuard.checkDuplicate` + `recordResponse` | In-memory (pluggable `IdempotencyStore`) | Yes (when key supplied)    |
| Event loop within-call dedup          | `seenKeys: Set<string>` per `process()` invocation   | In-process memory                        | Partial (single call only) |
| `ActionExecutor.execute()`            | None                                                 | —                                        | **No**                     |
| Chat pipeline (`message-pipeline.ts`) | SHA-256 key passed to API propose call               | Delegated to HTTP middleware             | Yes (via HTTP layer)       |
| MCP server tool calls (`server.ts`)   | SHA-256 key passed to API execution adapter          | Delegated to HTTP middleware             | Yes (via HTTP layer)       |
| Scheduled / internal triggers         | Depends on caller passing `idempotencyKey`           | Delegated to propose pipeline            | Conditional                |

---

## 4. Gap Analysis

### 4.1 ActionExecutor — No Deduplication

**File:** `packages/agents/src/action-executor.ts`, method `execute()` (lines 32–81)

**Risk scenario:** An agent event loop processes an event, dispatches actions, and then encounters
a transient error before recording successful delivery. The orchestration layer retries the event.
The `seenKeys` set is rebuilt from scratch for the new `process()` call, so the event passes the
event-level dedup. `ActionExecutor.execute()` is called again for all actions in the agent
response. Any action handler that writes to an external system (CRM update, email send, ad budget
change) executes a second time.

**Concrete example:** A lead-enrichment agent processes `crm.contact_created`, writes to an
external CRM, and the worker restarts mid-flight. On redelivery the agent runs again, `execute()`
fires again, and the CRM write happens twice.

**Why the existing guards don't prevent this:**

- HTTP middleware: already responded on the first attempt; the retry is an internal re-dispatch, not
  an inbound HTTP request.
- `propose()` idempotency: covers the governance decision, not the agent action side-effect.
- Event loop `seenKeys`: scoped to one `process()` call, reset on every invocation.

### 4.2 Optional Nature of `IdempotencyGuard` in Orchestrator

The `OrchestratorConfig.idempotencyGuard` field defaults to `null`. Any process that constructs
`LifecycleOrchestrator` without explicitly supplying a guard gets no deduplication at the propose
layer, regardless of whether a key is passed. This is a configuration risk, not a code bug, but it
means the protection is opt-in rather than opt-out.

### 4.3 In-Memory vs. Shared Store

`IdempotencyGuard` defaults to `InMemoryIdempotencyStore`. In a multi-replica API deployment, two
concurrent identical requests landing on different replicas will both pass the duplicate check,
because each replica maintains an independent in-memory store. The HTTP middleware does not have
this issue because it uses the shared Redis instance.

---

## 5. Recommendations

### R1 — Add `IdempotencyGuard` to `ActionExecutor` (Task 5)

Inject an optional `IdempotencyGuard` (or equivalent store) into `ActionExecutor`. Before calling
`handler(action.parameters, context)`, generate a key from
`sha256(organizationId + actionType + JSON(parameters))` and check the store. Record the result
after successful execution.

Suggested interface change:

```typescript
// packages/agents/src/action-executor.ts
export class ActionExecutor {
  constructor(private idempotencyGuard?: IdempotencyGuard) {}

  async execute(
    action: ActionRequest,
    context: AgentContext,
    policyBridge: PolicyBridge,
  ): Promise<ActionResult> {
    // existing policy check ...

    // dedup check before handler dispatch
    if (this.idempotencyGuard && action.idempotencyKey) {
      const { isDuplicate, cachedResponse } = await this.idempotencyGuard.checkDuplicate(
        context.organizationId,
        action.actionType,
        action.parameters,
      );
      if (isDuplicate && cachedResponse) {
        return cachedResponse as ActionResult;
      }
    }

    // dispatch handler ...

    // record result
    if (this.idempotencyGuard && action.idempotencyKey) {
      await this.idempotencyGuard.recordResponse(
        context.organizationId,
        action.actionType,
        action.parameters,
        result,
      );
    }

    return result;
  }
}
```

### R2 — Use a Shared `IdempotencyStore` for Multi-Replica Safety

When deploying multiple API replicas, replace `InMemoryIdempotencyStore` with a Redis-backed
implementation (analogous to `RedisBackend` in the HTTP middleware). Wire it to the same Redis
instance used by the middleware.

### R3 — Make `idempotencyGuard` Required or Default to a No-op Singleton

Consider making `OrchestratorConfig.idempotencyGuard` required, or defaulting to a singleton
`InMemoryIdempotencyStore`, so that the guard is never silently absent. Add a startup warning if
the field is null in production mode.

### R4 — Persist Event-Level `seenKeys` Across Restarts

The event loop's within-call `seenKeys` set provides no protection across process restarts. If the
delivery store (`packages/agents/src/delivery-store.ts`) tracks successful deliveries, use it to
seed `seenKeys` at the start of each `process()` call. This closes the cross-restart duplicate
processing window without adding a new dependency.

---

## Appendix: Files Examined

| File                                                 | Role                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/core/src/idempotency/guard.ts`             | Core `IdempotencyGuard` and `InMemoryIdempotencyStore`              |
| `packages/core/src/orchestrator/propose-pipeline.ts` | Integration point: guard called in `propose()`                      |
| `packages/core/src/orchestrator/lifecycle.ts`        | `OrchestratorConfig.idempotencyGuard` wiring                        |
| `packages/core/src/execution-service.ts`             | `ExecutionService` — passes `idempotencyKey` to `resolveAndPropose` |
| `apps/api/src/middleware/idempotency.ts`             | HTTP-level middleware (Redis/memory, 5-min TTL)                     |
| `apps/api/src/app.ts`                                | Middleware registration                                             |
| `packages/agents/src/action-executor.ts`             | **Gap location** — no idempotency                                   |
| `packages/agents/src/event-loop.ts`                  | Within-call `seenKeys` dedup; calls `actionExecutor.execute()`      |
| `packages/schemas/src/action.ts`                     | `ActionRequest.idempotencyKey` field exists in schema               |
| `apps/chat/src/message-pipeline.ts`                  | Generates SHA-256 key, passes to API                                |
| `apps/mcp-server/src/server.ts`                      | Generates SHA-256 key, passes to API                                |
